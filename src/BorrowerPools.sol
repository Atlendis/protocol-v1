// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "./interfaces/IBorrowerPools.sol";

import "./extensions/AaveILendingPool.sol";
import "./lib/Errors.sol";
import "./lib/PoolLogic.sol";
import "./lib/Scaling.sol";
import "./lib/Types.sol";
import "./lib/Uint128WadRayMath.sol";

import "./PoolsController.sol";

contract BorrowerPools is PoolsController, IBorrowerPools {
  using PoolLogic for Types.Pool;
  using Scaling for uint128;
  using Uint128WadRayMath for uint128;

  function initialize(address governance) public initializer {
    _initialize();
    if (governance == address(0)) {
      // Prevent setting governance to null account
      governance = _msgSender();
    }
    _grantRole(DEFAULT_ADMIN_ROLE, governance);
    _grantRole(Roles.GOVERNANCE_ROLE, governance);
    _setRoleAdmin(Roles.BORROWER_ROLE, Roles.GOVERNANCE_ROLE);
    _setRoleAdmin(Roles.POSITION_ROLE, Roles.GOVERNANCE_ROLE);
  }

  // VIEW METHODS

  /**
   * @notice Returns the liquidity ratio of a given tick in a pool's order book.
   * The liquidity ratio is an accounting construct to deduce the accrued interest over time.
   * @param poolHash The identifier of the pool
   * @param rate The tick rate from which to extract the liquidity ratio
   * @return liquidityRatio The liquidity ratio of the given tick
   **/
  function getTickLiquidityRatio(bytes32 poolHash, uint128 rate) public view override returns (uint128 liquidityRatio) {
    liquidityRatio = pools[poolHash].ticks[rate].atlendisLiquidityRatio;
    if (liquidityRatio == 0) {
      liquidityRatio = uint128(PoolLogic.RAY);
    }
  }

  /**
   * @notice Returns the repartition between bonds and deposits of the given tick.
   * @param poolHash The identifier of the pool
   * @param rate The tick rate from which to get data
   * @return adjustedTotalAmount Total amount of deposit in the tick, excluding
   * the pending amounts
   * @return adjustedRemainingAmount Amount of tokens in tick deposited with the
   * underlying yield provider that were deposited before bond issuance
   * @return bondsQuantity The quantity of bonds within the tick
   * @return adjustedPendingAmount Amount of deposit in tick deposited with the
   * underlying yield provider that were deposited after bond issuance
   * @return atlendisLiquidityRatio The liquidity ratio of the given tick
   * @return accruedFees The total fees claimable in the current tick, either from
   * yield provider interests or liquidity rewards accrual
   **/
  function getTickAmounts(bytes32 poolHash, uint128 rate)
    public
    view
    override
    returns (
      uint128 adjustedTotalAmount,
      uint128 adjustedRemainingAmount,
      uint128 bondsQuantity,
      uint128 adjustedPendingAmount,
      uint128 atlendisLiquidityRatio,
      uint128 accruedFees
    )
  {
    Types.Tick storage tick = pools[poolHash].ticks[rate];
    return (
      tick.adjustedTotalAmount,
      tick.adjustedRemainingAmount,
      tick.bondsQuantity,
      tick.adjustedPendingAmount,
      tick.atlendisLiquidityRatio,
      tick.accruedFees
    );
  }

  /**
   * @notice Returns the timestamp of the last fee distribution to the tick
   * @param pool The identifier of the pool pool
   * @param rate The tick rate from which to get data
   * @return lastFeeDistributionTimestamp Timestamp of the last fee's distribution to the tick
   **/
  function getTickLastUpdate(string calldata pool, uint128 rate)
    public
    view
    override
    returns (uint128 lastFeeDistributionTimestamp)
  {
    Types.Tick storage tick = pools[keccak256(abi.encode(pool))].ticks[rate];
    return tick.lastFeeDistributionTimestamp;
  }

  /**
   * @notice Returns the current state of the pool's parameters
   * @param poolHash The identifier of the pool
   * @return weightedAverageLendingRate The average deposit bidding rate in the order book
   * @return adjustedPendingDeposits Amount of tokens deposited after bond
   * issuance and currently on third party yield provider
   **/
  function getPoolAggregates(bytes32 poolHash)
    external
    view
    override
    returns (uint128 weightedAverageLendingRate, uint128 adjustedPendingDeposits)
  {
    Types.Pool storage pool = pools[poolHash];
    Types.PoolParameters storage parameters = pools[poolHash].parameters;

    adjustedPendingDeposits = 0;

    if (pool.state.currentMaturity == 0) {
      weightedAverageLendingRate = estimateLoanRate(pool.parameters.MAX_BORROWABLE_AMOUNT, poolHash);
    } else {
      uint128 amountWeightedRate = 0;
      uint128 totalAmount = 0;
      uint128 rate = parameters.MIN_RATE;
      for (rate; rate != parameters.MAX_RATE + parameters.RATE_SPACING; rate += parameters.RATE_SPACING) {
        amountWeightedRate += pool.ticks[rate].normalizedLoanedAmount.wadMul(rate);
        totalAmount += pool.ticks[rate].normalizedLoanedAmount;
        adjustedPendingDeposits += pool.ticks[rate].adjustedPendingAmount;
      }
      weightedAverageLendingRate = amountWeightedRate.wadDiv(totalAmount);
    }
  }

  /**
   * @notice Returns the current maturity of the pool
   * @param poolHash The identifier of the pool
   * @return poolCurrentMaturity The pool's current maturity
   **/
  function getPoolMaturity(bytes32 poolHash) public view override returns (uint128 poolCurrentMaturity) {
    return pools[poolHash].state.currentMaturity;
  }

  /**
   * @notice Estimates the lending rate corresponding to the input amount,
   * depending on the current state of the pool
   * @param normalizedBorrowedAmount The amount to be borrowed from the pool
   * @param poolHash The identifier of the pool
   * @return estimatedRate The estimated loan rate for the current state of the pool
   **/
  function estimateLoanRate(uint128 normalizedBorrowedAmount, bytes32 poolHash)
    public
    view
    override
    returns (uint128 estimatedRate)
  {
    Types.Pool storage pool = pools[poolHash];
    Types.PoolParameters storage parameters = pool.parameters;

    if (pool.state.currentMaturity > 0 || pool.state.defaulted || pool.state.closed || !pool.state.active) {
      return 0;
    }

    if (normalizedBorrowedAmount > pool.parameters.MAX_BORROWABLE_AMOUNT) {
      normalizedBorrowedAmount = pool.parameters.MAX_BORROWABLE_AMOUNT;
    }

    uint128 yieldProviderLiquidityRatio = uint128(
      parameters.YIELD_PROVIDER.getReserveNormalizedIncome(address(parameters.UNDERLYING_TOKEN))
    );
    uint128 rate = pool.parameters.MIN_RATE;
    uint128 normalizedRemainingAmount = normalizedBorrowedAmount;
    uint128 amountWeightedRate = 0;
    for (rate; rate != parameters.MAX_RATE + parameters.RATE_SPACING; rate += parameters.RATE_SPACING) {
      (uint128 atlendisLiquidityRatio, , , ) = pool.peekFeesForTick(rate, yieldProviderLiquidityRatio);
      uint128 tickAmount = pool.ticks[rate].adjustedRemainingAmount.wadRayMul(atlendisLiquidityRatio);
      if (tickAmount < normalizedRemainingAmount) {
        normalizedRemainingAmount -= tickAmount;
        amountWeightedRate += tickAmount.wadMul(rate);
      } else {
        amountWeightedRate += normalizedRemainingAmount.wadMul(rate);
        normalizedRemainingAmount = 0;
        break;
      }
    }
    if (normalizedBorrowedAmount == normalizedRemainingAmount) {
      return 0;
    }
    estimatedRate = amountWeightedRate.wadDiv(normalizedBorrowedAmount - normalizedRemainingAmount);
  }

  /**
   * @notice Returns the token amount's repartition between bond quantity and normalized
   * deposited amount currently placed on third party yield provider
   * @param poolHash The identifier of the pool
   * @param rate Tick's rate
   * @param adjustedAmount Adjusted amount of tokens currently on third party yield provider
   * @param bondsIssuanceIndex The identifier of the borrow group
   * @return bondsQuantity Quantity of bonds held
   * @return normalizedDepositedAmount Amount of deposit currently on third party yield provider
   **/
  function getAmountRepartition(
    bytes32 poolHash,
    uint128 rate,
    uint128 adjustedAmount,
    uint128 bondsIssuanceIndex
  ) public view override returns (uint128 bondsQuantity, uint128 normalizedDepositedAmount) {
    Types.Pool storage pool = pools[poolHash];
    uint128 yieldProviderLiquidityRatio = uint128(
      pool.parameters.YIELD_PROVIDER.getReserveNormalizedIncome(address(pool.parameters.UNDERLYING_TOKEN))
    );

    if (bondsIssuanceIndex > pool.state.currentBondsIssuanceIndex) {
      return (0, adjustedAmount.wadRayMul(yieldProviderLiquidityRatio));
    }

    uint128 adjustedDepositedAmount;
    (bondsQuantity, adjustedDepositedAmount) = pool.computeAmountRepartitionForTick(
      rate,
      adjustedAmount,
      bondsIssuanceIndex
    );

    (uint128 atlendisLiquidityRatio, uint128 accruedFees, , ) = pool.peekFeesForTick(rate, yieldProviderLiquidityRatio);
    uint128 accruedFeesShare = pool.peekAccruedFeesShare(rate, adjustedDepositedAmount, accruedFees);
    normalizedDepositedAmount = adjustedDepositedAmount.wadRayMul(atlendisLiquidityRatio) + accruedFeesShare;
  }

  /**
   * @notice Returns the total amount a borrower has to repay to a pool. Includes borrowed
   * amount, late repay fees and protocol fees
   * @param poolHash The identifier of the pool
   * @return normalizedRepayAmount Total repay amount
   **/
  function getRepayAmounts(bytes32 poolHash, bool earlyRepay)
    public
    view
    override
    returns (
      uint128 normalizedRepayAmount,
      uint128 lateRepayFee,
      uint128 repaymentFees
    )
  {
    uint128 preFeeRepayAmount = pools[poolHash].getRepayValue(earlyRepay);
    lateRepayFee = pools[poolHash].getLateRepayFeePerBond().wadMul(preFeeRepayAmount);
    repaymentFees = pools[poolHash].getRepaymentFees(preFeeRepayAmount + lateRepayFee);
    normalizedRepayAmount = preFeeRepayAmount + repaymentFees + lateRepayFee;
  }

  // LENDER METHODS

  /**
   * @notice Gets called within the Position.deposit() function and enables a lender to deposit assets
   * into a given pool's order book. The lender specifies a rate (price) at which it is willing to
   * lend out its assets (bid on the zero coupon bond). The full amount will initially be deposited
   * on the underlying yield provider until the borrower sells bonds at the specified rate.
   * @param normalizedAmount The amount of the given asset to deposit
   * @param rate The rate at which to bid for a bond
   * @param poolHash The identifier of the pool
   * @param underlyingToken Contract' address of the token to be deposited
   * @param sender The lender address who calls the deposit function on the Position
   * @return adjustedAmount Deposited amount adjusted with current liquidity index
   * @return bondsIssuanceIndex The identifier of the borrow group to which the deposit has been allocated
   **/
  function deposit(
    uint128 rate,
    bytes32 poolHash,
    address underlyingToken,
    address sender,
    uint128 normalizedAmount
  )
    public
    override
    whenNotPaused
    onlyRole(Roles.POSITION_ROLE)
    returns (uint128 adjustedAmount, uint128 bondsIssuanceIndex)
  {
    Types.Pool storage pool = pools[poolHash];
    if (pool.state.defaulted) {
      revert Errors.BP_POOL_DEFAULTED();
    }
    if (!pool.state.active) {
      revert Errors.BP_POOL_NOT_ACTIVE();
    }
    if (pool.state.closed) {
      revert Errors.BP_POOL_CLOSED();
    }
    if (underlyingToken != pool.parameters.UNDERLYING_TOKEN) {
      revert Errors.BP_UNMATCHED_TOKEN();
    }
    if (rate < pool.parameters.MIN_RATE) {
      revert Errors.BP_OUT_OF_BOUND_MIN_RATE();
    }
    if (rate > pool.parameters.MAX_RATE) {
      revert Errors.BP_OUT_OF_BOUND_MAX_RATE();
    }
    if ((rate - pool.parameters.MIN_RATE) % pool.parameters.RATE_SPACING != 0) {
      revert Errors.BP_RATE_SPACING();
    }
    adjustedAmount = 0;
    bondsIssuanceIndex = 0;
    (adjustedAmount, bondsIssuanceIndex) = pool.depositToTick(rate, normalizedAmount);
    pool.depositToYieldProvider(sender, normalizedAmount);
  }

  /**
   * @notice Gets called within the Position.withdraw() function and enables a lender to
   * evaluate the exact amount of tokens it is allowed to withdraw
   * @dev This method is meant to be used exclusively with the withdraw() method
   * Under certain circumstances, this method can return incorrect values, that would otherwise
   * be rejected by the checks made in the withdraw() method
   * @param poolHash The identifier of the pool
   * @param rate The rate the position is bidding for
   * @param adjustedAmount The amount of tokens in the position, adjusted to the deposit liquidity ratio
   * @param bondsIssuanceIndex An index determining deposit timing
   * @return adjustedAmountToWithdraw The amount of tokens to withdraw, adjuste for borrow pool use
   * @return depositedAmountToWithdraw The amount of tokens to withdraw, adjuste for position use
   * @return remainingBondsQuantity The quantity of bonds remaining within the position
   * @return bondsMaturity The maturity of bonds remaining within the position after withdraw
   **/
  function getWithdrawAmounts(
    bytes32 poolHash,
    uint128 rate,
    uint128 adjustedAmount,
    uint128 bondsIssuanceIndex
  )
    public
    view
    override
    returns (
      uint128 adjustedAmountToWithdraw,
      uint128 depositedAmountToWithdraw,
      uint128 remainingBondsQuantity,
      uint128 bondsMaturity
    )
  {
    Types.Pool storage pool = pools[poolHash];
    if (!pool.state.active) {
      revert Errors.BP_POOL_NOT_ACTIVE();
    }

    (remainingBondsQuantity, adjustedAmountToWithdraw) = pool.computeAmountRepartitionForTick(
      rate,
      adjustedAmount,
      bondsIssuanceIndex
    );

    // return amount adapted to bond index
    depositedAmountToWithdraw = adjustedAmountToWithdraw.wadRayDiv(
      pool.getBondIssuanceMultiplierForTick(rate, bondsIssuanceIndex)
    );
    bondsMaturity = pool.state.currentMaturity;
  }

  /**
   * @notice Gets called within the Position.withdraw() function and enables a lender to
   * withdraw assets that are deposited with the underlying yield provider
   * @param poolHash The identifier of the pool
   * @param rate The rate the position is bidding for
   * @param adjustedAmountToWithdraw The actual amount of tokens to withdraw from the position
   * @param bondsIssuanceIndex An index determining deposit timing
   * @param owner The address to which the withdrawns funds are sent
   * @return normalizedDepositedAmountToWithdraw Actual amount of tokens withdrawn and sent to the lender
   **/
  function withdraw(
    bytes32 poolHash,
    uint128 rate,
    uint128 adjustedAmountToWithdraw,
    uint128 bondsIssuanceIndex,
    address owner
  ) public override whenNotPaused onlyRole(Roles.POSITION_ROLE) returns (uint128 normalizedDepositedAmountToWithdraw) {
    Types.Pool storage pool = pools[poolHash];

    if (bondsIssuanceIndex > (pool.state.currentBondsIssuanceIndex + 1)) {
      revert Errors.BP_BOND_ISSUANCE_ID_TOO_HIGH();
    }
    bool isPendingDeposit = bondsIssuanceIndex > pool.state.currentBondsIssuanceIndex;

    if (
      !((!(isPendingDeposit) && pool.ticks[rate].adjustedRemainingAmount > 0) ||
        (isPendingDeposit && pool.ticks[rate].adjustedPendingAmount > 0))
    ) {
      revert Errors.BP_TARGET_BOND_ISSUANCE_INDEX_EMPTY();
    }
    if (adjustedAmountToWithdraw <= 0) {
      revert Errors.BP_NO_DEPOSIT_TO_WITHDRAW();
    }

    normalizedDepositedAmountToWithdraw = pool.withdrawDepositedAmountForTick(
      rate,
      adjustedAmountToWithdraw,
      bondsIssuanceIndex
    );

    pool.parameters.YIELD_PROVIDER.withdraw(
      pool.parameters.UNDERLYING_TOKEN,
      normalizedDepositedAmountToWithdraw.scaleFromWad(pool.parameters.TOKEN_DECIMALS),
      owner
    );
  }

  /**
   * @notice Gets called within Position.updateRate() and updates the order book ticks affected by the position
   * updating its rate. This is only possible as long as there are no bonds in the position, i.e the full
   * position currently lies with the yield provider
   * @param adjustedAmount The adjusted balance of tokens of the given position
   * @param poolHash The identifier of the pool
   * @param oldRate The current rate of the position
   * @param newRate The new rate of the position
   * @param oldBondsIssuanceIndex The identifier of the borrow group from the given position
   * @return newAdjustedAmount The updated amount of tokens of the position adjusted by the
   * new tick's global liquidity ratio
   * @return newBondsIssuanceIndex The new borrow group id to which the updated position is linked
   **/
  function updateRate(
    uint128 adjustedAmount,
    bytes32 poolHash,
    uint128 oldRate,
    uint128 newRate,
    uint128 oldBondsIssuanceIndex
  )
    public
    override
    whenNotPaused
    onlyRole(Roles.POSITION_ROLE)
    returns (
      uint128 newAdjustedAmount,
      uint128 newBondsIssuanceIndex,
      uint128 normalizedAmount
    )
  {
    Types.Pool storage pool = pools[poolHash];

    if (pool.state.closed) {
      revert Errors.BP_POOL_CLOSED();
    }
    // cannot update rate when being borrowed
    (uint128 bondsQuantity, ) = getAmountRepartition(poolHash, oldRate, adjustedAmount, oldBondsIssuanceIndex);
    if (bondsQuantity != 0) {
      revert Errors.BP_LOAN_ONGOING();
    }
    if (newRate < pool.parameters.MIN_RATE) {
      revert Errors.BP_OUT_OF_BOUND_MIN_RATE();
    }
    if (newRate > pool.parameters.MAX_RATE) {
      revert Errors.BP_OUT_OF_BOUND_MAX_RATE();
    }
    if ((newRate - pool.parameters.MIN_RATE) % pool.parameters.RATE_SPACING != 0) {
      revert Errors.BP_RATE_SPACING();
    }

    // input amount adapted to bond index
    uint128 adjustedBondIndexAmount = adjustedAmount.wadRayMul(
      pool.getBondIssuanceMultiplierForTick(oldRate, oldBondsIssuanceIndex)
    );
    normalizedAmount = pool.withdrawDepositedAmountForTick(oldRate, adjustedBondIndexAmount, oldBondsIssuanceIndex);
    (newAdjustedAmount, newBondsIssuanceIndex) = pool.depositToTick(newRate, normalizedAmount);
  }

  // BORROWER METHODS

  /**
   * @notice Called by the borrower to sell bonds to the order book.
   * The affected ticks get updated according the amount of bonds sold.
   * @param to The address to which the borrowed funds should be sent.
   * @param loanAmount The total amount of the loan
   **/
  function borrow(address to, uint128 loanAmount) external override whenNotPaused onlyRole(Roles.BORROWER_ROLE) {
    bytes32 poolHash = borrowerAuthorizedPools[_msgSender()];
    Types.Pool storage pool = pools[poolHash];
    if (pool.state.closed) {
      revert Errors.BP_POOL_CLOSED();
    }
    if (pool.state.defaulted) {
      revert Errors.BP_POOL_DEFAULTED();
    }
    if (pool.state.currentMaturity > 0 && (block.timestamp > pool.state.currentMaturity)) {
      revert Errors.BP_MULTIPLE_BORROW_AFTER_MATURITY();
    }

    uint128 normalizedLoanAmount = loanAmount.scaleToWad(pool.parameters.TOKEN_DECIMALS);
    uint128 normalizedEstablishmentFee = normalizedLoanAmount.wadMul(pool.parameters.ESTABLISHMENT_FEE_RATE);
    uint128 normalizedBorrowedAmount = normalizedLoanAmount - normalizedEstablishmentFee;
    if (pool.state.normalizedBorrowedAmount + normalizedLoanAmount > pool.parameters.MAX_BORROWABLE_AMOUNT) {
      revert Errors.BP_BORROW_MAX_BORROWABLE_AMOUNT_EXCEEDED();
    }

    if (block.timestamp < pool.state.nextLoanMinStart) {
      revert Errors.BP_BORROW_COOLDOWN_PERIOD_NOT_OVER();
    }
    // collectFees should be called before changing pool global state as fee collection depends on it
    pool.collectFees();

    if (normalizedLoanAmount > pool.state.normalizedAvailableDeposits) {
      revert Errors.BP_BORROW_OUT_OF_BOUND_AMOUNT();
    }

    uint128 remainingAmount = normalizedLoanAmount;
    uint128 currentInterestRate = pool.state.lowerInterestRate - pool.parameters.RATE_SPACING;
    while (remainingAmount > 0 && currentInterestRate < pool.parameters.MAX_RATE) {
      currentInterestRate += pool.parameters.RATE_SPACING;
      if (pool.ticks[currentInterestRate].adjustedRemainingAmount > 0) {
        (uint128 bondsPurchasedQuantity, uint128 normalizedUsedAmountForPurchase) = pool
          .getBondsIssuanceParametersForTick(currentInterestRate, remainingAmount);
        pool.addBondsToTick(currentInterestRate, bondsPurchasedQuantity, normalizedUsedAmountForPurchase);
        remainingAmount -= normalizedUsedAmountForPurchase;
      }
    }
    if (remainingAmount != 0) {
      revert Errors.BP_BORROW_UNSUFFICIENT_BORROWABLE_AMOUNT_WITHIN_BRACKETS();
    }
    if (pool.state.currentMaturity == 0) {
      pool.state.currentMaturity = uint128(block.timestamp + pool.parameters.LOAN_DURATION);
      emit Borrow(poolHash, normalizedBorrowedAmount, normalizedEstablishmentFee);
    } else {
      emit FurtherBorrow(poolHash, normalizedBorrowedAmount, normalizedEstablishmentFee);
    }

    protocolFees[poolHash] += normalizedEstablishmentFee;
    pool.state.normalizedBorrowedAmount += normalizedLoanAmount;
    pool.parameters.YIELD_PROVIDER.withdraw(
      pool.parameters.UNDERLYING_TOKEN,
      normalizedBorrowedAmount.scaleFromWad(pool.parameters.TOKEN_DECIMALS),
      to
    );
  }

  /**
   * @notice Repays a currently outstanding bonds of the given pool.
   **/
  function repay() external override whenNotPaused onlyRole(Roles.BORROWER_ROLE) {
    bytes32 poolHash = borrowerAuthorizedPools[_msgSender()];
    Types.Pool storage pool = pools[poolHash];
    if (pool.state.defaulted) {
      revert Errors.BP_POOL_DEFAULTED();
    }
    if (pool.state.currentMaturity == 0) {
      revert Errors.BP_REPAY_NO_ACTIVE_LOAN();
    }
    bool earlyRepay = pool.state.currentMaturity > block.timestamp;
    if (earlyRepay && !pool.parameters.EARLY_REPAY) {
      revert Errors.BP_EARLY_REPAY_NOT_ACTIVATED();
    }

    // collectFees should be called before changing pool global state as fee collection depends on it
    pool.collectFees();

    uint128 lateRepayFee;
    bool bondsIssuanceIndexAlreadyIncremented = false;
    uint128 normalizedRepayAmount;
    uint128 lateRepayFeePerBond = pool.getLateRepayFeePerBond();

    for (
      uint128 rate = pool.state.lowerInterestRate;
      rate <= pool.parameters.MAX_RATE;
      rate += pool.parameters.RATE_SPACING
    ) {
      (uint128 normalizedRepayAmountForTick, uint128 lateRepayFeeForTick) = pool.repayForTick(
        rate,
        lateRepayFeePerBond
      );
      normalizedRepayAmount += normalizedRepayAmountForTick + lateRepayFeeForTick;
      lateRepayFee += lateRepayFeeForTick;
      bool indexIncremented = pool.includePendingDepositsForTick(rate, bondsIssuanceIndexAlreadyIncremented);
      bondsIssuanceIndexAlreadyIncremented = indexIncremented || bondsIssuanceIndexAlreadyIncremented;
    }

    uint128 repaymentFees = pool.getRepaymentFees(normalizedRepayAmount);
    normalizedRepayAmount += repaymentFees;

    pool.depositToYieldProvider(_msgSender(), normalizedRepayAmount);
    pool.state.nextLoanMinStart = uint128(block.timestamp) + pool.parameters.COOLDOWN_PERIOD;

    pool.state.bondsIssuedQuantity = 0;
    protocolFees[poolHash] += repaymentFees;
    pool.state.normalizedAvailableDeposits += normalizedRepayAmount;

    if (block.timestamp > (pool.state.currentMaturity + pool.parameters.REPAYMENT_PERIOD)) {
      emit LateRepay(
        poolHash,
        normalizedRepayAmount,
        lateRepayFee,
        repaymentFees,
        pool.state.normalizedAvailableDeposits,
        pool.state.nextLoanMinStart
      );
    } else if (pool.state.currentMaturity > block.timestamp) {
      emit EarlyRepay(
        poolHash,
        normalizedRepayAmount,
        repaymentFees,
        pool.state.normalizedAvailableDeposits,
        pool.state.nextLoanMinStart
      );
    } else {
      emit Repay(
        poolHash,
        normalizedRepayAmount,
        repaymentFees,
        pool.state.normalizedAvailableDeposits,
        pool.state.nextLoanMinStart
      );
    }

    // set global data for next loan
    pool.state.currentMaturity = 0;
    pool.state.normalizedBorrowedAmount = 0;
  }

  /**
   * @notice Called by the borrower to top up liquidity rewards' reserve that
   * is distributed to liquidity providers at the pre-defined distribution rate.
   * @param amount Amount of tokens that will be add up to the pool's liquidity rewards reserve
   **/
  function topUpLiquidityRewards(uint128 amount) external override whenNotPaused onlyRole(Roles.BORROWER_ROLE) {
    Types.Pool storage pool = pools[borrowerAuthorizedPools[_msgSender()]];
    uint128 normalizedAmount = amount.scaleToWad(pool.parameters.TOKEN_DECIMALS);

    pool.depositToYieldProvider(_msgSender(), normalizedAmount);
    uint128 yieldProviderLiquidityRatio = pool.topUpLiquidityRewards(normalizedAmount);

    if (
      !pool.state.active &&
      pool.state.remainingAdjustedLiquidityRewardsReserve.wadRayMul(yieldProviderLiquidityRatio) >=
      pool.parameters.LIQUIDITY_REWARDS_ACTIVATION_THRESHOLD
    ) {
      pool.state.active = true;
      emit PoolActivated(pool.parameters.POOL_HASH);
    }

    emit TopUpLiquidityRewards(borrowerAuthorizedPools[_msgSender()], normalizedAmount);
  }

  // PUBLIC METHODS

  /**
   * @notice Collect yield provider fees as well as liquidity rewards for the target tick
   * @param poolHash The identifier of the pool
   **/
  function collectFeesForTick(bytes32 poolHash, uint128 rate) external override whenNotPaused {
    Types.Pool storage pool = pools[poolHash];
    pool.collectFees(rate);
  }

  /**
   * @notice Collect yield provider fees as well as liquidity rewards for the whole pool
   * Iterates over all pool initialized ticks
   * @param poolHash The identifier of the pool
   **/
  function collectFees(bytes32 poolHash) external override whenNotPaused {
    Types.Pool storage pool = pools[poolHash];
    pool.collectFees();
  }
}

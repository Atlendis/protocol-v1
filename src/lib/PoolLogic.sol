// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {Rounding} from "./Rounding.sol";
import {Scaling} from "./Scaling.sol";
import {Uint128WadRayMath} from "./Uint128WadRayMath.sol";
import "./Types.sol";
import "./Errors.sol";
import "../extensions/AaveILendingPool.sol";

library PoolLogic {
  event PoolActivated(bytes32 poolHash);
  enum BalanceUpdateType {
    INCREASE,
    DECREASE
  }
  event TickInitialized(bytes32 borrower, uint128 rate, uint128 atlendisLiquidityRatio);
  event TickLoanDeposit(bytes32 borrower, uint128 rate, uint128 adjustedPendingDeposit);
  event TickNoLoanDeposit(
    bytes32 borrower,
    uint128 rate,
    uint128 adjustedPendingDeposit,
    uint128 atlendisLiquidityRatio
  );
  event TickBorrow(
    bytes32 borrower,
    uint128 rate,
    uint128 adjustedRemainingAmountReduction,
    uint128 loanedAmount,
    uint128 atlendisLiquidityRatio,
    uint128 unborrowedRatio
  );
  event TickWithdrawPending(bytes32 borrower, uint128 rate, uint128 adjustedAmountToWithdraw);
  event TickWithdrawRemaining(
    bytes32 borrower,
    uint128 rate,
    uint128 adjustedAmountToWithdraw,
    uint128 atlendisLiquidityRatio,
    uint128 accruedFeesToWithdraw
  );
  event TickPendingDeposit(
    bytes32 borrower,
    uint128 rate,
    uint128 adjustedPendingAmount,
    bool poolBondIssuanceIndexIncremented
  );
  event TopUpLiquidityRewards(bytes32 borrower, uint128 addedLiquidityRewards);
  event TickRepay(bytes32 borrower, uint128 rate, uint128 newAdjustedRemainingAmount, uint128 atlendisLiquidityRatio);
  event CollectFeesForTick(bytes32 borrower, uint128 rate, uint128 remainingLiquidityRewards, uint128 addedAccruedFees);

  using PoolLogic for Types.Pool;
  using Uint128WadRayMath for uint128;
  using Rounding for uint128;
  using Scaling for uint128;
  using SafeERC20Upgradeable for IERC20Upgradeable;

  uint256 public constant SECONDS_PER_YEAR = 365 days;
  uint256 public constant WAD = 1e18;
  uint256 public constant RAY = 1e27;

  /**
   * @dev Getter for the multiplier allowing a conversion between pending and deposited
   * amounts for the target bonds issuance index
   **/
  function getBondIssuanceMultiplierForTick(
    Types.Pool storage pool,
    uint128 rate,
    uint128 bondsIssuanceIndex
  ) internal view returns (uint128 returnBondsIssuanceMultiplier) {
    Types.Tick storage tick = pool.ticks[rate];
    returnBondsIssuanceMultiplier = tick.bondsIssuanceIndexMultiplier[bondsIssuanceIndex];
    if (returnBondsIssuanceMultiplier == 0) {
      returnBondsIssuanceMultiplier = uint128(RAY);
    }
  }

  /**
   * @dev Get share of accumulated fees from stored current tick state
   **/
  function getAccruedFeesShare(
    Types.Pool storage pool,
    uint128 rate,
    uint128 adjustedAmount
  ) internal view returns (uint128 accruedFeesShare) {
    Types.Tick storage tick = pool.ticks[rate];
    accruedFeesShare = tick.accruedFees.wadMul(adjustedAmount).wadDiv(tick.adjustedRemainingAmount);
  }

  /**
   * @dev Get share of accumulated fees from estimated current tick state
   **/
  function peekAccruedFeesShare(
    Types.Pool storage pool,
    uint128 rate,
    uint128 adjustedAmount,
    uint128 accruedFees
  ) public view returns (uint128 accruedFeesShare) {
    Types.Tick storage tick = pool.ticks[rate];
    if (tick.adjustedRemainingAmount == 0) {
      return 0;
    }
    accruedFeesShare = accruedFees.wadMul(adjustedAmount).wadDiv(tick.adjustedRemainingAmount);
  }

  function getLateRepayFeePerBond(Types.Pool storage pool) public view returns (uint128 lateRepayFeePerBond) {
    uint256 lateRepaymentTimestamp = pool.state.currentMaturity + pool.parameters.REPAYMENT_PERIOD;
    if (block.timestamp > lateRepaymentTimestamp) {
      uint256 referenceTimestamp = pool.state.defaultTimestamp > 0 ? pool.state.defaultTimestamp : block.timestamp;
      lateRepayFeePerBond = uint128(
        uint256(referenceTimestamp - lateRepaymentTimestamp) * uint256(pool.parameters.LATE_REPAY_FEE_PER_BOND_RATE)
      );
    }
  }

  function getRepaymentFees(Types.Pool storage pool, uint128 normalizedRepayAmount)
    public
    view
    returns (uint128 repaymentFees)
  {
    repaymentFees = (normalizedRepayAmount - pool.state.normalizedBorrowedAmount).wadMul(
      pool.parameters.REPAYMENT_FEE_RATE
    );
  }

  /**
   * @dev The return value includes only notional and accrued interest,
   * it does not include any fees due for repay by the borrrower
   **/
  function getRepayValue(Types.Pool storage pool, bool earlyRepay) public view returns (uint128 repayValue) {
    if (pool.state.currentMaturity == 0) {
      return 0;
    }
    if (!earlyRepay) {
      // Note: Despite being in the context of a none early repay we prevent underflow in case of wrong user input
      // and allow querying expected bonds quantity if loan is repaid at maturity
      if (block.timestamp <= pool.state.currentMaturity) {
        return pool.state.bondsIssuedQuantity;
      }
    }
    for (
      uint128 rate = pool.state.lowerInterestRate;
      rate <= pool.parameters.MAX_RATE;
      rate += pool.parameters.RATE_SPACING
    ) {
      Types.Tick storage tick = pool.ticks[rate];
      repayValue += getTimeValue(pool, tick.bondsQuantity, rate);
    }
  }

  function getTimeValue(
    Types.Pool storage pool,
    uint128 bondsQuantity,
    uint128 rate
  ) public view returns (uint128) {
    if (block.timestamp <= pool.state.currentMaturity) {
      return bondsQuantity.wadMul(getTickBondPrice(rate, uint128(pool.state.currentMaturity - block.timestamp)));
    }
    uint256 referenceTimestamp = uint128(block.timestamp);
    if (pool.state.defaultTimestamp > 0) {
      referenceTimestamp = pool.state.defaultTimestamp;
    }
    return bondsQuantity.wadDiv(getTickBondPrice(rate, uint128(referenceTimestamp - pool.state.currentMaturity)));
  }

  /**
   * @dev Deposit to a target tick
   * Updates tick data
   **/
  function depositToTick(
    Types.Pool storage pool,
    uint128 rate,
    uint128 normalizedAmount
  ) public returns (uint128 adjustedAmount, uint128 returnBondsIssuanceIndex) {
    Types.Tick storage tick = pool.ticks[rate];

    pool.collectFees(rate);

    // if there is an ongoing loan, the deposited amount goes to the pending
    // quantity and will be considered for next loan
    if (pool.state.currentMaturity > 0) {
      adjustedAmount = normalizedAmount.wadRayDiv(tick.yieldProviderLiquidityRatio);
      tick.adjustedPendingAmount += adjustedAmount;
      returnBondsIssuanceIndex = pool.state.currentBondsIssuanceIndex + 1;
      emit TickLoanDeposit(pool.parameters.POOL_HASH, rate, adjustedAmount);
    }
    // if there is no ongoing loan, the deposited amount goes to total and remaining
    // amount and can be borrowed instantaneously
    else {
      adjustedAmount = normalizedAmount.wadRayDiv(tick.atlendisLiquidityRatio);
      tick.adjustedTotalAmount += adjustedAmount;
      tick.adjustedRemainingAmount += adjustedAmount;
      returnBondsIssuanceIndex = pool.state.currentBondsIssuanceIndex;
      pool.state.normalizedAvailableDeposits += normalizedAmount;

      // return amount adapted to bond index
      adjustedAmount = adjustedAmount.wadRayDiv(
        pool.getBondIssuanceMultiplierForTick(rate, pool.state.currentBondsIssuanceIndex)
      );
      emit TickNoLoanDeposit(pool.parameters.POOL_HASH, rate, adjustedAmount, tick.atlendisLiquidityRatio);
    }
    if ((pool.state.lowerInterestRate == 0) || (rate < pool.state.lowerInterestRate)) {
      pool.state.lowerInterestRate = rate;
    }
  }

  /**
   * @dev Computes the quantity of bonds purchased, and the equivalent adjusted deposit amount used for the issuance
   **/
  function getBondsIssuanceParametersForTick(
    Types.Pool storage pool,
    uint128 rate,
    uint128 normalizedRemainingAmount
  ) public returns (uint128 bondsPurchasedQuantity, uint128 normalizedUsedAmount) {
    Types.Tick storage tick = pool.ticks[rate];

    if (tick.adjustedRemainingAmount.wadRayMul(tick.atlendisLiquidityRatio) >= normalizedRemainingAmount) {
      normalizedUsedAmount = normalizedRemainingAmount;
    } else if (
      tick.adjustedRemainingAmount.wadRayMul(tick.atlendisLiquidityRatio) + tick.accruedFees >=
      normalizedRemainingAmount
    ) {
      normalizedUsedAmount = normalizedRemainingAmount;
      tick.accruedFees -=
        normalizedRemainingAmount -
        tick.adjustedRemainingAmount.wadRayMul(tick.atlendisLiquidityRatio);
    } else {
      normalizedUsedAmount = tick.adjustedRemainingAmount.wadRayMul(tick.atlendisLiquidityRatio) + tick.accruedFees;
      tick.accruedFees = 0;
    }
    uint128 bondsPurchasePrice = getTickBondPrice(
      rate,
      pool.state.currentMaturity == 0
        ? pool.parameters.LOAN_DURATION
        : pool.state.currentMaturity - uint128(block.timestamp)
    );
    bondsPurchasedQuantity = normalizedUsedAmount.wadDiv(bondsPurchasePrice);
  }

  /**
   * @dev Makes all the state changes necessary to add bonds to a tick
   * Updates tick data and conversion data
   **/
  function addBondsToTick(
    Types.Pool storage pool,
    uint128 rate,
    uint128 bondsIssuedQuantity,
    uint128 normalizedUsedAmountForPurchase
  ) public {
    Types.Tick storage tick = pool.ticks[rate];

    // update global state for tick and pool
    tick.bondsQuantity += bondsIssuedQuantity;
    uint128 adjustedAmountForPurchase = normalizedUsedAmountForPurchase.wadRayDiv(tick.atlendisLiquidityRatio);
    if (adjustedAmountForPurchase > tick.adjustedRemainingAmount) {
      adjustedAmountForPurchase = tick.adjustedRemainingAmount;
    }
    tick.adjustedRemainingAmount -= adjustedAmountForPurchase;
    tick.normalizedLoanedAmount += normalizedUsedAmountForPurchase;
    // emit event with tick updates
    uint128 unborrowedRatio = tick.adjustedRemainingAmount.wadDiv(tick.adjustedTotalAmount);
    emit TickBorrow(
      pool.parameters.POOL_HASH,
      rate,
      adjustedAmountForPurchase,
      normalizedUsedAmountForPurchase,
      tick.atlendisLiquidityRatio,
      unborrowedRatio
    );
    pool.state.bondsIssuedQuantity += bondsIssuedQuantity;
    pool.state.normalizedAvailableDeposits -= normalizedUsedAmountForPurchase;
  }

  /**
   * @dev Computes how the position is split between deposit and bonds
   **/
  function computeAmountRepartitionForTick(
    Types.Pool storage pool,
    uint128 rate,
    uint128 adjustedAmount,
    uint128 bondsIssuanceIndex
  ) public view returns (uint128 bondsQuantity, uint128 adjustedDepositedAmount) {
    Types.Tick storage tick = pool.ticks[rate];

    if (bondsIssuanceIndex > pool.state.currentBondsIssuanceIndex) {
      return (0, adjustedAmount);
    }

    adjustedAmount = adjustedAmount.wadRayMul(pool.getBondIssuanceMultiplierForTick(rate, bondsIssuanceIndex));
    uint128 adjustedAmountUsedForBondsIssuance;
    if (tick.adjustedTotalAmount > 0) {
      adjustedAmountUsedForBondsIssuance = adjustedAmount
        .wadMul(tick.adjustedTotalAmount - tick.adjustedRemainingAmount)
        .wadDiv(tick.adjustedTotalAmount + tick.adjustedWithdrawnAmount);
    }

    if (adjustedAmount >= adjustedAmountUsedForBondsIssuance) {
      if (tick.adjustedTotalAmount > tick.adjustedRemainingAmount) {
        bondsQuantity = tick.bondsQuantity.wadMul(adjustedAmountUsedForBondsIssuance).wadDiv(
          tick.adjustedTotalAmount - tick.adjustedRemainingAmount
        );
      }
      adjustedDepositedAmount = (adjustedAmount - adjustedAmountUsedForBondsIssuance);
    } else {
      /**
       * This condition is obtained when precision problems occur in the computation of `adjustedAmountUsedForBondsIssuance`.
       * Such problems have been observed when dealing with amounts way lower than a WAD.
       * In this case, the remaining and withdrawn amounts are assumed at 0.
       * Therefore, the deposited amount is returned as 0 and the bonds quantity is computed using only the adjusted total amount.
       */
      bondsQuantity = tick.bondsQuantity.wadMul(adjustedAmount).wadDiv(tick.adjustedTotalAmount);
      adjustedDepositedAmount = 0;
    }
  }

  /**
   * @dev Updates tick data after a withdrawal consisting of only amount deposited to yield provider
   **/
  function withdrawDepositedAmountForTick(
    Types.Pool storage pool,
    uint128 rate,
    uint128 adjustedAmountToWithdraw,
    uint128 bondsIssuanceIndex
  ) public returns (uint128 normalizedAmountToWithdraw) {
    Types.Tick storage tick = pool.ticks[rate];

    pool.collectFees(rate);

    if (bondsIssuanceIndex <= pool.state.currentBondsIssuanceIndex) {
      uint128 feesShareToWithdraw = pool.getAccruedFeesShare(rate, adjustedAmountToWithdraw);
      tick.accruedFees -= feesShareToWithdraw;
      tick.adjustedTotalAmount -= adjustedAmountToWithdraw;
      tick.adjustedRemainingAmount -= adjustedAmountToWithdraw;

      normalizedAmountToWithdraw =
        adjustedAmountToWithdraw.wadRayMul(tick.atlendisLiquidityRatio) +
        feesShareToWithdraw;
      pool.state.normalizedAvailableDeposits -= normalizedAmountToWithdraw.round();

      // register withdrawn amount from partially matched positions
      // to maintain the proportion of bonds in each subsequent position the same
      if (tick.bondsQuantity > 0) {
        tick.adjustedWithdrawnAmount += adjustedAmountToWithdraw;
      }
      emit TickWithdrawRemaining(
        pool.parameters.POOL_HASH,
        rate,
        adjustedAmountToWithdraw,
        tick.atlendisLiquidityRatio,
        feesShareToWithdraw
      );
    } else {
      tick.adjustedPendingAmount -= adjustedAmountToWithdraw;
      normalizedAmountToWithdraw = adjustedAmountToWithdraw.wadRayMul(tick.yieldProviderLiquidityRatio);
      emit TickWithdrawPending(pool.parameters.POOL_HASH, rate, adjustedAmountToWithdraw);
    }

    // update lowerInterestRate if necessary
    if ((rate == pool.state.lowerInterestRate) && tick.adjustedTotalAmount == 0) {
      uint128 nextRate = rate + pool.parameters.RATE_SPACING;
      while (nextRate <= pool.parameters.MAX_RATE && pool.ticks[nextRate].adjustedTotalAmount == 0) {
        nextRate += pool.parameters.RATE_SPACING;
      }
      if (nextRate >= pool.parameters.MAX_RATE) {
        pool.state.lowerInterestRate = 0;
      } else {
        pool.state.lowerInterestRate = nextRate;
      }
    }
  }

  /**
   * @dev Updates tick data after a repayment
   **/
  function repayForTick(
    Types.Pool storage pool,
    uint128 rate,
    uint128 lateRepayFeePerBond
  ) public returns (uint128 normalizedRepayAmountForTick, uint128 lateRepayFeeForTick) {
    Types.Tick storage tick = pool.ticks[rate];

    if (tick.bondsQuantity > 0) {
      normalizedRepayAmountForTick = getTimeValue(pool, tick.bondsQuantity, rate);
      lateRepayFeeForTick = lateRepayFeePerBond.wadMul(normalizedRepayAmountForTick);
      uint128 bondPaidInterests = normalizedRepayAmountForTick - tick.normalizedLoanedAmount;
      // update liquidity ratio with interests from bonds, yield provider and liquidity rewards
      tick.atlendisLiquidityRatio += (tick.accruedFees + bondPaidInterests + lateRepayFeeForTick)
        .wadDiv(tick.adjustedTotalAmount)
        .wadToRay();

      // update tick amounts
      tick.bondsQuantity = 0;
      tick.adjustedWithdrawnAmount = 0;
      tick.normalizedLoanedAmount = 0;
      tick.accruedFees = 0;
      tick.adjustedRemainingAmount = tick.adjustedTotalAmount;
      emit TickRepay(pool.parameters.POOL_HASH, rate, tick.adjustedTotalAmount, tick.atlendisLiquidityRatio);
    }
  }

  /**
   * @dev Updates tick data after a repayment
   **/
  function includePendingDepositsForTick(
    Types.Pool storage pool,
    uint128 rate,
    bool bondsIssuanceIndexAlreadyIncremented
  ) internal returns (bool pendingDepositsExist) {
    Types.Tick storage tick = pool.ticks[rate];

    if (tick.adjustedPendingAmount > 0) {
      if (!bondsIssuanceIndexAlreadyIncremented) {
        pool.state.currentBondsIssuanceIndex += 1;
      }
      // include pending deposit amount into tick excluding them from bonds interest from current issuance
      tick.bondsIssuanceIndexMultiplier[pool.state.currentBondsIssuanceIndex] = pool
        .state
        .yieldProviderLiquidityRatio
        .rayDiv(tick.atlendisLiquidityRatio);
      uint128 adjustedPendingAmount = tick.adjustedPendingAmount.wadRayMul(
        tick.bondsIssuanceIndexMultiplier[pool.state.currentBondsIssuanceIndex]
      );

      // update global pool state
      pool.state.normalizedAvailableDeposits += tick.adjustedPendingAmount.wadRayMul(
        pool.state.yieldProviderLiquidityRatio
      );

      // update tick amounts
      tick.adjustedTotalAmount += adjustedPendingAmount;
      tick.adjustedRemainingAmount = tick.adjustedTotalAmount;
      tick.adjustedPendingAmount = 0;
      emit TickPendingDeposit(
        pool.parameters.POOL_HASH,
        rate,
        adjustedPendingAmount,
        !bondsIssuanceIndexAlreadyIncremented
      );
      return true;
    }
    return false;
  }

  /**
   * @dev Top up liquidity rewards for later distribution
   **/
  function topUpLiquidityRewards(Types.Pool storage pool, uint128 normalizedAmount)
    public
    returns (uint128 yieldProviderLiquidityRatio)
  {
    yieldProviderLiquidityRatio = uint128(
      pool.parameters.YIELD_PROVIDER.getReserveNormalizedIncome(address(pool.parameters.UNDERLYING_TOKEN))
    );
    pool.state.remainingAdjustedLiquidityRewardsReserve += normalizedAmount.wadRayDiv(yieldProviderLiquidityRatio);
  }

  /**
   * @dev Distributes remaining liquidity rewards reserve to lenders
   * Called in case of pool default
   **/
  function distributeLiquidityRewards(Types.Pool storage pool) public returns (uint128 distributedLiquidityRewards) {
    uint128 currentInterestRate = pool.state.lowerInterestRate;

    uint128 yieldProviderLiquidityRatio = uint128(
      pool.parameters.YIELD_PROVIDER.getReserveNormalizedIncome(address(pool.parameters.UNDERLYING_TOKEN))
    );

    distributedLiquidityRewards = pool.state.remainingAdjustedLiquidityRewardsReserve.wadRayMul(
      yieldProviderLiquidityRatio
    );
    pool.state.normalizedAvailableDeposits += distributedLiquidityRewards;
    pool.state.remainingAdjustedLiquidityRewardsReserve = 0;

    while (pool.ticks[currentInterestRate].bondsQuantity > 0 && currentInterestRate <= pool.parameters.MAX_RATE) {
      pool.ticks[currentInterestRate].accruedFees += distributedLiquidityRewards
        .wadMul(pool.ticks[currentInterestRate].bondsQuantity)
        .wadDiv(pool.state.bondsIssuedQuantity);
      currentInterestRate += pool.parameters.RATE_SPACING;
    }
  }

  /**
   * @dev Updates tick data to reflect all fees accrued since last call
   * Accrued fees are composed of the yield provider liquidity ratio increase
   * and liquidity rewards paid by the borrower
   **/
  function collectFeesForTick(
    Types.Pool storage pool,
    uint128 rate,
    uint128 yieldProviderLiquidityRatio
  ) internal {
    Types.Tick storage tick = pool.ticks[rate];
    if (tick.lastFeeDistributionTimestamp < block.timestamp) {
      (
        uint128 updatedAtlendisLiquidityRatio,
        uint128 updatedAccruedFees,
        uint128 liquidityRewardsIncrease,
        uint128 yieldProviderLiquidityRatioIncrease
      ) = pool.peekFeesForTick(rate, yieldProviderLiquidityRatio);

      // update global deposited amount
      pool.state.remainingAdjustedLiquidityRewardsReserve -= liquidityRewardsIncrease.wadRayDiv(
        yieldProviderLiquidityRatio
      );
      pool.state.normalizedAvailableDeposits +=
        liquidityRewardsIncrease +
        tick.adjustedRemainingAmount.wadRayMul(yieldProviderLiquidityRatioIncrease);

      // update tick data
      uint128 accruedFeesIncrease = updatedAccruedFees - tick.accruedFees;
      if (tick.atlendisLiquidityRatio == 0) {
        tick.yieldProviderLiquidityRatio = yieldProviderLiquidityRatio;
        emit TickInitialized(pool.parameters.POOL_HASH, rate, yieldProviderLiquidityRatio);
      }
      tick.atlendisLiquidityRatio = updatedAtlendisLiquidityRatio;
      tick.accruedFees = updatedAccruedFees;

      // update checkpoint data
      tick.lastFeeDistributionTimestamp = uint128(block.timestamp);

      emit CollectFeesForTick(
        pool.parameters.POOL_HASH,
        rate,
        pool.state.remainingAdjustedLiquidityRewardsReserve.wadRayMul(yieldProviderLiquidityRatio),
        accruedFeesIncrease
      );
    }
  }

  function collectFees(Types.Pool storage pool, uint128 rate) internal {
    uint128 yieldProviderLiquidityRatio = uint128(
      pool.parameters.YIELD_PROVIDER.getReserveNormalizedIncome(address(pool.parameters.UNDERLYING_TOKEN))
    );
    pool.collectFeesForTick(rate, yieldProviderLiquidityRatio);
    pool.ticks[rate].yieldProviderLiquidityRatio = yieldProviderLiquidityRatio;
  }

  function collectFees(Types.Pool storage pool) internal {
    uint128 yieldProviderLiquidityRatio = uint128(
      pool.parameters.YIELD_PROVIDER.getReserveNormalizedIncome(address(pool.parameters.UNDERLYING_TOKEN))
    );
    for (
      uint128 currentInterestRate = pool.state.lowerInterestRate;
      currentInterestRate <= pool.parameters.MAX_RATE;
      currentInterestRate += pool.parameters.RATE_SPACING
    ) {
      pool.collectFeesForTick(currentInterestRate, yieldProviderLiquidityRatio);
    }
    pool.state.yieldProviderLiquidityRatio = yieldProviderLiquidityRatio;
  }

  /**
   * @dev Peek updated liquidity ratio and accrued fess for the target tick
   * Used to compute a position balance without updating storage
   **/
  function peekFeesForTick(
    Types.Pool storage pool,
    uint128 rate,
    uint128 yieldProviderLiquidityRatio
  )
    internal
    view
    returns (
      uint128 updatedAtlendisLiquidityRatio,
      uint128 updatedAccruedFees,
      uint128 liquidityRewardsIncrease,
      uint128 yieldProviderLiquidityRatioIncrease
    )
  {
    Types.Tick storage tick = pool.ticks[rate];

    if (tick.atlendisLiquidityRatio == 0) {
      return (yieldProviderLiquidityRatio, 0, 0, 0);
    }

    updatedAtlendisLiquidityRatio = tick.atlendisLiquidityRatio;
    updatedAccruedFees = tick.accruedFees;

    uint128 referenceLiquidityRatio;
    if (pool.state.yieldProviderLiquidityRatio > tick.yieldProviderLiquidityRatio) {
      referenceLiquidityRatio = pool.state.yieldProviderLiquidityRatio;
    } else {
      referenceLiquidityRatio = tick.yieldProviderLiquidityRatio;
    }
    yieldProviderLiquidityRatioIncrease = yieldProviderLiquidityRatio - referenceLiquidityRatio;

    // get additional fees from liquidity rewards
    liquidityRewardsIncrease = pool.getLiquidityRewardsIncrease(rate);
    uint128 currentNormalizedRemainingLiquidityRewards = pool.state.remainingAdjustedLiquidityRewardsReserve.wadRayMul(
      yieldProviderLiquidityRatio
    );
    if (liquidityRewardsIncrease > currentNormalizedRemainingLiquidityRewards) {
      liquidityRewardsIncrease = currentNormalizedRemainingLiquidityRewards;
    }
    // if no ongoing loan, all deposited amount gets the yield provider
    // and liquidity rewards so the global liquidity ratio is updated
    if (pool.state.currentMaturity == 0) {
      updatedAtlendisLiquidityRatio += yieldProviderLiquidityRatioIncrease;
      if (tick.adjustedRemainingAmount > 0) {
        updatedAtlendisLiquidityRatio += liquidityRewardsIncrease.wadToRay().wadDiv(tick.adjustedRemainingAmount);
      }
    }
    // if ongoing loan, accruing fees components are added, liquidity ratio will be updated at repay time
    else {
      updatedAccruedFees +=
        tick.adjustedRemainingAmount.wadRayMul(yieldProviderLiquidityRatioIncrease) +
        liquidityRewardsIncrease;
    }
  }

  /**
   * @dev Computes liquidity rewards amount to be paid to lenders since last fee collection
   * Liquidity rewards are paid to the unborrowed amount, and distributed to all ticks depending
   * on their normalized amounts
   **/
  function getLiquidityRewardsIncrease(Types.Pool storage pool, uint128 rate)
    internal
    view
    returns (uint128 liquidityRewardsIncrease)
  {
    Types.Tick storage tick = pool.ticks[rate];
    if (pool.state.normalizedAvailableDeposits > 0) {
      liquidityRewardsIncrease = (pool.parameters.LIQUIDITY_REWARDS_DISTRIBUTION_RATE *
        (uint128(block.timestamp) - tick.lastFeeDistributionTimestamp))
        .wadMul(pool.parameters.MAX_BORROWABLE_AMOUNT - pool.state.normalizedBorrowedAmount)
        .wadDiv(pool.parameters.MAX_BORROWABLE_AMOUNT)
        .wadMul(tick.adjustedRemainingAmount.wadRayMul(tick.atlendisLiquidityRatio))
        .wadDiv(pool.state.normalizedAvailableDeposits);
    }
  }

  function getTickBondPrice(uint128 rate, uint128 loanDuration) internal pure returns (uint128 price) {
    price = uint128(WAD).wadDiv(uint128(WAD + (uint256(rate) * uint256(loanDuration)) / uint256(SECONDS_PER_YEAR)));
  }

  function depositToYieldProvider(
    Types.Pool storage pool,
    address from,
    uint128 normalizedAmount
  ) public {
    IERC20Upgradeable underlyingToken = IERC20Upgradeable(pool.parameters.UNDERLYING_TOKEN);
    uint128 scaledAmount = normalizedAmount.scaleFromWad(pool.parameters.TOKEN_DECIMALS);
    ILendingPool yieldProvider = pool.parameters.YIELD_PROVIDER;
    underlyingToken.safeIncreaseAllowance(address(yieldProvider), scaledAmount);
    underlyingToken.safeTransferFrom(from, address(this), scaledAmount);
    yieldProvider.deposit(pool.parameters.UNDERLYING_TOKEN, scaledAmount, address(this), 0);
  }
}

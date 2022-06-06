// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

import {PoolLogic} from "./lib/PoolLogic.sol";
import {Scaling} from "./lib/Scaling.sol";
import {Uint128WadRayMath} from "./lib/Uint128WadRayMath.sol";

import "./extensions/AaveILendingPool.sol";
import "./extensions/IERC20PartialDecimals.sol";
import "./lib/Errors.sol";
import "./lib/Roles.sol";
import "./lib/Types.sol";

import "./interfaces/IPoolsController.sol";

abstract contract PoolsController is AccessControlUpgradeable, PausableUpgradeable, IPoolsController {
  using PoolLogic for Types.Pool;
  using Scaling for uint128;
  using Uint128WadRayMath for uint128;

  // borrower address to pool hash
  mapping(address => bytes32) public borrowerAuthorizedPools;

  // interest rate pool
  mapping(bytes32 => Types.Pool) internal pools;

  // protocol fees per pool
  mapping(bytes32 => uint128) internal protocolFees;

  function _initialize() internal onlyInitializing {
    // both initializers below are called to comply with OpenZeppelin's
    // recommendations even if in practice they don't do anything
    __AccessControl_init();
    __Pausable_init_unchained();
  }

  // VIEW FUNCTIONS

  /**
   * @notice Returns the parameters of a pool
   * @param poolHash The identifier of the pool
   * @return underlyingToken Address of the underlying token of the pool
   * @return minRate Minimum rate of deposits accepted in the pool
   * @return maxRate Maximum rate of deposits accepted in the pool
   * @return rateSpacing Difference between two rates in the pool
   * @return maxBorrowableAmount Maximum amount of tokens that can be borrowed from the pool
   * @return loanDuration Duration of a loan in the pool
   * @return liquidityRewardsDistributionRate Rate at which liquidity rewards are distributed to lenders
   * @return cooldownPeriod Period after a loan during which a borrower cannot take another loan
   * @return repaymentPeriod Period after a loan end during which a borrower can repay without penalty
   * @return lateRepayFeePerBondRate Penalty a borrower has to pay when it repays late
   * @return liquidityRewardsActivationThreshold Minimum amount of liqudity rewards a borrower has to
   * deposit to active the pool
   **/
  function getPoolParameters(bytes32 poolHash)
    external
    view
    override
    returns (
      address underlyingToken,
      uint128 minRate,
      uint128 maxRate,
      uint128 rateSpacing,
      uint128 maxBorrowableAmount,
      uint128 loanDuration,
      uint128 liquidityRewardsDistributionRate,
      uint128 cooldownPeriod,
      uint128 repaymentPeriod,
      uint128 lateRepayFeePerBondRate,
      uint128 liquidityRewardsActivationThreshold
    )
  {
    Types.PoolParameters storage poolParameters = pools[poolHash].parameters;
    return (
      poolParameters.UNDERLYING_TOKEN,
      poolParameters.MIN_RATE,
      poolParameters.MAX_RATE,
      poolParameters.RATE_SPACING,
      poolParameters.MAX_BORROWABLE_AMOUNT,
      poolParameters.LOAN_DURATION,
      poolParameters.LIQUIDITY_REWARDS_DISTRIBUTION_RATE,
      poolParameters.COOLDOWN_PERIOD,
      poolParameters.REPAYMENT_PERIOD,
      poolParameters.LATE_REPAY_FEE_PER_BOND_RATE,
      poolParameters.LIQUIDITY_REWARDS_ACTIVATION_THRESHOLD
    );
  }

  /**
   * @notice Returns the fee rates of a pool
   * @return establishmentFeeRate Amount of fees paid to the protocol at borrow time
   * @return repaymentFeeRate Amount of fees paid to the protocol at repay time
   **/
  function getPoolFeeRates(bytes32 poolHash)
    external
    view
    override
    returns (uint128 establishmentFeeRate, uint128 repaymentFeeRate)
  {
    Types.PoolParameters storage poolParameters = pools[poolHash].parameters;
    return (poolParameters.ESTABLISHMENT_FEE_RATE, poolParameters.REPAYMENT_FEE_RATE);
  }

  /**
   * @notice Returns the state of a pool
   * @param poolHash The identifier of the pool
   * @return active Signals if a pool is active and ready to accept deposits
   * @return defaulted Signals if a pool was defaulted
   * @return closed Signals if a pool was closed
   * @return currentMaturity End timestamp of current loan
   * @return bondsIssuedQuantity Amount of bonds issued, to be repaid at maturity
   * @return normalizedBorrowedAmount Actual amount of tokens that were borrowed
   * @return normalizedAvailableDeposits Actual amount of tokens available to be borrowed
   * @return lowerInterestRate Minimum rate at which a deposit was made
   * @return nextLoanMinStart Cool down period, minimum timestamp after which a new loan can be taken
   * @return remainingAdjustedLiquidityRewardsReserve Remaining liquidity rewards to be distributed to lenders
   * @return yieldProviderLiquidityRatio Last recorded yield provider liquidity ratio
   * @return currentBondsIssuanceIndex Current borrow period identifier of the pool
   **/
  function getPoolState(bytes32 poolHash)
    external
    view
    override
    returns (
      bool active,
      bool defaulted,
      bool closed,
      uint128 currentMaturity,
      uint128 bondsIssuedQuantity,
      uint128 normalizedBorrowedAmount,
      uint128 normalizedAvailableDeposits,
      uint128 lowerInterestRate,
      uint128 nextLoanMinStart,
      uint128 remainingAdjustedLiquidityRewardsReserve,
      uint128 yieldProviderLiquidityRatio,
      uint128 currentBondsIssuanceIndex
    )
  {
    Types.PoolState storage poolState = pools[poolHash].state;
    return (
      poolState.active,
      poolState.defaulted,
      poolState.closed,
      poolState.currentMaturity,
      poolState.bondsIssuedQuantity,
      poolState.normalizedBorrowedAmount,
      poolState.normalizedAvailableDeposits,
      poolState.lowerInterestRate,
      poolState.nextLoanMinStart,
      poolState.remainingAdjustedLiquidityRewardsReserve,
      poolState.yieldProviderLiquidityRatio,
      poolState.currentBondsIssuanceIndex
    );
  }

  /**
   * @notice Returns the state of a pool
   * @return earlyRepay Flag that signifies whether the early repay feature is activated or not
   **/
  function isEarlyRepay(bytes32 poolHash) external view override returns (bool earlyRepay) {
    return pools[poolHash].parameters.EARLY_REPAY;
  }

  /**
   * @notice Returns the state of a pool
   * @return defaultTimestamp The timestamp at which the pool was defaulted
   **/
  function getDefaultTimestamp(bytes32 poolHash) external view override returns (uint128 defaultTimestamp) {
    return pools[poolHash].state.defaultTimestamp;
  }

  // PROTOCOL MANAGEMENT

  function getProtocolFees(bytes32 poolHash) public view returns (uint128) {
    return protocolFees[poolHash].scaleFromWad(pools[poolHash].parameters.TOKEN_DECIMALS);
  }

  /**
   * @notice Withdraws protocol fees to a target address
   * @param poolHash The identifier of the pool
   * @param amount The amount of tokens claimed
   * @param to The address receiving the fees
   **/
  function claimProtocolFees(
    bytes32 poolHash,
    uint128 amount,
    address to
  ) external override onlyRole(Roles.GOVERNANCE_ROLE) {
    uint128 normalizedAmount = amount.scaleToWad(pools[poolHash].parameters.TOKEN_DECIMALS);
    if (pools[poolHash].parameters.POOL_HASH != poolHash) {
      revert Errors.PC_POOL_NOT_ACTIVE();
    }

    if (normalizedAmount > protocolFees[poolHash]) {
      revert Errors.PC_NOT_ENOUGH_PROTOCOL_FEES();
    }

    protocolFees[poolHash] -= normalizedAmount;
    pools[poolHash].parameters.YIELD_PROVIDER.withdraw(pools[poolHash].parameters.UNDERLYING_TOKEN, amount, to);

    emit ClaimProtocolFees(poolHash, normalizedAmount, to);
  }

  /**
   * @notice Stops all actions on all pools
   **/
  function freezePool() external override onlyRole(Roles.GOVERNANCE_ROLE) {
    _pause();
  }

  /**
   * @notice Cancel a freeze, makes actions available again on all pools
   **/
  function unfreezePool() external override onlyRole(Roles.GOVERNANCE_ROLE) {
    _unpause();
  }

  // BORROWER MANAGEMENT
  /**
   * @notice Creates a new pool
   * @param params The parameters of the new pool
   **/
  function createNewPool(PoolCreationParams calldata params) external override onlyRole(Roles.GOVERNANCE_ROLE) {
    // run verifications on parameters value
    verifyPoolCreationParameters(params);

    // initialize pool state and parameters
    pools[params.poolHash].parameters = Types.PoolParameters({
      POOL_HASH: params.poolHash,
      UNDERLYING_TOKEN: params.underlyingToken,
      TOKEN_DECIMALS: IERC20PartialDecimals(params.underlyingToken).decimals(),
      YIELD_PROVIDER: params.yieldProvider,
      MIN_RATE: params.minRate,
      MAX_RATE: params.maxRate,
      RATE_SPACING: params.rateSpacing,
      MAX_BORROWABLE_AMOUNT: params.maxBorrowableAmount,
      LOAN_DURATION: params.loanDuration,
      LIQUIDITY_REWARDS_DISTRIBUTION_RATE: params.distributionRate,
      COOLDOWN_PERIOD: params.cooldownPeriod,
      REPAYMENT_PERIOD: params.repaymentPeriod,
      LATE_REPAY_FEE_PER_BOND_RATE: params.lateRepayFeePerBondRate,
      ESTABLISHMENT_FEE_RATE: params.establishmentFeeRate,
      REPAYMENT_FEE_RATE: params.repaymentFeeRate,
      LIQUIDITY_REWARDS_ACTIVATION_THRESHOLD: params.liquidityRewardsActivationThreshold,
      EARLY_REPAY: params.earlyRepay
    });

    pools[params.poolHash].state.yieldProviderLiquidityRatio = uint128(
      params.yieldProvider.getReserveNormalizedIncome(address(params.underlyingToken))
    );

    emit PoolCreated(params);

    if (pools[params.poolHash].parameters.LIQUIDITY_REWARDS_ACTIVATION_THRESHOLD == 0) {
      pools[params.poolHash].state.active = true;
      emit PoolActivated(pools[params.poolHash].parameters.POOL_HASH);
    }
  }

  /**
   * @notice Verifies that conditions to create a new pool are met
   * @param params The parameters of the new pool
   **/
  function verifyPoolCreationParameters(PoolCreationParams calldata params) internal view {
    if ((params.maxRate - params.minRate) % params.rateSpacing != 0) {
      revert Errors.PC_RATE_SPACING_COMPLIANCE();
    }
    if (params.poolHash == bytes32(0)) {
      revert Errors.PC_ZERO_POOL();
    }
    if (pools[params.poolHash].parameters.POOL_HASH != bytes32(0)) {
      revert Errors.PC_POOL_ALREADY_SET_FOR_BORROWER();
    }
    uint256 yieldProviderLiquidityRatio = params.yieldProvider.getReserveNormalizedIncome(params.underlyingToken);
    if (yieldProviderLiquidityRatio < PoolLogic.RAY) {
      revert Errors.PC_POOL_TOKEN_NOT_SUPPORTED();
    }
    if (params.establishmentFeeRate > PoolLogic.WAD) {
      revert Errors.PC_ESTABLISHMENT_FEES_TOO_HIGH();
    }
  }

  /**
   * @notice Allow an address to interact with a borrower pool
   * @param borrowerAddress The address to allow
   * @param poolHash The identifier of the pool
   **/
  function allow(address borrowerAddress, bytes32 poolHash) external override onlyRole(Roles.GOVERNANCE_ROLE) {
    if (poolHash == bytes32(0)) {
      revert Errors.PC_ZERO_POOL();
    }
    if (borrowerAddress == address(0)) {
      revert Errors.PC_ZERO_ADDRESS();
    }
    if (pools[poolHash].parameters.POOL_HASH != poolHash) {
      revert Errors.PC_POOL_NOT_ACTIVE();
    }
    if (borrowerAuthorizedPools[borrowerAddress] != bytes32(0)) {
      revert Errors.PC_BORROWER_ALREADY_AUTHORIZED();
    }
    grantRole(Roles.BORROWER_ROLE, borrowerAddress);
    borrowerAuthorizedPools[borrowerAddress] = poolHash;
    emit BorrowerAllowed(borrowerAddress, poolHash);
  }

  /**
   * @notice Remove borrower pool interaction rights from an address
   * @param borrowerAddress The address to disallow
   * @param poolHash The identifier of the pool
   **/
  function disallow(address borrowerAddress, bytes32 poolHash) external override onlyRole(Roles.GOVERNANCE_ROLE) {
    if (poolHash == bytes32(0)) {
      revert Errors.PC_ZERO_POOL();
    }
    if (borrowerAddress == address(0)) {
      revert Errors.PC_ZERO_ADDRESS();
    }
    if (pools[poolHash].parameters.POOL_HASH != poolHash) {
      revert Errors.PC_POOL_NOT_ACTIVE();
    }
    if (borrowerAuthorizedPools[borrowerAddress] != poolHash) {
      revert Errors.PC_DISALLOW_UNMATCHED_BORROWER();
    }
    revokeRole(Roles.BORROWER_ROLE, borrowerAddress);
    delete borrowerAuthorizedPools[borrowerAddress];
    emit BorrowerDisallowed(borrowerAddress, poolHash);
  }

  /**
   * @notice Flags the pool as closed
   * @param poolHash The identifier of the pool
   **/
  function closePool(bytes32 poolHash, address to) external override onlyRole(Roles.GOVERNANCE_ROLE) {
    if (poolHash == bytes32(0)) {
      revert Errors.PC_ZERO_POOL();
    }
    if (to == address(0)) {
      revert Errors.PC_ZERO_ADDRESS();
    }
    Types.Pool storage pool = pools[poolHash];
    if (pool.parameters.POOL_HASH != poolHash) {
      revert Errors.PC_POOL_NOT_ACTIVE();
    }
    if (pool.state.closed) {
      revert Errors.PC_POOL_ALREADY_CLOSED();
    }
    pool.state.closed = true;

    uint128 remainingNormalizedLiquidityRewardsReserve = 0;
    if (pool.state.remainingAdjustedLiquidityRewardsReserve > 0) {
      uint128 yieldProviderLiquidityRatio = uint128(
        pool.parameters.YIELD_PROVIDER.getReserveNormalizedIncome(address(pool.parameters.UNDERLYING_TOKEN))
      );
      remainingNormalizedLiquidityRewardsReserve = pool.state.remainingAdjustedLiquidityRewardsReserve.wadRayMul(
        yieldProviderLiquidityRatio
      );

      pool.state.remainingAdjustedLiquidityRewardsReserve = 0;
      pool.parameters.YIELD_PROVIDER.withdraw(
        pools[poolHash].parameters.UNDERLYING_TOKEN,
        remainingNormalizedLiquidityRewardsReserve.scaleFromWad(pool.parameters.TOKEN_DECIMALS),
        to
      );
    }
    emit PoolClosed(poolHash, remainingNormalizedLiquidityRewardsReserve);
  }

  /**
   * @notice Flags the pool as defaulted
   * @param poolHash The identifier of the pool to default
   **/
  function setDefault(bytes32 poolHash) external override onlyRole(Roles.GOVERNANCE_ROLE) {
    Types.Pool storage pool = pools[poolHash];
    if (pool.state.defaulted) {
      revert Errors.PC_POOL_DEFAULTED();
    }
    if (pool.state.currentMaturity == 0) {
      revert Errors.PC_NO_ONGOING_LOAN();
    }
    if (block.timestamp < pool.state.currentMaturity + pool.parameters.REPAYMENT_PERIOD) {
      revert Errors.PC_REPAYMENT_PERIOD_ONGOING();
    }

    pool.state.defaulted = true;
    pool.state.defaultTimestamp = uint128(block.timestamp);
    uint128 distributedLiquidityRewards = pool.distributeLiquidityRewards();

    emit Default(poolHash, distributedLiquidityRewards);
  }

  // POOL PARAMETERS MANAGEMENT
  /**
   * @notice Set the maximum amount of tokens that can be borrowed in the target pool
   **/
  function setMaxBorrowableAmount(uint128 maxBorrowableAmount, bytes32 poolHash)
    external
    override
    onlyRole(Roles.GOVERNANCE_ROLE)
  {
    if (pools[poolHash].parameters.POOL_HASH != poolHash) {
      revert Errors.PC_POOL_NOT_ACTIVE();
    }
    pools[poolHash].parameters.MAX_BORROWABLE_AMOUNT = maxBorrowableAmount;

    emit SetMaxBorrowableAmount(maxBorrowableAmount, poolHash);
  }

  /**
   * @notice Set the pool liquidity rewards distribution rate
   **/
  function setLiquidityRewardsDistributionRate(uint128 distributionRate, bytes32 poolHash)
    external
    override
    onlyRole(Roles.GOVERNANCE_ROLE)
  {
    if (pools[poolHash].parameters.POOL_HASH != poolHash) {
      revert Errors.PC_POOL_NOT_ACTIVE();
    }
    pools[poolHash].parameters.LIQUIDITY_REWARDS_DISTRIBUTION_RATE = distributionRate;

    emit SetLiquidityRewardsDistributionRate(distributionRate, poolHash);
  }

  /**
   * @notice Set the pool establishment protocol fee rate
   **/
  function setEstablishmentFeeRate(uint128 establishmentFeeRate, bytes32 poolHash)
    external
    override
    onlyRole(Roles.GOVERNANCE_ROLE)
  {
    if (!pools[poolHash].state.active) {
      revert Errors.PC_POOL_NOT_ACTIVE();
    }
    if (establishmentFeeRate > PoolLogic.WAD) {
      revert Errors.PC_ESTABLISHMENT_FEES_TOO_HIGH();
    }

    pools[poolHash].parameters.ESTABLISHMENT_FEE_RATE = establishmentFeeRate;

    emit SetEstablishmentFeeRate(establishmentFeeRate, poolHash);
  }

  /**
   * @notice Set the pool repayment protocol fee rate
   **/
  function setRepaymentFeeRate(uint128 repaymentFeeRate, bytes32 poolHash)
    external
    override
    onlyRole(Roles.GOVERNANCE_ROLE)
  {
    if (!pools[poolHash].state.active) {
      revert Errors.PC_POOL_NOT_ACTIVE();
    }

    pools[poolHash].parameters.REPAYMENT_FEE_RATE = repaymentFeeRate;

    emit SetRepaymentFeeRate(repaymentFeeRate, poolHash);
  }
}

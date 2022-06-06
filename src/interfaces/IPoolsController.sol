// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "../lib/Types.sol";

/**
 * @title IPoolsController
 * @notice Management of the pools
 **/
interface IPoolsController {
  // EVENTS

  /**
   * @notice Emitted after a pool was creted
   **/
  event PoolCreated(PoolCreationParams params);

  /**
   * @notice Emitted after a borrower address was allowed to borrow from a pool
   * @param borrowerAddress The address to allow
   * @param poolHash The identifier of the pool
   **/
  event BorrowerAllowed(address borrowerAddress, bytes32 poolHash);

  /**
   * @notice Emitted after a borrower address was disallowed to borrow from a pool
   * @param borrowerAddress The address to disallow
   * @param poolHash The identifier of the pool
   **/
  event BorrowerDisallowed(address borrowerAddress, bytes32 poolHash);

  /**
   * @notice Emitted when a pool is active, i.e. after the borrower deposits enough tokens
   * in its pool liquidity rewards reserve as agreed before the pool creation
   * @param poolHash The identifier of the pool
   **/
  event PoolActivated(bytes32 poolHash);

  /**
   * @notice Emitted after pool is closed
   * @param poolHash The identifier of the pool
   * @param collectedLiquidityRewards The amount of liquidity rewards to have been collected at closing time
   **/
  event PoolClosed(bytes32 poolHash, uint128 collectedLiquidityRewards);

  /**
   * @notice Emitted when a pool defaults on its loan repayment
   * @param poolHash The identifier of the pool
   * @param distributedLiquidityRewards The remaining liquidity rewards distributed to
   * bond holders
   **/
  event Default(bytes32 poolHash, uint128 distributedLiquidityRewards);

  /**
   * @notice Emitted after governance sets the maximum borrowable amount for a pool
   **/
  event SetMaxBorrowableAmount(uint128 maxTokenDeposit, bytes32 poolHash);

  /**
   * @notice Emitted after governance sets the liquidity rewards distribution rate for a pool
   **/
  event SetLiquidityRewardsDistributionRate(uint128 distributionRate, bytes32 poolHash);

  /**
   * @notice Emitted after governance sets the establishment fee for a pool
   **/
  event SetEstablishmentFeeRate(uint128 establishmentRate, bytes32 poolHash);

  /**
   * @notice Emitted after governance sets the repayment fee for a pool
   **/
  event SetRepaymentFeeRate(uint128 repaymentFeeRate, bytes32 poolHash);

  /**
   * @notice Emitted after governance claims the fees associated with a pool
   * @param poolHash The identifier of the pool
   * @param normalizedAmount The amount of tokens claimed
   * @param to The address receiving the fees
   **/
  event ClaimProtocolFees(bytes32 poolHash, uint128 normalizedAmount, address to);

  // VIEW METHODS

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
    );

  /**
   * @notice Returns the fee rates of a pool
   * @return establishmentFeeRate Amount of fees paid to the protocol at borrow time
   * @return repaymentFeeRate Amount of fees paid to the protocol at repay time
   **/
  function getPoolFeeRates(bytes32 poolHash)
    external
    view
    returns (uint128 establishmentFeeRate, uint128 repaymentFeeRate);

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
    );

  /**
   * @notice Signals whether the early repay feature is activated or not
   * @return earlyRepay Flag that signifies whether the early repay feature is activated or not
   **/
  function isEarlyRepay(bytes32 poolHash) external view returns (bool earlyRepay);

  /**
   * @notice Returns the state of a pool
   * @return defaultTimestamp The timestamp at which the pool was defaulted
   **/
  function getDefaultTimestamp(bytes32 poolHash) external view returns (uint128 defaultTimestamp);

  // GOVERNANCE METHODS

  /**
   * @notice Parameters used for a pool creation
   * @param poolHash The identifier of the pool
   * @param underlyingToken Address of the pool underlying token
   * @param yieldProvider Yield provider of the pool
   * @param minRate Minimum bidding rate for the pool
   * @param maxRate Maximum bidding rate for the pool
   * @param rateSpacing Difference between two tick rates in the pool
   * @param maxBorrowableAmount Maximum amount of tokens a borrower can get from a pool
   * @param loanDuration Duration of a loan i.e. maturity of the issued bonds
   * @param distributionRate Rate at which the liquidity rewards are distributed to unmatched positions
   * @param cooldownPeriod Period of time after a repay during which the borrow cannot take a loan
   * @param repaymentPeriod Period after the end of a loan during which the borrower can repay without penalty
   * @param lateRepayFeePerBondRate Additional fees applied when a borrower repays its loan after the repayment period ends
   * @param establishmentFeeRate Fees paid to Atlendis at borrow time
   * @param repaymentFeeRate Fees paid to Atlendis at repay time
   * @param liquidityRewardsActivationThreshold Amount of tokens the borrower has to lock into the liquidity
   * @param earlyRepay Is early repay activated
   * rewards reserve to activate the pool
   **/
  struct PoolCreationParams {
    bytes32 poolHash;
    address underlyingToken;
    ILendingPool yieldProvider;
    uint128 minRate;
    uint128 maxRate;
    uint128 rateSpacing;
    uint128 maxBorrowableAmount;
    uint128 loanDuration;
    uint128 distributionRate;
    uint128 cooldownPeriod;
    uint128 repaymentPeriod;
    uint128 lateRepayFeePerBondRate;
    uint128 establishmentFeeRate;
    uint128 repaymentFeeRate;
    uint128 liquidityRewardsActivationThreshold;
    bool earlyRepay;
  }

  /**
   * @notice Creates a new pool
   * @param params A struct defining the pool creation parameters
   **/
  function createNewPool(PoolCreationParams calldata params) external;

  /**
   * @notice Allow an address to interact with a borrower pool
   * @param borrowerAddress The address to allow
   * @param poolHash The identifier of the pool
   **/
  function allow(address borrowerAddress, bytes32 poolHash) external;

  /**
   * @notice Remove pool interaction rights from an address
   * @param borrowerAddress The address to disallow
   * @param poolHash The identifier of the borrower pool
   **/
  function disallow(address borrowerAddress, bytes32 poolHash) external;

  /**
   * @notice Flags the pool as closed
   * @param poolHash The identifier of the pool to be closed
   * @param to An address to which the remaining liquidity rewards will be sent
   **/
  function closePool(bytes32 poolHash, address to) external;

  /**
   * @notice Flags the pool as defaulted
   * @param poolHash The identifier of the pool to default
   **/
  function setDefault(bytes32 poolHash) external;

  /**
   * @notice Set the maximum amount of tokens that can be borrowed in the target pool
   **/
  function setMaxBorrowableAmount(uint128 maxTokenDeposit, bytes32 poolHash) external;

  /**
   * @notice Set the pool liquidity rewards distribution rate
   **/
  function setLiquidityRewardsDistributionRate(uint128 distributionRate, bytes32 poolHash) external;

  /**
   * @notice Set the pool establishment protocol fee rate
   **/
  function setEstablishmentFeeRate(uint128 establishmentFeeRate, bytes32 poolHash) external;

  /**
   * @notice Set the pool repayment protocol fee rate
   **/
  function setRepaymentFeeRate(uint128 repaymentFeeRate, bytes32 poolHash) external;

  /**
   * @notice Withdraws protocol fees to a target address
   * @param poolHash The identifier of the pool
   * @param normalizedAmount The amount of tokens claimed
   * @param to The address receiving the fees
   **/
  function claimProtocolFees(
    bytes32 poolHash,
    uint128 normalizedAmount,
    address to
  ) external;

  /**
   * @notice Stops all actions on all pools
   **/
  function freezePool() external;

  /**
   * @notice Cancel a freeze, makes actions available again on all pools
   **/
  function unfreezePool() external;
}

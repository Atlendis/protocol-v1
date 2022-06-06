// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "../extensions/AaveILendingPool.sol";
import "../lib/Types.sol";

/**
 * @title IBorrowerPools
 * @notice Used by the Position contract to pool lender positions in the borrowers order books
 *         Used by the borrowers to manage their loans on their pools
 **/
interface IBorrowerPools {
  // EVENTS

  /**
   * @notice Emitted after a successful borrow
   * @param poolHash The identifier of the pool
   * @param normalizedBorrowedAmount The actual amount of tokens borrowed
   * @param establishmentFees Fees paid to the protocol at borrow time
   **/
  event Borrow(bytes32 indexed poolHash, uint128 normalizedBorrowedAmount, uint128 establishmentFees);

  /**
   * @notice Emitted after a successful further borrow
   * @param poolHash The identifier of the pool
   * @param normalizedBorrowedAmount The actual amount of tokens borrowed
   * @param establishmentFees Fees paid to the protocol at borrow time
   **/
  event FurtherBorrow(bytes32 indexed poolHash, uint128 normalizedBorrowedAmount, uint128 establishmentFees);

  /**
   * @notice Emitted after a successful repay
   * @param poolHash The identifier of the pool
   * @param normalizedRepayAmount The actual amount of tokens repaid
   * @param repaymentFee The amount of fee paid to the protocol at repay time
   * @param normalizedDepositsAfterRepay The actual amount of tokens deposited and available for next loan after repay
   * @param nextLoanMinStart The timestamp after which a new loan can be taken
   **/
  event Repay(
    bytes32 indexed poolHash,
    uint128 normalizedRepayAmount,
    uint128 repaymentFee,
    uint128 normalizedDepositsAfterRepay,
    uint128 nextLoanMinStart
  );

  /**
   * @notice Emitted after a successful early repay
   * @param poolHash The identifier of the pool
   * @param normalizedRepayAmount The actual amount of tokens repaid
   * @param repaymentFee The amount of fee paid to the protocol at repay time
   * @param normalizedDepositsAfterRepay The actual amount of tokens deposited and available for next loan after repay
   * @param nextLoanMinStart The timestamp after which a new loan can be taken
   **/
  event EarlyRepay(
    bytes32 indexed poolHash,
    uint128 normalizedRepayAmount,
    uint128 repaymentFee,
    uint128 normalizedDepositsAfterRepay,
    uint128 nextLoanMinStart
  );

  /**
   * @notice Emitted after a successful repay, made after the repayment period
   * Includes a late repay fee
   * @param poolHash The identifier of the pool
   * @param normalizedRepayAmount The actual amount of tokens repaid
   * @param lateRepayFee The amount of fee paid due to a late repayment
   * @param repaymentFee The amount of fee paid to the protocol at repay time
   * @param normalizedDepositsAfterRepay The actual amount of tokens deposited and available for next loan after repay
   * @param nextLoanMinStart The timestamp after which a new loan can be taken
   **/
  event LateRepay(
    bytes32 indexed poolHash,
    uint128 normalizedRepayAmount,
    uint128 lateRepayFee,
    uint128 repaymentFee,
    uint128 normalizedDepositsAfterRepay,
    uint128 nextLoanMinStart
  );

  /**
   * @notice Emitted after a borrower successfully deposits tokens in its pool liquidity rewards reserve
   * @param poolHash The identifier of the pool
   * @param normalizedAmount The actual amount of tokens deposited into the reserve
   **/
  event TopUpLiquidityRewards(bytes32 poolHash, uint128 normalizedAmount);

  // The below events and enums are being used in the PoolLogic library
  // The same way that libraries don't have storage, they don't have an event log
  // Hence event logs will be saved in the calling contract
  // For the contract abi to reflect this and be used by offchain libraries,
  // we define these events and enums in the contract itself as well

  /**
   * @notice Emitted when a tick is initialized, i.e. when its first deposited in
   * @param poolHash The identifier of the pool
   * @param rate The tick's bidding rate
   * @param atlendisLiquidityRatio The tick current liquidity index
   **/
  event TickInitialized(bytes32 poolHash, uint128 rate, uint128 atlendisLiquidityRatio);

  /**
   * @notice Emitted after a deposit on a tick that was done during a loan
   * @param poolHash The identifier of the pool
   * @param rate The position bidding rate
   * @param adjustedPendingDeposit The amount of tokens deposited during a loan, adjusted to the current liquidity index
   **/
  event TickLoanDeposit(bytes32 poolHash, uint128 rate, uint128 adjustedPendingDeposit);

  /**
   * @notice Emitted after a deposit on a tick that was done without an active loan
   * @param poolHash The identifier of the pool
   * @param rate The position bidding rate
   * @param adjustedAvailableDeposit The amount of tokens available to the borrower for its next loan
   * @param atlendisLiquidityRatio The tick current liquidity index
   **/
  event TickNoLoanDeposit(
    bytes32 poolHash,
    uint128 rate,
    uint128 adjustedAvailableDeposit,
    uint128 atlendisLiquidityRatio
  );

  /**
   * @notice Emitted when a borrow successfully impacts a tick
   * @param poolHash The identifier of the pool
   * @param rate The tick's bidding rate
   * @param adjustedRemainingAmountReduction The amount of tokens left to borrow from other ticks
   * @param loanedAmount The amount borrowed from the tick
   * @param atlendisLiquidityRatio The tick current liquidity index
   * @param unborrowedRatio Proportion of ticks funds that were not borrowed
   **/
  event TickBorrow(
    bytes32 poolHash,
    uint128 rate,
    uint128 adjustedRemainingAmountReduction,
    uint128 loanedAmount,
    uint128 atlendisLiquidityRatio,
    uint128 unborrowedRatio
  );

  /**
   * @notice Emitted when a withdraw is done outside of a loan on the tick
   * @param poolHash The identifier of the pool
   * @param rate The tick's bidding rate
   * @param adjustedAmountToWithdraw The amount of tokens to withdraw, adjusted to the tick liquidity index
   **/
  event TickWithdrawPending(bytes32 poolHash, uint128 rate, uint128 adjustedAmountToWithdraw);

  /**
   * @notice Emitted when a withdraw is done during a loan on the tick
   * @param poolHash The identifier of the pool
   * @param rate The tick's bidding rate
   * @param adjustedAmountToWithdraw The amount of tokens to withdraw, adjusted to the tick liquidity index
   * @param atlendisLiquidityRatio The tick current liquidity index
   * @param accruedFeesToWithdraw The amount of fees the position has a right to claim
   **/
  event TickWithdrawRemaining(
    bytes32 poolHash,
    uint128 rate,
    uint128 adjustedAmountToWithdraw,
    uint128 atlendisLiquidityRatio,
    uint128 accruedFeesToWithdraw
  );

  /**
   * @notice Emitted when pending amounts are merged with the rest of the pool during a repay
   * @param poolHash The identifier of the pool
   * @param rate The tick's bidding rate
   * @param adjustedPendingAmount The amount of pending funds deposited with available funds
   **/
  event TickPendingDeposit(
    bytes32 poolHash,
    uint128 rate,
    uint128 adjustedPendingAmount,
    bool poolBondIssuanceIndexIncremented
  );

  /**
   * @notice Emitted when funds from a tick are repaid by the borrower
   * @param poolHash The identifier of the pool
   * @param rate The tick's bidding rate
   * @param adjustedRemainingAmount The total amount of tokens available to the borrower for
   * its next loan, adjusted to the tick current liquidity index
   * @param atlendisLiquidityRatio The tick current liquidity index
   **/
  event TickRepay(bytes32 poolHash, uint128 rate, uint128 adjustedRemainingAmount, uint128 atlendisLiquidityRatio);

  /**
   * @notice Emitted when liquidity rewards are distributed to a tick
   * @param poolHash The identifier of the pool
   * @param rate The tick's bidding rate
   * @param remainingLiquidityRewards the amount of liquidityRewards added to the tick
   * @param addedAccruedFees Increase in accrued fees for that tick
   **/
  event CollectFeesForTick(bytes32 poolHash, uint128 rate, uint128 remainingLiquidityRewards, uint128 addedAccruedFees);

  // VIEW METHODS

  /**
   * @notice Returns the liquidity ratio of a given tick in a pool's order book.
   * The liquidity ratio is an accounting construct to deduce the accrued interest over time.
   * @param poolHash The identifier of the pool
   * @param rate The tick rate from which to extract the liquidity ratio
   * @return liquidityRatio The liquidity ratio of the given tick
   **/
  function getTickLiquidityRatio(bytes32 poolHash, uint128 rate) external view returns (uint128 liquidityRatio);

  /**
   * @notice Returns the repartition between bonds and deposits of the given tick.
   * @param poolHash The identifier of the pool
   * @param rate The tick rate from which to get data
   * @return adjustedTotalAmount Total amount of deposit in the tick
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
    external
    view
    returns (
      uint128 adjustedTotalAmount,
      uint128 adjustedRemainingAmount,
      uint128 bondsQuantity,
      uint128 adjustedPendingAmount,
      uint128 atlendisLiquidityRatio,
      uint128 accruedFees
    );

  /**
   * @notice Returns the timestamp of the last fee distribution to the tick
   * @param poolHash The identifier of the pool
   * @param rate The tick rate from which to get data
   * @return lastFeeDistributionTimestamp Timestamp of the last fee's distribution to the tick
   **/
  function getTickLastUpdate(string calldata poolHash, uint128 rate)
    external
    view
    returns (uint128 lastFeeDistributionTimestamp);

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
    returns (uint128 weightedAverageLendingRate, uint128 adjustedPendingDeposits);

  /**
   * @notice Returns the current maturity of the pool
   * @param poolHash The identifier of the pool
   * @return poolCurrentMaturity The pool's current maturity
   **/
  function getPoolMaturity(bytes32 poolHash) external view returns (uint128 poolCurrentMaturity);

  /**
   * @notice Estimates the lending rate corresponding to the input amount,
   * depending on the current state of the pool
   * @param normalizedBorrowedAmount The amount to be borrowed from the pool
   * @param poolHash The identifier of the pool
   * @return estimatedRate The estimated loan rate for the current state of the pool
   **/
  function estimateLoanRate(uint128 normalizedBorrowedAmount, bytes32 poolHash)
    external
    view
    returns (uint128 estimatedRate);

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
  ) external view returns (uint128 bondsQuantity, uint128 normalizedDepositedAmount);

  /**
   * @notice Returns the total amount a borrower has to repay to a pool. Includes borrowed
   * amount, late repay fees and protocol fees
   * @param poolHash The identifier of the pool
   * @param earlyRepay indicates if this is an early repay
   * @return normalizedRepayAmount Total repay amount
   * @return lateRepayFee Normalized amount to be paid to each bond in case of late repayment
   * @return repaymentFee Normalized fee amount paid to the protocol
   **/
  function getRepayAmounts(bytes32 poolHash, bool earlyRepay)
    external
    view
    returns (
      uint128 normalizedRepayAmount,
      uint128 lateRepayFee,
      uint128 repaymentFee
    );

  // LENDER METHODS

  /**
   * @notice Gets called within the Position.deposit() function and enables a lender to deposit assets
   * into a given borrower's order book. The lender specifies a rate (price) at which it is willing to
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
  ) external returns (uint128 adjustedAmount, uint128 bondsIssuanceIndex);

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
    external
    view
    returns (
      uint128 adjustedAmountToWithdraw,
      uint128 depositedAmountToWithdraw,
      uint128 remainingBondsQuantity,
      uint128 bondsMaturity
    );

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
  ) external returns (uint128 normalizedDepositedAmountToWithdraw);

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
    external
    returns (
      uint128 newAdjustedAmount,
      uint128 newBondsIssuanceIndex,
      uint128 normalizedAmount
    );

  // BORROWER METHODS

  /**
   * @notice Called by the borrower to sell bonds to the order book.
   * The affected ticks get updated according the amount of bonds sold.
   * @param to The address to which the borrowed funds should be sent.
   * @param loanAmount The total amount of the loan
   **/
  function borrow(address to, uint128 loanAmount) external;

  /**
   * @notice Repays a currently outstanding bonds of the given borrower.
   **/
  function repay() external;

  /**
   * @notice Called by the borrower to top up liquidity rewards' reserve that
   * is distributed to liquidity providers at the pre-defined distribution rate.
   * @param normalizedAmount Amount of tokens  that will be add up to the borrower's liquidity rewards reserve
   **/
  function topUpLiquidityRewards(uint128 normalizedAmount) external;

  // FEE COLLECTION

  /**
   * @notice Collect yield provider fees as well as liquidity rewards for the target tick
   * @param poolHash The identifier of the pool
   **/
  function collectFeesForTick(bytes32 poolHash, uint128 rate) external;

  /**
   * @notice Collect yield provider fees as well as liquidity rewards for the whole pool
   * Iterates over all pool initialized ticks
   * @param poolHash The identifier of the pool
   **/
  function collectFees(bytes32 poolHash) external;
}

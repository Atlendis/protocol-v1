// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "./IBorrowerPools.sol";

/**
 * @title IPositionManager
 * @notice Contains methods that can be called by lenders to create and manage their position
 **/
interface IPositionManager {
  /**
   * @notice Emitted when #deposit is called and is a success
   * @param lender The address of the lender depositing token on the protocol
   * @param tokenId The tokenId of the position
   * @param amount The amount of deposited token
   * @param rate The position bidding rate
   * @param poolHash The identifier of the pool
   * @param bondsIssuanceIndex The borrow period assigned to the position
   **/
  event Deposit(
    address indexed lender,
    uint128 tokenId,
    uint128 amount,
    uint128 rate,
    bytes32 poolHash,
    uint128 bondsIssuanceIndex
  );

  /**
   * @notice Emitted when #updateRate is called and is a success
   * @param lender The address of the lender updating their position
   * @param tokenId The tokenId of the position
   * @param amount The amount of deposited token plus their accrued interests
   * @param rate The new rate required by lender to lend their deposited token
   * @param poolHash The identifier of the pool
   **/
  event UpdateRate(address indexed lender, uint128 tokenId, uint128 amount, uint128 rate, bytes32 poolHash);

  /**
   * @notice Emitted when #withdraw is called and is a success
   * @param lender The address of the withdrawing lender
   * @param tokenId The tokenId of the position
   * @param amount The amount of tokens withdrawn
   * @param rate The position bidding rate
   * @param poolHash The identifier of the pool
   **/
  event Withdraw(
    address indexed lender,
    uint128 tokenId,
    uint128 amount,
    uint128 remainingBonds,
    uint128 rate,
    bytes32 poolHash
  );

  /**
   * @notice Set the position descriptor address
   * @param positionDescriptor The address of the new position descriptor
   **/
  event SetPositionDescriptor(address positionDescriptor);

  /**
   * @notice Emitted when #withdraw is called and is a success
   * @param tokenId The tokenId of the position
   * @return poolHash The identifier of the pool
   * @return adjustedBalance Adjusted balance of the position original deposit
   * @return rate Position bidding rate
   * @return underlyingToken Address of the tokens the position contains
   * @return remainingBonds Quantity of bonds remaining in the position after a partial withdraw
   * @return bondsMaturity Maturity of the position's remaining bonds
   * @return bondsIssuanceIndex Borrow period the deposit was made in
   **/
  function position(uint128 tokenId)
    external
    view
    returns (
      bytes32 poolHash,
      uint128 adjustedBalance,
      uint128 rate,
      address underlyingToken,
      uint128 remainingBonds,
      uint128 bondsMaturity,
      uint128 bondsIssuanceIndex
    );

  /**
   * @notice Returns the balance on yield provider and the quantity of bond held
   * @param tokenId The tokenId of the position
   * @return bondsQuantity Quantity of bond held, represents funds borrowed
   * @return normalizedDepositedAmount Amount of deposit placed on yield provider
   **/
  function getPositionRepartition(uint128 tokenId)
    external
    view
    returns (uint128 bondsQuantity, uint128 normalizedDepositedAmount);

  /**
   * @notice Deposits tokens into the yield provider and places a bid at the indicated rate within the
   * respective borrower's order book. A new position is created within the positions map that keeps
   * track of this position's composition. An ERC721 NFT is minted for the user as a representation
   * of the position.
   * @param to The address for which the position is created
   * @param amount The amount of tokens to be deposited
   * @param rate The rate at which to bid for a bonds
   * @param poolHash The identifier of the pool
   * @param underlyingToken The contract address of the token to be deposited
   **/
  function deposit(
    address to,
    uint128 amount,
    uint128 rate,
    bytes32 poolHash,
    address underlyingToken
  ) external returns (uint128 tokenId);

  /**
   * @notice Allows a user to update the rate at which to bid for bonds. A rate is only
   * upgradable as long as the full amount of deposits are currently allocated with the
   * yield provider i.e the position does not hold any bonds.
   * @param tokenId The tokenId of the position
   * @param newRate The new rate at which to bid for bonds
   **/
  function updateRate(uint128 tokenId, uint128 newRate) external;

  /**
   * @notice Withdraws the amount of tokens that are deposited with the yield provider.
   * The bonds portion of the position is not affected.
   * @param tokenId The tokenId of the position
   **/
  function withdraw(uint128 tokenId) external;

  /**
   * @notice Set the address of the position descriptor.
   * Only accessible to governance.
   * @param positionDescriptor The address of the position descriptor
   **/
  function setPositionDescriptor(address positionDescriptor) external;
}

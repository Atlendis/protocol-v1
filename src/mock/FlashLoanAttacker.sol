// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721ReceiverUpgradeable.sol";

import "../PositionManager.sol";

contract FlashLoanAttacker is IERC721ReceiverUpgradeable {
  address private position;

  constructor(address _position) {
    position = _position;
  }

  function onERC721Received(
    address operator,
    address from,
    uint256 tokenId,
    bytes calldata data
  ) external pure override returns (bytes4) {
    require(operator != address(0), "input validation");
    require(from == address(0), "input validation");
    require(tokenId != 0, "input validation");
    require(keccak256(data) != "", "input validation");
    return IERC721ReceiverUpgradeable.onERC721Received.selector;
  }

  function attackUpdateRate(
    uint128 amount,
    uint128 rate,
    uint128 rateSpacing,
    bytes32 borrower,
    address underlyingToken
  ) external {
    uint128 tokenId = PositionManager(position).deposit(address(this), amount, rate, borrower, underlyingToken);
    PositionManager(position).updateRate(tokenId, rate + rateSpacing);
  }

  function attackWithdraw(
    uint128 amount,
    uint128 rate,
    bytes32 borrower,
    address underlyingToken
  ) external {
    PositionManager(position).deposit(address(this), amount, rate, borrower, underlyingToken);
    PositionManager(position).withdraw(1);
  }
}

// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "../extensions/AaveILendingPool.sol";

interface IERC20 {
  function transferFrom(
    address,
    address,
    uint256
  ) external;
}

contract AaveLendingPoolMock {
  mapping(address => address) public aTokens;

  function _add_token(address _underlying, address _aToken) external {
    aTokens[_underlying] = _aToken;
  }

  /**
    * @dev deposits The underlying asset into the reserve. A corresponding amount
           of the overlying asset (aTokens) is minted.
    * @param _reserve the address of the reserve
    * @param _amount the amount to be deposited
    * @param _referralCode integrators are assigned a referral code and can potentially receive rewards.
    **/
  function deposit(
    address _reserve,
    uint256 _amount,
    address _receiver,
    uint16 _referralCode
  ) external pure {
    assert(_reserve != address(0));
    assert(_amount >= 0);
    assert(_receiver != address(0));
    assert(_referralCode >= 0);
  }

  function withdraw(
    address asset,
    uint256 amount,
    address to
  ) external pure returns (uint256) {
    assert(asset != address(0));
    assert(to != address(0));
    return amount;
  }

  function getReserveNormalizedIncome(address _underlying) public pure returns (uint256) {
    assert(_underlying != address(0));
    return 1e27;
  }
}

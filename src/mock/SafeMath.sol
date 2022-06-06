// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

library SafeMath {
  function add(uint256 a, uint256 b) internal pure returns (uint256 c) {
    c = a + b;
    require(c >= a, "add error");
    return c;
  }

  function sub(uint256 a, uint256 b) internal pure returns (uint256 c) {
    require(b <= a, "sub error");
    c = a - b;
    return c;
  }

  function mul(uint256 a, uint256 b) internal pure returns (uint256 c) {
    c = a * b;
    require(a == 0 || c / a == b, "mul error");
    return c;
  }

  function div(uint256 a, uint256 b) internal pure returns (uint256 c) {
    require(b > 0, "div error");
    c = a / b;
    return c;
  }
}

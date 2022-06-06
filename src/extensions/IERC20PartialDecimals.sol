// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts v4.4.1 (token/ERC20/extensions/IERC20Metadata.sol)

pragma solidity ^0.8.0;

/**
 * @dev Partial interface for the optional metadata functions from the ERC20 standard.
 */
interface IERC20PartialDecimals {
  /**
   * @dev Returns the decimals places of the token.
   */
  function decimals() external view returns (uint8);
}

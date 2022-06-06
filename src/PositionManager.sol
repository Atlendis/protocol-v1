// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";

import "./interfaces/IBorrowerPools.sol";
import "./interfaces/IPoolsController.sol";
import "./interfaces/IPositionDescriptor.sol";
import "./interfaces/IPositionManager.sol";

import "./lib/Errors.sol";
import "./lib/Roles.sol";
import "./lib/Scaling.sol";
import "./lib/Types.sol";

contract PositionManager is ERC721Upgradeable, IPositionManager {
  using Scaling for uint128;

  IBorrowerPools public pools;
  IPositionDescriptor public positionDescriptor;

  // next position id
  uint128 private _nextId;

  mapping(uint128 => Types.PositionDetails) public _positions;

  function initialize(
    string memory _name,
    string memory _symbol,
    IBorrowerPools _pools,
    IPositionDescriptor _positionDescriptor
  ) public virtual initializer {
    __ERC721_init(_name, _symbol);
    pools = _pools;
    positionDescriptor = _positionDescriptor;
    _nextId = 1;
  }

  // VIEW METHODS

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
    public
    view
    override
    returns (
      bytes32 poolHash,
      uint128 adjustedBalance,
      uint128 rate,
      address underlyingToken,
      uint128 remainingBonds,
      uint128 bondsMaturity,
      uint128 bondsIssuanceIndex
    )
  {
    Types.PositionDetails memory _position = _positions[tokenId];
    return (
      _position.poolHash,
      _position.adjustedBalance,
      _position.rate,
      _position.underlyingToken,
      _position.remainingBonds,
      _position.bondsMaturity,
      _position.bondsIssuanceIndex
    );
  }

  /**
   * @notice Returns the encoded svg data
   * @param tokenId The tokenId of the position
   * @return encoded svg
   **/
  function tokenURI(uint256 tokenId) public view override returns (string memory) {
    if (!_exists(tokenId)) {
      revert Errors.POS_POSITION_DOES_NOT_EXIST();
    }
    return IPositionDescriptor(positionDescriptor).tokenURI(this, uint128(tokenId));
  }

  /**
   * @notice Returns the balance on yield provider and the quantity of bond held
   * @param tokenId The tokenId of the position
   * @return bondsQuantity Quantity of bond held, represents funds borrowed
   * @return normalizedDepositedAmount Amount of deposit placed on yield provider
   **/
  function getPositionRepartition(uint128 tokenId)
    external
    view
    override
    returns (uint128 bondsQuantity, uint128 normalizedDepositedAmount)
  {
    if (!_exists(tokenId)) {
      return (0, 0);
    }
    uint256 poolCurrentMaturity = pools.getPoolMaturity(_positions[tokenId].poolHash);
    if ((_positions[tokenId].bondsMaturity > 0) && (_positions[tokenId].bondsMaturity == poolCurrentMaturity)) {
      return (_positions[tokenId].remainingBonds, 0);
    }
    return
      pools.getAmountRepartition(
        _positions[tokenId].poolHash,
        _positions[tokenId].rate,
        _positions[tokenId].adjustedBalance,
        _positions[tokenId].bondsIssuanceIndex
      );
  }

  function revertIfPositionDefaulted(uint256 tokenId) private view {
    (, bool defaulted, , , , , , , , , , ) = IPoolsController(address(pools)).getPoolState(
      _positions[uint128(tokenId)].poolHash
    );
    if (defaulted) {
      revert Errors.POS_POOL_DEFAULTED();
    }
  }

  // ERC721 OVERRIDDEN TRANSFERS

  /**
   * @dev See {IERC721-transferFrom}.
   */
  function transferFrom(
    address from,
    address to,
    uint256 tokenId
  ) public override {
    revertIfPositionDefaulted(tokenId);
    super.transferFrom(from, to, tokenId);
  }

  /**
   * @dev See {IERC721-safeTransferFrom}.
   */
  function safeTransferFrom(
    address from,
    address to,
    uint256 tokenId
  ) public override {
    revertIfPositionDefaulted(tokenId);
    super.safeTransferFrom(from, to, tokenId);
  }

  /**
   * @dev See {IERC721-safeTransferFrom}.
   */
  function safeTransferFrom(
    address from,
    address to,
    uint256 tokenId,
    bytes memory _data
  ) public override {
    revertIfPositionDefaulted(tokenId);
    super.safeTransferFrom(from, to, tokenId, _data);
  }

  // LENDER METHODS

  /**
   * @notice Deposits tokens into the yield provider and places a bid at the indicated rate within the
   * respective pool's order book. A new position is created within the positions map that keeps
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
  ) external override returns (uint128 tokenId) {
    if (amount == 0) {
      revert Errors.POS_ZERO_AMOUNT();
    }

    tokenId = _nextId++;

    _safeMint(to, tokenId);

    uint8 decimals = ERC20Upgradeable(underlyingToken).decimals();

    uint128 normalizedAmount = amount.scaleToWad(decimals);

    (uint128 adjustedBalance, uint128 bondsIssuanceIndex) = pools.deposit(
      rate,
      poolHash,
      underlyingToken,
      _msgSender(),
      normalizedAmount
    );

    _positions[tokenId] = Types.PositionDetails({
      adjustedBalance: adjustedBalance,
      rate: rate,
      poolHash: poolHash,
      underlyingToken: underlyingToken,
      remainingBonds: 0,
      bondsMaturity: 0,
      bondsIssuanceIndex: bondsIssuanceIndex,
      creationTimestamp: uint128(block.timestamp)
    });

    emit Deposit(to, tokenId, normalizedAmount, rate, poolHash, bondsIssuanceIndex);
  }

  /**
   * @notice Allows a user to update the rate at which to bid for bonds. A rate is only
   * upgradable as long as the full amount of deposits are currently allocated with the
   * yield provider i.e the position does not hold any bonds.
   * @param tokenId The tokenId of the position
   * @param newRate The new rate at which to bid for bonds
   **/
  function updateRate(uint128 tokenId, uint128 newRate) external override {
    if (ownerOf(tokenId) != _msgSender()) {
      revert Errors.POS_MGMT_ONLY_OWNER();
    }
    if (_positions[tokenId].creationTimestamp == block.timestamp) {
      revert Errors.POS_TIMELOCK();
    }

    uint128 oldRate = _positions[tokenId].rate;

    (uint128 newAmount, uint128 newBondsIssuanceIndex, uint128 normalizedAmount) = pools.updateRate(
      _positions[tokenId].adjustedBalance,
      _positions[tokenId].poolHash,
      oldRate,
      newRate,
      _positions[tokenId].bondsIssuanceIndex
    );

    _positions[tokenId].adjustedBalance = newAmount;
    _positions[tokenId].rate = newRate;
    _positions[tokenId].bondsIssuanceIndex = newBondsIssuanceIndex;

    emit UpdateRate(_msgSender(), tokenId, normalizedAmount, newRate, _positions[tokenId].poolHash);
  }

  /**
   * @notice Withdraws the amount of tokens that are deposited with the yield provider.
   * The bonds portion of the position is not affected.
   * @param tokenId The tokenId of the position
   **/
  function withdraw(uint128 tokenId) external override {
    if (ownerOf(tokenId) != _msgSender()) {
      revert Errors.POS_MGMT_ONLY_OWNER();
    }
    if (_positions[tokenId].creationTimestamp == block.timestamp) {
      revert Errors.POS_TIMELOCK();
    }
    uint256 poolCurrentMaturity = pools.getPoolMaturity(_positions[tokenId].poolHash);
    if (
      !((_positions[tokenId].remainingBonds == 0) ||
        ((block.timestamp >= _positions[tokenId].bondsMaturity) &&
          (_positions[tokenId].bondsMaturity != poolCurrentMaturity)))
    ) {
      revert Errors.POS_POSITION_ONLY_IN_BONDS();
    }

    (
      uint128 adjustedAmountToWithdraw,
      uint128 depositedAmountToWithdraw,
      uint128 remainingBondsQuantity,
      uint128 bondsMaturity
    ) = pools.getWithdrawAmounts(
        _positions[tokenId].poolHash,
        _positions[tokenId].rate,
        _positions[tokenId].adjustedBalance,
        _positions[tokenId].bondsIssuanceIndex
      );

    _positions[tokenId].adjustedBalance -= depositedAmountToWithdraw;
    _positions[tokenId].remainingBonds = remainingBondsQuantity;
    _positions[tokenId].bondsMaturity = bondsMaturity;

    uint128 normalizedWithdrawnDeposit = pools.withdraw(
      _positions[tokenId].poolHash,
      _positions[tokenId].rate,
      adjustedAmountToWithdraw,
      _positions[tokenId].bondsIssuanceIndex,
      _msgSender()
    );

    emit Withdraw(
      _msgSender(),
      tokenId,
      normalizedWithdrawnDeposit,
      remainingBondsQuantity,
      _positions[tokenId].rate,
      _positions[tokenId].poolHash
    );

    if (_positions[tokenId].remainingBonds == 0) {
      _burn(tokenId);
      delete _positions[tokenId];
    }
  }

  // GOVERNANCE METHOD

  function setPositionDescriptor(address _positionDescriptor) external override {
    if (!AccessControlUpgradeable(address(pools)).hasRole(Roles.GOVERNANCE_ROLE, _msgSender())) {
      revert Errors.POS_NOT_ALLOWED();
    }
    if (_positionDescriptor == address(0)) {
      revert Errors.POS_ZERO_ADDRESS();
    }

    positionDescriptor = IPositionDescriptor(_positionDescriptor);

    emit SetPositionDescriptor(_positionDescriptor);
  }
}

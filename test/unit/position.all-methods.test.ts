import {BigNumber} from 'ethers';
import {deployments, ethers} from 'hardhat';

import {MockContract} from '@ethereum-waffle/mock-contract';
import {parseEther} from '@ethersproject/units';

import {FlashLoanAttacker, PositionDescriptor} from '../../typechain';
import {setupFixture, setupUser} from '../utils';
import {
  borrowerName,
  poolHash,
  FIRST_BOND_ISSUANCE_INDEX,
  FIRST_TOKEN_ID,
  NEXT_BOND_ISSUANCE_INDEX,
  ONE_HOUR,
  WAD,
} from '../utils/constants';
import {User} from '../utils/types';
import {expect} from './helpers/chai-setup';
import {keccak256, defaultAbiCoder} from 'ethers/lib/utils';

const setup = deployments.createFixture(async () => {
  return setupFixture('PositionManager');
});

describe('Position - All methods', () => {
  let user: User, otherUser: User;
  const minRate: BigNumber = WAD.div(20);
  const baseAmount: BigNumber = WAD.mul(100);
  const baseAdjustedAmount: BigNumber = WAD.mul(50);
  let mockBorrowPool: MockContract;
  let underlyingToken: MockContract;

  beforeEach(async () => {
    const {deployer, mocks, users} = await setup();

    const deployedPositionManagerDescriptor =
      await deployer.PositionDescriptorF.deploy();

    const deployedPositionManager = await deployer.PositionManagerF.deploy();
    await deployedPositionManager.initialize(
      'My New Position',
      '📍',
      mocks.BorrowerPools.address,
      deployedPositionManagerDescriptor.address
    );
    const deployedAttacker = await deployer.FlashLoanAttackerF.deploy(
      deployedPositionManager.address
    );

    user = await setupUser(users[1].address, {
      BorrowerPools: mocks.BorrowerPools,
      PositionDescriptor: deployedPositionManagerDescriptor,
      PositionManager: deployedPositionManager,
      FlashLoanAttacker: deployedAttacker,
    });
    otherUser = await setupUser(users[2].address, {
      BorrowerPools: mocks.BorrowerPools,
      PositionDescriptor: deployedPositionManagerDescriptor,
      PositionManager: deployedPositionManager,
    });

    mockBorrowPool = mocks.BorrowerPools;
    underlyingToken = mocks.DepositToken1;
    await underlyingToken.mock.decimals.returns(18);
  });

  it('Calling supportsInterface should return true to the right interface', async () => {
    // see https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified
    const interfaceHash = '0x01ffc9a7';
    const res = await user.PositionManager.supportsInterface(interfaceHash);
    await expect(res).to.be.true;
  });
  it('Getting positionManager NFT for a positionManager that does not exit should revert', async () => {
    await expect(
      user.PositionManager.tokenURI(FIRST_TOKEN_ID)
    ).to.be.revertedWith('POS_POSITION_DOES_NOT_EXIST');
  });
  it('Transfering a position from a defaulted pool should revert', async () => {
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    user.PositionManager.deposit(
      user.address,
      baseAmount,
      minRate,
      poolHash,
      underlyingToken.address
    );
    await mockBorrowPool.mock.getPoolState.returns(
      false,
      true,
      false,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    );
    await expect(
      user.PositionManager.transferFrom(
        user.address,
        user.address,
        FIRST_TOKEN_ID
      )
    ).to.be.revertedWith('POS_POOL_DEFAULTED');
  });
  it('Transfering a position from a not defaulted pool should pass', async () => {
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    user.PositionManager.deposit(
      user.address,
      baseAmount,
      minRate,
      poolHash,
      underlyingToken.address
    );
    await mockBorrowPool.mock.getPoolState.returns(
      false,
      false,
      false,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    );
    await expect(
      user.PositionManager.transferFrom(
        user.address,
        user.address,
        FIRST_TOKEN_ID
      )
    ).to.emit(user.PositionManager, 'Transfer');
  });
  it('Safe Transfering a position from a defaulted pool should revert', async () => {
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    user.PositionManager.deposit(
      user.address,
      baseAmount,
      minRate,
      poolHash,
      underlyingToken.address
    );
    await mockBorrowPool.mock.getPoolState.returns(
      false,
      true,
      false,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    );
    await expect(
      user.PositionManager['safeTransferFrom(address,address,uint256)'](
        user.address,
        user.address,
        FIRST_TOKEN_ID
      )
    ).to.be.revertedWith('POS_POOL_DEFAULTED');
  });
  it('Safe Transfering a position from a not defaulted pool should pass', async () => {
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    user.PositionManager.deposit(
      user.address,
      baseAmount,
      minRate,
      poolHash,
      underlyingToken.address
    );
    await mockBorrowPool.mock.getPoolState.returns(
      false,
      false,
      false,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    );
    await expect(
      user.PositionManager['safeTransferFrom(address,address,uint256)'](
        user.address,
        user.address,
        FIRST_TOKEN_ID
      )
    ).to.emit(user.PositionManager, 'Transfer');
  });
  it('Safe Transfering with data a position from a defaulted pool should revert', async () => {
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    user.PositionManager.deposit(
      user.address,
      baseAmount,
      minRate,
      poolHash,
      underlyingToken.address
    );
    await mockBorrowPool.mock.getPoolState.returns(
      false,
      true,
      false,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    );
    await expect(
      user.PositionManager['safeTransferFrom(address,address,uint256,bytes)'](
        user.address,
        user.address,
        FIRST_TOKEN_ID,
        poolHash
      )
    ).to.be.revertedWith('POS_POOL_DEFAULTED');
  });
  it('Safe Transfering with data a position from a not defaulted pool should pass', async () => {
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    user.PositionManager.deposit(
      user.address,
      baseAmount,
      minRate,
      poolHash,
      underlyingToken.address
    );
    await mockBorrowPool.mock.getPoolState.returns(
      false,
      false,
      false,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    );
    await expect(
      user.PositionManager['safeTransferFrom(address,address,uint256,bytes)'](
        user.address,
        user.address,
        FIRST_TOKEN_ID,
        poolHash
      )
    ).to.emit(user.PositionManager, 'Transfer');
  });
  it('Setting positionManager pool identifier with the right inputs should pass', async () => {
    let poolIdentifier = await (
      user.PositionDescriptor as PositionDescriptor
    ).getPoolIdentifier(poolHash);
    expect(poolIdentifier).to.equal('');

    await (user.PositionDescriptor as PositionDescriptor).setPoolIdentifier(
      borrowerName,
      poolHash
    );

    poolIdentifier = await (
      user.PositionDescriptor as PositionDescriptor
    ).getPoolIdentifier(poolHash);
    expect(poolIdentifier).to.equal(borrowerName);
  });
  it('Setting positionManager pool identifier with not matching inputs should revert', async () => {
    const badBorrowerName = 'whosbad';
    const poolIdentifier = await (
      user.PositionDescriptor as PositionDescriptor
    ).getPoolIdentifier(poolHash);
    expect(poolIdentifier).to.equal('');

    await expect(
      (user.PositionDescriptor as PositionDescriptor).setPoolIdentifier(
        badBorrowerName,
        poolHash
      )
    ).to.be.revertedWith('POD_BAD_INPUT');
  });
  it('Getting positionManager NFT before setting pool identifier should return valid data uri', async () => {
    const tokenSymbol = 'TEST';
    await underlyingToken.mock.symbol.returns(tokenSymbol);
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    await mockBorrowPool.mock.getPoolMaturity.returns(BigNumber.from(0));
    await mockBorrowPool.mock.getAmountRepartition.returns(
      baseAdjustedAmount,
      baseAmount
    );

    await expect(
      user.PositionManager.deposit(
        user.address,
        baseAmount,
        minRate,
        poolHash,
        underlyingToken.address
      )
    ).to.emit(user.PositionManager, 'Deposit');
    const uri = await user.PositionManager.tokenURI(FIRST_TOKEN_ID);
    expect(keccak256(defaultAbiCoder.encode(['string'], [uri]))).to.equal(
      '0x7bf08540c547efbcefdccf4c04bdbc2e313e24a8c8a7106fab19b5f0c2caf4de'
    );
  });
  it('Getting positionManager NFT after setting pool identifier should return valid data uri', async () => {
    const tokenSymbol = 'TEST';
    await underlyingToken.mock.symbol.returns(tokenSymbol);
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    await mockBorrowPool.mock.getPoolMaturity.returns(BigNumber.from(0));
    await mockBorrowPool.mock.getAmountRepartition.returns(
      baseAdjustedAmount,
      baseAmount
    );

    await (user.PositionDescriptor as PositionDescriptor).setPoolIdentifier(
      borrowerName,
      poolHash
    );

    await expect(
      user.PositionManager.deposit(
        user.address,
        baseAmount,
        minRate,
        poolHash,
        underlyingToken.address
      )
    ).to.emit(user.PositionManager, 'Deposit');
    const uri = await user.PositionManager.tokenURI(FIRST_TOKEN_ID);
    expect(keccak256(defaultAbiCoder.encode(['string'], [uri]))).to.equal(
      '0x57da57b64040b383e61c56e751eeb8434670a5c13ec60068ca9249a5e47ec968'
    );
  });
  it('Calling supportsInterface should return true to a wrong interface', async () => {
    const wrongInterfaceHash = '0x01ffc9a0';
    const res = await user.PositionManager.supportsInterface(
      wrongInterfaceHash
    );
    await expect(res).to.be.false;
  });
  it('Getting Position Repartition of a positionManager that does not exist should return zero', async () => {
    const res = await user.PositionManager.getPositionRepartition(
      FIRST_TOKEN_ID
    );
    expect(res[0]).to.equal(BigNumber.from(0));
    expect(res[1]).to.equal(BigNumber.from(0));
  });
  it('Getting Position Repartition should return bonds quantity and normalized amount in position', async () => {
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    await mockBorrowPool.mock.getPoolMaturity.returns(BigNumber.from(0));
    await user.PositionManager.deposit(
      user.address,
      baseAmount,
      minRate,
      poolHash,
      underlyingToken.address
    );
    await mockBorrowPool.mock.getAmountRepartition.returns(
      baseAdjustedAmount,
      baseAmount
    );
    const res = await user.PositionManager.getPositionRepartition(
      FIRST_TOKEN_ID
    );
    expect(res[0]).to.equal(baseAdjustedAmount);
    expect(res[1]).to.equal(baseAmount);
  });
  it('Getting Position Repartition before maturity with remaining bonds should return the positionManager own bonds quantity', async () => {
    const newAdjustedAmount = baseAdjustedAmount.div(2);
    const remainingBonds = parseEther('100.0');
    const blockNumAfter = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumAfter);
    const currentTimestamp = block.timestamp;
    const bondsMaturity = currentTimestamp + ONE_HOUR;
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    await mockBorrowPool.mock.getPoolMaturity.returns(BigNumber.from(0));
    await mockBorrowPool.mock.getWithdrawAmounts.returns(
      newAdjustedAmount,
      newAdjustedAmount,
      remainingBonds,
      bondsMaturity
    );
    await mockBorrowPool.mock.withdraw.returns(baseAmount);
    await user.PositionManager.deposit(
      user.address,
      baseAmount,
      minRate,
      poolHash,
      underlyingToken.address
    );

    await mockBorrowPool.mock.getPoolMaturity.returns(bondsMaturity);

    await user.PositionManager.withdraw(FIRST_TOKEN_ID);

    const res = await user.PositionManager.getPositionRepartition(
      FIRST_TOKEN_ID
    );
    expect(res[0]).to.equal(remainingBonds);
    expect(res[1]).to.equal(BigNumber.from(0));
  });
  it('Getting Position Repartition after maturity and repay with remaining bonds should call borrower pools anyways', async () => {
    const newAdjustedAmount = baseAdjustedAmount.div(2);
    const remainingBonds = parseEther('100.0');
    const blockNumAfter = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumAfter);
    const currentTimestamp = block.timestamp;
    const bondsMaturity = currentTimestamp + ONE_HOUR;
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    await mockBorrowPool.mock.getPoolMaturity.returns(BigNumber.from(0));
    await mockBorrowPool.mock.getWithdrawAmounts.returns(
      newAdjustedAmount,
      newAdjustedAmount,
      remainingBonds,
      bondsMaturity
    );
    await mockBorrowPool.mock.withdraw.returns(baseAmount);
    await mockBorrowPool.mock.getAmountRepartition.returns(
      baseAdjustedAmount,
      baseAmount
    );
    await user.PositionManager.deposit(
      user.address,
      baseAmount,
      minRate,
      poolHash,
      underlyingToken.address
    );

    await mockBorrowPool.mock.getPoolMaturity.returns(bondsMaturity);

    await user.PositionManager.withdraw(FIRST_TOKEN_ID);

    await mockBorrowPool.mock.getPoolMaturity.returns(BigNumber.from(0));

    const res = await user.PositionManager.getPositionRepartition(
      FIRST_TOKEN_ID
    );
    expect(res[0]).to.equal(baseAdjustedAmount);
    expect(res[1]).to.equal(baseAmount);
  });
  it('Depositing the zero amount should revert', async () => {
    await expect(
      user.PositionManager.deposit(
        user.address,
        BigNumber.from(0),
        minRate,
        poolHash,
        underlyingToken.address
      )
    ).to.revertedWith('POS_ZERO_AMOUNT');
  });
  it('Depositing into Position should create a token accordingly', async () => {
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );

    await expect(
      user.PositionManager.deposit(
        user.address,
        baseAmount,
        minRate,
        poolHash,
        underlyingToken.address
      )
    )
      .to.emit(user.PositionManager, 'Deposit')
      .withArgs(
        user.address,
        FIRST_TOKEN_ID,
        baseAmount,
        minRate,
        poolHash,
        FIRST_BOND_ISSUANCE_INDEX
      );

    await checkPosition(user, FIRST_TOKEN_ID, {
      adjustedBalance: baseAdjustedAmount,
      rate: minRate,
      poolHash: poolHash,
      underlyingToken: underlyingToken.address,
      remainingBonds: BigNumber.from(0),
      bondsMaturity: BigNumber.from(0),
      bondsIssuanceIndex: BigNumber.from(0),
    });
  });
  it('Depositing into Position multiple times should increment token id', async () => {
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );

    await expect(
      user.PositionManager.deposit(
        user.address,
        baseAmount,
        minRate,
        poolHash,
        underlyingToken.address
      )
    )
      .to.emit(user.PositionManager, 'Deposit')
      .withArgs(
        user.address,
        FIRST_TOKEN_ID,
        baseAmount,
        minRate,
        poolHash,
        FIRST_BOND_ISSUANCE_INDEX
      );
    await expect(
      user.PositionManager.deposit(
        user.address,
        baseAmount,
        minRate,
        poolHash,
        underlyingToken.address
      )
    )
      .to.emit(user.PositionManager, 'Deposit')
      .withArgs(
        user.address,
        FIRST_TOKEN_ID + 1,
        baseAmount,
        minRate,
        poolHash,
        FIRST_BOND_ISSUANCE_INDEX
      );
    await checkPosition(user, FIRST_TOKEN_ID + 1, {
      adjustedBalance: baseAdjustedAmount,
      rate: minRate,
      poolHash: poolHash,
      underlyingToken: underlyingToken.address,
      remainingBonds: BigNumber.from(0),
      bondsMaturity: BigNumber.from(0),
      bondsIssuanceIndex: BigNumber.from(0),
    });
  });
  it('Updating a Position rate of an inexisting positionManager should revert', async () => {
    await expect(
      user.PositionManager.updateRate(FIRST_TOKEN_ID, minRate)
    ).to.revertedWith('ERC721: owner query for nonexistent token');
  });
  it('Updating a Position rate without being the owner should revert', async () => {
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    await mockBorrowPool.mock.updateRate.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX,
      0
    );
    await expect(
      user.PositionManager.deposit(
        user.address,
        baseAmount,
        minRate,
        poolHash,
        underlyingToken.address
      )
    )
      .to.emit(user.PositionManager, 'Deposit')
      .withArgs(
        user.address,
        FIRST_TOKEN_ID,
        baseAmount,
        minRate,
        poolHash,
        FIRST_BOND_ISSUANCE_INDEX
      );
    await expect(
      otherUser.PositionManager.updateRate(FIRST_TOKEN_ID, minRate)
    ).to.revertedWith('POS_MGMT_ONLY_OWNER');
  });
  it('Updating a Position rate should update position', async () => {
    const newRate = minRate.add(1);
    const newAdjustedAmount = parseEther('90.0');
    const newNormalizedAmount = parseEther('100.0');
    const newBondsIssuanceIndex = NEXT_BOND_ISSUANCE_INDEX;
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    await mockBorrowPool.mock.updateRate.returns(
      newAdjustedAmount,
      newBondsIssuanceIndex,
      newNormalizedAmount
    );
    await expect(
      user.PositionManager.deposit(
        user.address,
        baseAmount,
        minRate,
        poolHash,
        underlyingToken.address
      )
    ).to.emit(user.PositionManager, 'Deposit');
    await expect(user.PositionManager.updateRate(FIRST_TOKEN_ID, newRate))
      .to.emit(user.PositionManager, 'UpdateRate')
      .withArgs(
        user.address,
        FIRST_TOKEN_ID,
        newNormalizedAmount,
        newRate,
        poolHash
      );
    await checkPosition(user, FIRST_TOKEN_ID, {
      adjustedBalance: newAdjustedAmount,
      rate: newRate,
      poolHash: poolHash,
      underlyingToken: underlyingToken.address,
      remainingBonds: BigNumber.from(0),
      bondsMaturity: BigNumber.from(0),
      bondsIssuanceIndex: BigNumber.from(newBondsIssuanceIndex),
    });
  });
  it('Withdrawing a Position for an inexisting positionManager should revert', async () => {
    await expect(user.PositionManager.withdraw(FIRST_TOKEN_ID)).to.revertedWith(
      'ERC721: owner query for nonexistent token'
    );
  });
  it('Withdrawing a Position without being the owner should revert', async () => {
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    await expect(
      user.PositionManager.deposit(
        user.address,
        baseAmount,
        minRate,
        poolHash,
        underlyingToken.address
      )
    )
      .to.emit(user.PositionManager, 'Deposit')
      .withArgs(
        user.address,
        FIRST_TOKEN_ID,
        baseAmount,
        minRate,
        poolHash,
        FIRST_BOND_ISSUANCE_INDEX
      );
    await expect(
      otherUser.PositionManager.withdraw(FIRST_TOKEN_ID)
    ).to.revertedWith('POS_MGMT_ONLY_OWNER');
  });
  it('Withdrawing a Position with preexisting remaining bonds before maturity should revert', async () => {
    const newAdjustedAmount = baseAdjustedAmount.div(2);
    const remainingBonds = parseEther('100.0');
    const blockNumAfter = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumAfter);
    const currentTimestamp = block.timestamp;
    const bondsMaturity = currentTimestamp + ONE_HOUR;
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    await mockBorrowPool.mock.getPoolMaturity.returns(BigNumber.from(0));
    await mockBorrowPool.mock.getWithdrawAmounts.returns(
      newAdjustedAmount,
      newAdjustedAmount,
      remainingBonds,
      bondsMaturity
    );
    await mockBorrowPool.mock.withdraw.returns(baseAmount);
    await user.PositionManager.deposit(
      user.address,
      baseAmount,
      minRate,
      poolHash,
      underlyingToken.address
    );
    await user.PositionManager.withdraw(FIRST_TOKEN_ID);

    await mockBorrowPool.mock.getPoolMaturity.returns(bondsMaturity);

    await expect(user.PositionManager.withdraw(FIRST_TOKEN_ID)).to.revertedWith(
      'POS_POSITION_ONLY_IN_BONDS'
    );
  });
  it('Withdrawing a Position with remaining bonds as a result should update the position', async () => {
    const newAdjustedAmount = baseAdjustedAmount.div(2);
    const remainingBonds = parseEther('100.0');
    const bondsMaturity = BigNumber.from(1638193648);
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    await mockBorrowPool.mock.getPoolMaturity.returns(BigNumber.from(0));
    await mockBorrowPool.mock.getWithdrawAmounts.returns(
      newAdjustedAmount,
      newAdjustedAmount,
      remainingBonds,
      bondsMaturity
    );
    await mockBorrowPool.mock.withdraw.returns(baseAmount);
    await expect(
      user.PositionManager.deposit(
        user.address,
        baseAmount,
        minRate,
        poolHash,
        underlyingToken.address
      )
    ).to.emit(user.PositionManager, 'Deposit');
    await expect(user.PositionManager.withdraw(FIRST_TOKEN_ID))
      .to.emit(user.PositionManager, 'Withdraw')
      .withArgs(
        user.address,
        FIRST_TOKEN_ID,
        baseAmount,
        remainingBonds,
        minRate,
        poolHash
      );
    await checkPosition(user, FIRST_TOKEN_ID, {
      adjustedBalance: newAdjustedAmount,
      rate: minRate,
      poolHash: poolHash,
      underlyingToken: underlyingToken.address,
      remainingBonds: remainingBonds,
      bondsMaturity: bondsMaturity,
      bondsIssuanceIndex: BigNumber.from(0),
    });
  });
  it('Withdrawing a Position partially then trying to withdraw again after maturity but before repay should revert', async () => {
    const newAdjustedAmount = baseAdjustedAmount.div(2);
    const remainingBonds = parseEther('100.0');
    const blockNumAfter = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumAfter);
    const currentTimestamp = block.timestamp;
    const bondsMaturity = BigNumber.from(currentTimestamp);
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    await mockBorrowPool.mock.getPoolMaturity.returns(BigNumber.from(0));
    await mockBorrowPool.mock.getWithdrawAmounts.returns(
      newAdjustedAmount,
      newAdjustedAmount,
      remainingBonds,
      bondsMaturity
    );
    await mockBorrowPool.mock.withdraw.returns(baseAmount);
    await expect(
      user.PositionManager.deposit(
        user.address,
        baseAmount,
        minRate,
        poolHash,
        underlyingToken.address
      )
    ).to.emit(user.PositionManager, 'Deposit');
    await expect(user.PositionManager.withdraw(FIRST_TOKEN_ID))
      .to.emit(user.PositionManager, 'Withdraw')
      .withArgs(
        user.address,
        FIRST_TOKEN_ID,
        baseAmount,
        remainingBonds,
        minRate,
        poolHash
      );
    await checkPosition(user, FIRST_TOKEN_ID, {
      adjustedBalance: newAdjustedAmount,
      rate: minRate,
      poolHash: poolHash,
      underlyingToken: underlyingToken.address,
      remainingBonds: remainingBonds,
      bondsMaturity: bondsMaturity,
      bondsIssuanceIndex: BigNumber.from(0),
    });

    await mockBorrowPool.mock.getPoolMaturity.returns(bondsMaturity);
    await ethers.provider.send('evm_increaseTime', [ONE_HOUR]);
    await ethers.provider.send('evm_mine', []);

    await expect(user.PositionManager.withdraw(FIRST_TOKEN_ID)).to.revertedWith(
      'POS_POSITION_ONLY_IN_BONDS'
    );
  });
  it('Withdrawing a Position partially then withdrawing after maturity and repay should pass', async () => {
    const newAdjustedAmount = baseAdjustedAmount.div(2);
    const remainingBonds = parseEther('100.0');
    const blockNumAfter = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumAfter);
    const currentTimestamp = block.timestamp;
    const bondsMaturity = BigNumber.from(currentTimestamp);
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    await mockBorrowPool.mock.getPoolMaturity.returns(BigNumber.from(0));
    await mockBorrowPool.mock.getWithdrawAmounts.returns(
      newAdjustedAmount,
      newAdjustedAmount,
      remainingBonds,
      bondsMaturity
    );
    await mockBorrowPool.mock.withdraw.returns(baseAmount);
    await expect(
      user.PositionManager.deposit(
        user.address,
        baseAmount,
        minRate,
        poolHash,
        underlyingToken.address
      )
    ).to.emit(user.PositionManager, 'Deposit');
    await expect(user.PositionManager.withdraw(FIRST_TOKEN_ID))
      .to.emit(user.PositionManager, 'Withdraw')
      .withArgs(
        user.address,
        FIRST_TOKEN_ID,
        baseAmount,
        remainingBonds,
        minRate,
        poolHash
      );
    await checkPosition(user, FIRST_TOKEN_ID, {
      adjustedBalance: newAdjustedAmount,
      rate: minRate,
      poolHash: poolHash,
      underlyingToken: underlyingToken.address,
      remainingBonds: remainingBonds,
      bondsMaturity: bondsMaturity,
      bondsIssuanceIndex: BigNumber.from(0),
    });

    await ethers.provider.send('evm_increaseTime', [ONE_HOUR]);
    await ethers.provider.send('evm_mine', []);

    // In practice, this case should burn the position, but the outcome depends on
    // getWithdrawAmounts returns
    await expect(user.PositionManager.withdraw(FIRST_TOKEN_ID)).to.emit(
      user.PositionManager,
      'Withdraw'
    );
  });
  it('Withdrawing a Position fully should burn the position', async () => {
    const newAdjustedAmount = baseAdjustedAmount;
    const remainingBonds = parseEther('0.0');
    const bondsMaturity = BigNumber.from(0);
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    await mockBorrowPool.mock.getPoolMaturity.returns(BigNumber.from(0));
    await mockBorrowPool.mock.getWithdrawAmounts.returns(
      newAdjustedAmount,
      newAdjustedAmount,
      remainingBonds,
      bondsMaturity
    );
    await mockBorrowPool.mock.withdraw.returns(baseAmount);
    await expect(
      user.PositionManager.deposit(
        user.address,
        baseAmount,
        minRate,
        poolHash,
        underlyingToken.address
      )
    ).to.emit(user.PositionManager, 'Deposit');
    await expect(user.PositionManager.withdraw(FIRST_TOKEN_ID))
      .to.emit(user.PositionManager, 'Transfer')
      .withArgs(user.address, ethers.constants.AddressZero, FIRST_TOKEN_ID);
    await checkPosition(user, FIRST_TOKEN_ID, {
      adjustedBalance: BigNumber.from(0),
      rate: BigNumber.from(0),
      poolHash:
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      underlyingToken: '0x0000000000000000000000000000000000000000',
      remainingBonds: BigNumber.from(0),
      bondsMaturity: BigNumber.from(0),
      bondsIssuanceIndex: BigNumber.from(0),
    });
  });
  it('Depositing and then updating rate into the same block should revert', async () => {
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );

    await expect(
      (user.FlashLoanAttacker as FlashLoanAttacker).attackUpdateRate(
        baseAmount,
        minRate,
        minRate,
        poolHash,
        underlyingToken.address
      )
    ).to.revertedWith('POS_TIMELOCK');
  });
  it('Depositing and then withdrawing into the same block should revert', async () => {
    await mockBorrowPool.mock.deposit.returns(
      baseAdjustedAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    await mockBorrowPool.mock.getPoolMaturity.returns(BigNumber.from(0));

    await expect(
      (user.FlashLoanAttacker as FlashLoanAttacker).attackWithdraw(
        baseAmount,
        minRate,
        poolHash,
        underlyingToken.address
      )
    ).to.revertedWith('POS_TIMELOCK');
  });
  it('Setting the position descriptor address with an address without governance role should revert', async () => {
    await mockBorrowPool.mock.hasRole.returns(false);
    await expect(
      user.PositionManager.setPositionDescriptor(user.address)
    ).to.be.revertedWith('POS_NOT_ALLOWED');
  });
  it('Setting the position descriptor to the zero address should revert', async () => {
    await mockBorrowPool.mock.hasRole.returns(true);
    await expect(
      user.PositionManager.setPositionDescriptor(
        '0x0000000000000000000000000000000000000000'
      )
    ).to.be.revertedWith('POS_ZERO_ADDRESS');
  });
  it('Setting the position descriptor with and address with the right role should pass', async () => {
    await mockBorrowPool.mock.hasRole.returns(true);
    await user.PositionManager.setPositionDescriptor(user.address);
    const positionDescriptor = await user.PositionManager.positionDescriptor();
    expect(positionDescriptor).equal(user.address);
  });

  type PositionData = {
    adjustedBalance: BigNumber;
    rate: BigNumber;
    poolHash: string;
    underlyingToken: string;
    remainingBonds: BigNumber;
    bondsMaturity: BigNumber;
    bondsIssuanceIndex: BigNumber;
  };

  async function checkPosition(
    user: User,
    tokenId: number,
    {
      adjustedBalance,
      rate,
      poolHash,
      underlyingToken,
      remainingBonds,
      bondsMaturity,
      bondsIssuanceIndex,
    }: PositionData
  ): Promise<void> {
    const positionManager = await user.PositionManager._positions(tokenId);
    expect(positionManager.adjustedBalance, 'adjustedBalance').to.equal(
      adjustedBalance
    );
    expect(positionManager.rate, 'rate').to.equal(rate);
    expect(positionManager.poolHash, 'poolHash').to.equal(poolHash);
    expect(positionManager.underlyingToken, 'underlyingToken').to.equal(
      underlyingToken
    );
    expect(positionManager.remainingBonds, 'remainingBonds').to.equal(
      remainingBonds
    );
    expect(positionManager.bondsMaturity, 'bondsMaturity').to.equal(
      bondsMaturity
    );
    expect(positionManager.bondsIssuanceIndex, 'bondsIssuanceIndex').to.equal(
      bondsIssuanceIndex
    );
  }
});

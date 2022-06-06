import {MockContract} from 'ethereum-waffle';
import {deployments} from 'hardhat';

import {defaultAbiCoder} from '@ethersproject/abi';
import {keccak256} from '@ethersproject/keccak256';

import {setupFixture} from '../utils';
import {
  poolHash,
  cooldownPeriod,
  distributionRate,
  lateRepayFeePerBondRate,
  repaymentPeriod,
  loanDuration,
  liquidityRewardsActivationThreshold,
  maxBorrowableAmount,
  maxRateInput,
  minRateInput,
  repaymentFeeRate,
  rateSpacingInput,
  establishmentFeeRate,
} from '../utils/constants';
import {User} from '../utils/types';
import {expect} from './helpers/chai-setup';
import {setupTestContracts} from './utils';
import {parseEther} from 'ethers/lib/utils';

const setup = deployments.createFixture(async () => {
  return setupFixture('BorrowerPools');
});

describe('Borrower Pools - Governance functions', function () {
  let governanceUser: User, user1: User;
  let poolToken: string, otherToken: string;
  let mockLendingPool: MockContract;

  beforeEach(async () => {
    const {deployer, mocks, users} = await setup();
    const {governance, testUser1, poolTokenAddress, otherTokenAddress} =
      await setupTestContracts(deployer, mocks, users);
    user1 = testUser1;
    governanceUser = governance;
    poolToken = poolTokenAddress;
    otherToken = otherTokenAddress;
    mockLendingPool = mocks.ILendingPool;
  });

  it('Creating a pool with an address whithout governance role should revert', async () => {
    await expect(
      user1.BorrowerPools.createNewPool({
        poolHash: poolHash,
        underlyingToken: poolToken,
        yieldProvider: mockLendingPool.address,
        minRate: minRateInput,
        maxRate: maxRateInput,
        rateSpacing: rateSpacingInput,
        maxBorrowableAmount: maxBorrowableAmount,
        loanDuration: loanDuration,
        distributionRate: distributionRate,
        cooldownPeriod: cooldownPeriod,
        repaymentPeriod: repaymentPeriod,
        lateRepayFeePerBondRate: lateRepayFeePerBondRate,
        establishmentFeeRate: establishmentFeeRate,
        repaymentFeeRate: repaymentFeeRate,
        liquidityRewardsActivationThreshold:
          liquidityRewardsActivationThreshold,
        earlyRepay: true,
      })
    ).to.be.revertedWith('');
  });
  it('Creating a pool for an unsupported asset should revert', async () => {
    const newBorrowerName = `${poolHash}-otherToken`;
    const newPoolHash = keccak256(
      defaultAbiCoder.encode(['string'], [newBorrowerName])
    );
    await mockLendingPool.mock.getReserveNormalizedIncome.returns(
      parseEther('1000000000').sub(1)
    );
    await expect(
      governanceUser.BorrowerPools.createNewPool({
        poolHash: newPoolHash,
        underlyingToken: otherToken,
        yieldProvider: mockLendingPool.address,
        minRate: minRateInput,
        maxRate: maxRateInput,
        rateSpacing: rateSpacingInput,
        maxBorrowableAmount: maxBorrowableAmount,
        loanDuration: loanDuration,
        distributionRate: distributionRate,
        cooldownPeriod: cooldownPeriod,
        repaymentPeriod: repaymentPeriod,
        lateRepayFeePerBondRate: lateRepayFeePerBondRate,
        establishmentFeeRate: establishmentFeeRate,
        repaymentFeeRate: repaymentFeeRate,
        liquidityRewardsActivationThreshold:
          liquidityRewardsActivationThreshold,
        earlyRepay: true,
      })
    ).to.be.revertedWith('PC_POOL_TOKEN_NOT_SUPPORTED');
  });
  it('Creating a pool for an existing borrower should revert', async () => {
    await expect(
      governanceUser.BorrowerPools.createNewPool({
        poolHash: poolHash,
        underlyingToken: otherToken,
        yieldProvider: mockLendingPool.address,
        minRate: minRateInput,
        maxRate: maxRateInput,
        rateSpacing: rateSpacingInput,
        maxBorrowableAmount: maxBorrowableAmount,
        loanDuration: loanDuration,
        distributionRate: distributionRate,
        cooldownPeriod: cooldownPeriod,
        repaymentPeriod: repaymentPeriod,
        lateRepayFeePerBondRate: lateRepayFeePerBondRate,
        establishmentFeeRate: establishmentFeeRate,
        repaymentFeeRate: repaymentFeeRate,
        liquidityRewardsActivationThreshold:
          liquidityRewardsActivationThreshold,
        earlyRepay: true,
      })
    ).to.be.revertedWith('PC_POOL_ALREADY_SET_FOR_BORROWER');
  });
  it('Creating a pool with a null identifier should revert', async () => {
    await expect(
      governanceUser.BorrowerPools.createNewPool({
        poolHash:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        underlyingToken: otherToken,
        yieldProvider: mockLendingPool.address,
        minRate: minRateInput,
        maxRate: maxRateInput,
        rateSpacing: rateSpacingInput,
        maxBorrowableAmount: maxBorrowableAmount,
        loanDuration: loanDuration,
        distributionRate: distributionRate,
        cooldownPeriod: cooldownPeriod,
        repaymentPeriod: repaymentPeriod,
        lateRepayFeePerBondRate: lateRepayFeePerBondRate,
        establishmentFeeRate: establishmentFeeRate,
        repaymentFeeRate: repaymentFeeRate,
        liquidityRewardsActivationThreshold:
          liquidityRewardsActivationThreshold,
        earlyRepay: true,
      })
    ).to.be.revertedWith('PC_ZERO_POOL');
  });
  it('Creating a pool for an unrecorded borrower should pass', async () => {
    const newBorrowerName = `${poolHash}-otherToken`;
    const newPoolHash = keccak256(
      defaultAbiCoder.encode(['string'], [newBorrowerName])
    );
    await expect(
      governanceUser.BorrowerPools.createNewPool({
        poolHash: newPoolHash,
        underlyingToken: otherToken,
        yieldProvider: mockLendingPool.address,
        minRate: minRateInput,
        maxRate: maxRateInput,
        rateSpacing: rateSpacingInput,
        maxBorrowableAmount: maxBorrowableAmount,
        loanDuration: loanDuration,
        distributionRate: distributionRate,
        cooldownPeriod: cooldownPeriod,
        repaymentPeriod: repaymentPeriod,
        lateRepayFeePerBondRate: lateRepayFeePerBondRate,
        establishmentFeeRate: establishmentFeeRate,
        repaymentFeeRate: repaymentFeeRate,
        liquidityRewardsActivationThreshold:
          liquidityRewardsActivationThreshold,
        earlyRepay: true,
      })
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolCreated')
      .withArgs([
        newPoolHash,
        otherToken,
        mockLendingPool.address,
        minRateInput,
        maxRateInput,
        rateSpacingInput,
        maxBorrowableAmount,
        loanDuration,
        distributionRate,
        cooldownPeriod,
        repaymentPeriod,
        lateRepayFeePerBondRate,
        establishmentFeeRate,
        repaymentFeeRate,
        liquidityRewardsActivationThreshold,
        true,
      ]);
  });
  it('Creating a pool with right rate spacing should pass', async () => {
    const newBorrowerName = `${poolHash}-otherToken`;
    const newPoolHash = keccak256(
      defaultAbiCoder.encode(['string'], [newBorrowerName])
    );
    const minRateInput = parseEther('0.05');
    const maxRateInput = parseEther('0.25');
    const rateSpacingInput = parseEther('0.01');
    await expect(
      governanceUser.BorrowerPools.createNewPool({
        poolHash: newPoolHash,
        underlyingToken: otherToken,
        yieldProvider: mockLendingPool.address,
        minRate: minRateInput,
        maxRate: maxRateInput,
        rateSpacing: rateSpacingInput,
        maxBorrowableAmount: maxBorrowableAmount,
        loanDuration: loanDuration,
        distributionRate: distributionRate,
        cooldownPeriod: cooldownPeriod,
        repaymentPeriod: repaymentPeriod,
        lateRepayFeePerBondRate: lateRepayFeePerBondRate,
        establishmentFeeRate: establishmentFeeRate,
        repaymentFeeRate: repaymentFeeRate,
        liquidityRewardsActivationThreshold:
          liquidityRewardsActivationThreshold,
        earlyRepay: true,
      })
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolCreated')
      .withArgs([
        newPoolHash,
        otherToken,
        mockLendingPool.address,
        minRateInput,
        maxRateInput,
        rateSpacingInput,
        maxBorrowableAmount,
        loanDuration,
        distributionRate,
        cooldownPeriod,
        repaymentPeriod,
        lateRepayFeePerBondRate,
        establishmentFeeRate,
        repaymentFeeRate,
        liquidityRewardsActivationThreshold,
        true,
      ]);
  });
  it('Creating a pool with misaligned rates should revert', async () => {
    const newBorrowerName = `${poolHash}-otherToken`;
    const newPoolHash = keccak256(
      defaultAbiCoder.encode(['string'], [newBorrowerName])
    );
    const minRateInput = parseEther('0.05');
    const maxRateInput = parseEther('0.3');
    const rateSpacingInput = parseEther('0.1');
    await expect(
      governanceUser.BorrowerPools.createNewPool({
        poolHash: newPoolHash,
        underlyingToken: otherToken,
        yieldProvider: mockLendingPool.address,
        minRate: minRateInput,
        maxRate: maxRateInput,
        rateSpacing: rateSpacingInput,
        maxBorrowableAmount: maxBorrowableAmount,
        loanDuration: loanDuration,
        distributionRate: distributionRate,
        cooldownPeriod: cooldownPeriod,
        repaymentPeriod: repaymentPeriod,
        lateRepayFeePerBondRate: lateRepayFeePerBondRate,
        establishmentFeeRate: establishmentFeeRate,
        repaymentFeeRate: repaymentFeeRate,
        liquidityRewardsActivationThreshold:
          liquidityRewardsActivationThreshold,
        earlyRepay: true,
      })
    ).to.revertedWith('PC_RATE_SPACING_COMPLIANCE');
  });
  it('Creating a pool with establishment rate too high should revert', async () => {
    const newBorrowerName = `${poolHash}-otherToken`;
    const newPoolHash = keccak256(
      defaultAbiCoder.encode(['string'], [newBorrowerName])
    );
    const establishmentFeeRateInput = parseEther('2');
    await expect(
      governanceUser.BorrowerPools.createNewPool({
        poolHash: newPoolHash,
        underlyingToken: otherToken,
        yieldProvider: mockLendingPool.address,
        minRate: minRateInput,
        maxRate: maxRateInput,
        rateSpacing: rateSpacingInput,
        maxBorrowableAmount: maxBorrowableAmount,
        loanDuration: loanDuration,
        distributionRate: distributionRate,
        cooldownPeriod: cooldownPeriod,
        repaymentPeriod: repaymentPeriod,
        lateRepayFeePerBondRate: lateRepayFeePerBondRate,
        establishmentFeeRate: establishmentFeeRateInput,
        repaymentFeeRate: repaymentFeeRate,
        liquidityRewardsActivationThreshold:
          liquidityRewardsActivationThreshold,
        earlyRepay: true,
      })
    ).to.revertedWith('PC_ESTABLISHMENT_FEES_TOO_HIGH');
  });
  it('Allowing a borrower with an address whithout governance role should revert', async () => {
    await expect(
      user1.BorrowerPools.allow(user1.address, poolHash)
    ).to.be.revertedWith(
      `AccessControl: account ${user1.address.toLowerCase()} is missing role 0x71840dc4906352362b0cdaf79870196c8e42acafade72d5d5a6d59291253ceb1`
    );
  });
  it('Allowing an address for the null identifier pool should revert', async () => {
    await expect(
      governanceUser.BorrowerPools.allow(
        user1.address,
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
    ).to.be.revertedWith('PC_ZERO_POOL');
  });
  it('Allowing the zero address should revert', async () => {
    await expect(
      governanceUser.BorrowerPools.allow(
        '0x0000000000000000000000000000000000000000',
        poolHash
      )
    ).to.be.revertedWith('PC_ZERO_ADDRESS');
  });
  it('Allowing a borrower without pool should revert', async () => {
    await expect(
      governanceUser.BorrowerPools.allow(
        user1.address,
        keccak256(defaultAbiCoder.encode(['string'], ['USER_1']))
      )
    ).to.be.revertedWith('PC_POOL_NOT_ACTIVE');
  });
  it('Allowing a borrower with a pool should pass', async () => {
    await expect(
      governanceUser.BorrowerPools.allow(user1.address, poolHash)
    ).to.emit(governanceUser.BorrowerPools, 'BorrowerAllowed');
  });
  it('Disallowing a borrower with an address whithout governance role should revert', async () => {
    await expect(
      user1.BorrowerPools.disallow(user1.address, poolHash)
    ).to.be.revertedWith(
      `AccessControl: account ${user1.address.toLowerCase()} is missing role 0x71840dc4906352362b0cdaf79870196c8e42acafade72d5d5a6d59291253ceb1`
    );
  });
  it('Disallowing a borrower without pool should revert', async () => {
    await expect(
      governanceUser.BorrowerPools.disallow(
        user1.address,
        keccak256(defaultAbiCoder.encode(['string'], ['USER_1']))
      )
    ).to.be.revertedWith('PC_POOL_NOT_ACTIVE');
  });
  it('Disallowing the zero address should revert', async () => {
    await expect(
      governanceUser.BorrowerPools.disallow(
        '0x0000000000000000000000000000000000000000',
        poolHash
      )
    ).to.be.revertedWith('PC_ZERO_ADDRESS');
  });
  it('Disallowing for the zero identifier pool should revert', async () => {
    await expect(
      governanceUser.BorrowerPools.disallow(
        user1.address,
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
    ).to.be.revertedWith('PC_ZERO_POOL');
  });
  it('Disallowing a borrower for the wrong pool should revert', async () => {
    const otherPoolHash = keccak256(
      defaultAbiCoder.encode(['string'], ['USER_1'])
    );
    await governanceUser.BorrowerPools.createNewPool({
      poolHash: otherPoolHash,
      underlyingToken: otherToken,
      yieldProvider: mockLendingPool.address,
      minRate: minRateInput,
      maxRate: maxRateInput,
      rateSpacing: rateSpacingInput,
      maxBorrowableAmount: maxBorrowableAmount,
      loanDuration: loanDuration,
      distributionRate: distributionRate,
      cooldownPeriod: cooldownPeriod,
      repaymentPeriod: repaymentPeriod,
      lateRepayFeePerBondRate: lateRepayFeePerBondRate,
      establishmentFeeRate: establishmentFeeRate,
      repaymentFeeRate: repaymentFeeRate,
      liquidityRewardsActivationThreshold: liquidityRewardsActivationThreshold,
      earlyRepay: true,
    });
    await governanceUser.BorrowerPools.allow(user1.address, poolHash);
    await expect(
      governanceUser.BorrowerPools.disallow(user1.address, otherPoolHash)
    ).to.be.revertedWith('PC_DISALLOW_UNMATCHED_BORROWER');
  });
  it('Disallowing a borrower with a pool should pass', async () => {
    await governanceUser.BorrowerPools.allow(user1.address, poolHash);
    await expect(
      governanceUser.BorrowerPools.disallow(user1.address, poolHash)
    ).to.emit(governanceUser.BorrowerPools, 'BorrowerDisallowed');
  });
  it('Allowing a borrower already allowed on another pool should not pass', async () => {
    const otherPoolHash = keccak256(
      defaultAbiCoder.encode(['string'], ['USER_1'])
    );
    await governanceUser.BorrowerPools.createNewPool({
      poolHash: otherPoolHash,
      underlyingToken: otherToken,
      yieldProvider: mockLendingPool.address,
      minRate: minRateInput,
      maxRate: maxRateInput,
      rateSpacing: rateSpacingInput,
      maxBorrowableAmount: maxBorrowableAmount,
      loanDuration: loanDuration,
      distributionRate: distributionRate,
      cooldownPeriod: cooldownPeriod,
      repaymentPeriod: repaymentPeriod,
      lateRepayFeePerBondRate: lateRepayFeePerBondRate,
      establishmentFeeRate: establishmentFeeRate,
      repaymentFeeRate: repaymentFeeRate,
      liquidityRewardsActivationThreshold: liquidityRewardsActivationThreshold,
      earlyRepay: true,
    });
    await governanceUser.BorrowerPools.allow(user1.address, poolHash);
    await expect(
      governanceUser.BorrowerPools.allow(user1.address, otherPoolHash)
    ).to.be.revertedWith('PC_BORROWER_ALREADY_AUTHORIZED');
  });
});

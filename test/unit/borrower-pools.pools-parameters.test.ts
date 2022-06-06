import {deployments} from 'hardhat';

import {defaultAbiCoder} from '@ethersproject/abi';
import {keccak256} from '@ethersproject/keccak256';
import {parseEther} from '@ethersproject/units';

import {BorrowerPools} from '../../typechain';
import {setupFixture} from '../utils';
import {PoolFeeRates, PoolParameters, User} from '../utils/types';
import {expect} from './helpers/chai-setup';
import {setupTestContracts} from './utils';
import {poolHash} from '../utils/constants';

const setup = deployments.createFixture(async () => {
  return setupFixture('BorrowerPools');
});

describe('Borrower Pools - Parameters', function () {
  let governanceUser: User, user: User;
  let BorrowerPools: BorrowerPools;
  let poolParameters: PoolParameters;
  let poolFeeRates: PoolFeeRates;
  let poolToken: string;

  beforeEach(async () => {
    const {deployer, mocks, users} = await setup();
    const {deployedBorrowerPools, governance, testUser1, poolTokenAddress} =
      await setupTestContracts(deployer, mocks, users);
    BorrowerPools = deployedBorrowerPools;
    poolParameters = await BorrowerPools.getPoolParameters(poolHash);
    poolFeeRates = await BorrowerPools.getPoolFeeRates(poolHash);
    user = testUser1;
    governanceUser = governance;
    poolToken = poolTokenAddress;
  });

  it('Pool created on setup should have valid parameters', async () => {
    expect(poolParameters.underlyingToken).to.equal(poolToken);
    expect(poolParameters.minRate).to.equal(parseEther('0.05'));
    expect(poolParameters.maxRate).to.equal(parseEther('0.20'));
    expect(poolParameters.rateSpacing).to.equal(parseEther('0.005'));
    expect(poolParameters.maxBorrowableAmount).to.equal(parseEther('1000'));
    expect(poolParameters.loanDuration).to.equal(24 * 3600);
    expect(poolParameters.cooldownPeriod).to.equal(360);
    expect(poolParameters.liquidityRewardsDistributionRate).to.equal(
      parseEther('1000')
        .div(20)
        .div(3600 * 24 * 30 * 12)
    );
    expect(poolParameters.repaymentPeriod).to.equal(24 * 3600);
    expect(poolParameters.lateRepayFeePerBondRate).to.equal(0);
    expect(poolFeeRates.establishmentFeeRate).to.equal(0);
    expect(poolFeeRates.repaymentFeeRate).to.equal(0);
    const isEarlyRepay = await user.BorrowerPools.isEarlyRepay(poolHash);
    expect(isEarlyRepay).to.be.true;
  });
  it('Setting max borrowable amount with an address without governance role should revert', async () => {
    const newMaxBorrowableAmount = poolParameters.maxBorrowableAmount.add(1);
    await expect(
      user.BorrowerPools.setMaxBorrowableAmount(
        newMaxBorrowableAmount,
        poolHash
      )
    ).to.be.revertedWith(
      `AccessControl: account ${user.address.toLowerCase()} is missing role 0x71840dc4906352362b0cdaf79870196c8e42acafade72d5d5a6d59291253ceb1`
    );
  });
  it('Setting max borrowable amount for a pool with an inactive borrower should revert', async () => {
    const newMaxBorrowableAmount = poolParameters.maxBorrowableAmount.add(1);
    const inactiveBorrower = keccak256(
      defaultAbiCoder.encode(['string'], ['Inactive Borrower'])
    );
    await expect(
      governanceUser.BorrowerPools.setMaxBorrowableAmount(
        newMaxBorrowableAmount,
        inactiveBorrower
      )
    ).to.be.revertedWith('PC_POOL_NOT_ACTIVE');
  });
  it('Setting max borrowable amount with valid data should pass', async () => {
    const newMaxBorrowableAmount = poolParameters.maxBorrowableAmount.add(1);
    await expect(
      governanceUser.BorrowerPools.setMaxBorrowableAmount(
        newMaxBorrowableAmount,
        poolHash
      )
    ).to.emit(governanceUser.BorrowerPools, 'SetMaxBorrowableAmount');
    poolParameters = await BorrowerPools.getPoolParameters(poolHash);
    expect(poolParameters.maxBorrowableAmount).to.equal(newMaxBorrowableAmount);
  });
  it('Setting liquidity rewards distribution rate with an address without governance role should revert', async () => {
    const newLiquidityRewardsDistributionRate =
      poolParameters.liquidityRewardsDistributionRate.add(1);
    await expect(
      user.BorrowerPools.setLiquidityRewardsDistributionRate(
        newLiquidityRewardsDistributionRate,
        poolHash
      )
    ).to.be.revertedWith(
      `AccessControl: account ${user.address.toLowerCase()} is missing role 0x71840dc4906352362b0cdaf79870196c8e42acafade72d5d5a6d59291253ceb1`
    );
  });
  it('Setting liquidity rewards distribution rate for a pool with an inactive borrower should revert', async () => {
    const newLiquidityRewardsDistributionRate =
      poolParameters.liquidityRewardsDistributionRate.add(1);
    const inactiveBorrower = keccak256(
      defaultAbiCoder.encode(['string'], ['Inactive Borrower'])
    );
    await expect(
      governanceUser.BorrowerPools.setLiquidityRewardsDistributionRate(
        newLiquidityRewardsDistributionRate,
        inactiveBorrower
      )
    ).to.be.revertedWith('PC_POOL_NOT_ACTIVE');
  });
  it('Setting liquidity rewards distribution rate with valid data should pass', async () => {
    const newLiquidityRewardsDistributionRate =
      poolParameters.liquidityRewardsDistributionRate.add(1);
    await expect(
      governanceUser.BorrowerPools.setLiquidityRewardsDistributionRate(
        newLiquidityRewardsDistributionRate,
        poolHash
      )
    ).to.emit(
      governanceUser.BorrowerPools,
      'SetLiquidityRewardsDistributionRate'
    );
    poolParameters = await BorrowerPools.getPoolParameters(poolHash);
    expect(poolParameters.liquidityRewardsDistributionRate).to.equal(
      newLiquidityRewardsDistributionRate
    );
  });
  it('Setting establishment fee rate with an address without governance role should revert', async () => {
    const newEstablishmentFeeRate = poolFeeRates.establishmentFeeRate.add(1);
    await expect(
      user.BorrowerPools.setEstablishmentFeeRate(
        newEstablishmentFeeRate,
        poolHash
      )
    ).to.be.revertedWith(
      `AccessControl: account ${user.address.toLowerCase()} is missing role 0x71840dc4906352362b0cdaf79870196c8e42acafade72d5d5a6d59291253ceb1`
    );
  });
  it('Setting establishment fee rate for a pool with an inactive borrower should revert', async () => {
    const newEstablishmentFeeRate = poolFeeRates.establishmentFeeRate.add(1);
    const inactiveBorrower = keccak256(
      defaultAbiCoder.encode(['string'], ['Inactive Borrower'])
    );
    await expect(
      governanceUser.BorrowerPools.setEstablishmentFeeRate(
        newEstablishmentFeeRate,
        inactiveBorrower
      )
    ).to.be.revertedWith('PC_POOL_NOT_ACTIVE');
  });
  it('Setting establishment fee rate too high should revert', async () => {
    const newEstablishmentFeeRate = parseEther('2');
    await expect(
      governanceUser.BorrowerPools.setEstablishmentFeeRate(
        newEstablishmentFeeRate,
        poolHash
      )
    ).to.be.revertedWith('PC_ESTABLISHMENT_FEES_TOO_HIGH');
  });
  it('Setting establishment fee rate with valid data should pass', async () => {
    const newEstablishmentFeeRate = poolFeeRates.establishmentFeeRate.add(1);
    await expect(
      governanceUser.BorrowerPools.setEstablishmentFeeRate(
        newEstablishmentFeeRate,
        poolHash
      )
    ).to.emit(governanceUser.BorrowerPools, 'SetEstablishmentFeeRate');
    poolFeeRates = await BorrowerPools.getPoolFeeRates(poolHash);
    expect(poolFeeRates.establishmentFeeRate).to.equal(newEstablishmentFeeRate);
  });
  it('Setting repayment fee rate with an address without governance role should revert', async () => {
    const newRepaymentFeeRate = poolFeeRates.repaymentFeeRate.add(1);
    await expect(
      user.BorrowerPools.setRepaymentFeeRate(newRepaymentFeeRate, poolHash)
    ).to.be.revertedWith(
      `AccessControl: account ${user.address.toLowerCase()} is missing role 0x71840dc4906352362b0cdaf79870196c8e42acafade72d5d5a6d59291253ceb1`
    );
  });
  it('Setting repayment fee rate for a pool with an inactive borrower should revert', async () => {
    const newRepaymentFeeRate = poolFeeRates.repaymentFeeRate.add(1);
    const inactiveBorrower = keccak256(
      defaultAbiCoder.encode(['string'], ['Inactive Borrower'])
    );
    await expect(
      governanceUser.BorrowerPools.setRepaymentFeeRate(
        newRepaymentFeeRate,
        inactiveBorrower
      )
    ).to.be.revertedWith('PC_POOL_NOT_ACTIVE');
  });
  it('Setting repayment fee rate with valid data should pass', async () => {
    const newRepaymentFeeRate = poolFeeRates.repaymentFeeRate.add(1);
    await expect(
      governanceUser.BorrowerPools.setRepaymentFeeRate(
        newRepaymentFeeRate,
        poolHash
      )
    ).to.emit(governanceUser.BorrowerPools, 'SetRepaymentFeeRate');
    poolFeeRates = await BorrowerPools.getPoolFeeRates(poolHash);
    expect(poolFeeRates.repaymentFeeRate).to.equal(newRepaymentFeeRate);
  });
});

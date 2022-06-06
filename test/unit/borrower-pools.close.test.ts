import {BigNumber} from 'ethers';
import {deployments} from 'hardhat';

import {BorrowerPools} from '../../typechain';
import {setupFixture} from '../utils';
import {poolHash, FIRST_TOKEN_ID, WAD} from '../utils/constants';
import {PoolParameters, PoolState, User} from '../utils/types';
import {expect} from './helpers/chai-setup';
import {setupTestContracts} from './utils';

const setup = deployments.createFixture(async () => {
  return setupFixture('BorrowerPools');
});

describe('Borrower Pools - Close', function () {
  let positionManager: User, borrower: User, governanceUser: User;
  let BorrowerPools: BorrowerPools;
  let poolParameters: PoolParameters;
  let poolState: PoolState;
  let depositRate: BigNumber, minRate: BigNumber, rateSpacing: BigNumber;
  let poolToken: string;
  const depositAmount: BigNumber = WAD.mul(20); //20 tokens deposited : arbitrary amount for testing purpose

  beforeEach(async () => {
    const {deployer, mocks, users} = await setup();
    const {
      deployedBorrowerPools,
      testBorrower,
      testPositionManager,
      governance,
      poolTokenAddress,
    } = await setupTestContracts(deployer, mocks, users);
    BorrowerPools = deployedBorrowerPools;
    poolParameters = await BorrowerPools.getPoolParameters(poolHash);
    poolState = await BorrowerPools.getPoolState(poolHash);
    minRate = poolParameters.minRate;
    rateSpacing = poolParameters.rateSpacing;
    depositRate = minRate.add(rateSpacing); //Tokens deposited at the min_rate + rate_spacing
    positionManager = testPositionManager;
    borrower = testBorrower;
    governanceUser = governance;
    poolToken = poolTokenAddress;
  });
  it('Closing a pool with an address that does not have the governance role should revert', async function () {
    await expect(
      borrower.BorrowerPools.closePool(poolHash, borrower.address)
    ).to.be.revertedWith(
      `AccessControl: account ${borrower.address.toLowerCase()} is missing role 0x71840dc4906352362b0cdaf79870196c8e42acafade72d5d5a6d59291253ceb1`
    );
  });
  it('Closing a pool with the zero address as recipient should revert', async function () {
    await expect(
      governanceUser.BorrowerPools.closePool(
        poolHash,
        '0x0000000000000000000000000000000000000000'
      )
    ).to.be.revertedWith('PC_ZERO_ADDRESS');
  });
  it('Closing the zero pool should revert', async function () {
    await expect(
      governanceUser.BorrowerPools.closePool(
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        borrower.address
      )
    ).to.be.revertedWith('PC_ZERO_POOL');
  });
  it('Closing a pool that does not exist should revert', async function () {
    await expect(
      governanceUser.BorrowerPools.closePool(
        '0x0000000000000000000000000000000000000000000000000000000000000001',
        borrower.address
      )
    ).to.be.revertedWith('PC_POOL_NOT_ACTIVE');
  });
  it('Estimating loan rate of a closed pool should return 0', async function () {
    await expect(
      governanceUser.BorrowerPools.closePool(poolHash, borrower.address)
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolClosed')
      .withArgs(poolHash, BigNumber.from(0));

    const estimatedRate = await borrower.BorrowerPools.estimateLoanRate(
      depositAmount.div(2),
      poolHash
    );
    expect(estimatedRate.eq(BigNumber.from(0)));
  });
  it('Closing the pool should set the pools state to closed and not withdraw from yield provider if maintenance fee collected is zero', async function () {
    expect(poolState.closed).to.be.false;

    await expect(
      governanceUser.BorrowerPools.closePool(poolHash, borrower.address)
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolClosed')
      .withArgs(poolHash, BigNumber.from(0));

    poolState = await BorrowerPools.getPoolState(poolHash);
    expect(poolState.closed).to.be.true;
  });
  it('Closing the pool should set the pools state to closed and withdraw remaining liquidity rewards', async function () {
    await expect(borrower.BorrowerPools.topUpLiquidityRewards(depositAmount))
      .to.emit(borrower.BorrowerPools, 'TopUpLiquidityRewards')
      .withArgs(poolHash, depositAmount);

    expect(poolState.closed).to.be.false;

    await expect(
      governanceUser.BorrowerPools.closePool(poolHash, borrower.address)
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolClosed')
      .withArgs(poolHash, depositAmount);

    poolState = await BorrowerPools.getPoolState(poolHash);
    expect(poolState.closed).to.be.true;
  });
  it('Closing pool twice should revert', async function () {
    expect(poolState.closed).to.be.false;
    await expect(
      governanceUser.BorrowerPools.closePool(poolHash, borrower.address)
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolClosed')
      .withArgs(poolHash, BigNumber.from(0));

    poolState = await BorrowerPools.getPoolState(poolHash);
    expect(poolState.closed).to.be.true;

    await expect(
      governanceUser.BorrowerPools.closePool(poolHash, borrower.address)
    ).to.be.revertedWith('PC_POOL_ALREADY_CLOSED');
  });
  it('updateRate should not be possible after a pool is closed', async function () {
    await positionManager.PositionManager.deposit(
      positionManager.address,
      depositAmount,
      depositRate,
      poolHash,
      poolToken
    );

    await expect(
      governanceUser.BorrowerPools.closePool(poolHash, borrower.address)
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolClosed')
      .withArgs(poolHash, BigNumber.from(0));

    await expect(
      positionManager.PositionManager.updateRate(1, minRate)
    ).to.be.revertedWith('BP_POOL_CLOSED');
  });
  it('Deposit should not be possible after a pool is closed', async function () {
    await positionManager.PositionManager.deposit(
      positionManager.address,
      depositAmount,
      depositRate,
      poolHash,
      poolToken
    );

    await expect(
      governanceUser.BorrowerPools.closePool(poolHash, borrower.address)
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolClosed')
      .withArgs(poolHash, BigNumber.from(0));

    await expect(
      positionManager.PositionManager.deposit(
        positionManager.address,
        depositAmount,
        depositRate,
        poolHash,
        poolToken
      )
    ).to.be.revertedWith('BP_POOL_CLOSED');
  });
  it('Withdraw should be possible after a pool is closed', async function () {
    await positionManager.PositionManager.deposit(
      positionManager.address,
      depositAmount,
      depositRate,
      poolHash,
      poolToken
    );

    await expect(
      governanceUser.BorrowerPools.closePool(poolHash, borrower.address)
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolClosed')
      .withArgs(poolHash, BigNumber.from(0));

    await positionManager.PositionManager.withdraw(FIRST_TOKEN_ID);
  });
  it('Borrow should not be possible after a pool is closed', async function () {
    await positionManager.PositionManager.deposit(
      positionManager.address,
      depositAmount,
      depositRate,
      poolHash,
      poolToken
    );

    await expect(
      governanceUser.BorrowerPools.closePool(poolHash, borrower.address)
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolClosed')
      .withArgs(poolHash, BigNumber.from(0));

    const borrowAmount = depositAmount;
    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.be.revertedWith('BP_POOL_CLOSED');
  });
});

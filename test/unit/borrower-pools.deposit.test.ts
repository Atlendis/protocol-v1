import {MockContract} from 'ethereum-waffle';
import {BigNumber} from 'ethers';
import {deployments} from 'hardhat';

import {defaultAbiCoder} from '@ethersproject/abi';
import {keccak256} from '@ethersproject/keccak256';

import {BorrowerPools} from '../../typechain';
import {checkPoolUtil, checkTickUtil, setupFixture} from '../utils';
import {
  poolHash,
  RAY,
  TEST_RETURN_YIELD_PROVIDER_LR_RAY,
  WAD,
} from '../utils/constants';
import {PoolParameters, User} from '../utils/types';
import {expect} from './helpers/chai-setup';
import {setupTestContracts} from './utils';

const setup = deployments.createFixture(async () => {
  return setupFixture('BorrowerPools');
});

describe('Borrower Pools - Deposit', function () {
  let user1: User, positionManager: User, governanceUser: User;
  let BorrowerPools: BorrowerPools;
  let poolParameters: PoolParameters;
  let depositRate: BigNumber, minRate: BigNumber, maxRate: BigNumber;
  let poolToken: string;
  let rateSpacing: BigNumber;
  const depositAmount: BigNumber = WAD.mul(20); //20 tokens deposited : arbitrary amount for testing purpose
  let underlyingToken: MockContract;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let checkPoolState: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let checkTickAmounts: any;

  beforeEach(async () => {
    const {deployer, mocks, users} = await setup();
    const {
      deployedBorrowerPools,
      governance,
      testUser1,
      testPositionManager,
      poolTokenAddress,
    } = await setupTestContracts(deployer, mocks, users);
    BorrowerPools = deployedBorrowerPools;
    poolParameters = await BorrowerPools.getPoolParameters(poolHash);
    minRate = poolParameters.minRate;
    maxRate = poolParameters.maxRate;
    rateSpacing = poolParameters.rateSpacing;
    depositRate = minRate.add(rateSpacing); //Tokens deposited at the min_rate + rate_spacing
    user1 = testUser1;
    positionManager = testPositionManager;
    governanceUser = governance;
    poolToken = poolTokenAddress;
    underlyingToken = mocks.DepositToken1;
    checkPoolState = checkPoolUtil(testUser1);
    checkTickAmounts = checkTickUtil(testUser1);
  });
  it('Liquidity ratio on an empty tick should return one', async function () {
    const liquidityRatio = await BorrowerPools.getTickLiquidityRatio(
      poolHash,
      depositRate
    );
    expect(liquidityRatio).to.equal(RAY);
  });
  it('Depositing in a paused pool should revert', async function () {
    await expect(governanceUser.BorrowerPools.freezePool()).to.emit(
      governanceUser.BorrowerPools,
      'Paused'
    );
    await expect(
      positionManager.BorrowerPools.deposit(
        depositRate,
        poolHash,
        poolToken,
        positionManager.address,
        depositAmount
      )
    ).to.revertedWith('Pausable: paused');
  });
  it('Depositing from an address without the positionManager role should revert', async function () {
    await expect(
      user1.BorrowerPools.deposit(
        depositRate,
        poolHash,
        poolToken,
        user1.address,
        depositAmount
      )
    ).to.be.revertedWith(
      `AccessControl: account ${user1.address.toLowerCase()} is missing role 0x27160668f6d81898b09bdae61c61d2c7d23fe33a52ae9b38e5b92f00ced3806b`
    );
  });
  it('Depositing to an inactive borrower pool should revert', async function () {
    const wrongBorrowerHash = keccak256(
      defaultAbiCoder.encode(['string'], ['this_is_wrong'])
    );
    await expect(
      positionManager.BorrowerPools.deposit(
        depositRate,
        wrongBorrowerHash,
        poolToken,
        positionManager.address,
        depositAmount
      )
    ).to.be.revertedWith('BP_POOL_NOT_ACTIVE');
  });
  it('Depositing the wrong underlying token to the pool should revert', async function () {
    await expect(
      positionManager.BorrowerPools.deposit(
        depositRate,
        poolHash,
        positionManager.address,
        positionManager.address,
        depositAmount
      )
    ).to.be.revertedWith('BP_UNMATCHED_TOKEN');
  });
  it('Depositing at a rate below the min rate should revert', async function () {
    await expect(
      positionManager.BorrowerPools.deposit(
        minRate.sub(1),
        poolHash,
        poolToken,
        positionManager.address,
        depositAmount
      )
    ).to.be.revertedWith('BP_OUT_OF_BOUND_MIN_RATE');
  });
  it('Depositing at a rate over the max rate should revert', async function () {
    await expect(
      positionManager.BorrowerPools.deposit(
        maxRate.add(1),
        poolHash,
        poolToken,
        positionManager.address,
        depositAmount
      )
    ).to.be.revertedWith('BP_OUT_OF_BOUND_MAX_RATE');
  });
  it('Depositing at a rate not in sync with the rate spacing should revert', async function () {
    await expect(
      positionManager.BorrowerPools.deposit(
        depositRate.add(1),
        poolHash,
        poolToken,
        positionManager.address,
        depositAmount
      )
    ).to.be.revertedWith('BP_RATE_SPACING');
  });
  it('Depositing should revert in case of failure of underlying token approval', async function () {
    await underlyingToken.mock.approve.returns(false);
    await expect(
      positionManager.BorrowerPools.deposit(
        depositRate,
        poolHash,
        poolToken,
        positionManager.address,
        depositAmount
      )
    ).to.be.revertedWith('SafeERC20: ERC20 operation did not succeed');
  });
  it('Depositing should revert in case of failure of underlying token transfer', async function () {
    await underlyingToken.mock.transferFrom.returns(false);
    await expect(
      positionManager.BorrowerPools.deposit(
        depositRate,
        poolHash,
        poolToken,
        positionManager.address,
        depositAmount
      )
    ).to.be.revertedWith('SafeERC20: ERC20 operation did not succeed');
  });
  it('Depositing to a new tick should initialize that tick and set lower interest rate', async function () {
    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: BigNumber.from(0),
      lowerInterestRate: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: BigNumber.from(0),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: BigNumber.from(0),
      atlendisLiquidityRatio: BigNumber.from(0),
    });

    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount,
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(2),
      normalizedUsedAmount: BigNumber.from(0),
      atlendisLiquidityRatio: TEST_RETURN_YIELD_PROVIDER_LR_RAY,
    });
  });
  it('Depositing to a an existing tick should not initialize the tick', async function () {
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount,
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(2),
      normalizedUsedAmount: BigNumber.from(0),
      atlendisLiquidityRatio: TEST_RETURN_YIELD_PROVIDER_LR_RAY,
    });

    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount.mul(2),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount,
      adjustedRemainingAmount: depositAmount,
      normalizedUsedAmount: BigNumber.from(0),
      atlendisLiquidityRatio: TEST_RETURN_YIELD_PROVIDER_LR_RAY,
    });
  });
  it('Depositing to a lower interest rate should update lower interest rate', async function () {
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await checkPoolState(poolHash, {
      lowerInterestRate: depositRate,
    });

    const newDepositRate = depositRate.sub(rateSpacing);
    await positionManager.BorrowerPools.deposit(
      newDepositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await checkPoolState(poolHash, {
      lowerInterestRate: newDepositRate,
    });
  });
  it('Depositing into equal amounts into two different ticks should update the averageLendingRate to be average of those two tick rates', async function () {
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await positionManager.BorrowerPools.deposit(
      depositRate.add(rateSpacing),
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await checkPoolState(poolHash, {
      averageBorrowRate: depositRate.add(depositRate.add(rateSpacing)).div(2),
    });
  });
});

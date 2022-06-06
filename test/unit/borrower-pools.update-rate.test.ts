import {BigNumber} from 'ethers';
import {deployments} from 'hardhat';

import {BorrowerPools} from '../../typechain';
import {checkPoolUtil, checkTickUtil, setupFixture} from '../utils';
import {
  poolHash,
  FIRST_BOND_ISSUANCE_INDEX,
  NEXT_BOND_ISSUANCE_INDEX,
  WAD,
} from '../utils/constants';
import {PoolParameters, User} from '../utils/types';
import {expect} from './helpers/chai-setup';
import {setupTestContracts} from './utils';

const setup = deployments.createFixture(async () => {
  return setupFixture('BorrowerPools');
});

describe('Borrower Pools - Update Rate', function () {
  let positionManager: User, borrower: User, governanceUser: User;
  let BorrowerPools: BorrowerPools;
  let poolParameters: PoolParameters;
  let depositRate: BigNumber,
    minRate: BigNumber,
    maxRate: BigNumber,
    rateSpacing: BigNumber,
    updatedRate: BigNumber;
  let poolToken: string;
  const depositAmount: BigNumber = WAD.mul(20); //20 tokens deposited : arbitrary amount for testing purpose
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let checkPoolState: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let checkTickAmounts: any;

  beforeEach(async () => {
    const {deployer, mocks, users} = await setup();
    const {
      deployedBorrowerPools,
      governance,
      testBorrower,
      testPositionManager,
      poolTokenAddress,
    } = await setupTestContracts(deployer, mocks, users);
    BorrowerPools = deployedBorrowerPools;
    poolParameters = await BorrowerPools.getPoolParameters(poolHash);
    minRate = poolParameters.minRate;
    maxRate = poolParameters.maxRate;
    rateSpacing = poolParameters.rateSpacing;
    depositRate = minRate.add(rateSpacing); //Tokens deposited at the min_rate + rate_spacing
    updatedRate = depositRate.add(rateSpacing);
    positionManager = testPositionManager;
    borrower = testBorrower;
    governanceUser = governance;
    poolToken = poolTokenAddress;
    checkPoolState = checkPoolUtil(borrower);
    checkTickAmounts = checkTickUtil(borrower);
  });

  it('Updating Rate in a paused pool should revert', async function () {
    await expect(governanceUser.BorrowerPools.freezePool()).to.emit(
      governanceUser.BorrowerPools,
      'Paused'
    );
    await expect(
      positionManager.BorrowerPools.updateRate(
        depositAmount.div(2),
        poolHash,
        depositRate,
        updatedRate,
        FIRST_BOND_ISSUANCE_INDEX
      )
    ).to.revertedWith('Pausable: paused');
  });
  it('Updating Rate from an address without the positionManager role should revert', async function () {
    await expect(
      borrower.BorrowerPools.updateRate(
        depositAmount.div(2),
        poolHash,
        depositRate,
        updatedRate,
        FIRST_BOND_ISSUANCE_INDEX
      )
    ).to.revertedWith(
      `AccessControl: account ${borrower.address.toLowerCase()} is missing role 0x27160668f6d81898b09bdae61c61d2c7d23fe33a52ae9b38e5b92f00ced3806b`
    );
  });
  it('Updating Rate when the position is matched should revert', async function () {
    const borrowAmount = depositAmount;
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount.mul(2)
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);
    await expect(
      positionManager.BorrowerPools.updateRate(
        depositAmount.div(2),
        poolHash,
        depositRate,
        updatedRate,
        FIRST_BOND_ISSUANCE_INDEX
      )
    ).to.revertedWith('BP_LOAN_ONGOING');
  });
  it('Updating Rate with a rate inferior to the minimum should revert', async function () {
    await expect(
      positionManager.BorrowerPools.updateRate(
        depositAmount,
        poolHash,
        depositRate,
        minRate.sub(rateSpacing),
        FIRST_BOND_ISSUANCE_INDEX
      )
    ).to.revertedWith('BP_OUT_OF_BOUND_MIN_RATE');
  });
  it('Updating Rate with a rate superior to the maximum should revert', async function () {
    await expect(
      positionManager.BorrowerPools.updateRate(
        depositAmount,
        poolHash,
        depositRate,
        maxRate.add(rateSpacing),
        FIRST_BOND_ISSUANCE_INDEX
      )
    ).to.revertedWith('BP_OUT_OF_BOUND_MAX_RATE');
  });
  it('Updating Rate with a rate not compatible with the rate spacing should revert', async function () {
    await expect(
      positionManager.BorrowerPools.updateRate(
        depositAmount,
        poolHash,
        depositRate,
        minRate.add(1),
        FIRST_BOND_ISSUANCE_INDEX
      )
    ).to.revertedWith('BP_RATE_SPACING');
  });
  it('Updating Rate to a new tick should update both old and new rates tick', async function () {
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await positionManager.BorrowerPools.updateRate(
      depositAmount.div(2),
      poolHash,
      depositRate,
      updatedRate,
      FIRST_BOND_ISSUANCE_INDEX
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount,
      lowerInterestRate: updatedRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: BigNumber.from(0),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, updatedRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(2),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
  });
  it('Updating Rate of a pending deposit to a new tick should update both old and new rates tick', async function () {
    const borrowAmount = depositAmount;
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: BigNumber.from(0),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: depositAmount,
      adjustedPendingDepositAmount: depositAmount.div(2),
    });

    await positionManager.BorrowerPools.updateRate(
      depositAmount.div(2),
      poolHash,
      depositRate,
      updatedRate,
      NEXT_BOND_ISSUANCE_INDEX
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: BigNumber.from(0),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: depositAmount,
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, updatedRate, {
      adjustedTotalAmount: BigNumber.from(0),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: depositAmount.div(2),
    });
  });
  it('Updating Rate after a position was not matched for a loan should pass', async function () {
    const borrowAmount = depositAmount;
    const otherDepositRate = depositRate.add(rateSpacing.mul(2));
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount.mul(2)
    );
    await positionManager.BorrowerPools.deposit(
      otherDepositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

    await checkTickAmounts(poolHash, otherDepositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(2),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, updatedRate, {
      adjustedTotalAmount: BigNumber.from(0),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });

    await positionManager.BorrowerPools.updateRate(
      depositAmount.div(2),
      poolHash,
      otherDepositRate,
      updatedRate,
      FIRST_BOND_ISSUANCE_INDEX
    );

    await checkTickAmounts(poolHash, otherDepositRate, {
      adjustedTotalAmount: BigNumber.from(0),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, updatedRate, {
      adjustedTotalAmount: BigNumber.from(0),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: depositAmount.div(2),
    });
  });
  it('Updating Rate to an already initialized tick should update both old and new rates tick', async function () {
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await positionManager.BorrowerPools.deposit(
      updatedRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await positionManager.BorrowerPools.updateRate(
      depositAmount.div(2),
      poolHash,
      depositRate,
      updatedRate,
      FIRST_BOND_ISSUANCE_INDEX
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount.mul(2),
      lowerInterestRate: updatedRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: BigNumber.from(0),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, updatedRate, {
      adjustedTotalAmount: depositAmount,
      adjustedRemainingAmount: depositAmount,
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
  });
});

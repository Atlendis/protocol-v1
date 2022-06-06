import {BigNumber} from 'ethers';
import {deployments, ethers} from 'hardhat';

import {defaultAbiCoder} from '@ethersproject/abi';
import {keccak256} from '@ethersproject/keccak256';

import {BorrowerPools} from '../../typechain';
import {
  calcRealizedBondsQuantity,
  checkPoolUtil,
  checkPositionRepartitionUtil,
  checkTickUtil,
  computeBondsQuantity,
  setupFixture,
} from '../utils';
import {
  poolHash,
  FIRST_BOND_ISSUANCE_INDEX,
  NEXT_BOND_ISSUANCE_INDEX,
  RAY,
  TEST_RETURN_YIELD_PROVIDER_LR_RAY,
  WAD,
} from '../utils/constants';
import {PoolParameters, User} from '../utils/types';
import {expect} from './helpers/chai-setup';
import {setupTestContracts} from './utils';
import {MockContract} from 'ethereum-waffle';

const setup = deployments.createFixture(async () => {
  return setupFixture('BorrowerPools');
});

describe('Borrower Pools - Withdraw', function () {
  let positionManager: User, borrower: User, governanceUser: User;
  let BorrowerPools: BorrowerPools;
  let mockLendingPool: MockContract;
  let poolParameters: PoolParameters;
  let depositRate: BigNumber,
    minRate: BigNumber,
    rateSpacing: BigNumber,
    loanDuration: BigNumber,
    liquidityRewardsRate: BigNumber,
    maxBorrowableAmount: BigNumber;
  let poolToken: string;
  const depositAmount: BigNumber = WAD.mul(20); //20 tokens deposited : arbitrary amount for testing purpose
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let checkPoolState: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let checkPositionRepartition: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let checkTickAmounts: any;
  const oneSec = 1;

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
    mockLendingPool = mocks.ILendingPool;
    poolParameters = await BorrowerPools.getPoolParameters(poolHash);
    minRate = poolParameters.minRate;
    rateSpacing = poolParameters.rateSpacing;
    loanDuration = poolParameters.loanDuration;
    liquidityRewardsRate = poolParameters.liquidityRewardsDistributionRate;
    maxBorrowableAmount = poolParameters.maxBorrowableAmount;
    depositRate = minRate.add(rateSpacing); //Tokens deposited at the min_rate + rate_spacing
    positionManager = testPositionManager;
    borrower = testBorrower;
    governanceUser = governance;
    poolToken = poolTokenAddress;
    checkPoolState = checkPoolUtil(borrower);
    checkPositionRepartition = checkPositionRepartitionUtil(borrower);
    checkTickAmounts = checkTickUtil(borrower);
  });

  it('Withdrawing from a paused pool should revert', async function () {
    await expect(governanceUser.BorrowerPools.freezePool()).to.emit(
      governanceUser.BorrowerPools,
      'Paused'
    );
    await expect(
      positionManager.BorrowerPools.withdraw(
        poolHash,
        depositRate,
        depositAmount,
        FIRST_BOND_ISSUANCE_INDEX,
        positionManager.address
      )
    ).to.revertedWith('Pausable: paused');
  });
  it('Withdrawing with a user without positionManager role should revert', async function () {
    await expect(
      borrower.BorrowerPools.withdraw(
        poolHash,
        depositRate,
        depositAmount,
        FIRST_BOND_ISSUANCE_INDEX,
        positionManager.address
      )
    ).to.be.revertedWith(
      `AccessControl: account ${borrower.address.toLowerCase()} is missing role 0x27160668f6d81898b09bdae61c61d2c7d23fe33a52ae9b38e5b92f00ced3806b`
    );
  });
  it('Withdrawing before any deposit happened should revert', async function () {
    await expect(
      positionManager.BorrowerPools.withdraw(
        poolHash,
        depositRate,
        depositAmount,
        FIRST_BOND_ISSUANCE_INDEX,
        positionManager.address
      )
    ).to.be.revertedWith('BP_TARGET_BOND_ISSUANCE_INDEX_EMPTY');
  });
  it('Withdrawing zero amount should revert', async function () {
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await expect(
      positionManager.BorrowerPools.withdraw(
        poolHash,
        depositRate,
        0,
        FIRST_BOND_ISSUANCE_INDEX,
        positionManager.address
      )
    ).to.be.revertedWith('BP_NO_DEPOSIT_TO_WITHDRAW');
  });
  it('Getting Withdraw amount when a pool is inactive should revert', async function () {
    const inactiveBorrower = keccak256(
      defaultAbiCoder.encode(['string'], ['Inactive Borrower'])
    );
    // withdraw amount is adjusted
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);

    await expect(
      positionManager.BorrowerPools.getWithdrawAmounts(
        inactiveBorrower,
        depositRate,
        withdrawAmount,
        FIRST_BOND_ISSUANCE_INDEX
      )
    ).to.be.revertedWith('BP_POOL_NOT_ACTIVE');
  });
  it('Getting Withdraw amount after a deposit but before a borrow should return the whole deposited amount', async function () {
    // withdraw amount is adjusted
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    const amounts = await positionManager.BorrowerPools.getWithdrawAmounts(
      poolHash,
      depositRate,
      withdrawAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    expect(amounts.adjustedAmountToWithdraw.eq(withdrawAmount)).to.be.true;
    expect(amounts.depositedAmountToWithdraw.eq(withdrawAmount)).to.be.true;
    expect(amounts.remainingBondsQuantity.isZero()).to.be.true;
    expect(amounts.bondsMaturity.isZero()).to.be.true;
  });
  it('Withdrawing an amount should update pool balances', async function () {
    // withdraw amount is adjusted
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await positionManager.BorrowerPools.withdraw(
      poolHash,
      depositRate,
      withdrawAmount,
      FIRST_BOND_ISSUANCE_INDEX,
      positionManager.address
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: BigNumber.from(0),
      lowerInterestRate: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: BigNumber.from(0),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
  });
  it('Getting Withdraw amounts after a deposit and a partial borrow should return part of the requested amount', async function () {
    const borrowAmount = depositAmount.div(2);
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

    const amounts = await positionManager.BorrowerPools.getWithdrawAmounts(
      poolHash,
      depositRate,
      withdrawAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    const expectedBondsQuantity = await computeBondsQuantity(
      borrowAmount,
      depositRate,
      loanDuration
    );
    expect(amounts.adjustedAmountToWithdraw.eq(withdrawAmount.div(2))).to.be
      .true;
    expect(amounts.depositedAmountToWithdraw.eq(withdrawAmount.div(2))).to.be
      .true;
    expect(
      amounts.remainingBondsQuantity.sub(expectedBondsQuantity).abs().lt(10)
    ).to.be.true;
    expect(amounts.bondsMaturity.isZero()).to.be.false;
  });
  it('Withdrawing after a deposit and a partial borrow should include a share of the accrued fees', async function () {
    const borrowAmount = depositAmount;
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);
    await borrower.BorrowerPools.topUpLiquidityRewards(depositAmount);

    const expectedBondsQuantity = await computeBondsQuantity(
      depositAmount.div(2),
      depositRate,
      loanDuration
    );
    const expectedPeekLiquidityRewards = liquidityRewardsRate
      .mul(oneSec)
      .mul(maxBorrowableAmount.sub(borrowAmount))
      .div(maxBorrowableAmount);
    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount,
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount,
      adjustedRemainingAmount: depositAmount.div(2),
      normalizedUsedAmount: depositAmount,
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: expectedBondsQuantity,
        normalizedAmount: [
          depositAmount.div(2).add(expectedPeekLiquidityRewards.div(2)),
          depositAmount.div(2).add(expectedPeekLiquidityRewards),
        ],
      }
    );

    await ethers.provider.send('evm_increaseTime', [loanDuration.toNumber()]);
    await ethers.provider.send('evm_mine', []);

    const amounts = await positionManager.BorrowerPools.getWithdrawAmounts(
      poolHash,
      depositRate,
      withdrawAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    expect(amounts.adjustedAmountToWithdraw.eq(withdrawAmount.div(2))).to.be
      .true;
    await positionManager.BorrowerPools.withdraw(
      poolHash,
      depositRate,
      amounts.adjustedAmountToWithdraw,
      FIRST_BOND_ISSUANCE_INDEX,
      positionManager.address
    );

    const expectedLiquidityRewards = liquidityRewardsRate
      .mul(loanDuration.add(2 * oneSec))
      .mul(maxBorrowableAmount.sub(depositAmount))
      .div(maxBorrowableAmount);
    const additionalLiquidityRewards = liquidityRewardsRate
      .mul(oneSec)
      .mul(maxBorrowableAmount.sub(depositAmount))
      .div(maxBorrowableAmount);

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: [
        depositAmount.div(2).add(expectedLiquidityRewards.div(2)),
        depositAmount
          .div(2)
          .add(expectedLiquidityRewards.add(additionalLiquidityRewards).div(2)),
      ],
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.mul(3).div(4),
      adjustedRemainingAmount: depositAmount.div(4),
      normalizedUsedAmount: depositAmount,
      adjustedPendingDepositAmount: BigNumber.from(0),
      accruedFees: [
        expectedLiquidityRewards.div(2),
        expectedLiquidityRewards.add(additionalLiquidityRewards).div(2),
      ],
    });
    // check for the second positionManager - should remain the same as before the first positionManager withdrawal
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: expectedBondsQuantity,
        normalizedAmount: [
          depositAmount.div(2).add(expectedLiquidityRewards.div(2)),
          depositAmount
            .div(2)
            .add(
              expectedLiquidityRewards.add(additionalLiquidityRewards).div(2)
            ),
        ],
      }
    );
  });
  it('Withdrawing multiple positions after a deposit and a partial borrow should maintain the positions proportions', async function () {
    const borrowAmount = depositAmount;
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

    const expectedBondsQuantity = await computeBondsQuantity(
      depositAmount.div(2),
      depositRate,
      loanDuration
    );
    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount,
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount,
      adjustedRemainingAmount: depositAmount.div(2),
      normalizedUsedAmount: depositAmount,
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: expectedBondsQuantity,
        normalizedAmount: depositAmount.div(2),
      }
    );

    await positionManager.BorrowerPools.withdraw(
      poolHash,
      depositRate,
      withdrawAmount.div(2),
      FIRST_BOND_ISSUANCE_INDEX,
      positionManager.address
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount.div(2),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.mul(3).div(4),
      adjustedRemainingAmount: depositAmount.div(4),
      normalizedUsedAmount: depositAmount,
      adjustedPendingDepositAmount: BigNumber.from(0),
      accruedFees: BigNumber.from(0),
    });
    // check for the second positionManager - should remain the same as before the first positionManager withdrawal
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: expectedBondsQuantity,
        normalizedAmount: depositAmount.div(2),
      }
    );

    await positionManager.BorrowerPools.withdraw(
      poolHash,
      depositRate,
      withdrawAmount.div(2),
      FIRST_BOND_ISSUANCE_INDEX,
      positionManager.address
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
      accruedFees: BigNumber.from(0),
    });
  });
  it('Getting Withdraw amounts after a deposit and a full borrow should return the only bonds', async function () {
    const borrowAmount = depositAmount;
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
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
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

    const amounts = await positionManager.BorrowerPools.getWithdrawAmounts(
      poolHash,
      depositRate,
      withdrawAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );
    const expectedBondsQuantity = await computeBondsQuantity(
      borrowAmount,
      depositRate,
      loanDuration
    );
    expect(amounts.adjustedAmountToWithdraw.isZero()).to.be.true;
    expect(amounts.depositedAmountToWithdraw.isZero()).to.be.true;
    expect(
      amounts.remainingBondsQuantity.sub(expectedBondsQuantity).abs().lt(10)
    ).to.be.true;
    expect(amounts.bondsMaturity.isZero()).to.be.false;
  });
  it('Withdrawing after a deposit and a full borrow should revert', async function () {
    const borrowAmount = depositAmount;
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
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
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

    await expect(
      positionManager.BorrowerPools.withdraw(
        poolHash,
        depositRate,
        withdrawAmount,
        FIRST_BOND_ISSUANCE_INDEX,
        positionManager.address
      )
    ).to.be.revertedWith('BP_TARGET_BOND_ISSUANCE_INDEX_EMPTY');
  });
  it('Getting Withdraw amounts after a pending deposit from a tick that was not borrowed should return the whole amount', async function () {
    const borrowAmount = depositAmount;
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);
    await positionManager.BorrowerPools.deposit(
      depositRate.add(rateSpacing),
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
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, depositRate.add(rateSpacing), {
      adjustedTotalAmount: BigNumber.from(0),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: depositAmount.div(2),
    });

    const amounts = await positionManager.BorrowerPools.getWithdrawAmounts(
      poolHash,
      depositRate.add(rateSpacing),
      withdrawAmount,
      NEXT_BOND_ISSUANCE_INDEX
    );
    expect(amounts.adjustedAmountToWithdraw.eq(withdrawAmount)).to.be.true;
    expect(amounts.depositedAmountToWithdraw.eq(withdrawAmount)).to.be.true;
    expect(amounts.remainingBondsQuantity.isZero()).to.be.true;
    expect(amounts.bondsMaturity.isZero()).to.be.false;
  });
  it('Withdrawing a pending deposit from a tick that was not borrowed should withdraw the whole requested amount', async function () {
    const borrowAmount = depositAmount;
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);
    await positionManager.BorrowerPools.deposit(
      depositRate.add(rateSpacing),
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
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, depositRate.add(rateSpacing), {
      adjustedTotalAmount: BigNumber.from(0),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: depositAmount.div(2),
    });

    await positionManager.BorrowerPools.withdraw(
      poolHash,
      depositRate.add(rateSpacing),
      withdrawAmount,
      NEXT_BOND_ISSUANCE_INDEX,
      positionManager.address
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: BigNumber.from(0),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate.add(rateSpacing), {
      adjustedTotalAmount: BigNumber.from(0),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
  });
  it('Withdrawing from the current bond issuance index while there is no remaining amount should revert', async function () {
    const borrowAmount = depositAmount;
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);
    await positionManager.BorrowerPools.deposit(
      depositRate.add(rateSpacing),
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await expect(
      positionManager.BorrowerPools.withdraw(
        poolHash,
        depositRate.add(rateSpacing),
        withdrawAmount,
        FIRST_BOND_ISSUANCE_INDEX,
        positionManager.address
      )
    ).to.be.revertedWith('BP_TARGET_BOND_ISSUANCE_INDEX_EMPTY');
  });
  it('Withdrawing from the next bond issuance index while there is no pending amount should revert', async function () {
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await expect(
      positionManager.BorrowerPools.withdraw(
        poolHash,
        depositRate,
        withdrawAmount,
        NEXT_BOND_ISSUANCE_INDEX,
        positionManager.address
      )
    ).to.be.revertedWith('BP_TARGET_BOND_ISSUANCE_INDEX_EMPTY');
  });
  it('Withdrawing from a bond issuance index too high should revert', async function () {
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await expect(
      positionManager.BorrowerPools.withdraw(
        poolHash,
        depositRate,
        withdrawAmount,
        NEXT_BOND_ISSUANCE_INDEX.add(1),
        positionManager.address
      )
    ).to.be.revertedWith('BP_BOND_ISSUANCE_ID_TOO_HIGH');
  });
  it('Withdrawing the whole remaining amount in a tick should update the lower interest rate', async function () {
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
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

    await positionManager.BorrowerPools.withdraw(
      poolHash,
      depositRate,
      withdrawAmount,
      FIRST_BOND_ISSUANCE_INDEX,
      positionManager.address
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount,
      lowerInterestRate: depositRate.add(rateSpacing),
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: BigNumber.from(0),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
  });
  it('Withdrawing remaining then pending amounts after a borrow should update data accordingly', async function () {
    const borrowAmount = depositAmount.div(2);
    const withdrawRemainingAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
    const withdrawPendingAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
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

    const amounts = await positionManager.BorrowerPools.getWithdrawAmounts(
      poolHash,
      depositRate,
      withdrawRemainingAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );

    await positionManager.BorrowerPools.withdraw(
      poolHash,
      depositRate,
      amounts.adjustedAmountToWithdraw,
      FIRST_BOND_ISSUANCE_INDEX,
      positionManager.address
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: BigNumber.from(0),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(4),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: depositAmount.div(2),
      adjustedPendingDepositAmount: depositAmount.div(2),
    });

    await positionManager.BorrowerPools.withdraw(
      poolHash,
      depositRate,
      withdrawPendingAmount,
      NEXT_BOND_ISSUANCE_INDEX,
      positionManager.address
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: BigNumber.from(0),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(4),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: depositAmount.div(2),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
  });
  it('Withdrawing pending then remaining amounts after a borrow should update data accordingly', async function () {
    const borrowAmount = depositAmount.div(2);
    const withdrawRemainingAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
    const withdrawPendingAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
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

    await positionManager.BorrowerPools.withdraw(
      poolHash,
      depositRate,
      withdrawPendingAmount,
      NEXT_BOND_ISSUANCE_INDEX,
      positionManager.address
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount.div(2),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(4),
      normalizedUsedAmount: depositAmount.div(2),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });

    const amounts = await positionManager.BorrowerPools.getWithdrawAmounts(
      poolHash,
      depositRate,
      withdrawRemainingAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );

    await positionManager.BorrowerPools.withdraw(
      poolHash,
      depositRate,
      amounts.adjustedAmountToWithdraw,
      FIRST_BOND_ISSUANCE_INDEX,
      positionManager.address
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: BigNumber.from(0),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(4),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: depositAmount.div(2),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
  });
  it('Withdrawing a positionManager after multiple deposits, a borrow and a repay should return the whole positionManager including bonds interests', async function () {
    const borrowAmount = depositAmount.mul(2);
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
      depositAmount.mul(2)
    );

    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

    await ethers.provider.send('evm_increaseTime', [
      poolParameters.loanDuration.toNumber(),
    ]);
    await ethers.provider.send('evm_mine', []);
    const currentMaturity = (await BorrowerPools.getPoolState(poolHash))
      .currentMaturity;
    await expect(borrower.BorrowerPools.repay()).to.emit(
      borrower.BorrowerPools,
      'Repay'
    );

    const firstDepositExpectedBondsQuantity = await computeBondsQuantity(
      depositAmount,
      depositRate,
      loanDuration
    );

    const realizedFirstExpectedBondsQuantity = await calcRealizedBondsQuantity(
      currentMaturity,
      firstDepositExpectedBondsQuantity,
      depositRate
    );

    const secondDepositExpectedBondsQuantity = await computeBondsQuantity(
      depositAmount,
      depositRate.add(rateSpacing),
      loanDuration
    );
    const realizedSecondExpectedBondsQuantity = await calcRealizedBondsQuantity(
      currentMaturity,
      secondDepositExpectedBondsQuantity,
      depositRate.add(rateSpacing)
    );
    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: realizedFirstExpectedBondsQuantity
        .add(realizedSecondExpectedBondsQuantity)
        .add(depositAmount),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(2),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, depositRate.add(rateSpacing), {
      adjustedTotalAmount: depositAmount,
      adjustedRemainingAmount: depositAmount,
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: realizedFirstExpectedBondsQuantity,
      }
    );
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate.add(rateSpacing),
        adjustedAmount: depositAmount,
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount:
          realizedSecondExpectedBondsQuantity.add(depositAmount),
      }
    );

    const amounts = await positionManager.BorrowerPools.getWithdrawAmounts(
      poolHash,
      depositRate,
      depositAmount.div(2),
      FIRST_BOND_ISSUANCE_INDEX
    );

    await positionManager.BorrowerPools.withdraw(
      poolHash,
      depositRate,
      amounts.adjustedAmountToWithdraw,
      FIRST_BOND_ISSUANCE_INDEX,
      positionManager.address
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits:
        realizedSecondExpectedBondsQuantity.add(depositAmount),
      lowerInterestRate: depositRate.add(rateSpacing),
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: BigNumber.from(0),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, depositRate.add(rateSpacing), {
      adjustedTotalAmount: depositAmount,
      adjustedRemainingAmount: depositAmount,
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate.add(rateSpacing),
        adjustedAmount: depositAmount,
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount:
          realizedSecondExpectedBondsQuantity.add(depositAmount),
      }
    );
  });
  it('Withdrawing from several ticks after a yield provider lr update should not impact withdraw amounts', async function () {
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
      normalizedAvailableDeposits: depositAmount.mul(2),
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(2),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, depositRate.add(rateSpacing), {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(2),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });

    await mockLendingPool.mock.getReserveNormalizedIncome.returns(
      TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(2)
    );

    await expect(
      positionManager.BorrowerPools.withdraw(
        poolHash,
        depositRate,
        depositAmount.div(2),
        FIRST_BOND_ISSUANCE_INDEX,
        positionManager.address
      )
    )
      .to.emit(positionManager.BorrowerPools, 'TickWithdrawRemaining')
      .withArgs(
        poolHash,
        depositRate,
        depositAmount.div(2),
        TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(2),
        BigNumber.from(0)
      );

    await expect(
      positionManager.BorrowerPools.withdraw(
        poolHash,
        depositRate.add(rateSpacing),
        depositAmount.div(2),
        FIRST_BOND_ISSUANCE_INDEX,
        positionManager.address
      )
    )
      .to.emit(positionManager.BorrowerPools, 'TickWithdrawRemaining')
      .withArgs(
        poolHash,
        depositRate.add(rateSpacing),
        depositAmount.div(2),
        TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(2),
        BigNumber.from(0)
      );
  });

  // Test illustration of the issue #69
  it('Getting withdraw amounts of a fully borrowed tick with low amount should not revert', async () => {
    // The LR is modified in order to obtain a value where the precision issue occurs, i.e. where low amounts are considered.
    // This is simulated by having very high liquidity ratio.
    const testReturnYieldProviderLrRay =
      TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(3);
    await mockLendingPool.mock.getReserveNormalizedIncome.returns(
      testReturnYieldProviderLrRay
    );

    const depositAmount = WAD.div(10);
    // The first tick is fully borrowed
    const borrowAmount = depositAmount.add(depositAmount.div(2));

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

    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

    const tickAdjustedAmounts =
      await positionManager.BorrowerPools.getTickAmounts(poolHash, depositRate);

    const amounts = await positionManager.BorrowerPools.getWithdrawAmounts(
      poolHash,
      depositRate,
      tickAdjustedAmounts.adjustedTotalAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );

    expect(amounts.adjustedAmountToWithdraw.eq(0)).to.be.true;
    expect(amounts.depositedAmountToWithdraw.eq(0)).to.be.true;
    expect(amounts.remainingBondsQuantity.isZero()).to.be.false;
    expect(amounts.bondsMaturity.isZero()).to.be.false;

    await mockLendingPool.mock.getReserveNormalizedIncome.returns(
      TEST_RETURN_YIELD_PROVIDER_LR_RAY
    );
  });

  // Test illustration of the issue #69
  it('Getting withdraw amounts of an almost fully borrowed tick with low amount should not revert', async () => {
    // The LR is modified in order to obtain a value where the precision issue occurs, i.e. where low amounts are considered.
    // This is simulated by having very high liquidity ratio.
    const testReturnYieldProviderLrRay =
      TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(3);
    await mockLendingPool.mock.getReserveNormalizedIncome.returns(
      testReturnYieldProviderLrRay
    );

    const depositAmount = WAD.div(10);
    // The first tick is almost fully borrowed
    const borrowAmount = depositAmount.sub(1e2);

    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

    const tickAdjustedAmounts =
      await positionManager.BorrowerPools.getTickAmounts(poolHash, depositRate);

    const amounts = await positionManager.BorrowerPools.getWithdrawAmounts(
      poolHash,
      depositRate,
      tickAdjustedAmounts.adjustedTotalAmount,
      FIRST_BOND_ISSUANCE_INDEX
    );

    expect(amounts.adjustedAmountToWithdraw.eq(0)).to.be.true;
    expect(amounts.depositedAmountToWithdraw.eq(0)).to.be.true;
    expect(amounts.remainingBondsQuantity.isZero()).to.be.false;
    expect(amounts.bondsMaturity.isZero()).to.be.false;

    await mockLendingPool.mock.getReserveNormalizedIncome.returns(
      TEST_RETURN_YIELD_PROVIDER_LR_RAY
    );
  });
});

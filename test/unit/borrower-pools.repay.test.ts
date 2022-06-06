import {MockContract} from 'ethereum-waffle';
import {BigNumber} from 'ethers';
import {keccak256, defaultAbiCoder, parseEther} from 'ethers/lib/utils';
import {deployments, ethers} from 'hardhat';

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
  distributionRate,
  FIRST_BOND_ISSUANCE_INDEX,
  lateRepayFeePerBondRate,
  liquidityRewardsActivationThreshold,
  maxRateInput,
  minRateInput,
  repaymentFeeRate,
  NEXT_BOND_ISSUANCE_INDEX,
  rateSpacingInput,
  RAY,
  TEST_RETURN_YIELD_PROVIDER_LR_RAY,
  WAD,
  secondsPerYear,
  establishmentFeeRate,
} from '../utils/constants';
import {PoolParameters, User} from '../utils/types';
import {expect} from './helpers/chai-setup';
import {setupTestContracts} from './utils';

const setup = deployments.createFixture(async () => {
  return setupFixture('BorrowerPools');
});

describe('Borrower Pools - Repay', function () {
  let positionManager: User, borrower: User, governanceUser: User;
  let BorrowerPools: BorrowerPools;
  let poolParameters: PoolParameters;
  let depositRate: BigNumber,
    minRate: BigNumber,
    rateSpacing: BigNumber,
    loanDuration: BigNumber,
    repaymentPeriod: BigNumber,
    cooldownPeriod: BigNumber,
    liquidityRewardsRate: BigNumber,
    maxBorrowableAmount: BigNumber;
  let poolToken: string;
  let mockLendingPool: MockContract;
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
      testBorrower,
      testPositionManager,
      governance,
      poolTokenAddress,
    } = await setupTestContracts(deployer, mocks, users);
    BorrowerPools = deployedBorrowerPools;
    poolParameters = await BorrowerPools.getPoolParameters(poolHash);
    minRate = poolParameters.minRate;
    rateSpacing = poolParameters.rateSpacing;
    loanDuration = poolParameters.loanDuration;
    repaymentPeriod = poolParameters.repaymentPeriod;
    cooldownPeriod = poolParameters.cooldownPeriod;
    liquidityRewardsRate = poolParameters.liquidityRewardsDistributionRate;
    maxBorrowableAmount = poolParameters.maxBorrowableAmount;
    depositRate = minRate.add(rateSpacing); //Tokens deposited at the min_rate + rate_spacing
    positionManager = testPositionManager;
    borrower = testBorrower;
    governanceUser = governance;
    poolToken = poolTokenAddress;
    mockLendingPool = mocks.ILendingPool;
    checkPoolState = checkPoolUtil(borrower);
    checkPositionRepartition = checkPositionRepartitionUtil(borrower);
    checkTickAmounts = checkTickUtil(borrower);
  });

  it('Repaying in a paused pool should revert', async function () {
    await expect(governanceUser.BorrowerPools.freezePool()).to.emit(
      governanceUser.BorrowerPools,
      'Paused'
    );
    await expect(borrower.BorrowerPools.repay()).to.revertedWith(
      'Pausable: paused'
    );
  });
  it('Repaying with a user which does not have the borrow role should revert', async function () {
    await expect(positionManager.BorrowerPools.repay()).to.be.revertedWith(
      `AccessControl: account ${positionManager.address.toLowerCase()} is missing role 0x2344277e405079ec07749d374ba0b5862a4e45a6a05ac889dbb4a991c6f9354d`
    );
  });
  it('Early Repaying from a pool in which EARLY_REPAY is false should revert', async function () {
    const newBorrowerName = `${poolHash}-otherToken`;
    const newPoolHash = keccak256(
      defaultAbiCoder.encode(['string'], [newBorrowerName])
    );

    await expect(
      governanceUser.BorrowerPools.createNewPool({
        poolHash: newPoolHash,
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
        earlyRepay: false,
      })
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolCreated')
      .withArgs([
        newPoolHash,
        poolToken,
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
        false,
      ]);

    await positionManager.BorrowerPools.deposit(
      depositRate,
      newPoolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await governanceUser.BorrowerPools.disallow(borrower.address, poolHash);
    await governanceUser.BorrowerPools.allow(borrower.address, newPoolHash);
    await borrower.BorrowerPools.borrow(borrower.address, depositAmount);
    await expect(borrower.BorrowerPools.repay()).to.be.revertedWith(
      'BP_EARLY_REPAY_NOT_ACTIVATED'
    );
  });
  it('Repaying without any pre existing borrow should revert', async function () {
    await expect(borrower.BorrowerPools.repay()).to.be.revertedWith(
      'BP_REPAY_NO_ACTIVE_LOAN'
    );
  });
  it('Repaying after maturity but before late repay threshold should update all the ticks data accordingly', async function () {
    const borrowAmount = depositAmount;
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: BigNumber.from(0),
      lowerInterestRate: depositRate,
      normalizedBorrowedAmount: borrowAmount,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: depositAmount,
      adjustedPendingDepositAmount: BigNumber.from(0),
    });

    const expectedBondsQuantity = await computeBondsQuantity(
      depositAmount,
      depositRate,
      loanDuration
    );
    await ethers.provider.send('evm_increaseTime', [loanDuration.toNumber()]);
    await ethers.provider.send('evm_mine', []);
    const currentMaturity = (await BorrowerPools.getPoolState(poolHash))
      .currentMaturity;
    await expect(borrower.BorrowerPools.repay()).to.emit(
      borrower.BorrowerPools,
      'Repay'
    );
    const realizedExpectedBondsQuantity = await calcRealizedBondsQuantity(
      currentMaturity,
      expectedBondsQuantity,
      depositRate
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: realizedExpectedBondsQuantity,
      lowerInterestRate: depositRate,
      normalizedBorrowedAmount: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(2),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
  });
  it('Depositing after a repaid loan without pending amount should adjust the amount with the new liquidity ratio', async function () {
    const borrowAmount = depositAmount;
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

    const expectedBondsQuantity = await computeBondsQuantity(
      depositAmount,
      depositRate,
      loanDuration
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
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: expectedBondsQuantity,
        normalizedAmount: BigNumber.from(0),
      }
    );

    await ethers.provider.send('evm_increaseTime', [loanDuration.toNumber()]);
    await ethers.provider.send('evm_mine', []);
    const currentMaturity = (await BorrowerPools.getPoolState(poolHash))
      .currentMaturity;
    await borrower.BorrowerPools.repay();

    const realizedExpectedBondsQuantity = await calcRealizedBondsQuantity(
      currentMaturity,
      expectedBondsQuantity,
      depositRate
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: realizedExpectedBondsQuantity,
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(2),
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
        normalizedAmount: realizedExpectedBondsQuantity,
      }
    );

    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    const expectedLiquidityRatioIncrease = realizedExpectedBondsQuantity
      .sub(depositAmount)
      .mul(RAY)
      .div(depositAmount.div(2));
    const expectedLiquidityRatio = TEST_RETURN_YIELD_PROVIDER_LR_RAY.add(
      expectedLiquidityRatioIncrease
    );
    // normalizedAvailableDeposits in pool should equal the positions repartition normalized amount sum
    await checkPoolState(poolHash, {
      normalizedAvailableDeposits:
        realizedExpectedBondsQuantity.add(depositAmount),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount
        .div(2)
        .add(depositAmount.mul(RAY).div(expectedLiquidityRatio)),
      adjustedRemainingAmount: depositAmount
        .div(2)
        .add(depositAmount.mul(RAY).div(expectedLiquidityRatio)),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
      atlendisLiquidityRatio: expectedLiquidityRatio,
    });
    // check for 1st deposit
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: realizedExpectedBondsQuantity,
      }
    );
    // check for 2nd deposit - bonds issuance index is only increased when there has been pending amounts during the loan
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.mul(RAY).div(expectedLiquidityRatio),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount,
      }
    );
  });
  it('Repaying should include pending amount from borrowed ticks in remaining amount and update bond issuance index multiplier to exclude pending amount from bonds interests', async function () {
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

    const expectedBondsQuantity = await computeBondsQuantity(
      depositAmount,
      depositRate,
      loanDuration
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
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: expectedBondsQuantity,
        normalizedAmount: BigNumber.from(0),
      }
    );
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: NEXT_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount,
      }
    );

    await ethers.provider.send('evm_increaseTime', [loanDuration.toNumber()]);
    await ethers.provider.send('evm_mine', []);
    const currentMaturity = (await BorrowerPools.getPoolState(poolHash))
      .currentMaturity;
    await borrower.BorrowerPools.repay();

    const blockNum = await ethers.provider.getBlockNumber();
    const timestamp = (await ethers.provider.getBlock(blockNum)).timestamp;

    const beyondExpectedTime = BigNumber.from(timestamp).sub(currentMaturity);
    const realizedExpectedBondsQuantity = await computeBondsQuantity(
      expectedBondsQuantity,
      depositRate,
      beyondExpectedTime
    );

    const expectedLiquidityRatioIncrease = realizedExpectedBondsQuantity
      .sub(depositAmount)
      .mul(RAY)
      .div(depositAmount.div(2));
    const expectedLiquidityRatio = TEST_RETURN_YIELD_PROVIDER_LR_RAY.add(
      expectedLiquidityRatioIncrease
    );
    const expectedBondsIssuanceIndexMultiplier =
      TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(RAY).div(expectedLiquidityRatio);
    await checkPoolState(poolHash, {
      normalizedAvailableDeposits:
        realizedExpectedBondsQuantity.add(depositAmount),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount
        .div(2)
        .add(
          depositAmount
            .div(2)
            .mul(expectedBondsIssuanceIndexMultiplier)
            .div(RAY)
        ),
      adjustedRemainingAmount: depositAmount
        .div(2)
        .add(
          depositAmount
            .div(2)
            .mul(expectedBondsIssuanceIndexMultiplier)
            .div(RAY)
        ),
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
        normalizedAmount: realizedExpectedBondsQuantity,
      }
    );
    // the adjusted amount from the point of view of the positionManager did not change
    // however the multiplier changed the pool vision of the adjusted amount
    // so that the pending deposits are excluded from bond interests
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: NEXT_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount,
      }
    );
  });
  it('Depositing after pending deposits were included in remaining amount after a repay should adjust the amount with both liquidity ratio and bonds issuance index multiplier', async function () {
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

    const expectedBondsQuantity = await computeBondsQuantity(
      depositAmount,
      depositRate,
      loanDuration
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
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: expectedBondsQuantity,
        normalizedAmount: BigNumber.from(0),
      }
    );
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: NEXT_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount,
      }
    );

    await ethers.provider.send('evm_increaseTime', [loanDuration.toNumber()]);
    await ethers.provider.send('evm_mine', []);
    const currentMaturity = (await BorrowerPools.getPoolState(poolHash))
      .currentMaturity;
    await borrower.BorrowerPools.repay();
    const realizedExpectedBondsQuantity = await calcRealizedBondsQuantity(
      currentMaturity,
      expectedBondsQuantity,
      depositRate
    );

    const expectedLiquidityRatioIncrease = realizedExpectedBondsQuantity
      .sub(depositAmount)
      .mul(RAY)
      .div(depositAmount.div(2));
    const expectedLiquidityRatio = TEST_RETURN_YIELD_PROVIDER_LR_RAY.add(
      expectedLiquidityRatioIncrease
    );
    const expectedBondsIssuanceIndexMultiplier =
      TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(RAY).div(expectedLiquidityRatio);
    await checkPoolState(poolHash, {
      normalizedAvailableDeposits:
        realizedExpectedBondsQuantity.add(depositAmount),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount
        .div(2)
        .add(
          depositAmount
            .div(2)
            .mul(expectedBondsIssuanceIndexMultiplier)
            .div(RAY)
        ),
      adjustedRemainingAmount: depositAmount
        .div(2)
        .add(
          depositAmount
            .div(2)
            .mul(expectedBondsIssuanceIndexMultiplier)
            .div(RAY)
        ),
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
        normalizedAmount: realizedExpectedBondsQuantity,
      }
    );
    // the adjusted amount from the point of view of the positionManager did not change
    // however the multiplier changed the pool vision of the adjusted amount
    // so that the pending deposits are excluded from bond interests
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: NEXT_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount,
      }
    );
  });
  it('Repaying should include pending amount from unborrowed ticks in remaining amount and update bond issuance index multiplier to exclude pending amount from bonds interests', async function () {
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
      depositRate.add(rateSpacing),
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    const expectedBondsQuantity = await computeBondsQuantity(
      depositAmount,
      depositRate,
      loanDuration
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
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: expectedBondsQuantity,
        normalizedAmount: BigNumber.from(0),
      }
    );
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate.add(rateSpacing),
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: NEXT_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount,
      }
    );

    await ethers.provider.send('evm_increaseTime', [loanDuration.toNumber()]);
    await ethers.provider.send('evm_mine', []);
    const currentMaturity = (await BorrowerPools.getPoolState(poolHash))
      .currentMaturity;
    await borrower.BorrowerPools.repay();
    const realizedExpectedBondsQuantity = await calcRealizedBondsQuantity(
      currentMaturity,
      expectedBondsQuantity,
      depositRate
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits:
        realizedExpectedBondsQuantity.add(depositAmount),
      lowerInterestRate: depositRate,
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
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: realizedExpectedBondsQuantity,
      }
    );
    // the adjusted amount from the point of view of the positionManager did not change
    // however the multiplier changed the pool vision of the adjusted amount
    // so that the pending deposits are excluded from bond interests
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate.add(rateSpacing),
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: NEXT_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount,
      }
    );
  });
  it('Repaying should include accrued fees from liquidity rewards into liquidity ratio and reset accrued fees', async function () {
    const borrowAmount = depositAmount.div(2);
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
      normalizedAvailableDeposits: [depositAmount.div(2)],
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(4),
      normalizedUsedAmount: depositAmount.div(2),
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
          depositAmount.div(2).add(expectedPeekLiquidityRewards),
        ],
      }
    );

    await ethers.provider.send('evm_increaseTime', [loanDuration.toNumber()]);
    await ethers.provider.send('evm_mine', []);
    const currentMaturity = (await BorrowerPools.getPoolState(poolHash))
      .currentMaturity;
    await borrower.BorrowerPools.repay();

    const realizedExpectedBondsQuantity = await calcRealizedBondsQuantity(
      currentMaturity,
      expectedBondsQuantity,
      depositRate
    );

    const expectedLoanDurationLiquidityRewards = liquidityRewardsRate
      .mul(loanDuration)
      .mul(maxBorrowableAmount.sub(depositAmount.div(2)))
      .div(maxBorrowableAmount);

    const expectedAdditionalLiquidityRewards = liquidityRewardsRate
      .mul(oneSec)
      .mul(maxBorrowableAmount.sub(depositAmount.div(2)))
      .div(maxBorrowableAmount);

    const expectedNormalizedAvailableDeposits = depositAmount
      .div(2)
      .add(realizedExpectedBondsQuantity)
      .add(expectedLoanDurationLiquidityRewards);

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: [
        expectedNormalizedAvailableDeposits.add(
          expectedAdditionalLiquidityRewards.mul(2)
        ),
        expectedNormalizedAvailableDeposits.add(
          expectedAdditionalLiquidityRewards.mul(3)
        ),
      ],
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(2),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
      accruedFees: BigNumber.from(0),
    });

    const expectedNormalizedAmount = depositAmount
      .div(2)
      .add(realizedExpectedBondsQuantity)
      .add(expectedLoanDurationLiquidityRewards)
      .add(expectedAdditionalLiquidityRewards.mul(2));
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: [
          expectedNormalizedAmount,
          expectedNormalizedAmount.add(expectedAdditionalLiquidityRewards),
        ],
      }
    );
  });
  it('Repaying should include accrued fees from yield provider into liquidity ratio and reset accrued fees', async function () {
    const borrowAmount = depositAmount.div(2);
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
      normalizedAvailableDeposits: depositAmount.div(2),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(4),
      normalizedUsedAmount: depositAmount.div(2),
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

    await mockLendingPool.mock.getReserveNormalizedIncome.returns(
      TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(2)
    );
    await ethers.provider.send('evm_increaseTime', [loanDuration.toNumber()]);
    await ethers.provider.send('evm_mine', []);
    const currentMaturity = (await BorrowerPools.getPoolState(poolHash))
      .currentMaturity;
    await borrower.BorrowerPools.repay();
    const realizedExpectedBondsQuantity = await calcRealizedBondsQuantity(
      currentMaturity,
      expectedBondsQuantity,
      depositRate
    );
    const expectedLiquidityRewards = depositAmount
      .div(4)
      .mul(TEST_RETURN_YIELD_PROVIDER_LR_RAY)
      .div(RAY);

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount
        .div(2)
        .add(realizedExpectedBondsQuantity)
        .add(expectedLiquidityRewards),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(2),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
      accruedFees: BigNumber.from(0),
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
        normalizedAmount: depositAmount
          .div(2)
          .add(realizedExpectedBondsQuantity)
          .add(expectedLiquidityRewards),
      }
    );
  });
  it('Repaying after maturity and late repay threshold should update all the ticks data accordingly', async function () {
    // overwriting custom deploy in beforeEach to set custom lateRepayFeePerBondRate
    const {deployer, mocks, users} = await setup();
    const {
      deployedBorrowerPools,
      testBorrower,
      testPositionManager,
      governance,
      poolTokenAddress,
    } = await setupTestContracts(deployer, mocks, users, depositAmount.div(2));
    BorrowerPools = deployedBorrowerPools;
    poolParameters = await BorrowerPools.getPoolParameters(poolHash);
    minRate = poolParameters.minRate;
    rateSpacing = poolParameters.rateSpacing;
    loanDuration = poolParameters.loanDuration;
    repaymentPeriod = poolParameters.repaymentPeriod;
    cooldownPeriod = poolParameters.cooldownPeriod;
    liquidityRewardsRate = poolParameters.liquidityRewardsDistributionRate;
    maxBorrowableAmount = poolParameters.maxBorrowableAmount;
    depositRate = minRate.add(rateSpacing); //Tokens deposited at the min_rate + rate_spacing
    positionManager = testPositionManager;
    borrower = testBorrower;
    governanceUser = governance;
    poolToken = poolTokenAddress;
    mockLendingPool = mocks.ILendingPool;
    checkPoolState = checkPoolUtil(borrower);
    checkPositionRepartition = checkPositionRepartitionUtil(borrower);
    checkTickAmounts = checkTickUtil(borrower);

    const lateRepayFeePerBondRate = depositAmount.div(2);
    const borrowAmount = depositAmount;

    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

    let liquidityRatio = await BorrowerPools.getTickLiquidityRatio(
      poolHash,
      depositRate
    );
    expect(liquidityRatio).to.equal(TEST_RETURN_YIELD_PROVIDER_LR_RAY);
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

    await ethers.provider.send('evm_increaseTime', [
      loanDuration.toNumber() + repaymentPeriod.toNumber() + oneSec,
    ]);
    await ethers.provider.send('evm_mine', []);

    const currentMaturity = (await BorrowerPools.getPoolState(poolHash))
      .currentMaturity;

    const expectedBondsQuantity = await computeBondsQuantity(
      depositAmount,
      depositRate,
      loanDuration
    );

    const repayAmounts = await governanceUser.BorrowerPools.getRepayAmounts(
      poolHash,
      false
    );

    const currentExpectedBondsQuantity = await calcRealizedBondsQuantity(
      currentMaturity,
      expectedBondsQuantity,
      depositRate
    );
    const expectedLateRepayFeePerSec = lateRepayFeePerBondRate
      .mul(currentExpectedBondsQuantity)
      .div(WAD)
      .mul(oneSec);
    let expectedLateRepayFee = expectedLateRepayFeePerSec.mul(oneSec);

    // fees depending on time can cause test flakyness
    expect(
      currentExpectedBondsQuantity
        .add(expectedLateRepayFee)
        .sub(repayAmounts[0])
        .abs()
        .lt(30) ||
        currentExpectedBondsQuantity
          .add(expectedLateRepayFee.add(expectedLateRepayFeePerSec))
          .sub(repayAmounts[0])
          .abs()
          .lt(30)
    ).to.be.true;

    await expect(borrower.BorrowerPools.repay()).to.emit(
      borrower.BorrowerPools,
      'LateRepay'
    );
    const realizedExpectedBondsQuantity = await calcRealizedBondsQuantity(
      currentMaturity,
      expectedBondsQuantity,
      depositRate
    );

    liquidityRatio = await BorrowerPools.getTickLiquidityRatio(
      poolHash,
      depositRate
    );

    const realizedLateRepayFeePerSec = lateRepayFeePerBondRate
      .mul(realizedExpectedBondsQuantity)
      .div(WAD)
      .mul(oneSec);

    expectedLateRepayFee = realizedLateRepayFeePerSec.mul(2 * oneSec);
    const expectedLiquidityRatioIncrease = realizedExpectedBondsQuantity
      .add(expectedLateRepayFee)
      .sub(depositAmount)
      .mul(RAY)
      .div(depositAmount.div(2));
    const additionalLiquidityRatioIncrease = realizedLateRepayFeePerSec
      .mul(RAY)
      .div(depositAmount.div(2));
    // fees depending on time can cause test flakyness
    expect(
      liquidityRatio
        .sub(
          TEST_RETURN_YIELD_PROVIDER_LR_RAY.add(expectedLiquidityRatioIncrease)
        )
        .abs()
        .lt(10e9) ||
        liquidityRatio
          .sub(
            TEST_RETURN_YIELD_PROVIDER_LR_RAY.add(
              expectedLiquidityRatioIncrease
            ).add(additionalLiquidityRatioIncrease)
          )
          .abs()
          .lt(10e9)
    ).to.be.true;

    await checkPoolState(poolHash, {
      // TODO: fix brittle test
      // normalizedAvailableDeposits: [
      //   realizedExpectedBondsQuantity.add(expectedLateRepayFee),
      //   realizedExpectedBondsQuantity
      //     .add(expectedLateRepayFee)
      //     .add(expectedLateRepayFeePerSec),
      // ],
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(2),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
  });
  it('Repaying should trigger a cooldown period during which new Borrowing should revert', async function () {
    const borrowAmount = depositAmount;
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

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

    await ethers.provider.send('evm_increaseTime', [loanDuration.toNumber()]);
    await ethers.provider.send('evm_mine', []);
    await expect(borrower.BorrowerPools.repay()).to.emit(
      borrower.BorrowerPools,
      'Repay'
    );

    await ethers.provider.send('evm_increaseTime', [
      cooldownPeriod.div(2).toNumber(),
    ]);
    await ethers.provider.send('evm_mine', []);

    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.revertedWith('BP_BORROW_COOLDOWN_PERIOD_NOT_OVER');
  });
  it('Repaying should trigger a cooldown period after which new Borrowing should pass', async function () {
    const borrowAmount = depositAmount;
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

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

    await ethers.provider.send('evm_increaseTime', [loanDuration.toNumber()]);
    await ethers.provider.send('evm_mine', []);
    await expect(borrower.BorrowerPools.repay()).to.emit(
      borrower.BorrowerPools,
      'Repay'
    );

    await ethers.provider.send('evm_increaseTime', [cooldownPeriod.toNumber()]);
    await ethers.provider.send('evm_mine', []);

    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(borrower.BorrowerPools, 'Borrow');
  });
  it('Next loan min start should be set from the repay block timestamp', async function () {
    const borrowAmount = depositAmount;
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

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

    await ethers.provider.send('evm_increaseTime', [
      loanDuration.add(repaymentPeriod.div(2)).toNumber(),
    ]);
    await ethers.provider.send('evm_mine', []);
    await expect(borrower.BorrowerPools.repay()).to.emit(
      borrower.BorrowerPools,
      'Repay'
    );

    const blockNumAfter = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumAfter);
    const currentTimestamp = block.timestamp;

    const nextLoanMinStart = (
      await borrower.BorrowerPools.getPoolState(poolHash)
    ).nextLoanMinStart;
    expect(
      nextLoanMinStart
        .sub(cooldownPeriod.add(currentTimestamp))
        .eq(BigNumber.from(0))
    );
  });
  it('Early repay should have the Atlendis LR only include bond interest payments that have accrued', async function () {
    const borrowAmount = depositAmount;
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

    // verify that early repay amount is less that regular repay amount
    const earlyRepayAmounts =
      await governanceUser.BorrowerPools.getRepayAmounts(poolHash, true);
    const regularRepayAmounts =
      await governanceUser.BorrowerPools.getRepayAmounts(poolHash, true);
    expect(regularRepayAmounts[0].gt(earlyRepayAmounts[0]));

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

    await ethers.provider.send('evm_increaseTime', [
      loanDuration.div(2).toNumber(),
    ]);
    await ethers.provider.send('evm_mine', []);
    await expect(borrower.BorrowerPools.repay()).to.emit(
      borrower.BorrowerPools,
      'EarlyRepay'
    );

    const expectedBondsQuantityRepay = await computeBondsQuantity(
      depositAmount,
      depositRate,
      loanDuration
    );

    const bondPrice = parseEther('1')
      .mul(parseEther('1'))
      .add(parseEther('1').div(2))
      .div(
        parseEther('1').add(
          depositRate.mul(loanDuration.div(2).sub(oneSec)).div(secondsPerYear)
        )
      );

    // Note: Calculating the expectedBondsQuantityEarlyRepay through computeBondsQuantity does not give precise result
    // Hence we replicate the exact wadray lib math used in the protocol
    const expectedBondsQuantityEarlyRepay = expectedBondsQuantityRepay
      .mul(bondPrice)
      .add(parseEther('1').div(2))
      .div(parseEther('1'));

    const expectedLiquidityRatioIncrease = expectedBondsQuantityEarlyRepay
      .sub(depositAmount)
      .mul(RAY)
      .div(depositAmount.div(2));

    const expectedLiquidityRatio = TEST_RETURN_YIELD_PROVIDER_LR_RAY.add(
      expectedLiquidityRatioIncrease
    );

    // because of lack of precision in tx scheduling during tests, bond price can be slightly different
    // we do the calculations twice to account for that extra second that can modify test results
    const otherBondPrice = parseEther('1')
      .mul(parseEther('1'))
      .add(parseEther('1').div(2))
      .div(
        parseEther('1').add(
          depositRate
            .mul(loanDuration.div(2).sub(2 * oneSec))
            .div(secondsPerYear)
        )
      );
    const otherBondsQuantityEarlyRepay = expectedBondsQuantityRepay
      .mul(otherBondPrice)
      .add(parseEther('1').div(2))
      .div(parseEther('1'));

    const otherLiquidityRatioIncrease = otherBondsQuantityEarlyRepay
      .sub(depositAmount)
      .mul(RAY)
      .div(depositAmount.div(2));

    const otherLiquidityRatio = TEST_RETURN_YIELD_PROVIDER_LR_RAY.add(
      otherLiquidityRatioIncrease
    );

    await checkTickAmounts(poolHash, depositRate, {
      atlendisLiquidityRatio: [expectedLiquidityRatio, otherLiquidityRatio],
    });
  });
});

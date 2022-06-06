import {MockContract} from 'ethereum-waffle';
import {BigNumber} from 'ethers';
import {deployments, ethers} from 'hardhat';

import {BorrowerPools} from '../../typechain';
import {
  checkPoolUtil,
  checkPositionRepartitionUtil,
  checkTickUtil,
  computeBondsQuantity,
  setupFixture,
} from '../utils';
import {
  FIRST_BOND_ISSUANCE_INDEX,
  NEXT_BOND_ISSUANCE_INDEX,
  poolHash,
  TEST_RETURN_YIELD_PROVIDER_LR_RAY,
  WAD,
} from '../utils/constants';
import {PoolParameters, User} from '../utils/types';
import {expect} from './helpers/chai-setup';
import {setupTestContracts} from './utils';

const setup = deployments.createFixture(async () => {
  return setupFixture('BorrowerPools');
});

describe('Borrower Pools - Borrow', function () {
  let positionManager: User, borrower: User, governanceUser: User;
  let BorrowerPools: BorrowerPools;
  let poolParameters: PoolParameters;
  let mockLendingPool: MockContract;
  let depositRate: BigNumber,
    minRate: BigNumber,
    rateSpacing: BigNumber,
    loanDuration: BigNumber,
    repaymentPeriod: BigNumber,
    maxBorrowableAmount: BigNumber;
  let poolToken: string;
  const depositAmount: BigNumber = WAD.mul(20); //20 tokens deposited : arbitrary amount for testing purpose
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let checkPoolState: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let checkPositionRepartition: any;
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
    rateSpacing = poolParameters.rateSpacing;
    depositRate = minRate.add(rateSpacing); //Tokens deposited at the min_rate + rate_spacing
    loanDuration = poolParameters.loanDuration;
    repaymentPeriod = poolParameters.repaymentPeriod;
    maxBorrowableAmount = poolParameters.maxBorrowableAmount;
    positionManager = testPositionManager;
    borrower = testBorrower;
    governanceUser = governance;
    poolToken = poolTokenAddress;
    checkPoolState = checkPoolUtil(borrower);
    checkPositionRepartition = checkPositionRepartitionUtil(borrower);
    checkTickAmounts = checkTickUtil(borrower);
    mockLendingPool = mocks.ILendingPool;

    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
  });

  it('Borrowing in a paused pool should revert', async function () {
    await expect(governanceUser.BorrowerPools.freezePool()).to.emit(
      governanceUser.BorrowerPools,
      'Paused'
    );
    await expect(
      borrower.BorrowerPools.borrow(borrower.address, depositAmount)
    ).to.revertedWith('Pausable: paused');
  });
  it('Borrowing in a defaulted pool should revert', async function () {
    const borrowAmount = depositAmount;
    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(borrower.BorrowerPools, 'Borrow');
    await ethers.provider.send('evm_increaseTime', [
      loanDuration.add(repaymentPeriod).add(1).toNumber(),
    ]);
    await expect(governanceUser.BorrowerPools.setDefault(poolHash)).to.emit(
      governanceUser.BorrowerPools,
      'Default'
    );
    await expect(
      borrower.BorrowerPools.borrow(borrower.address, depositAmount)
    ).to.revertedWith('BP_POOL_DEFAULTED');
  });
  it('Borrowing from an address without the borrower role should revert', async function () {
    const borrowAmount = depositAmount;
    await expect(
      positionManager.BorrowerPools.borrow(
        positionManager.address,
        borrowAmount
      )
    ).to.be.revertedWith(
      `AccessControl: account ${positionManager.address.toLowerCase()} is missing role 0x2344277e405079ec07749d374ba0b5862a4e45a6a05ac889dbb4a991c6f9354d`
    );
  });
  it('Borrowing more than the total deposited amount should revert', async function () {
    const borrowAmount = depositAmount.mul(2);
    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.be.revertedWith('BP_BORROW_OUT_OF_BOUND_AMOUNT');
  });
  it('Borrowing more than the max borrowable amount should revert', async function () {
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      maxBorrowableAmount
    );
    const borrowAmount = maxBorrowableAmount.add(1);
    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.be.revertedWith('BP_BORROW_MAX_BORROWABLE_AMOUNT_EXCEEDED');
  });
  it('Estimating loan rate while active loan should return 0', async function () {
    const borrowAmount = depositAmount;
    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(borrower.BorrowerPools, 'Borrow');

    const estimatedRate = await borrower.BorrowerPools.estimateLoanRate(
      depositAmount.div(2),
      poolHash
    );
    expect(estimatedRate.eq(BigNumber.from(0)));
  });
  it('Estimating loan rate for more than max borrowable amount should return the same as max borrowable amount', async function () {
    await positionManager.BorrowerPools.deposit(
      minRate,
      poolHash,
      poolToken,
      positionManager.address,
      maxBorrowableAmount
    );

    let estimatedRate = await borrower.BorrowerPools.estimateLoanRate(
      maxBorrowableAmount,
      poolHash
    );
    expect(estimatedRate.eq(minRate));

    estimatedRate = await borrower.BorrowerPools.estimateLoanRate(
      maxBorrowableAmount.mul(2),
      poolHash
    );
    expect(estimatedRate.eq(minRate));
  });
  it('Estimating loan rate should return the right rate', async function () {
    const newDepositRate = depositRate.add(rateSpacing.mul(2));
    await positionManager.BorrowerPools.deposit(
      newDepositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount.mul(2)
    );

    let estimatedRate = await borrower.BorrowerPools.estimateLoanRate(
      depositAmount.div(2),
      poolHash
    );
    expect(estimatedRate.eq(depositRate));

    estimatedRate = await borrower.BorrowerPools.estimateLoanRate(
      depositAmount,
      poolHash
    );
    expect(estimatedRate.eq(depositRate));

    estimatedRate = await borrower.BorrowerPools.estimateLoanRate(
      depositAmount.mul(2),
      poolHash
    );
    expect(estimatedRate.eq(depositRate.add(rateSpacing)));

    estimatedRate = await borrower.BorrowerPools.estimateLoanRate(
      depositAmount.mul(3),
      poolHash
    );
    const expectedRate = depositRate.add(rateSpacing.mul(3).div(2));
    expect(estimatedRate.eq(expectedRate));
  });
  it('Borrowing from a single tick should update the tick data accordingly', async function () {
    const borrowAmount = depositAmount;
    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(borrower.BorrowerPools, 'Borrow');

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: BigNumber.from(0),
      lowerInterestRate: depositRate,
      averageBorrowRate: depositRate,
      normalizedBorrowedAmount: borrowAmount,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: depositAmount,
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
  });
  it('Borrowing from subsequent multiple ticks should update the ticks data accordingly', async function () {
    const borrowAmount = depositAmount.mul(2);
    const newDepositRate = depositRate.add(rateSpacing);
    await positionManager.BorrowerPools.deposit(
      newDepositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount.mul(2)
    );

    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount,
      }
    );
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: newDepositRate,
        adjustedAmount: depositAmount,
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount.mul(2),
      }
    );

    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(borrower.BorrowerPools, 'Borrow');

    const firstExpectedBondsQuantity = await computeBondsQuantity(
      depositAmount,
      depositRate,
      loanDuration
    );
    const secondExpectedBondsQuantity = await computeBondsQuantity(
      depositAmount,
      newDepositRate,
      loanDuration
    );
    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount,
      lowerInterestRate: depositRate,
      averageBorrowRate: depositRate.add(newDepositRate).div(2),
      normalizedBorrowedAmount: borrowAmount,
    });

    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: depositAmount,
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, depositRate.add(rateSpacing), {
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
        bondsQuantity: firstExpectedBondsQuantity,
        normalizedAmount: BigNumber.from(0),
      }
    );
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: newDepositRate,
        adjustedAmount: depositAmount,
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: secondExpectedBondsQuantity,
        normalizedAmount: depositAmount,
      }
    );
  });
  it('Borrowing from non subsequent multiple ticks should update the ticks data accordingly', async function () {
    const borrowAmount = depositAmount.mul(2);
    const newDepositRate = depositRate.add(rateSpacing.mul(2));
    await positionManager.BorrowerPools.deposit(
      newDepositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount.mul(2)
    );

    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount,
      }
    );
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: newDepositRate,
        adjustedAmount: depositAmount,
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount.mul(2),
      }
    );

    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(borrower.BorrowerPools, 'Borrow');

    const firstExpectedBondsQuantity = await computeBondsQuantity(
      depositAmount,
      depositRate,
      loanDuration
    );
    const secondExpectedBondsQuantity = await computeBondsQuantity(
      depositAmount,
      newDepositRate,
      loanDuration
    );
    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount,
      lowerInterestRate: depositRate,
      averageBorrowRate: depositRate.add(newDepositRate).div(2),
      normalizedBorrowedAmount: borrowAmount,
    });

    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: depositAmount,
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, newDepositRate, {
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
        bondsQuantity: firstExpectedBondsQuantity,
        normalizedAmount: BigNumber.from(0),
      }
    );
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: newDepositRate,
        adjustedAmount: depositAmount,
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: secondExpectedBondsQuantity,
        normalizedAmount: depositAmount,
      }
    );
  });
  it('Depositing after a borrow should send the amount into the pending amount', async function () {
    const borrowAmount = depositAmount;
    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(borrower.BorrowerPools, 'Borrow');

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
    const expectedBondsQuantity = await computeBondsQuantity(
      depositAmount,
      depositRate,
      loanDuration
    );
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
  });
  it('Borrowing multiple times from a single tick should update the tick data accordingly', async function () {
    const borrowAmount = depositAmount.div(2);
    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(borrower.BorrowerPools, 'Borrow');

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount.div(2),
      lowerInterestRate: depositRate,
      averageBorrowRate: depositRate,
      normalizedBorrowedAmount: borrowAmount,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(4),
      normalizedUsedAmount: depositAmount.div(2),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });

    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(borrower.BorrowerPools, 'FurtherBorrow');
    const firstBondsQuantity = await computeBondsQuantity(
      borrowAmount,
      depositRate,
      loanDuration
    );
    const secondBondsQuantity = await computeBondsQuantity(
      borrowAmount,
      depositRate,
      loanDuration.sub(1)
    );
    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: BigNumber.from(0),
      lowerInterestRate: depositRate,
      averageBorrowRate: depositRate,
      normalizedBorrowedAmount: borrowAmount.mul(2),
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: BigNumber.from(0),
      bondsQuantity: firstBondsQuantity.add(secondBondsQuantity),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
  });
  it('Borrowing multiple times for a total amount higher than the maximum borrowable amount should revert', async function () {
    const borrowAmount = depositAmount.div(2);
    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(borrower.BorrowerPools, 'Borrow');

    await expect(
      borrower.BorrowerPools.borrow(borrower.address, depositAmount.mul(100))
    ).to.revertedWith('BP_BORROW_MAX_BORROWABLE_AMOUNT_EXCEEDED');
  });
  it('Borrowing multiple times from multiple ticks should update the ticks data accordingly', async function () {
    const borrowAmount = depositAmount.div(2);
    const newDepositRate = depositRate.add(rateSpacing);
    await positionManager.BorrowerPools.deposit(
      newDepositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount,
      }
    );
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: newDepositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount,
      }
    );

    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(borrower.BorrowerPools, 'Borrow');

    const expectedBondsQuantity = await computeBondsQuantity(
      borrowAmount,
      depositRate,
      loanDuration
    );
    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount.mul(3).div(2),
      lowerInterestRate: depositRate,
      averageBorrowRate: depositRate,
      normalizedBorrowedAmount: borrowAmount,
      bondsIssuedQuantity: expectedBondsQuantity,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(4),
      normalizedUsedAmount: borrowAmount,
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
        bondsQuantity: expectedBondsQuantity,
        normalizedAmount: depositAmount.div(2),
      }
    );
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: newDepositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount,
      }
    );

    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount.mul(2))
    ).to.emit(borrower.BorrowerPools, 'FurtherBorrow');

    const firstExpectedBondsQuantity = await computeBondsQuantity(
      borrowAmount,
      depositRate,
      loanDuration.sub(1)
    );
    const secondExpectedBondsQuantity = await computeBondsQuantity(
      borrowAmount,
      newDepositRate,
      loanDuration.sub(1)
    );
    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount.div(2),
      lowerInterestRate: depositRate,
      normalizedBorrowedAmount: borrowAmount.mul(3),
      bondsIssuedQuantity: expectedBondsQuantity
        .add(firstExpectedBondsQuantity)
        .add(secondExpectedBondsQuantity),
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: BigNumber.from(0),
      bondsQuantity: expectedBondsQuantity.add(firstExpectedBondsQuantity),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, depositRate.add(rateSpacing), {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(4),
      bondsQuantity: secondExpectedBondsQuantity,
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
        bondsQuantity: expectedBondsQuantity.add(firstExpectedBondsQuantity),
        normalizedAmount: BigNumber.from(0),
      }
    );
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: newDepositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: secondExpectedBondsQuantity,
        normalizedAmount: depositAmount.div(2),
      }
    );
  });
  it('Borrowing multiple times after maturity of the original loan should revert', async function () {
    const borrowAmount = depositAmount.div(2);
    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(borrower.BorrowerPools, 'Borrow');

    await ethers.provider.send('evm_increaseTime', [
      loanDuration.mul(2).toNumber(),
    ]);

    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.revertedWith('BP_MULTIPLE_BORROW_AFTER_MATURITY');
  });
  it('Borrowing multiple times should not impact pending amounts', async function () {
    const borrowAmount = depositAmount.div(2);
    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(borrower.BorrowerPools, 'Borrow');

    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount.div(2),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(4),
      normalizedUsedAmount: depositAmount.div(2),
      adjustedPendingDepositAmount: depositAmount.div(2),
    });
    let expectedBondsQuantity = await computeBondsQuantity(
      borrowAmount,
      depositRate,
      loanDuration
    );
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

    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(borrower.BorrowerPools, 'FurtherBorrow');

    expectedBondsQuantity = await computeBondsQuantity(
      borrowAmount,
      depositRate,
      loanDuration
    );
    const additionalExpectedBondsQuantity = await computeBondsQuantity(
      borrowAmount,
      depositRate,
      loanDuration.sub(2)
    );
    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: BigNumber.from(0),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: BigNumber.from(0),
      bondsQuantity: expectedBondsQuantity.add(additionalExpectedBondsQuantity),
      adjustedPendingDepositAmount: depositAmount.div(2),
    });

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
  it('Borrowing multiple times from a single tick should use accrued fees during that time', async function () {
    const borrowAmount = depositAmount.div(2);
    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(borrower.BorrowerPools, 'Borrow');

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount.div(2),
      lowerInterestRate: depositRate,
      averageBorrowRate: depositRate,
      normalizedBorrowedAmount: borrowAmount,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(4),
      normalizedUsedAmount: depositAmount.div(2),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });

    await mockLendingPool.mock.getReserveNormalizedIncome.returns(
      TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(2)
    );

    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount.mul(2))
    ).to.emit(borrower.BorrowerPools, 'FurtherBorrow');
    const firstBondsQuantity = await computeBondsQuantity(
      borrowAmount,
      depositRate,
      loanDuration
    );
    const secondBondsQuantity = await computeBondsQuantity(
      borrowAmount.mul(2),
      depositRate,
      loanDuration.sub(2)
    );
    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: BigNumber.from(0),
      lowerInterestRate: depositRate,
      averageBorrowRate: depositRate,
      normalizedBorrowedAmount: borrowAmount.mul(3),
      bondsIssuedQuantity: firstBondsQuantity.add(secondBondsQuantity),
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: BigNumber.from(0),
      bondsQuantity: firstBondsQuantity.add(secondBondsQuantity),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
  });
  it('Borrowing multiple times from a tick should use the accrued fees in the meantime then pass to the next tick', async function () {
    const borrowAmount = depositAmount.div(2);
    const newDepositRate = depositRate.add(rateSpacing);
    await positionManager.BorrowerPools.deposit(
      newDepositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: depositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount,
      }
    );
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: newDepositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount,
      }
    );

    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(borrower.BorrowerPools, 'Borrow');

    const expectedBondsQuantity = await computeBondsQuantity(
      borrowAmount,
      depositRate,
      loanDuration
    );
    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount.mul(3).div(2),
      lowerInterestRate: depositRate,
      averageBorrowRate: depositRate,
      normalizedBorrowedAmount: borrowAmount,
      bondsIssuedQuantity: expectedBondsQuantity,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(4),
      normalizedUsedAmount: borrowAmount,
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
        bondsQuantity: expectedBondsQuantity,
        normalizedAmount: depositAmount.div(2),
      }
    );
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: newDepositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: BigNumber.from(0),
        normalizedAmount: depositAmount,
      }
    );

    await mockLendingPool.mock.getReserveNormalizedIncome.returns(
      TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(2)
    );
    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount.mul(3))
    ).to.emit(borrower.BorrowerPools, 'FurtherBorrow');

    const firstExpectedBondsQuantity = await computeBondsQuantity(
      borrowAmount.mul(2),
      depositRate,
      loanDuration.sub(2)
    );
    const secondExpectedBondsQuantity = await computeBondsQuantity(
      borrowAmount,
      newDepositRate,
      loanDuration.sub(2)
    );
    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount.mul(3).div(2),
      lowerInterestRate: depositRate,
      normalizedBorrowedAmount: borrowAmount.mul(4),
      bondsIssuedQuantity: expectedBondsQuantity
        .add(firstExpectedBondsQuantity)
        .add(secondExpectedBondsQuantity),
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: BigNumber.from(0),
      bondsQuantity: expectedBondsQuantity.add(firstExpectedBondsQuantity),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
    await checkTickAmounts(poolHash, depositRate.add(rateSpacing), {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: depositAmount.div(4),
      bondsQuantity: secondExpectedBondsQuantity,
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
        bondsQuantity: expectedBondsQuantity.add(firstExpectedBondsQuantity),
        normalizedAmount: BigNumber.from(0),
      }
    );
    await checkPositionRepartition(
      {
        poolHash: poolHash,
        rate: newDepositRate,
        adjustedAmount: depositAmount.div(2),
        bondsIssuanceIndex: FIRST_BOND_ISSUANCE_INDEX,
      },
      {
        bondsQuantity: secondExpectedBondsQuantity,
        normalizedAmount: depositAmount.mul(3).div(2),
      }
    );
  });
});

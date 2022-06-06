import {expect} from 'chai';
import {BigNumber, Contract, ContractFactory} from 'ethers';
import {
  artifacts,
  deployments,
  ethers,
  getNamedAccounts,
  getUnnamedAccounts,
} from 'hardhat';

import {deployMockContract} from '@ethereum-waffle/mock-contract';

import {
  BorrowerPools,
  BorrowerPools__factory,
  FlashLoanAttacker__factory,
  PoolLogic__factory,
  PositionDescriptor,
  PositionDescriptor__factory,
  PositionManager,
  PositionManager__factory,
} from '../../typechain';
import {secondsPerYear, WAD} from './constants';
import {User} from './types';
import {parseEther} from 'ethers/lib/utils';

export async function setupUsers<
  T extends {[contractName: string]: Contract | ContractFactory}
>(addresses: string[], contracts: T): Promise<({address: string} & T)[]> {
  const users: ({address: string} & T)[] = [];
  for (const address of addresses) {
    users.push(await setupUser(address, contracts));
  }
  return users;
}

export async function setupUser<
  T extends {[contractName: string]: Contract | ContractFactory}
>(address: string, contracts: T): Promise<{address: string} & T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user: any = {address};
  for (const key of Object.keys(contracts)) {
    user[key] = contracts[key].connect(await ethers.getSigner(address));
  }
  return user as {address: string} & T;
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export async function setupFixture(fixtureName: string) {
  await deployments.fixture(fixtureName);
  const {deployer} = await getNamedAccounts();
  const signerDeployer = await ethers.getSigner(deployer);

  const ERC20 = await artifacts.readArtifact('ERC20Upgradeable');
  const Position = await artifacts.readArtifact('PositionManager');
  const BorrowerPools = await artifacts.readArtifact('BorrowerPools');
  const ILendingPool = await artifacts.readArtifact('ILendingPool');

  const DepositToken1C = await deployMockContract(signerDeployer, ERC20.abi);
  const DepositToken2C = await deployMockContract(signerDeployer, ERC20.abi);
  const PositionC = await deployMockContract(signerDeployer, Position.abi);
  const ILendingPoolC = await deployMockContract(
    signerDeployer,
    ILendingPool.abi
  );
  const BorrowerPoolsC = await deployMockContract(
    signerDeployer,
    BorrowerPools.abi
  );

  const PoolLogicFactory = <PoolLogic__factory>(
    await ethers.getContractFactory('PoolLogic')
  );
  const poolLogic = await PoolLogicFactory.deploy();

  const contracts = {
    BorrowerPools: <BorrowerPools>await ethers.getContract('BorrowerPools'),
    BorrowerPoolsF: <BorrowerPools__factory>await ethers.getContractFactory(
      'BorrowerPools',
      {
        libraries: {PoolLogic: poolLogic.address},
      }
    ),
    PositionManager: <PositionManager>(
      await ethers.getContract('PositionManager')
    ),
    PositionManagerF: <PositionManager__factory>(
      await ethers.getContractFactory('PositionManager')
    ),
    PositionDescriptor: <PositionDescriptor>(
      await ethers.getContract('PositionDescriptor')
    ),
    PositionDescriptorF: <PositionDescriptor__factory>(
      await ethers.getContractFactory('PositionDescriptor')
    ),
    FlashLoanAttackerF: <FlashLoanAttacker__factory>(
      await ethers.getContractFactory('FlashLoanAttacker')
    ),
  };

  const users = await setupUsers(await getUnnamedAccounts(), contracts);
  return {
    ...contracts,
    mocks: {
      DepositToken1: DepositToken1C,
      DepositToken2: DepositToken2C,
      PositionManager: PositionC,
      BorrowerPools: BorrowerPoolsC,
      ILendingPool: ILendingPoolC,
    },
    users,
    deployer: await setupUser(deployer, contracts),
  };
}

type CheckPositionRepartitionSetup = {
  poolHash: string;
  rate: BigNumber;
  adjustedAmount: BigNumber;
  bondsIssuanceIndex: BigNumber;
};

type CheckPositionRepartitionParameters = {
  bondsQuantity: BigNumber;
  normalizedAmount: BigNumber | [BigNumber];
};

export function checkPositionRepartitionUtil(borrower: User) {
  return async (
    {
      poolHash,
      rate,
      adjustedAmount,
      bondsIssuanceIndex,
    }: CheckPositionRepartitionSetup,
    {bondsQuantity, normalizedAmount}: CheckPositionRepartitionParameters
  ): Promise<void> => {
    const depositRepartition =
      await borrower.BorrowerPools.getAmountRepartition(
        poolHash,
        rate,
        adjustedAmount,
        bondsIssuanceIndex
      );
    expect(
      depositRepartition[0].sub(bondsQuantity).abs().lt(50),
      `bondsQuantity : expected ${bondsQuantity}, got ${depositRepartition[0]}`
    ).to.be.true;
    let res = false;
    if (Array.isArray(normalizedAmount)) {
      for (const val of normalizedAmount) {
        res = res || depositRepartition[1].sub(val).abs().lt(10000);
      }
    } else {
      res = depositRepartition[1].sub(normalizedAmount).abs().lt(10000);
    }
    expect(
      res,
      `normalizedAmount : expected ${normalizedAmount}, got ${depositRepartition[1]}`
    ).to.be.true;
  };
}

type CheckPoolState = {
  normalizedAvailableDeposits?: BigNumber | [BigNumber];
  lowerInterestRate?: BigNumber;
  remainingAdjustedLiquidityRewardsReserve?: BigNumber | [BigNumber];
  averageBorrowRate?: BigNumber;
  normalizedBorrowedAmount?: BigNumber;
  bondsIssuedQuantity?: BigNumber;
};

export function checkPoolUtil(borrower: User) {
  return async (
    poolHash: string,
    {
      normalizedAvailableDeposits,
      lowerInterestRate,
      remainingAdjustedLiquidityRewardsReserve,
      averageBorrowRate,
      normalizedBorrowedAmount,
      bondsIssuedQuantity,
    }: CheckPoolState
  ): Promise<void> => {
    const poolAggregates = await borrower.BorrowerPools.getPoolAggregates(
      poolHash
    );
    if (averageBorrowRate) {
      expect(poolAggregates[0], 'averageBorrowRate').to.equal(
        averageBorrowRate
      );
    }
    const poolState = await borrower.BorrowerPools.getPoolState(poolHash);
    if (lowerInterestRate) {
      expect(poolState.lowerInterestRate, 'lowerInterestRate').to.equal(
        lowerInterestRate
      );
    }
    if (normalizedAvailableDeposits !== undefined) {
      let res = false;
      if (Array.isArray(normalizedAvailableDeposits)) {
        for (const val of normalizedAvailableDeposits) {
          res =
            res ||
            poolState.normalizedAvailableDeposits.sub(val).abs().lt(1000);
        }
      } else {
        res = poolState.normalizedAvailableDeposits
          .sub(normalizedAvailableDeposits)
          .abs()
          .lt(1000);
      }
      expect(
        res,
        `normalizedAvailableDeposits : expected ${normalizedAvailableDeposits}, got ${poolState.normalizedAvailableDeposits}`
      ).to.be.true;
    }
    if (remainingAdjustedLiquidityRewardsReserve !== undefined) {
      let res = false;
      if (Array.isArray(remainingAdjustedLiquidityRewardsReserve)) {
        for (const val of remainingAdjustedLiquidityRewardsReserve) {
          res =
            res ||
            poolState.remainingAdjustedLiquidityRewardsReserve
              .sub(val)
              .abs()
              .lt(10);
        }
      } else {
        res = poolState.remainingAdjustedLiquidityRewardsReserve
          .sub(remainingAdjustedLiquidityRewardsReserve)
          .abs()
          .lt(10);
      }
      expect(
        res,
        `remainingLiquidityRewardsReserve : expected ${remainingAdjustedLiquidityRewardsReserve}, got ${poolState.remainingAdjustedLiquidityRewardsReserve}`
      ).to.be.true;
    }
    if (normalizedBorrowedAmount) {
      expect(
        poolState.normalizedBorrowedAmount
          .sub(normalizedBorrowedAmount)
          .abs()
          .lt(10),
        `normalizedBorrowedAmount : expected ${normalizedBorrowedAmount}, got ${poolState.normalizedBorrowedAmount}`
      ).to.be.true;
    }
    if (bondsIssuedQuantity !== undefined) {
      let res = false;
      if (Array.isArray(bondsIssuedQuantity)) {
        for (const val of bondsIssuedQuantity) {
          res = res || poolState.bondsIssuedQuantity.sub(val).abs().lt(10);
        }
      } else {
        res = poolState.bondsIssuedQuantity
          .sub(bondsIssuedQuantity)
          .abs()
          .lt(10);
      }
      expect(
        res,
        `bondsIssuedQuantity : expected ${bondsIssuedQuantity}, got ${poolState.bondsIssuedQuantity}`
      ).to.be.true;
    }
  };
}

type CheckTickAmounts = {
  adjustedTotalAmount?: BigNumber;
  adjustedRemainingAmount?: BigNumber;
  normalizedUsedAmount?: BigNumber;
  adjustedPendingDepositAmount?: BigNumber;
  accruedFees?: BigNumber | [BigNumber];
  atlendisLiquidityRatio?: BigNumber | [BigNumber];
  bondsQuantity?: BigNumber;
};

export function checkTickUtil(borrower: User) {
  return async (
    poolHash: string,
    rate: BigNumber,
    {
      adjustedTotalAmount,
      adjustedRemainingAmount,
      normalizedUsedAmount,
      adjustedPendingDepositAmount,
      accruedFees,
      atlendisLiquidityRatio,
      bondsQuantity,
    }: CheckTickAmounts
  ): Promise<void> => {
    const poolParameters = await borrower.BorrowerPools.getPoolParameters(
      poolHash
    );
    const [
      adjustedTotalAmountBP,
      adjustedRemainingAmountBP,
      bondsQuantityBP,
      adjustedPendingDepositAmountBP,
      atlendisLiquidityRatioBP,
      accruedFeesBP,
    ] = await borrower.BorrowerPools.getTickAmounts(poolHash, rate);
    if (adjustedTotalAmount) {
      expect(
        adjustedTotalAmountBP.sub(adjustedTotalAmount).abs().lt(10),
        `adjustedTotalAmount : expected ${adjustedTotalAmount}, got ${adjustedTotalAmountBP}`
      ).to.be.true;
    }
    if (adjustedRemainingAmount) {
      expect(
        adjustedRemainingAmountBP.sub(adjustedRemainingAmount).abs().lt(10),
        `adjustedRemainingAmount : expected ${adjustedRemainingAmount}, got ${adjustedRemainingAmountBP}`
      ).to.be.true;
    }
    if (normalizedUsedAmount) {
      const bondQuantityCalc = await computeBondsQuantity(
        normalizedUsedAmount,
        rate,
        poolParameters.loanDuration
      );
      expect(
        bondsQuantityBP.sub(bondQuantityCalc).abs().lt(50),
        `bondsQuantity : expected ${bondQuantityCalc}, got ${bondsQuantityBP}`
      ).to.be.true;
    }
    if (adjustedPendingDepositAmount) {
      expect(
        adjustedPendingDepositAmountBP,
        'adjustedPendingDepositAmount'
      ).to.equal(adjustedPendingDepositAmount);
    }
    if (accruedFees != undefined) {
      let res = false;
      if (Array.isArray(accruedFees)) {
        for (const val of accruedFees) {
          res = res || accruedFeesBP.sub(val).abs().lt(10);
        }
      } else {
        res = accruedFeesBP.sub(accruedFees).abs().lt(10);
      }
      expect(res, `accruedFees : expected ${accruedFees}, got ${accruedFeesBP}`)
        .to.be.true;
    }
    if (atlendisLiquidityRatio != undefined) {
      // uncertainty caused by calculations precision difference between javascript and solidity
      let res = false;
      if (Array.isArray(atlendisLiquidityRatio)) {
        for (const val of atlendisLiquidityRatio) {
          res = res || atlendisLiquidityRatioBP.sub(val).abs().lt(1e9);
        }
      } else {
        res = atlendisLiquidityRatioBP
          .sub(atlendisLiquidityRatio)
          .abs()
          .lt(1e9);
      }
      expect(
        res,
        `atlendisLiquidityRatio : expected ${atlendisLiquidityRatio}, got ${atlendisLiquidityRatioBP}`
      ).to.be.true;
    }
    if (bondsQuantity) {
      expect(
        bondsQuantityBP.sub(bondsQuantity).abs().lt(50),
        `bondsQuantity : expected ${bondsQuantity}, got ${bondsQuantityBP}`
      ).to.be.true;
    }
  };
}

export async function computeBondsQuantity(
  normalizedUsedAmount: BigNumber,
  rate: BigNumber,
  loanDuration: BigNumber
): Promise<BigNumber> {
  // parseEther('1') multiplications are made to replicate wadMul in contracts
  const bondPrice = parseEther('1')
    .mul(parseEther('1'))
    .add(parseEther('1').div(2))
    .div(parseEther('1').add(rate.mul(loanDuration).div(secondsPerYear)));
  const rawBondQuantity = normalizedUsedAmount
    .mul(WAD)
    .add(parseEther('1').div(2))
    .div(bondPrice);
  return rawBondQuantity;
}

export async function getTimeStamp(): Promise<number> {
  const blockNum = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(blockNum);
  return block.timestamp;
}

export async function calcRealizedBondsQuantity(
  expectedMaturity: BigNumber,
  expectedBondsQuantity: BigNumber,
  depositRate: BigNumber
): Promise<BigNumber> {
  const timestamp = await getTimeStamp();
  return await computeBondsQuantity(
    expectedBondsQuantity,
    depositRate,
    BigNumber.from(timestamp).sub(expectedMaturity)
  );
}

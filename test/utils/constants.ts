import {BigNumber} from 'ethers';
import {parseEther, toUtf8Bytes} from 'ethers/lib/utils';

import {defaultAbiCoder} from '@ethersproject/abi';
import {keccak256} from '@ethersproject/keccak256';

export const WAD = parseEther('1');
export const RAY = WAD.mul(1e9);
export const TEST_RETURN_YIELD_PROVIDER_LR_RAY =
  WAD.mul(2).mul(
    1e9
  ); /* liquidity ratio set with yield provider's liquidity ratio expressed in RAY*/
export const borrowerName = 'ABCCORP';
export const poolHash = keccak256(
  defaultAbiCoder.encode(['string'], [borrowerName])
);
export const minRateInput = parseEther('0.05'); // min rate 5% for new pool creation
export const maxRateInput = parseEther('0.2'); // max rate 20% for new pool creation
export const rateSpacingInput = parseEther('0.005'); // rate spacing 0.5% for new pool creation
export const maxBorrowableAmount = parseEther('1000'); // max borrowable amount for new order book creation
export const loanDuration = 24 * 3600; // duration of a loan for the new pool
export const distributionRate = maxBorrowableAmount
  .div(20)
  .div(3600 * 24 * 30 * 12); // distribution rate of the liquidity rewards, set to 5% of the max pool size
export const cooldownPeriod = 360; // cooldown period to observe after a loan is repaid in the new pool
export const repaymentPeriod = loanDuration; // threshold after which an additional fee will have to be paid to the lenders
export const lateRepayFeePerBondRate = 0; // fee to be paid in case of late repayment of the loan
export const establishmentFeeRate = 0;
export const repaymentFeeRate = 0;
export const liquidityRewardsActivationThreshold = 0; // minimum token deposit to activate the pool
export const FIRST_BOND_ISSUANCE_INDEX = BigNumber.from(0);
export const NEXT_BOND_ISSUANCE_INDEX = FIRST_BOND_ISSUANCE_INDEX.add(1);
export const FIRST_TOKEN_ID = 1;
export const ONE_HOUR = 3600;
export const secondsPerYear = 365 * 24 * 60 * 60;
export const GOVERNANCE_ROLE = keccak256(toUtf8Bytes('GOVERNANCE_ROLE'));
export const POSITION_ROLE = keccak256(toUtf8Bytes('POSITION_ROLE'));

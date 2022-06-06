import {expect} from 'chai';
import {deployments} from 'hardhat';

import {setupFixture} from '../utils';
import {GOVERNANCE_ROLE} from '../utils/constants';
import {Deployer, User} from '../utils/types';

const setup = deployments.createFixture(async () => {
  return setupFixture('BorrowerPools');
});

describe('Borrower Pools - Initialize', function () {
  let borrower: User;

  let contractsDeployer: Deployer;

  beforeEach(async () => {
    const {deployer, users} = await setup();
    contractsDeployer = deployer;
    borrower = users[3];
  });

  it('Initializing with an address should give it governance role', async function () {
    const deployedBorrowerPools =
      await contractsDeployer.BorrowerPoolsF.deploy();
    const signerAddress = await deployedBorrowerPools.signer.getAddress();

    let hasRole = await deployedBorrowerPools.hasRole(
      GOVERNANCE_ROLE,
      borrower.address
    );
    expect(hasRole).to.be.false;
    hasRole = await deployedBorrowerPools.hasRole(
      GOVERNANCE_ROLE,
      signerAddress
    );
    expect(hasRole).to.be.false;

    await deployedBorrowerPools.initialize(borrower.address);

    hasRole = await deployedBorrowerPools.hasRole(
      GOVERNANCE_ROLE,
      borrower.address
    );
    expect(hasRole).to.be.true;
    hasRole = await deployedBorrowerPools.hasRole(
      GOVERNANCE_ROLE,
      signerAddress
    );
    expect(hasRole).to.be.false;
  });

  it('Initializing without an address should give governance role to the deployer', async function () {
    const deployedBorrowerPools =
      await contractsDeployer.BorrowerPoolsF.deploy();
    const signerAddress = await deployedBorrowerPools.signer.getAddress();

    let hasRole = await deployedBorrowerPools.hasRole(
      GOVERNANCE_ROLE,
      signerAddress
    );
    expect(hasRole).to.be.false;

    await deployedBorrowerPools.initialize(
      '0x0000000000000000000000000000000000000000'
    );

    hasRole = await deployedBorrowerPools.hasRole(
      GOVERNANCE_ROLE,
      signerAddress
    );
    expect(hasRole).to.be.true;
  });
});

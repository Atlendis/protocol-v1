import {deployments} from 'hardhat';

import {setupFixture} from '../utils';
import {User} from '../utils/types';
import {expect} from './helpers/chai-setup';
import {setupTestContracts} from './utils';

const setup = deployments.createFixture(async () => {
  return setupFixture('BorrowerPools');
});

describe('Borrower Pools - Pause', function () {
  let borrower: User, governanceUser: User;

  beforeEach(async () => {
    const {deployer, mocks, users} = await setup();
    const {testBorrower, governance} = await setupTestContracts(
      deployer,
      mocks,
      users
    );
    borrower = testBorrower;
    governanceUser = governance;
  });

  it('Pausing the pool with a user which does not have the goverance role should revert', async function () {
    await expect(borrower.BorrowerPools.freezePool()).to.be.revertedWith(
      `AccessControl: account ${borrower.address.toLowerCase()} is missing role 0x71840dc4906352362b0cdaf79870196c8e42acafade72d5d5a6d59291253ceb1`
    );
  });
  it('Unpausing the pool with a user which does not have the goverance role should revert', async function () {
    await expect(borrower.BorrowerPools.unfreezePool()).to.be.revertedWith(
      `AccessControl: account ${borrower.address.toLowerCase()} is missing role 0x71840dc4906352362b0cdaf79870196c8e42acafade72d5d5a6d59291253ceb1`
    );
  });
  it('Pausing the pool while it was already paused should revert', async function () {
    await expect(governanceUser.BorrowerPools.freezePool()).to.emit(
      governanceUser.BorrowerPools,
      'Paused'
    );
    await expect(governanceUser.BorrowerPools.freezePool()).to.be.revertedWith(
      'Pausable: paused'
    );
  });
  it('Unpausing the pool while it was already unpaused should revert', async function () {
    await expect(
      governanceUser.BorrowerPools.unfreezePool()
    ).to.be.revertedWith('Pausable: not paused');
  });
  it('Pausing the pool while it is unpaused should update the pause status', async function () {
    await expect(governanceUser.BorrowerPools.freezePool()).to.emit(
      governanceUser.BorrowerPools,
      'Paused'
    );
    expect(await governanceUser.BorrowerPools.paused()).to.be.true;
  });
  it('Unpausing the pool while it is paused should update the pause status', async function () {
    await expect(governanceUser.BorrowerPools.freezePool()).to.emit(
      governanceUser.BorrowerPools,
      'Paused'
    );
    await expect(governanceUser.BorrowerPools.unfreezePool()).to.emit(
      governanceUser.BorrowerPools,
      'Unpaused'
    );
    expect(await governanceUser.BorrowerPools.paused()).to.be.false;
  });
});

import debugModule from 'debug';
import {DeployFunction} from 'hardhat-deploy/types';
import {HardhatRuntimeEnvironment} from 'hardhat/types';

import {BorrowerPools, PositionDescriptor, PositionManager} from '../typechain';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const log = debugModule('deploy-setup');
  log.enabled = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const {deployments} = hre as any;
  const {ethers, getNamedAccounts} = hre;

  // keep ts support on hre members
  const {deployer, governance} = await getNamedAccounts();
  const {deploy, catchUnknownSigner} = deployments;

  const BorrowerPoolsDeployer = <BorrowerPools>(
    await ethers.getContract('BorrowerPools', deployer)
  );
  const PositionDescriptorDeployer = <PositionDescriptor>(
    await ethers.getContract('PositionDescriptor', deployer)
  );
  await catchUnknownSigner(
    deploy('PositionManager', {
      contract: 'PositionManager',
      from: deployer,
      proxy: {
        owner: governance,
        proxy: true,
        execute: {
          init: {
            methodName: 'initialize',
            args: [
              'PositionManager',
              'ATLP',
              BorrowerPoolsDeployer.address,
              PositionDescriptorDeployer.address,
            ],
          },
        },
      },
      log: true,
    })
  );

  const PositionManagerDeployer = <PositionManager>(
    await ethers.getContract('PositionManager', deployer)
  );
  log('PositionManager proxy address: ' + PositionManagerDeployer.address);
};
export default func;

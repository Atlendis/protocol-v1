import debugModule from 'debug';
import {DeployFunction} from 'hardhat-deploy/types';
import {HardhatRuntimeEnvironment} from 'hardhat/types';

import {PositionDescriptor} from '../typechain';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const log = debugModule('deploy-setup');
  log.enabled = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const {deployments} = hre as any;
  const {ethers, getNamedAccounts} = hre;

  // keep ts support on hre members
  const {deployer, governance} = await getNamedAccounts();
  const {deploy, catchUnknownSigner} = deployments;

  // deploy position descriptor
  await catchUnknownSigner(
    deploy('PositionDescriptor', {
      contract: 'PositionDescriptor',
      from: deployer,
      proxy: {
        owner: governance,
        proxy: true,
      },
      log: true,
    })
  );

  const PositionDescriptorDeployer = <PositionDescriptor>(
    await ethers.getContract('PositionDescriptor', deployer)
  );
  log(
    'PositionDescriptor proxy address: ' + PositionDescriptorDeployer.address
  );
};
export default func;

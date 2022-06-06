import 'dotenv/config';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import 'hardhat-deploy';
import 'hardhat-abi-exporter';
import 'hardhat-contract-sizer';
import 'hardhat-gas-reporter';
import '@typechain/hardhat';
import 'solidity-coverage';
import 'hardhat-interface-generator';
import '@primitivefi/hardhat-dodoc';
require('hardhat-contract-sizer');

import {HardhatUserConfig} from 'hardhat/types';

import {accounts, node_url} from './utils/network';

if (process.env.HARDHAT_FORK) {
  process.env['HARDHAT_DEPLOY_FORK'] = process.env.HARDHAT_FORK;
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: '0.8.9',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          evmVersion: 'istanbul',
        },
      },
      {
        version: '0.7.6',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          evmVersion: 'istanbul',
        },
      },
    ],
  },
  namedAccounts: {
    deployer: {
      default: 0,
      1: process.env.MAINNET_DEPLOYER ?? '',
    },
    borrower: {
      default: 1,
    },
    lender: {
      default: 2,
    },
    otherLender: {
      default: 3,
    },
    governance: {
      // can upgrade contracts and create pools
      default: 4,
      /* 1: 'gnosis multisig address''*/
      polygon: '0x36412AC3A59Db81696d73d4Eb1dFEB6040C7A215',
    },
    lendingPoolAAVEv2: {
      default: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
      mainnet: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9', // https://docs.aave.com/developers/v/2.0/deployed-contracts/deployed-contracts
      beta: '0xE0fBa4Fc209b4948668006B2bE61711b7f465bAe',
      staging: '0xE0fBa4Fc209b4948668006B2bE61711b7f465bAe',
      polygon: '0x8dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf', // https://docs.aave.com/developers/v/2.0/deployed-contracts/matic-polygon-market
      mumbai: '0x9198F13B08E299d85E096929fA9781A1E3d5d827',
    },
    lendingPoolAAVEv3: {
      polygon: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', // https://docs.aave.com/developers/deployed-contracts/v3-mainnet/polygon
    },
    faucetDAI: {
      default: '0x28C6c06298d514Db089934071355E5743bf21d60',
      mainnet: '0x28C6c06298d514Db089934071355E5743bf21d60',
      beta: '0xca4ad39f872e89ef23eabd5716363fc22513e147',
      staging: '0xca4ad39f872e89ef23eabd5716363fc22513e147',
      polygon: '0x075e72a5edf65f0a5f44699c7654c1a76941ddc8',
      mumbai: '0xdA8AB4137fE28f969b27C780D313d1bb62C8341E',
    },
    faucetUSDC: {
      default: '0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3',
      mainnet: '0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3',
      polygon: '0xf977814e90da44bfa03b6295a0616a897441acec',
    },
    faucetUSDT: {
      default: '0x5754284f345afc66a98fbb0a0afe71e0f007b949',
      mainnet: '0x5754284f345afc66a98fbb0a0afe71e0f007b949',
      polygon: '0x72A53cDBBcc1b9efa39c834A540550e23463AAcB',
    },
    faucetWBTC: {
      default: '0xb60c61dbb7456f024f9338c739b02be68e3f545c',
      mainnet: '0xb60c61dbb7456f024f9338c739b02be68e3f545c',
      polygon: '0xba12222222228d8ba445958a75a0704d566bf2c8',
    },
    faucetWETH: {
      default: '0x2feb1512183545f48f6b9c5b4ebfcaf49cfca6f3',
      mainnet: '0x2feb1512183545f48f6b9c5b4ebfcaf49cfca6f3',
      polygon: '0x72a53cdbbcc1b9efa39c834a540550e23463aacb',
    },
    // mainnet: https://aave.github.io/aave-addresses/mainnet.json
    // beta/staging: https://aave.github.io/aave-addresses/kovan.json
    // polygon: https://aave.github.io/aave-addresses/polygon.json
    // mumbai:  https://aave.github.io/aave-addresses/mumbai.json
    reserveDAI: {
      default: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      mainnet: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      beta: '0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD',
      staging: '0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD',
      polygon: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
      mumbai: '0x001B3B4d0F3714Ca98ba10F6042DaEbF0B1B7b6F',
    },
    reserveaDAIv2: {
      default: '0x028171bCA77440897B824Ca71D1c56caC55b68A3',
      mainnet: '0x028171bCA77440897B824Ca71D1c56caC55b68A3',
      beta: '0xdCf0aF9e59C002FA3AA091a46196b37530FD48a8',
      staging: '0xdCf0aF9e59C002FA3AA091a46196b37530FD48a8',
      polygon: '0x27F8D03b3a2196956ED754baDc28D73be8830A6e',
      mumbai: '0x639cB7b21ee2161DF9c882483C9D55c90c20Ca3e',
    },
    reserveaDAIv3: {
      polygon: '0x82E64f49Ed5EC1bC6e43DAD4FC8Af9bb3A2312EE',
    },
    reserveUSDC: {
      // 6 decimals
      default: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      mainnet: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      beta: '0xe22da380ee6B445bb8273C81944ADEB6E8450422',
      staging: '0xe22da380ee6B445bb8273C81944ADEB6E8450422',
      polygon: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      mumbai: '0x2058A9D7613eEE744279e3856Ef0eAda5FCbaA7e',
    },
    reserveaUSDCv2: {
      default: '0xBcca60bB61934080951369a648Fb03DF4F96263C',
      mainnet: '0xBcca60bB61934080951369a648Fb03DF4F96263C',
      beta: '0xe12AFeC5aa12Cf614678f9bFeeB98cA9Bb95b5B0',
      staging: '0xe12AFeC5aa12Cf614678f9bFeeB98cA9Bb95b5B0',
      polygon: '0x1a13F4Ca1d028320A707D99520AbFefca3998b7F',
      mumbai: '0x2271e3Fef9e15046d09E1d78a8FF038c691E9Cf9',
    },
    reserveaUSDCv3: {
      polygon: '0x625E7708f30cA75bfd92586e17077590C60eb4cD',
    },
    reserveUSDT: {
      // 6 decimals
      default: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      mainnet: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      polygon: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
      mumbai: '0xbd21a10f619be90d6066c941b04e340841f1f989',
    },
    reserveaUSDTv2: {
      default: '0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811',
      mainnet: '0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811',
      polygon: '0x60D55F02A771d515e077c9C2403a1ef324885CeC',
    },
    reserveaUSDTv3: {
      polygon: '0x6ab707Aca953eDAeFBc4fD23bA73294241490620',
    },
    reserveWETH: {
      default: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      mainnet: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      beta: '0xd0A1E359811322d97991E03f863a0C30C2cF029C',
      staging: '0xd0A1E359811322d97991E03f863a0C30C2cF029C',
      polygon: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
    },
    reserveaWETHv2: {
      default: '0x030bA81f1c18d280636F32af80b9AAd02Cf0854e',
      mainnet: '0x030bA81f1c18d280636F32af80b9AAd02Cf0854e',
      polygon: '0x28424507fefb6f7f8E9D3860F56504E4e5f5f390',
    },
    reserveaWETHv3: {
      polygon: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8',
    },
    reserveWBTC: {
      // 8 decimals
      default: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
      mainnet: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
      beta: '0xD1B98B6607330172f1D991521145A22BCe793277',
      staging: '0xD1B98B6607330172f1D991521145A22BCe793277',
      polygon: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6',
      mumbai: '0x0d787a4a1548f673ed375445535a6c7A1EE56180',
    },
    reserveaWBTCv2: {
      default: '0x9ff58f4ffb29fa2266ab25e75e2a8b3503311656',
      mainnet: '0x9ff58f4ffb29fa2266ab25e75e2a8b3503311656',
      polygon: '0x5c2ed810328349100A66B82b78a1791B101C9D61',
    },
    reserveaWBTCv3: {
      polygon: '0x078f358208685046a11C85e8ad32895DED33A249',
    },
  },
  networks: {
    hardhat: {
      // process.env.HARDHAT_FORK will specify the network that the fork is made from.
      // this line ensure the use of the corresponding accounts
      accounts: accounts(process.env.HARDHAT_FORK),
      forking: process.env.HARDHAT_FORK
        ? {
            // TODO once PR merged : network: process.env.HARDHAT_FORK,
            url: node_url(process.env.HARDHAT_FORK),
            blockNumber: process.env.HARDHAT_FORK_NUMBER
              ? parseInt(process.env.HARDHAT_FORK_NUMBER)
              : undefined,
          }
        : undefined,
      saveDeployments: true,
    },
    localhost: {
      url: node_url('localhost'),
      accounts: accounts(),
    },
    mainnet: {
      url: node_url('mainnet'),
      accounts: accounts('mainnet'),
    },
    polygon: {
      url: node_url('polygon'),
      accounts: accounts('polygon'),
    },
    rinkeby: {
      url: node_url('rinkeby'),
      accounts: accounts('rinkeby'),
    },
    beta: {
      url: node_url('kovan'),
      accounts: accounts('kovan'),
    },
    staging: {
      url: node_url('kovan'),
      accounts: accounts('kovan'),
    },
    goerli: {
      url: node_url('goerli'),
      accounts: accounts('goerli'),
    },
    mumbai: {
      url: node_url('mumbai'),
      accounts: accounts('mumbai'),
    },
  },
  paths: {
    sources: 'src',
    cache: 'hh-cache',
  },
  gasReporter: {
    currency: 'USD',
    gasPrice: 100,
    enabled: process.env.REPORT_GAS ? true : false,
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    maxMethodDiff: 10,
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5',
  },
  mocha: {
    timeout: 0,
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: {
      kovan: process.env.ETHERSCAN_KEY,
      polygonMumbai: process.env.ETHERSCAN_KEY,
    },
  },
  abiExporter: {
    path: './abis',
    clear: true,
    flat: true,
  },
  dodoc: {
    include: ['IBorrowerPools', 'IPoolsController', 'IPositionManager'],
  },
};

export default config;

# Atlendis Smart Contracts

White Paper available [here](https://github.com/Atlendis/whitepaper-v1/blob/main/Atlendis_WhitePaper_V1.pdf)

Documentation available [here](https://docs.atlendis.io/atlendis-v1/)

## Protocol

Atlendis is a decentralized non custodial lending protocol that allows investors to lend assets to whitelisted counterparties.

As opposed to lending protocols like Aave or Compound which require the borrower to deposit collateral, Atlendis enables selected borrowers to take loans without posting any collateral. The unsecured nature of the loan exposes the lender to credit risk which is rewarded by a yield determined by the market's demand/supply dynamics.

From the borrower's perspective unsecured borrowing allows for greater capital efficiency as well as greater flexibility to optimise its capital structure.

The protocol is composed of a set of fully autonomous smart contracts that reside on the Ethereum network.

## Repository

The repository is structured as follows :

```
...
├── src                                   <- Solidity contracts
│   ├── BorrowerPools.sol                 <- Borrower Pools - entry point for borrowers
│   ├── PoolsController.sol               <- Governance layer over pool storage, handles pool roles
│   ├── PositionManager.sol               <- PositionManager - entrypoint for lenders
│   └── PositionDescriptor.sol            <- PositionDescriptor - lender position nft artwork renderer
├── deploy                                <- Deployment scripts
├── test                                  <- Smart contract tests
│   └── unit                              <- Unit tests
├── hardhat.config.ts                     <- Configurations
...
```

## Smart contracts

### Description

The main smart contracts are PositionManager and BorrowerPools

#### PositionManager

The position contract is the entry point for lenders. Then can:

- Create a position by depositing funds into a borrower pool, to be borrowed at a target rate. The funds will be deposited into a yield provider (currently Aave) in the meantime.
- Withdraw the unmatched part of their position i.e. funds that are not borrowed
- Update the bidding rate of their position, for example lower it to have more chances to be matched.

At all times, the funds within the position are deposited on the yield provider and/or borrowed in a loan.

The position is represented by an ERC721 NFT.

#### Borrower Pools

The borrower pools contract is the entry point for borrowers. Then can:

- Pay liquidity rewards to the lenders to incentivize them to fill the pool
- Take a loan against the funds deposited in their pool. The contract will iterate over the ticks to determine the best possible borrowing rate.
- Repay their loan

#### Pools Controller

The borrower pools contract inherits from the pools controller, which contains the governance actions. The governance can:

- Create a new pool, after an off chain whitelisting process
- Manage the settings of the pools (min and max rate, max borrowable amount etc.)
- Flag a pool as defaulted in the case the borrower does not repay its loan
- Freeze all actions on the protocol
- Claim protocol fees

### Install

```bash
yarn install --dev
```

### Run unit tests

```bash
yarn compile
yarn test
```

### Deploy to Kovan

Run the following

```bash
yarn
yarn add hardhat-deploy-ethers
yarn deploy kovan
```

### Verify contracts on etherscan

Add ETHERSCAN_KEY to your .env

Note: A different key is required weather verifying contracts on (Mainnet / Kovan) vs. (Polygon / Mumbai)
Two packages are included in this repository to provide source code verification:

 * hardhat-deploy

Run `yarn etherscan-verify <network>`

 * hardhat-etherscan

Run `npx hardhat verify --network <network> CONTRACT_ADDRESS`

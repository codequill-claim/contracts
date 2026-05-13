import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import { configVariable } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin, hardhatVerify],
  verify: {
    etherscan: {
      // Etherscan v2 keys cover every supported EVM chain (Base, Mainnet,
      // Optimism, Arbitrum, etc.) so one key handles all our networks.
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
          viaIR: true
        }
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true
        },
      },
    },
  },
  networks: {
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC"),
      accounts: [configVariable("DEPLOYER_PK")],
    },
    "base-sepolia": {
      type: "http",
      chainType: "l1",
      chainId: 84532,
      url: configVariable("BASE_SEPOLIA_RPC"),
      accounts: [configVariable("DEPLOYER_PK")],
    },
    base: {
      type: "http",
      chainType: "l1",
      chainId: 8453,
      url: configVariable("BASE_RPC"),
      // Mainnet deploys use a dedicated key kept separately from the
      // testnet `DEPLOYER_PK`. Set with `npx hardhat keystore set BASE_DEPLOYER_PK`.
      accounts: [configVariable("BASE_DEPLOYER_PK")],
    },
  },
});

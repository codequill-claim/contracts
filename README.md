# CodeQuill Contracts

[![codecov](https://codecov.io/github/ophelios-studio/codequill-contracts/graph/badge.svg?token=3TKH7BRNU2)](https://codecov.io/github/ophelios-studio/codequill-contracts)

CodeQuill is a decentralized registry for repositories, snapshots, and supply-chain attestations. It leverages EIP-712 delegations to enable a secure relayer-mediated workflow, allowing repository owners to authorize specific actions (claiming repos, creating snapshots, or signing attestations) without requiring them to be online for every transaction.

## Core Contracts

- **CodeQuillDelegation**: Context-scoped delegation (owner -> relayer) for granular permissions (scopes) bound to a workspace.
- **CodeQuillWorkspaceRegistry**: Manages workspace membership and authority, anchoring wallets to context identifiers.
- **CodeQuillRepositoryRegistry**: Repository claim registry (repoId -> owner) with context-scoped relayer support.
- **CodeQuillSnapshotRegistry**: Lightweight snapshotting via Merkle roots and off-chain git commit metadata.
- **CodeQuillReleaseRegistry**: Anchors immutable project releases referencing snapshots with integrated governance.
- **CodeQuillPreservationRegistry**: Optional registry for anchoring encrypted preservation archives bound to snapshots.
- **CodeQuillAttestationRegistry**: Records supply-chain attestations (sha256 artifact digests) bound to on-chain releases.

## Documentation

For more detailed information on the project's structure and security model, please refer to:
- [Architecture Diagram](docs/ARCHITECTURE.md)
- [Permissions Matrix](docs/PERMISSIONS.md)

## Compile contracts
```
npx hardhat build
```

## Run Tests
```
npx hardhat test
```

## Check Coverage
```
npx hardhat test --coverage
```

## Deploy contracts
```
npx hardhat keystore set SEPOLIA_RPC
npx hardhat keystore set DEPLOYER_PK
npx hardhat ignition deploy ignition/modules/Codequill.ts --network sepolia
```

## Generate ABI files
```
npm run generate-abi
```

## Verify & Publish Contracts
To verify contract source code on block explorers (like Etherscan) using the Standard-Json-Input method:

1. Generate the Standard-Json-Input files:
```
npm run generate-standard-json
```
2. The generated files will be located in the `standard-json-input/` folder.
3. On the block explorer's verification page, select **Standard-Json-Input** as the compiler type.
4. Upload the corresponding `.standard-input.json` file for your contract.
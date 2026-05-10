# CodeQuill Contracts

[![codecov](https://codecov.io/gh/codequill-claim/contracts/graph/badge.svg?token=3TKH7BRNU2)](https://codecov.io/gh/codequill-claim/contracts)
[![CodeQuill Trust Index](https://app.codequill.xyz/badges/trust/d71a1a34-ba48-4c3c-b957-cdef2822912e)](https://app.codequill.xyz/explore/codequill-claim/contracts)
[![CodeQuill – Verified authorship](https://app.codequill.xyz/badges/claim/d71a1a34-ba48-4c3c-b957-cdef2822912e)](https://app.codequill.xyz/explore/codequill-claim/contracts)
[![CodeQuill – Latest snapshot](https://app.codequill.xyz/badges/snapshot/d71a1a34-ba48-4c3c-b957-cdef2822912e)](https://app.codequill.xyz/explore/codequill-claim/contracts)

CodeQuill is a decentralized registry for repositories, snapshots, and supply-chain attestations. It leverages EIP-712 delegations to enable a secure relayer-mediated workflow, allowing repository owners to authorize specific actions (claiming repos, creating snapshots, or signing attestations) without requiring them to be online for every transaction.

## Core Contracts

- **CodeQuillWorkspaceNFT**: ERC-721 collection where each token represents authority over a CodeQuill workspace. Transferring the token transfers authority — designed to be held in a Safe (or any EIP-1271 wallet) for compromise resistance and key rotation. **Approvals are disabled** (`approve` / `setApprovalForAll` revert) so the workspace cannot be moved via marketplace operators or accidental "approve all" prompts — only the current holder can transfer it.
- **CodeQuillWorkspaceRegistry** (v2): Manages workspace membership; authority is sourced from `CodeQuillWorkspaceNFT.ownerOf(contextId)`. Membership operations accept EOA *and* contract-wallet (EIP-1271) signatures via OpenZeppelin's `SignatureChecker`.
- **CodeQuillDelegation**: Context-scoped delegation (owner -> relayer) for granular permissions (scopes) bound to a workspace.
- **CodeQuillRepositoryRegistry**: Repository claim registry (repoId -> owner) with context-scoped relayer support.
- **CodeQuillSnapshotRegistry**: Lightweight snapshotting via Merkle roots and off-chain git commit metadata.
- **CodeQuillReleaseRegistry**: Anchors immutable project releases referencing snapshots with integrated governance.
- **CodeQuillPreservationRegistry**: Optional registry for anchoring encrypted preservation archives bound to snapshots.
- **CodeQuillAttestationRegistry**: Records supply-chain attestations (sha256 artifact digests) bound to on-chain releases.

## Workspace Authority Model (v2)

Workspace authority is an ERC-721 NFT, not a flat address mapping. The token holder is the authority for everything the workspace touches: signing membership changes, transferring ownership, controlling governance.

This buys four big properties:
- **Compromise resistance**: hold the NFT in a Gnosis Safe (M-of-N). Losing one signing key does not lose the workspace, and one compromised key cannot drain it.
- **Recovery**: rotate authority by transferring the NFT — standard `safeTransferFrom`. Safes additionally inherit Safe's existing recovery modules (Zodiac, social recovery cosigner, etc.) without any custom contract logic.
- **No accidental loss**: approvals are disabled at the NFT contract level — there is no way to authorize a third party (marketplace, dapp, sketchy operator contract) to move the workspace. Only the current holder can.
- **Workspace-scoped permissions**: snapshots, preservations, and release revoke/supersede are gated on *live* workspace membership rather than the wallet that originally claimed a repo. So rotating the workspace NFT immediately transfers practical authority over every repo in the workspace — no need to also `transferRepo` each one. Historical `author` fields stay frozen as provenance.

Regular EOA wallets continue to work without changes — the NFT lives in your wallet exactly like any other ERC-721, and signature-based membership operations accept ordinary 65-byte ECDSA signatures.

See [docs/CodeQuillWorkspaceNFT.md](docs/CodeQuillWorkspaceNFT.md) and [docs/CodeQuillWorkspaceRegistry.md](docs/CodeQuillWorkspaceRegistry.md) for the full design.

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

> **Deployment order matters.** `CodeQuillWorkspaceNFT` must be deployed first, then `CodeQuillWorkspaceRegistry(nftAddr)`, then the downstream registries (Delegation, Repository, Snapshot, Preservation, Release, Attestation) which take the registry address in their constructors.

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

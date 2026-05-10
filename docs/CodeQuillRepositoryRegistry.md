# CodeQuillRepositoryRegistry

The `CodeQuillRepositoryRegistry` is responsible for tracking ownership of software repositories within the CodeQuill ecosystem. It ensures that every repository is bound to a specific owner and a specific workspace (**Context**).

## Core Concepts

### Repository Claims
A repository must be "claimed" before any other actions (like creating snapshots or preservations) can be performed. Claiming a repository establishes a verifiable link between the `repoId` (which could be a hash of the project name or a unique UUID) and an owner's wallet.

### Workspace Binding
Every claimed repository is associated with a `contextId`. This binding ensures that only members of that workspace can interact with the repository's on-chain data — see `CodeQuillSnapshotRegistry` and `CodeQuillPreservationRegistry`, which gate on `workspace.isMember(repoContextId, author)` rather than on the repo's claim wallet.

### `repoOwner` is Provenance + Transfer Authority, Not Permission
`repoOwner[repoId]` is the wallet that *claimed* the repo. In v2 it is used for exactly two things:

1. **Provenance.** It's recorded forever as "this address claimed this repo." Other registries do not gate ongoing work on it.
2. **Transfer authority.** Only the current `repoOwner` (or their `SCOPE_CLAIM` delegate) may call `transferRepo` to reassign the repo to a new owner or move it to a new workspace.

If a `repoOwner` wallet is compromised or lost, the workspace authority can transfer the workspace NFT (rotating *workspace* authority); after that, any member can still snapshot/preserve the repo. The compromised wallet can only block `transferRepo` until it's reissued — and even then, only for the repos it specifically claimed, not the whole workspace.

### Delegation-Aware
Like other registries in the ecosystem, the `RepositoryRegistry` is fully integrated with the `CodeQuillDelegation` system. This allows owners to authorize relayers to claim or transfer repositories on their behalf, provided they have the `SCOPE_CLAIM` permission.

---

## Data Structures

### 1. Repository Owner Mapping
`mapping(bytes32 => address) public repoOwner`
*   **Key**: `repoId` (Unique identifier for the repository).
*   **Value**: The wallet address of the current claim holder.
*   **Used for**: Provenance and `transferRepo` authorization (only). Not used by downstream registries.

### 2. Repository Context Mapping
`mapping(bytes32 => bytes32) public repoContextId`
*   **Key**: `repoId`.
*   **Value**: The `contextId` (Workspace) the repository belongs to.
*   **Used for**: Membership gating in `CodeQuillSnapshotRegistry`, `CodeQuillPreservationRegistry`, `CodeQuillReleaseRegistry`.

### 3. Owner's Repository List
`mapping(address => bytes32[]) private reposByOwner`
*   **Concept**: A convenience list that tracks all `repoIds` owned by a specific address. Primarily used for UI discovery.

---

## Key Operations

*   **`claimRepo`**: Allows a workspace member to register ownership of a new `repoId`.
    *   **Rule**: The `owner_` must be a member of the specified `contextId`.
    *   **Rule**: `msg.sender` must be `owner_` OR have an active `SCOPE_CLAIM` delegation from `owner_` for `contextId`.
    *   **Rule**: The `repoId` must not have been claimed before.
*   **`transferRepo`**: Allows the current owner (or their delegated signer) to transfer ownership to a new wallet or move the repository to a different workspace.
    *   **Rule**: `msg.sender` must be the current `repoOwner` OR have an active `SCOPE_CLAIM` delegation from the current owner for the repo's current `contextId`.
    *   **Rule**: The new owner must be a member of the new destination workspace.
*   **`isClaimed`**: A view function to check if a repository ID is already registered in the system.
*   **`repoOwners`**: A batch-read function designed for off-chain tools to efficiently query the owners of multiple repositories in a single call.

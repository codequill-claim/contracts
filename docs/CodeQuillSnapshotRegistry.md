# CodeQuillSnapshotRegistry

The `CodeQuillSnapshotRegistry` is used to record immutable "snapshots" of a repository's source code. It uses a combination of Merkle roots and IPFS Content Identifiers (CIDs) to create a verifiable link between on-chain data and off-chain source code.

## Core Concepts

### Source Provenance
A snapshot represents the state of a repository at a specific point in time (e.g., a specific Git commit). By recording this on-chain, CodeQuill provides cryptographic proof that a specific version of the code existed and was published by a specific workspace member.

### Verifiable Content
Snapshots rely on two key pieces of data:
1.  **Merkle Root**: A single hash representing the entire tree of files in the project. This allows anyone with the source code to independently verify that the files haven't been tampered with.
2.  **Manifest CID**: A pointer to an IPFS JSON file that contains the full list of files and their individual hashes, allowing for complete reconstruction of the project state.

### Context Alignment
A snapshot can only be created for a repository within the same workspace (**Context**) where the repository was claimed. This ensures that organizational boundaries are respected.

### Workspace-Scoped Authorization (v2)
**Authorization is workspace-scoped, not pinned to the repo's claim wallet.** Any current member of the repo's workspace `contextId` may author a snapshot — directly or via a relayer they have delegated `SCOPE_SNAPSHOT` to. The wallet that originally claimed the repository (`repoOwner` in `CodeQuillRepositoryRegistry`) is provenance and the wallet authorized to call `transferRepo`; it does NOT gate ongoing snapshot work. This means rotating workspace authority (transferring the workspace NFT) immediately gives the new owner the right to snapshot every repo in the workspace, without per-repo `transferRepo` calls.

---

## Data Structures

### 1. The `Snapshot` Struct
Each snapshot records the following data:

| Field | Type | Description |
| :--- | :--- | :--- |
| `commitHash` | `bytes32` | The Git commit hash associated with this snapshot. |
| `merkleRoot` | `bytes32` | The root hash of the file Merkle tree. Used for verification. |
| `manifestCid` | `string` | IPFS CID for the JSON manifest containing the file list. |
| `timestamp` | `uint256` | Block timestamp when the snapshot was recorded. |
| `author` | `address` | The workspace member who created the snapshot. Recorded as immutable provenance. |

### 2. Snapshots Mapping
`mapping(bytes32 => Snapshot[]) private snapshotsOf`
*   **Concept**: Stores an ordered history of snapshots for each `repoId`.

### 3. Root Index Mapping
`mapping(bytes32 => mapping(bytes32 => uint256)) public snapshotIndexByRoot`
*   **Concept**: Allows for quick lookup of a snapshot by its `merkleRoot`, ensuring that the same code state is not recorded multiple times for the same repo.

---

## Key Operations

*   **`createSnapshot`**: Allows any workspace member (or their delegated signer with `SCOPE_SNAPSHOT`) to record a new state for a repository in their workspace.
    *   **Rule**: The repository must be claimed in the `RepositoryRegistry` and its `repoContextId` must match the passed `contextId`.
    *   **Rule**: `author` must be a current member of the workspace `contextId`. Recorded as immutable provenance.
    *   **Rule**: `msg.sender` must be `author` OR have an active `SCOPE_SNAPSHOT` delegation from `author` for `contextId`.
*   **`getSnapshotsCount`**: Returns the total number of snapshots recorded for a specific repository.
*   **`getSnapshot` / `getSnapshotByRoot`**: View functions to retrieve the full details of a snapshot using either its index in the history or its unique Merkle root.

# CodeQuillPreservationRegistry

The `CodeQuillPreservationRegistry` is an optional registry used to anchor metadata about encrypted source code preservations. It provides a verifiable "proof of existence" for a preservation archive and links it directly to a published code snapshot.

## Core Concepts

### Verifiable Preservations
While CodeQuill primarily deals with Merkle roots and manifest metadata, organizations often need to store the full, plaintext-equivalent history in a single archive (e.g., a `.tar.gz` file). The `PreservationRegistry` records the SHA-256 hash of this archive *before* encryption, providing a way to verify the preservation's integrity without needing to decrypt it first.

### Snapshot Binding
Every preservation anchored in the registry must be linked to a valid `snapshotMerkleRoot` that already exists in the `CodeQuillSnapshotRegistry`. This creates a strong link between the high-level snapshot and the low-level preservation archive.

### No Plaintext Storage
The registry only stores hashes and optional IPFS CIDs (locators). It **never** stores the actual content of the preservation or any encryption keys. The actual preservation file is intended to be stored off-chain (e.g., in a private IPFS cluster or cloud storage).

---

## Data Structures

### 1. The `Preservation` Struct
Each record in the registry contains:

| Field | Type | Description |
| :--- | :--- | :--- |
| `snapshotMerkleRoot` | `bytes32` | The Merkle root of the snapshot this preservation represents. |
| `archiveSha256` | `bytes32` | The SHA-256 hash of the unencrypted archive bytes. |
| `metadataSha256` | `bytes32` | (Optional) SHA-256 hash of a separate preservation metadata JSON. |
| `preservationCid` | `string` | (Optional) IPFS CID or locator for the encrypted preservation file. |
| `timestamp` | `uint256` | Block timestamp when the preservation was anchored. |
| `author` | `address` | The wallet address of the repository owner. |

### 2. Preservations Mapping
`mapping(bytes32 => mapping(bytes32 => Preservation)) private preservationsOf`
*   **Path**: `repoId -> snapshotMerkleRoot`
*   **Concept**: Stores the preservation details for a specific snapshot within a repository. If a new preservation is anchored for the same snapshot, it overwrites the previous record.

---

## Key Operations

*   **`anchorPreservation`**: Allows a repository owner (or their delegated signer with `SCOPE_PRESERVATION`) to record a new preservation record.
    *   **Rule**: The associated snapshot must already be recorded in the `SnapshotRegistry`.
    *   **Rule**: The author must be the current repository owner and a member of the workspace context.
*   **`hasPreservation`**: A view function to check if a preservation has been anchored for a specific snapshot.
*   **`getPreservation`**: Retrieves the full details of a recorded preservation.

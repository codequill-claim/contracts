# CodeQuillReleaseRegistry

The `CodeQuillReleaseRegistry` is the "anchor" of the ecosystem. It provides an immutable, on-chain record of software releases. Its primary purpose is to bind a project's state (represented by source code snapshots) to a specific version name and a governance status, all within the security boundary of a **Workspace**.

## Core Concepts

### Multi-tenant Governance
The registry is designed to support many independent workspaces (identified by a `contextId`) on the same contract. Each workspace can define its own governance rules and executors without interfering with others.

### Release Lifecycle
A release starts as `PENDING`. It can then be `ACCEPTED` or `REJECTED` by an authorized governance authority or a DAO executor. Once anchored, a release can be `revoked` (marked invalid) or `superseded` (replaced by a newer version), creating a verifiable audit trail.

### Authorization Model (v2)
- **Anchor** (`anchorRelease`): `author` and `governanceAuthority` must both be current workspace members. `msg.sender` must be `author` or their `SCOPE_RELEASE` delegate.
- **Revoke** (`revokeRelease`): **Any current workspace member** of the release's `contextId` (or their `SCOPE_RELEASE` delegate) may revoke. The check is `workspace.isMember(r.contextId, author)` — not `r.author == author`. The release's recorded `author` is immutable provenance.
- **Supersede** (`supersedeRelease`): Same workspace-membership rule as revoke.
- **Accept / Reject** (governance): Pinned to the release's designated `governanceAuthority` (or their `SCOPE_RELEASE` delegate, or the workspace's configured `daoExecutor`). This pinning is intentional — governance is a separation-of-duties role that the release author chose at anchor time. If the `governanceAuthority` wallet is compromised, accept/reject for that specific release becomes blocked (a known sharp edge; mitigations live at the workspace policy level).

### Why this matters for compromise recovery
Because revoke/supersede are workspace-scoped, a workspace can clean up its own published history even if individual author wallets are lost — anyone else in the workspace can revoke a release and supersede it with a fresh one. Rotating the workspace NFT therefore rotates the *practical* ability to manage releases, even though historical `author` and `governanceAuthority` fields stay frozen.

---

## Data Structures

### 1. The `Release` Struct
Every release anchored in the registry is stored as a `Release` object.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `bytes32` | Unique identifier for the release (usually a hash). |
| `contextId` | `bytes32` | The **Workspace ID**. Determines membership and governance scope. |
| `repoId` | `bytes32` | The ID of the repository the release is bound to. |
| `merkleRoot` | `bytes32` | The Merkle root of the snapshot the release is bound to. |
| `manifestCid` | `string` | IPFS CID for the release manifest (metadata, changelog, etc.). |
| `name` | `string` | Version string (e.g., `v1.0.4`). |
| `timestamp` | `uint256` | Block timestamp when the release was anchored. |
| `author` | `address` | The workspace member who created the release record. Immutable provenance. |
| `governanceAuthority` | `address` | Wallet designated to manually approve/reject the release. Pinned at anchor time. |
| `supersededBy` | `bytes32` | ID of the release that replaced this one. |
| `revoked` | `bool` | Whether this release has been withdrawn or invalidated. |
| `status` | `Enum` | `PENDING` (0), `ACCEPTED` (1), or `REJECTED` (2). |
| `statusTimestamp` | `uint256` | When the status was last updated. |
| `statusAuthor` | `address` | Who performed the status update (e.g., DAO executor). |

### 2. The `daoExecutors` Mapping
`mapping(bytes32 => address) public daoExecutors`

This mapping is critical for CodeQuill's multi-tenant design:
*   **Context Isolation**: Each `contextId` (Workspace) can link its own external governance engine (e.g., an Aragon DAO).
*   **Why a Mapping?**: It prevents a single global executor from controlling all projects. **Workspace A** can use a DAO, while **Workspace B** can use a simple multisig, and their settings remain isolated.
*   **Permission**: Only a member of the workspace (or their delegated signer) can update the executor for their `contextId`.

---

## Storage & Discovery

*   **`releaseById`**: Direct lookup of any release by its ID.

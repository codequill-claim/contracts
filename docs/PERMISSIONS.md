# CodeQuill Permissions Matrix

This document outlines the access control policies for each privileged function in the CodeQuill smart contracts.

## Permissions Matrix

| Contract | Function | Workspace Authority (NFT holder) | Workspace Member | Repository Owner | Governance Authority | DAO Executor | Delegated Signer | Public |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **WorkspaceNFT** | `mint` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ [0] |
| | `safeTransferFrom` / `transferFrom` | ✅ [A] | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| | `approve` / `setApprovalForAll` | ❌ [B] | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **WorkspaceRegistry** | `setMemberWithSig` | ✅ [1] | ❌ | ❌ | ❌ | ❌ | ⚠️ [1] | ❌ |
| | `leave` | ❌ | ✅ [2] | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Delegation** | `registerDelegationWithSig` | ❌ | ✅ | ❌ | ❌ | ❌ | ⚠️ [1] | ❌ |
| | `revoke` | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| | `revokeWithSig` | ❌ | ✅ | ❌ | ❌ | ❌ | ⚠️ [1] | ❌ |
| **RepositoryRegistry** | `claimRepo` | ❌ | ✅ | ❌ | ❌ | ❌ | ⚠️ [3] | ❌ |
| | `transferRepo` | ❌ | ❌ | ✅ [C] | ❌ | ❌ | ⚠️ [3] | ❌ |
| **SnapshotRegistry** | `createSnapshot` | ❌ | ✅ [W] | ❌ | ❌ | ❌ | ⚠️ [4] | ❌ |
| **PreservationRegistry** | `anchorPreservation` | ❌ | ✅ [W] | ❌ | ❌ | ❌ | ⚠️ [5] | ❌ |
| **ReleaseRegistry** | `anchorRelease` | ❌ | ✅ [W] | ❌ | ❌ | ❌ | ⚠️ [6] | ❌ |
| | `supersedeRelease` | ❌ | ✅ [W] | ❌ | ❌ | ❌ | ⚠️ [6] | ❌ |
| | `revokeRelease` | ❌ | ✅ [W] | ❌ | ❌ | ❌ | ⚠️ [6] | ❌ |
| | `accept` / `reject` (governance) | ❌ | ❌ | ❌ | ✅ | ✅ | ⚠️ [6] | ❌ |
| | `setDaoExecutor` | ❌ | ✅ [W] | ❌ | ❌ | ❌ | ⚠️ [6] | ❌ |
| **AttestationRegistry** | `createAttestation` | ❌ | ✅ [W] | ❌ | ❌ | ❌ | ⚠️ [7] | ❌ |
| | `revokeAttestation` | ❌ | ✅ [W] | ❌ | ❌ | ❌ | ⚠️ [7] | ❌ |

### Footnotes

*   **[0] First-mint-wins**: `mint(contextId, to)` is permissionless — anyone may bootstrap a workspace. The first caller for a given `contextId` wins; subsequent attempts revert with `WorkspaceAlreadyMinted`. The CodeQuill backend only relays mints for contextIds it generated, so squatting an unindexed contextId has no protocol-level effect.
*   **[A] NFT holder**: `safeTransferFrom` / `transferFrom` is callable only by the current token holder. Transferring the token rotates workspace authority — there is no separate `setAuthorityWithSig` function in v2.
*   **[B] Approvals disabled**: `approve` and `setApprovalForAll` revert with `ApprovalsDisabled`. The current holder must call a transfer function themselves; they cannot delegate that power. EOA and Safe transfers still work because in both cases `msg.sender == ownerOf(tokenId)` and no approval is consulted. This blocks marketplace listings, approved-operator contracts, and accidental "approve all" prompts.
*   **[C] Repository owner = the wallet that claimed the repo**. Used only for `transferRepo` authorization and as immutable provenance. Other registries (Snapshot, Preservation, Release, Attestation) gate on `workspace.isMember(contextId, …)` instead, so a compromised claim wallet does not block ongoing work in the workspace.
*   **[W] Workspace-scoped authorization (v2)**: The check is `workspace.isMember(contextId, author)` at call time. The `author` parameter must be a current member of the relevant `contextId`; it does NOT need to match any previously-recorded `repoOwner`, release `author`, or attestation `author`. Historical author fields stay frozen as provenance. This means rotating the workspace NFT immediately transfers practical authority over every repo, release, and attestation in the workspace.
*   **[1] Relayed signature (EOA *or* EIP-1271)**: Allowed if a valid signature from the required authority/owner is provided. WorkspaceRegistry verifies via OpenZeppelin's `SignatureChecker`, which accepts both 65-byte ECDSA signatures (EOAs) and `IERC1271.isValidSignature` blobs (Safes and other contract wallets). The Delegation contract's `revokeWithSig` and `registerDelegationWithSig` still use raw ECDSA — Safe-held authorities should call `revoke` or sign delegations through Safe Tx Builder for now.
*   **[2] Self-Leave**: Any explicit workspace member can remove themselves, provided they are not the current authority (NFT holder). The authority must transfer the NFT before they can leave the workspace.
*   **[3] SCOPE_CLAIM**: Allowed if the `owner_` has delegated `SCOPE_CLAIM` to the `msg.sender` for the given `contextId`.
*   **[4] SCOPE_SNAPSHOT**: Allowed if the `author` has delegated `SCOPE_SNAPSHOT` to the `msg.sender` for the given `contextId`.
*   **[5] SCOPE_PRESERVATION**: Allowed if the `author` has delegated `SCOPE_PRESERVATION` to the `msg.sender` for the given `contextId`.
*   **[6] SCOPE_RELEASE**: Allowed if the `author` (anchor/revoke/supersede) or `governanceAuthority` (accept/reject) has delegated `SCOPE_RELEASE` to the `msg.sender` for the given `contextId`.
*   **[7] SCOPE_ATTEST**: Allowed if the `author` has delegated `SCOPE_ATTEST` to the `msg.sender` for the given `contextId`.

---

## Threat Model Notes

The following privileges are identified as the most sensitive within the CodeQuill ecosystem:

1.  **Workspace Authority (NFT holder)**:
    The holder of the workspace NFT can unilaterally add or remove members and transfer authority. This is the root of trust for all context-scoped operations. Because authority is an ERC-721 with approvals disabled, the only way to move it is for the current holder to call a transfer function themselves. That inherits the security posture of whatever wallet holds it:
    - **EOA**: subject to standard private-key risk. Recommended for testing or low-value workspaces only.
    - **Safe (or other EIP-1271 wallet)**: M-of-N policy means a single compromised key cannot move the NFT or sign membership changes. Strongly recommended for production workspaces. Recovery primitives (Zodiac module, social recovery cosigner, etc.) are inherited from Safe — the protocol does not implement its own recovery layer, on purpose.
    - **Lost authority key with no Safe redundancy**: the workspace is permanently locked. Use Safes if you need recovery.
    - **Approvals disabled**: the NFT cannot be moved via marketplace operators or "approve all" prompts, removing a common foot-gun that's appropriate for JPEGs but unacceptable for organizational authority.

2.  **Repository claim wallet**:
    In v2, `repoOwner[repoId]` only controls `transferRepo` for that specific repo. If a claim wallet is compromised, every other workspace operation (snapshot, release, attestation, preservation) for that repo is still authorized via live workspace membership and continues to work. The compromised wallet can only block `transferRepo` calls until the workspace authority rotates around it (e.g., by calling `transferRepo` from a delegated relayer that the compromised wallet authorized previously, OR by ignoring the repo and not transferring it).

3.  **Release governance authority (per-release pinning)**:
    `governanceAuthority` is pinned to a specific wallet at release-anchor time. If that wallet is compromised, the specific release's accept/reject becomes blocked. This pinning is intentional (separation of duties between release author and approver). Mitigations live at the workspace policy level — anchor new releases with a fresh governance wallet, or designate a DAO executor that can finalize on the original's behalf.

4.  **Delegation (`SCOPE_ALL`)**:
    If a user grants `SCOPE_ALL` to a relayer, that relayer can perform any action on behalf of the user within that workspace context, including claiming repos and anchoring releases. A compromised authority key whose delegations are still active needs to call `revoke` (or `revokeWithSig` via the relayer) to neutralize the relayer's standing scope.

5.  **Signature Replay Prevention**:
    The system relies on nonces for all EIP-712 signatures. The WorkspaceRegistry tracks `nonces[authority]` keyed on the NFT holder address — for Safes, this is the Safe's address, so authority rotation (NFT transfer) automatically resets the relevant nonce surface for the new holder. If nonce management were flawed, signed authorizations could be replayed by malicious relayers.

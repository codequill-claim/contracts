# CodeQuill Contracts — Security Model

This document describes the trust model, security-critical assumptions, and known limitations of the CodeQuill smart contracts. It is intended for sophisticated users (auditors, integrators, workspace owners deciding whether to hold material value in their workspace NFT) — not as marketing material.

For the rated audit findings from the most recent self-audit pass, see [AUDIT_FINDINGS.md](./AUDIT_FINDINGS.md).

---

## Threat model overview

CodeQuill makes immutable on-chain records of *who created what code, when*. The threat model centers on:

- **Authority compromise** — a wallet that controls a workspace gets stolen, drained, or lost.
- **Authorship fabrication** — a malicious actor tries to claim or attest something they didn't author.
- **Workspace-internal griefing** — a member of a workspace tries to escalate their privileges or interfere with other members.
- **Indexer / off-chain divergence** — the contracts must remain authoritative; the app's database is a mirror, not the source of truth.

The contracts are explicitly **not** designed to defend against:

- **Off-chain identity fraud.** If you claim a repo on chain that you don't actually own on GitHub, the contracts won't stop you. The app validates GitHub ownership before relaying claims; the on-chain record is downstream of that decision.
- **Total key loss with no recovery setup.** If you hold the workspace NFT in a single EOA and lose the key, the workspace is permanently locked. No protocol-level recovery exists. Use a Safe with recovery modules if you need this.
- **Economic attacks on assets.** The contracts don't hold ETH, tokens, or any transferable value beyond the workspace NFT itself. There's nothing for an attacker to drain except authority, which is the threat we focus on.

---

## Trust assumptions

### What you trust about CodeQuill (the project / Ophelios)

The contracts have **no admin keys**. There is no upgradeability, no pause mechanism, no privileged role granted to a CodeQuill-controlled wallet. Once deployed, the only mutable state is the per-workspace data each workspace's authority controls.

What you DO trust the project for, off-chain:

- The CodeQuill backend's relayer signs and broadcasts your transactions in good faith. If the relayer is malicious, it could refuse to broadcast (you lose service) but it cannot forge state because the on-chain functions verify signatures cryptographically.
- The CodeQuill app validates GitHub repo ownership before relaying claim transactions. If the app is compromised, attackers could claim repos they don't own — but only against the trust model of "the on-chain record matches the GitHub record." On-chain integrity itself is unaffected.
- The contextId for each workspace is generated server-side from a 256-bit unguessable workspace UUID. Front-running protection on `WorkspaceNFT.mint` depends on this UUID never leaking before the mint transaction is broadcast.

### What you trust about your own wallet

The wallet that holds your workspace NFT IS the workspace authority. Compromise of that wallet = compromise of the workspace. Mitigations:

- **Production workspaces should hold the NFT in a Safe** (or another EIP-1271 contract wallet with a multi-signer policy). All authority operations — `setMemberWithSig` on the registry, `safeTransferFrom` on the NFT itself — accept Safe signatures via `SignatureChecker`.
- **Approvals are disabled on the NFT** (`approve` and `setApprovalForAll` revert). The NFT cannot be moved by a marketplace operator or via an "approve all" prompt. Only a direct call from the holder transfers the workspace.
- **Relayer delegations** to the CodeQuill backend are scoped (per workspace context, per scope bitmask) and time-bounded (per-delegation expiry). Revoke them via `Delegation.revoke(relayer, contextId)` if you want to cut off the backend's ability to act on your behalf.

---

## Authority model

### Workspace authority is an ERC-721 NFT

`CodeQuillWorkspaceNFT` is the source of truth. The token holder for `tokenId == uint256(contextId)` IS the workspace authority. `CodeQuillWorkspaceRegistry.authorityOf(contextId)` is a thin view that calls `nft.ownerOf(uint256(contextId))`.

**Implications:**

- Authority rotation = `safeTransferFrom`. No bespoke EIP-712 signing path for rotation; no `setAuthorityWithSig` function.
- The NFT can be held by an EOA, a Safe, a Zodiac module, a custom contract wallet — anything that can hold an ERC-721 and (if needed) sign via EIP-1271.
- Approvals are disabled — the NFT can only be transferred by a direct call from the current holder. Marketplace approvals and "approve all" attacks are not possible.
- Loss of the holder wallet permanently locks the workspace. There is no protocol-level recovery; mitigation is at the wallet layer (Safe recovery modules).

### Membership

Workspace members are tracked in `CodeQuillWorkspaceRegistry._members[contextId][address]`. The NFT holder is implicitly always a member (`isMember` returns `true` for them without needing an explicit entry).

`setMemberWithSig` requires a signature from the current authority (NFT holder), verified via OpenZeppelin's `SignatureChecker`. Both EOA (65-byte ECDSA) and EIP-1271 (Safe) signatures are accepted.

### Workspace-scoped permissions

Snapshots, preservations, and release revoke/supersede are all gated on **current** workspace membership rather than on the wallet that originally claimed a repo or anchored a release. This means rotating the workspace NFT immediately rotates practical authority over every repo, snapshot, and release in the workspace, without per-resource transfers. Historical `author` fields stay frozen as immutable provenance.

The exceptions are deliberate:

- **`Repository.transferRepo`** — only the current `repoOwner` (or their `SCOPE_CLAIM` delegate) can transfer a repo. The repo claim wallet retains transfer authority over its specific repo. This is the correct invariant for that one function.
- **`Release.accept` / `reject`** — pinned to the release's designated `governanceAuthority` (or their `SCOPE_RELEASE` delegate, or the workspace's configured `daoExecutor`). Separation of duties between release author and approver. If the `governanceAuthority` wallet is compromised, accept/reject for that specific release becomes blocked — by design.
- **`Release.setDaoExecutor`** — restricted to the workspace authority (NFT holder). The DAO executor can finalize any release in the workspace, so this is a privileged role; only the authority may configure it.

---

## Signature handling

### EIP-712 + EIP-1271

All signature-verifying functions use OpenZeppelin's `SignatureChecker.isValidSignatureNow(signer, digest, signature)`, which accepts:

- 65-byte ECDSA signatures from EOAs.
- `IERC1271.isValidSignature(digest, signature)` callbacks for contract wallets (Safes, etc.).

**Domain separators include `chainId` and `verifyingContract`**, so signatures cannot be replayed across chains or across deployments of the same contract.

**EIP-712 domain version is `"2"`** for `CodeQuillWorkspaceRegistry` (post-NFT refactor) and `"1"` for `CodeQuillDelegation`. Signatures from a v1 registry deployment cannot be replayed against v2.

### Nonces

Each signing surface uses per-signer nonces:

- `CodeQuillWorkspaceRegistry.nonces[authority]` — incremented after every successful `setMemberWithSig`.
- `CodeQuillDelegation.nonces[owner]` — incremented after every successful `registerDelegationWithSig` / `revokeWithSig`.

Once a signature is accepted, its nonce is consumed. Replay of the same signature is impossible.

**Known edge case (Low severity):** If the workspace NFT is transferred away and then transferred back to the same wallet within the deadline window of an unbroadcast `setMemberWithSig` signature, the old signature can still be accepted. The signature deadline (typically 15 minutes in the app) bounds this window. Mitigation: don't sign authority-level operations against a wallet you're about to transfer out and back; treat unbroadcast signatures as live until they expire.

### `setMember(authority, true)` early-return semantics

`setMemberWithSig(contextId, authority, true, deadline, signature)` — where `authority` is the current NFT holder — returns immediately as a no-op without consuming a nonce or validating the signature. The authority is implicitly always a member, so the operation is meaningless. No state changes occur regardless of the signature passed. This is safe but worth knowing if a caller relies on the function reverting for invalid signatures in this specific case.

---

## Front-running and mempool risk

### `WorkspaceNFT.mint`

Mint is permissionless and first-write-wins on `contextId`. The relayer's mint transaction is in the public mempool with the contextId visible. An attacker who learned a workspace's contextId before the legitimate mint could submit a competing mint with higher gas.

**Mitigation:** contextId is `keccak256(workspace_uuid)` where `workspace_uuid` is a 256-bit server-generated value never exposed publicly before the mint is broadcast. The app must not leak workspace UUIDs (e.g., in URLs, logs, or API responses) before the mint transaction is confirmed.

If a mint is front-run despite this, the legitimate user can simply regenerate a fresh workspace UUID and re-issue the mint. The squatted workspace has no off-chain identity and is invisible to the rest of the platform.

### `Repository.claimRepo`

Caller-supplied `repoId`. If the backend uses a predictable derivation (e.g., `keccak256(github_repo_id_numeric)`), an attacker who is a workspace member of any workspace could front-run a legitimate claim by another workspace.

**Mitigation:** the app validates GitHub repo ownership before relaying a claim. An attacker without access to the repo on GitHub cannot get the backend to relay a claim for them. The on-chain function would still accept their claim if they submitted it directly with their own gas — but there's no way for the legitimate owner to recover an unjustly-claimed repo on-chain without a `transferRepo` from the squatter.

### `Release.anchorRelease`

Caller-supplied `releaseId`. Same race risk. **Mitigation:** the backend should generate `releaseId` with sufficient entropy (e.g. include a random salt or workspace+repo+timestamp hash) so that an attacker cannot predict and pre-empt a legitimate release.

---

## DoS / griefing surfaces

### Within-workspace griefing

Workspace members are partially trusted; the protocol does not defend against members griefing each other in subtle ways:

- **`Snapshot.createSnapshot` first-write-wins on `merkleRoot`** — a member could pre-empt another member by submitting a snapshot first. Acceptable trust assumption: members are vetted by the workspace authority before being added.
- **`Preservation.anchorPreservation` overwrite semantics** — a new preservation for the same `(repoId, snapshotMerkleRoot)` pair overwrites the previous record. A bad-acting member could overwrite a legitimate preservation with a bogus one. This is intentional (supports re-encryption / re-key flows) but workspace authorities should be aware. See AUDIT_FINDINGS.md for more.
- **`Repository.transferRepo` doesn't require recipient consent** — the current claim holder can hand a repo to any other workspace member without their approval. Relayer pays gas, so no material harm; the recipient's `reposByOwner` array gets longer.

### Outside-workspace griefing

External attackers (non-members) cannot interfere with a workspace's snapshots, releases, attestations, or preservations. All write paths require `workspace.isMember(contextId, author)` or a delegation from a member.

External attackers CAN front-run mints (above) and claim repos (above).

### Storage growth

`Repository.reposByOwner[address]` and `Snapshot.snapshotsOf[repoId]` are unbounded arrays. They never shrink. UI consumers should accept that these grow over time and may need pagination.

---

## Cross-contract dependencies

The contracts form a dependency graph:

```
WorkspaceNFT ← WorkspaceRegistry ← (Snapshot, Preservation, Release, Attestation, Repository)
                                     ↑                                   ↑
                                     └──── Delegation ────────────────────┘
```

Each downstream contract stores the addresses of its dependencies as `immutable` constructor parameters. There is no admin function to update them; if a dependency needs replacing, the entire downstream stack must be redeployed.

**Each contract validates its dependencies are non-zero at construction.** A misdeploy with a zero address would revert in the constructor.

**The dependencies are trusted to be the actual CodeQuill contracts.** If a malicious deployer constructed a downstream contract pointing at a fake `Delegation` or `WorkspaceRegistry`, the fake could lie about authorization. This is a deployment-time concern, not a runtime one.

---

## Repository transferability and recovery

If a wallet that holds a repo claim is compromised or lost:

- **Workspace authority is unaffected.** The compromised wallet only controls `transferRepo` for its specific repos. Snapshots, preservations, releases, and attestations for those repos can still be performed by any current workspace member.
- **The compromised wallet can still call `transferRepo`** until it's removed from the workspace. The workspace authority should call `setMemberWithSig(member, false)` to remove the compromised wallet, after which the wallet can no longer act in any other capacity (claim new repos, etc.) — but it retains `transferRepo` rights over its existing repos. This is a deliberate trade-off: repo claim ownership is "decentralized" within the protocol.
- **To regain control of a specific repo from a lost claim wallet:** there is no on-chain primitive. The repo's claim is permanent until the claim wallet either transfers it or signs a delegation. Off-chain mitigation: the workspace can simply ignore the repo and claim a fresh one (the on-chain claim is descriptive, not prescriptive).

---

## Encryption and off-chain components (for context)

The contracts deliberately do not hold any decryption keys, plaintext archives, or off-chain secrets. Workspace encryption (used for `Preservation` archives) is keyed off a WebAuthn passkey and lives entirely client-side. The contracts only anchor hashes and IPFS CIDs.

A compromised workspace authority cannot decrypt existing preservations because they don't have the passkey. Conversely, a lost passkey leaves the user unable to decrypt their own preservations regardless of on-chain authority. These are independent concerns.

---

## Disclosed limitations summary

| Category | Item |
|---|---|
| Authority recovery | No protocol-level recovery for total key loss. Use Safe + recovery modules. |
| Front-running | `mint`, `claimRepo`, `anchorRelease` are all caller-supplied-ID first-write-wins. Mitigated by entropy + off-chain validation. |
| Replay window | NFT-transfer-back within signature deadline allows replay of pending authority signatures. |
| Repo recovery | Lost repo claim wallet cannot be recovered on-chain. |
| Within-workspace griefing | Members are partially trusted; some operations (preservation overwrite) allow within-workspace interference. |
| Storage growth | Unbounded arrays in Repository and Snapshot grow over time. |
| Delegation EIP-1271 (V2) | Both `register` and `revoke` use SignatureChecker so Safes can delegate gaslessly. |
| Approvals | NFT approvals disabled. Holder must transfer the NFT directly. |

---

## Reporting a vulnerability

If you find a security issue in these contracts that is not already documented above or in `AUDIT_FINDINGS.md`, please report it to **security@ophelios.com** before public disclosure.

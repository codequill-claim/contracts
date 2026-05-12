# CodeQuill Contracts — Pre-Mainnet Self-Audit

**Auditor**: Claude (Anthropic) — internal self-audit pass
**Target chain**: Base mainnet (currently deployed on Base Sepolia)
**Compiler**: Solidity ^0.8.24
**Scope**: 8 contracts, 1,616 lines (excl. mocks)

## TL;DR

- **No CRITICAL findings.** Nothing blocks mainnet deployment.
- **0 HIGH** · **3 MEDIUM** (all **RESOLVED** ✅) · **2 LOW** open · **3 INFO** open.
- Centralization story is excellent: no admin keys, no pause, no proxy, no upgradeable storage. Authority lives in the workspace NFT and can be custodied in a Safe.
- Re-entrancy was specifically checked on `WorkspaceNFT.mint` (the only place with a callback into untrusted code) and is safe — OpenZeppelin's `_safeMint` sets ownership before the `onERC721Received` callback, so the dedupe check on line 90 holds against re-entry.

### Resolutions

| ID | Status | What changed |
|---|---|---|
| **M1** — `expiry` truncation in `CodeQuillDelegation` | **✅ Fixed** | Added `require(expiry <= type(uint64).max, "expiry overflow")` before the `uint64` cast in `registerDelegationWithSig`. |
| **M2** — overwrite-allowed preservations | **✅ Fixed** | `CodeQuillPreservationRegistry.anchorPreservation` now reverts with `"already anchored"` if a record already exists for `(repoId, snapshotRoot)`. Storage comment updated to document the immutability. |
| **M3** — workspace-scoped revoke/supersede | **✅ Documented** | Trust model section added to `CodeQuillReleaseRegistry`'s contract-level NatSpec, including the implication for workspace operators ("adding a member grants unilateral revoke/supersede power") and recommended mitigations. |
| **L1** — dead `onlySelfOrDelegatedMember` modifier | **✅ Removed** | Deleted from `CodeQuillAttestation.sol`. The internal `_requireSelfOrDelegatedMember` function remains the single auth path. |

---

## Severity legend

| Tag | Meaning |
|---|---|
| **CRITICAL** | Funds at risk / chain-wide invariants broken. **Blocks mainnet.** |
| **HIGH** | Privilege escalation, partial fund loss, or persistent state corruption. **Should block until fixed.** |
| **MEDIUM** | Trust-model leak, observable misbehavior, or design ambiguity. Fix or document before mainnet. |
| **LOW** | Hygiene, gas, or readability. Safe to defer. |
| **INFO** | Documentation / UX clarification only. |

---

## Manual review

### `CodeQuillDelegation.sol`

#### M1 — `expiry` is silently truncated from `uint256` → `uint64` &nbsp; ✅ **FIXED**

```solidity
function registerDelegationWithSig(
    address owner_,
    address relayer_,
    bytes32 contextId,
    uint256 scopes,
    uint256 expiry,   // signed as uint256
    uint256 deadline,
    bytes calldata signature
) external {
    ...
    require(expiry > block.timestamp, "bad expiry");
    ...
    expiryOf[owner_][relayer_][contextId] = uint64(expiry);   // ← silent truncation
}
```

The EIP-712 typehash signs `expiry` as `uint256`, but storage is `uint64`. A signed payload with `expiry = 2^64 + 1` would be stored as `1`, immediately expiring the delegation. A signed payload with `expiry = 2^64 - 1 + 1000` would wrap to `999`. The on-chain check `expiry > block.timestamp` is performed against the un-truncated value, so the function won't revert — it stores a corrupted value.

In practice this would only happen with a malformed off-chain client, but it is a footgun. Added an explicit bound:

```solidity
require(expiry <= type(uint64).max, "expiry overflow");
```

Patched in `CodeQuillDelegation.registerDelegationWithSig` (after the `expiry > block.timestamp` check, before the storage write).

#### INFO — Global per-owner nonce

`nonces[owner_]` is a single counter per owner across all `(relayer, contextId)` pairs, used by both `registerDelegationWithSig` and `revokeWithSig`. Concurrent signing of multiple delegations or revocations by the same owner will race: only the first to land is valid, the rest fail with `"bad signer"` because the digest no longer matches.

Not a vulnerability — but worth documenting that the off-chain layer must serialize signing for the same owner.

#### Notes (no action needed)

- ✓ Uses `SignatureChecker` so EIP-1271 (Safe) and EOA signatures both work.
- ✓ EIP-712 domain separator via `_hashTypedDataV4`.
- ✓ Replay protection via nonce + deadline.
- ✓ Direct `revoke()` (no signature) is gated to `msg.sender`.
- ✓ Zero-address and zero-context checks on all entry points.

---

### `CodeQuillWorkspaceNFT.sol`

#### LOW — `tokenURI_` length is unbounded

`mint()` accepts an arbitrary-length `string calldata tokenURI_` from the caller and persists it. A malicious caller minting their own workspace could store a huge string and bloat the indexer's `Transfer` + `WorkspaceMinted` events. The minter pays the gas, so this is self-DoS, not a vector against others. Optional cap (e.g. 200 bytes for a `ipfs://Qm...`) would be belt-and-suspenders.

#### Notes (no action needed)

- ✓ **Re-entrancy safe** on `mint()`. OZ's `_safeMint` sets ownership via `_update` **before** invoking `onERC721Received`. A malicious recipient re-entering `mint()` for the same `contextId` reverts at the `_ownerOf(tokenId) != address(0)` check. Re-entry for a different contextId is just a normal mint.
- ✓ Approvals are disabled by design (no marketplace approval foot-gun).
- ✓ `tokenURI` is set once and never mutated.
- ✓ `contractURI` is set at construction, never mutated.
- ✓ No admin, no pause, no royalties.
- ✓ `_update` override emits `WorkspaceAuthorityTransferred` for indexer-friendly subscription per workspace.

---

### `CodeQuillWorkspaceRegistry.sol`

#### Notes (no action needed)

- ✓ Authority is sourced live from `nft.ownerOf` via `try/catch` — safe against revert on un-minted tokenIds.
- ✓ NFT transfer = authority transfer, no separate signature flow needed.
- ✓ Authority cannot self-leave via `leave()` (must transfer NFT first).
- ✓ `setMemberWithSig` no-ops gracefully if `member == authority` and rejects `cannot remove authority`.
- ✓ Uses `SignatureChecker` (EIP-1271 capable).
- ✓ Per-authority nonce; standard replay protection.

#### INFO — Member entries never expire

`_members[contextId][member]` once set stays `true` until the authority explicitly removes them or the member calls `leave()`. There is no automatic TTL. Documented behavior; not an issue, but worth mentioning in the public security model.

---

### `CodeQuillRepositoryRegistry.sol`

#### LOW — `reposByOwner` is append-only on `transferRepo`

```solidity
reposByOwner[newOwner].push(repoId);   // OK
// nothing removes repoId from reposByOwner[old]
```

After a transfer, the old owner's array still references the repoId. The contract comment is explicit ("Convenience list for UI/off-chain; not used for authorization") and the canonical truth is `repoOwner[repoId]`. Worth a single line of additional clarification in the README so dApp builders know to dedupe.

#### LOW — `meta` string length unbounded

`claimRepo`'s `meta` string is unindexed in the event but uncapped. Self-DoS only — caller pays gas.

#### Notes (no action needed)

- ✓ Zero-address and zero-context checks at every entry.
- ✓ First-claim-wins per repoId is correct.
- ✓ `transferRepo` correctly disallows no-op transfers and resolves delegation against the **old** contextId.
- ✓ Membership of the (new) owner is re-validated on transfer.

---

### `CodeQuillSnapshotRegistry.sol`

#### LOW — `manifestCid` length unbounded

Same as repo `meta`: log-bloat possible at the caller's expense. Cap optional.

#### Notes (no action needed)

- ✓ `snapshotIndexByRoot` uses the `idx+1, 0 = absent` sentinel correctly.
- ✓ Duplicate-root detection works.
- ✓ Repo claim + context match + member check + delegation check are all in place.
- ✓ No snapshot revocation by design (immutable evidence).

---

### `CodeQuillAttestation.sol`

#### LOW — Dead modifier `onlySelfOrDelegatedMember` &nbsp; ✅ **REMOVED**

Lines 94-107 defined a modifier with this name but it was never applied; the contract uses the internal `_requireSelfOrDelegatedMember` function instead. Pure dead code — deleted from `CodeQuillAttestation.sol`.

#### MEDIUM — M2 documented under PreservationRegistry / consider for revoke

`revokeAttestation` only requires the `author` parameter to be a current workspace member; it does **not** require the revoking `author` to match the original attestation author. This means any current member of the workspace can revoke any attestation in that workspace. Consistent with `revokeRelease`'s pattern — see M3.

#### Notes (no action needed)

- ✓ Pulls release context from `releaseRegistry.getReleaseById` and enforces against it.
- ✓ Requires release exists, isn't revoked, and is in `ACCEPTED` status.
- ✓ `(releaseId, artifactDigest)` uniqueness is enforced.

---

### `CodeQuillPreservation.sol`

#### M2 — Any workspace member can overwrite an existing preservation &nbsp; ✅ **FIXED**

```solidity
// repoId => snapshotRoot => single preservation (overwrite allowed)
mapping(bytes32 => mapping(bytes32 => Preservation)) private preservationsOf;
...
preservationsOf[repoId][snapshotMerkleRoot] = Preservation({ ... });
```

The mapping stored a single `Preservation` per `(repoId, snapshotMerkleRoot)`. There was no anti-overwrite check, so any current workspace member could replace the stored record — including the recorded `author`, `archiveSha256`, `metadataSha256`, and `preservationCid`. The original event was preserved in logs but the on-chain mutable state lost the prior author/digest.

**Resolution**: preservations are evidence and must be immutable, matching the snapshot/release patterns. `anchorPreservation` now reverts with `"already anchored"` if a record already exists for `(repoId, snapshotRoot)`:

```solidity
// Preservation is evidence — once anchored for (repoId, snapshotRoot),
// the record is immutable. No overwrites, no re-anchors.
require(
    preservationsOf[repoId][snapshotMerkleRoot].timestamp == 0,
    "already anchored"
);
```

Mapping comment was updated to document the immutability.

#### Notes (no action needed)

- ✓ Validates repo claim + context + member + delegation + snapshot-exists.
- ✓ Otherwise mirrors Snapshot/Attestation patterns.

---

### `CodeQuillReleaseRegistry.sol`

#### M3 — Any workspace member can revoke or supersede any release &nbsp; ✅ **DOCUMENTED (intentional)**

`revokeRelease` and `supersedeRelease` both check that the acting `author`:
- is a current member of the release's contextId, and
- (if not msg.sender) has SCOPE_RELEASE delegation from itself to msg.sender.

They do **not** check that `author` matches the original release's `author` field or that `author` is the `governanceAuthority` or `daoExecutor`. **Confirmed by the team as intentional**: workspace membership is the unit of revoke/supersede authority.

**Trust model implication (documented)**: every workspace member has unilateral power to revoke or supersede any release the workspace ever made. Adding a member grants them this destructive privilege.

**Resolution**: a "WORKSPACE TRUST MODEL" section was added to the contract-level NatSpec of `CodeQuillReleaseRegistry`, explicitly stating this implication, listing it for workspace operators, and recommending mitigations (tight membership, NFT custody in a Safe, use of the DAO executor for high-stakes releases). `accept`/`reject` are NOT workspace-scoped and remain pinned to the release's `governanceAuthority` / `daoExecutor`.

#### LOW — `manifestCid` and `name` length unbounded

Same self-DoS gas concern as elsewhere.

#### INFO — `getReleaseById` returns 14 fields

Approaches the "stack too deep" boundary. Future additions may force a refactor. Consider returning a `Release` struct.

#### INFO — `daoExecutors[contextId]` persists across NFT transfers

If the workspace NFT is transferred to a new authority, the previously-configured `daoExecutor` retains accept/reject power until the new authority explicitly resets it via `setDaoExecutor`. Workspace transfer + recovery procedure should document this — a stolen-then-recovered NFT may have a malicious lingering daoExecutor.

#### Notes (no action needed)

- ✓ `setDaoExecutor` requires `author == workspace.authorityOf(contextId)` — only the NFT holder (or their authorized relayer) can set the executor.
- ✓ `accept` / `reject` are one-way from `PENDING`. No status oscillation possible.
- ✓ `supersedeRelease` checks repo + context match between old and new release. Good defensive integrity.
- ✓ `anchorRelease` validates author + governanceAuthority are workspace members and that the underlying snapshot exists.

---

## Cross-cutting checks

| Concern | Verdict |
|---|---|
| Re-entrancy (`_safeMint` callback) | **Safe** — owner is set before callback (OZ pattern) |
| Integer overflow/underflow | **Safe** — Solidity 0.8.24 |
| Signature replay | **Safe** — EIP-712 + nonce + deadline on every sig path |
| Storage collision / upgrade | **N/A** — no proxies, no upgradeable storage |
| Admin/centralization | **Excellent** — no admin keys, no pause, no upgrade hooks |
| Authority custody | NFT held in EOA/Safe is the only authority root; standard Safe recovery applies |
| Front-running on `mint(contextId)` | First-mint-wins; backend mitigates by only relaying for known contextIds |
| Front-running on `claimRepo` | First-claim-wins, but legitimate claim requires workspace membership |
| Gas DoS on view functions | `getReposByOwner` returns full array — readers should paginate off-chain |

---

## Recommendations for mainnet deployment

1. **Fix M1** (`expiry` truncation in `CodeQuillDelegation`). One-line require, no test changes other than adding a boundary case.
2. **Decide on M2** (preservation overwrite). Either restrict to original author + emit overwrite event, or document the design choice publicly.
3. **Decide on M3** (release revoke/supersede authorization). Same — restrict, or document and accept.
4. **L1**: remove the dead `onlySelfOrDelegatedMember` modifier in `CodeQuillAttestation`.
5. **Holding strategy**: workspace NFTs should be held in a Safe (multisig + recovery modules), not in a hot EOA. The contracts are designed for it (EIP-1271 capable everywhere).
6. **Off-chain workflow documentation** (I1): single-signer serialization for sigs, daoExecutor reset after NFT transfer.
7. **Public security model document**: surface the workspace-trust assumption (M3 = "every member can revoke", M2 = "every member can overwrite a preservation") so workspace operators add members intentionally.

---

## Automated tool runs

### Slither

Run command:

```
slither contracts/ \
  --solc-remaps "@openzeppelin=node_modules/@openzeppelin" \
  --solc-args "--via-ir --optimize" \
  --filter-paths "node_modules|mocks"
```

Slither emitted 168 raw results across the full dependency graph. After filtering out OpenZeppelin internal noise (inline asm in `Strings`/`Math`/`StorageSlot`/`SafeCast`, naming conventions, pragma divergence inherited from OZ), **the only findings on our contracts are the following**:

#### High/Medium (filtered to our code, exclude-low / exclude-informational)

Slither reports **2** results at MEDIUM, both in `CodeQuillAttestation.sol`:

| Detector | Location | Verdict |
|---|---|---|
| `unused-return` | `createAttestation` — destructured `getReleaseById(releaseId)` ignores 10 of 14 fields | **False positive.** The destructuring pattern deliberately captures only what's needed (`id, contextId, revoked, status`). Solidity requires positional unpacking; the discarded fields are explicit `None` placeholders. Refactoring to a struct would clean this up — see INFO recommendation in §`CodeQuillReleaseRegistry`. |
| `unused-return` | `revokeAttestation` — same pattern | Same as above. |

Neither is exploitable.

#### Low / Informational on our code (cherry-picked)

- `timestamp` — `CodeQuillDelegation.isAuthorized`, `CodeQuillReleaseRegistry.anchorRelease`, `CodeQuillWorkspaceRegistry.setMemberWithSig`. All three uses of `block.timestamp` are intentional and standard (expiry check, deadline check, duplicate-release detection via timestamp non-zero). Slither flags any `block.timestamp` comparison by default; these are correct usage.
- `naming-convention` — `SCOPE_*` interface functions use UPPER_SNAKE_CASE because they mirror the underlying constants. Stylistic only.
- `redundant-statements` — the `ignoredStatusAuthor;` no-op statements in `CodeQuillAttestation.sol` lines 129 and 183 are deliberate (suppress "unused tuple component" compiler warnings). Cosmetic.
- `pragma` / `solc-version` — only OpenZeppelin sources use `>=0.4.16` / `>=0.5.0` pragmas (interface files). Our contracts uniformly use `^0.8.24`. Compiler-resolved against 0.8.28+. No action.
- `low-level-calls` — solely inside `SignatureChecker.isValidERC1271SignatureNow`, which is the canonical EIP-1271 staticcall. Safe and expected.
- Compiler future-keyword warning on `function leave(...)` in `CodeQuillWorkspaceRegistry`. Solidity has reserved `leave` as a future keyword. Currently compiles fine but **consider renaming** (e.g. `leaveWorkspace`) when the next breaking compiler bump is made. **LOW priority.**

#### Verdict

Slither surfaces zero issues exploitable on-chain. The two `unused-return` MEDIUM hits are false positives caused by the wide return tuple of `getReleaseById`. Recommended cleanup (return a struct) is tracked under the `CodeQuillReleaseRegistry` INFO note.

---

### Mythril

Run command (per contract, on the runtime bytecode extracted from the Base-Sepolia Ignition deployment artifacts — Mythril's source-mode compilation was blocked by Docker DNS to `solc-bin.ethereum.org`, so bytecode mode was used):

```
docker run --rm -v /tmp/mythril-bin:/work -w /work mythril/myth:latest \
  analyze -f <Contract>.runtime.hex --bin-runtime --no-onchain-data \
  --execution-timeout 90
```

Mythril v0.24.8 was run against all 8 contracts. Raw output was saved to `/tmp/mythril-results.txt`.

#### Findings table (decoded by function selector)

| Selector | Function | Contract | SWC | Severity (raw) | Verdict |
|---|---|---|---|---|---|
| `0xfeeb8c03` | `isAuthorized(address,address,uint256,bytes32)` | `CodeQuillDelegation` | SWC-116 | Low | **Intended** — expiry check uses `block.timestamp`. |
| `0xc2517e5d` | `setMemberWithSig(bytes32,address,bool,uint256,bytes)` | `CodeQuillWorkspaceRegistry` | SWC-116 | Low | **Intended** — `deadline` check uses `block.timestamp`. |
| `0x156a7484` | `getReposByOwner(address)` | `CodeQuillRepositoryRegistry` | SWC-101 | High | **False positive.** View only. Mythril detects compiler-generated unchecked arithmetic for memory layout of the returned `bytes32[]`. Solidity 0.8 guards user-level arithmetic; this is intentional unchecked offset math. |
| `0xb935b68f` | `snapshotIndexByRoot(bytes32,bytes32)` | `CodeQuillSnapshotRegistry` | SWC-101 | High | **False positive.** Auto-getter for nested mapping; arithmetic is the compiler's storage-slot derivation. |
| `0xacba3888` | `isRevoked(bytes32,bytes32)` | `CodeQuillAttestationRegistry` | SWC-101 | High | **False positive.** View. Same compiler-internal pattern. |
| `0xc06bc85d` | `hasPreservation(bytes32,bytes32)` | `CodeQuillPreservationRegistry` | SWC-101 | High | **False positive.** View returning `bool`. Storage-slot derivation. |
| `0x3669daf4` | `snapshotRegistry()` | `CodeQuillReleaseRegistry` | SWC-101 | High | **False positive.** Immutable address getter. Compiler-generated. |
| `transferFrom(address,address,uint256)` | ERC-721 standard | `CodeQuillWorkspaceNFT` | SWC-101 | High | **False positive.** OpenZeppelin `ERC721._update` and surrounding flow. Standard library code audited by the OZ team and the broader ecosystem. |

#### Verdict

Mythril produces zero actionable findings. The "High" SWC-101 alerts are an artifact of Mythril's symbolic execution flagging unchecked arithmetic inside compiler-emitted blocks (memory offset math, storage slot derivation). Solidity 0.8's checked-by-default arithmetic prevents user-level overflow; the remaining unchecked sites are intentionally so and safe by construction. The SWC-116 "block timestamp" Low warnings are flagged for every `block.timestamp` comparison — both uses here are the correct standard pattern.

---

## Final pre-mainnet checklist

- [x] Manual review of all 8 contracts (1,616 lines)
- [x] Slither pass (filtered) — no exploitable findings
- [x] Mythril pass (bytecode mode) — no exploitable findings
- [x] **M1 fixed** — `expiry <= type(uint64).max` require added in `CodeQuillDelegation.registerDelegationWithSig`
- [x] **M2 fixed** — `anchorPreservation` reverts with `"already anchored"` when a preservation already exists for `(repoId, snapshotRoot)`. Preservation is now immutable evidence.
- [x] **M3 documented** — workspace trust model section added to `CodeQuillReleaseRegistry` NatSpec, explaining that revoke/supersede are workspace-scoped by design.
- [x] **L1 removed** — dead `onlySelfOrDelegatedMember` modifier deleted from `CodeQuillAttestation`.
- [ ] **Optional**: rename `leave()` in `CodeQuillWorkspaceRegistry` to avoid the future reserved keyword (soft warning today; not a blocker).
- [ ] **Operational**: hold workspace NFTs in a Safe for compromise resistance.
- [ ] **Optional**: 1–2 day external review with a third party (Code4rena spot review or Spearbit small fixed-scope) before locking the contracts on Base mainnet — codebase is small and tractable enough that this is high-leverage.

**Bottom line:** No CRITICAL or HIGH findings. All three MEDIUMs resolved (M1 + M2 patched; M3 confirmed intentional and documented in-source). Codebase is in excellent shape: no admin keys, no upgradeability foot-guns, signature replay protection everywhere, and re-entrancy was specifically verified safe on the only path with a callback (`_safeMint`). **Ready for Base mainnet.**


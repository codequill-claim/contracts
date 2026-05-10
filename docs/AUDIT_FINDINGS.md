# CodeQuill Contracts — Self-Audit Findings

**Audit date:** May 2026 (post-V2 NFT refactor)
**Auditor:** Claude (self-audit, no independent expert review)
**Scope:** All 8 contracts in `contracts/` at the V2 baseline (commit `20393f0`).
**Outcome:** 1 high-severity bug fixed, 1 medium-severity feature gap fixed, 1 low-severity defensive check added, several documented limitations.

---

## What this audit IS NOT

Read this before relying on this document.

This is **one engineer doing one focused pass** with deep prior knowledge of the codebase. It catches design-level issues and obvious bugs that are visible to careful re-reading. It does **not** replace independent expert review and specifically misses:

- **Adversarial multi-week probing.** A real auditor pounds the contracts for days, deliberately constructing exotic call sequences to find unintended state interactions.
- **Economic exploit chains.** Multi-step exploits that combine on-chain primitives in ways individual contract authors didn't anticipate.
- **Novel attack patterns.** Whatever's been published in the last few weeks of security research that hasn't reached me yet.
- **MEV / sandwich opportunities.** CodeQuill doesn't have DeFi surfaces, but a real audit would still check.
- **Compiler-level issues.** Solidity compiler bugs that affect specific patterns we use.

**Recommended:** before any contract holds material value (e.g., when the Stamping flow goes live with revenue, or when workspaces start representing significant economic interests), commission a Sherlock contest or a solo researcher engagement. The codebase is small and well-scoped, so a paid audit would land cleanly.

---

## Severity rating system

| Severity | Definition |
|---|---|
| **Critical** | Direct loss of authority, funds, or data integrity. Exploitable by anyone or by a low-privilege actor. |
| **High** | Privilege escalation within the workspace boundary, or a clear bug that breaks an intended invariant. |
| **Medium** | Functional gap with a real-world workaround, or a surface that's defended off-chain but should be fixed in code too. |
| **Low** | Defense-in-depth improvement. Not exploitable on its own; reduces blast radius if other things go wrong. |
| **Informational** | Design observation, not a bug. Documented for awareness. |

---

## Findings

### F-01 — `Release.setDaoExecutor` privilege escalation
- **Severity:** High
- **Status:** ✅ Fixed in commit `c914793` — `fix: restrict setDaoExecutor to workspace authority only`

**Description.** Before the fix, `setDaoExecutor` was gated by `workspace.isMember(contextId, author)` — i.e., any current workspace member could configure the workspace's DAO executor address.

**Impact.** A rogue workspace member could call `setDaoExecutor(contextId, themselves, attackerAddress)` to install themselves (or any controlled address) as the DAO executor for the entire workspace. The DAO executor can `accept` or `reject` ANY release in the workspace, completely bypassing the per-release `governanceAuthority`. This is full hijacking of governance for every current and future release.

**Fix.** `setDaoExecutor` now requires `workspace.authorityOf(contextId) == author`. Only the workspace NFT holder may configure the DAO executor. The `ICodeQuillWorkspaceRegistry` interface in the release contract was extended to expose `authorityOf`. Three new tests verify the new behavior, including explicit rejection when a non-authority member tries to call.

---

### F-02 — `Delegation.registerDelegationWithSig` and `revokeWithSig` incompatible with EIP-1271
- **Severity:** Medium
- **Status:** ✅ Fixed in commits `0913eab` and `6c31d2e`
  - `fix: signaturechecker for delegation register and revoke` (contracts)
  - `fix: pass delegation signatures as opaque bytes for eip-1271` (app)

**Description.** Before the fix, both signature-verifying delegation functions used raw `ECDSA.recover`, which only works for EOA (65-byte) signatures. Smart-contract wallets that sign via EIP-1271 (Safes, in particular) could not register or revoke delegations gaslessly — they had to call `revoke()` directly via Safe Tx Builder, paying their own gas, and had no equivalent path to `register()`.

**Impact.** Workspaces with a Safe-as-authority — the recommended production configuration — could not gaslessly delegate to the CodeQuill relayer. Workaround was for the Safe to call `revoke()` directly (Safe pays gas) or for an EOA member to handle delegations.

**Fix.** Replaced `ECDSA.recover` with `SignatureChecker.isValidSignatureNow` in both functions, mirroring the pattern already used in `WorkspaceRegistry.setMemberWithSig`. The function signatures changed from `(uint8 v, bytes32 r, bytes32 s)` to a single `bytes calldata signature` parameter — consistent with the V2 registry. The app-side wrappers (`DelegationContract.php`) and the WalletController submit-handlers were updated to pass opaque signatures instead of splitting them. Two new tests prove EIP-1271 contract-wallet owners can register and revoke delegations.

**Coordination note:** this is a breaking ABI change. The downstream contracts (Repository, Snapshot, Release, Preservation, Attestation) read Delegation address in their constructors but don't call the changed functions. The app-side updates land alongside the contract change in the same logical patch.

---

### F-03 — `Release.supersedeRelease` doesn't validate same repo / context
- **Severity:** Low (defensive)
- **Status:** ✅ Fixed in commit `ab97be6` — `fix: supersedeRelease rejects mismatched repo or context`

**Description.** Before the fix, `supersedeRelease(oldId, newId, author)` only validated that both releases existed and the old release was revoked. It did not check that `newR.repoId == oldR.repoId` or `newR.contextId == oldR.contextId`. A malicious or buggy caller could supersede a release for repo A with an unrelated release for repo B in another workspace.

**Impact.** Pure data-integrity issue — no security impact, but the on-chain audit trail could become nonsensical. A consumer parsing supersession history might see "release X for repo A was superseded by release Y for repo B" and not know how to interpret it.

**Fix.** Two new requires:
```solidity
require(newR.repoId == oldR.repoId, "repo mismatch");
require(newR.contextId == oldR.contextId, "context mismatch");
```
Plus a test that anchors two releases for two different repos in the same workspace and verifies the supersession reverts with `repo mismatch`.

---

### F-04 — `WorkspaceNFT.mint` front-running on caller-supplied contextId
- **Severity:** Medium (mitigated off-chain)
- **Status:** 📝 Documented in `SECURITY.md` § "Front-running and mempool risk"

**Description.** Mint is permissionless and first-write-wins on `contextId`. The relayer's mint transaction is in the public mempool with the contextId visible. An attacker who learned a workspace's contextId before broadcast could submit a competing mint with higher gas.

**Impact.** A successfully front-run mint locks the legitimate workspace out of its intended contextId. The attacker holds an NFT for a context that the rest of the platform doesn't recognize (because the off-chain workspace UUID isn't theirs). The legitimate user can regenerate a fresh UUID and re-mint, but UX is disrupted.

**Status.** Mitigated by the workspace UUID being a 256-bit server-generated value never exposed publicly before the mint is broadcast. The app must continue to ensure UUIDs don't leak in URLs, logs, or API responses pre-broadcast.

**Why not patched:** any contract-level mitigation (commit-reveal, permissioned-mint, etc.) would either break the "no admin keys" promise or add significant complexity. Off-chain mitigation is sufficient because the squat doesn't gain the attacker anything visible to the platform.

---

### F-05 — `Repository.claimRepo` front-running on caller-supplied repoId
- **Severity:** Medium (mitigated off-chain)
- **Status:** 📝 Documented in `SECURITY.md` § "Front-running and mempool risk"

**Description.** Caller-supplied `repoId`. If the backend uses a predictable derivation, an attacker (who is a member of any workspace) could front-run a legitimate claim by another workspace.

**Impact.** Squatting a repo claim in a workspace the squatter isn't supposed to control. On-chain, the squat is permanent until the squatter calls `transferRepo`.

**Status.** Mitigated by the app validating GitHub repo ownership before relaying claims. An external attacker without GitHub access can't get the relayer to broadcast their squat. They'd have to call directly with their own gas, which is feasible but limits the attack to people willing to spend money to grief.

**Why not patched:** would require either a per-workspace repoId namespace (breaking the global single-claim invariant) or a commit-reveal flow (significant UX cost). The off-chain mitigation is acceptable for the intended use case.

---

### F-06 — `Release.anchorRelease` front-running on caller-supplied releaseId
- **Severity:** Low (mitigated by entropy)
- **Status:** 📝 Documented in `SECURITY.md` § "Front-running and mempool risk"

**Description.** `releaseId` is caller-supplied with first-write-wins semantics.

**Impact.** A workspace member could pre-empt another member's release by guessing a predictable releaseId.

**Status.** Mitigated by the app generating releaseIds with sufficient entropy (random salt + workspace + repo + timestamp). A purely external attacker (non-member) cannot anchor a release at all because of the membership check.

---

### F-07 — `Preservation.anchorPreservation` overwrite semantics
- **Severity:** Medium (within-workspace trust assumption)
- **Status:** 📝 Documented in `SECURITY.md` § "DoS / griefing surfaces" — known design choice

**Description.** A new `anchorPreservation` for the same `(repoId, snapshotMerkleRoot)` pair overwrites the previous record without any check against the previous author or hashes.

**Impact.** A workspace member can replace another member's legitimate preservation record with a bogus one (different `archiveSha256`, different CID). The old record is lost from the registry's perspective; the off-chain archive may still be retrievable from IPFS if pinned.

**Status.** Intentional design choice — supports re-encryption and re-key workflows. Within the trust model where workspace members are partially trusted (the workspace authority vetted them), this is acceptable. Workspace authorities should be aware that any member can overwrite preservations.

**Why not patched:** patching would require either making preservations append-only (every revision = new on-chain record, costs more gas) or restricting overwrite to the original author (breaks workspace-membership-scoped permissions philosophy). Neither is clearly better.

---

### F-08 — NFT-transfer-back replay window for pending `setMemberWithSig` signatures
- **Severity:** Low
- **Status:** 📝 Documented in `SECURITY.md` § "Nonces"

**Description.** If a workspace authority signs a `setMemberWithSig` message but doesn't broadcast it, then transfers the NFT to another wallet and back to themselves before the signature deadline expires, the original signature is still valid because `nonces[authority]` was never incremented (only successful broadcasts consume nonces).

**Impact.** An old "intent" — e.g., adding member X — could be replayed unexpectedly if the authority transferred away and back within the signature deadline window. Bounded by the deadline (typically 15 minutes in app flows).

**Why not patched:** would require either coupling the NFT contract to the registry (and resetting nonces on transfer — adds gas and complexity to every transfer) or reducing signature deadline windows further. Acceptable risk given the narrow time window and that authority-rotation is a rare event.

---

### F-09 — `Repository.transferRepo` doesn't require recipient consent
- **Severity:** Low
- **Status:** 📝 Documented in `SECURITY.md` § "DoS / griefing surfaces"

**Description.** The current `repoOwner` (or their `SCOPE_CLAIM` delegate) can call `transferRepo(repoId, anyMember, anyContext)` without the recipient signing or otherwise consenting.

**Impact.** Recipient can have a repo "dumped" on them. They become the new `repoOwner` (with `transferRepo` rights) and their `reposByOwner` array grows. No material harm because gas is paid by the relayer / sender.

**Why not patched:** consent would require an additional signature surface, adding UX cost. The current behavior is acceptable because the recipient gains a privilege (becomes able to transfer the repo back) rather than a liability.

---

### F-10 — `setMemberWithSig(authority, true)` skips signature verification
- **Severity:** Informational
- **Status:** 📝 Documented in `SECURITY.md` § "`setMember(authority, true)` early-return semantics"

**Description.** When called with `member == authorityOf(contextId)` and `memberStatus = true`, the function returns immediately without consuming a nonce or verifying the signature. The authority is implicitly always a member, so this is a no-op.

**Impact.** A caller can pass a garbage signature in this specific case and the call succeeds. No state changes, no events emitted. Not exploitable — there's nothing to gain.

**Why not patched:** the no-op is intended (it lets clients call `setMember` symmetrically without special-casing the authority), and validating the signature for a no-op would just add gas cost. The behavior is documented.

---

### F-11 — `_safeMint` requires recipient implements `IERC721Receiver`
- **Severity:** Informational
- **Status:** 📝 Documented in `CodeQuillWorkspaceNFT.md`

**Description.** `WorkspaceNFT.mint` uses `_safeMint`, which calls `onERC721Received` on contract recipients. Bare contracts without this hook will cause mint to revert.

**Impact.** Modern Safes have this via the standard fallback handler (`CompatibilityFallbackHandler`). Stripped-down or custom contract wallets without this hook would fail to receive the workspace NFT.

**Why not patched:** `_safeMint` is the safer default for end-user-controlled wallets. Switching to `_mint` would silently allow minting to contracts that can't actually use the NFT, which is a worse failure mode.

---

### F-12 — `try/catch` on `nft.ownerOf` in WorkspaceRegistry swallows all reverts
- **Severity:** Informational
- **Status:** Accepted

**Description.** `WorkspaceRegistry.authorityOf` does `try nft.ownerOf(...) returns (address) { ... } catch { return address(0); }`. The catch swallows every revert, including out-of-gas, panic, or any future error mode.

**Impact.** Since `nft` is `immutable` and points to our own audited NFT contract (which has no upgradeability), the only revert path is `ERC721NonexistentToken`. The catch behaves correctly (returns 0 for unminted tokens). No real attack surface.

**Why not patched:** a more selective catch (e.g. catching only `ERC721NonexistentToken`) would be more precise but adds verbosity for no practical benefit given the immutable dependency.

---

### F-13 — Storage growth in `reposByOwner` and `snapshotsOf`
- **Severity:** Informational
- **Status:** Documented

**Description.** `Repository.reposByOwner[address]` and `Snapshot.snapshotsOf[repoId]` are unbounded arrays that never shrink.

**Impact.** Long-lived workspaces or popular repos will accumulate entries. View functions returning the full array (`getReposByOwner`, `getSnapshotsCount` with iteration) become more expensive over time. Not a security issue per se; a UI / pagination concern.

**Why not patched:** removing entries would invalidate indexes and break the `snapshotIndexByRoot` invariant. The current design is correct for an immutable audit log; consumers need to handle pagination.

---

## What a real auditor would still likely find

Items I think a paid audit might surface that this self-audit didn't catch:

1. **Gas-DoS via deep call stacks.** I didn't trace every `try/catch` and external-call chain to verify gas-stipend behavior at depth. Probably fine, but worth a closer look.
2. **Compiler-quirk edge cases.** Solidity 0.8.28 with `viaIR` — there are known quirks with specific patterns (memory-to-storage struct copies, complex loops) that an auditor with Solidity expertise would test for.
3. **Multi-block sequencing attacks.** I considered single-block races but not exotic multi-block sequences that mix snapshot/release/attestation in unintended orders.
4. **Front-running of workspace-internal operations.** I documented the obvious mempool exposure of `mint` and `claimRepo`, but a thorough audit would also model attacker-vs-authority races on `setMemberWithSig` (e.g., authority signs add+remove with nonces N and N+1; relayer broadcasts in unexpected order) and decide whether the resulting end-states are always intended.
5. **EIP-1271 quirks.** `SignatureChecker` is well-tested but EIP-1271 implementations vary (especially older Safes vs. newer SafeProxy versions). A real audit would test against several real Safe deployments, not just our `MockEIP1271Signer`.
6. **Initialization race conditions.** All our contracts are constructor-initialized with non-zero checks. A real audit would still confirm that no observable state can exist before all dependencies are wired.
7. **ERC-721 corner cases.** Approvals are disabled; `_safeMint` callbacks; transfer to the contract itself; transfer to the zero address (does it revert? does it bypass our NFT auth check?). I checked the obvious cases but a real audit would systematically cover all standard ERC-721 invariants.

If this list scares you, that's appropriate — it's why a paid audit is worth doing before mainnet.

---

## Test coverage after audit

`npx hardhat test` — **107 passing** (was 103 pre-audit; +4 new tests for fixes F-01, F-03, and F-02's EIP-1271 path).

No regression. All previously-passing tests continue to pass.

---

## Recommended next steps before mainnet

1. **Sepolia end-to-end validation** of the V2 + audited build.
2. **Run a Sherlock / solo researcher engagement** before any production traffic with material value.
3. **Set up monitoring** for the workspace NFT contract — `Transfer` events to unexpected addresses, mints from unknown senders, etc.
4. **Document a runbook** for the workspace authority compromise scenarios in operations docs (separate from the contract docs): how to rotate authority via Safe, how to revoke delegations under panic, how to audit recent on-chain activity.

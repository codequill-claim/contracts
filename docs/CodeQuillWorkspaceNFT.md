# CodeQuillWorkspaceNFT

`CodeQuillWorkspaceNFT` is the ERC-721 collection where each token represents authority over a single CodeQuill workspace. The token holder IS the workspace authority — transferring the token transfers authority, with no separate signature-based rotation function.

This single design choice gives CodeQuill workspace ownership three properties for free:

1. **Compromise resistance via Safes.** Hold the NFT in a 2-of-3 (or M-of-N) Gnosis Safe. Losing one signing key does not lose the workspace, and one compromised key cannot move the token. CodeQuill's WorkspaceRegistry uses `SignatureChecker` so the Safe can sign membership operations natively via EIP-1271.
2. **Standard recovery.** Authority rotation is just `safeTransferFrom`. Safes inherit Safe's existing recovery modules (Zodiac, social-recovery cosigners, etc.) without any custom contract logic. CodeQuill itself has no admin keys, no guardian, and no timelock — those concerns live entirely in whatever wallet holds the token.
3. **Standard tooling.** The NFT shows up in Etherscan, Rabby, Zerion, OpenSea, Safe's UI — anywhere ERC-721s are recognized — with workspace-aware metadata served from the CodeQuill backend.

Regular EOA wallets continue to work without changes; the NFT lives in the user's wallet exactly like any other ERC-721.

---

## Data Structures

### 1. Token ID = Context ID

`tokenId = uint256(contextId)` — a deterministic 1:1 mapping between the off-chain workspace's `bytes32 contextId` and the on-chain ERC-721 `tokenId`. There is no separate index. The helpers `tokenIdOf(contextId)` and `contextIdOf(tokenId)` are pure conversions.

### 2. Base URI (immutable)

`string private _immutableBaseURI` — the metadata host, fixed at construction. Token URIs are built as `{baseURI}{0x-padded-32-byte-hex-tokenId}.json`. The corresponding metadata endpoint lives on the CodeQuill backend and serves OpenSea-format JSON describing the workspace.

The base URI is immutable on purpose: keeping it unchangeable removes any admin surface, even a "fix the URI" one. If the metadata host ever needs to move, deploy a new NFT contract.

---

## Key Operations

### Mint

```solidity
function mint(bytes32 contextId, address to) external
```

- **Permissionless first-mint-wins.** Anyone can call `mint` with any contextId. The first call for a given contextId wins; subsequent calls revert with `WorkspaceAlreadyMinted`. The CodeQuill backend only relays mints for contextIds it generated, so squatting an unindexed contextId has no protocol-level effect.
- Emits `Transfer(zero, to, tokenId)` (the standard ERC-721 event), `WorkspaceMinted(contextId, to)` (for the indexer), and `WorkspaceAuthorityTransferred(contextId, zero, to)` (the contextId-indexed authority history event).
- Reverts on `bytes32(0)` contextId (`InvalidContextId`) and `address(0)` recipient (`InvalidRecipient`).
- Uses `_safeMint`, so contract recipients (Safes, etc.) must implement `IERC721Receiver.onERC721Received` — Safe's standard fallback handler does this out of the box.

### Transfer (= authority rotation)

Standard ERC-721 transfer functions (`safeTransferFrom`, `transferFrom`, with or without `bytes data`) are inherited from OpenZeppelin's ERC-721. There is no CodeQuill-specific transfer function and no transfer-block: the workspace can be transferred to any address, including Safes, multisigs, time-locked vaults, or other contract wallets.

The contract overrides `_update` (the OZ 5 ERC-721 transfer hook) to emit the contextId-indexed `WorkspaceAuthorityTransferred(contextId, from, to)` event in addition to the standard `Transfer`. This lets off-chain indexers subscribe to a single workspace's authority history with a single filter.

### Approvals are disabled (soulbound-via-approvals)

`approve(address, uint256)` and `setApprovalForAll(address, bool)` both **revert with `ApprovalsDisabled`**. Workspace ownership is too consequential to be accidentally transferable via a marketplace approval or a malicious dapp's "approve all" prompt. The current holder must call a transfer function themselves; they cannot delegate that power.

This does NOT make the NFT non-transferable:

- **EOA holder**: calls `safeTransferFrom(self, newOwner, tokenId)` directly. Works because `msg.sender == ownerOf(tokenId)` and no approval is consulted.
- **Safe holder**: the Safe submits the transfer via its own internal execution (after M-of-N approval). Works for the same reason — the Safe's address is `ownerOf(tokenId)` and `msg.sender`.

What it DOES block: marketplace listings (OpenSea, Blur, etc.), approved-operator contracts, and any "Approve all assets" prompts that could trick a user into authorizing a third party to move the workspace. The trade-off is intentional — we want CodeQuill workspaces to be moved deliberately, not as collateral or via standing operator approvals.

### Token URI

```solidity
function tokenURI(uint256 tokenId) public view override returns (string memory)
```

Returns `{baseURI}{Strings.toHexString(tokenId, 32)}.json` for any minted token; reverts with `ERC721NonexistentToken` otherwise. The result is a fully-qualified URL like `https://api.codequill.xyz/v1/workspace-nft/0x111…111.json` and is consumed by the metadata endpoint on the CodeQuill API backend (note: API mode, not the web app — the controller lives in `Controllers/Api/External/` with `#[Root("/v1")]`).

---

## Events

| Event | Indexed | Emitted by | Purpose |
| :--- | :--- | :--- | :--- |
| `Transfer(from, to, tokenId)` | from, to, tokenId | OZ ERC-721 | Standard ERC-721 transfer log. Used by every NFT-aware tool. |
| `WorkspaceMinted(contextId, to)` | contextId, to | `mint` | Lets indexers detect new workspaces without parsing `Transfer(zero, …, …)`. |
| `WorkspaceAuthorityTransferred(contextId, from, to)` | contextId, from, to | `_update` | Workspace-centric authority history — single-filter subscription per workspace. |

## Errors

| Error | Thrown by | Meaning |
| :--- | :--- | :--- |
| `WorkspaceAlreadyMinted(bytes32 contextId)` | `mint` | A token for `contextId` already exists; first-mint-wins. |
| `InvalidContextId()` | `mint` | `contextId` was `bytes32(0)`. |
| `InvalidRecipient()` | `mint` | `to` was `address(0)`. |
| `ApprovalsDisabled()` | `approve`, `setApprovalForAll` | Approvals are disabled by design; holders transfer the NFT themselves. |

---

## Threat Model

- **No admin keys.** No mint role, no upgradeability, no pausability, no royalty manager. The contract has exactly the surface documented above.
- **No marketplace listing logic.** All approvals work like any standard ERC-721. If a workspace owner wants to make their workspace non-transferable, they should hold it in a Safe whose signing policy disallows transfer; the protocol does not enforce non-transferability at the contract level.
- **Compromise.** If the NFT lives in an EOA whose key is compromised, the attacker can transfer the workspace exactly like the legitimate owner can — it's an ERC-721. Hold the NFT in a Safe for production workspaces.
- **Loss.** If all keys for the holder wallet are lost and there is no Safe recovery module, the workspace is permanently locked. This is a deliberate property of the no-admin-keys design.

---

## Why an NFT (and not a custom storage layout)?

Two practical reasons:

1. **Tooling reuse.** Every wallet, explorer, indexer, and security tool already knows how to display, transfer, and analyze ERC-721s. Workspace ownership therefore inherits all of that work without any extra UI engineering.
2. **Composability.** Future features — workspace marketplaces, governance vaults that "own" multiple workspaces, time-locked transfers via wrapper contracts, fractional governance — are all trivially expressible as standard ERC-721 ownership patterns. None of them require changes to the core contracts.

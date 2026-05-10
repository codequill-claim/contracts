# CodeQuillWorkspaceRegistry (v2)

The `CodeQuillWorkspaceRegistry` is the membership layer of the CodeQuill ecosystem. It defines the boundaries of a **Workspace** (identified by a `contextId`) and is the single source of truth that every other registry consults to ask "is this address a member of this workspace?"

In v2, **workspace authority is sourced from `CodeQuillWorkspaceNFT`**. The token holder for `tokenId == uint256(contextId)` IS the authority. The registry no longer stores authority itself — it just reads through to the NFT.

## Core Concepts

### Workspace Authority is the NFT Holder

`authorityOf(contextId)` returns whatever `CodeQuillWorkspaceNFT.ownerOf(uint256(contextId))` returns, or `address(0)` if no token has been minted yet. This means:

- **Authority rotation = NFT transfer.** There is no `setAuthorityWithSig` function in v2. To rotate authority, the current holder calls `safeTransferFrom` on the NFT contract — standard ERC-721, signed by their wallet (or Safe).
- **Authority can be a Safe.** Anyone can hold an ERC-721, including a Gnosis Safe. The registry's signature verification routes through `SignatureChecker`, which falls through to `IERC1271.isValidSignature` for contract wallets, so Safes can sign membership operations. EOA wallets sign exactly as before — they don't need to know any of this.
- **The authority is always implicitly a member.** `isMember(contextId, addr)` returns `true` whenever `addr == authorityOf(contextId)`, even without an explicit member entry.

### Multi-tenant Identity

The registry is inherently multi-tenant. Multiple organizations coexist on the same contract, each managing their own `contextId` and list of members independently. Each NFT lives at a deterministic `tokenId == uint256(contextId)`.

### Signature-Based Membership Management (EIP-712, EOA + EIP-1271)

To provide a gasless or relayed experience, the registry uses EIP-712 signatures for membership changes. The Workspace Authority signs a `SetMember` intent off-chain, which is then submitted by a relayer (e.g. the CodeQuill backend). The signature blob is opaque `bytes` — `SignatureChecker` validates it whether it's a 65-byte ECDSA signature from an EOA or a Safe-style EIP-1271 blob.

---

## Data Structures

### 1. NFT Reference (immutable)
`ICodeQuillWorkspaceNFT public immutable nft`
*   **Concept**: The address of the `CodeQuillWorkspaceNFT` contract, fixed at construction.
*   **Rule**: All authority lookups (`authorityOf`) and the implicit-member rule in `isMember` route through this reference.

### 2. Membership Mapping
`mapping(bytes32 => mapping(address => bool)) private _members`
*   **Concept**: A nested mapping that tracks whether a specific wallet address is an *explicit* member of a specific `contextId`. The authority is implicitly a member without needing an entry here.
*   **Rule**: Members are the addresses allowed to perform privileged actions in other registries (claiming repos, anchoring releases) within that workspace context.

### 3. Nonces
`mapping(address => uint256) public nonces`
*   **Concept**: Tracks the next expected nonce for a signing authority.
*   **Purpose**: Prevents replay attacks. Indexed by the *current* authority address — when the NFT is transferred, the new authority's own nonce takes over (independently from the old holder's).

---

## Key Operations

### Reads

*   **`authorityOf(contextId) -> address`**: Returns `nft.ownerOf(uint256(contextId))`, or `address(0)` if the NFT hasn't been minted.
*   **`isMember(contextId, wallet) -> bool`**: True iff `wallet` is the current NFT holder OR has an explicit `_members` entry for the context. Other registries (Snapshot, Release, Attestation, Preservation, Repository) all consult this to enforce membership.

### Writes

*   **`setMemberWithSig(contextId, member, isMember, deadline, bytes signature)`**: Adds or removes an explicit member. The signature must come from the current authority (NFT holder) and is verified via `SignatureChecker.isValidSignatureNow` — accepts both EOA and EIP-1271 signatures. Cannot be used to demote the authority (reverts with `cannot remove authority`); setting the authority as a member is a no-op (does not consume a nonce).
*   **`leave(contextId)`**: A utility function that allows any explicit member to remove themselves from a workspace without needing the authority's signature. The authority cannot leave — they must transfer the NFT first.

### Removed in v2

The following functions from v1 are **no longer present**, because authority is now an NFT:

- `initAuthority(contextId, authority)` — replaced by `CodeQuillWorkspaceNFT.mint(contextId, to)`.
- `setAuthorityWithSig(contextId, newAuthority, ...)` — replaced by `CodeQuillWorkspaceNFT.safeTransferFrom(from, to, tokenId)`.

The EIP-712 domain version is bumped from `"1"` to `"2"` to make the break unambiguous: signatures from v1 cannot be replayed against v2.

---

## EOA vs. Safe — what changes for users?

Nothing, for ordinary EOAs. The MetaMask user signs the standard `SetMember` typed data with their key, just like before; the only on-the-wire difference is that the registry now takes the signature as a single `bytes` argument instead of `(v, r, s)`. Frontends pass the 65-byte signature through verbatim.

For Safes, the difference is significant: a Safe-held authority cannot sign with a single ECDSA key (it needs M-of-N internal approvals). The registry handles this transparently through `SignatureChecker`, which calls back into the Safe's `isValidSignature` to validate the resulting signature blob.

See [CodeQuillWorkspaceNFT](./CodeQuillWorkspaceNFT.md) for the token-side mechanics.

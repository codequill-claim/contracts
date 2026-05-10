// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title CodeQuillWorkspaceNFT
/// @notice One ERC-721 token per CodeQuill workspace. The token-holder IS the
///         workspace authority — transferring the token transfers authority.
///         Designed to be held in a Safe (or any EIP-1271 wallet) for compromise
///         resistance and recovery via Safe's existing recovery modules.
///
/// Token IDs are `uint256(contextId)` — a 1:1 mapping with the off-chain
/// workspace context. Minting is permissionless and first-mint-wins on each
/// contextId, mirroring the pre-NFT `initAuthority` semantics. The backend
/// only ever relays mints for contextIds it generated, so squatting an
/// unindexed contextId has no protocol-level effect.
///
/// No admin keys, no pause, no royalties, no admin-controlled URI.
contract CodeQuillWorkspaceNFT is ERC721 {
    using Strings for uint256;

    /// @notice Base URI all token URIs are built from. Set at construction and
    ///         immutable thereafter. Token URIs are
    ///         `{baseURI}{0x-padded-32-byte-hex-tokenId}.json`.
    string private _immutableBaseURI;

    /// @notice Emitted when a workspace token is minted. Indexers can watch
    ///         this in addition to the standard ERC-721 `Transfer` event.
    event WorkspaceMinted(bytes32 indexed contextId, address indexed to);

    /// @notice Emitted on every transfer (including mint and burn) with the
    ///         contextId surfaced as an indexed topic so the off-chain indexer
    ///         can filter by workspace cheaply.
    event WorkspaceAuthorityTransferred(
        bytes32 indexed contextId,
        address indexed from,
        address indexed to
    );

    error WorkspaceAlreadyMinted(bytes32 contextId);
    error InvalidContextId();
    error InvalidRecipient();
    error ApprovalsDisabled();

    constructor(string memory baseURI_)
        ERC721("CodeQuill Workspace", "CQWS")
    {
        _immutableBaseURI = baseURI_;
    }

    /// @notice Mint the workspace token for `contextId` to `to`. Reverts if a
    ///         token for `contextId` already exists. Anyone may call.
    function mint(bytes32 contextId, address to) external {
        if (contextId == bytes32(0)) revert InvalidContextId();
        if (to == address(0)) revert InvalidRecipient();

        uint256 tokenId = uint256(contextId);
        if (_ownerOf(tokenId) != address(0)) {
            revert WorkspaceAlreadyMinted(contextId);
        }

        _safeMint(to, tokenId);
        emit WorkspaceMinted(contextId, to);
    }

    /// @notice True iff a workspace token has been minted for `contextId`.
    function exists(bytes32 contextId) external view returns (bool) {
        return _ownerOf(uint256(contextId)) != address(0);
    }

    /// @notice Returns the contextId encoded in `tokenId`. Helper for off-chain
    ///         consumers.
    function contextIdOf(uint256 tokenId) external pure returns (bytes32) {
        return bytes32(tokenId);
    }

    /// @notice Returns the tokenId encoding for `contextId`. Helper for
    ///         off-chain consumers.
    function tokenIdOf(bytes32 contextId) external pure returns (uint256) {
        return uint256(contextId);
    }

    /// @inheritdoc ERC721
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(
            _immutableBaseURI,
            Strings.toHexString(tokenId, 32),
            ".json"
        );
    }

    function _baseURI() internal view override returns (string memory) {
        return _immutableBaseURI;
    }

    /// @inheritdoc ERC721
    /// @dev Approvals are disabled by design. Workspace ownership is too
    ///      consequential to be accidentally transferable via a marketplace
    ///      approval or a malicious dapp's `setApprovalForAll` prompt. The
    ///      current holder can still transfer the workspace directly with
    ///      `safeTransferFrom` or `transferFrom` — both EOAs and Safes work
    ///      because in those calls `msg.sender == ownerOf(tokenId)` and no
    ///      approval is consulted.
    function approve(address, uint256) public pure override {
        revert ApprovalsDisabled();
    }

    /// @inheritdoc ERC721
    /// @dev See `approve` — approvals are disabled by design. Holders move
    ///      the workspace themselves; they do not delegate that power.
    function setApprovalForAll(address, bool) public pure override {
        revert ApprovalsDisabled();
    }

    /// @inheritdoc ERC721
    /// @dev Emits the contextId-indexed `WorkspaceAuthorityTransferred` event
    ///      alongside the standard `Transfer` event, so off-chain consumers
    ///      can subscribe to a single workspace's authority history.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = super._update(to, tokenId, auth);
        emit WorkspaceAuthorityTransferred(bytes32(tokenId), from, to);
        return from;
    }
}

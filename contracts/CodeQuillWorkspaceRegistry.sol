// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

interface ICodeQuillWorkspaceNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title CodeQuillWorkspaceRegistry (V2)
/// @notice Workspace authority is sourced from the CodeQuillWorkspaceNFT
///         contract — the holder of the workspace's token IS the authority.
///         Authority changes by transferring the NFT (standard ERC-721
///         `safeTransferFrom`), so this contract no longer exposes any
///         signature-based authority rotation.
///
/// `setMemberWithSig` accepts arbitrary `bytes` signatures so Safes (and any
/// other EIP-1271 contract wallet) can act as authority — verified via
/// OpenZeppelin's `SignatureChecker` which falls back to `IERC1271` when the
/// authority is a contract.
contract CodeQuillWorkspaceRegistry is EIP712 {
    /// @notice The NFT contract that backs workspace authority.
    ICodeQuillWorkspaceNFT public immutable nft;

    // contextId -> wallet -> isMember (excluding the implicit "authority is a
    // member" rule, which is evaluated dynamically against the NFT).
    mapping(bytes32 => mapping(address => bool)) private _members;

    // Nonce per authority (prevents signature replay).
    mapping(address => uint256) public nonces;

    // EIP-712 typehash
    // SetMember(contextId,member,isMember,nonce,deadline)
    bytes32 private constant SET_MEMBER_TYPEHASH =
        keccak256("SetMember(bytes32 contextId,address member,bool isMember,uint256 nonce,uint256 deadline)");

    event MemberSet(bytes32 indexed contextId, address indexed member, bool isMember);

    constructor(address nftAddr)
        EIP712("CodeQuillWorkspaceRegistry", "2")
    {
        require(nftAddr != address(0), "zero nft");
        nft = ICodeQuillWorkspaceNFT(nftAddr);
    }

    // --------------------
    // Authority (NFT-backed)
    // --------------------

    /// @notice Returns the current workspace authority — i.e. the holder of
    ///         the workspace's NFT — or `address(0)` if no NFT has been
    ///         minted for `contextId`.
    function authorityOf(bytes32 contextId) public view returns (address) {
        if (contextId == bytes32(0)) return address(0);
        try nft.ownerOf(uint256(contextId)) returns (address owner_) {
            return owner_;
        } catch {
            return address(0);
        }
    }

    /// @notice True iff `wallet` is a member of the workspace identified by
    ///         `contextId`. The authority (NFT holder) is implicitly always a
    ///         member; explicit members are tracked in storage.
    function isMember(bytes32 contextId, address wallet) external view returns (bool) {
        if (contextId == bytes32(0) || wallet == address(0)) {
            return false;
        }
        if (authorityOf(contextId) == wallet) {
            return true;
        }
        return _members[contextId][wallet];
    }

    // --------------------
    // Membership management
    // --------------------

    /// @notice Add or remove a member for `contextId`, authorized by an EIP-712
    ///         signature from the workspace authority. Backend can pay gas.
    ///         The signature blob is opaque to allow EIP-1271 (Safe) signing.
    function setMemberWithSig(
        bytes32 contextId,
        address member,
        bool memberStatus,
        uint256 deadline,
        bytes calldata signature
    ) external {
        require(contextId != bytes32(0), "zero context");
        require(member != address(0), "zero member");
        require(block.timestamp <= deadline, "sig expired");

        address authority = authorityOf(contextId);
        require(authority != address(0), "authority not set");

        // Authority is implicitly a member and cannot be demoted via this path.
        if (member == authority) {
            require(memberStatus, "cannot remove authority");
            // No-op for setting the authority as a member; they already are.
            return;
        }

        uint256 nonce = nonces[authority];
        bytes32 structHash = keccak256(
            abi.encode(
                SET_MEMBER_TYPEHASH,
                contextId,
                member,
                memberStatus,
                nonce,
                deadline
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        require(
            SignatureChecker.isValidSignatureNow(authority, digest, signature),
            "bad signer"
        );

        nonces[authority] = nonce + 1;

        _members[contextId][member] = memberStatus;
        emit MemberSet(contextId, member, memberStatus);
    }

    /// @notice Self-leave: a member can remove themselves without a signature.
    ///         The authority (NFT holder) cannot leave — they must transfer
    ///         the NFT to a new owner first.
    function leave(bytes32 contextId) external {
        require(contextId != bytes32(0), "zero context");
        require(msg.sender != authorityOf(contextId), "authority cannot leave");

        _members[contextId][msg.sender] = false;
        emit MemberSet(contextId, msg.sender, false);
    }
}

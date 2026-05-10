// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @notice Minimal EIP-1271 contract wallet used in tests. A single owner
///         signs digests with their EOA key; the contract validates the
///         signature against that owner. This mimics the externally-visible
///         signing surface of a Safe (1-of-1) for verifying the registry's
///         SignatureChecker code path against contract-wallet authorities.
///         Also implements IERC721Receiver so the workspace NFT can be
///         `safeTransferFrom`'d into it (matching Safe's behavior with the
///         standard fallback handler).
contract MockEIP1271Signer is IERC1271, IERC721Receiver {
    bytes4 private constant MAGIC_VALUE = 0x1626ba7e;

    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 digest, bytes memory signature)
        external
        view
        returns (bytes4)
    {
        (address recovered, , ) = ECDSA.tryRecover(digest, signature);
        if (recovered == owner && recovered != address(0)) {
            return MAGIC_VALUE;
        }
        return 0xffffffff;
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }
}

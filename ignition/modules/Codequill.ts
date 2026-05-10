import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * V2 deployment graph:
 *
 *   WorkspaceNFT (baseURI param)
 *      └─> WorkspaceRegistry (nftAddr)
 *               └─> Repository, Snapshot, Preservation, Release, Attestation, Delegation
 *
 * Configurable parameters (override at deploy time with `--parameters`):
 *
 *   workspaceNftBaseURI  immutable on-chain; metadata host serving
 *                        `<baseURI>{0x-padded-32-byte-tokenId}.json`.
 *                        Defaults to the production CodeQuill API host.
 */
export default buildModule("CodeQuill", (m) => {
    const workspaceNftBaseURI = m.getParameter(
        "workspaceNftBaseURI",
        "https://api.codequill.xyz/v1/workspace-nft/",
    );

    // 1. Workspace NFT (ownership token, one per workspace).
    const workspaceNft = m.contract("CodeQuillWorkspaceNFT", [workspaceNftBaseURI]);

    // 2. Workspace registry (membership + EIP-712 signatures), backed by the NFT.
    const workspace = m.contract("CodeQuillWorkspaceRegistry", [workspaceNft]);

    // 3. Delegation (relayer authorization, accepts EIP-1271 signatures).
    const delegation = m.contract("CodeQuillDelegation", []);

    // 4. Repository registry (claim ownership, transfer authority).
    const repository = m.contract("CodeQuillRepositoryRegistry", [delegation, workspace]);

    // 5. Snapshot, Preservation, Release, Attestation — workspace-membership-scoped.
    const snapshot = m.contract("CodeQuillSnapshotRegistry", [repository, workspace, delegation]);
    const preservation = m.contract("CodeQuillPreservationRegistry", [repository, workspace, delegation, snapshot]);
    const release = m.contract("CodeQuillReleaseRegistry", [repository, workspace, delegation, snapshot]);
    const attestation = m.contract("CodeQuillAttestationRegistry", [workspace, delegation, release]);

    return { workspaceNft, workspace, delegation, repository, snapshot, preservation, release, attestation };
});

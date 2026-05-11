import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * V2 deployment graph:
 *
 *   WorkspaceNFT (no constructor args — per-token URIs set at mint)
 *      └─> WorkspaceRegistry (nftAddr)
 *               └─> Repository, Snapshot, Preservation, Release, Attestation, Delegation
 *
 * Token URIs are now passed in per-mint by the relayer (the backend renders
 * the workspace artwork, uploads to Lighthouse, and supplies the resulting
 * `ipfs://<metadata_cid>` to `mint`). The NFT therefore takes no constructor
 * parameters and exposes no admin-controlled URI mutation.
 */
export default buildModule("CodeQuill", (m) => {
    // 1. Workspace NFT (ownership token, one per workspace).
    const workspaceNft = m.contract("CodeQuillWorkspaceNFT", []);

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

import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("CodeQuill", (m) => {
    const workspace = m.contract("CodeQuillWorkspaceRegistry", []);
    const delegation = m.contract("CodeQuillDelegation", []);
    const repository = m.contract("CodeQuillRepositoryRegistry", [delegation, workspace]);
    const snapshot = m.contract("CodeQuillSnapshotRegistry", [repository, workspace, delegation]);
    const preservation = m.contract("CodeQuillPreservationRegistry", [repository, workspace, delegation, snapshot]);
    const release = m.contract("CodeQuillReleaseRegistry", [repository, workspace, delegation, snapshot]);
    const attestation = m.contract("CodeQuillAttestationRegistry", [workspace, delegation, release]);

    return { workspace, delegation, repository, snapshot, preservation, release, attestation };
});
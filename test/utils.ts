import hre from "hardhat";

export function asBigInt(v: any): bigint {
  return typeof v === "bigint" ? v : BigInt(v);
}

const WORKSPACE_NFT_BASE_URI = "https://api.codequill.xyz/v1/workspace-nft/";

export async function setupCodeQuill() {
  const connection = await hre.network.connect();
  const ethers = (connection as any).ethers;
  const time = (connection as any).networkHelpers.time;

  const [deployer, alice, bob, charlie, daoExecutor] = await ethers.getSigners();

  // Workspace authority is now backed by an ERC-721 NFT. Deploy the NFT
  // first, then pass it into the WorkspaceRegistry constructor.
  const WorkspaceNFT = await ethers.getContractFactory("CodeQuillWorkspaceNFT");
  const workspaceNft = await WorkspaceNFT.deploy(WORKSPACE_NFT_BASE_URI);
  await workspaceNft.waitForDeployment();

  const Workspace = await ethers.getContractFactory("CodeQuillWorkspaceRegistry");
  const workspace = await Workspace.deploy(await workspaceNft.getAddress());
  await workspace.waitForDeployment();

  const Delegation = await ethers.getContractFactory("CodeQuillDelegation");
  const delegation = await Delegation.deploy();
  await delegation.waitForDeployment();

  const Repository = await ethers.getContractFactory("CodeQuillRepositoryRegistry");
  const repository = await Repository.deploy(
    await delegation.getAddress(),
    await workspace.getAddress(),
  );
  await repository.waitForDeployment();

  const Snapshot = await ethers.getContractFactory("CodeQuillSnapshotRegistry");
  const snapshot = await Snapshot.deploy(
    await repository.getAddress(),
    await workspace.getAddress(),
    await delegation.getAddress(),
  );
  await snapshot.waitForDeployment();

  const Preservation = await ethers.getContractFactory("CodeQuillPreservationRegistry");
  const preservation = await Preservation.deploy(
    await repository.getAddress(),
    await workspace.getAddress(),
    await delegation.getAddress(),
    await snapshot.getAddress(),
  );
  await preservation.waitForDeployment();

  const Release = await ethers.getContractFactory("CodeQuillReleaseRegistry");
  const release = await Release.deploy(
    await repository.getAddress(),
    await workspace.getAddress(),
    await delegation.getAddress(),
    await snapshot.getAddress(),
  );
  await release.waitForDeployment();

  const Attestation = await ethers.getContractFactory("CodeQuillAttestationRegistry");
  const attestation = await Attestation.deploy(
    await workspace.getAddress(),
    await delegation.getAddress(),
    await release.getAddress(),
  );
  await attestation.waitForDeployment();

  return {
    ethers,
    time,
    deployer,
    alice,
    bob,
    charlie,
    daoExecutor,
    workspaceNft,
    workspace,
    delegation,
    repository,
    snapshot,
    preservation,
    release,
    attestation,
  };
}

export async function getEip712Domain(
  ethers: any,
  name: string,
  version: string,
  verifyingContract: string,
) {
  return {
    name,
    version,
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract,
  };
}

export const delegationTypes = {
  Delegate: [
    { name: "owner", type: "address" },
    { name: "relayer", type: "address" },
    { name: "contextId", type: "bytes32" },
    { name: "scopes", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export const revokeDelegationTypes = {
  Revoke: [
    { name: "owner", type: "address" },
    { name: "relayer", type: "address" },
    { name: "contextId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export const workspaceSetMemberTypes = {
  SetMember: [
    { name: "contextId", type: "bytes32" },
    { name: "member", type: "address" },
    { name: "isMember", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export async function getWorkspaceEip712Domain(ethers: any, workspace: any) {
  return getEip712Domain(
    ethers,
    "CodeQuillWorkspaceRegistry",
    "2",
    await workspace.getAddress(),
  );
}

/**
 * Mint a workspace NFT to `to` and return the transaction. The pre-NFT
 * `initAuthority` flow has been replaced by this — the NFT holder IS the
 * authority. Anyone may relay the mint (we use the deployer in tests for
 * deterministic ordering).
 */
export async function mintWorkspace(params: {
  workspaceNft: any;
  relayerSigner: any;
  contextId: string;
  to: string;
}) {
  const { workspaceNft, relayerSigner, contextId, to } = params;
  return workspaceNft.connect(relayerSigner).mint(contextId, to);
}

export async function setWorkspaceMemberWithSig(params: {
  ethers: any;
  workspace: any;
  authoritySigner: any;
  relayerSigner: any;
  domain: any;
  contextId: string;
  member: string;
  memberStatus: boolean;
  deadline: bigint;
}) {
  const {
    workspace,
    authoritySigner,
    relayerSigner,
    domain,
    contextId,
    member,
    memberStatus,
    deadline,
  } = params;

  const nonce = await workspace.nonces(authoritySigner.address);
  const value = {
    contextId,
    member,
    isMember: memberStatus,
    nonce,
    deadline,
  };

  const signature = await authoritySigner.signTypedData(
    domain,
    workspaceSetMemberTypes,
    value,
  );

  return workspace
    .connect(relayerSigner)
    .setMemberWithSig(contextId, member, memberStatus, deadline, signature);
}

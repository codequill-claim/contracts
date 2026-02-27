import { expect } from "chai";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";
import {
  asBigInt,
  delegationTypes,
  getEip712Domain,
  getWorkspaceEip712Domain,
  setWorkspaceMemberWithSig,
  setupCodeQuill,
} from "./utils";

describe("CodeQuillPreservationRegistry", function () {
  let ethers: any;
  let time: any;
  let workspace: any;
  let repository: any;
  let delegation: any;
  let snapshotRegistry: any;
  let preservationRegistry: any;
  let deployer: any;
  let repoOwner: any;
  let relayer: any;
  let other: any;
  let domain: any;
  let workspaceDomain: any;

  const contextId = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const repoIdLabel = "preservation-repo";

  beforeEach(async function () {
    const env = await setupCodeQuill();
    ethers = env.ethers;
    time = env.time;
    deployer = env.deployer;
    workspace = env.workspace;
    repository = env.repository;
    delegation = env.delegation;
    snapshotRegistry = env.snapshot;
    preservationRegistry = env.preservation;
    repoOwner = env.alice;
    relayer = env.bob;
    other = env.charlie;

    domain = await getEip712Domain(
      ethers,
      "CodeQuillDelegation",
      "1",
      await delegation.getAddress(),
    );

    workspaceDomain = await getWorkspaceEip712Domain(ethers, workspace);
    await workspace.connect(deployer).initAuthority(contextId, deployer.address);

    const now = asBigInt(await time.latest());
    const membershipDeadline = now + 3600n;
    await setWorkspaceMemberWithSig({
      ethers,
      workspace,
      authoritySigner: deployer,
      relayerSigner: deployer,
      domain: workspaceDomain,
      contextId,
      member: repoOwner.address,
      memberStatus: true,
      deadline: membershipDeadline,
    });

    const repoId = ethers.encodeBytes32String(repoIdLabel);
    await repository
      .connect(repoOwner)
      .claimRepo(repoId, contextId, "meta", repoOwner.address);

    await snapshotRegistry
      .connect(repoOwner)
      .createSnapshot(
        repoId,
        contextId,
        ethers.id("commit"),
        ethers.id("root"),
        "cid",
        repoOwner.address
      );
  });

  describe("anchorPreservation", function () {
    it("allows repo owner to anchor a preservation directly", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      const merkleRoot = ethers.id("root");
      const archiveSha256 = ethers.id("archive1");
      const metadataSha256 = ethers.id("metadata1");
      const preservationCid = "QmPreservation123";

      await expect(
        preservationRegistry
          .connect(repoOwner)
          .anchorPreservation(
            repoId,
            contextId,
            merkleRoot,
            archiveSha256,
            metadataSha256,
            preservationCid,
            repoOwner.address,
          ),
      )
        .to.emit(preservationRegistry, "PreservationAnchored")
        .withArgs(
          repoId,
          merkleRoot,
          archiveSha256,
          contextId,
          repoOwner.address,
          metadataSha256,
          preservationCid,
          anyValue,
        );

      expect(await preservationRegistry.hasPreservation(repoId, merkleRoot)).to.equal(true);
    });

    it("allows delegated relayer to anchor a preservation", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      const merkleRoot = ethers.id("root");
      const archiveSha256 = ethers.id("archive-relayed");
      const metadataSha256 = ethers.ZeroHash;
      const preservationCid = "";

      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_PRESERVATION();
      const nonce = await delegation.nonces(repoOwner.address);
      const value = {
        owner: repoOwner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await repoOwner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);
      await delegation.registerDelegationWithSig(
        repoOwner.address,
        relayer.address,
        contextId,
        scopes,
        expiry,
        deadline,
        v,
        r,
        s,
      );

      await expect(
        preservationRegistry
          .connect(relayer)
          .anchorPreservation(
            repoId,
            contextId,
            merkleRoot,
            archiveSha256,
            metadataSha256,
            preservationCid,
            repoOwner.address,
          ),
      )
        .to.emit(preservationRegistry, "PreservationAnchored")
        .withArgs(
          repoId,
          merkleRoot,
          archiveSha256,
          contextId,
          repoOwner.address,
          metadataSha256,
          preservationCid,
          anyValue,
        );
    });

    it("reverts if snapshot does not exist", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      const fakeRoot = ethers.id("fake");
      await expect(
        preservationRegistry
          .connect(repoOwner)
          .anchorPreservation(
            repoId,
            contextId,
            fakeRoot,
            ethers.id("archive"),
            ethers.id("metadata"),
            "cid",
            repoOwner.address,
          ),
      ).to.be.revertedWith("snapshot not found");
    });

    it("allows overwriting preservation for the same repo and snapshot", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      const merkleRoot = ethers.id("root");

      await preservationRegistry
        .connect(repoOwner)
        .anchorPreservation(
          repoId,
          contextId,
          merkleRoot,
          ethers.id("archive-old"),
          ethers.id("metadata"),
          "cid-old",
          repoOwner.address,
        );

      const newArchiveSha = ethers.id("archive-new");
      const newCid = "QmNewPreservation456";
      await preservationRegistry
        .connect(repoOwner)
        .anchorPreservation(
          repoId,
          contextId,
          merkleRoot,
          newArchiveSha,
          ethers.id("metadata"),
          newCid,
          repoOwner.address,
        );

      const p = await preservationRegistry.getPreservation(repoId, merkleRoot);
      expect(p.archiveSha256).to.equal(newArchiveSha);
      expect(p.preservationCid).to.equal(newCid);
    });

    it("reverts if caller is not authorized", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      await expect(
        preservationRegistry
          .connect(other)
          .anchorPreservation(
            repoId,
            contextId,
            ethers.id("root"),
            ethers.id("archive"),
            ethers.ZeroHash,
            "",
            repoOwner.address,
          ),
      ).to.be.revertedWith("not authorized");
    });

    it("reverts when repo is not claimed", async function () {
      const unclaimedRepo = ethers.id("unclaimed");
      await expect(
        preservationRegistry
          .connect(repoOwner)
          .anchorPreservation(
            unclaimedRepo,
            contextId,
            ethers.id("root"),
            ethers.id("archive"),
            ethers.ZeroHash,
            "",
            repoOwner.address,
          ),
      ).to.be.revertedWith("repo not claimed");
    });
  });

  describe("views", function () {
    it("hasPreservation / getPreservation return expected values and revert when missing", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      const merkleRoot = ethers.id("root");
      const archiveSha256 = ethers.id("archive-view");
      const metadataSha256 = ethers.id("metadata-view");
      const preservationCid = "cid-view";

      await preservationRegistry
        .connect(repoOwner)
        .anchorPreservation(
          repoId,
          contextId,
          merkleRoot,
          archiveSha256,
          metadataSha256,
          preservationCid,
          repoOwner.address,
        );

      expect(await preservationRegistry.hasPreservation(repoId, merkleRoot)).to.equal(true);
      expect(await preservationRegistry.hasPreservation(repoId, ethers.id("other"))).to.equal(false);

      const p = await preservationRegistry.getPreservation(repoId, merkleRoot);
      expect(p.archiveSha256).to.equal(archiveSha256);
      expect(p.metadataSha256).to.equal(metadataSha256);
      expect(p.preservationCid).to.equal(preservationCid);
      expect(p.author).to.equal(repoOwner.address);
      expect(p.timestamp).to.be.gt(0);

      await expect(preservationRegistry.getPreservation(repoId, ethers.id("missing"))).to.be.revertedWith(
        "preservation not found",
      );
    });
  });
});

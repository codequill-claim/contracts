import { expect } from "chai";
import {
  asBigInt,
  getWorkspaceEip712Domain,
  setupCodeQuill,
  TEST_TOKEN_URI,
  setWorkspaceMemberWithSig,
  workspaceSetMemberTypes,
} from "./utils";

describe("CodeQuillWorkspaceRegistry (V2 / NFT-backed)", function () {
  let ethers: any;
  let time: any;
  let workspace: any;
  let workspaceNft: any;
  let deployer: any;
  let authority: any;
  let member: any;
  let relayer: any;
  let domain: any;

  const contextId = "0x1111111111111111111111111111111111111111111111111111111111111111";

  beforeEach(async function () {
    const env = await setupCodeQuill();
    ethers = env.ethers;
    time = env.time;
    deployer = env.deployer;
    authority = env.alice;
    member = env.bob;
    relayer = env.charlie;
    workspace = env.workspace;
    workspaceNft = env.workspaceNft;

    domain = await getWorkspaceEip712Domain(ethers, workspace);
  });

  describe("authorityOf", function () {
    it("returns address(0) when the workspace NFT has not been minted", async function () {
      expect(await workspace.authorityOf(contextId)).to.equal(ethers.ZeroAddress);
    });

    it("returns address(0) for the zero contextId", async function () {
      expect(await workspace.authorityOf(ethers.ZeroHash)).to.equal(ethers.ZeroAddress);
    });

    it("returns the NFT holder once minted", async function () {
      await workspaceNft.connect(deployer).mint(contextId, authority.address, TEST_TOKEN_URI);
      expect(await workspace.authorityOf(contextId)).to.equal(authority.address);
    });

    it("follows the NFT after a transfer", async function () {
      await workspaceNft.connect(deployer).mint(contextId, authority.address, TEST_TOKEN_URI);
      const tokenId = await workspaceNft.tokenIdOf(contextId);

      await workspaceNft
        .connect(authority)
        ["safeTransferFrom(address,address,uint256)"](
          authority.address,
          member.address,
          tokenId,
        );

      expect(await workspace.authorityOf(contextId)).to.equal(member.address);
    });
  });

  describe("isMember", function () {
    beforeEach(async function () {
      await workspaceNft.connect(deployer).mint(contextId, authority.address, TEST_TOKEN_URI);
    });

    it("returns false for zero context or zero address", async function () {
      expect(await workspace.isMember(ethers.ZeroHash, authority.address)).to.equal(false);
      expect(await workspace.isMember(contextId, ethers.ZeroAddress)).to.equal(false);
    });

    it("treats the NFT holder as a member implicitly", async function () {
      expect(await workspace.isMember(contextId, authority.address)).to.equal(true);
    });

    it("treats explicit members as members", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;

      await setWorkspaceMemberWithSig({
        ethers,
        workspace,
        authoritySigner: authority,
        relayerSigner: relayer,
        domain,
        contextId,
        member: member.address,
        memberStatus: true,
        deadline,
      });

      expect(await workspace.isMember(contextId, member.address)).to.equal(true);
    });

    it("returns false for non-members", async function () {
      expect(await workspace.isMember(contextId, member.address)).to.equal(false);
    });

    it("automatically promotes the new NFT holder to a member after transfer", async function () {
      const tokenId = await workspaceNft.tokenIdOf(contextId);

      await workspaceNft
        .connect(authority)
        ["safeTransferFrom(address,address,uint256)"](
          authority.address,
          member.address,
          tokenId,
        );

      expect(await workspace.isMember(contextId, member.address)).to.equal(true);
    });
  });

  describe("setMemberWithSig", function () {
    beforeEach(async function () {
      await workspaceNft.connect(deployer).mint(contextId, authority.address, TEST_TOKEN_URI);
    });

    it("adds and removes a member via authority signature", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;

      const nonceBeforeAdd = await workspace.nonces(authority.address);
      await expect(
        setWorkspaceMemberWithSig({
          ethers,
          workspace,
          authoritySigner: authority,
          relayerSigner: relayer,
          domain,
          contextId,
          member: member.address,
          memberStatus: true,
          deadline,
        }),
      )
        .to.emit(workspace, "MemberSet")
        .withArgs(contextId, member.address, true);

      expect(await workspace.isMember(contextId, member.address)).to.equal(true);
      expect(await workspace.nonces(authority.address)).to.equal(nonceBeforeAdd + 1n);

      const nonceBeforeRemove = await workspace.nonces(authority.address);
      await expect(
        setWorkspaceMemberWithSig({
          ethers,
          workspace,
          authoritySigner: authority,
          relayerSigner: relayer,
          domain,
          contextId,
          member: member.address,
          memberStatus: false,
          deadline,
        }),
      )
        .to.emit(workspace, "MemberSet")
        .withArgs(contextId, member.address, false);

      expect(await workspace.isMember(contextId, member.address)).to.equal(false);
      expect(await workspace.nonces(authority.address)).to.equal(nonceBeforeRemove + 1n);
    });

    it("reverts on zero context / zero member", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;

      await expect(
        setWorkspaceMemberWithSig({
          ethers,
          workspace,
          authoritySigner: authority,
          relayerSigner: relayer,
          domain,
          contextId: ethers.ZeroHash,
          member: member.address,
          memberStatus: true,
          deadline,
        }),
      ).to.be.revertedWith("zero context");

      await expect(
        setWorkspaceMemberWithSig({
          ethers,
          workspace,
          authoritySigner: authority,
          relayerSigner: relayer,
          domain,
          contextId,
          member: ethers.ZeroAddress,
          memberStatus: true,
          deadline,
        }),
      ).to.be.revertedWith("zero member");
    });

    it("reverts when the workspace NFT is not minted yet", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;
      const unminted = "0x9999999999999999999999999999999999999999999999999999999999999999";

      await expect(
        setWorkspaceMemberWithSig({
          ethers,
          workspace,
          authoritySigner: authority,
          relayerSigner: relayer,
          domain,
          contextId: unminted,
          member: member.address,
          memberStatus: true,
          deadline,
        }),
      ).to.be.revertedWith("authority not set");
    });

    it("reverts on expired signature", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now - 1n;

      await expect(
        setWorkspaceMemberWithSig({
          ethers,
          workspace,
          authoritySigner: authority,
          relayerSigner: relayer,
          domain,
          contextId,
          member: member.address,
          memberStatus: true,
          deadline,
        }),
      ).to.be.revertedWith("sig expired");
    });

    it("reverts on bad signer", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;

      await expect(
        setWorkspaceMemberWithSig({
          ethers,
          workspace,
          authoritySigner: member,
          relayerSigner: relayer,
          domain,
          contextId,
          member: member.address,
          memberStatus: true,
          deadline,
        }),
      ).to.be.revertedWith("bad signer");
    });

    it("prevents removing the authority as a member (no-op revert)", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;
      const nonceBefore = await workspace.nonces(authority.address);

      await expect(
        setWorkspaceMemberWithSig({
          ethers,
          workspace,
          authoritySigner: authority,
          relayerSigner: relayer,
          domain,
          contextId,
          member: authority.address,
          memberStatus: false,
          deadline,
        }),
      ).to.be.revertedWith("cannot remove authority");

      expect(await workspace.nonces(authority.address)).to.equal(nonceBefore);
      expect(await workspace.isMember(contextId, authority.address)).to.equal(true);
    });

    it("treats `setMember(authority, true)` as a no-op (does not consume a nonce)", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;
      const nonceBefore = await workspace.nonces(authority.address);

      await setWorkspaceMemberWithSig({
        ethers,
        workspace,
        authoritySigner: authority,
        relayerSigner: relayer,
        domain,
        contextId,
        member: authority.address,
        memberStatus: true,
        deadline,
      });

      expect(await workspace.nonces(authority.address)).to.equal(nonceBefore);
      expect(await workspace.isMember(contextId, authority.address)).to.equal(true);
    });

    it("prevents signature replay (nonce-based)", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;

      const nonce = await workspace.nonces(authority.address);
      const value = {
        contextId,
        member: member.address,
        isMember: true,
        nonce,
        deadline,
      };

      const signature = await authority.signTypedData(domain, workspaceSetMemberTypes, value);

      await workspace
        .connect(relayer)
        .setMemberWithSig(contextId, member.address, true, deadline, signature);

      await expect(
        workspace.connect(relayer).setMemberWithSig(contextId, member.address, true, deadline, signature),
      ).to.be.revertedWith("bad signer");
    });
  });

  describe("leave", function () {
    beforeEach(async function () {
      await workspaceNft.connect(deployer).mint(contextId, authority.address, TEST_TOKEN_URI);
    });

    it("allows a member to self-leave", async function () {
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;

      await setWorkspaceMemberWithSig({
        ethers,
        workspace,
        authoritySigner: authority,
        relayerSigner: relayer,
        domain,
        contextId,
        member: member.address,
        memberStatus: true,
        deadline,
      });

      await expect(workspace.connect(member).leave(contextId))
        .to.emit(workspace, "MemberSet")
        .withArgs(contextId, member.address, false);

      expect(await workspace.isMember(contextId, member.address)).to.equal(false);
    });

    it("reverts if authority tries to leave", async function () {
      await expect(workspace.connect(authority).leave(contextId)).to.be.revertedWith(
        "authority cannot leave",
      );
    });

    it("reverts on zero context", async function () {
      await expect(workspace.connect(member).leave(ethers.ZeroHash)).to.be.revertedWith(
        "zero context",
      );
    });
  });
});

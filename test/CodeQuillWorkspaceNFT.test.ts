import { expect } from "chai";
import {
  asBigInt,
  getWorkspaceEip712Domain,
  setupCodeQuill,
  TEST_CONTRACT_URI,
  TEST_TOKEN_URI,
  workspaceSetMemberTypes,
} from "./utils";

describe("CodeQuillWorkspaceNFT", function () {
  let ethers: any;
  let time: any;
  let workspace: any;
  let workspaceNft: any;
  let deployer: any;
  let alice: any;
  let bob: any;
  let charlie: any;

  const contextId = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const otherContextId = "0x2222222222222222222222222222222222222222222222222222222222222222";

  beforeEach(async function () {
    const env = await setupCodeQuill();
    ethers = env.ethers;
    time = env.time;
    deployer = env.deployer;
    alice = env.alice;
    bob = env.bob;
    charlie = env.charlie;
    workspace = env.workspace;
    workspaceNft = env.workspaceNft;
  });

  describe("metadata", function () {
    it("exposes the right name and symbol", async function () {
      expect(await workspaceNft.name()).to.equal("CodeQuill Workspace");
      expect(await workspaceNft.symbol()).to.equal("CQWS");
    });

    it("exposes contractURI for marketplace collection pages", async function () {
      expect(await workspaceNft.contractURI()).to.equal(TEST_CONTRACT_URI);
    });

    it("reverts deployment with an empty contractURI", async function () {
      const Nft = await ethers.getContractFactory("CodeQuillWorkspaceNFT");
      await expect(Nft.deploy("")).to.be.revertedWithCustomError(
        Nft,
        "InvalidContractURI",
      );
    });

    it("returns the per-token URI set at mint", async function () {
      const uri = "ipfs://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
      await workspaceNft.connect(deployer).mint(contextId, alice.address, uri);
      const tokenId = await workspaceNft.tokenIdOf(contextId);
      expect(await workspaceNft.tokenURI(tokenId)).to.equal(uri);
    });

    it("returns independent URIs for independent workspaces", async function () {
      const uriA = "ipfs://cidA";
      const uriB = "ipfs://cidB";
      await workspaceNft.connect(deployer).mint(contextId, alice.address, uriA);
      await workspaceNft.connect(deployer).mint(otherContextId, bob.address, uriB);
      expect(await workspaceNft.tokenURI(await workspaceNft.tokenIdOf(contextId))).to.equal(uriA);
      expect(await workspaceNft.tokenURI(await workspaceNft.tokenIdOf(otherContextId))).to.equal(uriB);
    });

    it("reverts tokenURI for an unminted token", async function () {
      const tokenId = await workspaceNft.tokenIdOf(contextId);
      await expect(workspaceNft.tokenURI(tokenId)).to.be.revertedWithCustomError(
        workspaceNft,
        "ERC721NonexistentToken",
      );
    });
  });

  describe("mint", function () {
    it("emits Transfer + WorkspaceMinted + WorkspaceAuthorityTransferred", async function () {
      const tx = await workspaceNft.connect(deployer).mint(contextId, alice.address, TEST_TOKEN_URI);
      const tokenId = await workspaceNft.tokenIdOf(contextId);

      await expect(tx)
        .to.emit(workspaceNft, "Transfer")
        .withArgs(ethers.ZeroAddress, alice.address, tokenId);
      await expect(tx)
        .to.emit(workspaceNft, "WorkspaceMinted")
        .withArgs(contextId, alice.address, TEST_TOKEN_URI);
      await expect(tx)
        .to.emit(workspaceNft, "WorkspaceAuthorityTransferred")
        .withArgs(contextId, ethers.ZeroAddress, alice.address);

      expect(await workspaceNft.ownerOf(tokenId)).to.equal(alice.address);
      expect(await workspaceNft.exists(contextId)).to.equal(true);
    });

    it("can be called by anyone (permissionless first-mint-wins)", async function () {
      await expect(
        workspaceNft.connect(charlie).mint(contextId, alice.address, TEST_TOKEN_URI),
      ).to.emit(workspaceNft, "WorkspaceMinted");

      await expect(
        workspaceNft.connect(charlie).mint(contextId, bob.address, TEST_TOKEN_URI),
      ).to.be.revertedWithCustomError(workspaceNft, "WorkspaceAlreadyMinted");
    });

    it("reverts on zero contextId / zero recipient / empty tokenURI", async function () {
      await expect(
        workspaceNft.connect(deployer).mint(ethers.ZeroHash, alice.address, TEST_TOKEN_URI),
      ).to.be.revertedWithCustomError(workspaceNft, "InvalidContextId");

      await expect(
        workspaceNft.connect(deployer).mint(contextId, ethers.ZeroAddress, TEST_TOKEN_URI),
      ).to.be.revertedWithCustomError(workspaceNft, "InvalidRecipient");

      await expect(
        workspaceNft.connect(deployer).mint(contextId, alice.address, ""),
      ).to.be.revertedWithCustomError(workspaceNft, "InvalidTokenURI");
    });

    it("supports independent contexts side by side", async function () {
      await workspaceNft.connect(deployer).mint(contextId, alice.address, TEST_TOKEN_URI);
      await workspaceNft.connect(deployer).mint(otherContextId, bob.address, TEST_TOKEN_URI);

      const tokenA = await workspaceNft.tokenIdOf(contextId);
      const tokenB = await workspaceNft.tokenIdOf(otherContextId);

      expect(await workspaceNft.ownerOf(tokenA)).to.equal(alice.address);
      expect(await workspaceNft.ownerOf(tokenB)).to.equal(bob.address);
    });
  });

  describe("approvals are disabled", function () {
    beforeEach(async function () {
      await workspaceNft.connect(deployer).mint(contextId, alice.address, TEST_TOKEN_URI);
    });

    it("reverts approve()", async function () {
      const tokenId = await workspaceNft.tokenIdOf(contextId);
      await expect(
        workspaceNft.connect(alice).approve(bob.address, tokenId),
      ).to.be.revertedWithCustomError(workspaceNft, "ApprovalsDisabled");
    });

    it("reverts setApprovalForAll()", async function () {
      await expect(
        workspaceNft.connect(alice).setApprovalForAll(bob.address, true),
      ).to.be.revertedWithCustomError(workspaceNft, "ApprovalsDisabled");

      // Also reverts the "revoke approval" path — there is no operator state
      // to revoke, since no approval can ever be set in the first place.
      await expect(
        workspaceNft.connect(alice).setApprovalForAll(bob.address, false),
      ).to.be.revertedWithCustomError(workspaceNft, "ApprovalsDisabled");
    });

    it("still allows the holder themselves to transfer", async function () {
      const tokenId = await workspaceNft.tokenIdOf(contextId);
      await expect(
        workspaceNft
          .connect(alice)
          ["safeTransferFrom(address,address,uint256)"](
            alice.address,
            bob.address,
            tokenId,
          ),
      ).to.emit(workspaceNft, "Transfer");
      expect(await workspaceNft.ownerOf(tokenId)).to.equal(bob.address);
    });
  });

  describe("transfer = authority change", function () {
    beforeEach(async function () {
      await workspaceNft.connect(deployer).mint(contextId, alice.address, TEST_TOKEN_URI);
    });

    it("transfers authority via safeTransferFrom and updates the registry view", async function () {
      const tokenId = await workspaceNft.tokenIdOf(contextId);

      expect(await workspace.authorityOf(contextId)).to.equal(alice.address);

      await expect(
        workspaceNft
          .connect(alice)
          ["safeTransferFrom(address,address,uint256)"](
            alice.address,
            bob.address,
            tokenId,
          ),
      )
        .to.emit(workspaceNft, "WorkspaceAuthorityTransferred")
        .withArgs(contextId, alice.address, bob.address);

      expect(await workspace.authorityOf(contextId)).to.equal(bob.address);
      expect(await workspace.isMember(contextId, bob.address)).to.equal(true);
    });

    it("rejects transfers from a non-owner", async function () {
      const tokenId = await workspaceNft.tokenIdOf(contextId);

      await expect(
        workspaceNft
          .connect(bob)
          ["safeTransferFrom(address,address,uint256)"](
            alice.address,
            bob.address,
            tokenId,
          ),
      ).to.be.revertedWithCustomError(workspaceNft, "ERC721InsufficientApproval");
    });

    it("after transfer, the old authority can no longer sign membership changes", async function () {
      const tokenId = await workspaceNft.tokenIdOf(contextId);
      await workspaceNft
        .connect(alice)
        ["safeTransferFrom(address,address,uint256)"](
          alice.address,
          bob.address,
          tokenId,
        );

      const domain = await getWorkspaceEip712Domain(ethers, workspace);
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;

      // The new authority is `bob`; `nonces` are tracked per-authority address.
      const nonce = await workspace.nonces(bob.address);
      const value = {
        contextId,
        member: charlie.address,
        isMember: true,
        nonce,
        deadline,
      };

      // Old authority signing should fail.
      const aliceSig = await alice.signTypedData(domain, workspaceSetMemberTypes, {
        ...value,
        nonce: await workspace.nonces(alice.address),
      });

      await expect(
        workspace
          .connect(deployer)
          .setMemberWithSig(contextId, charlie.address, true, deadline, aliceSig),
      ).to.be.revertedWith("bad signer");

      // New authority signing should succeed.
      const bobSig = await bob.signTypedData(domain, workspaceSetMemberTypes, value);
      await expect(
        workspace
          .connect(deployer)
          .setMemberWithSig(contextId, charlie.address, true, deadline, bobSig),
      )
        .to.emit(workspace, "MemberSet")
        .withArgs(contextId, charlie.address, true);
    });
  });

  describe("EIP-1271 / Safe-style authority", function () {
    it("accepts a contract-wallet authority via SignatureChecker", async function () {
      // Deploy a contract wallet whose owner is `alice`. The wallet's address
      // becomes the workspace authority; alice's EOA signs on its behalf.
      const Wallet = await ethers.getContractFactory("MockEIP1271Signer");
      const wallet = await Wallet.deploy(alice.address);
      await wallet.waitForDeployment();
      const walletAddr = await wallet.getAddress();

      await workspaceNft.connect(deployer).mint(contextId, walletAddr, TEST_TOKEN_URI);
      expect(await workspace.authorityOf(contextId)).to.equal(walletAddr);

      const domain = await getWorkspaceEip712Domain(ethers, workspace);
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;
      const nonce = await workspace.nonces(walletAddr);

      const value = {
        contextId,
        member: bob.address,
        isMember: true,
        nonce,
        deadline,
      };

      // Alice signs the EIP-712 digest; the wallet contract's
      // `isValidSignature` recovers her address and approves the message.
      const signature = await alice.signTypedData(
        domain,
        workspaceSetMemberTypes,
        value,
      );

      await expect(
        workspace
          .connect(deployer)
          .setMemberWithSig(contextId, bob.address, true, deadline, signature),
      )
        .to.emit(workspace, "MemberSet")
        .withArgs(contextId, bob.address, true);

      expect(await workspace.isMember(contextId, bob.address)).to.equal(true);
      expect(await workspace.nonces(walletAddr)).to.equal(nonce + 1n);
    });

    it("rejects EIP-1271 signatures from a non-owner of the contract wallet", async function () {
      const Wallet = await ethers.getContractFactory("MockEIP1271Signer");
      const wallet = await Wallet.deploy(alice.address);
      await wallet.waitForDeployment();
      const walletAddr = await wallet.getAddress();

      await workspaceNft.connect(deployer).mint(contextId, walletAddr, TEST_TOKEN_URI);

      const domain = await getWorkspaceEip712Domain(ethers, workspace);
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;
      const nonce = await workspace.nonces(walletAddr);

      // `bob` (not the wallet's owner) signs — wallet must reject.
      const bogus = await bob.signTypedData(domain, workspaceSetMemberTypes, {
        contextId,
        member: charlie.address,
        isMember: true,
        nonce,
        deadline,
      });

      await expect(
        workspace
          .connect(deployer)
          .setMemberWithSig(contextId, charlie.address, true, deadline, bogus),
      ).to.be.revertedWith("bad signer");
    });
  });
});

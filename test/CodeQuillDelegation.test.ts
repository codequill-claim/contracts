import { expect } from "chai";
import {
  asBigInt,
  delegationTypes,
  getEip712Domain,
  revokeDelegationTypes,
  setupCodeQuill,
} from "./utils";

describe("CodeQuillDelegation", function () {
  let ethers: any;
  let time: any;
  let delegation: any;
  let deployer: any;
  let owner: any;
  let relayer: any;
  let other: any;
  let domain: any;

  const contextIdLabel = "ctx-1";

  beforeEach(async function () {
    const env = await setupCodeQuill();
    ethers = env.ethers;
    time = env.time;
    deployer = env.deployer;
    owner = env.alice;
    relayer = env.bob;
    other = env.charlie;
    delegation = env.delegation;

    domain = await getEip712Domain(
      ethers,
      "CodeQuillDelegation",
      "1",
      await delegation.getAddress(),
    );
  });

  describe("registerDelegationWithSig", function () {
    it("registers a delegation and authorizes scoped calls within a contextId", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;

      const scopes =
        (await delegation.SCOPE_CLAIM()) | (await delegation.SCOPE_SNAPSHOT());
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegation.registerDelegationWithSig(
          owner.address,
          relayer.address,
          contextId,
          scopes,
          expiry,
          deadline,
          signature,
        ),
      )
        .to.emit(delegation, "Delegated")
        .withArgs(owner.address, relayer.address, contextId, scopes, expiry);

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_CLAIM(),
          contextId,
        ),
      ).to.equal(true);

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_ATTEST(),
          contextId,
        ),
      ).to.equal(false);
    });

    it("reverts on bad signer", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await other.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegation.registerDelegationWithSig(
          owner.address,
          relayer.address,
          contextId,
          scopes,
          expiry,
          deadline,
          signature,
        ),
      ).to.be.revertedWith("bad signer");
    });

    it("reverts when signature deadline is passed", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now - 1n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegation.registerDelegationWithSig(
          owner.address,
          relayer.address,
          contextId,
          scopes,
          expiry,
          deadline,
          signature,
        ),
      ).to.be.revertedWith("sig expired");
    });

    it("reverts when expiry is not in the future", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now; // invalid
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegation.registerDelegationWithSig(
          owner.address,
          relayer.address,
          contextId,
          scopes,
          expiry,
          deadline,
          signature,
        ),
      ).to.be.revertedWith("bad expiry");
    });

    it("reverts on zero context", async function () {
      const contextId = ethers.ZeroHash;
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegation.registerDelegationWithSig(
          owner.address,
          relayer.address,
          contextId,
          scopes,
          expiry,
          deadline,
          signature,
        ),
      ).to.be.revertedWith("zero context");
    });

    it("reverts on zero relayer address", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: ethers.ZeroAddress,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegation.registerDelegationWithSig(
          owner.address,
          ethers.ZeroAddress,
          contextId,
          scopes,
          expiry,
          deadline,
          signature,
        ),
      ).to.be.revertedWith("zero relayer");
    });
  });

  describe("EIP-1271 / contract-wallet owners", function () {
    it("accepts a contract-wallet owner via SignatureChecker for register and revoke", async function () {
      // A Safe-style contract wallet whose internal signer is `owner` (alice).
      // The wallet's address is the delegating "owner" on-chain; alice signs
      // the EIP-712 digest with her EOA key and the wallet validates via
      // IERC1271.isValidSignature.
      const Wallet = await ethers.getContractFactory("MockEIP1271Signer");
      const wallet = await Wallet.deploy(owner.address);
      await wallet.waitForDeployment();
      const walletAddr = await wallet.getAddress();

      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(walletAddr);

      const value = {
        owner: walletAddr,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);

      await expect(
        delegation.registerDelegationWithSig(
          walletAddr,
          relayer.address,
          contextId,
          scopes,
          expiry,
          deadline,
          signature,
        ),
      )
        .to.emit(delegation, "Delegated")
        .withArgs(walletAddr, relayer.address, contextId, scopes, expiry);

      expect(
        await delegation.isAuthorized(
          walletAddr,
          relayer.address,
          await delegation.SCOPE_CLAIM(),
          contextId,
        ),
      ).to.equal(true);

      // Revoke with a contract-wallet signature.
      const revokeNonce = await delegation.nonces(walletAddr);
      const revokeDeadline = now + 9000n;
      const revokeValue = {
        owner: walletAddr,
        relayer: relayer.address,
        contextId,
        nonce: revokeNonce,
        deadline: revokeDeadline,
      };
      const revokeSignature = await owner.signTypedData(
        domain,
        revokeDelegationTypes,
        revokeValue,
      );

      await expect(
        delegation.revokeWithSig(
          walletAddr,
          relayer.address,
          contextId,
          revokeDeadline,
          revokeSignature,
        ),
      )
        .to.emit(delegation, "Revoked")
        .withArgs(walletAddr, relayer.address, contextId);
    });

    it("rejects EIP-1271 signatures from a non-owner of the contract wallet", async function () {
      const Wallet = await ethers.getContractFactory("MockEIP1271Signer");
      const wallet = await Wallet.deploy(owner.address);
      await wallet.waitForDeployment();
      const walletAddr = await wallet.getAddress();

      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(walletAddr);

      // `other` (charlie) signs but the wallet's owner is `owner` (alice).
      const bogus = await other.signTypedData(domain, delegationTypes, {
        owner: walletAddr,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      });

      await expect(
        delegation.registerDelegationWithSig(
          walletAddr,
          relayer.address,
          contextId,
          scopes,
          expiry,
          deadline,
          bogus,
        ),
      ).to.be.revertedWith("bad signer");
    });
  });

  describe("isAuthorized", function () {
    it("returns false for zero context", async function () {
      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_CLAIM(),
          ethers.ZeroHash,
        ),
      ).to.equal(false);
    });

    it("returns false once delegation expires", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 100n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_SNAPSHOT();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await delegation.registerDelegationWithSig(
        owner.address,
        relayer.address,
        contextId,
        scopes,
        expiry,
        deadline,
        signature,
      );

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_SNAPSHOT(),
          contextId,
        ),
      ).to.equal(true);

      await time.increase(200);

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_SNAPSHOT(),
          contextId,
        ),
      ).to.equal(false);
    });

    it("treats SCOPE_ALL as authorizing any scope", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_ALL();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await delegation.registerDelegationWithSig(
        owner.address,
        relayer.address,
        contextId,
        scopes,
        expiry,
        deadline,
        signature,
      );

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_CLAIM(),
          contextId,
        ),
      ).to.equal(true);

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_RELEASE(),
          contextId,
        ),
      ).to.equal(true);
    });
  });

  describe("revocation", function () {
    it("allows owner to revoke directly", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await delegation.registerDelegationWithSig(
        owner.address,
        relayer.address,
        contextId,
        scopes,
        expiry,
        deadline,
        signature,
      );

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_CLAIM(),
          contextId,
        ),
      ).to.equal(true);

      await expect(delegation.connect(owner).revoke(relayer.address, contextId))
        .to.emit(delegation, "Revoked")
        .withArgs(owner.address, relayer.address, contextId);

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_CLAIM(),
          contextId,
        ),
      ).to.equal(false);
    });

    it("reverts when revoking with zero address or zero context", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      await expect(
        delegation.connect(owner).revoke(ethers.ZeroAddress, contextId),
      ).to.be.revertedWith("zero relayer");

      await expect(
        delegation.connect(owner).revoke(relayer.address, ethers.ZeroHash),
      ).to.be.revertedWith("zero context");
    });

    it("allows revocation with signature", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);
      await delegation.registerDelegationWithSig(
        owner.address,
        relayer.address,
        contextId,
        scopes,
        expiry,
        deadline,
        signature,
      );

      const revokeNonce = await delegation.nonces(owner.address);
      const revokeDeadline = now + 9000n;
      const revokeValue = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        nonce: revokeNonce,
        deadline: revokeDeadline,
      };

      const revokeSig = await owner.signTypedData(
        domain,
        revokeDelegationTypes,
        revokeValue,
      );
      const { v: vR, r: rR, s: sR } = ethers.Signature.from(revokeSig);

      await expect(
        delegation
          .connect(deployer)
          .revokeWithSig(owner.address, relayer.address, contextId, revokeDeadline, revokeSig),
      )
        .to.emit(delegation, "Revoked")
        .withArgs(owner.address, relayer.address, contextId);

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_CLAIM(),
          contextId,
        ),
      ).to.equal(false);
    });

    it("reverts on revokeWithSig with bad signer", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const deadline = now + 7200n;
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        nonce,
        deadline,
      };

      const signature = await other.signTypedData(
        domain,
        revokeDelegationTypes,
        value,
      );
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegation.revokeWithSig(
          owner.address,
          relayer.address,
          contextId,
          deadline,
          signature,
        ),
      ).to.be.revertedWith("bad signer");
    });

    it("reverts on revokeWithSig with expired deadline", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const deadline = now - 1n;
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        nonce,
        deadline,
      };

      const signature = await owner.signTypedData(
        domain,
        revokeDelegationTypes,
        value,
      );
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegation.revokeWithSig(
          owner.address,
          relayer.address,
          contextId,
          deadline,
          signature,
        ),
      ).to.be.revertedWith("sig expired");
    });
  });
});

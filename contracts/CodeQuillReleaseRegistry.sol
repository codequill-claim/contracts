// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICodeQuillRepositoryRegistry {
    function repoOwner(bytes32 repoId) external view returns (address);
    function repoContextId(bytes32 repoId) external view returns (bytes32);
}

interface ICodeQuillWorkspaceRegistry {
    function isMember(bytes32 contextId, address wallet) external view returns (bool);
}

interface ICodeQuillDelegation {
    function SCOPE_RELEASE() external view returns (uint256);

    function isAuthorized(
        address owner_,
        address relayer_,
        uint256 scope,
        bytes32 contextId
    ) external view returns (bool);
}

interface ICodeQuillSnapshotRegistry {
    function snapshotIndexByRoot(bytes32 repoId, bytes32 merkleRoot) external view returns (uint256);
}

/**
 * @title CodeQuillReleaseRegistry
 * @notice Anchors immutable records of releases referencing snapshot with governance status.
 *
 * Hard guarantees (no backend trust):
 * - Release is bound to contextId (workspace).
 * - author + governanceAuthority must be workspace members for that contextId.
 * - Repo referenced must belong to the same contextId.
 * - Multi-owner releases are allowed, but only if the author is a workspace member.
 *   (Repo ownership is NOT required to build a release, by design.)
 */
contract CodeQuillReleaseRegistry {
    ICodeQuillRepositoryRegistry public immutable registry;
    ICodeQuillWorkspaceRegistry public immutable workspace;
    ICodeQuillDelegation public immutable delegation;
    ICodeQuillSnapshotRegistry public immutable snapshotRegistry;

    enum GouvernanceStatus { PENDING, ACCEPTED, REJECTED }

    struct Release {
        bytes32 id;
        bytes32 contextId;
        bytes32 repoId;
        bytes32 merkleRoot;
        string manifestCid;
        string name;
        uint256 timestamp;
        address author;
        address governanceAuthority;
        bytes32 supersededBy;
        bool revoked;
        GouvernanceStatus status;
        uint256 statusTimestamp;
        address statusAuthor;
    }

    mapping(bytes32 => Release) public releaseById;

    /// @notice mapping from contextId to Aragon DAO executor address allowed to accept/reject. address(0) means "DAO not configured".
    mapping(bytes32 => address) public daoExecutors;

    event ReleaseAnchored(
        bytes32 indexed releaseId,
        bytes32 indexed contextId,
        bytes32 repoId,
        bytes32 merkleRoot,
        address author,
        address governanceAuthority,
        string manifestCid,
        string name,
        uint256 timestamp
    );

    event ReleaseSuperseded(
        bytes32 indexed oldReleaseId,
        bytes32 indexed newReleaseId,
        address author,
        uint256 timestamp
    );

    event ReleaseRevoked(
        bytes32 indexed releaseId,
        address indexed author,
        uint256 timestamp
    );

    event GouvernanceStatusChanged(
        bytes32 indexed releaseId,
        GouvernanceStatus newStatus,
        address indexed statusAuthor,
        uint256 timestamp
    );

    event DaoExecutorSet(bytes32 indexed contextId, address indexed daoExecutor);

    constructor(
        address registryAddr,
        address workspaceAddr,
        address delegationAddr,
        address snapshotRegistryAddr
    ) {
        require(registryAddr != address(0), "zero registry");
        require(workspaceAddr != address(0), "zero workspace");
        require(delegationAddr != address(0), "zero delegation");
        require(snapshotRegistryAddr != address(0), "zero snapshotRegistry");

        registry = ICodeQuillRepositoryRegistry(registryAddr);
        workspace = ICodeQuillWorkspaceRegistry(workspaceAddr);
        delegation = ICodeQuillDelegation(delegationAddr);
        snapshotRegistry = ICodeQuillSnapshotRegistry(snapshotRegistryAddr);
    }

    /// @notice Set the Aragon DAO executor for a context.
    function setDaoExecutor(
        bytes32 contextId,
        address author,
        address daoExecutor_
    ) external onlySelfOrDelegated(author, delegation.SCOPE_RELEASE(), contextId) {
        require(workspace.isMember(contextId, author), "author not member");
        daoExecutors[contextId] = daoExecutor_;
        emit DaoExecutorSet(contextId, daoExecutor_);
    }

    modifier onlySelfOrDelegated(address authority, uint256 scope, bytes32 contextId) {
        require(contextId != bytes32(0), "zero context");
        if (msg.sender == authority) {
            _;
            return;
        }
        bool ok = delegation.isAuthorized(authority, msg.sender, scope, contextId);
        require(ok, "not authorized");
        _;
    }

    modifier onlyGovernance(bytes32 releaseId) {
        Release storage r = releaseById[releaseId];
        require(r.timestamp != 0, "release not found");

        address exec = daoExecutors[r.contextId];
        if (exec != address(0) && msg.sender == exec) {
            _;
            return;
        }

        uint256 scope = delegation.SCOPE_RELEASE();
        if (msg.sender == r.governanceAuthority) {
            _;
            return;
        }

        bool ok = delegation.isAuthorized(r.governanceAuthority, msg.sender, scope, r.contextId);
        require(ok, "not governance");
        _;
    }

    /// @notice Anchor a new release record.
    function anchorRelease(
        bytes32 releaseId,
        bytes32 contextId,
        string calldata manifestCid,
        string calldata name,
        address author,
        address governanceAuthority,
        bytes32 repoId,
        bytes32 merkleRoot
    ) external onlySelfOrDelegated(author, delegation.SCOPE_RELEASE(), contextId) {
        require(releaseId != bytes32(0), "zero releaseId");
        require(releaseById[releaseId].timestamp == 0, "duplicate releaseId");
        require(repoId != bytes32(0), "zero repoId");
        require(merkleRoot != bytes32(0), "zero merkleRoot");
        require(bytes(manifestCid).length > 0, "empty CID");
        require(author != address(0), "zero author");
        require(governanceAuthority != address(0), "zero governanceAuthority");

        // NEW: author + governanceAuthority must be members of the workspace context
        require(workspace.isMember(contextId, author), "author not member");
        require(workspace.isMember(contextId, governanceAuthority), "governance not member");

        // Validate snapshot and ensure repo belongs to same context
        require(snapshotRegistry.snapshotIndexByRoot(repoId, merkleRoot) > 0, "snapshot not found");

        address rOwner = registry.repoOwner(repoId);
        require(rOwner != address(0), "repo not claimed");

        bytes32 repoCtx = registry.repoContextId(repoId);
        require(repoCtx == contextId, "repo wrong context");

        releaseById[releaseId] = Release({
            id: releaseId,
            contextId: contextId,
            repoId: repoId,
            merkleRoot: merkleRoot,
            manifestCid: manifestCid,
            name: name,
            timestamp: block.timestamp,
            author: author,
            governanceAuthority: governanceAuthority,
            supersededBy: bytes32(0),
            revoked: false,
            status: GouvernanceStatus.PENDING,
            statusTimestamp: block.timestamp,
            statusAuthor: address(0)
        });

        emit ReleaseAnchored(
            releaseId,
            contextId,
            repoId,
            merkleRoot,
            author,
            governanceAuthority,
            manifestCid,
            name,
            block.timestamp
        );
    }

    /// @notice Accept a pending release (governance).
    function accept(bytes32 releaseId) external onlyGovernance(releaseId) {
        Release storage r = releaseById[releaseId];
        require(r.status == GouvernanceStatus.PENDING, "not in pending status");
        require(!r.revoked, "release revoked");

        r.status = GouvernanceStatus.ACCEPTED;
        r.statusTimestamp = block.timestamp;
        r.statusAuthor = msg.sender;

        emit GouvernanceStatusChanged(releaseId, GouvernanceStatus.ACCEPTED, msg.sender, block.timestamp);
    }

    /// @notice Reject a pending release (governance).
    function reject(bytes32 releaseId) external onlyGovernance(releaseId) {
        Release storage r = releaseById[releaseId];
        require(r.status == GouvernanceStatus.PENDING, "not in pending status");
        require(!r.revoked, "release revoked");

        r.status = GouvernanceStatus.REJECTED;
        r.statusTimestamp = block.timestamp;
        r.statusAuthor = msg.sender;

        emit GouvernanceStatusChanged(releaseId, GouvernanceStatus.REJECTED, msg.sender, block.timestamp);
    }

    /// @notice Revoke a release.
    function revokeRelease(bytes32 releaseId, address author) external {
        Release storage r = releaseById[releaseId];
        require(r.timestamp != 0, "release not found");
        require(r.author == author, "mismatched author");

        uint256 scope = delegation.SCOPE_RELEASE();
        if (msg.sender != author) {
            bool ok = delegation.isAuthorized(author, msg.sender, scope, r.contextId);
            require(ok, "not authorized");
        }

        r.revoked = true;
        emit ReleaseRevoked(releaseId, author, block.timestamp);
    }

    /// @notice Supersede a revoked release with a new one.
    function supersedeRelease(bytes32 oldReleaseId, bytes32 newReleaseId, address author) external {
        Release storage oldR = releaseById[oldReleaseId];
        require(oldR.timestamp != 0, "old release not found");

        Release storage newR = releaseById[newReleaseId];
        require(newR.timestamp != 0, "new release not found");

        require(oldR.revoked, "old release must be revoked");
        require(oldR.supersededBy == bytes32(0), "already superseded");
        require(oldR.author == author, "mismatched author");

        uint256 scope = delegation.SCOPE_RELEASE();
        if (msg.sender != author) {
            bool ok = delegation.isAuthorized(author, msg.sender, scope, oldR.contextId);
            require(ok, "not authorized");
        }

        oldR.supersededBy = newReleaseId;
        emit ReleaseSuperseded(oldReleaseId, newReleaseId, author, block.timestamp);
    }

    // ---- Views ----

    /// @notice Get a release by its ID.
    function getReleaseById(bytes32 releaseId)
    external
    view
    returns (
        bytes32 id,
        bytes32 contextId,
        bytes32 repoId,
        bytes32 merkleRoot,
        string memory manifestCid,
        string memory name,
        uint256 timestamp,
        address author,
        address governanceAuthority,
        bytes32 supersededBy,
        bool revoked,
        GouvernanceStatus status,
        uint256 statusTimestamp,
        address statusAuthor
    )
    {
        Release storage r = releaseById[releaseId];
        require(r.timestamp != 0, "not found");
        return (
            r.id,
            r.contextId,
            r.repoId,
            r.merkleRoot,
            r.manifestCid,
            r.name,
            r.timestamp,
            r.author,
            r.governanceAuthority,
            r.supersededBy,
            r.revoked,
            r.status,
            r.statusTimestamp,
            r.statusAuthor
        );
    }

    /// @notice Get the governance status of a release.
    function getGouvernanceStatus(bytes32 releaseId) external view returns (GouvernanceStatus status) {
        Release storage r = releaseById[releaseId];
        require(r.timestamp != 0, "release not found");
        return r.status;
    }
}
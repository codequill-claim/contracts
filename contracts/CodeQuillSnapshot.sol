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
    function SCOPE_SNAPSHOT() external view returns (uint256);

    function isAuthorized(
        address owner_,
        address relayer_,
        uint256 scope,
        bytes32 contextId
    ) external view returns (bool);
}

/// @title CodeQuillSnapshotRegistry - lightweight snapshot via merkle roots + off-chain manifest
/// @notice Snapshot creation is allowed for any current member of the repo's
///         workspace context, OR a relayer that member has delegated.
///         The repo's claim wallet (`repoOwner`) is not required to be the
///         snapshot author — repo claim is provenance, workspace membership
///         is authorization. This means rotating workspace authority via NFT
///         transfer immediately gives the new owner the right to snapshot,
///         without needing to transfer every claimed repo too.
contract CodeQuillSnapshotRegistry {
    ICodeQuillRepositoryRegistry public immutable registry;
    ICodeQuillWorkspaceRegistry public immutable workspace;
    ICodeQuillDelegation public immutable delegation;

    struct Snapshot {
        bytes32 commitHash;  // git commit
        bytes32 merkleRoot;  // merkle tree root of all file hashes
        string  manifestCid; // IPFS CID of JSON manifest with file list
        uint256 timestamp;
        address author;      // repo owner (recorded for provenance)
    }

    mapping(bytes32 => Snapshot[]) private snapshotsOf;
    mapping(bytes32 => mapping(bytes32 => uint256)) public snapshotIndexByRoot;

    event SnapshotCreated(
        bytes32 indexed repoId,
        uint256 indexed snapshotIndex,
        bytes32 indexed contextId,
        address author,
        bytes32 commitHash,
        bytes32 merkleRoot,
        string manifestCid,
        uint256 timestamp
    );

    constructor(
        address registryAddr,
        address workspaceAddr,
        address delegationAddr
    ) {
        require(registryAddr != address(0), "zero registry");
        require(workspaceAddr != address(0), "zero workspace");
        require(delegationAddr != address(0), "zero delegation");

        registry = ICodeQuillRepositoryRegistry(registryAddr);
        workspace = ICodeQuillWorkspaceRegistry(workspaceAddr);
        delegation = ICodeQuillDelegation(delegationAddr);
    }

    /// @notice Create a snapshot
    /// @dev Works for:
    ///  - direct author call (msg.sender == author), and
    ///  - relayed call where `author` delegated SCOPE_SNAPSHOT to msg.sender within contextId.
    ///
    /// @param author Logical author wallet to record on-chain. Must be a
    ///        *current* member of the repo's workspace contextId — not
    ///        necessarily the wallet that claimed the repo. Recorded as
    ///        immutable provenance.
    function createSnapshot(
        bytes32 repoId,
        bytes32 contextId,
        bytes32 commitHash,
        bytes32 merkleRoot,
        string calldata manifestCid,
        address author
    ) external {
        require(contextId != bytes32(0), "zero context");
        require(merkleRoot != bytes32(0), "zero root");
        require(author != address(0), "zero author");
        require(bytes(manifestCid).length > 0, "empty CID");
        require(snapshotIndexByRoot[repoId][merkleRoot] == 0, "duplicate root");

        // Repo must exist (claimed) and belong to this workspace context.
        bytes32 repoCtx = registry.repoContextId(repoId);
        require(repoCtx != bytes32(0), "repo not claimed");
        require(repoCtx == contextId, "repo wrong context");

        // Membership enforcement: author must be a current member of the
        // workspace context. The repo's original claim wallet is not used
        // for authorization — it stays in `RepositoryRegistry.repoOwner` as
        // provenance + the wallet allowed to `transferRepo`.
        require(workspace.isMember(contextId, author), "author not member");

        // Authorization: author calls directly OR has delegated caller for this context
        if (msg.sender != author) {
            bool isDelegated = delegation.isAuthorized(author, msg.sender, delegation.SCOPE_SNAPSHOT(), contextId);
            require(isDelegated, "not authorized");
        }

        uint256 idx = snapshotsOf[repoId].length;

        snapshotsOf[repoId].push(Snapshot({
            commitHash: commitHash,
            merkleRoot: merkleRoot,
            manifestCid: manifestCid,
            timestamp: block.timestamp,
            author: author
        }));

        snapshotIndexByRoot[repoId][merkleRoot] = idx + 1;

        emit SnapshotCreated(
            repoId,
            idx,
            contextId,
            author,
            commitHash,
            merkleRoot,
            manifestCid,
            block.timestamp
        );
    }

    /// @notice Get the total number of snapshots for a repo.
    function getSnapshotsCount(bytes32 repoId) external view returns (uint256) {
        return snapshotsOf[repoId].length;
    }

    /// @notice Get a snapshot by its index for a repo.
    function getSnapshot(bytes32 repoId, uint256 index)
    external
    view
    returns (
        bytes32 commitHash,
        bytes32 merkleRoot,
        string memory manifestCid,
        uint256 timestamp,
        address author
    )
    {
        require(index < snapshotsOf[repoId].length, "invalid index");
        Snapshot storage s = snapshotsOf[repoId][index];
        return (s.commitHash, s.merkleRoot, s.manifestCid, s.timestamp, s.author);
    }

    /// @notice Get a snapshot by its Merkle root for a repo.
    function getSnapshotByRoot(bytes32 repoId, bytes32 merkleRoot)
    external
    view
    returns (
        bytes32 commitHash,
        string memory manifestCid,
        uint256 timestamp,
        address author,
        uint256 index
    )
    {
        uint256 idx1 = snapshotIndexByRoot[repoId][merkleRoot];
        require(idx1 != 0, "not found");
        Snapshot storage s = snapshotsOf[repoId][idx1 - 1];
        return (s.commitHash, s.manifestCid, s.timestamp, s.author, idx1 - 1);
    }
}
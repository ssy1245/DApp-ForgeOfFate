// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Deployment verification only. No game assets or payable methods.
contract DeploymentProbe {
    address public immutable deployer;
    bytes32 public immutable deploymentId;

    constructor(bytes32 id) {
        require(id != bytes32(0), "Empty deployment id");
        deployer = msg.sender;
        deploymentId = id;
    }
}

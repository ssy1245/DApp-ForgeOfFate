// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Test ETH receipts only. Game coins and the conversion rate live on the server.
contract ForgeRecharge is ReentrancyGuard {
    address payable public immutable treasury;
    bytes32 public immutable deploymentId;
    uint256 public nextDepositId = 1;
    uint256 public constant MAX_ADMINS = 32;
    mapping(address => bool) public isAdmin;
    address[] private administrators;
    event Deposited(uint256 indexed depositId, address indexed payer, uint256 amount);
    event Withdrawn(address indexed treasury, uint256 amount);
    event AdminAdded(address indexed admin, address indexed operator);
    event AdminRemoved(address indexed admin, address indexed operator);

    constructor(address payable recipient, bytes32 epoch) {
        require(recipient != address(0), "Invalid treasury");
        require(epoch != bytes32(0), "Invalid deployment");
        treasury = recipient;
        deploymentId = epoch;
        isAdmin[recipient] = true;
        administrators.push(recipient);
        emit AdminAdded(recipient, msg.sender);
    }

    // The fixed treasury remains the root authority; delegated admins cannot grant roles.
    modifier onlyTreasury() {
        require(msg.sender == treasury, "Not treasury");
        _;
    }

    function getAdmins() external view returns (address[] memory) {
        return administrators;
    }

    function addAdmin(address admin) external onlyTreasury {
        require(admin != address(0) && admin != address(this), "Invalid admin");
        require(!isAdmin[admin], "Already admin");
        require(administrators.length < MAX_ADMINS, "Admin limit");
        isAdmin[admin] = true;
        administrators.push(admin);
        emit AdminAdded(admin, msg.sender);
    }

    function removeAdmin(address admin) external onlyTreasury {
        require(admin != treasury, "Cannot remove treasury");
        require(isAdmin[admin], "Not admin");
        isAdmin[admin] = false;
        for (uint256 i; i < administrators.length; ++i) {
            if (administrators[i] == admin) {
                administrators[i] = administrators[administrators.length - 1];
                administrators.pop();
                break;
            }
        }
        emit AdminRemoved(admin, msg.sender);
    }

    function deposit() external payable nonReentrant returns (uint256 depositId) {
        require(msg.value > 0, "Empty deposit");
        depositId = nextDepositId++;
        emit Deposited(depositId, msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(isAdmin[msg.sender], "Not admin");
        require(amount > 0 && amount <= address(this).balance, "Invalid amount");
        (bool ok,) = treasury.call{value: amount}("");
        require(ok, "Withdrawal failed");
        emit Withdrawn(treasury, amount);
    }
    // No receive/fallback: a plain ETH transfer must not look like a credited deposit.
}

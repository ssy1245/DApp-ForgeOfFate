// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Custody only. Game coins are settled off-chain from finalized events.
/// Each locking session has a new ID, even when the same NFT is staked again.
contract ForgeStaking is IERC721Receiver, ReentrancyGuard {
    struct Position {
        address staker;
        uint256 tokenId;
        uint256 startedAt;
        uint256 endedAt;
    }
    IERC721 public immutable nft;
    bytes32 public immutable deploymentId;
    uint256 public nextPositionId = 1;
    mapping(uint256 => Position) public positions;
    mapping(uint256 => uint256) public activePosition;
    bool private receiving;
    address private expectedFrom;
    uint256 private expectedToken;

    event Staked(uint256 indexed positionId, address indexed staker, uint256 indexed tokenId, uint256 startedAt);
    event Unstaked(uint256 indexed positionId, address indexed staker, uint256 indexed tokenId, uint256 endedAt);

    constructor(address collection, bytes32 epoch) {
        require(collection.code.length > 0, "Invalid collection");
        require(epoch != bytes32(0), "Invalid deployment");
        nft = IERC721(collection);
        deploymentId = epoch;
    }

    function stake(uint256 tokenId) external nonReentrant returns (uint256 positionId) {
        require(activePosition[tokenId] == 0, "Already staked");
        require(nft.ownerOf(tokenId) == msg.sender, "Not owner");
        positionId = nextPositionId++;
        positions[positionId] = Position(msg.sender, tokenId, block.timestamp, 0);
        activePosition[tokenId] = positionId;
        receiving = true;
        expectedFrom = msg.sender;
        expectedToken = tokenId;
        nft.safeTransferFrom(msg.sender, address(this), tokenId);
        require(!receiving && nft.ownerOf(tokenId) == address(this), "Custody failed");
        delete expectedFrom;
        delete expectedToken;
        emit Staked(positionId, msg.sender, tokenId, block.timestamp);
    }

    /// @notice No server permission, coin repayment or administrator is required.
    function unstake(uint256 positionId) external nonReentrant {
        Position storage position = positions[positionId];
        require(position.staker == msg.sender, "Not staker");
        require(position.endedAt == 0, "Already withdrawn");
        position.endedAt = block.timestamp;
        delete activePosition[position.tokenId];
        nft.safeTransferFrom(address(this), msg.sender, position.tokenId);
        emit Unstaked(positionId, msg.sender, position.tokenId, block.timestamp);
    }

    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata)
        external returns (bytes4)
    {
        require(msg.sender == address(nft) && receiving && operator == address(this)
            && from == expectedFrom && tokenId == expectedToken, "Unexpected NFT");
        receiving = false;
        return IERC721Receiver.onERC721Received.selector;
    }
}

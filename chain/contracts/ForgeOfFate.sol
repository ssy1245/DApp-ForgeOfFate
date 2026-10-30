// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ForgeOfFate is ERC721URIStorage, EIP712, ReentrancyGuard {
    struct Voucher { bytes32 weaponId; address recipient; uint256 level; string uri; uint256 deadline; bytes32 deploymentId; }
    struct Listing { address seller; uint256 price; }
    bytes32 public constant VOUCHER_TYPEHASH = keccak256("Voucher(bytes32 weaponId,address recipient,uint256 level,string uri,uint256 deadline,bytes32 deploymentId)");
    address public immutable mintSigner;
    bytes32 public immutable deploymentId;
    mapping(uint256 => uint256) public levels;
    mapping(uint256 => Listing) public listings;
    mapping(address => uint256) public proceeds;
    uint256[] private mintedTokens;
    event Forged(bytes32 indexed weaponId, uint256 indexed tokenId, address indexed recipient, uint256 level);
    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Unlisted(uint256 indexed tokenId);
    event Purchased(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price);

    constructor(address signer, bytes32 epoch) ERC721("Forge of Fate", "FATE") EIP712("ForgeOfFate", "1") {
        require(signer != address(0), "Invalid signer"); mintSigner = signer; deploymentId = epoch;
    }
    function mint(Voucher calldata v, bytes calldata signature) external nonReentrant returns(uint256 tokenId) {
        require(v.recipient == msg.sender, "Wrong recipient");
        require(v.deadline >= block.timestamp, "Expired voucher");
        require(v.deploymentId == deploymentId, "Wrong deployment");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, v.weaponId, v.recipient, v.level, keccak256(bytes(v.uri)), v.deadline, v.deploymentId)));
        require(ECDSA.recover(digest, signature) == mintSigner, "Invalid signature");
        tokenId = uint256(v.weaponId);
        require(_ownerOf(tokenId) == address(0), "Already minted");
        levels[tokenId] = v.level;
        mintedTokens.push(tokenId);
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, v.uri);
        emit Forged(v.weaponId, tokenId, msg.sender, v.level);
    }
    function exists(uint256 tokenId) external view returns(bool) { return _ownerOf(tokenId) != address(0); }
    function allTokens() external view returns(uint256[] memory) { return mintedTokens; }
    function list(uint256 tokenId, uint256 price) external {
        require(ownerOf(tokenId) == msg.sender, "Not owner"); require(price > 0, "Zero price");
        listings[tokenId] = Listing(msg.sender, price); emit Listed(tokenId, msg.sender, price);
    }
    function cancel(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "Not owner"); delete listings[tokenId]; emit Unlisted(tokenId);
    }
    function buy(uint256 tokenId, address expectedSeller, uint256 expectedPrice) external payable nonReentrant {
        Listing memory item = listings[tokenId];
        require(item.seller != address(0) && item.seller == expectedSeller && item.price == expectedPrice, "Listing changed");
        require(msg.value == item.price, "Wrong payment"); require(msg.sender != item.seller, "Own listing");
        require(ownerOf(tokenId) == item.seller, "Owner changed");
        delete listings[tokenId]; proceeds[item.seller] += msg.value;
        _safeTransfer(item.seller, msg.sender, tokenId, "");
        emit Purchased(tokenId, item.seller, msg.sender, msg.value);
    }
    function withdraw() external nonReentrant {
        uint256 value = proceeds[msg.sender]; require(value > 0, "No proceeds"); proceeds[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value:value}(""); require(ok, "Payment failed");
    }
    function _update(address to, uint256 tokenId, address auth) internal override returns(address) {
        address from = super._update(to, tokenId, auth);
        if (listings[tokenId].seller != address(0)) { delete listings[tokenId]; emit Unlisted(tokenId); }
        return from;
    }
}

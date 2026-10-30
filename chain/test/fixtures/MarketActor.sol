// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Test-only adversarial wallet. Compiled in memory; never included in deployment artifacts.
contract MarketActor {
    bool public rejectNFT;
    bool public rejectETH;
    address public target;
    bytes public nftAction;
    bytes public ethAction;
    uint256 public callbackValue;
    bool public callbackOK;
    bytes public callbackResult;

    function configure(address to, bytes calldata nft, bytes calldata eth, uint256 value, bool badNFT, bool badETH) external {
        target=to; nftAction=nft; ethAction=eth; callbackValue=value; rejectNFT=badNFT; rejectETH=badETH;
    }
    function invoke(address to, bytes calldata data) external payable returns(bytes memory) {
        (bool ok, bytes memory result)=to.call{value:msg.value}(data);
        if(!ok) assembly { revert(add(result,32),mload(result)) }
        return result;
    }
    function onERC721Received(address,address,uint256,bytes calldata) external returns(bytes4) {
        require(!rejectNFT,"NFT rejected");
        if(nftAction.length>0) (callbackOK,callbackResult)=target.call{value:callbackValue}(nftAction);
        return this.onERC721Received.selector;
    }
    receive() external payable {
        require(!rejectETH,"ETH rejected");
        if(ethAction.length>0) (callbackOK,callbackResult)=target.call(ethAction);
    }
}

import { useEffect, useState } from "react";
import React from 'react';
import { BrowserProvider, Contract, isAddress } from "ethers";
import {
  </XXXX>
} from "./contract.js";

export default function App() {
  const [walletAddr, setWalletAddr] = useState("");
  const [claimedNft, setClaimedNft] = useState(false);
  const [transactionId, setTransactionId] = useState("");
  const [hintText, setHintText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const contractConfigured = isAddress(CONTRACT_ADDRESS);

  let claimBtnText = "Claim NFT";
  if (claimedNft) claimBtnText = "NFT already claimed";
  if (isProcessing) claimBtnText = "Processing...";

  function getProvider() {
    </XXXX>
  }
  async function ensureSepolia() {
    </XXXX>
  }
  async function connectWallet() {
   </XXXX> 
  }
  async function mint() {
    </XXXX>
  }

  useEffect(() => {
    </XXXX>
    
  });

  return (
    <div style={{
      maxWidth: "600px",
      margin: "4rem auto",
      padding: "2rem",
      backgroundColor: "#f0f4f8",
      borderRadius: "16px",
      fontFamily: "sans-serif"
    }}>
      <h2 style={{color:"#1a202c"}}>Sepolia NFT Claim System</h2>
      <p style={{color:"#4a5568"}}>
        This DApp lets users claim one NFT ticket on Sepolia testnet.
      </p>

      {!contractConfigured && (
        <p style={{
          padding:"10px",
          backgroundColor:"#fff3cd",
          color:"#856404",
          borderRadius:"8px"
        }}>
          ⚠️ Warning: Please fill your deployed contract address in environment file first.
        </p>
      )}

      {!walletAddr ? (
        <button
          onClick={connectWallet}
          style={{
            padding:"10px 20px",
            backgroundColor:"#2b6cb0",
            color:"white",
            border:"none",
            borderRadius:"8px",
            fontSize:"16px",
            cursor:"pointer"
          }}
        >
          Link MetaMask Wallet
        </button>
      ) : (
        <div style={{marginTop:"16px"}}>
          <p style={{color:"#2d3748"}}>
            Wallet Connected: <strong>{shortAddress(walletAddr)}</strong>
          </p>
          <button
            onClick={mint}
            disabled={isProcessing || claimedNft || !contractConfigured}
            style={{
              marginTop:"8px",
              padding:"10px 20px",
              backgroundColor:"#38a169",
              color:"white",
              border:"none",
              borderRadius:"8px",
              fontSize:"16px",
              cursor:"pointer"
            }}
          >
            {claimBtnText}
          </button>
        </div>
      )}

      {hintText && (
        <p style={{marginTop:"16px", color:"#2d3748"}}>
          Status: {hintText}
        </p>
      )}

      {transactionId && (
        <a
          href={`${SEPOLIA_EXPLORER_URL}/tx/${transactionId}`}
          target="_blank"
          rel="noreferrer"
          style={{
            display:"inline-block",
            marginTop:"12px",
            color:"#2b6cb0"
          }}
        >
          Check transaction record: {shortAddress(transactionId)} →
        </a>
      )}

      <div style={{marginTop:"32px", paddingTop:"16px", borderTop:"1px solid #cbd5e0"}}>
        <h4>Workflow Overview</h4>
        <ul style={{paddingLeft:"20px", color:"#4a5568"}}>
          <li>Connect MetaMask wallet and switch to Sepolia</li>
          <li>Send transaction to NFT smart contract</li>
          <li>Wait for block confirmation on blockchain</li>
          <li>Each wallet can claim only one NFT</li>
        </ul>
      </div>
    </div>
  );
}
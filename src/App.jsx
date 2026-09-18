import PriceChart from "./PriceChart.jsx";
import PopularTokens from "./PopularTokens.jsx";
import { useEffect, useRef, useState } from "react";
import { BrowserProvider, formatEther } from "ethers";
import { describeConnectionError, findBrowserWallet } from "./wallet.js";

export default function App() {
  const [chartCoin, setChartCoin] = useState("bitcoin");
  const [walletAddress, setWalletAddress] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [networkLabel, setNetworkLabel] = useState("");
  const [balance, setBalance] = useState(null);
  const [chainVersion, setChainVersion] = useState(0);
  const [modelProvider, setModelProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const walletDialog = useRef(null);
  const connectionPending = useRef(false);
  const [walletAvailable, setWalletAvailable] = useState(false);
  const discoveredWallets = useRef([]);
  const [activeWallet, setActiveWallet] = useState(null);

  useEffect(() => {
    function handleAnnouncement(event) {
      const detail = event.detail;
      if (!detail?.provider?.request || !detail?.info?.uuid) return;
      if (!discoveredWallets.current.some(({ info }) => info.uuid === detail.info.uuid)) {
        discoveredWallets.current.push(detail);
      }
    }
    window.addEventListener("eip6963:announceProvider", handleAnnouncement);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", handleAnnouncement);
  }, []);

  async function connectWallet() {
    if (walletAddress) {
      if (!walletDialog.current.open) walletDialog.current.showModal();
      return;
    }
    if (connectionPending.current) return;

    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const wallet = findBrowserWallet(discoveredWallets.current, window.ethereum);
    setWalletAvailable(Boolean(wallet?.request));
    if (!wallet?.request) {
      setWalletError("No wallet extension is available on this page. Open this same URL in the browser profile where MetaMask is installed, allow the extension to access this site, then refresh. A wallet installed in a different browser cannot receive this request.");
      if (!walletDialog.current.open) walletDialog.current.showModal();
      return;
    }

    walletDialog.current.close();
    setActiveWallet(wallet);
    connectionPending.current = true;
    setIsConnecting(true);
    setWalletError("");

    try {
      // Request permission to connect the user's wallet.
      const accounts = await wallet.request({ method: "eth_requestAccounts" });
      if (!accounts[0]) {
        setWalletError("No account was shared. Please choose an account in your wallet and try again.");
        if (!walletDialog.current.open) walletDialog.current.showModal();
        return;
      }
      setWalletAddress(accounts[0]);
    } catch (error) {
      setWalletError(describeConnectionError(error));
      if (!walletDialog.current.open) walletDialog.current.showModal();
    } finally {
      connectionPending.current = false;
      setIsConnecting(false);
    }
  }

  useEffect(() => {
    const wallet = activeWallet;
    if (!wallet?.on) return;

    function handleAccountsChanged(accounts) {
      setWalletAddress(accounts[0] ?? "");
      setNetworkLabel("");
      setBalance(null);
      setWalletError("");
    }
    function handleChainChanged() {
      setNetworkLabel("");
      setBalance(null);
      setChainVersion((version) => version + 1);
    }
    function handleDisconnect() {
      handleAccountsChanged([]);
    }

    wallet.on("accountsChanged", handleAccountsChanged);
    wallet.on("chainChanged", handleChainChanged);
    wallet.on("disconnect", handleDisconnect);
    return () => {
      wallet.removeListener?.("accountsChanged", handleAccountsChanged);
      wallet.removeListener?.("chainChanged", handleChainChanged);
      wallet.removeListener?.("disconnect", handleDisconnect);
    };
  }, [activeWallet]);

  useEffect(() => {
    if (!walletAddress || !activeWallet) return;
    let cancelled = false;
    setNetworkLabel("");
    setBalance(null);
    setWalletError("");

    async function loadWalletDetails() {
      try {
        const provider = new BrowserProvider(activeWallet);
        const [network, value] = await Promise.all([
          provider.getNetwork(),
          provider.getBalance(walletAddress),
        ]);
        if (cancelled) return;
        const ethereumNetworks = {
          "1": "Ethereum Mainnet",
          "11155111": "Sepolia",
          "17000": "Holesky",
          "560048": "Hoodi",
        };
        const chainId = network.chainId.toString();
        setNetworkLabel(ethereumNetworks[chainId] ?? `Chain ${chainId}`);
        // Use a generic unit for unknown chains instead of assuming ETH.
        setBalance(`${formatEther(value)} ${ethereumNetworks[chainId] ? "ETH" : "native tokens"}`);
      } catch {
        if (!cancelled) {
          setNetworkLabel("Unavailable");
          setWalletError("Wallet connected, but network details could not be loaded. Try reconnecting from your wallet or refresh the page.");
        }
      }
    }
    loadWalletDetails();
    return () => { cancelled = true; };
  }, [walletAddress, chainVersion, activeWallet]);

  return (
    <div className="app">

        {/* =========================
             LEFT SIDEBAR
        ========================== */}

        <aside className="sidebar">

          <div className="logo">
            <div className="logo-icon">C</div>

            <div>
              <h2>ChainFlow</h2>
              <p>Build. Swap. Earn.</p>
            </div>
          </div>

          <nav className="nav">
            <a href="#" className="nav-item active">⌂ &nbsp; Home</a>
            <a href="#" className="nav-item">⇄ &nbsp; Swap</a>
            <a href="#" className="nav-item">💧 &nbsp; Pool</a>
            <a href="#" className="nav-item">▣ &nbsp; Earn</a>
            <a href="#" className="nav-item">▧ &nbsp; NFT</a>
            <a href="#" className="nav-item">🌉 &nbsp; Bridge</a>
            <a href="#" className="nav-item">🏛 &nbsp; Governance</a>
            <a href="#" className="nav-item">☷ &nbsp; Docs</a>
          </nav>

          <div className="sidebar-bottom">
            A more open<br />
            on-chain future.
          </div>

        </aside>

        {/* =========================
             MAIN CONTENT
        ========================== */}

        <main className="main">

          <PriceChart coin={chartCoin} onCoinChange={setChartCoin} />

          {/* ECOSYSTEM */}

          <section className="ecosystem">

            <h2>Explore the Ecosystem</h2>

            <p className="ecosystem-description">
              Everything you need in one place.
              Simple. Secure. Decentralized.
            </p>

            <div className="feature-grid">

              <div className="feature-card">
                <div className="feature-icon">⇄</div>
                <h3>Swap</h3>
                <p>
                  Swap tokens instantly with the best rates.
                </p>
                <a href="#" className="feature-link">
                  Start Swapping →
                </a>
              </div>

              <div className="feature-card">
                <div className="feature-icon">💧</div>
                <h3>Pool</h3>
                <p>
                  Provide liquidity and earn fees.
                </p>
                <a href="#" className="feature-link">
                  Provide Liquidity →
                </a>
              </div>

              <div className="feature-card">
                <div className="feature-icon">🌱</div>
                <h3>Earn</h3>
                <p>
                  Stake tokens and earn rewards.
                </p>
                <a href="#" className="feature-link">
                  Start Earning →
                </a>
              </div>

              <div className="feature-card">
                <div className="feature-icon">🖼</div>
                <h3>NFT</h3>
                <p>
                  Discover and trade unique assets.
                </p>
                <a href="#" className="feature-link">
                  Explore NFTs →
                </a>
              </div>

              <div className="feature-card">
                <div className="feature-icon">🌉</div>
                <h3>Bridge</h3>
                <p>
                  Move assets across chains seamlessly.
                </p>
                <a href="#" className="feature-link">
                  Start Bridging →
                </a>
              </div>

              <div className="feature-card">
                <div className="feature-icon">🏛</div>
                <h3>Governance</h3>
                <p>
                  Participate in the future of the protocol.
                </p>
                <a href="#" className="feature-link">
                  View Proposals →
                </a>
              </div>

            </div>

          </section>

        </main>

        {/* =========================
             RIGHT PANEL
        ========================== */}

        <aside className="right-panel">

          <div className="top-connect">
            <button
              className={`primary-btn${walletAddress ? " wallet-connected" : ""}`}
              onClick={connectWallet}
              disabled={isConnecting}
              aria-haspopup="dialog"
              title={walletAddress || "Connect your browser wallet"}
            >
              {isConnecting
                ? "Connecting..."
                : walletAddress
                  ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
                  : "Connect Wallet"}
            </button>
          </div>

          {/* WALLET */}

          <section className="panel-card" aria-labelledby="wallet-heading">
            <div className="panel-title">
              <h3 id="wallet-heading">My Wallet</h3>
              <span className={`badge${walletAddress ? " badge-connected" : ""}`}>
                {walletAddress ? "Connected" : "Not Connected"}
              </span>
            </div>
            <p className="wallet-text">
              {walletAddress
                ? "Your wallet stays in control of every transaction."
                : "Use Connect Wallet above to view your account."}
            </p>
            {isConnecting && (
              <p className="connection-pending" role="status">
                Check your wallet extension for the authorization request. If it is hidden, open it from your browser toolbar.
              </p>
            )}
            <dl className="wallet-details" aria-live="polite">
              <div>
                <dt>Account</dt>
                <dd title={walletAddress || undefined}>
                  {walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : "—"}
                </dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>{walletAddress ? networkLabel || "Loading..." : "—"}</dd>
              </div>
              <div>
                <dt>Balance</dt>
                <dd>{walletAddress ? balance ?? (networkLabel === "Unavailable" ? "—" : "Loading...") : "—"}</dd>
              </div>
            </dl>
            {walletError && <p className="wallet-error" role="alert">{walletError}</p>}
          </section>

          {/* AGENT SETTINGS */}

          <section className="panel-card" aria-labelledby="agent-settings-heading">
            <div className="panel-title">
              <h3 id="agent-settings-heading">Agent Settings</h3>
              <span className="badge">BYOK</span>
            </div>
            <p className="wallet-text">Bring your own API key to power your agent.</p>
            <div className="agent-fields">
              <label htmlFor="model-provider">Model provider</label>
              <select
                id="model-provider"
                value={modelProvider}
                onChange={(event) => {
                  setModelProvider(event.target.value);
                  setModel("");
                  setApiKey("");
                }}
              >
                <option value="">Select a provider</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="deepseek">DeepSeek</option>
              </select>
              <label htmlFor="agent-model">Model ID</label>
              <input
                id="agent-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="Enter your model ID"
                spellCheck={false}
                autoComplete="off"
              />
              <div className="field-label-row">
                <label htmlFor="agent-api-key">API key</label>
                <button
                  type="button"
                  className="clear-key-btn"
                  onClick={() => setApiKey("")}
                  disabled={!apiKey}
                >
                  Clear key
                </button>
              </div>
              <input
                id="agent-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="Enter your model API key"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="api-key-note"
              />
            </div>
            <p id="api-key-note" className="settings-note">
              Kept in page memory only and cleared on refresh. Never enter your wallet private key or recovery phrase.
            </p>
            <button className="agent-test-btn" disabled aria-describedby="agent-availability">
              Test Connection
            </button>
            <p id="agent-availability" className="settings-note">
              Model connections are coming soon. These settings are not sent anywhere yet.
            </p>
          </section>

          <PopularTokens selectedCoin={chartCoin} onSelectCoin={setChartCoin} />

        </aside>

        <dialog
          ref={walletDialog}
          className="wallet-drawer"
          aria-labelledby="wallet-dialog-heading"
          aria-describedby="wallet-dialog-description"
          onClick={(event) => {
            if (event.target === event.currentTarget) walletDialog.current.close();
          }}
        >
          <div className="wallet-drawer-content">
            <header className="wallet-drawer-header">
              <span className="badge">Wallet connection</span>
              <button
                type="button"
                className="drawer-close"
                aria-label="Close wallet panel"
                onClick={() => walletDialog.current.close()}
              >×</button>
            </header>
            <div className="wallet-drawer-icon" aria-hidden="true">◈</div>
            <h2 id="wallet-dialog-heading">
              {walletAddress ? "Wallet connected" : isConnecting ? "Check your wallet" : "Connect your wallet"}
            </h2>
            <p id="wallet-dialog-description" className="wallet-text">
              {walletAddress
                ? "Your account is connected to ChainFlow."
                : isConnecting
                  ? "Approve the account access request in your wallet extension. If no window appears, open the extension from your browser toolbar."
                  : "Authorize ChainFlow to view your public wallet address. Approval takes place in your wallet, not on this page."}
            </p>
            <div aria-live="polite">
              {isConnecting && <p className="connection-pending">Waiting for wallet approval...</p>}
              {walletAddress && <p className="connected-account">{walletAddress}</p>}
              {walletError && <p className="wallet-error" role="alert">{walletError}</p>}
            </div>
            <div className="wallet-drawer-actions">
              {walletAddress ? (
                <button className="primary-btn" onClick={() => walletDialog.current.close()}>Done</button>
              ) : !walletAvailable ? (
                <>
                  <a className="primary-btn" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Get MetaMask ↗</a>
                  <button className="secondary-btn" onClick={connectWallet}>Check Again</button>
                </>
              ) : (
                <button className="primary-btn" onClick={connectWallet} disabled={isConnecting}>
                  {isConnecting ? "Waiting for approval..." : "Try Again"}
                </button>
              )}
            </div>
            <p className="settings-note">
              Connecting does not send a transaction. Never enter a recovery phrase or private key here.
            </p>
            {isConnecting && <p className="settings-note">Closing this panel does not cancel the request in your wallet.</p>}
          </div>
        </dialog>

      </div>
  );
}

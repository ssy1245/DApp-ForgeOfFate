export default function App() {
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

          {/* HERO */}

          <section className="hero">

            <div className="hero-small">
              DECENTRALIZED · OPEN · FOR EVERYONE
            </div>

            <h1>
              Trade. Earn. Build.<br />
              <span className="purple-text">Onchain</span>
              Together.
            </h1>

            <p className="hero-description">
              A simple and powerful DeFi platform for everyone.
              Swap tokens, earn yield, and explore Web3.
            </p>

            <div className="hero-buttons">
              <button className="primary-btn">
                Get Started →
              </button>

              <button className="secondary-btn">
                Learn More
              </button>
            </div>

          </section>

          {/* STATISTICS */}

          <section className="stats">

            <div className="stat-card">
              <div className="stat-title">Total Value Locked</div>
              <div className="stat-value">$12.48M</div>
              <div className="positive">↑ 12.3%</div>
            </div>

            <div className="stat-card">
              <div className="stat-title">Total Users</div>
              <div className="stat-value">25,361</div>
              <div className="positive">↑ 8.6%</div>
            </div>

            <div className="stat-card">
              <div className="stat-title">Total Volume</div>
              <div className="stat-value">$86.72M</div>
              <div className="positive">↑ 21.4%</div>
            </div>

            <div className="stat-card">
              <div className="stat-title">Protocol Revenue</div>
              <div className="stat-value">$124.6K</div>
              <div className="positive">↑ 15.7%</div>
            </div>

          </section>

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
            <button className="primary-btn">
              Connect Wallet
            </button>
          </div>

          {/* WALLET */}

          <div className="panel-card">

            <div className="panel-title">
              <h3>My Wallet</h3>
              <span className="badge">Not Connected</span>
            </div>

            <p className="wallet-text">
              Connect your wallet to access all features.
            </p>

            <button className="wallet-btn">
              Connect Wallet
            </button>

          </div>

          {/* SWAP */}

          <div className="panel-card">

            <div className="panel-title">
              <h3>Swap</h3>
              <span>⚙</span>
            </div>

            <div className="token-label">
              <span>From</span>
              <span>Balance: 0.0</span>
            </div>

            <div className="token-box">
              <span className="token">
                ◈ ETH⌄
              </span>

              <span className="amount">
                0.0
              </span>
            </div>

            <div className="swap-arrow">
              ⇅
            </div>

            <div className="token-label">
              <span>To</span>
              <span>Balance: 0.0</span>
            </div>

            <div className="token-box">
              <span className="token">
                ◉ USDC⌄
              </span>

              <span className="amount">
                0.0
              </span>
            </div>

            <button
              className="wallet-btn swap-connect-btn"
            >
              Connect Wallet
            </button>

          </div>

          {/* POPULAR TOKENS */}

          <div className="panel-card">

            <div className="panel-title">
              <h3>Popular Tokens</h3>
              <span className="view-all-link">
                View All →
              </span>
            </div>

            <div className="token-row">

              <div className="token-info">
                <div className="coin">ETH</div>

                <div>
                  <div className="token-name">ETH</div>
                  <div className="token-full-name">Ethereum</div>
                </div>
              </div>

              <div className="price">
                $3,248.12
                <div className="price-change">+2.4%</div>
              </div>

            </div>

            <div className="token-row">

              <div className="token-info">
                <div className="coin">$</div>

                <div>
                  <div className="token-name">USDC</div>
                  <div className="token-full-name">USD Coin</div>
                </div>
              </div>

              <div className="price">
                $1.00
                <div className="price-change">+0.01%</div>
              </div>

            </div>

            <div className="token-row">

              <div className="token-info">
                <div className="coin">D</div>

                <div>
                  <div className="token-name">DAI</div>
                  <div className="token-full-name">Dai Stablecoin</div>
                </div>
              </div>

              <div className="price">
                $1.00
                <div className="price-change">+0.00%</div>
              </div>

            </div>

            <div className="token-row">

              <div className="token-info">
                <div className="coin">₿</div>

                <div>
                  <div className="token-name">WBTC</div>
                  <div className="token-full-name">
                    Wrapped Bitcoin
                  </div>
                </div>
              </div>

              <div className="price">
                $68,421.20
                <div className="price-change">+1.8%</div>
              </div>

            </div>

          </div>

        </aside>

      </div>
  );
}

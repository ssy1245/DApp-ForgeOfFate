# Forge of Fate

[简体中文](README.md) | **English**

A weapon forging and NFT demonstration built with React / Three.js, FastAPI / SQLite, and Solidity. Players upgrade weapons in a 3D workshop, seal them at their final form, mint them as NFTs, and trade or stake them. The default network is **Ethereum Sepolia (11155111)**.

**Game coins are recorded by the server. No ERC-20 token is issued, and coins cannot be converted back to ETH. All amounts, probabilities, and exchange rates are test settings; the economy is still experimental.**

[Architecture](#architecture) · [Quick start](#quick-start) · [Setup with Codex](#setup-with-codex) · [Independent deployment](#deployment-and-manual-demonstration) · [Game rules](#gameplay-and-balance) · [Testing](#testing-and-verification)

## Architecture

The project has three main layers: **frontend interaction, backend services, and smart contracts**. The backend manages forging, accounts, and game coins. Smart contracts record NFT ownership, trading, and staking. The frontend brings these together in an interactive 3D workshop.

| Layer | Technologies | Responsibilities | Code |
|---|---|---|---|
| Frontend | React, TypeScript, Three.js | Render the workshop and trading interface, handle player actions, connect to MetaMask | `frontend/src/` |
| Backend and saves | FastAPI, Python, SQLite | Accounts and wallet binding, forging rules, coin balances, concurrent NFT purchase locks, rewards and mail | `backend/` |
| On-chain assets and payments | Solidity, Ethereum Sepolia | Three business contracts for NFTs and trading, NFT staking, and test ETH deposits | `chain/contracts/` |
| Blockchain synchronization | Python, Web3.py, persistent tasks | Track transactions and events, wait for finality, then update saves, rewards, and recharge credits | `chain/server/` |

**How the components work together:** the player forges a weapon in the frontend → the backend validates the rules and saves progress → an eligible sealed weapon is minted through a wallet transaction → the NFT can be traded or staked → the synchronization service reads confirmed results and updates the game and rewards. The wallet signs and sends transactions; the backend verifies and synchronizes their outcomes.

```text
dapp/
├── frontend/       # 3D workshop, marketplace, staking, recharge, and mailbox
├── backend/        # Game rules, accounts, saves, purchase locks, and rewards
├── chain/          # Blockchain components
│   ├── contracts/  # NFT/marketplace, staking, and recharge contracts
│   ├── client/     # Browser transaction records and reload recovery
│   ├── server/     # Wallet verification, chain reads, indexing, and task tracking
│   └── scripts/    # Deployment, listener startup, and local rehearsals
├── assets/         # Weapon models, artwork, NFT image configuration, and stories
├── deployments/    # Public Sepolia deployment manifests
├── docs/           # Game rules, database, and module documentation
├── scripts/        # Startup, test account provisioning, and full test entry point
└── tests/          # Game browser tests; modules also have their own test directories
```

See the [complete directory map](#complete-directory-map) for individual file responsibilities. The following sections cover implemented features, setup, business rules, and verification.

## Implemented Features

Feature summary updated **2026-11-03**.

| Module | Current capabilities |
|---|---|
| 3D workshop | Claim a sword into the player's hand, heat and strike it, display cabinets, chest storage, live level/recycle value/probability display, Chinese/English UI |
| Weapons and economy | Three routes, one-time probabilistic mutations, route level limits, weapon-dependent costs, wards, recycling, and coin-funded supplies |
| Accounts and saves | Registration and login, passwords of 8–20 characters, one wallet per account, server-side signature verification, separate saves, test account tools |
| NFT / marketplace | Seal final forms, mint, list/change price/cancel, concurrent purchase locks, seller ETH withdrawals; remove sold cards and notify the seller |
| Staking / mailbox | Single-token approval, staking and retrieval; UTC daily rewards proportional to actual duration, downtime catch-up, unread indicators, individual and bulk collection |
| Recharge / administration | Test ETH deposits, backend coin conversion, deposit history, administrator withdrawals, and root-admin management of other admins |
| Chain synchronization | On-demand synchronization of three contracts, 30-second task checks, persistent progress, finality, deduplication, downtime recovery, collapsible history |
| Transaction recovery | Reload recovery for known hashes, duplicate submission controls, wallet/network/deployment identity checks |

All three business contracts have been deployed to Sepolia and reached finality. **The listed demonstration scenarios have been completed**, including daily staking reward delivery, NFT retrieval, administrator withdrawals, and adding/removing administrators. See [Testing and verification](#testing-and-verification) for the scope and evidence.

Remaining work includes replacement/cancellation detection, recovery when a broadcast returns no hash, a unified game-coin ledger, and acceptance testing on a fresh machine. See the [test record](chain/测试与交易审查记录.md) and [development plan](chain/链上功能与开发计划.md). These linked module documents are currently in Chinese.

## Setup with Codex

You can give Codex the following request:

> Read the README and follow Quick start to configure and launch the project. Use the public demonstration contracts by default, preserving existing configuration, keys, and saves. Install dependencies, prepare configuration, compile, provision the test account, start the game and listener, and check their health. I will enter the RPC URL locally; do not ask for my wallet private key. Reuse an existing environment without overwriting it with the public demonstration configuration. Finally, report the game URL, listener status, and any steps I still need to complete.

- **Codex can handle:** checking Node/Python versions, installing locked dependencies, preparing local configuration and public manifests, setting test rates, provisioning local test accounts, launching services, and checking the API and listener. If the RPC URL is missing, offline setup can proceed first.
- **You complete:** entering a full Sepolia RPC URL, connecting your wallet, and approving signatures or transactions. Deployment and transactions require Sepolia test ETH in that wallet.
- **Only the RPC URL needs manual input on the default path:** the preparation script below uses the public manifest's deployer address for startup checks and sets the test reward rate. It does not bind a game account or grant contract permissions.
- **To reproduce minting and administrator operations independently:** use the independent deployment path with your own project wallet. Codex can prepare the deployment console; you approve wallet requests. Do not regenerate `mint-key` for an existing shared contract.

## Quick Start

Run all commands from the repository root containing `package.json`. macOS and Linux are supported; use WSL on Windows. The version baseline is **Node.js 24.21.0 and Python 3.13.9**, recorded in [`.nvmrc`](.nvmrc) and [`.python-version`](.python-version). Wallet operations require a browser with MetaMask.

### 1. Install dependencies

```sh
node --version
python3.13 --version
npm ci
python3.13 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock.txt
npm run compile -w chain
npm run build
```

If `python3` is already version 3.13, it can replace `python3.13`. Check the Python version of an existing `.venv` and reuse it if compatible; do not overwrite an incompatible environment. With nvm, run `nvm install` and `nvm use` first if needed. Install Node dependencies once at the root; separate frontend/backend installations are unnecessary.

### 2. Choose a configuration path

| Path | Available workflows | Boundaries |
|---|---|---|
| **A: public demonstration contracts, default** | Game, wallet binding, trading/staking existing NFTs, recharge | No mint authorization key for the shared contract; deposits go to its fixed project wallet, and importing manifests grants no admin permissions |
| **B: independent deployment** | Complete flow from minting a new weapon to trading, staking, recharge, and administration | Uses your project wallet, signatures, and test gas; see [Independent deployment](#deployment-and-manual-demonstration) |

**Path A:** run the following preparation script in a fresh project directory. It makes no network requests or deployments and does not overwrite existing files. It stops if a different deployment manifest is present. For an existing save, verify the environment first; replacing contract addresses alone is insufficient.

```sh
node <<'NODE'
const fs = require('node:fs');
const directory = '.local/sepolia';
const files = [
  ['deployments/sepolia-demo.json', 'deployment.json'],
  ['deployments/staking-sepolia-demo.json', 'staking-deployment.json'],
  ['deployments/recharge-sepolia-demo.json', 'recharge-deployment.json'],
];
for (const [source, name] of files) {
  const target = `${directory}/${name}`;
  if (fs.existsSync(target) && !fs.readFileSync(source).equals(fs.readFileSync(target))) {
    throw Error(`Existing configuration preserved: ${target} differs from the public manifest. Reuse the existing environment or use a fresh directory.`);
  }
}
if (!fs.existsSync('.env.sepolia')) {
  const {deployer} = JSON.parse(fs.readFileSync(files[0][0], 'utf8'));
  const template = fs.readFileSync('.env.sepolia.example', 'utf8')
    .replace(/^PROJECT_WALLET_ADDRESS=.*$/m, `PROJECT_WALLET_ADDRESS=${deployer}`)
    .replace(/^FORGE_STAKING_COINS_PER_DAY=.*$/m, 'FORGE_STAKING_COINS_PER_DAY=1000');
  fs.writeFileSync('.env.sepolia', template, {flag: 'wx', mode: 0o600});
}
fs.mkdirSync(directory, {recursive: true, mode: 0o700});
for (const [source, name] of files) {
  if (!fs.existsSync(`${directory}/${name}`)) fs.copyFileSync(source, `${directory}/${name}`, fs.constants.COPYFILE_EXCL);
}
console.log('Preparation complete; existing configuration was preserved. Enter the RPC URL in .env.sepolia and check the reward settings.');
NODE
```

**Path B:** skip the public manifest import. Run `cp -n .env.sepolia.example .env.sepolia` only if `.env.sepolia` does not exist, configure your project wallet as described below, and follow the independent deployment steps. Do not mix both paths with the same existing save.

### 3. Set the RPC URL and check parameters

Edit only your local `.env.sepolia`; never commit its actual contents. The required endpoint is your RPC provider's **full Ethereum Sepolia HTTP(S) node URL**. A bare API key, block explorer URL, or mainnet node is unsuitable. The provider must support `finalized`, historical deployment receipts, and `eth_getLogs`.

| Parameter | Setting |
|---|---|
| `SEPOLIA_RPC_URL` | **Enter this yourself:** the provider's complete Sepolia endpoint URL |
| `PROJECT_WALLET_ADDRESS` | Path A fills the public deployer address for startup checks. Path B uses your MetaMask public address, matching the deployment wallet |
| `FORGE_STAKING_COINS_PER_DAY` | `1000` for the demonstration; the original template uses `0`. Adjust an existing configuration before staking is first indexed |
| `FORGE_RECHARGE_WEI_PER_UNIT` / `FORGE_RECHARGE_COINS_PER_UNIT` | `10000000000000000` / `10000`: 0.01 test ETH converts to 10,000 coins |
| `FORGE_INDEX_BATCH` | Default `500` blocks per batch; reduce it if the provider limits log ranges. Task checks use a fixed `30` seconds; `FORGE_INDEX_INTERVAL` is retired |
| `DEMO_BUYER_ADDRESS` | Optional public address of a second demonstration wallet; not required for basic startup |

No OpenAI API key, GitHub token, wallet private key, or recovery phrase is required. NFT artwork uses the repository's [public image configuration](assets/NFT_Pic/manifest.json). Restart the relevant services after changing settings. Staking and recharge rates are fixed when a source is first registered; do not overwrite rates attached to existing history.

```sh
npm run check:sepolia
```

A pass confirms the network and `finalized` query. Historical log access still needs verification by the listener. If the RPC URL is not ready, offline checks such as `npm run build` and `npm run test:i18n -w frontend` can run first.

### 4. Provision a local account and start

```sh
npm run accounts:setup
npm run start:demo
```

| URL | Purpose |
|---|---|
| **http://127.0.0.1:5173/** | Game: login, wallet binding, trading, staking, and recharge |
| http://127.0.0.1:8000/api/health | Backend health check |
| http://127.0.0.1:5174/deploy | Independent deployment console only; launch separately with `npm run deploy:console` |

The launcher starts the frontend and backend. If an NFT deployment manifest exists, it also starts the on-demand synchronization worker. **Do not start a second listener.** Use `npm start` for normal mode without the test menu. Use `127.0.0.1` consistently; mixing it with `localhost` can separate login state and wallet permissions.

Press Ctrl+C in the startup terminal to stop these services while retaining saves. Next time, run `npm run start:demo` or `npm start` again; installation, configuration copying, and deployment do not need repeating. If a port is occupied, identify the old service's environment first. The deployment console also uses ports `5174` and `8010`.

### 5. Verify startup

Keep the game terminal running and execute this in another terminal:

```sh
node <<'NODE'
(async () => {
  const get = async path => {
    const r = await fetch(`http://127.0.0.1:5173/api/${path}`);
    if (!r.ok) throw Error(`${path}: HTTP ${r.status}`);
    return r.json();
  };
  const health = await get('health'), config = await get('config'), sync = await get('chain/status');
  if (!health.ok || config.network?.chainId !== 11155111) throw Error('Backend or network mismatch');
  if (!config.chain || !config.staking || !config.recharge) throw Error('Not all three contracts are connected. Check the public manifests or independent deployment progress.');
  console.log({network: config.network.chainName, nft: config.chain.address,
    staking: config.staking.address, dailyCoins: config.staking.dailyCoins,
    recharge: config.recharge.address, rechargeReady: config.recharge.ready,
    listener: sync.state, running: sync.running, caughtUp: sync.caughtUp});
})().catch(e => {console.error(e.message); process.exitCode = 1;});
NODE
```

Expect all three contract addresses. Once synchronization catches up, expect `running: true`, `caughtUp: true`, `listener: idle` (or `ready` / `syncing` while tasks are active), `dailyCoins: 1000`, and `rechargeReady: true`. An initial `syncing` state is normal during catch-up; check again later. An independent environment with only some contracts deployed can still run the game; complete this full check after all three deployments finish.

Logs are `.local/sepolia/backend.log`, `frontend.log`, and `indexer.log`. In test mode, open Marketplace → Chain status for synchronization details. A working game page confirms frontend availability; inspect listener status separately.

### Player and test accounts

`accounts:setup` creates the local `forge_test` account and saves credentials in `.local/sepolia/test-accounts.md`. Repeated runs preserve existing passwords, bindings, and saves. `npm run accounts:setup -- --with-player` also creates the optional `forge_player` account. Normal players can register through the page. The repository does not include the original environment's user database or wallet bindings.

The test menu requires **demo mode and the `tester` role**. It can add resources, create weapons from all three routes, and modify the account's unsealed weapons. Created or modified weapons retain the DEMO marker. The test role grants no recharge-contract administrator permissions.

### Wallet binding and payments

Sign in → connect the intended MetaMask wallet → sign the binding message. Binding costs no gas and authorizes no transfer. Each account and wallet has one unique association; rebinding is currently unavailable. Switching MetaMask wallets does not switch the game account; check the address shown as the wallet connected to the site. Transactions require separate wallet confirmation and test gas. Actions are disabled when the network or account does not match.

## Deployment and Manual Demonstration

Use another fresh project directory, install dependencies, configure the RPC URL, and set your own `PROJECT_WALLET_ADDRESS` and `FORGE_STAKING_COINS_PER_DAY=1000`. **Do not import the public manifests.** Fund the project wallet with Sepolia test ETH, then proceed in order:

| Step | Command | Files saved after finality |
|---|---|---|
| 1. NFT / marketplace | `npm run deploy:console` | `.local/sepolia/deployment.json` and the local `mint-key` |
| 2. Staking | `npm run deploy:staking` | `.local/sepolia/staking-deployment.json`, linked to the NFT from step 1 |
| 3. Recharge | `npm run deploy:recharge` | `.local/sepolia/recharge-deployment.json`, with the project wallet as the fixed treasury |

For each step, open `http://127.0.0.1:5174/deploy`, check the contract and wallet, and confirm through MetaMask. Wait until the console reports that the record was saved, then **press Ctrl+C to close that console before starting the next one**. They share the same ports. Deployment plans support recovery; do not delete records and redeploy to retry. After all three finish, run `npm run accounts:setup` and `npm run start:demo`. Restart the game if it is already running.

Public contract addresses, ABIs, deployment blocks, and identities are in [deployments](deployments/README.md). Shared manifests contain no mint authorization private key, and a new key cannot authorize minting on an old contract. See the [deployment console guide](chain/合约部署工作台.md) for deployment and recovery details.

## Gameplay and Balance

| Action | Current test rules |
|---|---|
| Daily supplies | 200 iron, 5 wards, and 3 separately claimed +0 swords; resets at 00:00 UTC. A newly claimed sword goes directly into the player's hand |
| New swords / shop | Forge a sword for 10 iron; buy a +0 sword for 2,500 coins; 20 iron costs 5,000 coins; one ward costs 2,500 coins |
| Heating / striking | Heating costs 2 iron and enables 5 strikes after 3 seconds. A basic-stage strike costs 2 iron; Knight Sword costs 4 from +10, Rapier costs 3 from +5, and Greatsword costs 7 from +10 |
| Automatic mutation | When a Knight Sword first reaches or crosses +5, it has a 30% chance to become a +5 Rapier. If still a Knight Sword when it first reaches or crosses +10, it has a 30% chance to become a +10 Greatsword |
| Mutation boundaries | At most two milestone checks per weapon; jumps from great success do not skip checks, and regaining a lost level does not reroll. Rapier/Greatsword routes are permanent; failed checks show no popup |
| Maximum / sealing level | Knight Sword +90 / +80; Rapier +80 / +70; Greatsword +70 / +60. Before final form, the available disposal option is in-game recycling |
| Wards | Enable with Q or the toggle. One ward is consumed only when it prevents destruction; downgrades can still occur. Stage protection consumes no ward |

The backend calculates costs from the weapon's stage before each strike. Upgrades, mutations, and downgrades update the next strike's cost. Returning to the basic stage restores the 2-iron cost while retaining the weapon's route identity. Probabilities appear in the order Great success → Success → Downgrade → Destruction, with green for great success and red for destruction. Heating and strike costs are shown separately. Recycling values are defined in `backend/balance.json` and are independent of NFT market prices.

Storage is free and preserves levels, heat, and protection progress. The card's Return to workshop / Take out and forge action focuses the 3D interaction area. Use WASD to move, the mouse to look, E to pick up/place items, and Esc to pause and release the pointer. See [Game rules and assets](docs/游戏规则与素材.md) for models, artwork, stories, and detailed rules.

## NFT and Trading Rules

Sealing is permanent and prevents further upgrades. A minted NFT can remain in the wallet without being listed. Purchased NFTs appear in My collection and **cannot be converted back into upgradable game weapons**. The in-game gifting interface has been removed; standard on-chain NFT transfers remain available.

When a buyer requests a purchase, the backend checks the on-chain listing and obtains a persistent SQLite lock scoped to the network, deployment, and NFT ID. Only one buyer can enter the wallet purchase flow for that NFT at a time; competing requests receive a conflict. Different NFTs can be purchased independently, and locks survive server restarts. Preparation reservations expire after five minutes. Once wallet submission begins, time alone does not release the lock. Explicit wallet rejection or a failure before submission releases it. After a hash is returned, the backend verifies purchase parameters and follows finality, then releases the lock after successful synchronization or a finalized failure. A checking timeout does not establish failure and does not release the lock.

If the wallet request is interrupted without returning a transaction hash, the purchase lock remains. Verify the wallet transaction before resolving it; do not delete the lock or pay again. This lock coordinates purchases through this application. Direct contract calls can bypass it, so the contract separately checks the seller, price, and ownership, and removes a listing after sale to prevent duplicate settlement.

Listing, repricing, and cancellation retain ownership. A purchase changes ownership; after finality, the seller's original sealed weapon is archived and a sale notification is sent. Withdraw in the marketplace collects seller proceeds. Recharge administrator withdrawals use a separate interface.

## NFT Staking and Daily Rewards

Use My collection → Stake NFT or the NFT staking view: **approve one NFT → confirm staking**, with a separate confirmation for each step. Approval alone earns no rewards. The contract holds the staked NFT, which cannot simultaneously be sold. Retrieve NFT returns it to the bound wallet and preserves previously earned rewards.

Listed NFTs have no staking button and are excluded from the available-to-stake list. Cancel the listing and wait for confirmation before staking. The application checks listing status again before submitting an approval or stake.

The demonstration rate is **1,000 coins per NFT per day**, prorated by effective staking seconds within each UTC calendar day. After the daily boundary at 08:00 Beijing time, the previous day's mail is delivered once the relevant chain history is finalized. Downtime recovery uses confirmed events and saved settlement progress to catch up without duplicate rewards. See the [staking guide](docs/质押合约.md).

## Reward Mailbox

Mail displays a count and unread indicators. Opening reward mail marks it as read; individual or bulk collection credits coins and removes it from the inbox. Collect all includes all reward mail and leaves sale notifications intact. The backend retains delivery and claim records, preventing duplicate credits from repeated clicks or retries. See the [mailbox guide](docs/奖励邮箱.md).

## Test ETH Recharge

Top up coins supports amount entry, wallet payment, automatic credit after finality, and deposit history. The default rate is **0.01 test ETH = 10,000 game coins**. Gas is excluded from the conversion. Amounts smaller than one coin carry forward to subsequent deposits from the same wallet. Withdrawal and administrator events do not issue coins.

### Administrator withdrawal of recharge income

Open Top up coins → Administrator withdrawal, enter an amount or select the full balance, check the fixed recipient, and confirm through the wallet. Contract funds can only reach the `treasury` fixed at deployment. The submitting wallet pays gas separately; player coins are unchanged. A normal game account sees this interface only after receiving **on-chain administrator permission**.

The fixed project wallet is the non-removable root administrator. It can add or remove other administrators, with a maximum of 32 including itself. Other administrators can withdraw funds but cannot change permissions. This version cannot replace the root administrator or treasury; server configuration does not alter on-chain permissions. Shared recharge contracts retain the treasury in the public manifest. Deploy your own contract for independent administration.

Suggested verification sequence: deposit credit → small withdrawal → compare contract balance, treasury balance, and player coins → add another administrator → delegated withdrawal → reject operations after revocation → restart and verify no duplicate credit. Test ETH has no real economic value, and these parameters do not represent a mature economic model.

## Synchronization, Saves, and Recovery

**Pages read on demand. Unfinished background tasks are checked every 30 seconds; chain queries stop when those tasks finish.** Triggers are:

| Trigger | Query and processing behaviour |
|---|---|
| Enter the marketplace or select Refresh status there | Read one NFT/listing snapshot immediately, then stop. Browsing does not require wallet binding |
| An account with a bound wallet enters marketplace, staking, recharge, or mailbox, or refreshes those views | Coalesce a background synchronization request for the relevant contracts to catch up confirmed records. Process at 30-second intervals until complete |
| A purchase, recharge, stake, retrieval, or other transaction returns a hash | Save the task on the server and check confirmation and follow-up work every 30 seconds. Processing continues after the page closes |
| Staking rewards become due after 00:00 UTC (08:00 Beijing time) | Trigger staking synchronization, read confirmed events including withdrawals, then award the actual elapsed interval |
| First use of a new deployment / server restart | Run initial catch-up for a new deployment; on restart, resume unfinished tasks and due rewards from saved progress |

**Leaving the marketplace open does not periodically refresh its listings.** Select Refresh status or re-enter the marketplace to see new listings, sales, or external wallet actions. My collection / Listed market filters the existing snapshot. Staking positions and administrator balances update on entry, manual refresh, or completed operations. Diagnostics update on explicit checks. Configuration, history, and registered-task receipt queries read local data without continuously querying RPC. External events are caught up during the next relevant background synchronization, so idle operation does not guarantee immediate discovery.

Unknown or replaced transaction hashes are automatically checked for up to 24 hours, then paused. Check pending transaction can resume verification; the pause does not mean it is safe to pay again. Tasks, check intervals, and scan cursors persist in the database. Reloads, multiple tabs, and restarts do not accelerate background polling or duplicate credits. Backlogs are processed in ranges, with at most 20 batches per wake-up, without stepping through every empty block.

The listener queries events for the specified contracts by block range and advances progress through empty ranges. Sepolia processing uses the RPC **`finalized` boundary**. When a wallet shows inclusion in a block, the game may still be waiting for finality; do not pay again. Known hashes persist in the browser and server task table. Reloading resumes checks without resending the transaction.

The frontend locks minting, trading, and staking **per weapon / NFT**. Actions on the same weapon wait for its previous transaction to reach finality; other weapons can proceed. Each has separate progress and reload recovery. Recharge payments, administrator withdrawals, and permission changes share a separate recharge lock. Marketplace income withdrawal has its own duplicate protection. Wallet confirmation dialogs are still handled sequentially. A recharge remains locked until coins are credited. Legacy records without a weapon ID keep NFT actions locked until verification finishes.

Accounts, coins, storage, mail, and synchronization progress are saved in `.local/sepolia/game.sqlite3`. Progress survives downtime. Restarting resumes unfinished tasks and overdue staking settlements; a fresh database does not automatically recover another server's game saves. Run `npm run indexer:sepolia` separately only when the unified launcher is not managing the listener. Add `-- --once` to catch up once and exit.

### Database upgrades and backups

Database schema upgrades run at startup. Before updating, back up `.local/sepolia/`, including the database, original deployment records, and authorization keys. Use SQLite's backup API for a running database, or stop the relevant services before copying files. Do not resolve listener problems by deleting the database, changing historical rates, or recreating keys. See [Database and saves](docs/数据库与存档.md) and [Listener recovery](chain/链上监听与恢复.md).

## Troubleshooting

| Symptom | What to check |
|---|---|
| Page opens but login fails | Check `/api/health`, use the game on 5173 rather than the deployment console on 5174, and inspect backend.log |
| Binding fails / wallet already bound | Check the game account, wallet actually connected to the site, and Sepolia network. Switching wallets does not switch game accounts |
| Mint authorization key missing | Expected with shared manifests. Independent minting requires your own deployment; do not substitute a new key for an existing contract |
| Transaction included but game still pending | Wait for `finalized` and check the listener. Continue checking the original hash without paying again |
| Recharge not ready / reward rate unavailable | Check manifests, initial rates, listener logs, and catch-up progress. Restart after configuration changes |
| RPC log range too large / rate limiting | Reduce `FORGE_INDEX_BATCH`. Active tasks retry at 30-second intervals; idle operation does not query the chain |
| Port occupied / environment mismatch | Identify the old service before stopping it. Use another project directory for a different deployment and preserve the old save |

## Testing and Verification

**Current-version verification, 2026-11-05:** all eleven `npm test` groups were run. Nine groups passed initially; the browser group passed 145/147 scenarios, and the game integration script was blocked by its outdated test password. After adding one English error translation, fixing browser-test timing, and updating the integration script's password and sold-weapon archive assertions, targeted verification passed 16 browser scenarios, 12 game integration checks, 9 language checks, and the build plus 2 asset checks. The deployment-switch scenario also passed three consecutive repetitions. Other groups that passed initially were not rerun. This is a full run followed by targeted verification, not a single full run with zero failures. See the [November 5 consolidated test record](chain/测试与交易审查记录.md#2026-11-05当前版本全量测试与定向复验) for counts and evidence.

Sepolia manual results retain the project maintainer's **2026-11-02** confirmation and are counted separately from this isolated automated run.

| Environment | Verified scope |
|---|---|
| Sepolia manual demonstration | NFT minting, two-wallet purchase, staking, daily reward mail, NFT retrieval, recharge credit, administrator withdrawals, and adding/removing administrators |
| Local chains and automation | Duplicate reward/claim/credit protection, restart and downtime catch-up, NFT retrieval, administrator withdrawal and revocation limits; idle zero-query behaviour, 30-second checks, and task recovery |

For initial setup, run `npm run build` and `npm run test:i18n -w frontend`, then use the health checks above to verify the real environment. Run `npm test` for the complete suite; logs are saved under `.local/test-runs/`. Tests use isolated databases and local chains without operating the user's actual wallet.

| Command | Scope |
|---|---|
| `npm run test:backend` | Accounts, game boundaries, costs, mail, idempotency/concurrency, and chain-index recovery |
| `npm run test:contracts` | NFT / marketplace, staking, recharge, administrators, and withdrawal rollback |
| `npm run test:recharge` | Real local-chain deposits, delegated withdrawals, revocation, downtime catch-up, and deduplication |
| `npm run test:staking` | Real local-chain staking, retrieval, downtime settlement, and mailbox collection |
| `npm run test:browser` | Game and chain interfaces, bilingual layouts, wallet state, and error recovery |
| `npm run test:models -w frontend` | Build, models, and image assets |
| `npm run verify:game` | Isolated forging → NFT → trading → withdrawal workflow |

Browser tests use the installed Google Chrome by default. If it is unavailable, run `npx playwright install chromium`, then use `FORGE_TEST_CHROMIUM=1 npm run test:browser`. The same environment prefix works with the full suite. Bundle-size warnings, duplicate Three.js imports, and dependency deprecation notices do not themselves indicate test failure; use exit codes and reports to assess results.

## Directory Map and Git

### Complete directory map

```text
dapp/
├── frontend/                   # React / Three.js game and deployment interfaces
│   ├── src/                    # Workshop, market, staking, recharge, mailbox, and UI text
│   │   ├── App.tsx             # Pages and wallet transactions; reserve purchases first
│   │   └── locales/            # English translations
│   └── tests/                  # Assets, stories, and language checks
├── backend/                    # FastAPI game service
│   ├── app.py                  # Account, game, purchase-lock, and chain-task APIs
│   ├── storage.py              # SQLite transactions and startup migrations
│   ├── purchase_locks.py       # NFT locks, reservation expiry, and transaction association
│   ├── market.py               # Confirmed-sale archives and seller notifications
│   ├── game.py / balance.json  # Forging rules and balance
│   ├── accounts.py             # Accounts and passwords
│   ├── mailbox.py              # Mail and reward collection
│   ├── staking_rewards.py      # Staking reward settlement
│   ├── recharge.py             # Deposit conversion and credit
│   └── tests/                  # Business rules, idempotency, and concurrent purchases
├── chain/
│   ├── contracts/              # NFT/marketplace, staking, and recharge Solidity contracts
│   ├── client/transactions.ts  # Browser records, operation locks, and reload recovery
│   ├── server/                 # RPC reads, signatures, indexing, and persistent tasks
│   ├── scripts/                # Deployment console, listener startup, and rehearsals
│   ├── test/                   # Hardhat contract tests
│   └── tests/                  # Python, transaction client, and browser tests
├── assets/
│   ├── 3d/                     # Models, route/stage configuration, and asset tools
│   ├── NFT_Pic/                # Public NFT image configuration
│   ├── display/                # Weapon artwork
│   ├── stories/                # Weapon stories
│   └── reference_page/         # Asset reference images
├── deployments/                # Public Sepolia manifests suitable for version control
├── docs/                       # Game rules, database, staking, and mailbox documentation
├── report/                     # Local report PDF, LaTeX archive, and editable source (ignored)
├── scripts/                    # Service startup, test accounts, and full test entry point
├── tests/browser/              # Game interface end-to-end tests
├── conftest.py                 # Python test environment and save isolation
├── playwright.config.cjs       # Browser test configuration
├── package.json                # npm workspaces and shared commands
├── package-lock.json           # Frontend and blockchain dependency lock
├── .env.example                # Local environment template
├── .env.sepolia.example         # Sepolia environment template
└── .local/                     # Local database, keys, logs, and test output (ignored)
```

### Git exclusions and submission scope

Commit source code, tests, both README languages, dependency locks, empty `.env*.example` templates, public deployment manifests, and game assets. `.gitignore` excludes actual `.env*` files, `.local/`, `report/`, databases, keys, account credentials and their exported copies, dependencies, builds, screenshots, and logs. Do not put RPC credentials or current user account information in the README. Public contract addresses, ABIs, and the public `mintSigner` address are safe to include; they are not private keys.

```sh
git status --short
git ls-files -ci --exclude-standard
git diff --cached
```

The second command should normally produce no output. Ignore rules do not untrack files already in Git. Configuration and verification reports can go under `.local/setup-check/`; do not commit local runtime directories. Public manifests belong in [deployments](deployments/README.md), and assets belong in [assets](assets/3d/README.md).

# Forge of Fate · 命运锻造所

一个基于 React / Three.js、FastAPI / SQLite 和 Solidity 的锻造与 NFT 演示项目。玩家在三维工坊强化武器，达到最终形态后封存为 NFT，再进行交易或质押。默认网络为 **Ethereum Sepolia（11155111）**。

**游戏金币由服务器记账，不发行 ERC-20，也不能兑换回 ETH。所有金额、概率与兑换比例均为测试设定，经济系统尚未成熟。**

[快速启动](#快速启动) · [Codex 配置](#交给-codex-配置) · [独立部署](#部署与人工演示) · [游戏规则](#游戏玩法与数值) · [测试](#测试与验证)

## 当前完成的功能

更新于 **2026-11-02**。

| 模块 | 当前能力 |
|---|---|
| 三维工坊 | 领剑到手、熔炉加热、锤击、展示柜、宝箱仓库、实时等级/回收价/概率屏、中英切换 |
| 武器与经济 | 三条路线、一次性概率突变、路线等级边界、分武器扣费、保护符、回收、金币补给商店 |
| 账号与存档 | 注册登录、密码 8–20 位、一账号一钱包、服务器验签、独立存档、测试账号工具 |
| NFT / 市场 | 最终形态封存、铭刻、挂牌/改价/撤单、购买、卖家提取 ETH；成交后移除卖家卡片并发邮件 |
| 质押 / 邮箱 | 单枚授权、质押、取回；按 UTC 日历日实际时长折算奖励、停机补发、未读提示、单封/一键领取 |
| 充值 / 管理 | 测试 ETH 充值、后端兑换金币、充值记录；管理员提现、主管理员增删普通管理员 |
| 链上同步 | 三个合约按需同步、30 秒任务检查、持久化进度、最终确认、去重、停机补扫、可折叠交易历史 |
| 交易恢复 | 已知交易哈希的刷新恢复、重复提交限制、钱包/网络/部署身份校验 |

三个业务合约均已完成 Sepolia 部署与最终确认；**项目演示中列出的测试均已跑通**，包括原先待验证的质押跨日奖励、NFT 取回、管理员提现及增删管理员。具体范围见[测试与验证](#测试与验证)。

后续仍需完善加速/取消交易识别、广播未返回哈希时的恢复、统一金币收支账本与全新机器验收。自动化记录和后续规划见[测试记录](chain/测试与交易审查记录.md)与[开发计划](chain/链上功能与开发计划.md)。

## 交给 Codex 配置

可以直接让 Codex 执行：

> 阅读 README，按“快速启动”配置并启动项目。默认连接公开演示合约，保留已有配置、密钥和存档；完成依赖安装、配置准备、编译、测试账号、游戏和监听启动及健康检查。RPC URL 由我在本机填写，不向我索要钱包私钥。已有环境继续使用，不覆盖成公开演示配置。最后报告入口、监听状态和仍需我完成的步骤。

- **Codex 可完成**：检查 Node/Python 版本、安装锁定依赖、准备本机配置与公开清单、设置测试费率、创建本机测试账号、启动服务、检查 API 与监听。RPC 尚未填写时，先完成不依赖节点的工作。
- **需要本人完成**：提供完整 Sepolia RPC URL；进行钱包操作时，连接本人钱包并确认签名/交易。部署和交易使用钱包中的 Sepolia 测试 ETH。
- **默认路径只需手填 RPC**：下方准备命令会用公开清单中的部署钱包填入启动所需的公开地址，并设置测试费率；这不绑定游戏账号，也不授予合约权限。
- **完整复现铭刻及管理员操作**：改走独立部署路径，使用自己的项目钱包。Codex 可以准备工作台，钱包确认仍由本人完成。不要为已有共享合约重新生成 `mint-key`。

## 快速启动

所有命令在包含 `package.json` 的仓库根目录执行。支持 macOS / Linux；Windows 使用 WSL。版本基线为 **Node.js 24.21.0、Python 3.13.9**，见 [`.nvmrc`](.nvmrc) / [`.python-version`](.python-version)。钱包操作使用装有 MetaMask 的浏览器。

### 1. 安装依赖

```sh
node --version
python3.13 --version
npm ci
python3.13 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock.txt
npm run compile -w chain
npm run build
```

若 `python3` 已是 3.13，可用它代替 `python3.13`。已有 `.venv` 时先检查其 Python 版本，继续使用合适的环境；不要覆盖不匹配的虚拟环境。使用 nvm 时可先运行 `nvm install`、`nvm use`。依赖只需在根目录安装一次，不需要分别进入前后端安装。

### 2. 准备配置：选择一种方式

| 方式 | 能做什么 | 边界 |
|---|---|---|
| **A：公开演示合约，默认** | 游戏、钱包绑定、已有 NFT 交易/质押、充值 | 无现有合约的铸造授权密钥；充值款仍归固定项目钱包，导入不授予管理权 |
| **B：独立部署** | 从新武器铭刻到交易、质押、充值与管理员操作的完整流程 | 使用自己的项目钱包，需钱包签名和测试 Gas；见[独立部署](#部署与人工演示) |

**A 方式**：在新项目目录执行下面的准备命令。它不联网、不部署、不覆盖已有文件；遇到其他部署清单会停止。已有存档请先确认运行环境，不能仅替换合约地址。

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
    throw Error(`保留已有配置：${target} 与公开清单不同，请继续原环境或使用新目录。`);
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
console.log('准备完成；已有配置未改动。请在 .env.sepolia 填写 RPC，并核对奖励参数。');
NODE
```

**B 方式**：跳过上述公开配置导入，只在 `.env.sepolia` 不存在时运行 `cp -n .env.sepolia.example .env.sepolia`，按下表配置自己的项目钱包，再走独立部署。两种方式不要在同一个已有存档上混用。

### 3. 填写 RPC 与核对参数

只编辑本机 `.env.sepolia`，不要把实际内容提交 Git。这里的 API 指 RPC 服务商的 **Ethereum Sepolia HTTP(S) 完整节点 URL**；不是裸 API Key、区块浏览器链接或主网节点。服务需要支持 `finalized`、历史部署回执和 `eth_getLogs`。

| 参数 | 设置 |
|---|---|
| `SEPOLIA_RPC_URL` | **必须本人填写**；例如服务商提供的完整 Sepolia URL |
| `PROJECT_WALLET_ADDRESS` | A 方式自动填公开部署地址用于启动校验；B 方式填自己的 MetaMask 公开地址，必须与部署钱包一致 |
| `FORGE_STAKING_COINS_PER_DAY` | 演示用 `1000`；原始模板为 `0`，已有配置需在首次监听质押前调整 |
| `FORGE_RECHARGE_WEI_PER_UNIT` / `FORGE_RECHARGE_COINS_PER_UNIT` | `10000000000000000` / `10000`，即 0.01 测试 ETH 换 10,000 金币 |
| `FORGE_INDEX_BATCH` | 默认每批 `500` 个区块；节点限制查询范围时调小批量。任务检查固定 `30` 秒，旧 `FORGE_INDEX_INTERVAL` 已停用 |
| `DEMO_BUYER_ADDRESS` | 可选，第二个演示钱包公开地址；不影响基本启动 |

不需要 OpenAI API、GitHub Token、钱包私钥或助记词。NFT 图片使用仓库中的[公开图片配置](assets/NFT_Pic/manifest.json)。配置修改后重启相关服务；质押费率和充值比例首次登记后固定，不可直接覆盖已有历史来源。

```sh
npm run check:sepolia
```

通过表示网络和 `finalized` 查询正常；历史日志能力还需由监听确认。RPC 未填写时可先运行 `npm run build`、`npm run test:i18n -w frontend` 等离线检查。

### 4. 创建本机账号并启动

```sh
npm run accounts:setup
npm run start:demo
```

| 入口 | 用途 |
|---|---|
| **http://127.0.0.1:5173/** | 游戏；登录、钱包绑定、交易、质押与充值 |
| http://127.0.0.1:8000/api/health | 后端健康检查 |
| http://127.0.0.1:5174/deploy | 仅独立部署工作台，另运行 `npm run deploy:console` 后使用 |

启动器同时启动前端、后端；存在 NFT 部署清单时也启动按需同步工作进程。**不要再重复启动监听。** 普通模式使用 `npm start`，不开启测试菜单。统一使用 `127.0.0.1`，不要与 `localhost` 混用登录和钱包授权。

在启动终端按 Ctrl+C 停止本次服务，存档保留。下一次只需再次 `npm run start:demo` 或 `npm start`，不用重新安装、复制配置或部署。端口占用先确认旧服务所属环境；部署工作台额外使用 `5174` / `8010`。

### 5. 验证启动结果

游戏终端保持运行，在另一个终端执行：

```sh
node <<'NODE'
(async () => {
  const get = async path => {
    const r = await fetch(`http://127.0.0.1:5173/api/${path}`);
    if (!r.ok) throw Error(`${path}: HTTP ${r.status}`);
    return r.json();
  };
  const health = await get('health'), config = await get('config'), sync = await get('chain/status');
  if (!health.ok || config.network?.chainId !== 11155111) throw Error('后端或网络不匹配');
  if (!config.chain || !config.staking || !config.recharge) throw Error('三个合约尚未全部接通，请检查公开清单或独立部署进度');
  console.log({network: config.network.chainName, nft: config.chain.address,
    staking: config.staking.address, dailyCoins: config.staking.dailyCoins,
    recharge: config.recharge.address, rechargeReady: config.recharge.ready,
    listener: sync.state, running: sync.running, caughtUp: sync.caughtUp});
})().catch(e => {console.error(e.message); process.exitCode = 1;});
NODE
```

应看到三个合约地址；监听追上后 `running: true`、`caughtUp: true`、`listener: idle`（有任务时可能为 `ready` / `syncing`），`dailyCoins: 1000`、`rechargeReady: true`。初次补扫允许暂时 `syncing`，稍后再检查。只有部分合约的独立部署环境，可以先运行游戏，待三个部署完成再做这项完整检查。

日志在 `.local/sepolia/backend.log`、`frontend.log`、`indexer.log`。链上状态界面位于测试模式下的“命运集市 → 链上状态”。游戏页面能打开仅证明前端可用，不代表监听已追上。

### 普通账号与测试账号

`accounts:setup` 创建本机 `forge_test`，凭据保存在 `.local/sepolia/test-accounts.md`；重复执行保留已有密码、绑定和存档。`npm run accounts:setup -- --with-player` 可额外创建 `forge_player`；也可以在页面注册普通账号。仓库不携带原运行环境的用户数据库或钱包绑定。

测试菜单要求 **测试模式 + tester 角色**；可补资源、生成三类武器、调整自己未封存武器，生成/修改的武器保留 DEMO 标记。测试角色不等于充值合约管理员。

### 钱包注册绑定与支付

登录游戏 → 连接目标 MetaMask 钱包 → 签署绑定消息。绑定不收 Gas、不授权转账；每个账号和钱包唯一对应，当前不提供换绑。切换 MetaMask 不会切换游戏账号；以页面“网站当前连接的钱包”为准。交易另行签名并支付测试 Gas，网络或账号不匹配时按钮暂停。

## 部署与人工演示

在另一份全新项目目录完成依赖与 RPC 配置，设置自己的 `PROJECT_WALLET_ADDRESS` 和 `FORGE_STAKING_COINS_PER_DAY=1000`，**不导入公开清单**。项目钱包准备 Sepolia 测试 ETH，然后依次操作：

| 顺序 | 启动命令 | 最终确认后生成的文件 |
|---|---|---|
| 1. NFT / 市场 | `npm run deploy:console` | `.local/sepolia/deployment.json`、本机 `mint-key` |
| 2. 质押 | `npm run deploy:staking` | `.local/sepolia/staking-deployment.json`，关联第 1 步 NFT |
| 3. 充值 | `npm run deploy:recharge` | `.local/sepolia/recharge-deployment.json`，固定项目钱包为收款人 |

每一步打开 `http://127.0.0.1:5174/deploy`，核对合约及钱包，由 MetaMask 确认。等工作台显示记录已保存后，**Ctrl+C 关闭当前工作台，再启动下一项**，不能同时占用相同端口。部署计划可恢复，不要删记录重复部署。三项完成后运行 `npm run accounts:setup`、`npm run start:demo`；游戏已启动则重启一次。

公开合约地址、ABI、部署区块与身份见 [deployments](deployments/README.md)。共享清单不包含铸造私钥，不能用新密钥为旧合约铸造。独立部署流程及故障恢复详见[工作台说明](chain/合约部署工作台.md)。

## 游戏玩法与数值

| 操作 | 当前测试规则 |
|---|---|
| 每日补给 | 200 铁块、5 保护符，另领 3 把 +0 剑；UTC 零点重置，新领武器直接拿到手上 |
| 新剑 / 商店 | 锻造新剑 10 铁块；购买 +0 剑 2,500 金币；20 铁块 5,000 金币；1 保护符 2,500 金币 |
| 加热 / 敲击 | 加热 2 铁块，3 秒后可敲 5 次；基础阶段每锤 2，骑士剑 +10 起 4、刺剑 +5 起 3、巨剑 +10 起 7 |
| 自动突变 | 骑士剑首次达到或跨过 +5：30% 变刺剑 +5；仍为骑士剑时首次达到或跨过 +10：30% 变巨剑 +10 |
| 判定边界 | 每把武器最多两次门槛判定；大成功跳级不漏判，降级再升不重抽；变为刺剑/巨剑后永久固定路线，失败不弹窗 |
| 最高 / 封存等级 | 骑士剑 +90 / +80；刺剑 +80 / +70；巨剑 +70 / +60。最终形态前只能游戏内回收 |
| 保护符 | Q 或开关启用；仅挡住损毁时消耗一张，仍可能降级；阶段保护期间不耗符 |

费用由后端按敲击前的武器阶段计算，升级/突变/降级后更新下一锤成本；降回基础阶段每锤为 2 铁块，路线身份保留。概率按“大成功 → 成功 → 降级 → 损毁”显示，大成功绿色、损毁红色；加热与单锤成本分开展示。回收价见 `backend/balance.json`，不是 NFT 市场定价。

仓库存取免费并保留等级、热量及保护进度；卡片“返回工坊 / 取出并继续锻造”定位到三维操作区。WASD 移动、鼠标转头、E 拿放，Esc 暂停并释放鼠标。模型、立绘、故事和全部操作规则见[游戏规则与素材](docs/游戏规则与素材.md)。

## NFT 与交易规则

封存不可逆，之后不能强化。铭刻后 NFT 可留在钱包，不必立即挂牌；购买所得 NFT 显示在“我的收藏”，**不会回流成可强化武器**。游戏内已移除转赠入口；NFT 链上的标准转移能力仍存在。

挂牌/改价/撤单不转移所有权；买家付款后更新归属，最终确认后归档卖家的原封存武器并发成交通知。市场“提取”领取的是卖家交易收入；它与充值页面的管理员提现是两个入口。

## NFT 质押与每日奖励

在“我的收藏 → 质押 NFT”或“NFT 质押”操作：**授权单枚 NFT → 确认质押**，两步分别确认；仅授权不计奖。NFT 由合约保管，不能同时出售；“取回 NFT”回到绑定钱包，已有奖励保留。

演示费率为每把每天 **1,000 金币**，按 UTC 日历日中的有效质押秒数折算；北京时间次日 08:00 跨日后，等待链上最终确认再发前一日邮件。停机后按已确认事件与结算进度补发，不重复发奖。完整规则见[质押说明](docs/质押合约.md)。

## 奖励邮箱

有邮件时显示数量及未读提示。阅读奖励邮件只标记已读；单封或一键领取后增加金币并移出收件箱。一键收取覆盖全部奖励邮件，不删除成交通知；后台保留发放与领取记录，重复点击/重试不能重复加币。详见[邮箱说明](docs/奖励邮箱.md)。

## 测试 ETH 充值

“充值金币”支持前端填写金额、钱包付款、最终确认后自动入账及历史记录。默认 **0.01 测试 ETH = 10,000 游戏金币**，Gas 不参与兑换；不足一个金币的金额结转到同钱包后续充值。提现及管理员事件不会再次发币。

### 管理员提取充值收入

进入“充值金币 → 管理员提现”，输入金额或填入全部余额，核对固定收款地址后由钱包确认。合约资金只进入部署时确定的 `treasury`，Gas 由发起钱包另付，不扣玩家金币。普通账号只有获得**链上管理员授权**后才出现此入口。

固定项目钱包是不可移除的主管理员，可在页面添加/移除普通管理员（含主管理员最多 32 个）；普通管理员只能提现，不能改权限。主管理员及收款地址不能在本版更换，修改服务器配置不改变链上权限。共享充值合约的收款地址仍是公开清单中的项目钱包；独立管理请自行部署。

复测顺序：充值到账 → 小额提现 → 核对合约余额/收款钱包/玩家金币 → 添加另一管理员 → 委托提现 → 撤权后拒绝操作 → 重启检查不重复入账。测试 ETH 无真实经济价值，当前参数不代表成熟经济模型。

## 监听、存档与恢复

**页面按需查一次；后台未完成任务每 30 秒检查，任务完成后停止查链。** 触发方式如下：

| 什么时候触发 | 查询与处理方式 |
|---|---|
| 进入交易市场，或在市场点击“刷新状态” | 立即读取一次 NFT 与挂牌快照，读取完成就结束；浏览市场无需绑定钱包 |
| 已绑定钱包的账号进入市场、质押、充值、邮箱，或在这些页面刷新 | 合并生成相关合约的一轮后台补同步任务，补齐已确认记录；按 30 秒间隔处理，完成后停止 |
| 提交购买、充值、质押、取回等交易并取得哈希 | 把任务保存到服务器，每 30 秒跟进确认与后续处理；关闭页面后仍继续 |
| UTC 零点（北京时间 08:00）后有质押奖励待结算 | 自动触发质押同步，先读齐取回等已确认事件，再按实际时长发奖 |
| 新部署首次接入 / 服务器重启 | 新部署补扫一次；重启继续未完成任务并补上到期奖励，从保存的进度接着处理 |

**一直停留在市场页面不会自动刷新列表。** 别人新挂牌、成交或在外部钱包操作后，点击“刷新状态”或重新进入市场即可重新读取；“我的收藏 / 在售市场”切换使用已有列表筛选。质押持仓和管理员余额也在进入页面、手动刷新或操作结束后更新，诊断面板按主动检查更新。配置、历史及已登记任务的回执状态查询读取本地数据，不持续访问 RPC。外部链上事件会在下一次相关后台同步时补查，空闲期间不保证即时发现。

未知或被替换的交易哈希最多自动检查 24 小时，之后暂停；可点击“检查待确认交易”继续核对，不能当作失败再次付款。任务、检查间隔和扫描游标都入库，刷新、多标签页和重启不会加快后台频率或重复入账。历史积压按批补扫，一次唤醒最多处理 20 批，不逐块遍历空区块。

监听只按区间查询指定合约事件，空区间也保存进度；Sepolia 按 RPC 的 **`finalized` 边界**处理，不是简单固定多等几个块。钱包显示已打包时，游戏可能仍在等最终确认；不要重复付款。已知哈希保存在浏览器和服务器任务表中，刷新后继续查询，不自动重发。

账号、金币、仓库、邮件及监听进度保存在 `.local/sepolia/game.sqlite3`。离线不丢进度，重启继续未完成任务，并补上到期质押结算；新数据库不会自动还原另一台服务器的游戏存档。只在未使用统一启动器时单独运行 `npm run indexer:sepolia`；`-- --once` 可补扫一轮后退出。

### 数据结构升级与备份

启动时自动升级数据库结构。更新前备份 `.local/sepolia/`，包括数据库、原部署记录与授权密钥；运行中的 SQLite 应使用备份 API，或先停止相关服务再复制。不要删除数据库、改历史费率或重建密钥来处理监听故障。具体方法见[数据库与存档](docs/数据库与存档.md)和[监听与恢复](chain/链上监听与恢复.md)。

## 常见问题

| 现象 | 检查方式 |
|---|---|
| 页面能开，登录失败 | 检查 `/api/health`；确认访问 5173 游戏而非 5174 部署页，查看 backend.log |
| 无法绑定 / 钱包已绑定 | 核对游戏账号、站点实际连接的钱包和 Sepolia 网络；切换钱包不等于切换游戏账号 |
| 缺少铸造授权密钥 | 共享模式的预期限制；独立铭刻需自己的部署，不能给旧合约换新密钥 |
| 交易已打包但游戏未完成 | 等 `finalized`，检查监听；使用原哈希继续查询，不重复付款 |
| 充值未就绪 / 奖励金额为空 | 确认相关清单、首次费率、监听日志与补扫进度；改配置后重启 |
| RPC 查询范围过大 / 请求限流 | 减小 `FORGE_INDEX_BATCH`；任务按 30 秒重试，空闲不查询 |
| 端口占用 / 环境不匹配 | 确认旧服务后在其终端停止；换部署使用另一项目目录，保留旧存档 |

## 测试与验证

截至 **2026-11-02**，项目演示中列出的测试均已通过；Sepolia 人工实测结果由项目维护者确认。

| 测试环境 | 已通过的内容 |
|---|---|
| Sepolia 实测 | NFT 铭刻、双钱包购买、质押、跨日奖励邮件、NFT 取回、充值到账、管理员提现、添加/移除管理员 |
| 本地链与自动化 | 重复发奖/领取/入账防护、服务器重启与停机补发、NFT 取回、管理员提现和撤权限制；按需同步的空闲零查询、30 秒检查及任务恢复 |

初次配置先运行 `npm run build` 和 `npm run test:i18n -w frontend`，再按上面的健康检查验证真实环境。完整测试用 `npm test`，在 `.local/test-runs/` 保存日志；使用隔离数据库和本地测试链，不操作实际钱包。

| 命令 | 内容 |
|---|---|
| `npm run test:backend` | 账号、游戏边界、扣费、邮件、幂等/并发、链上索引恢复 |
| `npm run test:contracts` | NFT / 市场、质押、充值、管理员及提现回滚 |
| `npm run test:recharge` | 真实本地链充值、委托提现、撤权、停机补账与去重 |
| `npm run test:staking` | 真实本地链质押、取回、停机补算与邮箱领取 |
| `npm run test:browser` | 游戏/链上界面、双语布局、钱包状态与错误恢复 |
| `npm run test:models -w frontend` | 构建及模型/图片资源检查 |
| `npm run verify:game` | 隔离的锻造 → NFT → 买卖 → 提现闭环 |

浏览器测试默认使用本机 Google Chrome；没有 Chrome 时先 `npx playwright install chromium`，再用 `FORGE_TEST_CHROMIUM=1 npm run test:browser`（全量测试同样可加此前缀）。包体积、Three.js 重复导入和依赖弃用警告不等于测试失败，以退出码与报告为准。

## 目录与 Git

`frontend/` 为游戏界面；`backend/` 为规则、账号和 SQLite；`chain/` 为合约、部署、交易与监听；`assets/` 为模型、立绘和故事；`deployments/` 为公开清单；`docs/` 为详细规则。

### Git 忽略与提交范围

提交源码、测试、依赖锁文件、空 `.env*.example`、公开合约清单和游戏素材。真实 `.env*`、`.local/`、数据库、密钥、账号凭据及其导出副本、依赖、构建、截图与日志由 `.gitignore` 排除。RPC 和当前用户账号信息不要写入 README；公开合约地址、ABI、`mintSigner` 公开地址不是私钥。

```sh
git status --short
git ls-files -ci --exclude-standard
git diff --cached
```

第二条正常应无输出；忽略规则不移除已跟踪文件。配置/测试报告可放 `.local/setup-check/`，不要提交本机运行目录。公开清单保留在 [deployments](deployments/README.md)，资产保留在 [assets](assets/3d/README.md)。

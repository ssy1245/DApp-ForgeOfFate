# 公开部署配置

以下清单均已完成 Ethereum Sepolia（`11155111`）部署及最终确认，从本机核验记录按公开字段导出，供开发者连接同一演示环境使用。更新于 2026-11-02。

| 公开清单 | 模块 | 程序读取的本机文件 |
|---|---|---|
| [`sepolia-demo.json`](sepolia-demo.json) | ForgeOfFate · NFT / ETH 市场 | `.local/sepolia/deployment.json` |
| [`staking-sepolia-demo.json`](staking-sepolia-demo.json) | ForgeStaking · 质押 | `.local/sepolia/staking-deployment.json` |
| [`recharge-sepolia-demo.json`](recharge-sepolia-demo.json) | ForgeRecharge · 充值与管理员权限 | `.local/sepolia/recharge-deployment.json` |

安装、配置 RPC、导入、游戏与监听启动步骤见[项目 README](../README.md#快速启动)。程序不会自动读取本目录；按表中名称复制到全新环境后使用。不要把已有运行环境的清单直接覆盖为另一份部署。

| 内容 | 用途 |
|---|---|
| 合约地址、chain ID、ABI | 后端读取合约，前端调用交易 |
| `deploymentId`、`mintSigner`、构造参数 | 核对部署和铸造授权身份；均是公开信息 |
| `nftAddress` / `nftDeploymentId` | 质押清单关联本目录的同一 NFT 部署 |
| `treasury` | 充值合约不可变的收款钱包，同时是不可移除的主管理员 |
| 部署交易、部署区块和区块哈希 | 核对部署回执，确定监听起点 |
| 创世区块、代码、编译信息指纹 | 核对链与合约身份，发现清单不匹配 |
| 确认策略、记录时间 | 说明 Sepolia 使用最终确认边界 |

本目录不包含 RPC 连接地址、服务商 API 密钥、`mint-key` 私钥、钱包秘密或游戏数据库。复制公开清单不会授予新 NFT 的铸造权限；要独立复现铸造，按 README 在自己的新目录部署合约。

质押清单的 `nftAddress` / `nftDeploymentId` 已与本目录 NFT 清单核对一致。充值合约独立于 NFT，默认兑换比例在后端设置为 0.01 测试 ETH = 10,000 游戏金币，链上不发行金币。各自本机的金币、充值入账和奖励邮件独立保存；这些数值仅用于测试，经济系统尚未成熟。

共享充值合约的 ETH 始终提到清单中的 `treasury`。导入配置不会授予管理权限，更改 `.env.sepolia` 的项目钱包也不会改变收款人。要独立演示添加 / 移除管理员和提现，请按 README 部署自己的充值合约。不要复制包含计划、数据库、凭据的整个运行目录。

真实铭刻、双钱包购买、质押建仓与充值到账已完成；管理员增删和提现、质押跨日奖励与取回仍需补齐 Sepolia 人工验收记录。隔离测试通过不代表所有真实网络场景已验收。

每日游戏金币费率属于服务器配置，不属于合约 ABI。本次测试采用 `FORGE_STAKING_COINS_PER_DAY=1000`；模板保留 `0`，启用前需主动设置。公开源码验证与完整验收进度见[链上计划](../chain/链上功能与开发计划.md)。

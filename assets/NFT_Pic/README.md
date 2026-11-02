# NFT 成品图与固定链接

[← 返回项目总览](../../README.md)

更新日期：2026-10-28。

## 当前状态

**三张公开图片已接入 NFT 元数据。** 来源为 [ssy1245/NFT_image 的 Image_Dapp 目录](https://github.com/ssy1245/NFT_image/tree/main/Image_Dapp)，固定提交版本为 `658de5dd69600b126345f028a7c7f30d7a7b63ed`。2026-10-28 已在不登录、不带凭据的情况下验证三张原图，均返回 HTTP 200、`image/png`；远端文件与本目录原图一致。

公共配置是 [`manifest.json`](manifest.json)，直接随源码提交 GitHub。克隆、换钱包或重新部署合约时共用这些链接，不需要上传自己的图片，也不需要在 `.env.sepolia` 填图片地址或 GitHub 凭据。

| 武器路线 | 本地原图 | NFT 的固定公开原图 |
|---|---|---|
| 骑士剑 `longsword` | [sword.png](sword.png) | [公开原图](https://raw.githubusercontent.com/ssy1245/NFT_image/658de5dd69600b126345f028a7c7f30d7a7b63ed/Image_Dapp/sword.png) |
| 刺剑 `rapier` | [Rapier.png](Rapier.png) | [公开原图](https://raw.githubusercontent.com/ssy1245/NFT_image/658de5dd69600b126345f028a7c7f30d7a7b63ed/Image_Dapp/Rapier.png) |
| 巨剑 `greatsword` | [GS.png](GS.png) | [公开原图](https://raw.githubusercontent.com/ssy1245/NFT_image/658de5dd69600b126345f028a7c7f30d7a7b63ed/Image_Dapp/GS.png) |

每条路线的不同等级共用一张成品图；每把武器的中英文名称、等级、路线、阶段和 DEMO 属性继续按实际封存结果生成。旧存档缺少路线字段时按骑士剑处理；未知路线拒绝生成，避免配错图片。

## 元数据怎样生成

1. 武器达到门槛并封存后，玩家请求铸造授权。
2. [`backend/app.py`](../../backend/app.py) 的 `metadata()` 读取公共映射，按路线设置 JSON 的 `image`；名称和属性使用该武器的真实快照。生成过程无需请求 GitHub，不会因图片网站暂时不可达而阻塞游戏服务。
3. 后端把 JSON 编码为 `data:application/json;base64,...` 并签入铸造授权；合约验证授权后保存这个 `tokenURI`。
4. 外部钱包读取 `tokenURI`，再从 `image` 地址下载原图。图片文件本身不存入链上，下载仍依赖 GitHub 可访问。

固定提交避免 `main` 的同名文件更新影响旧 NFT，但仍需保持图片仓库公开可访问。不要填电脑路径、GitHub 预览页或带临时访问令牌的链接。修改公共映射后需重启后端，变更只影响之后生成的授权；已签发且仍有效的授权及已铸造 NFT 不会自动改写。

## 与游戏卡片的区别

| 用途 | 当前实现 |
|---|---|
| 背包、仓库和本项目 NFT 市场卡片 | 继续使用 [`assets/display/`](../display/README.md) 的 23 张透明展示图，按武器阶段匹配 |
| NFT 的 `tokenURI` | 每把武器独立的内嵌 JSON，铸造后固定 |
| NFT 元数据的 `image` | 本文三张公开成品图，按路线选择 |

因此，游戏卡片仍显示原来的分阶段外观；外部钱包读取新铸造 NFT 时使用这里的成品图。历史 NFT 若已保存旧占位 SVG，仍保留原图。

## 验证与后续步骤

- `npm run test:backend`：覆盖全部可铭刻等级、三条路线、DEMO / 普通武器、旧存档和错误路线，核对地址、中英文名及属性。
- `npm run verify:game`：在隔离本地链实际铸造三种 NFT，读取合约的 `tokenURI`，并检查买卖 / 转移不会改变原有 URI；不花 Sepolia 测试 ETH。
- 真实钱包验收待完成：部署 Sepolia NFT 业务合约后，分别封存并铭刻三条路线的武器，在支持自定义 NFT 的钱包或查看器核对图片、等级和归属。当前通用部署工作台只提供验证合约，不能据此声称 NFT 业务已部署。

交付时上传本目录原图、`manifest.json`、代码和说明，以及根目录空白环境模板；真实钱包/RPC 配置、密钥、数据库和运行记录继续留在被 Git 忽略的位置。

# NFT 图片素材

NFT 图片统一放在项目的 **`assets/NFT_Pic/`**，可以随源码提交 GitHub。

本机路径：`/Users/shangyishen/Desktop/dapp/assets/NFT_Pic/`。已有文件：

- `sword.png`
- `Rapier.png`
- `GS.png`

继续把导出的 PNG、JPG 或 WebP 图片放在这里即可，也可以按武器种类建子目录。保留文件名的大小写；不需要把路径填进 `.env.sepolia`。后续接入时再按实际图片确认武器与等级的对应关系，并统一配置。

当前这里只存放素材，**尚未自动接入页面或 NFT 元数据**。现有游戏卡片仍使用 `assets/display/`；现有后端 NFT 元数据中的 `image` 仍是占位 SVG。本次不修改这些功能。

本机文件路径只是开发素材位置。后续接入 NFT 时还需要处理对外可访问的图片地址与元数据；不能直接把电脑上的绝对路径写进 NFT 的 `image` 字段。图片发布方式将在 NFT 开发阶段落实。

只放可公开的图片和说明。项目的配置、授权密钥、数据库与部署运行记录继续保存在 Git 忽略的对应位置，不放进本目录。

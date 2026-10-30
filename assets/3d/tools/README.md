# 道具 UI 图片

[← 返回项目总览](../../../README.md)

- `Fe.png`：用户提供的铁矿石参考图，原文件保留。
- `Fe-icon.png`：通过 imagegen 内置编辑生成的透明底版本，已接入 `frontend/src/IronIcon.tsx`。RGBA PNG，边角完全透明；仅用于二维界面，不作为三维模型。
- `Gold.png`：用户提供的王冠雄狮金币原图，原文件保留。
- `Gold-icon.png`：通过 imagegen 内置编辑抠出的透明底金币，保留圆形轮廓、王冠、雄狮和金属纹理；已接入 `frontend/src/GoldIcon.tsx`，仅用于二维界面。
- `protect.png`：用户提供的透明底保护符，直接使用原文件，保留金属盾牌、吊环与金色符文；已接入 `frontend/src/WardIcon.tsx`，仅用于二维界面。

铁块图标在顶部余额、每日补给、锻造 / 加热 / 敲击费用和购买铁块入口共用。金币图标用于顶部金币余额、武器系统回收估值、购买精良剑和铁块的金币费用；NFT 市场的测试 ETH 继续使用 ETH 标识。保护符图标用于顶部数量、每日补给、强化保护选项和工坊内的保护勾选项。

三种资源图标共用暗色底框和 48px 资源栏尺寸（手机 34px），由 `frontend/src/materials.css` 控制。费用 / 数量图标为 20～22px，保护选项为 32px。均采用完整图片显示，保留原图透明通道。中英文界面使用同一图标，数额和资源文字保留。

生成时使用的完整提示词：

```text
Use case: background-extraction. Edit target: the provided iron ore inventory icon. Remove ONLY the white background to actual alpha transparency. Preserve the exact ore rock shape, metallic gray facets, copper rust seams, lighting, perspective and illustrated rendering. Make a clean tight cutout of this single rock, centered, filling about 92% of the square image, with small transparent padding. Intended use: small icon on a dark fantasy game's charcoal UI, so keep the existing silver highlights crisp and readable. No white fringe, no gray matte, no ground shadow, no frame, no tile, no text, no checkerboard baked into the image. Output PNG with real transparent background.
```

金币透明图使用的完整提示词（imagegen 内置编辑模式）：

```text
Use case: background-extraction. Asset type: gold currency inventory icon for the existing dark fantasy game UI. Edit target: the supplied Gold.png, a single round gold coin embossed with a crowned rampant lion. Remove ONLY the white background and the cast shadow outside the coin to actual alpha transparency. Preserve the exact circular coin silhouette, four round studs, crown, lion heraldry, ornamental tail, hammered gold texture, bevels, golden highlights, original frontal view and orientation. Keep the entire coin intact. Center the cutout, filling approximately 92% of a square canvas with small transparent padding, so it remains legible as a small icon. No white fringe, no gray matte, no backdrop, no ground shadow, no added frame or tile, no text, no watermark, no checkerboard baked in. Output a PNG with a genuinely transparent background.
```

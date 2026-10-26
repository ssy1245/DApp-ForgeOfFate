# 道具 UI 图片

- `Fe.png`：用户提供的铁矿石参考图，原文件保留。
- `Fe-icon.png`：通过 imagegen 内置编辑生成的透明底版本，已接入 `frontend/src/IronIcon.tsx`。RGBA PNG，边角完全透明；仅用于二维界面，不作为三维模型。

图标在顶部余额、每日补给、锻造 / 加热 / 敲击费用和购买铁块入口共用。暗色底框、显示尺寸由 `frontend/src/materials.css` 控制。

生成时使用的完整提示词：

```text
Use case: background-extraction. Edit target: the provided iron ore inventory icon. Remove ONLY the white background to actual alpha transparency. Preserve the exact ore rock shape, metallic gray facets, copper rust seams, lighting, perspective and illustrated rendering. Make a clean tight cutout of this single rock, centered, filling about 92% of the square image, with small transparent padding. Intended use: small icon on a dark fantasy game's charcoal UI, so keep the existing silver highlights crisp and readable. No white fringe, no gray matte, no ground shadow, no frame, no tile, no text, no checkerboard baked into the image. Output PNG with real transparent background.
```

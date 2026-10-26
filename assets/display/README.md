# 武器透明展示图

23 张 PNG 由内置 imagegen 逐张编辑原始参考图生成，保留原始参考图在 `assets/reference_page/`。此目录只存面向展示卡的单件正面图；剑尖统一朝上，背景使用真实 RGBA 透明通道，不包含原图的其他视角和文字。

- `BasicSword/`：共用 +0 初始剑，1 张。
- `KnightSword/`：骑士剑 +10～+80，8 张；最终外观沿用至 +90。
- `Greatsword/`：巨剑 +10～+60，6 张；最终外观沿用至 +70。
- `Rapier/`：刺剑 +5～+70，8 张；最终外观沿用至 +80。

`assets/3d/sword-tiers.json` 的 `display` 字段是运行时对应关系，路径相对本目录。开发与构建后均通过 `/display/` 加载，背包和 NFT 市场共用一套映射。原始 `reference` 与 `reference_frame` 留作美术源图记录，展示卡不再使用源图裁切、模糊底图或边缘蒙版。

`manifest.json` 记录每张图的来源、目标路径和完整提示词；生成方式为内置 imagegen 编辑，未使用 CLI/API 回退。统一要求是保留对应武器的造型、颜色与纹理，仅提取单件正面、去除背景并调整整体朝向。生成结果的 RGB 在透明像素内可能仍有颜色，应保留 alpha，不能改存不支持透明度的 JPEG。

验证命令：`npm run test:models -w frontend`。检查 23 阶映射、开发与构建后的字节一致性、透明区域、四角 alpha、剑身边界和可读尺寸。

| 种类 | 形态起点 | 名称 | 展示图 |
|---|---|---|---|
| 共用初始剑 | +0 | 余烬长剑 | [BasicSword/+0BasicSword.png](BasicSword/%2B0BasicSword.png) |
| 骑士剑 | +10 | 精铁骑士剑 | [KnightSword/+10KnightSword.png](KnightSword/%2B10KnightSword.png) |
| 骑士剑 | +20 | 银誓长剑 | [KnightSword/+20KnightSword.png](KnightSword/%2B20KnightSword.png) |
| 骑士剑 | +30 | 王国卫剑 | [KnightSword/+30KnightSword.png](KnightSword/%2B30KnightSword.png) |
| 骑士剑 | +40 | 荣耀骑士剑 | [KnightSword/+40KnightSword.png](KnightSword/%2B40KnightSword.png) |
| 骑士剑 | +50 | 王庭圣剑 | [KnightSword/+50KnightSword.png](KnightSword/%2B50KnightSword.png) |
| 骑士剑 | +60 | 王庭誓约 | [KnightSword/+60KnightSword.png](KnightSword/%2B60KnightSword.png) |
| 骑士剑 | +70 | 黄金誓约 | [KnightSword/+70KnightSword.png](KnightSword/%2B70KnightSword.png) |
| 骑士剑 | +80 | 最后的黎明 | [KnightSword/+80KnightSword.png](KnightSword/%2B80KnightSword.png) |
| 刺剑 | +5 | 精铁刺剑 | [Rapier/+5Rapier.png](Rapier/%2B5Rapier.png) |
| 刺剑 | +10 | 银锋刺剑 | [Rapier/+10Rapier.png](Rapier/%2B10Rapier.png) |
| 刺剑 | +20 | 宫廷细剑 | [Rapier/+20Rapier.png](Rapier/%2B20Rapier.png) |
| 刺剑 | +30 | 鸢尾刺剑 | [Rapier/+30Rapier.png](Rapier/%2B30Rapier.png) |
| 刺剑 | +40 | 王室誓剑 | [Rapier/+40Rapier.png](Rapier/%2B40Rapier.png) |
| 刺剑 | +50 | 绯冠刺剑 | [Rapier/+50Rapier.png](Rapier/%2B50Rapier.png) |
| 刺剑 | +60 | 赤蔷誓约 | [Rapier/+60Rapier.png](Rapier/%2B60Rapier.png) |
| 刺剑 | +70 | 炽翼天使 | [Rapier/+70Rapier.png](Rapier/%2B70Rapier.png) |
| 巨剑 | +10 | 铁匠大剑 | [Greatsword/+10Greatsword.png](Greatsword/%2B10Greatsword.png) |
| 巨剑 | +20 | 烬炉大剑 | [Greatsword/+20Greatsword.png](Greatsword/%2B20Greatsword.png) |
| 巨剑 | +30 | 渊角龙骸 | [Greatsword/+30Greatsword.png](Greatsword/%2B30Greatsword.png) |
| 巨剑 | +40 | 熔脉龙骸 | [Greatsword/+40Greatsword.png](Greatsword/%2B40Greatsword.png) |
| 巨剑 | +50 | 深渊炉心 | [Greatsword/+50Greatsword.png](Greatsword/%2B50Greatsword.png) |
| 巨剑 | +60 | 余烬君王 | [Greatsword/+60Greatsword.png](Greatsword/%2B60Greatsword.png) |

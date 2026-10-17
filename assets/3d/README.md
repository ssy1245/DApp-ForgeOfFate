# 3D 资产投放目录

把生成的模型直接放在本文件夹。开发服务器会从这里读取，不需要复制到其他位置。暂时缺少模型时，页面自动使用程序生成的占位模型。

## 请优先生成

| 文件名 | 模型 | 优先级 | 要求 |
|---|---|---|---|
| `sword.glb` | 双刃长剑 | 高 | 完整单把剑，深色金属剑身、旧皮革握柄，剑身不带火焰和背景 |
| `hammer.glb` | 锻造锤 | 高 | 单个铁匠锤，深色方形金属锤头、木质或旧皮革握柄，不带手和人物 |
| `anvil.glb` | 铁砧 | 可选 | 单个传统铁砧，深色旧金属；已有程序占位，无需急着生成 |

## 统一规格

- 风格：Stylized Dark Fantasy，低面数，造型清楚，避免极细零件。
- 格式：单个 `.glb`，贴图嵌入文件，不依赖外置纹理路径。
- 不带场景、地面、人物、灯光和相机；无需骨骼或动画。
- 原点尽量在物体中心，Y 轴向上，应用旋转与缩放。
- 长剑沿 Y 轴，剑尖朝 +Y；锤柄沿 Y 轴，锤头位于 +Y 端。若生成器不能保证方向也可以，交付时说明即可。
- 基础刀剑建议以 **5,000 三角面（tris）** 为生成目标，常规范围 **3,000–8,000 tris**；普通版本尽量不超过 **10,000 tris**。这是本项目的初始资产预算，不是引擎硬性上限；此前通用的 5,000–30,000 范围对基础刀剑偏宽。
- 如工具区分拓扑，游戏交付选择三角面；编辑源文件可以用四边面，导出 GLB 时会三角化。5,000 tris 大约相当于 2,500 个四边面，混合拓扑时以导出后的统计为准。
- 基础刀剑使用 1 套 PBR 材质，最多 2 个材质槽；基础色、法线、粗糙度／金属度贴图以 1K（1024×1024）为默认。需要近距离看刀纹时可以升至 2K，首版无需 4K。细小划痕通过贴图表达，不必堆面数。
- 刀剑 GLB 目标 1–5 MB，尽量小于 10 MB；文件体积主要也受贴图影响，不能单凭面数推算。
- 基础刀剑为刚性静态网格，不需要骨骼、蒙皮和内置动画；锻造运动由程序控制。
- 首版不要增加额外武器类型，先保证长剑和锤子风格一致。

## 可以直接使用的生成描述

### 长剑

Stylized dark fantasy blacksmith longsword, one complete double-edged sword, dark forged steel blade, simple worn leather grip, restrained bronze crossguard, readable low-poly silhouette, game-ready PBR materials, isolated object, no background, no ground, no character, no hand, no glow effects, no animation. Blade aligned vertically, tip pointing upward.

### 锻造锤

Stylized dark fantasy blacksmith forging hammer, one complete hammer, heavy rectangular dark iron head, short worn wooden handle with leather wrapping, readable low-poly silhouette, matching a dark forged steel longsword, game-ready PBR materials, isolated object, no background, no ground, no character, no hand, no animation.

## 我会用程序制作的内容

铁砧占位、石质底座、地面、炉火与余烬、矿石、材料箱、简单锤剑占位、发光、火花和碎片。这些不需要你提前生成。

放入模型后刷新页面即可。命名必须使用上述小写文件名；模型加载失败时会回退到占位模型。复杂模型的后续新增需求统一记录在本文件中。

## 预算说明与参考

以上面数、贴图及体积是针对本项目单把基础刀剑展示的建议，尚不是在目标设备上测得的性能上限。运行表现也取决于材质数量、贴图、阴影与画面分辨率。收到模型后再检查实际导出面数与显示效果。

Blender 导出 glTF 时会把四边面和多边面转换为三角面：[Blender glTF 导出说明](https://docs.blender.org/manual/en/3.3/addons/import_export/scene_gltf2.html)。

## 工坊新增陈列

展示柜、房间背墙、结构木梁与地面网格已由程序生成，目前不需要额外生成这些模型。已支持工坊环绕视角、第一人称移动与长剑拿放；现有长剑模型可直接用于台面、手持和柜内展示。

## 已接入的锻造锤

用户提供的 `fantasy+hammer+3d+model.glb` 已改名为 `hammer.glb` 并接入。模型约 396 KB、2,418 个三角面。锤子不再作为场景中的悬浮物；第一人称走近铁砧且剑位于台面时自动取出，拿起剑、离开铁砧、将剑放入展示柜或切换环绕模式时自动收起，取用与收起有短暂过渡动画。

## 首次外观升级

新提供的第二把剑已命名为 `sword-upgraded.glb`。基础剑使用 `sword.glb`，达到可配置的外观门槛（初始 +3）后切换新模型。该门槛只改变展示样式，NFT 铭刻门槛当前为 +50。熔炉、金属加热发光、敲击火星和损毁碎片由程序生成，不需要额外模型。

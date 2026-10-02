# Tripo 模型清单 · 手摇空间音乐盒

把 Tripo 生成的 GLB 命名为 **`<槽位 id>.glb`**，放进 `prototype/assets/models/`，刷新页面就会替换对应的程序化占位。没放的槽位继续用占位，可以一个一个换。槽位定义（缩放、朝向、面数）的唯一来源是 [prototype/src/assets.js](../prototype/src/assets.js)；要改尺寸或朝向，改那里的 `fit` / `yaw`。

## 统一风格（每条提示词都带上）

> miniature diorama, hand-painted toy style, warm soft colors, matte, low poly, clean silhouette, no base plate, no ground

- 不要底座和地面，模型要能直接立在盒子的地面上。代码会自动把底面对齐到地面。
- 不要文字和小字。裸眼 3D 屏上的细小文字会出现左右眼串扰。
- 风格统一：微缩模型、哑光、偏暖。金属度会被代码归零。

## 槽位

按优先级排列。前四个占画面最多，先做。

| 优先级 | 槽位 id | 内容 | 自动缩放到 | 面数上限 | 提示词 |
| --- | --- | --- | --- | --- | --- |
| ★★★ | `train_engine` | 火车头 | 长 3.6 | 5000 | small vintage steam locomotive, deep red body, black boiler front, brass trim, red wheels, toy train, side view |
| ★★★ | `train_carriage` | 车厢 | 长 2.7 | 3000 | vintage passenger train carriage, cream body, dark green roof, warm lit windows, toy train |
| ★★★ | `house` | 家 · 出发的小屋 | 高 2.8 | 3000 | cozy small European cottage, cream walls, red-brown tiled roof, chimney, wooden door, warm lit windows |
| ★★★ | `station` | 终点站 | 长 5.2 | 2500 | small countryside train station platform with green canopy roof on posts, bench, hanging lantern |
| ★★ | `lighthouse` | 灯塔 | 高 5.4 | 2000 | red and white striped lighthouse on a rock base, glass lamp room |
| ★★ | `cafe` | 夜晚的咖啡馆 | 长 3.8 | 3000 | small corner cafe building, striped red and white awning, large warm glowing windows, two outdoor tables |
| ★★ | `hot_air_balloon` | 热气球 | 高 2.6 | 1200 | hot air balloon with red and yellow stripes, small wicker basket |
| ★★ | `tree_pine` | 松树 | 高 2.8 | **300** | stylized pine tree, two-tier cone foliage, short brown trunk |
| ★★ | `tree_round` | 圆冠树 | 高 2.2 | **300** | stylized round deciduous tree, soft green faceted canopy, short trunk |
| ★ | `bridge` | 石拱桥 | 长 4.4 | 1500 | small stone arch railway bridge, single track deck, grey stone |
| ★ | `mountain` | 雪山 | 高 1（按位置再放大） | 800 | single stylized mountain peak with snow cap, sage green slopes |
| ★ | `city_block` | 城市楼房 | 高 1（按位置再放大） | 400 | simple narrow city apartment building, dark blue facade, small lit windows |
| ★ | `sailboat` | 帆船 | 长 1.6 | 800 | tiny wooden sailboat with one white sail |
| ★ | `beach_umbrella` | 遮阳伞 | 高 1.8 | 300 | beach umbrella, coral and white stripes, thin pole |
| ★ | `street_lamp` | 路灯 | 高 2.1 | 300 | old fashioned cast iron street lamp, single lantern head |
| ★ | `bush` | 灌木 | 最长边 1.0 | **200** | small round green bush with a few tiny flowers |

树和灌木会被摆放几十次，面数一定要压低。整盒每个视点建议控制在 3 万三角面以内（开发指南第 7 章：9 视点 ≤ 30,000）。页面加载时，控制台会打印每个模型的实际面数，超标的会标 ⚠。

## 朝向约定

- 房子、咖啡馆、灯塔等建筑：**正面朝 +Z**，也就是朝向观众。Tripo 默认导出一般就是这个方向。
- 火车头、车厢：车头要朝 **+X**（画面右侧）。代码默认把模型转 90°（`yaw: Math.PI / 2`）；如果导入后车头朝左，在 `assets.js` 里改成 `-Math.PI / 2`。

## 导出检查

1. 格式选 **GLB**，贴图内嵌。
2. 面数：用 Tripo 的面数上限 / 低模选项，或者导出后在 Blender 里用 Decimate 修改器减面。
3. 贴图 ≤ 1024 px。可以用 Draco 或 KTX2 压缩，加载器都支持。
4. 放进 `prototype/assets/models/`，刷新页面，按 `D` 打开调试面板，「模型」一行会列出已替换的槽位。

## 还保留程序化的部分

信封和信纸（需要开封、展开的动画）、轨道、地面、海面波浪、云、烟、花丛、灯光与光晕都继续用代码生成。它们需要跟随世界时间运动，或者本来就很简单。

## 幻境版待接入

这些槽位还没接进代码。现在是程序化占位，见 [幻境版方案.md](幻境版方案.md)。先生成出来看效果，确认后再接。

| 槽位 id | 内容 | 提示词 |
| --- | --- | --- |
| `qingniao` | 青鸟（翅膀、尾羽要能单独摆动，最好分件） | elegant mythical blue-green bird, slender body, long flowing ribbon tail feathers with golden tips, small golden crest, wings spread, graceful, Chinese ink painting inspired |
| `kun` | 鲲 | gentle giant sky whale, smooth body, deep indigo back fading to pale belly, long wing-like pectoral fins, serene, dreamy |
| `unicorn` | 独角白鹿 | graceful white deer with a single slender golden spiral horn, slim legs, soft mane, standing calmly, elegant |
| `floating_island` | 浮空仙山 | small floating rock island, inverted jagged rock bottom, grassy top with two pine trees and a tiny red-pillared pavilion, small waterfall |
| `sky_lantern` | 天灯 | paper sky lantern, warm glowing, simple cylinder shape |

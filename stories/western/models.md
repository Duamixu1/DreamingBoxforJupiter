# A · 西方玄幻 · Tripo 模型清单

先做第一扇窗（晨之苏醒 · 春）。其余三扇等第一扇在盒子里看过效果再列。

## 通用约定

- **提示词用英文**。每条都已带风格词，直接粘贴。
- **负向提示词**（Tripo 有这一栏就填）：

  ```
  text, letters, base, pedestal, ground, platform, fine lace, filigree, intricate ornament, jewelry, beads, thin hair strands, photorealistic, glossy, metallic
  ```

- **面数**：Tripo 有面数上限设置就按表里的填。整扇窗每个视点要控制在 3 万面以内。
- **文件名**：导出 GLB，按"槽位 id"命名，放进 `prototype/assets/models/`。接入代码等模型到了再写。
- **人物和猫要能动**：Tripo 有自动绑骨（Rig）的话，人物用人形骨架，猫用四足骨架，导出时带上骨骼。没有的话就导出静态模型，我在代码里拆成几块分别转动。

## 第一扇窗

按优先级排列。前两个是画面主角，先做。

| 优先级 | 槽位 id | 内容 | 面数上限 | 在场景里的大小 |
| --- | --- | --- | --- | --- |
| ★★★ | `mucha_lady_dawn` | 晨之女 | 8000 | 身高约 10 单位，占画面高度约 65% |
| ★★★ | `mucha_cat` | 黑猫 | 3000 | 身长约 1.3 单位 |
| ★★ | `mucha_tree_blossom` | 开花的杏树 | 1500 | 高约 4 单位，摆 4 棵 |
| ★★ | `mucha_flowers_spring` | 窗台春花丛 | 1000 | 高约 1.5 单位，摆一排 |
| ★★ | `mucha_branch_almond` | 上沿垂下的杏花枝 | 800 | 长约 3 单位，左右各一 |
| ★ | `mucha_swan` | 湖上的天鹅 | 600 | 长约 1.5 单位，2 只 |
| ★ | `mucha_arch` | 尖拱窗框（可选） | 3000 | 内口宽 7.5、高约 14 单位 |

### `mucha_lady_dawn` · 晨之女

> **已接入（2026-10-02，Jupiter 专用版）**：用的是 Tripo 从穆夏原画生成的半浮雕（`art nouveau woman 3d model.glb`，198 万面、68 MB）。用 [tools/jupiter_relief.py](../../tools/jupiter_relief.py) 处理：切下凸出画板的人物（保留眼睛、眉毛这类凸起的小块，删掉贴着画板的芦苇和画框残片）→ 减到 1 万面 → 正面投影展 UV，把高模颜色烘焙到一张 512×1024 的贴图上（整个人物一块，没有接缝）→ 轻微柔化减少串扰 → 只留颜色贴图。得到 0.37 MB 的 `mucha_lady_dawn.glb`。引擎里把她的前后厚度放大 1.8 倍（`createReliefLady` 的 `depthGain`）。镜头始终正面，所以只有正面的浮雕在盒子里成立。
> 没有骨骼、手臂和身体连成一块，所以"举臂伸懒腰"改成：低头 → 慢慢抬头，醒来后晨风吹起下摆，胸口呼吸（都在顶点着色器里，读 worldTime）。要真的伸懒腰，需要一个 A 字站姿、能绑骨的模型，用下面的提示词再生成。
> 第一扇窗现在每个视点约 1.9 万面、50 次绘制。其余三扇如果也用 Tripo 浮雕，同一个脚本直接跑。


```
A graceful slender young woman in Art Nouveau style inspired by Alphonse Mucha, standing upright in A-pose with arms slightly away from the body, long flowing pale apricot and ivory gown with broad smooth folds flaring gently at the hem, a wide ochre gold sash at the waist, hair pinned up in a soft round bun at the back of the head, a crown of large simple spring flowers in pale pink, cream and lavender, calm serene face with simple features, soft muted colors, smooth stylized shapes, matte hand-painted miniature figurine, full body, front view
```

- **用 A 字站姿**：方便绑骨。伸懒腰的动作由代码驱动，不要在生成时摆好姿势。
- **头发盘起来，不要长发**：长发是代码生成的飘带，它同时是猫走的路，要从她的发髻后面飘出来。
- **想更可控的话**：先用图像模型出一张正面 A 字站姿、纯浅灰背景的设定图，再用 image-to-model。设定图提示词见 [refs/prompts.md](refs/prompts.md) 的 `char_dawn`。

### `mucha_cat` · 黑猫

```
A small elegant black cat standing on all four legs in a neutral pose, side view, slim body, large pointed ears, long tail curving upward, pure flat matte black with no fur texture and no markings, smooth simple shapes, bold clean silhouette like an Art Nouveau poster cat, miniature figurine
```

- **要纯黑**：贴图里如果有灰色毛纹或白色斑块，就重新生成。代码会把材质换成纯黑加淡淡的暖色边缘光，所以真正要紧的只有轮廓。
- **要能读出剪影**：耳朵、尾巴、四条腿都要清楚分开，不要贴在一起。

### `mucha_tree_blossom` · 开花的杏树

```
A small stylized blossoming almond tree, slender gently curved brown trunk, a soft rounded canopy made of a few large clusters of pale pink and white blossoms, Art Nouveau style, smooth simple shapes, matte, low poly miniature
```

### `mucha_flowers_spring` · 窗台春花丛

```
A small clump of spring flowers, three tall irises in soft lavender and two white narcissus with pale yellow centers, long smooth sword-shaped green leaves, large simple petals, stylized Art Nouveau, matte miniature, no pot
```

### `mucha_branch_almond` · 垂下的杏花枝

```
A single long almond blossom branch hanging and drooping downward in a gentle S-curve, thin brown twig, clusters of large simple pale pink and white blossoms along it, stylized Art Nouveau, matte miniature, isolated object
```

### `mucha_swan` · 天鹅

```
A stylized white swan gliding, long elegant S-curved neck, wings folded on its back, ivory white body with a soft orange beak, simple smooth shapes, matte miniature, no water
```

### `mucha_arch` · 尖拱窗框（可选）

现在的程序化窗框已经能用。如果想让它更有穆夏的味道，可以试这一条，但不能出现细雕花。

```
A tall slender pointed Gothic window arch frame in Art Nouveau style, ivory with ochre gold trim, one wide smooth rounded molding around the opening, a large plain round medallion on each side pillar, bold clean profile, no carving, no fine ornament, front view, flat back
```

## 拿到模型后先检查

- [ ] 缩小到画面里的实际大小，轮廓还认得出来（尤其是猫和人物的脸）
- [ ] 没有底座、地面和文字
- [ ] 贴图里没有细花纹、蕾丝、珠串（真机上会"花"）
- [ ] 面数没超过上表
- [ ] 人物和猫：骨骼能导出；没有骨骼的话告诉我，我改成拆块转动

## 已接入的布景素材（2026-10-03）

用户在 Tripo 生成的 5 个素材，用 [tools/jupiter_prop.py](../../tools/jupiter_prop.py) 处理：体素重建 → 减面 → 新展 UV → 把原模型颜色烘焙到 512 贴图 → 原点放到底面中心。
（Tripo 网格零件互相穿插，有大量非流形边，直接减面会卡在 1–2 万面或裂开，所以要先体素重建。）

| 槽位 id | 原始素材 | 面数 | 用在 |
| --- | --- | --- | --- |
| `mucha_tree` | low poly tree | 757 | 晨、昼两扇窗的背景树（实例化） |
| `mucha_flower_lily` | low-poly flower | 399 | 晨窗台（与雏菊交替）、昼窗台 |
| `mucha_flower_daisy` | yellow flower | 484 | 晨窗台 |
| `mucha_ornament` | floral sculpture | 674 | 每扇窗窗台两个下角，右侧镜像 |
| `mucha_butterfly` | butterfly | 599 | 晨窗 2 只绕着女子飞，昼窗 3 只；翅膀开合在着色器里做 |
| `mucha_lady_dawn` | art nouveau woman | 8000 | 晨之女（浮雕，tools/jupiter_relief.py） |

没用的：`stylized tree` 是一张印着同一棵树三个视图的平板（设定图），不是可以摆放的树。

预算（桌面统计，未上真机）：停在晨窗约 2.6 万面 / 56 次绘制，昼窗约 2.2 万面；两扇窗之间平移的 2–3 秒里会到 3.6–4.4 万面。真机上平移时如果掉帧，先把平移时的窗台花和远处的树减半。

## 四位女子都已换成 Tripo 浮雕（2026-10-03）

| 槽位 id | 原始素材 | 处理参数（tools/jupiter_relief.py） | 说明 |
| --- | --- | --- | --- |
| `mucha_lady_dawn` | art nouveau woman | `--faces 8000` | 浮雕板 |
| `mucha_lady_noon` | 2 woman | `--faces 8000 --zmax 0.95` | 浮雕板，双手抬到脑后 |
| `mucha_lady_dusk` | 3 female | `--faces 8000 --flip --between -0.092 0.095 --xmax 0.165 --zmin 0.03 --zmax 0.84 --drop 0.15 1 0.45 1` | 盒子式：最前面是一块印着正面像的平板，立体人物其实背对观众，所以要转 180°；去掉窗框的金属细弧 |
| `mucha_lady_night` | 4 woman | `--faces 8000 --zmax 0.95 --zmin 0.05 --drop -1 -0.115 0.5 0.95 --keep 0.05` | 浮雕板，坐着睡；去掉头边的深色方块 |

引擎里：暮之女退到石栏后面（z −1.4），夜之女坐在雪云里（云挡住小腿），不再侧卧。四扇窗停留时每视点约 2.1–2.7 万面。

窗框目前仍是程序化的尖拱，等单独生成的穆夏窗框模型来替换。

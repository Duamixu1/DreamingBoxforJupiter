# A · 西方玄幻 · 概念图提示词（一日四时）

按需求文档的第 3 步：先出概念图，核对之后再列模型清单（`models.md`）。风格依据 [../style.md](../style.md)，分站内容和动作依据 [../scenes.md](../scenes.md)。

生成的图放在这个目录，命名 `s<站号>_<序号>.png`（例如 `s3_02.png`）、`char_<角色>_<序号>.png`、`pose_<角色>_<起/止>_<序号>.png`。选中的那张在文件名后加 `_pick`。

## 工作顺序

1. **四站全景**（图像模型）：定构图、层次、光线。每站出 4–8 张，挑 1 张。
2. **动作的起止姿态**（图像模型）：每位女子、每个猫的关键动作各出"起"和"止"两张，用来确认动作读得懂。
3. **World Labs**：把挑中的全景图喂进去，看前景、中景、后景、远景是否真的分得开。这一步只是**检查深度层次**，生成的场景体量大概率超出每个视点 3 万面的预算，不直接当运行时素材，需要实测。
4. **角色设定图**（图像模型）：单个对象、纯色背景，喂给 Tripo 的 image-to-model。
5. **Tripo**：生成模型；确认能不能自动绑骨骼。提示词和面数到 `models.md` 再定。

## 通用后缀

**风格（正向）**，接在每条全景提示词后面：

```
Art Nouveau style inspired by Alphonse Mucha's The Times of the Day (1899), rendered as a miniature 3D diorama, a woman framed inside a simple tall pointed Gothic window arch in ivory gold with only a bold clean outline, soft muted palette, large simple shapes, smooth flat color areas with soft gradients, gentle rim light instead of outlines, long wide smooth ribbon-like flowing hair, clear separation of foreground, midground, background and far distance, matte materials, vertical composition 10:16
```

**避免（负向）**：

```
outlines, line art, ink lines, fine ornamental patterns, carved ornament, mosaic, lace, filigree, beads, thin hair strands, text, letters, signature, watermark, dark vignette, black edges, photorealistic, high detail texture, busy clutter, train, railway, scary
```

**黑猫**（凡是画面里有猫，都加这一句）：

```
a small cat that is pure flat black with no fur detail and no markings, clean bold silhouette, a very faint warm rim light, carrying a plain ivory envelope in its mouth
```

画幅统一用 **1200×1920**（或工具支持的最接近的 5:8 竖幅）。

---

## 一、四站全景

### s1 · 晨之苏醒（清晨 · 春）

```
Spring dawn. A graceful young woman standing just awake, eyes half closed, slowly raising both arms in a stretch, wearing a light apricot and ivory robe with broad flowing folds, a crown of spring flowers, her long wide pale gold hair lifting in the morning breeze and streaming out of the window to the right. At her feet a small black cat is stretching with its front low and back raised, an ivory envelope beside its paws. In the foreground, a window ledge with clusters of large simple iris and narcissus flowers, and almond blossom branches hanging from the top of the arch. Behind her shoulder, a pale rising sun as a large soft circle half veiled in mist. In the background, blossoming fruit trees; in the far distance, a misty lake with two swans and faint hills. Palette: fresh green, apricot pink, ivory, pale gold.
```

### s2 · 昼之光辉（正午 · 夏）

```
Summer noon. A woman standing in full sunlight, one arm raised high holding a leafy branch above her head, face turned up toward the sun, an ochre gold and ivory robe blown open by a warm wind, a single wheat ear in her hair, her long wide ochre gold hair sweeping around her shoulders and out to the right like a road through the air. A small black cat trotting along her flowing hair, passing right beneath her raised arm. In the foreground, a window ledge with large simple poppies and cornflowers, dense green foliage hanging from the top. Directly behind her head, the bright white noon sun as a large perfect circle with an ochre gold rim. Soft round patches of sunlight through leaves falling on her. In the background a large leafy tree; in the far distance, golden wheat fields rolling to the horizon in a heat haze, a few large butterflies. Palette: ochre gold, wheat yellow, sage green, sky blue.
```

### s3 · 暮之沉思（黄昏 · 秋）

```
Autumn dusk. A woman seated on a stone balustrade, turned sideways, chin resting on one hand, gazing toward the setting sun in quiet reverie, her other hand open palm up with a single autumn leaf landing in it, a russet and plum robe draping heavily, a few autumn leaves in her hair, her long wide russet hair falling beside her and lying along the balustrade like a gentle path. A small black cat sitting next to her with its tail curled, looking the same way at the sunset. In the foreground, a window ledge covered with fallen leaves, red leafy branches hanging from the top, a few leaves drifting down. Behind her, a large deep red setting sun circle. In the background an autumn wood; in the far distance a lake reflecting the afterglow and a V of wild geese, sky fading from amber to plum. Palette: amber, russet, plum, dark gold.
```

### s4 · 夜之安眠（夜晚 · 冬）

```
Winter night. A woman lying on her side asleep on a soft bank of snowy cloud, peaceful, a deep indigo and silver grey robe spreading like the night sky, a thin crescent moon ornament in her hair, her long wide hair flowing up from her into the sky like a dark river with a few large soft stars along it. A small black cat curled up asleep against her, an ivory envelope set down beside it, her hand resting gently near the cat. In the foreground, a snowy window ledge and large soft snowflakes falling. Behind her, a large silver full moon circle. In the background snow-laden pine branches; in the far distance a low snowy plain and a deep indigo sky with a few large soft stars. Quiet, tender, still. Palette: deep indigo, silver grey, snow white, pale moonlight gold.
```

### 四站并排（检查连贯性）

四张挑定以后，再出一张横向长图，检查四扇窗并排时长发是否连成一条路：

```
Four tall pointed Gothic window arches side by side in a row like a polyptych, each containing one season and one time of day: spring dawn, summer noon, autumn dusk, winter night, left to right. A single continuous ribbon of long flowing hair runs from the first woman through all four windows, its color shifting from pale gold to ochre to russet to deep indigo, and a tiny pure black cat walks along it carrying an ivory envelope.
```

（这张是横幅，只用来检查，不进最终画面。）

---

## 二、动作起止姿态

每对图用**同一个种子、同一段描述**，只改姿态那一句，确认两张能平滑过渡。背景可以简化为纯色。

| 编号 | 起 | 止 |
| --- | --- | --- |
| `pose_dawn` | head bowed, eyes closed, hands crossed on her chest, hair hanging down | head lifted, arms stretched up and joined above her head, hair lifted and streaming to the right |
| `pose_noon` | body turned sideways, face looking down to the left | face turned up toward the sun, raised arm opened wide |
| `pose_dusk` | chin on hand, free hand resting on her knee | free hand open palm up holding a single leaf |
| `pose_night` | asleep on her side, hands folded | asleep on her side, one hand resting beside a curled black cat |
| `pose_cat_a` | curled up asleep | stretching, front low, back raised |
| `pose_cat_b` | walking, envelope in mouth | sitting upright, tail curled around its feet |
| `pose_cat_c` | turning in a circle | curled up asleep, eyes closed |

核对：真机上看的是很小的整幅画面，**缩到 30% 时还能一眼看出动作前后的差别**，才算合格。

---

## 三、角色设定图（给 Tripo）

共同要求：**单个对象、居中、纯浅灰背景、无地面无阴影、全身入画**。人物出一张四分之三侧面、一张正面。

**设定图通用后缀**

```
character concept sheet for a 3D miniature figure, single subject centered, full body, plain light grey background, no ground, no shadow, Art Nouveau style inspired by Alphonse Mucha, large simple shapes, broad smooth drapery folds, hair as a few wide smooth ribbons not strands, matte, soft muted colors, no outlines, no text, arms slightly away from the body for rigging
```

| 编号 | 对象 | 提示词主体 |
| --- | --- | --- |
| `char_dawn` | 晨之女 | a slender young woman standing, light apricot and ivory robe, a crown of large simple spring flowers |
| `char_noon` | 昼之女 | a slender woman standing, ochre gold and ivory robe, a single wheat ear in her hair |
| `char_dusk` | 暮之女 | a slender woman seated on a simple block, russet and plum heavy robe, a few large autumn leaves in her hair |
| `char_night` | 夜之女 | a slender woman lying on her side, deep indigo and silver grey robe, a thin crescent moon ornament in her hair |
| `char_cat` | 黑猫 | a small cat standing in a neutral pose, side view, pure flat black, no fur detail, no markings, bold clean silhouette, large ears, long tail |
| `char_swan` | 天鹅 | a swan gliding on water, simple smooth shapes, ivory white |
| `char_butterfly` | 蝴蝶 | a butterfly with large simple wings, pale yellow, no wing pattern |
| `char_goose` | 大雁 | a flying wild goose, wings spread, simple silhouette, grey brown |
| `prop_arch` | 窗框 | a tall slender pointed Gothic window arch frame, ivory gold, bold clean profile, no carving, no ornament, front view |

人物设定图里**不要长发**：长发在原型里用程序化飘带生成，因为它同时是猫走的路径，要能沿曲线精确控制。设定图里的头发只画到肩膀，盘起或束起。

---

## 四、挑图时的判断标准

除了 [../style.md](../style.md) 第 8 节的检查清单，再看三点：

1. **能不能拆层**：想象把图切成 5 片薄板（窗框、窗台花、人物与猫、日月与树、远景），每片里都要有一个能单独做的东西。切不开的图，再好看也不选。
2. **猫是不是一眼就能找到**：画面再繁复，黑猫都必须是第一眼就落到的地方。
3. **缩到 30% 还认不认得出**：女子、圆、猫、信这四样在缩小后仍然清楚。

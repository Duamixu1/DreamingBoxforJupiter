# 世界（world.json）

用户在 `/create` 做的每一卷音乐长卷存在 `prototype/worlds/<编号>/`（不进仓库，含个人照片），相框用 `/device?world=<编号>` 载入。`sample-mucha/` 是手写的样例，用穆夏《一日四时》的素材拼成，可以直接打开 `/device?world=sample-mucha` 看效果。

渲染器：[../src/scroll.js](../src/scroll.js)。网页预览和相框是同一份代码。

## 结构

```json
{
  "version": 1,
  "title": "…", "nameplate": "For You",
  "style": "mucha",                       // 风格卡 id，见 assets/styles/styles.json
  "secondsPerStation": 18,                // 常速下每站的秒数；总时长 = 18 ×（站数 + 1），最后一份留给纪念品
  "wall": "#e9dcc4",                      // 画面以外的底色
  "frame": "assets/styles/mucha/frame.webp", "frameDepth": 2.6,   // 每站最前面的装饰框（可为 null）
  "stations": [
    { "title": "海边", "frame": true,     // frame:false = 这一站不叠装饰框
      "layers": [
        { "id": "sky", "kind": "gradient", "top": "#c9d9e2", "bottom": "#f2e2cf", "depth": -8 },
        { "id": "art", "kind": "card", "src": "art-0.png", "fit": "cover", "depth": -1.5 },
        { "id": "e1", "kind": "model", "src": "assets/models/w_<编号>_e1.glb", "x": 860, "y": 1830, "h": 480, "depth": 0.8, "anim": "sway" }
      ]}
  ],
  "souvenir": { "model": "assets/models/….glb", "text": "愿你一直被温柔对待", "bg": "#efe3cc" },
  "music": { "id": "waltz" }              // waltz / pentatonic / chip / lullaby，见 src/audio.js 的 SONGS
}
```

- 坐标是**站内像素**：一站 = 相框一屏 = 1200 × 1920，原点在左上角。
- `depth`：离焦平面的距离（场景单位），正数朝观众、负数往里，0 最清楚。透视已补偿：镜头停在这一站中央时，图层在屏上的位置和大小就是设计稿上的样子。
- `card`：`x, y, w, h` 指定位置和大小；或 `fit: "cover" | "contain"` 铺满 / 完整放进一站（可加 `zoom`、`dx`、`dy`）。
- `model`：底边中心落在 `(x, y)`，高 `h` 像素。`anim`：`sway` 轻摆、`bob` 上下浮、`spin` 慢转、`drift` 左右飘、`breathe` 呼吸、`none`。动作都很慢、幅度小：透镜屏上快速的小动作会糊。
- `src` 以 `assets/` 开头时相对网站根目录，否则相对这个世界的目录。
- 预算：每个视点 ≤ 3 万面；一屏里的 3D 元素建议不超过 8 个。

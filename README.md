# Jupitermusic · 手摇空间音乐盒

> 打开盒子，看见微缩世界；转动摇柄，小火车穿过共同回忆。停手，世界停下；旅程最后，抵达一封信。

产品方案见 [docs/手摇空间音乐盒_MVP产品与工业设计方案_Gift_Duo.pdf](docs/手摇空间音乐盒_MVP产品与工业设计方案_Gift_Duo.pdf)。本目录是方案第 12 页「02 跑通 手摇 → 时间 → 画面」的可运行原型，**同一份代码**既能在电脑上 2D 预览，也能在 Jupiter 相框上交织成裸眼 3D。

## 三个版本（进行中）

接下来并行做三个故事版本：西方玄幻、东方山海、普通人。原则是**先定故事、再出概念、最后搭 3D**。需求见 [docs/三个版本需求.md](docs/三个版本需求.md)，产出放在 [stories/](stories/)。

## 准备 SDK（克隆仓库后先做）

Jupiter Interlace SDK 来自黑客松开发套件，授权没有明确允许公开分发，所以不放进仓库。从开发套件解出来放到这里：

```bash
unzip "Developer Kit_中文/Resources/For Advanced Developer/SDK/Jupiter-Interlace-SDK-v1.0.0-中文.zip" -d /tmp/jsdk
mkdir -p prototype/vendor/jupiter-sdk
cp -R /tmp/jsdk/Jupiter-Interlace-SDK-v1.0.0-CN/dist/jupiter-interlace.standalone.js /tmp/jsdk/Jupiter-Interlace-SDK-v1.0.0-CN/dist/decoders prototype/vendor/jupiter-sdk/
```

示例照片（`prototype/assets/photos/`）也不在仓库里。明信片默认关闭，不影响运行。

## 运行

```bash
python3 Jupitermusic/serve.py
```

用 `serve.py` 而不是 `python3 -m http.server`：后者会让浏览器缓存 JS 模块，改了 `config.js` 或换了模型，刷新后看到的还是旧版本。

| 地址 | 用途 |
| --- | --- |
| `http://localhost:5173/` | 桌面预览：木盒外观、点盖子打开、拖右侧摇柄（或按住空格） |
| `…/?device` | 相框模式：全屏、无木盒外观、默认交织 3D；输入来自实体摇柄 |
| `…/?debug` | 打开调试面板（任何时候按 `D` 也行）：状态、摇速、进度、校准参数 |
| `…/?open` | 载入即开盖，调试用 |
| `…/?auto` | 匀速自动摇（没接实体摇柄时看连贯效果）；相框上也可以手指绕屏幕中心画圈来摇 |
| `…/calibrate.html` | 屏幕校准：没有背标签时用测试图目测 Pitch / Offset，保存后音乐盒直接读取 |

快捷键：`L` 开合盖 · 按住 `空格` 匀速摇 · 滚轮也能摇 · `Shift+R` 演示重置 · `D` 调试面板

## 制作端（送礼人的手机网页）

`http://<电脑IP>:5173/make/`，按 iPhone 17 Pro（402 × 874 pt）设计，电脑上显示为同比例的手机框。

五步：送给谁 → 传 1–5 张旅行照片（每张一句话）→ 确认识别结果（地名、做成 3D 的地标、地貌、时段，点照片可重新框选地标）→ 写信 → 生成。生成后得到礼物编号；木盒打开 `/?device&journey=<编号>`，或 `/?device&journey=latest` 直接载入最新一份。

| 能力 | 开启方式 | 没开启时 |
| --- | --- | --- |
| 照片识别（Claude） | 用下面的 `uv run … --with anthropic` 启动，配置 `ANTHROPIC_API_KEY` | 用户在第 3 步手动选地貌、时段，手写地标 |
| 地标 3D 生成（Tripo） | 设置环境变量 `TRIPO_API_KEY` | 每站用该地貌的默认地标 |

```bash
ANTHROPIC_API_KEY=… TRIPO_API_KEY=… uv run --python 3.12 --with anthropic Jupitermusic/serve.py
```

系统自带的 Python 3.9 装不了新版 anthropic（需要 3.10+），所以用 uv 临时带上 Python 3.12 和 anthropic 运行，不改系统环境。不需要识别时，`python3 Jupitermusic/serve.py` 也能跑。

照片在手机上先缩到 1600 px 再上传；地标框裁出来送给 Tripo（`image-to-model`，3000 面以内），没框就用文字生成（`text-to-model`）。旅程存在 `prototype/journeys/<编号>/`（`journey.json`、照片、地标 GLB）。接口说明见 [musicbox_api.py](musicbox_api.py) 开头。服务开在局域网里，没有账号和鉴权，只适合演示。

## 已实现（对照方案）

| 方案要求 | 实现 |
| --- | --- |
| 统一世界时间（第 07 页） | `worldclock.js`：转角 → 平滑转速 → `worldSpeed`（上限 2.5×）→ `worldTime`；火车、烟、云、树叶、海浪、灯塔光束、萤火虫全部读同一个时间，停摇即全部静止，不做惯性滑行 |
| 停下的是故事，不是显示 | 停摇时渲染循环照常跑，视差与立体感保留 |
| 反向不倒带 | 反向输入只转动摇柄，不推进也不倒放 |
| 音乐只看摇没摇（第 08 页） | `audio.js`：原创 3/4 拍音乐盒小曲，实时合成；开始摇淡入、停手淡出暂停、再摇从暂停的那一拍继续；不变速不变调 |
| 开合状态 | 合盖：屏幕变暗、音乐淡出、进度保留；开盖后 0.8 s 内不推进（点亮过渡不提前推进故事） |
| 一条旅程 3–5 站（第 09 页） | 家 → 第一次旅行 → 海边 → 夜晚的咖啡馆 → 森林与来信；白天 → 日落 → 夜晚 |
| 终点也是手摇 | 火车减速进站后继续摇：信封升起、开封、抽出信纸、展开；读完后保持画面，不自动重播 |
| 空间层次（第 10 页） | 前景花丛 / 中景火车 / 后景地标 / 远景山与天空；景物铺满画面两侧（不做深色内壁，相框上会读成黑边） |
| 演示可复位 | `Shift+R` 或实体背面隐藏按钮，正面不加按钮 |
| 常速时长 60–90 s | 1 圈/秒常速约 75 s，在 `config.js` 的 `TUNING.journeyDuration` 调 |

换收礼人、换信、调手感、填设备参数都只改 [prototype/src/config.js](prototype/src/config.js)。

## 尺寸与硬件

- **竖放**。Jupiter 原生竖屏 1200×1920，透镜柱沿竖屏方向排布；横放会把左右眼视差变成上下视差，立体感就没了。舞台按 10:16 竖屏构图。
- 预览页的盒子按 `config.js` 里 `HARDWARE` 的毫米数换算：显示组件 164.06 × 262.06 mm（含自带木框，不可拆），外壳木壁 14 mm、顶边 14 mm、底座电子仓 48 mm，外廓 **192 × 324 mm**。外壳数值是起点，按实物和 CAD 调整即可，页面会跟着变。
- 屏幕可视区暂按 10.1" 面板估算为 135.4 × 216.6 mm，**需用实物复核**。

## 用 Tripo 精细化模型

生成清单、提示词、尺寸和面数预算见 [docs/Tripo模型清单.md](docs/Tripo模型清单.md)。把 GLB 命名为 `<槽位 id>.glb` 放进 `prototype/assets/models/`，刷新即替换；没放的继续用程序化占位。树、灌木这类重复物件会自动实例化，按站点分块剔除，加多少棵也只多几次绘制。

## 文件

```
prototype/
  index.html            木盒外观、上盖、摇柄、调试面板
  calibrate.html        屏幕校准测试图（Pitch / Offset）
  src/config.js         故事 / 手感 / 输入 / 显示参数（唯一需要改的文件）
  src/worldclock.js     世界时间
  src/crank.js          输入统一：屏幕摇柄、空格、滚轮、实体摇柄（HID 键盘）
  src/audio.js          音乐盒合成器、火车声、棘轮声、到站铃
  src/assets.js         Tripo 模型槽位、GLB 加载与实例化
  src/scene.js          微缩世界：六种地貌模板、火车、明信片、信件
  src/myth.js           幻境层：连续地形、远山、浮空仙山、云海过渡、青鸟 / 鲲 / 独角白鹿 / 天灯
  src/kit.js            布景通用零件：随机数、缓动、基础几何体、顶点色合批
  make/                 制作端网页（index.html、make.css、make.js）
  journeys/             用户做好的旅程（运行时生成）
  src/main.js           状态机与主循环
  assets/models/        放 Tripo GLB 的地方
  vendor/jupiter-sdk/   Jupiter Interlace SDK 1.0.0 独立版（内置 Three.js r180）及 Draco / KTX2 解码器
serve.py                本地服务器（不缓存）+ 制作端接口
musicbox_api.py         识别、保存旅程、Tripo 生成地标
firmware/crank_hall/    Pro Micro 固件：EC11 编码器 + 霍尔开盖 → USB 键盘
docs/                   产品方案 PDF、SDK 开发者指南、Tripo 模型清单
```

## 上相框

1. 相框背标签的 **Pitch / Offset** 填进 `config.js` 的 `DISPLAY.calibration`（Tan 固定 10），或在调试面板里调好后点「保存参数到本机」。
2. 电脑和相框连同一 Wi-Fi，电脑运行 `python3 Jupitermusic/serve.py`，相框浏览器打开 `http://<电脑IP>:5173/?device`。
3. 先 9 视点；卡顿降到 5 / 3 视点或降低单视点宽度，**不要降最终画布分辨率**。立体感用「视点间距」「焦平面距离」调，焦平面默认 26 = 轨道所在深度，火车最清晰。

性能预算：Jupiter 每帧要画 9 次场景（RK3566 / Mali-G52），所以静态布景合并成 5 个网格、不开阴影、不用点光源，每个视点约 25 次绘制（按场景结构计数，未在真机实测帧率）。

## 实体摇柄

固件见 [firmware/crank_hall/crank_hall.ino](firmware/crank_hall/crank_hall.ino)。Pro Micro 以 USB 键盘身份接入：每转过一个编码器定位发一次 `]`，开合盖发 `o` / `c`。Android 上不需要驱动和 Web Serial，电脑上也能直接插着测。编码器每圈定位数改 `INPUT.hidTicksPerRev`。

## 读完开发套件后需要团队确认的事

1. **外形改为竖向**：已按硬件改成竖放，外廓约 192 × 324 mm，和方案概念图的 200 × 150 × 170 mm 横向木盒不同，工业设计的外观图需要重画。斜置角度、上盖开合方式也要按竖向重新考虑。
2. **正面木框不能拆**：开发指南要求屏幕和表面木框始终是一个完整组件。这反而和方案的「舞台外框」吻合，外壳应围绕这个木框来设计。
3. **相框上用什么浏览器**：主板是 Android 11。需要确认有可用的 Chrome / WebView，必要时用 LocalSend 或无线 ADB 装一个，或套一个全屏 WebView 外壳。
4. **USB 接口**：主板 3 路 USB Host（J23 / J13 / J24，1.25 mm 4 针：+5V、D−、D+、GND），另有 Type-C OTG（默认 OTG，可配置为 Host）。摇柄控制板接 Host 口最直接，需要做一根 1.25 mm 转 USB 的线。
5. **扬声器**：主板 J7 立体声功放，8 Ω 1.5 W / 3 W。音乐通过 Android 系统音频输出，声腔向下开孔（方案第 08 页）需要实听。
6. **音频解锁**：浏览器要用户手势后才能出声。相框上第一次转摇柄产生的 HID 按键就算手势，但第一下摇动可能不出声，需要实机确认。

## 还没做

- 真机光学验证：串扰、观看距离、斜置角度下的立体效果
- 演示视频 / 截图归档
- 摇柄阻尼手感（硬件）

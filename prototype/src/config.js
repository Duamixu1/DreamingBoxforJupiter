// 手摇空间音乐盒 · 所有可调内容集中在这里。
// 换收礼人、换信、调手感、填设备参数，只改这个文件。

// —— 故事内容 ——————————————————————————————————————————
export const STORY = {
  nameplate: 'For You',
  stations: [
    // 默认演示旅程。用户在制作端（/make/）上传照片后，木盒用 ?journey=<id> 载入他们自己的旅程。
    // biome：countryside 田园 / mountain 山野 / seaside 海边 / city 城市 / forest 森林 / snow 雪地
    // timeOfDay：dawn 清晨 / day 白天 / dusk 黄昏 / night 夜晚
    // photo / caption：到站明信片（选填）
    { name: '家 · 出发的小屋', biome: 'countryside', timeOfDay: 'day', photo: 'assets/photos/sample-cottage.jpg', caption: '出发的那个早上' },
    { name: '第一次旅行', biome: 'mountain', timeOfDay: 'day', photo: 'assets/photos/sample-mountain.jpg', caption: '第一次看见雪山' },
    { name: '海边', biome: 'seaside', timeOfDay: 'dusk', photo: 'assets/photos/sample-lighthouse.jpg', caption: '风很大的那天' },
    { name: '夜晚的咖啡馆', biome: 'city', timeOfDay: 'night' },
    { name: '森林与来信', biome: 'forest', timeOfDay: 'night' },
  ],
  letter: {
    greeting: '亲爱的你：',
    lines: [
      { text: "For all the places we've been,", style: 'en' },
      { text: "and all the places we haven't.", style: 'en' },
      { gap: 1 },
      { text: '献给我们去过的地方，', style: 'zh' },
      { text: '也献给尚未抵达的远方。', style: 'zh' },
    ],
    signature: '— Gift Duo',
    date: '2026 · 秋',
  },
};

// —— 穆夏《一日四时》版（stories/western）——————————————————————
// 四扇尖拱窗：晨春 / 昼夏 / 暮秋 / 夜冬。黑猫叼着信踩着长发走完一天，最后在夜的身边睡下。
export const MUCHA = {
  secondsPerStation: 20, // 4 站 × 20 = 80 秒（含信件展开），旅程本身约 69 秒
  stations: [
    { name: '晨之苏醒', season: 'dawn' },
    { name: '昼之光辉', season: 'noon' },
    { name: '暮之沉思', season: 'dusk' },
    { name: '夜之安眠', season: 'night' },
  ],
  letter: {
    greeting: '亲爱的你：',
    lines: [
      { text: '从清晨到深夜，', style: 'zh' },
      { text: '从春天到冬天，', style: 'zh' },
      { gap: 1 },
      { text: '我都在想你。', style: 'zh' },
    ],
    signature: '— Gift Duo',
    date: '2026 · 秋',
  },
};

// —— 画面开关 ——————————————————————————————————————————
export const SCENE = {
  theme: 'mucha',   // mucha：一日四时（黑猫）；classic：小火车旅程。网址 ?theme= 可临时切换；?journey= 总用 classic
  postcards: false, // 到站明信片：真机上照片细节太花，先关掉
};

// —— 世界时间与手感（对应方案第 07 页）——————————————————————
export const TUNING = {
  secondsPerStation: 15,  // 常速（1 圈/秒）下每站的世界时间；5 站 ≈ 75 秒，落在 60–90 秒目标内
  trainPhaseEnd: 0.86,    // 进度 0 → 0.86 是火车旅程，之后继续摇 = 信件展开
  speedPerRev: 1.0,       // 1 圈/秒 → 1× 世界速度
  maxWorldSpeed: 2.5,     // 速度上限，避免内容一闪而过
  rateSmoothing: 0.12,    // 转速平滑时间常数，秒
  stopTimeout: 0.2,       // 多久没有正向输入判定为停摇，秒
  stopEase: 0.07,         // 停摇后的极短缓停，秒（不做惯性滑行）
  lidSettle: 0.8,         // 开盖动画后多久开始接受手摇，秒
};

// —— 输入映射 ——————————————————————————————————————————
export const INPUT = {
  keyboardRevPerSec: 1.0, // 桌面预览：按住空格 = 匀速 1 圈/秒
  wheelRadPerPixel: 0.012,
  // 实体摇柄：Pro Micro 以 USB 键盘身份接入，每个编码器定位 = 一次按键
  hidTicksPerRev: 20,     // EC11 常见 20 定位/圈，按实物修改
  hidKeys: { forward: ']', backward: '[', lidOpen: 'o', lidClose: 'c' },
};

// —— 硬件尺寸（mm）——————————————————————————————————————————
// 显示组件来自开发指南第 11 节 CAD 包络；屏幕与正面木框是一个整体，不可拆分。
// 原生竖屏 1200×1920：透镜柱沿竖屏方向排布，横放会把左右视差变成上下视差，立体失效，所以只能竖放。
export const HARDWARE = {
  module: { w: 164.06, h: 262.06, d: 9.35 },
  panel: { w: 135.4, h: 216.6, px: [1200, 1920] }, // 可视区按 10.1" 面板估算，待用实物复核
  shell: { wall: 14, top: 14, base: 48 },          // 外壳木壁 / 顶边 / 底座电子仓（方案第 05 页）
};

// —— Jupiter 显示参数（填本机背标签的 Pitch / Offset，tan 固定 10）————
export const DISPLAY = {
  calibration: { pitch: 0.27777, tan: 10, offset: 2, order: 'forward', subpixelOrder: 'RGB', rotation: 0 },
  render: { views: 9, viewWidth: 640, viewSpacing: 0.08, focusDistance: 26, toneMapping: 'aces', exposure: 1 },
};

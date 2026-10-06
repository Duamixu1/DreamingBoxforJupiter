// 穆夏《一日四时》四幅原画的元素拆分（布景工作台「三版对照」读这里；说明见 stories/western/layers.md）。
// 坐标是占原画宽高的百分比（0–100），按扫描版 740×2000 目测，不求像素级准确：
// 目的是做出多层次的立体效果，原画元素当参考，不是一比一还原。
//
// depth：离焦平面的距离（场景单位，和盒子里一致：正数朝观众、负数往里）。焦平面 = 人物所在深度。
// make：这个元素以后怎么做：tripo（生成 3D 模型）/ card（原画贴片，2D 抠图放到对应深度）/ code（程序化）

// 外框：整幅画去掉中间的尖拱窗口；最下面的标题字（95% 以下）一律不要，细小文字在透镜屏上会串扰
export const OPENING = [[9, 94], [9, 30], [11, 21], [16, 14], [24, 9.5], [37, 7], [50, 6.3], [63, 7], [76, 9.5], [84, 14], [89, 21], [91, 30], [91, 94]];
const OUTER = [[1, 0.5], [99, 0.5], [99, 95], [1, 95]];

export const LAYERS = {
  dawn: {
    title: '晨之苏醒', scan: 'scan-1-dawn.jpg', photoRect: [0.0, 1.45, 98.4, 99.33], photo: 'photo-1-dawn.jpg',
    elements: [
      { id: 'backdrop', name: '天空、湖与草地', depth: -7, make: 'card', poly: OPENING, note: '整片背景，最远一层' },
      { id: 'reeds', name: '身后的细高芦苇', depth: -3, make: 'tripo', poly: [[14, 9], [42, 7], [44, 30], [38, 56], [16, 60]], note: '成排的竖线，放在人物和背景之间，视差最明显' },
      { id: 'trunk', name: '左下的深色树干', depth: -1.5, make: 'card', poly: [[6, 51], [23, 54], [25, 67], [7, 69]] },
      { id: 'figure', name: '晨之女', depth: 0, make: 'tripo', poly: [[45, 16.5], [58, 17], [62, 24], [60, 30], [70, 36], [66, 48], [72, 60], [68, 75], [58, 82], [42, 82], [30, 72], [24, 58], [26, 42], [34, 34], [42, 28], [42, 20]], note: '已有浮雕模型 mucha_lady_dawn' },
      { id: 'scarf', name: '斜扫过身前的长纱', depth: 1.4, make: 'card', poly: [[70, 37], [85, 33], [87, 47], [62, 70], [42, 93], [21, 93], [30, 80], [55, 61]], note: '压在人物前面，前后层次的关键' },
      { id: 'frame', name: '外框（含上角百合、底部翼饰）', depth: 3.2, make: 'tripo', poly: OUTER, hole: OPENING, note: '最近一层；细线条要加粗、简化' },
    ],
  },
  noon: {
    title: '昼之光辉', scan: 'scan-2-noon.jpg', photoRect: [0.01, 0.48, 97.41, 98.94], photo: 'photo-2-noon.jpg',
    elements: [
      { id: 'backdrop', name: '天空、云、海平线、沙丘', depth: -7, make: 'card', poly: OPENING },
      { id: 'streamers', name: '人物右侧的橙红飘带', depth: -1.2, make: 'card', poly: [[60, 21], [80, 22], [82, 46], [64, 46]] },
      { id: 'figure', name: '昼之女（双手抬到脑后）', depth: 0, make: 'tripo', poly: [[40, 11], [61, 11], [66, 22], [62, 30], [64, 45], [66, 62], [64, 80], [60, 92], [40, 92], [36, 78], [36, 60], [38, 40], [36, 28], [36, 19]], note: '已有浮雕模型 mucha_lady_noon' },
      { id: 'daisyL', name: '左侧雏菊花茎', depth: 1.6, make: 'tripo', poly: [[14, 37], [40, 39], [43, 70], [30, 79], [14, 71]], note: '大花头、长茎，最好的前景层' },
      { id: 'daisyR', name: '右侧雏菊花茎', depth: 1.2, make: 'tripo', poly: [[57, 45], [91, 51], [91, 73], [59, 73]] },
      { id: 'frame', name: '外框（含深色格纹花饰）', depth: 3.2, make: 'tripo', poly: OUTER, hole: OPENING },
    ],
  },
  dusk: {
    title: '暮之沉思', scan: 'scan-3-dusk.jpg', photoRect: [1.11, 0.85, 97.71, 99.68], photo: 'photo-3-dusk.jpg',
    elements: [
      { id: 'backdrop', name: '晚霞与远景', depth: -7, make: 'card', poly: OPENING },
      { id: 'blossom', name: '上方开粉花的枯枝', depth: -3.5, make: 'tripo', poly: [[10, 8], [62, 7], [62, 22], [44, 36], [12, 36]] },
      { id: 'foliage', name: '左下的枝叶', depth: -1, make: 'card', poly: [[8, 58], [30, 60], [32, 80], [8, 82]] },
      { id: 'figure', name: '暮之女（坐着、手托下巴）', depth: 0, make: 'tripo', poly: [[34, 22.5], [50, 21.5], [54, 30], [66, 33], [80, 40], [90, 52], [84, 60], [74, 64], [70, 80], [60, 88], [44, 88], [40, 72], [30, 60], [26, 46], [30, 34]], note: '已有浮雕模型 mucha_lady_dusk' },
      { id: 'reeds', name: '弯过身前的长绿草茎', depth: 1.5, make: 'tripo', poly: [[53, 7], [61, 7], [59, 40], [53, 70], [47, 87], [39, 87], [45, 68], [51, 40]], note: '一条长弧线压在人物前面' },
      { id: 'frame', name: '外框（含上角银莲花）', depth: 3.2, make: 'tripo', poly: OUTER, hole: OPENING },
    ],
  },
  night: {
    title: '夜之安眠', scan: 'scan-4-night.jpg', photoRect: [3.49, 0.0, 98.29, 99.89], photo: 'photo-4-night.jpg',
    elements: [
      { id: 'backdrop', name: '夜空与远景', depth: -7, make: 'card', poly: OPENING },
      { id: 'moontrees', name: '月亮与柏树剪影', depth: -4, make: 'card', poly: [[40, 9], [90, 10], [90, 36], [40, 34]] },
      { id: 'rock', name: '她坐着的深红岩石', depth: -0.8, make: 'tripo', poly: [[58, 52], [92, 55], [92, 91], [68, 91]] },
      { id: 'figure', name: '夜之女（坐着睡着）', depth: 0, make: 'tripo', poly: [[34, 26.5], [50, 25.5], [56, 32], [70, 38], [80, 46], [84, 58], [80, 72], [70, 84], [52, 90], [34, 86], [24, 70], [18, 56], [22, 44], [30, 36]], note: '已有浮雕模型 mucha_lady_night' },
      { id: 'frame', name: '外框（含上角罂粟）', depth: 3.2, make: 'tripo', poly: OUTER, hole: OPENING, note: '罂粟是睡眠之花，可以单独做成前景花饰' },
    ],
  },
};
export const ORDER = ['dawn', 'noon', 'dusk', 'night'];
// photoRect：实拍高清版里，和扫描版 0–100% 对应的那块区域（照片坐标的百分比，自动对齐得到）。
// 所有多边形都用扫描版坐标；看高清版时按这个矩形换算，抠图才不会偏
export const MAKE_LABEL = { tripo: 'Tripo 3D', card: '原画贴片', code: '程序化' };
export const LAYER_COLOR = (depth) => (depth <= -5 ? '#6f8fc4' : depth < 0 ? '#9daf8c' : depth === 0 ? '#c9a55a' : depth < 3 ? '#d08a3c' : '#a8323e');

// Jupiter 显示组件（见 config.js 的 HARDWARE）：屏幕可视区 135.4 × 216.6 mm、1200 × 1920 px、10:16 竖放；连木框 164.06 × 262.06 mm
export const SCREEN = { w: 135.4, h: 216.6, px: [1200, 1920], module: { w: 164.06, h: 262.06 } };

// 主循环：开合 + 手摇 → 世界时间 → 画面 / 声音。
// ?device 进入相框模式：全屏、无木盒外观、默认交织输出；摇柄与霍尔传感器经 USB HID 键盘接入。
import { THREE, InterlaceRenderer, createCalibrationPanel } from './three.js';
import { DISPLAY, TUNING, INPUT, STORY } from './config.js';
import { createWorld, clip } from './scene.js';
import { loadModels, loadLandmarks } from './assets.js';
import { WorldClock, trainDistance, letterPhase } from './worldclock.js';
import { CrankInput } from './crank.js';
import { MusicBox } from './audio.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const deviceMode = params.has('device');
document.body.classList.toggle('device', deviceMode);

// —— 渲染 ——
const host = $('#screen');
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.localClippingEnabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.prepend(renderer.domElement);

const PROFILE_KEY = 'jupitermusic.profile';
const interlacer = new InterlaceRenderer(renderer, {
  calibration: DISPLAY.calibration,
  render: { ...DISPLAY.render, mode: deviceMode ? 'interlaced' : '2d' },
});
try {
  const saved = localStorage.getItem(PROFILE_KEY);
  if (saved) interlacer.importProfile(saved);
} catch { /* 无本地存储时用 config.js 的值 */ }
if (params.get('mode')) interlacer.setOptions({ mode: params.get('mode') });
let renderMode = interlacer.getProfile().render.mode;
interlacer.subscribe((p) => { renderMode = p.render.mode; });

// —— 旅程：默认演示旅程，或制作端生成的 ?journey=<id> ——
async function loadStory() {
  let id = params.get('journey');
  if (id === 'latest') {
    try { id = (await (await fetch('/api/journeys/latest', { cache: 'no-store' })).json()).id; }
    catch { id = null; }
  }
  if (!id || !/^[a-z0-9]{6,32}$/.test(id)) return { story: STORY, base: location.href };
  const base = new URL(`journeys/${id}/`, location.href).href;
  try {
    const res = await fetch(base + 'journey.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    // 照片和模型路径相对旅程目录
    const stations = j.stations.map((st) => ({ ...st, photo: st.photo ? new URL(st.photo, base).href : undefined }));
    return { story: { ...STORY, nameplate: j.recipient || STORY.nameplate, stations, letter: { ...STORY.letter, ...j.letter } }, base };
  } catch (err) {
    console.warn(`旅程 ${id} 载入失败，改用默认旅程：`, err);
    return { story: STORY, base: location.href };
  }
}
const { story, base: storyBase } = await loadStory();
$('#nameplate').textContent = story.nameplate.toUpperCase();

// 先加载 Tripo 模型：assets/models 里的布景槽位 + 这段旅程每站的地标；缺的用程序化占位
const templates = await loadModels(renderer, clip);
for (const [k, v] of await loadLandmarks(renderer, clip, story.stations, storyBase)) templates.set(k, v);
const world = createWorld(story, templates);
const JOURNEY_LENGTH = world.journeyLength;
const resize = () => {
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(host.clientWidth, host.clientHeight);
  world.setAspect(host.clientWidth / host.clientHeight);
};
new ResizeObserver(resize).observe(host);
resize();

// —— 状态 ——
const clock = new WorldClock(TUNING.secondsPerStation * story.stations.length);
const music = new MusicBox();
let lidOpen = false, lidChangedAt = -10;
let done = false, arrived = false, everCranked = false;
let lastChuff = 0, tickAcc = 0;

function setLid(open) {
  if (open === lidOpen) return;
  lidOpen = open;
  lidChangedAt = performance.now() / 1000;
  document.body.classList.toggle('open', open);
  if (!open) music.pause(0.3); // 合盖：保留进度，音乐淡出
}

function resetDemo() {
  clock.reset();
  music.reset();
  world.reset();
  done = arrived = false;
  lastChuff = 0;
}

const crank = new CrankInput({
  widget: $('#crank'), arm: $('#crank-arm'), onLid: setLid,
  surface: deviceMode ? document.body : null, auto: params.has('auto'),
});

// 浏览器要求用户手势后才能出声；相框上第一次 HID 按键同样算手势
const unlock = () => {
  music.ensure();
  if (deviceMode && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
};
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

$('#lid').addEventListener('click', () => setLid(!lidOpen));
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea')) return;
  if (e.key === 'l' || e.key === 'L') setLid(!lidOpen);
  else if (e.key === 'd' || e.key === '`') toggleDebug();
  else if (e.key === 'R' && e.shiftKey) resetDemo();
});

// 桌面 2D 预览：鼠标位置带一点视差
const parallax = { x: 0, y: 0 }, still = { x: 0, y: 0 };
host.addEventListener('pointermove', (e) => {
  const r = host.getBoundingClientRect();
  parallax.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
  parallax.y = ((e.clientY - r.top) / r.height - 0.5) * -2;
});
host.addEventListener('pointerleave', () => { parallax.x = parallax.y = 0; });

// —— 主循环 ——
let prev = performance.now() / 1000;
renderer.setAnimationLoop((ms) => {
  const now = ms / 1000;
  const dt = Math.min(Math.max(now - prev, 1e-4), 0.05);
  prev = now;

  const { raw, forward } = crank.consume(dt);
  if (raw > 0) {
    tickAcc += raw;
    if (tickAcc > Math.PI / 6) { tickAcc %= Math.PI / 6; music.tick(); }
  }

  const enabled = lidOpen && now - lidChangedAt > TUNING.lidSettle && !done;
  clock.update(dt, forward, enabled);
  if (clock.isCranking && !done) {
    music.play();
    if (!everCranked) { everCranked = true; document.body.classList.add('cranked'); }
  } else music.pause();

  const p = clock.progress;
  const dist = trainDistance(p, JOURNEY_LENGTH);
  if (dist - lastChuff >= 1.1) {
    lastChuff = dist;
    if (dist < JOURNEY_LENGTH - 0.05) music.chuff(Math.min(1, 0.5 + clock.worldSpeed * 0.4));
  }
  if (!arrived && dist >= JOURNEY_LENGTH - 0.01) { arrived = true; music.chime(); }
  if (!done && p >= 1) { done = true; music.pause(2.2); }

  world.update({
    worldTime: clock.worldTime, dist, letterU: letterPhase(p),
    parallax: renderMode === '2d' && !deviceMode ? parallax : still,
  });
  if (host.clientWidth > 0 && host.clientHeight > 0) {
    try { interlacer.render(world.scene, world.camera); }
    catch (err) { reportOnce(err); }
  }
  hud(now, p, dist);
});

// 截图：当场渲染一帧并立刻读画布（drawing buffer 只在本帧有效），经 serve.py 存成 PNG。
// 不依赖 requestAnimationFrame，页面在后台时也能用。
function renderNow() {
  const p = clock.progress;
  world.update({ worldTime: clock.worldTime, dist: trainDistance(p, JOURNEY_LENGTH), letterU: letterPhase(p), parallax: still });
  interlacer.render(world.scene, world.camera);
}
const capture = (name = `frame-${Date.now()}`) => new Promise((resolve) => {
  renderNow();
  renderer.domElement.toBlob((blob) => {
    fetch(`/__capture?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob })
      .then((r) => resolve(r.ok ? `captures/${name}.png` : `保存失败 ${r.status}`), (e) => resolve(String(e)));
  }, 'image/png');
});
// 调试用：以固定摇速快进世界（烟、云等按真实摇动的轨迹生成）
function simulate(seconds, revPerSec = 1) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    clock.update(dt, revPerSec * Math.PI * 2 * dt, true);
    const p = clock.progress;
    world.update({ worldTime: clock.worldTime, dist: trainDistance(p, JOURNEY_LENGTH), letterU: letterPhase(p), parallax: still });
  }
}

let reported = false;
function reportOnce(err) {
  if (reported) return;
  reported = true;
  console.error(err);
}

// —— 调试面板（D 键 / 反引号）——
let panel = null, lastHud = 0;
function toggleDebug() {
  const on = document.body.classList.toggle('debug');
  if (on && !panel) panel = createCalibrationPanel(interlacer, $('#calib'));
}
function phaseName() {
  if (!lidOpen) return '合盖';
  if (done) return '信件读完';
  if (clock.isCranking) return '摇动中';
  return clock.worldTime > 0 ? '停摇' : '开盖待摇';
}
function hud(now, p, dist) {
  if (!document.body.classList.contains('debug') || now - lastHud < 0.2) return;
  lastHud = now;
  const s = interlacer.getStats();
  $('#stats').textContent = [
    `状态      ${phaseName()}`,
    `输入      ${crank.source}`,
    `摇速      ${clock.crankRate.toFixed(2)} 圈/秒`,
    `世界速度  ${clock.worldSpeed.toFixed(2)}×`,
    `世界时间  ${clock.worldTime.toFixed(1)} / ${clock.duration} s`,
    `进度      ${(p * 100).toFixed(1)}%   ${world.stationAt(dist).name}`,
    `音乐      ${music.playing ? '播放' : '暂停'}  第 ${music.step} 拍`,
    `模型      ${templates.size ? [...templates.keys()].join(' ') : '全部程序化占位'}`,
    `输出      ${renderMode} · ${s.width}×${s.height} · ${s.views} 视点 · CPU ${s.cpuMs.toFixed(1)}ms`,
  ].join('\n');
}

$('#btn-mode').addEventListener('click', () => interlacer.setOptions({ mode: renderMode === '2d' ? 'interlaced' : '2d' }));
$('#btn-lid').addEventListener('click', () => setLid(!lidOpen));
$('#btn-reset').addEventListener('click', resetDemo);
$('#btn-save').addEventListener('click', () => {
  try { localStorage.setItem(PROFILE_KEY, interlacer.exportProfile()); $('#btn-save').textContent = '已保存 ✓'; }
  catch { $('#btn-save').textContent = '保存失败'; }
  setTimeout(() => { $('#btn-save').textContent = '保存参数到本机'; }, 1500);
});
$('#btn-full').addEventListener('click', () => document.documentElement.requestFullscreen?.());
$('#btn-shot').addEventListener('click', async () => { $('#btn-shot').textContent = await capture(); setTimeout(() => { $('#btn-shot').textContent = '截图'; }, 2000); });
$('#hid-keys').textContent = `${INPUT.hidKeys.forward} 正转 · ${INPUT.hidKeys.backward} 反转 · ${INPUT.hidKeys.lidOpen} 开盖 · ${INPUT.hidKeys.lidClose} 合盖`;

if (params.has('debug')) toggleDebug();
if (params.has('open')) setLid(true);

// 仅供调试与自动验证
window.musicbox = { clock, music, setLid, resetDemo, interlacer, capture, simulate, get lidOpen() { return lidOpen; } };

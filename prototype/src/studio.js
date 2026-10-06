// 布景工作台：电脑上直接看四扇窗、左右拖动，选槽位上传 2D 图 → Tripo 生成 3D → 处理 → 放进来，只看进度。
// 后端见 Jupitermusic/studio_api.py。画面和盒子里是同一套布景（mucha.js），只是镜头由你拖。
import { THREE, InterlaceRenderer, GLBLoader } from './three.js';
import { DISPLAY, MUCHA, STORY } from './config.js';
import { createMuchaWorld, loadMuchaModels } from './mucha.js';
import { letterPhase } from './worldclock.js';
import { initWorkbench } from './workbench.js';

const $ = (s) => document.querySelector(s);
const story = { ...STORY, stations: MUCHA.stations, letter: MUCHA.letter };
const N = story.stations.length;
const DURATION = MUCHA.secondsPerStation * N;
const WINDOW_LABEL = ['晨 · 春', '昼 · 夏', '暮 · 秋', '夜 · 冬'];

// —— 渲染：和盒子一样经过 SDK 的 2D 输出，颜色一致 ——
const host = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.prepend(renderer.domElement);
const out = new InterlaceRenderer(renderer, { calibration: DISPLAY.calibration, render: { ...DISPLAY.render, mode: '2d' } });

let world = createMuchaWorld(story, await loadMuchaModels(renderer));
let zoom = 1;          // 一次看几扇窗
let camX = 0;          // 镜头横坐标（场景单位）
const PANEL = world.panelWidth;
const clampX = (x) => Math.min(Math.max(x, -PANEL * 0.5), (N - 1) * PANEL + PANEL * 0.5);

function layout() {
  const w = host.parentElement.clientWidth - 40;
  const h = Math.max(240, window.innerHeight - 190);
  host.style.height = `${h}px`;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h);
  world.setAspect(w / h, halfWidth());
}
const halfWidth = () => (zoom === 1 ? 5.3 : zoom === 4 ? 4.6 * PANEL / 2 : zoom * PANEL / 2); // 「全部」多留一点边，四扇窗都完整
new ResizeObserver(layout).observe(host.parentElement);
window.addEventListener('resize', layout);

// —— 拖动 / 滑动 / 滚轮 ——
let drag = null;
host.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, cam: camX }; host.setPointerCapture(e.pointerId); host.classList.add('dragging'); });
host.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const perPx = (halfWidth() * 2) / host.clientWidth; // 焦平面上每像素对应多少场景单位
  camX = clampX(drag.cam - (e.clientX - drag.x) * perPx);
});
const endDrag = () => { drag = null; host.classList.remove('dragging'); };
host.addEventListener('pointerup', endDrag);
host.addEventListener('pointercancel', endDrag);
host.addEventListener('wheel', (e) => {
  e.preventDefault();
  const perPx = (halfWidth() * 2) / host.clientWidth;
  camX = clampX(camX + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * perPx);
}, { passive: false });

// —— 进度、播放、视野、跳转 ——
const slider = $('#progress');
let playing = false;
let wiggle = false;
$('#wiggle').addEventListener('click', () => { wiggle = !wiggle; $('#wiggle').classList.toggle('on', wiggle); });
$('#play').addEventListener('click', () => { playing = !playing; $('#play').textContent = playing ? '❚❚ 暂停' : '▶ 播放'; });
document.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
  zoom = +b.dataset.zoom;
  document.querySelectorAll('[data-zoom]').forEach((x) => x.classList.toggle('on', x === b));
  if (zoom === 4) camX = (N - 1) * PANEL / 2;
  layout();
}));
const goTo = (i) => { camX = world.panelX(i); };
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => goTo(+b.dataset.go)));

let prev = performance.now();
renderer.setAnimationLoop((ms) => {
  const dt = Math.min((ms - prev) / 1000, 0.05);
  prev = ms;
  if (playing) slider.value = (+slider.value + dt / DURATION * 1000) % 1000;
  const p = slider.value / 1000;
  $('#pct').textContent = `${Math.round(p * 100)}%`;
  // 立体摇摆：镜头左右来回摆，模拟在裸眼屏前左右移动头部，用来看各层前后拉得开不开
  world.update({ worldTime: p * DURATION, progress: p, letterU: letterPhase(p), parallax: { x: wiggle ? Math.sin(ms / 1000 * 1.8) * 1.6 : 0, y: 0 }, view: { x: camX } });
  // 布景页签被隐藏（切到精修工作台）或窗口太窄时画布是 0 宽，SDK 会报错：跳过
  if (host.clientWidth > 0 && host.clientHeight > 0 && !document.body.classList.contains('cmp')) out.render(world.scene, world.camera);
});
layout();

// —— 槽位清单 ——
const cards = new Map();
let info = { slots: [] };
let lastDone = new Map();

function card(slot) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <div class="top">
      <div class="thumb"></div>
      <div style="flex:1;min-width:0">
        <div><span class="name"></span><span class="chip"></span></div>
        <div class="meta"></div>
      </div>
    </div>
    <div class="bar" hidden><i></i></div>
    <div class="msg"></div>
    <div class="pipe"></div>
    <div class="actions">
      <button data-act="gen">上传 2D 图生成</button>
      <button data-act="glb">上传 GLB</button>
      <button data-act="view">查看 3D</button>
      ${slot.window != null ? '<button data-act="look">看这里</button>' : ''}
    </div>`;
  const pick = (accept, cb) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept });
    input.onchange = () => input.files[0] && cb(input.files[0]);
    input.click();
  };
  el.querySelector('[data-act=gen]').onclick = () => pick('image/png,image/jpeg,image/webp', (f) => startPipeline(slot, f));
  el.querySelector('[data-act=glb]').onclick = () => pick('.glb,model/gltf-binary', (f) => send(slot.id, 'upload', f));
  el.querySelector('[data-act=look]')?.addEventListener('click', () => goTo(slot.window));
  el.querySelector('[data-act=view]').onclick = () => viewer.open(info.slots.find((x) => x.id === slot.id));
  // 直接把文件拖到卡片上：图片 → 生成，GLB → 处理
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop'); });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', (e) => {
    e.preventDefault(); el.classList.remove('drop');
    const f = e.dataTransfer.files[0];
    if (f) /\.glb$/i.test(f.name) ? send(slot.id, 'upload', f) : startPipeline(slot, f);
  });
  return el;
}

function paint(slot) {
  const el = cards.get(slot.id);
  const job = slot.job;
  const running = job && job.done === false;
  el.querySelector('.name').textContent = slot.name;
  const chip = el.querySelector('.chip');
  chip.className = 'chip ' + (running ? 'run' : job?.failed ? 'bad' : slot.model ? 'ok' : '');
  chip.textContent = running ? job.stage : job?.failed ? '失败' : slot.model ? '已有模型' : '程序化占位';
  el.querySelector('.meta').textContent = [
    slot.window != null ? WINDOW_LABEL[slot.window] : '四扇窗通用',
    slot.element ? '精修元素' : '',
    slot.kind === 'relief' ? '浮雕人物' : '布景小件',
    slot.model ? `${slot.modelKB} KB · ${new Date(slot.modelTime * 1000).toLocaleTimeString()}` : '',
  ].filter(Boolean).join(' · ');
  el.querySelector('.thumb').style.backgroundImage = slot.source ? `url("${slot.source}?t=${slot.modelTime ?? ''}")` : '';
  const bar = el.querySelector('.bar');
  bar.hidden = !running;
  bar.classList.toggle('indef', running && job.progress == null);
  if (running && job.progress != null) bar.querySelector('i').style.width = `${job.progress}%`;
  const msg = el.querySelector('.msg');
  msg.className = 'msg' + (job?.failed ? ' bad' : '');
  msg.textContent = job ? (running ? `${job.stage}${job.progress != null ? ` ${job.progress}%` : ''} · ${job.message ?? ''}` : job.message ?? '') : '';
  el.querySelector('[data-act=gen]').disabled = running || !info.tripo;
  paintPipe(el.querySelector('.pipe'), slot);
  el.querySelector('[data-act=gen]').title = info.tripo ? '' : '服务器没有配置 TRIPO_API_KEY';
  el.querySelector('[data-act=glb]').disabled = running;
  el.querySelector('[data-act=view]').disabled = !slot.model && !slot.raw;
}

const GROUPS = [
  ['四位女子', (s) => s.id.startsWith('mucha_lady_')],
  ['布景小件（四扇窗共用）', (s) => !s.element && !s.id.startsWith('mucha_lady_')],
  ['精修元素（精修工作台生成）', (s) => s.element],
];
function render() {
  const aside = $('#slots');
  if (!aside.dataset.ready) {
    aside.innerHTML = '';
    if (!info.tripo) aside.insertAdjacentHTML('beforeend', '<div class="note">没有配置 <b>TRIPO_API_KEY</b>：现在只能「上传 GLB」。把 key 写进 Jupitermusic/.env 后重启服务。</div>');
    if (!info.blender) aside.insertAdjacentHTML('beforeend', '<div class="note">没找到 Blender：处理模型需要 /Applications/Blender.app，或设置 BLENDER 环境变量。</div>');
    GROUPS.forEach(([title], i) => aside.insertAdjacentHTML('beforeend', `<h2 data-g="${i}">${title}</h2><div data-gl="${i}"></div>`));
    aside.dataset.ready = '1';
  }
  for (const s of info.slots) {
    if (cards.has(s.id)) continue;
    const gi = GROUPS.findIndex(([, test]) => test(s));
    const el = card(s); cards.set(s.id, el); aside.querySelector(`[data-gl="${gi}"]`).append(el);
  }
  GROUPS.forEach(([, test], i) => { aside.querySelector(`[data-g="${i}"]`).hidden = !info.slots.some(test); });
  info.slots.forEach(paint);
  const bal = info.balance && info.balance.balance != null ? `（余额 ${info.balance.balance}）` : info.balance?.error ? '（key 无效）' : '';
  $('#status').textContent = `Tripo ${info.tripo ? '已连接' + bal : '未配置'} · Blender ${info.blender ? '可用' : '未找到'}`;
}

async function send(slot, kind, file) {
  const res = await fetch(`/api/studio/${kind}?slot=${slot}`, { method: 'POST', body: file });
  if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? `失败 ${res.status}`);
  poll();
}

// 有任务在跑就每 2 秒问一次；某个槽位刚做完，就重新载入布景，把新模型换上
let timer = null;
async function poll() {
  clearTimeout(timer);
  try {
    info = await (await fetch('/api/studio/slots', { cache: 'no-store' })).json();
    render();
    bench?.onSlots(info.slots);
    let changed = false;
    for (const s of info.slots) {
      const stamp = s.model ? s.modelTime : null;
      if (lastDone.has(s.id) && lastDone.get(s.id) !== stamp) changed = true;
      lastDone.set(s.id, stamp);
    }
    if (changed) {
      world = createMuchaWorld(story, await loadMuchaModels(renderer));
      layout();
    }
  } catch { $('#status').textContent = '连不上服务器'; }
  const running = info.slots.some((s) => s.job && s.job.done === false);
  timer = setTimeout(poll, running ? 2000 : 8000);
}
poll();

// —— 3D 查看器：单独看一个槽位的 GLB，能转、能缩放，能切 Tripo 原始模型，能左右摇摆看立体 ——
const viewer = (() => {
  const el = $('#viewer'), cv = $('#vcv');
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  cv.prepend(r.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#fff7ea', '#8a7a64', 1.7));
  const key = new THREE.DirectionalLight('#ffffff', 1.5); key.position.set(-2, 3, 4); scene.add(key);
  const rim = new THREE.DirectionalLight('#ffe2b8', 0.8); rim.position.set(3, 2, -3); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.001, 100);
  const loader = new GLBLoader(r, { dracoDecoderPath: './vendor/jupiter-sdk/decoders/draco/', ktx2TranscoderPath: './vendor/jupiter-sdk/decoders/basis/' });
  const center = new THREE.Vector3(), pan = new THREE.Vector3();
  const orbit = { az: 0, el: 0.06, dist: 3 };
  let model = null, slot = null, radius = 1, token = 0, last = performance.now(), t = 0;

  const resize = () => { r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(cv.clientWidth, cv.clientHeight); cam.aspect = cv.clientWidth / cv.clientHeight; cam.updateProjectionMatrix(); };
  new ResizeObserver(() => el.classList.contains('open') && resize()).observe(cv);

  async function show(url, label) {
    const my = ++token;
    $('#vload').hidden = false;
    $('#vload').textContent = `载入${label}…`;
    try {
      const g = await loader.load(`${url}?t=${Date.now()}`);
      if (my !== token) return;
      if (model) scene.remove(model);
      model = g.scene;
      let tris = 0; const tex = new Set();
      model.traverse((o) => {
        if (!o.isMesh) return;
        tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
        for (const m of [].concat(o.material)) {
          m.metalness = 0; // 没有环境贴图时金属度会让模型发黑
          if (m.map?.image) tex.add(`${m.map.image.width}×${m.map.image.height}`);
        }
      });
      const box = new THREE.Box3().setFromObject(model);
      box.getCenter(center);
      radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
      orbit.dist = radius / Math.sin((cam.fov * Math.PI / 180) / 2) * 1.05;
      pan.set(0, 0, 0);
      cam.near = radius / 100; cam.far = radius * 50; cam.updateProjectionMatrix();
      scene.add(model);
      $('#vstats').innerHTML = `面数 ${Math.round(tris).toLocaleString()}<br>贴图 ${[...tex].join('、') || '无'}`;
      $('#vload').hidden = true;
    } catch (err) {
      $('#vload').textContent = `载入失败：${err.message ?? err}`;
    }
  }

  function open(s) {
    slot = s;
    el.classList.add('open');
    resize();
    $('#vname').textContent = s.name;
    $('#vmeta').innerHTML = [s.kind === 'relief' ? '浮雕人物' : '布景小件', s.model ? `处理后 ${s.modelKB} KB` : '还没有处理后的模型', s.raw ? `Tripo 原始 ${s.rawMB} MB` : '没有保存 Tripo 原始模型'].join('<br>');
    $('#vproc').disabled = !s.model;
    $('#vraw').disabled = !s.raw;
    $('#vsrc').hidden = !s.source;
    if (s.source) $('#vsrc').src = `${s.source}?t=${Date.now()}`;
    setMode(s.model ? 'proc' : 'raw');
    orbit.az = 0; orbit.el = 0.06;
    r.setAnimationLoop(frame);
  }
  function close() { el.classList.remove('open'); r.setAnimationLoop(null); token++; }
  function setMode(m) {
    $('#vproc').classList.toggle('on', m === 'proc');
    $('#vraw').classList.toggle('on', m === 'raw');
    if (m === 'proc') show(`assets/models/${slot.id}.glb`, '处理后的模型');
    else show(slot.raw, `Tripo 原始模型（${slot.rawMB} MB，稍等）`);
  }
  $('#vproc').onclick = () => setMode('proc');
  $('#vraw').onclick = () => setMode('raw');
  $('#vclose').onclick = close;
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.classList.contains('open')) close(); });
  document.querySelectorAll('[data-vview]').forEach((b) => b.addEventListener('click', () => {
    $('#vspin').checked = false;
    orbit.az = { front: 0, side: Math.PI / 2, q: Math.PI / 4 }[b.dataset.vview];
    orbit.el = 0.06;
  }));

  // 拖动旋转；右键或 Shift+拖动平移；滚轮缩放
  let drag = null;
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, panning: e.button === 2 || e.shiftKey };
    cv.setPointerCapture(e.pointerId); cv.classList.add('dragging');
    $('#vspin').checked = false;
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.panning) {
      const k = orbit.dist * 0.0015;
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      pan.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    } else {
      orbit.az -= dx * 0.008;
      orbit.el = Math.min(1.4, Math.max(-1.4, orbit.el + dy * 0.008));
    }
  });
  const end = () => { drag = null; cv.classList.remove('dragging'); };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = Math.min(radius * 20, Math.max(radius * 0.3, orbit.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });

  function frame(ms) {
    const dt = Math.min((ms - last) / 1000, 0.05); last = ms; t += dt;
    if ($('#vspin').checked) orbit.az += dt * 0.5;
    // 立体摇摆：在当前角度两侧来回摆，幅度按滑块（度）
    const wig = $('#vwig').checked ? Math.sin(t * 2.2) * (+$('#vamp').value) * Math.PI / 180 : 0;
    const az = orbit.az + wig;
    const target = center.clone().add(pan);
    cam.position.set(Math.sin(az) * Math.cos(orbit.el), Math.sin(orbit.el), Math.cos(az) * Math.cos(orbit.el)).multiplyScalar(orbit.dist).add(target);
    cam.lookAt(target);
    r.render(scene, cam);
  }
  return { open };
})();

// —— 页签：四扇窗布景 / 精修工作台（原图排版 · 元素拆分画布 · 3D 预览）——
let bench = null;
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
  const cmp = b.dataset.tab === 'cmp';
  document.body.classList.toggle('cmp', cmp);
  if (cmp && !bench) {
    bench = initWorkbench($('#bench'), {
      renderer,
      createWorld: async () => createMuchaWorld(story, await loadMuchaModels(renderer)),
      openViewer: (s) => viewer.open(s),
    });
    bench.onSlots(info.slots);
  }
  if (!cmp) layout();
}));
window.addEventListener('studio:poll', () => poll());

// —— 2D → 3D 流水线（studio_api.py 的 _run_pipeline）——
// 人物：重画参考图 → 确认 → 四视图 → 确认 → 建模；物件：重画参考图 → 确认 → 建模
export async function startPipeline(slot, file, { kind, name = '', hint = '' } = {}) {
  kind ??= slot.id.startsWith('mucha_lady_') || slot.kind === 'relief' ? 'character' : 'object';
  const steps = kind === 'character' ? '重画成正面 A-pose 参考图 → 你确认 → 四视图 → 你确认 → 建模' : '重画成单独完整的参考图 → 你确认 → 建模';
  if (!confirm(`「${slot.name}」按${kind === 'character' ? '人物' : '物件'}流程生成 3D：\n${steps}\n\n会消耗 Tripo 额度（每一步都可以在确认时取消）。继续？`)) return;
  const q = new URLSearchParams({ slot: slot.id, kind, name: name || slot.name, hint });
  const res = await fetch(`/api/studio/pipeline?${q}`, { method: 'POST', body: file });
  if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? `失败 ${res.status}`);
  window.dispatchEvent(new Event('studio:poll'));
}
window.startPipeline = startPipeline;

function paintPipe(box, slot) {
  const job = slot.job, art = job?.artifacts;
  if (!art) { box.innerHTML = ''; return; }
  const img = (src, label) => `<figure><a href="${src}" target="_blank"><img src="${src}?v=${job.updated}"></a><figcaption>${label}</figcaption></figure>`;
  const views = (art.views ?? []).map((v, i) => img(v, ['前', '左', '后', '右'][i] ?? i)).join('');
  const key = [art.source, art.reference, ...(art.views ?? []), job.waiting].join('|');
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = `<div class="thumbs">${img(art.source, '原图')}${art.reference ? img(art.reference, '参考图') : ''}${views}</div>`
      + (job.waiting ? `<div class="gate"><b>${job.waiting === 'reference' ? '参考图合格吗？' : '四视图合格吗？'}</b>
        <span class="sub">看手指是否分开、脸是否正面、有没有被遮挡、有没有多余的东西</span>
        <div><button data-a="ok">通过，继续</button><button data-a="redo">重做这一步</button><button data-a="cancel">取消</button></div></div>` : '');
    box.querySelectorAll('[data-a]').forEach((b) => { b.onclick = async () => { await fetch(`/api/studio/answer?slot=${slot.id}&a=${b.dataset.a}`, { method: 'POST' }); window.dispatchEvent(new Event('studio:poll')); }; });
  }
}

// 用户网页：照片 + 一句想法 → 选风格 → 长卷（Tripo 按风格重画）→ 立体元素（Tripo 3D）→ 排布预览 → 音乐与纪念品 → 送到相框。
// 后端：world_api.py（世界、重画）、studio_api.py（元素 2D → 3D 流水线，槽位 w_<世界>_<元素>）。
// 右侧预览和相框是同一个渲染器（src/scroll.js），读同一份 world.json。
import { THREE, InterlaceRenderer } from '../src/three.js';
import { DISPLAY, TUNING } from '../src/config.js';
import { createScrollWorld, STATION_PX } from '../src/scroll.js';
import { letterPhase } from '../src/worldclock.js';
import { MusicBox, SONGS } from '../src/audio.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const panel = $('#panel');
const api = async (path, opts = {}) => {
  const res = await fetch(path, { cache: 'no-store', ...opts, headers: opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `请求失败 ${res.status}`);
  return data;
};

// —— 状态 ——
const state = {
  step: 1,
  photos: [],          // 第 1 步：{ file, url, caption, w, h }
  idea: '', nameplate: '',
  style: null, styles: [],
  world: null,         // 生成后：world.json（含 id）
  slots: [],           // 布景工作台的槽位（元素 3D 的进度）
};
const params = new URLSearchParams(location.search);

// 世界编号放进网址，刷新后能接着做
function setUrl() { if (state.world) history.replaceState(null, '', `?w=${state.world.id}${state.step > 1 ? `&s=${state.step}` : ''}`); }

// —— 保存（改动后 0.6 秒整份存回）——
let saveTimer = null;
function save() {
  if (!state.world) return;
  $('#save').textContent = '保存中…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await api(`/api/worlds/${state.world.id}`, { method: 'PUT', body: JSON.stringify(state.world) }); $('#save').textContent = `已保存 ${new Date().toLocaleTimeString()}`; }
    catch (e) { $('#save').textContent = `保存失败：${e.message}`; }
  }, 600);
  rebuildPreview();
}

// ======================================================================
// 右侧预览：和相框同一个渲染器
const pv = (() => {
  const host = $('#screen');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.append(renderer.domElement);
  const out = new InterlaceRenderer(renderer, { calibration: DISPLAY.calibration, render: { ...DISPLAY.render, mode: '2d' } });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  let world = null, building = 0, playing = false, t = 0, prev = performance.now();
  const slider = $('#pv-p');
  $('#pv-play').onclick = () => { playing = !playing; $('#pv-play').textContent = playing ? '❚❚' : '▶'; };
  renderer.setAnimationLoop((ms) => {
    const dt = Math.min((ms - prev) / 1000, 0.05); prev = ms; t += dt;
    if (!world) return;
    const dur = (state.world.secondsPerStation ?? 18) * (state.world.stations.length + 1);
    if (playing) slider.value = (+slider.value + dt / dur * 1000) % 1000;
    const p = slider.value / 1000;
    world.update({ worldTime: p * dur, progress: p, letterU: letterPhase(p), parallax: { x: $('#pv-wig').checked ? Math.sin(t * 1.8) * 1.4 : 0, y: 0 } });
    out.render(world.scene, world.camera);
  });
  return {
    renderer,
    async rebuild() {
      if (!state.world) return;
      const my = ++building;
      const w = await createScrollWorld(JSON.parse(JSON.stringify(state.world)), `${location.origin}/worlds/${state.world.id}/`, renderer);
      if (my !== building) return;
      w.setAspect(host.clientWidth / host.clientHeight);
      world = w;
    },
    // 预览跳到第 i 站的中段
    show(i) { slider.value = Math.round(((i + 0.4) / state.world.stations.length) * TUNING.trainPhaseEnd * 1000); },
  };
})();
let rebuildTimer = null;
function rebuildPreview() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => pv.rebuild(), 400); }

// ======================================================================
// 步骤导航
function go(step) {
  if (step > 2 && !state.world) return;
  state.step = step;
  $$('#steps li').forEach((li) => { li.classList.toggle('on', +li.dataset.s === step); li.classList.toggle('locked', +li.dataset.s > 2 && !state.world); });
  panel.innerHTML = '';
  panel.append($(`#t-step${step}`).content.cloneNode(true));
  ({ 1: step1, 2: step2, 3: step3, 4: step4, 5: step5, 6: step6 })[step]();
  setUrl();
  window.scrollTo({ top: 0 });
}
$$('#steps li').forEach((li) => { li.onclick = () => go(+li.dataset.s); });

// —— ① 照片与想法 ——
function step1() {
  $('#demo-cta').hidden = !!state.world;
  $('#demo-go').onclick = async () => {
    $('#demo-go').disabled = true; $('#demo-go').textContent = '载入中…';
    try { state.world = await api('/api/worlds/demo', { method: 'POST', body: '{}' }); state.style = state.world.style; demoMode(); rebuildPreview(); go(1); }
    catch (e) { alert(e.message); $('#demo-go').disabled = false; }
  };
  if (state.world) {
    panel.querySelector('.lead').textContent = state.world.demo ? '案例里已经放好了三张旅行照片（由 Tripo 生成）。可以改每一站的名字和你的想法，然后进入下一步。' : '这个世界已经生成了。要换照片，请新建一个（去掉网址里的 ?w=）。';
    $('#drop').hidden = true;
    const box = $('#photos');
    state.world.stations.forEach((st) => {
      const el = document.createElement('div'); el.className = 'photo ro';
      el.innerHTML = `<img src="/worlds/${state.world.id}/${st.photo}"><input maxlength="20" value="${st.title}">`;
      el.querySelector('input').oninput = (e) => { st.title = e.target.value; save(); };
      box.append(el);
    });
    $('#idea').value = state.world.idea ?? ''; $('#nameplate').value = state.world.nameplate ?? '';
    $('#idea').oninput = (e) => { state.world.idea = e.target.value; save(); };
    $('#nameplate').oninput = (e) => { state.world.nameplate = e.target.value; save(); };
    $('#next1').disabled = false; $('#next1').onclick = () => go(2);
    return;
  }
  const render = () => {
    $('#photos').innerHTML = '';
    state.photos.forEach((p, i) => {
      const el = document.createElement('div'); el.className = 'photo';
      el.innerHTML = `<img src="${p.url}"><input placeholder="第 ${i + 1} 站叫什么" maxlength="20" value="${p.caption ?? ''}">
        <div class="row"><button data-a="l">‹</button><button data-a="x">删除</button><button data-a="r">›</button></div>`;
      el.querySelector('input').oninput = (e) => { p.caption = e.target.value; };
      el.querySelector('[data-a=x]').onclick = () => { state.photos.splice(i, 1); render(); };
      el.querySelector('[data-a=l]').onclick = () => { if (i > 0) { state.photos.splice(i - 1, 0, state.photos.splice(i, 1)[0]); render(); } };
      el.querySelector('[data-a=r]').onclick = () => { if (i < state.photos.length - 1) { state.photos.splice(i + 1, 0, state.photos.splice(i, 1)[0]); render(); } };
      $('#photos').append(el);
    });
    $('#next1').disabled = !state.photos.length && !state.world;
  };
  const add = async (files) => {
    for (const f of [...files].filter((x) => x.type.startsWith('image/')).slice(0, 5 - state.photos.length)) {
      const url = URL.createObjectURL(f);
      const im = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = url; });
      state.photos.push({ file: f, url, caption: '', w: im.naturalWidth, h: im.naturalHeight, img: im });
    }
    render();
  };
  $('#files').onchange = (e) => add(e.target.files);
  const drop = $('#drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); add(e.dataTransfer.files); };
  $('#idea').value = state.world?.idea ?? state.idea; $('#nameplate').value = state.world?.nameplate ?? state.nameplate;
  $('#idea').oninput = (e) => { state.idea = e.target.value; if (state.world) { state.world.idea = e.target.value; save(); } };
  $('#nameplate').oninput = (e) => { state.nameplate = e.target.value; if (state.world) { state.world.nameplate = e.target.value; save(); } };
  $('#next1').onclick = () => go(2);
  render();
}

// —— ② 选风格 ——
async function step2() {
  if (!state.styles.length) state.styles = await api('/api/styles');
  state.style ??= state.world?.style ?? state.styles[0].id;
  const box = $('#styles');
  for (const s of state.styles) {
    const el = document.createElement('div'); el.className = 'style';
    el.innerHTML = `<div class="art">${s.sample ? `<img src="/${s.sample}">` : s.palette.map((c) => `<i style="background:${c}"></i>`).join('')}</div>
      <div class="txt"><b>${s.name}</b><span>${s.desc}</span><span>配乐：${SONGS[s.music]?.name ?? ''}</span></div>`;
    el.onclick = () => { state.style = s.id; $$('.style', box).forEach((x) => x.classList.toggle('on', x === el)); if (state.world) { applyStyle(s); } };
    el.classList.toggle('on', s.id === state.style);
    box.append(el);
  }
  $('#back2').onclick = () => go(1);
  const make = $('#make');
  if (state.world?.demo) { make.textContent = '按这个风格画我的长卷'; make.onclick = () => { go(3); demoPaint(state.world.stations.map((_, i) => i)); }; return; }
  if (state.world) { make.textContent = '下一步：长卷'; make.onclick = () => go(3); return; }
  make.disabled = !state.photos.length;
  $('#make-hint').textContent = state.photos.length ? '' : '先回到第 1 步上传照片。';
  make.onclick = async () => {
    make.disabled = true; make.textContent = '正在生成…';
    try {
      const photos = await Promise.all(state.photos.map(async (p) => ({ ...(await shrink(p)), caption: p.caption })));
      state.world = await api('/api/worlds', { method: 'POST', body: JSON.stringify({ idea: state.idea, nameplate: state.nameplate, style: state.style, photos }) });
      rebuildPreview();
      api(`/api/worlds/${state.world.id}/analyze`, { method: 'POST', body: '{}' }).then((r) => { if (r.ok) { state.world = r.world; if (state.step === 3) go(3); } }).catch(() => {});
      go(3);
    } catch (e) { alert(e.message); make.disabled = false; make.textContent = '生成我的长卷'; }
  };
}
function applyStyle(s) {
  const w = state.world;
  Object.assign(w, { style: s.id, wall: s.wall, frame: s.frame });
  if (s.music) w.music = { id: s.music };   // 配乐跟着风格换（第 6 步还能再改）
  w.souvenir.bg = s.wall;
  for (const st of w.stations) { const sky = st.layers.find((L) => L.id === 'sky'); if (sky) Object.assign(sky, { top: s.sky[0], bottom: s.sky[1] }); }
  save();
}
// 照片在浏览器里先缩到长边 1600 再上传
async function shrink(p) {
  const k = Math.min(1, 1600 / Math.max(p.w, p.h));
  const c = document.createElement('canvas'); c.width = Math.round(p.w * k); c.height = Math.round(p.h * k);
  c.getContext('2d').drawImage(p.img, 0, 0, c.width, c.height);
  return { data: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height };
}

// —— ③ 长卷 ——
let paintPoll = null;
function step3() {
  const w = state.world, box = $('#scroll');
  const artOf = (st) => st.layers.find((L) => L.id === 'art');
  const render = () => {
    box.innerHTML = '';
    w.stations.forEach((st, i) => {
      const job = (w.demo ? demo.paint : w.paint)?.[i];
      const running = job && !job.done;
      const el = document.createElement('div'); el.className = 'station';
      const versions = st.versions ?? [];
      const verName = (v) => (w.demo ? state.styles.find((s) => v.includes(`-${s.id}.`))?.name ?? v : null);
      el.innerHTML = `<div class="art" style="background-image:url('/worlds/${w.id}/${artOf(st)?.src}')"><span class="badge">${i + 1}</span></div>
        <div class="meta"><input value="${st.title}" maxlength="20">
          <div class="row"><button data-a="paint" ${running ? 'disabled' : ''}>${versions.length ? '再画一版' : '按风格重画'}</button>
          ${versions.length ? `<select data-a="ver"><option value="${st.photo}">原照片</option>${versions.map((v, k) => `<option value="${v}">${verName(v) ?? `第 ${k + 1} 版`}</option>`).join('')}</select>` : ''}</div>
          <div class="st ${job?.error ? 'bad' : ''}">${job ? (job.error ? `失败：${job.error}` : `${job.stage}${job.progress != null && !job.done ? ` ${job.progress}%` : ''}`) : ''}</div></div>`;
      el.querySelector('input').oninput = (e) => { st.title = e.target.value; save(); };
      el.querySelector('[data-a=paint]').onclick = () => paint([i]);
      const ver = el.querySelector('[data-a=ver]');
      if (ver) {
        ver.value = artOf(st).src;
        ver.onchange = () => {
          const L = artOf(st); L.src = ver.value;
          if (ver.value === st.photo && st.photoSize) { Object.assign(L, coverBox(st.photoSize)); delete L.fit; } else { Object.assign(L, { fit: 'cover', x: 0, y: 0 }); delete L.w; delete L.h; }
          save(); render();
        };
      }
      el.querySelector('.art').onclick = () => pv.show(i);
      box.append(el);
    });
    const end = document.createElement('div'); end.className = 'station end';
    end.innerHTML = '<div class="art">长卷尽头<br>是纪念品<br>（第 6 步）</div>';
    box.append(end);
  };
  const poll = async () => {
    clearTimeout(paintPoll);
    if (state.step !== 3) return;
    const fresh = await api(`/api/worlds/${w.id}`);
    const was = JSON.stringify(state.world.stations.map((s) => s.versions));
    state.world.paint = fresh.paint;
    if (JSON.stringify(fresh.stations.map((s) => s.versions)) !== was) { state.world = fresh; rebuildPreview(); }
    if (state.step === 3) { step3Render(); }
    if (Object.values(fresh.paint ?? {}).some((j) => !j.done)) paintPoll = setTimeout(poll, 2500);
  };
  const paint = async (list) => {
    if (w.demo) return demoPaint(list);
    if (!confirm(`用 Tripo 按「${state.styles.find((s) => s.id === w.style)?.name ?? w.style}」重画 ${list.length} 站？每站约 10 额度。`)) return;
    for (const i of list) await api(`/api/worlds/${w.id}/paint/${i}`, { method: 'POST', body: '{}' }).catch((e) => alert(e.message));
    poll();
  };
  const step3Render = () => { if (state.step === 3) render(); };
  $('#paint-all').onclick = () => paint(w.stations.map((_, i) => i));
  $('#next3').onclick = () => go(4);
  render(); if (!w.demo) poll();
  step3Hook = render;
}
let step3Hook = () => {};
const coverBox = ([w, h] = [1200, 1920]) => {
  const k = Math.max(STATION_PX[0] / w, STATION_PX[1] / h);
  return { x: Math.round((STATION_PX[0] - w * k) / 2), y: Math.round((STATION_PX[1] - h * k) / 2), w: Math.round(w * k), h: Math.round(h * k) };
};

// ======================================================================
// 元素：框选 → 抠图 → 流水线（studio_api：重画参考图 → 确认 →（人物）四视图 → 确认 → 建模）
let cur = 0, slotPoll = null;
const slotId = (el) => `w_${state.world.id}_${el.id}`;
async function artImage(st) {
  const L = st.layers.find((x) => x.id === 'art');
  const im = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = `/worlds/${state.world.id}/${L.src}`; });
  // 站内坐标 → 图片像素
  let box;
  if (L.fit === 'cover') { const k = Math.max(STATION_PX[0] / im.width, STATION_PX[1] / im.height); box = { x: (STATION_PX[0] - im.width * k) / 2, y: (STATION_PX[1] - im.height * k) / 2, k }; }
  else box = { x: L.x, y: L.y, k: L.w / im.width };
  return { im, toImg: (sx, sy) => [(sx - box.x) / box.k, (sy - box.y) / box.k], box };
}

function step4() {
  const w = state.world;
  const tabs = $('#st-tabs');
  w.stations.forEach((st, i) => { const b = document.createElement('button'); b.textContent = `${i + 1} · ${st.title}`; b.onclick = () => { cur = i; step4(); }; b.classList.toggle('on', i === cur); tabs.append(b); });
  $('#back4').onclick = () => go(3); $('#next4').onclick = () => go(5);
  const st = w.stations[cur];
  st.elements ??= [];
  pv.show(cur);
  const cv = $('#el-cv'), g = cv.getContext('2d');
  let art = null, drag = null;
  const fit = () => { const r = cv.getBoundingClientRect(); cv.width = r.width * 2; cv.height = r.height * 2; draw(); };
  const S = () => cv.width / STATION_PX[0];
  function draw(tmp) {
    g.fillStyle = '#efe7d8'; g.fillRect(0, 0, cv.width, cv.height);
    if (art) { const { im, box } = art; g.drawImage(im, box.x * S(), box.y * S(), im.width * box.k * S(), im.height * box.k * S()); }
    for (const el of st.elements) {
      const [x, y, ww, hh] = el.rect;
      g.lineWidth = 4; g.strokeStyle = el.model ? '#5f8a5a' : '#b8923f'; g.strokeRect(x * S(), y * S(), ww * S(), hh * S());
      g.fillStyle = '#000a'; g.font = '600 26px system-ui'; g.fillText(el.name, x * S() + 8, y * S() + 30);
    }
    if (tmp) { g.setLineDash([10, 8]); g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(...tmp.map((v) => v * S())); g.setLineDash([]); }
  }
  const evPt = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * STATION_PX[0], (e.clientY - r.top) / r.height * STATION_PX[1]]; };
  cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); drag = evPt(e); };
  cv.onpointermove = (e) => { if (!drag) return; const p = evPt(e); draw([Math.min(drag[0], p[0]), Math.min(drag[1], p[1]), Math.abs(p[0] - drag[0]), Math.abs(p[1] - drag[1])]); };
  cv.onpointerup = (e) => {
    if (!drag) return;
    const p = evPt(e), r = [Math.min(drag[0], p[0]), Math.min(drag[1], p[1]), Math.abs(p[0] - drag[0]), Math.abs(p[1] - drag[1])].map(Math.round);
    drag = null;
    if (r[2] < 40 || r[3] < 40) return draw();
    const name = prompt('这是什么？（比如：灯塔、妈妈、樱花树）');
    if (!name) return draw();
    addElement(st, { name, rect: r, kind: /人|妈|爸|我|她|他|孩|宝|爷|奶|女|男|朋友/.test(name) ? 'character' : 'object' });
  };
  function addElement(s, el) {
    el.id = `e${Date.now().toString(36).slice(-5)}`;
    s.elements.push(el); save(); step4();
  }
  // Claude 识别出来的主体：一键框上
  const an = st.analysis;
  const list = $('#el-list');
  if (an?.landmark && an.landmark_box && !st.elements.some((e) => e.fromAnalysis)) {
    const sug = document.createElement('div'); sug.className = 'suggest';
    sug.innerHTML = `识别到「${an.landmark}」，<button>框上它</button>`;
    sug.querySelector('button').onclick = async () => {
      const a = art ?? await artImage(st);
      const bx = an.landmark_box, im = a.im;  // landmark_box 是原照片的比例（0–1）：原照片才对得上
      const L = st.layers.find((x) => x.id === 'art');
      const k = L.fit === 'cover' ? a.box.k : L.w / im.width;
      const rect = [a.box.x + bx.x * im.width * k, a.box.y + bx.y * im.height * k, bx.w * im.width * k, bx.h * im.height * k].map(Math.round);
      addElement(st, { name: an.landmark, rect, kind: 'object', fromAnalysis: true });
    };
    list.append(sug);
  }
  for (const el of st.elements) {
    const d = document.createElement('div'); d.className = 'el'; d.dataset.id = el.id;
    d.innerHTML = `<div class="row"><input value="${el.name}"><select><option value="object">物件</option><option value="character">人物</option></select>
      <button data-a="gen">${el.model ? '重新生成 3D' : '生成 3D'}</button><button data-a="del">删除</button></div><div class="st"></div><div class="pipe"></div>`;
    d.querySelector('input').oninput = (e) => { el.name = e.target.value; save(); };
    d.querySelector('select').value = el.kind; d.querySelector('select').onchange = (e) => { el.kind = e.target.value; save(); };
    d.querySelector('[data-a=del]').onclick = () => { st.elements.splice(st.elements.indexOf(el), 1); st.layers = st.layers.filter((L) => L.id !== el.id); save(); step4(); };
    d.querySelector('[data-a=gen]').onclick = () => generate(st, el);
    list.append(d);
  }
  if (!st.elements.length) list.insertAdjacentHTML('beforeend', '<p class="hint">还没有立体元素。在左边的画上拖一个框。</p>');
  artImage(st).then((a) => { art = a; fit(); }).catch(() => fit());
  new ResizeObserver(fit).observe(cv);
  pollSlots();
}

async function generate(st, el) {
  if (state.world.demo) return demoGenerate(st, el);
  const steps = el.kind === 'character' ? '重画成正面参考图 → 你确认 → 四视图 → 你确认 → 建模' : '重画成单独完整的参考图 → 你确认 → 建模';
  if (!confirm(`「${el.name}」生成 3D：${steps}\n会消耗 Tripo 额度，每一步都可以在确认时取消。`)) return;
  const { im, toImg } = await artImage(st);
  const [x, y, w, h] = el.rect, [ix, iy] = toImg(x, y), [ix2, iy2] = toImg(x + w, y + h);
  const pad = 0.04 * Math.max(ix2 - ix, iy2 - iy);
  const sx = Math.max(0, ix - pad), sy = Math.max(0, iy - pad), sw = Math.min(im.width, ix2 + pad) - sx, sh = Math.min(im.height, iy2 + pad) - sy;
  const c = document.createElement('canvas'); c.width = Math.round(sw); c.height = Math.round(sh);
  c.getContext('2d').drawImage(im, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  const sty = state.styles.find((s) => s.id === state.world.style);
  const q = new URLSearchParams({ slot: slotId(el), kind: el.kind, name: el.name, style: sty?.prompt ?? '' });
  try { await api(`/api/studio/pipeline?${q}`, { method: 'POST', body: blob }); } catch (e) { alert(e.message); }
  pollSlots();
}

let slotBusy = false;
async function pollSlots() {
  clearTimeout(slotPoll);
  if (!state.world || slotBusy) return;
  slotBusy = true;
  try { await pollSlotsOnce(); } finally { slotBusy = false; }
  const running = state.slots.some((s) => s.job && s.job.done === false);
  slotPoll = setTimeout(pollSlots, running ? 2500 : 10000);
}
async function pollSlotsOnce() {
  let info;
  try { info = await api('/api/studio/slots'); } catch { return; }
  state.slots = info.slots.filter((s) => s.id.startsWith(`w_${state.world.id}_`));
  let changed = false;
  for (const st of state.world.stations) for (const el of st.elements ?? []) {
    const s = state.slots.find((x) => x.id === slotId(el));
    if (s?.model && el.model !== s.modelTime) {   // 刚做好：放进画里同一个位置
      el.model = s.modelTime;
      const L = st.layers.find((x) => x.id === el.id) ?? (st.layers.push({ id: el.id, kind: 'model' }), st.layers.at(-1));
      Object.assign(L, { kind: 'model', src: `assets/models/${s.id}.glb?v=${Math.round(s.modelTime)}`, x: el.rect[0] + el.rect[2] / 2, y: el.rect[1] + el.rect[3], h: el.rect[3], depth: L.depth ?? 0.8, anim: L.anim ?? 'sway' });
      changed = true;
    }
  }
  if (changed) save();
  if (state.step === 4) paintElements();
  if (state.step === 6) paintSouvenirJob();
}
function pipeHtml(s) {
  const job = s?.job, art = job?.artifacts;
  if (!art) return '';
  const url = (src) => (src.startsWith('../') ? `/worlds/${state.world.id}/${src}` : `/${src}`);
  const img = (src, t) => `<figure><a href="${url(src)}" target="_blank"><img src="${url(src)}?v=${job.updated}"></a>${t}</figure>`;
  return `<div class="thumbs">${img(art.source, '框选')}${art.reference ? img(art.reference, '参考图') : ''}${(art.views ?? []).map((v, i) => img(v, ['前', '左', '后', '右'][i])).join('')}</div>`
    + (job.waiting ? `<div class="gate"><b>${job.waiting === 'reference' ? '参考图合格吗？' : '四视图合格吗？'}</b> 看手指是否分开、脸是否正面、有没有被遮挡或多出来的东西
      <div class="row"><button data-g="ok">通过，继续</button><button data-g="redo">重做这一步</button><button data-g="cancel">取消</button></div></div>` : '');
}
function bindGate(box, s) {
  box.querySelectorAll('[data-g]').forEach((b) => { b.onclick = async () => { await api(`/api/studio/answer?slot=${s.id}&a=${b.dataset.g}`, { method: 'POST', body: '{}' }).catch((e) => alert(e.message)); pollSlots(); }; });
}
function paintElements() {
  const st = state.world.stations[cur];
  for (const el of st.elements ?? []) {
    const d = $(`.el[data-id="${el.id}"]`); if (!d) continue;
    const s = demo.slots[el.id] ?? state.slots.find((x) => x.id === slotId(el)), job = s?.job, running = job && job.done === false;
    const stEl = d.querySelector('.st');
    stEl.className = 'st' + (job?.failed ? ' bad' : s?.model ? ' ok' : '');
    stEl.textContent = running ? `${job.stage}${job.progress != null ? ` ${job.progress}%` : ''}` : job?.failed ? `失败：${job.message}` : (s?.model || (state.world.demo && el.model)) ? `3D 已放进画里 · ${job?.message ?? (state.world.demo ? '案例里已经生成好了，可以点「重新生成 3D」看一遍过程' : '')}` : '';
    d.querySelector('[data-a=gen]').disabled = !!running;
    const pipe = d.querySelector('.pipe'), key = JSON.stringify([job?.artifacts, job?.waiting]);
    if (pipe.dataset.key !== key) { pipe.dataset.key = key; pipe.innerHTML = pipeHtml(s); s?.demo ? bindDemoGate(pipe, s) : bindGate(pipe, s); }
  }
}

// —— ⑤ 排布预览 ——
function step5() {
  const box = $('#layers');
  const anims = { none: '不动', sway: '轻摆', bob: '上下浮', spin: '慢转', drift: '左右飘', breathe: '呼吸' };
  state.world.stations.forEach((st, i) => {
    const g = document.createElement('div'); g.className = 'lgroup';
    g.innerHTML = `<h3>${i + 1} · ${st.title}</h3>`;
    for (const L of st.layers.filter((x) => x.kind !== 'gradient')) {
      const name = L.id === 'art' ? '画面' : (st.elements ?? []).find((e) => e.id === L.id)?.name ?? L.id;
      const r = document.createElement('div'); r.className = 'lrow';
      const num = (k, min, max, step = 1) => `<label>${{ depth: '前后', x: '左右', y: '上下', h: '大小' }[k]}<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${L[k] ?? 0}"></label>`;
      r.innerHTML = `<b>${name}</b>${num('depth', -8, 3, 0.1)}${L.kind === 'model' ? num('x', 0, 1200) + num('h', 60, 1900) : num('y', -400, 400)}
        <select ${L.kind === 'model' ? '' : 'disabled'}>${Object.entries(anims).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <button title="在预览里看这一站">👁</button>`;
      r.querySelectorAll('input[type=range]').forEach((inp) => {
        inp.oninput = () => {
          const k = inp.dataset.k;
          if (k === 'y' && L.kind !== 'model') { L.dy = +inp.value; } else L[k] = +inp.value;
          save();
        };
      });
      if (L.kind !== 'model') r.querySelector('[data-k=y]').value = L.dy ?? 0;
      const sel = r.querySelector('select'); sel.value = L.anim ?? 'none'; sel.onchange = () => { L.anim = sel.value; save(); };
      r.querySelector('button').onclick = () => pv.show(i);
      g.append(r);
    }
    if (!st.layers.some((x) => x.kind === 'model')) g.insertAdjacentHTML('beforeend', '<p class="hint">这一站还没有立体元素（第 4 步）。</p>');
    box.append(g);
  });
  // 自动排布：画面在后（−1.5），元素越靠下越近；同一站里大的放后面一点，避免挡住小的
  $('#auto').onclick = () => {
    for (const st of state.world.stations) {
      const art = st.layers.find((L) => L.id === 'art'); if (art) art.depth = -1.5;
      for (const L of st.layers.filter((x) => x.kind === 'model')) {
        const bottom = L.y / STATION_PX[1], size = L.h / STATION_PX[1];
        L.depth = +(0.2 + bottom * 1.6 - size * 0.8).toFixed(2);
      }
    }
    save(); go(5);
  };
  $('#back5').onclick = () => go(4); $('#next5').onclick = () => go(6);
}

// —— ⑥ 音乐与纪念品 → 送到相框 ——
let tryBox = null;
function step6() {
  const w = state.world, box = $('#songs');
  for (const [id, s] of Object.entries(SONGS)) {
    const el = document.createElement('div'); el.className = 'song';
    el.innerHTML = `<b>${s.name}</b><span>${s.mood}</span><button>试听</button>`;
    el.classList.toggle('on', w.music.id === id);
    el.onclick = (e) => {
      w.music.id = id; save(); $$('.song', box).forEach((x) => x.classList.toggle('on', x === el));
      if (e.target.tagName === 'BUTTON') {
        tryBox ??= new MusicBox(); tryBox.ensure(); tryBox.pause(0.05); tryBox.setSong(id); tryBox.play();
        clearTimeout(tryBox._t); tryBox._t = setTimeout(() => tryBox.pause(1.2), 7000);
      }
    };
    box.append(el);
  }
  // 纪念品：前面做好的元素，或单独生成
  const sel = $('#souv');
  if (w.demo) {
    const opts = [{ v: 'assets/models/demo_souvenir.glb', n: '灯塔音乐盒（案例纪念品）' }, ...w.stations.flatMap((st) => (st.elements ?? []).map((e) => ({ v: e.demo.model, n: `${st.title} · ${e.name}` })))];
    sel.innerHTML = '<option value="">（不要纪念品）</option>' + opts.map((o) => `<option value="${o.v}">${o.n}</option>`).join('');
    sel.value = w.souvenir.model ?? '';
    sel.onchange = () => { w.souvenir.model = sel.value || null; save(); $('#pv-p').value = 990; };
    $('#souv-up').textContent = '演示：上传照片单独生成纪念品';
    $('#souv-up').onclick = () => demoSouvenir();
  }
  const models = w.stations.flatMap((st) => (st.elements ?? []).filter((e) => e.model).map((e) => ({ id: slotId(e), name: `${st.title} · ${e.name}` })));
  const own = state.slots.find((s) => s.id === `w_${w.id}_souvenir` && s.model);
  if (own) models.unshift({ id: own.id, name: '单独生成的纪念品' });
  if (!w.demo) sel.innerHTML = '<option value="">（还没有）</option>' + models.map((m) => `<option value="${m.id}">${m.name}</option>`).join('');
  const curId = w.souvenir.model?.match(/models\/(.+?)\.glb/)?.[1] ?? '';
  if (!w.demo) sel.value = curId;
  if (!w.demo) sel.onchange = () => { const s = state.slots.find((x) => x.id === sel.value); w.souvenir.model = sel.value ? `assets/models/${sel.value}.glb?v=${Math.round(s?.modelTime ?? 0)}` : null; save(); pv.show(w.stations.length); $('#pv-p').value = 990; };
  $('#souv-text').value = w.souvenir.text ?? '';
  $('#souv-text').oninput = (e) => { w.souvenir.text = e.target.value; save(); $('#pv-p').value = 990; };
  if (!w.demo) $('#souv-up').onclick = () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    input.onchange = async () => {
      const f = input.files[0]; if (!f) return;
      if (!confirm('用这张照片生成纪念品（重画参考图 → 你确认 → 建模），会消耗 Tripo 额度。')) return;
      const sty = state.styles.find((s) => s.id === w.style);
      const q = new URLSearchParams({ slot: `w_${w.id}_souvenir`, kind: 'object', name: 'keepsake', hint: 'A small keepsake object.', style: sty?.prompt ?? '' });
      try { await api(`/api/studio/pipeline?${q}`, { method: 'POST', body: f }); } catch (e) { alert(e.message); }
      pollSlots();
    };
    input.click();
  };
  $('#back6').onclick = () => go(5);
  $('#publish').onclick = async () => {
    if (!w.souvenir.model && !confirm('还没有选纪念品，长卷尽头会是空的。仍然完成？')) return;
    const r = await api(`/api/worlds/${w.id}/publish`, { method: 'POST', body: '{}' });
    w.status = 'ready';  // 之后的保存不要把状态改回草稿
    const host = /^(localhost|127\.)/.test(location.hostname) ? (r.lan ?? '<电脑的局域网 IP>') : location.hostname;
    const done = $('#done'); done.hidden = false;
    done.innerHTML = `<b>完成！礼物编号 ${r.id}</b><p>在 Jupiter 相框的浏览器里打开：</p><code>http://${host}:${location.port}${r.device}</code>
      <p class="hint">打开后轻点屏幕进入全屏；相框和这台电脑要在同一个 Wi-Fi 下。想自动播放一遍，在地址末尾加 <b>&amp;auto</b>。</p>`;
  };
  pollSlots();
}
function paintSouvenirJob() {
  const s = state.slots.find((x) => x.id === `w_${state.world.id}_souvenir`), box = $('#souv-job');
  if (!box || !s?.job) return;
  const job = s.job, running = job.done === false;
  const key = JSON.stringify([job.artifacts, job.waiting, job.stage]);
  if (box.dataset.key === key) return; box.dataset.key = key;
  box.innerHTML = `<div class="hint">${running ? `${job.stage}${job.progress != null ? ` ${job.progress}%` : ''}` : job.failed ? `失败：${job.message}` : '纪念品做好了，在上面的下拉框里选它'}</div>${pipeHtml(s)}`;
  bindGate(box, s);
  if (!running && s.model && state.step === 6 && !$('#souv').querySelector(`option[value="${s.id}"]`)) go(6);
}

// ======================================================================
// 案例模式：结果是事先用 Tripo 生成的真实素材，这里只是把等待过程模拟出来（不调用 Tripo）
const demo = { paint: {}, slots: {} };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
function demoMode() { $('#demo-bar').hidden = !state.world?.demo; }
async function animate(set, stage, ms, steps = 12) {
  for (let k = 0; k <= steps; k++) { set({ stage, progress: Math.round((k / steps) * 100), done: false }); await sleep(ms / steps); }
}
async function demoPaint(list) {
  const w = state.world;
  for (const i of list) {
    const st = w.stations[i], src = st.demoArt?.[w.style];
    if (!src) continue;
    const set = (j) => { demo.paint[i] = j; step3Hook(); };
    set({ stage: '上传照片', progress: null, done: false }); await sleep(500);
    await animate(set, `按「${state.styles.find((s) => s.id === w.style)?.name}」重画`, 2200);
    const L = st.layers.find((x) => x.id === 'art');
    Object.assign(L, { src, fit: 'cover', x: 0, y: 0 }); delete L.w; delete L.h;
    if (!st.versions.includes(src)) st.versions.push(src);
    for (const M of st.layers) if (M.kind === 'model') delete M.hidden;   // 立体元素跟着画好的这一站一起出现
    set({ stage: '完成', progress: 100, done: true });
    save(); pv.show(i);
  }
}
let demoGateResolve = null;
async function demoGenerate(st, el) {
  if (!el.demo) { alert('案例模式下，新框的元素不会真的生成（会消耗 Tripo 额度）。可以对已有的三个元素点「重新生成 3D」看一遍过程，或者回到首页自己做一卷。'); return; }
  const w = state.world;
  const job = { demo: true, job: { done: false, updated: Date.now(), artifacts: { source: el.demo.crop } } };
  demo.slots[el.id] = job;
  const set = (j) => { Object.assign(job.job, j, { updated: Date.now() }); paintElements(); };
  const L = st.layers.find((x) => x.id === el.id);
  if (L) L.hidden = true;
  rebuildPreview();
  while (true) {
    await animate(set, '重画成给 3D 看的参考图', 2400);
    job.job.artifacts.reference = el.demo.ref;
    set({ stage: '等你确认参考图', progress: null, waiting: 'reference' });
    const ans = await new Promise((ok) => { demoGateResolve = ok; });
    set({ waiting: null });
    if (ans === 'cancel') { delete demo.slots[el.id]; if (L) delete L.hidden; save(); paintElements(); return; }
    if (ans === 'ok') break;
  }
  await animate(set, 'Tripo 建模', 3200, 16);
  await animate(set, '减面、烘贴图（适配相框）', 1200, 6);
  if (L) delete L.hidden;
  set({ stage: '完成', done: true, message: '已放回画里同一个位置' });
  save(); pv.show(w.stations.indexOf(st));
}
function bindDemoGate(box) {
  box.querySelectorAll('[data-g]').forEach((b) => { b.onclick = () => demoGateResolve?.(b.dataset.g); });
}
async function demoSouvenir() {
  const box = $('#souv-job');
  const steps = [['重画成纪念品参考图', 2200], ['Tripo 建模', 3000], ['减面、烘贴图', 1000]];
  for (const [t, ms] of steps) {
    for (let k = 0; k <= 10; k++) { box.innerHTML = `<div class="hint">${t} ${k * 10}%</div><div class="bar"><i style="width:${k * 10}%"></i></div>`; await sleep(ms / 10); }
    if (t.startsWith('重画')) box.insertAdjacentHTML('beforeend', `<div class="thumbs"><figure><img src="/worlds/${state.world.id}/${state.world.souvenir.demo.ref}">参考图</figure></div>`);
  }
  state.world.souvenir.model = 'assets/models/demo_souvenir.glb'; $('#souv').value = state.world.souvenir.model;
  box.innerHTML = `<div class="hint">纪念品做好了：灯塔音乐盒</div><div class="thumbs"><figure><img src="/worlds/${state.world.id}/${state.world.souvenir.demo.ref}">参考图</figure></div>`;
  save(); $('#pv-p').value = 990;
}

(async () => {
  state.styles = await api('/api/styles').catch(() => []);
  const wid = params.get('w');
  if (wid) {
    try { state.world = await api(`/api/worlds/${wid}`); state.style = state.world.style; demoMode(); rebuildPreview(); }
    catch (e) { alert(`找不到这个世界：${e.message}`); }
  }
  go(state.world ? +(params.get('s') ?? 3) : 1);
})();

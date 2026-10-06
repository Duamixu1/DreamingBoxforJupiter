// 精修工作台：按 Jupiter 屏幕（135.4 × 216.6 mm、1200 × 1920、10:16）精修四扇窗。
//   ① 原图排版：穆夏原画在屏幕里怎么放（预设 / 拖动 / 缩放），每扇窗单独保存
//   ② 元素拆分画布：在原画上画、改元素（人像、窗框、花……），下面陈列精修好的元素，可导出 PNG、送 Tripo 生成 3D
//   ③ 3D 预览：元素按深度摆好（有 3D 模型就用模型），立体摇摆 / 侧看分层
// 数据存在服务器 prototype/assets/layers/<窗>.json（studio_api.py），默认值来自 mucha-layers.js。
import { THREE, GLBLoader } from './three.js';
import { TUNING } from './config.js';
import { LAYERS, ORDER, MAKE_LABEL, LAYER_COLOR, SCREEN } from './mucha-layers.js';
import { letterPhase } from './worldclock.js';

const IMG_DIR = 'assets/mucha/';
const BODY = 95;                        // 原画只用到 95%：最下面的标题字不要
const CAM_Z = 26, HALF_W = 5.3, HALF_H = HALF_W * SCREEN.px[1] / SCREEN.px[0];
const WALL = '#e6d5ae';
const WIN_LABEL = ['晨', '昼', '暮', '夜'];
const clone = (x) => JSON.parse(JSON.stringify(x));
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

const imgCache = new Map();
const loadImage = (src) => {
  if (!imgCache.has(src)) imgCache.set(src, new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = src; }));
  return imgCache.get(src);
};

// 原图里和扫描版 0–100% 对应的像素矩形（高清照片带实物画框，用自动对齐的 photoRect 换算）
function srcRect(L, src, img) {
  if (src !== 'photo') return { x: 0, y: 0, w: img.width, h: img.height };
  const [a, b, c, d] = L.photoRect;
  return { x: a / 100 * img.width, y: b / 100 * img.height, w: (c - a) / 100 * img.width, h: (d - b) / 100 * img.height };
}

// —— 排版：原画（扫描坐标 0–95%）在屏幕上的位置 ——
// layout = { src, mode: contain | cover | custom, scale（画作高度 / 屏幕高度）, cx, cy（画作中心，屏幕比例）, fill }
function presetLayout(mode, aspect) {
  const screenAspect = SCREEN.px[0] / SCREEN.px[1];
  if (mode === 'cover') {
    const scale = screenAspect / aspect;              // 宽度贴满
    return { scale, cx: 0.5, cy: 0.5 + (0.5 - 45 / BODY) * scale };
  }
  return { scale: 1, cx: 0.5, cy: 0.5 };
}
// 返回扫描坐标 (u, v) → 屏幕像素的映射
// aspect = 画作 0–95% 部分的宽 / 高。屏幕像素宽高比和屏幕一致，所以画作宽度 = 高度 × aspect
function screenMap(layout, aspect, W, H) {
  const bh = layout.scale * H, bw = bh * aspect;
  const x0 = layout.cx * W - bw / 2, y0 = layout.cy * H - bh / 2;
  return { x0, y0, bw, bh, at: ([u, v]) => [x0 + u / 100 * bw, y0 + v / BODY * bh] };
}

export function initWorkbench(root, { renderer, createWorld, openViewer }) {
  root.innerHTML = `
    <div class="wb-top">
      <div class="wb-wins">${ORDER.map((k, i) => `<button data-win="${i}">${WIN_LABEL[i]} · ${LAYERS[k].title}</button>`).join('')}</div>
      <div class="wb-steps"><button data-step="layout">① 原图排版</button><button data-step="split">② 元素拆分画布</button><button data-step="preview">③ 3D 预览</button></div>
      <span class="wb-save"></span>
    </div>
    <div class="wb-body">
      <div class="wb-main"></div>
      <div class="wb-side"></div>
    </div>
    <div class="wb-bottom"></div>`;
  const $ = (s) => root.querySelector(s);
  const main = $('.wb-main'), side = $('.wb-side'), bottom = $('.wb-bottom');

  const docs = [];                 // 每扇窗：{ layout, elements }
  let win = 0, step = 'layout', sel = null, slots = [];
  const aspectOf = (img, L, src) => { const r = srcRect(L, src, img); return (img.width ? r.w : 1) / (r.h * BODY / 100); };

  // —— 保存（改动后 0.6 秒写回服务器）——
  const timers = [];
  function save(i = win) {
    $('.wb-save').textContent = '保存中…';
    clearTimeout(timers[i]);
    timers[i] = setTimeout(async () => {
      const res = await fetch(`/api/studio/doc/${ORDER[i]}`, { method: 'PUT', body: JSON.stringify(docs[i]) }).catch(() => null);
      $('.wb-save').textContent = res?.ok ? `已保存 ${new Date().toLocaleTimeString()}` : '保存失败（服务器没开？）';
    }, 600);
  }

  async function loadDocs() {
    await Promise.all(ORDER.map(async (k, i) => {
      let d = {};
      try { d = await (await fetch(`/api/studio/doc/${k}`, { cache: 'no-store' })).json(); } catch { /* 用默认 */ }
      docs[i] = {
        layout: d.layout ?? { src: 'scan', mode: 'contain', ...presetLayout('contain', 0.39), fill: 'wall' },
        elements: d.elements ?? clone(LAYERS[k].elements),
      };
    }));
  }

  // 区域大小变了（下方陈列栏载入、窗口缩放）就重新适配；切页时换掉旧的监听
  let observer = null;
  function watch(el, fn) {
    observer?.disconnect();
    let raf = 0;
    observer = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fn); });
    observer.observe(el);
  }

  const doc = () => docs[win];
  const L = () => LAYERS[ORDER[win]];
  const curImg = () => loadImage(IMG_DIR + (doc().layout.src === 'photo' ? L().photo : L().scan));

  // ======================================================================
  // 通用：在一块 Jupiter 屏上画原画（按排版）
  function drawScreen(g, W, H, img, Ld, d, { dim = 1, overlay = false, guides = false } = {}) {
    const r = srcRect(Ld, d.layout.src, img), aspect = r.w / (r.h * BODY / 100);
    const m = screenMap(d.layout, aspect, W, H);
    g.fillStyle = d.layout.fill === 'black' ? '#000' : WALL;
    g.fillRect(0, 0, W, H);
    if (d.layout.fill === 'blur') {
      g.save(); g.filter = 'blur(18px) brightness(0.9)';
      g.drawImage(img, r.x, r.y, r.w, r.h * BODY / 100, -W * 0.15, -H * 0.05, W * 1.3, H * 1.1);
      g.restore();
    }
    g.save();
    g.globalAlpha = dim;
    g.drawImage(img, r.x, r.y, r.w, r.h * BODY / 100, m.x0, m.y0, m.bw, m.bh);
    g.restore();
    if (overlay) {
      d.elements.forEach((el, k) => {
        g.save(); g.beginPath();
        for (const poly of [el.poly, el.hole].filter(Boolean)) { poly.forEach((p, i) => { const [x, y] = m.at(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); }
        g.fillStyle = LAYER_COLOR(el.depth) + (el.hole || el.id === 'backdrop' ? '14' : '38'); g.fill('evenodd');
        g.lineWidth = W / 300; g.strokeStyle = LAYER_COLOR(el.depth); g.stroke();
        g.restore();
        void k;
      });
    }
    if (guides) {
      g.save(); g.strokeStyle = '#ffffffaa'; g.setLineDash([W / 60, W / 60]); g.lineWidth = Math.max(1, W / 500);
      for (const f of [1 / 3, 2 / 3]) { g.beginPath(); g.moveTo(W * f, 0); g.lineTo(W * f, H); g.moveTo(0, H * f); g.lineTo(W, H * f); g.stroke(); }
      g.restore();
    }
    return m;
  }

  function device(el, { big = false } = {}) {
    el.innerHTML = '<div class="bezel"><div class="screen"><canvas></canvas></div></div>';
    const fit = () => {
      const availH = big ? el.clientHeight - 8 : el.clientHeight;
      const availW = el.clientWidth;
      const mh = Math.max(120, Math.min(availH, availW * SCREEN.module.h / SCREEN.module.w)), mw = mh * SCREEN.module.w / SCREEN.module.h;
      const sw = mw * SCREEN.w / SCREEN.module.w, sh = mh * SCREEN.h / SCREEN.module.h;
      Object.assign(el.querySelector('.bezel').style, { width: `${mw}px`, height: `${mh}px` });
      Object.assign(el.querySelector('.screen').style, { width: `${sw}px`, height: `${sh}px` });
      const c = el.querySelector('canvas'), dpr = Math.min(devicePixelRatio, 2);
      c.width = Math.round(sw * dpr); c.height = Math.round(sh * dpr); c.style.width = `${sw}px`; c.style.height = `${sh}px`;
      return c;
    };
    return { canvas: el.querySelector('canvas'), screen: el.querySelector('.screen'), fit };
  }

  // ======================================================================
  // ① 原图排版
  async function stepLayout() {
    main.innerHTML = '<div class="wb-device big"></div>';
    const dev = device(main.firstChild, { big: true });
    const d = doc(), lay = d.layout;
    side.innerHTML = `
      <h3>原图排版 · ${L().title}</h3>
      <div class="field"><label>原图</label><div class="seg" data-k="src"><button data-v="scan">扫描版</button><button data-v="photo">实拍高清</button></div></div>
      <div class="field"><label>放法</label><div class="seg" data-k="mode"><button data-v="contain">等高完整</button><button data-v="cover">铺满裁切</button><button data-v="custom">自定义</button></div></div>
      <div class="field"><label>缩放 <span class="val" id="sv"></span></label><input type="range" id="scale" min="40" max="300" step="1"></div>
      <div class="field"><label>两侧</label><div class="seg" data-k="fill"><button data-v="wall">窗墙色</button><button data-v="black">黑</button><button data-v="blur">模糊延展</button></div></div>
      <label class="sw"><input type="checkbox" id="guides"> 三分参考线</label>
      <div class="info" id="info"></div>
      <div class="row"><button id="allwin">四扇窗都用这个排版</button><button id="reset">恢复默认</button></div>
      <p class="sub">在屏幕上拖动 = 移动画作；滚轮 = 缩放（会切到「自定义」）。</p>`;
    const img = await curImg();
    const aspect = aspectOf(img, L(), lay.src);
    const paint = () => {
      const c = dev.fit(), g = c.getContext('2d');
      drawScreen(g, c.width, c.height, img, L(), d, { guides: $('#guides')?.checked });
      side.querySelectorAll('.seg').forEach((sg) => sg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', lay[sg.dataset.k] === b.dataset.v)));
      $('#scale').value = Math.round(lay.scale * 100); $('#sv').textContent = `${Math.round(lay.scale * 100)}%`;
      // 物理尺寸：画作在屏上多大、留边多少、原图放大多少
      const bodyH = lay.scale * SCREEN.h, bodyW = bodyH * aspect;
      const vis = clamp(bodyW, 0, SCREEN.w);
      const r = srcRect(L(), lay.src, img), zoom = lay.scale * SCREEN.px[1] / (r.h * BODY / 100);
      $('#info').innerHTML = `画作 ${bodyW.toFixed(0)} × ${bodyH.toFixed(0)} mm（屏幕 ${SCREEN.w} × ${SCREEN.h} mm）<br>`
        + (bodyW < SCREEN.w ? `左右共留 ${(SCREEN.w - vis).toFixed(0)} mm` : `左右裁掉 ${(bodyW - SCREEN.w).toFixed(0)} mm`) + (bodyH > SCREEN.h ? `，上下裁掉 ${(bodyH - SCREEN.h).toFixed(0)} mm` : '') + '<br>'
        + `原图 ${img.width}×${img.height}，屏上${zoom > 1.05 ? `放大 ${zoom.toFixed(1)}×${zoom > 1.3 ? '（偏软，换实拍高清）' : ''}` : zoom < 0.95 ? `缩小到 ${(zoom * 100).toFixed(0)}%` : '约 1:1'}`;
      strip();
    };
    side.querySelectorAll('.seg').forEach((sg) => sg.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
      lay[sg.dataset.k] = b.dataset.v;
      if (sg.dataset.k === 'mode' && b.dataset.v !== 'custom') Object.assign(lay, presetLayout(b.dataset.v, aspect));
      save(); if (sg.dataset.k === 'src') return stepLayout(); paint();
    })));
    $('#scale').oninput = (e) => { lay.scale = e.target.value / 100; lay.mode = 'custom'; save(); paint(); };
    $('#guides').onchange = paint;
    $('#reset').onclick = () => { Object.assign(lay, { mode: 'contain', ...presetLayout('contain', aspect), fill: 'wall' }); save(); paint(); };
    $('#allwin').onclick = () => { docs.forEach((dd, i) => { if (i !== win) { dd.layout = { ...clone(lay) }; save(i); } }); paint(); };
    // 拖动 / 滚轮
    let drag = null;
    dev.screen.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, cx: lay.cx, cy: lay.cy }; dev.screen.setPointerCapture(e.pointerId); };
    dev.screen.onpointermove = (e) => {
      if (!drag) return;
      const r = dev.screen.getBoundingClientRect();
      lay.cx = drag.cx + (e.clientX - drag.x) / r.width; lay.cy = drag.cy + (e.clientY - drag.y) / r.height; lay.mode = 'custom';
      paint();
    };
    dev.screen.onpointerup = () => { if (drag) save(); drag = null; };
    dev.screen.onwheel = (e) => { e.preventDefault(); lay.scale = clamp(lay.scale * Math.exp(-e.deltaY * 0.001), 0.4, 3); lay.mode = 'custom'; save(); paint(); };
    watch(main, paint);
    paint();
  }

  // 底部：四扇窗的排版缩略
  async function strip() {
    if (step !== 'layout') return;
    if (!bottom.querySelector('.wb-strip')) {
      bottom.innerHTML = `<div class="wb-strip">${ORDER.map((k, i) => `<div class="mini" data-i="${i}"><div class="wb-device"></div><span>${WIN_LABEL[i]} · ${LAYERS[k].title}</span></div>`).join('')}</div>`;
      bottom.querySelectorAll('.mini').forEach((m) => { m.onclick = () => go(+m.dataset.i); });
    }
    for (const [i, k] of ORDER.entries()) {
      const box = bottom.querySelector(`.mini[data-i="${i}"]`);
      box.classList.toggle('on', i === win);
      const holder = box.querySelector('.wb-device');
      if (!holder.firstChild) holder._dev = device(holder);
      const c = holder._dev.fit();
      const im = await loadImage(IMG_DIR + (docs[i].layout.src === 'photo' ? LAYERS[k].photo : LAYERS[k].scan));
      drawScreen(c.getContext('2d'), c.width, c.height, im, LAYERS[k], docs[i]);
    }
  }

  // ======================================================================
  // ② 元素拆分画布
  async function stepSplit() {
    main.innerHTML = `
      <div class="cv-tools">
        <button data-tool="select" class="on" title="V">选择 / 改顶点</button>
        <button data-tool="draw" title="P">画新元素</button>
        <span class="sep"></span>
        <label>原图亮度 <input type="range" id="dim" min="15" max="100" value="55"></label>
        <label class="sw"><input type="checkbox" id="onlysel"> 只看选中</label>
        <button id="fitv">适合窗口</button>
        <span class="hint">空格+拖动 / 右键拖动 = 平移 · 滚轮 = 缩放 · 画元素：逐点单击，回车或双击收口，Esc 取消 · 选中后：拖顶点改形，双击边加点，Alt+点顶点删点，拖内部整体移动，Delete 删除元素</span>
      </div>
      <div class="cv-wrap"><canvas></canvas></div>`;
    const wrap = main.querySelector('.cv-wrap'), cv = wrap.querySelector('canvas'), g = cv.getContext('2d');
    const img = await curImg();
    const r = srcRect(L(), doc().layout.src, img);
    // 画布视图：扫描坐标 (u, v) → 画布像素
    const view = { s: 1, x: 0, y: 0 };
    const pxPerU = () => r.w / 100 * view.s, pxPerV = () => r.h / 100 * view.s;
    const toPx = ([u, v]) => [view.x + u * pxPerU(), view.y + v * pxPerV()];
    const toUV = (x, y) => [(x - view.x) / pxPerU(), (y - view.y) / pxPerV()];
    let tool = 'select', draft = null, drag = null, spaceDown = false, hoverV = null;

    function fitView() {
      const dpr = Math.min(devicePixelRatio, 2);
      cv.width = wrap.clientWidth * dpr; cv.height = wrap.clientHeight * dpr;
      cv.style.width = `${wrap.clientWidth}px`; cv.style.height = `${wrap.clientHeight}px`;
      view.s = Math.min(cv.width / r.w, cv.height / (r.h * BODY / 100)) * 0.96;
      view.x = (cv.width - r.w * view.s) / 2; view.y = (cv.height - r.h * BODY / 100 * view.s) / 2;
      draw();
    }
    function polyPath(el) {
      g.beginPath();
      for (const poly of [el.poly, el.hole].filter(Boolean)) { poly.forEach((p, i) => { const [x, y] = toPx(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); }
    }
    function draw() {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#2b241e'; g.fillRect(0, 0, cv.width, cv.height);
      const [x0, y0] = toPx([0, 0]), [x1, y1] = toPx([100, BODY]);
      g.globalAlpha = $('#dim').value / 100;
      g.drawImage(img, r.x, r.y, r.w, r.h * BODY / 100, x0, y0, x1 - x0, y1 - y0);
      g.globalAlpha = 1;
      const only = $('#onlysel').checked;
      doc().elements.forEach((el) => {
        if (only && el !== sel) return;
        const c = LAYER_COLOR(el.depth), on = el === sel;
        polyPath(el);
        if (on) { g.save(); g.clip('evenodd'); g.drawImage(img, r.x, r.y, r.w, r.h * BODY / 100, x0, y0, x1 - x0, y1 - y0); g.restore(); polyPath(el); }
        g.fillStyle = c + (on ? '22' : el.hole || el.id === 'backdrop' ? '10' : '30'); g.fill('evenodd');
        g.lineWidth = on ? 2.5 : 1.3; g.strokeStyle = c; g.stroke();
        if (on) for (const poly of [el.poly, el.hole].filter(Boolean)) poly.forEach((p) => {
          const [x, y] = toPx(p); g.beginPath(); g.arc(x, y, p === hoverV ? 7 : 5, 0, Math.PI * 2);
          g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2; g.strokeStyle = c; g.stroke();
        });
        if (!el.hole && el.id !== 'backdrop') {
          const cx = el.poly.reduce((a, p) => a + p[0], 0) / el.poly.length, cy = el.poly.reduce((a, p) => a + p[1], 0) / el.poly.length;
          const [x, y] = toPx([cx, cy]);
          g.font = `600 ${13 * Math.min(devicePixelRatio, 2)}px system-ui`; g.textAlign = 'center';
          g.lineWidth = 4; g.strokeStyle = '#000a'; g.strokeText(el.name, x, y); g.fillStyle = '#fff'; g.fillText(el.name, x, y);
        }
      });
      if (draft?.length) {
        g.beginPath(); draft.forEach((p, i) => { const [x, y] = toPx(p); i ? g.lineTo(x, y) : g.moveTo(x, y); });
        if (draft.mouse) { const [x, y] = toPx(draft.mouse); g.lineTo(x, y); }
        g.strokeStyle = '#ffd27a'; g.lineWidth = 2; g.setLineDash([6, 4]); g.stroke(); g.setLineDash([]);
        draft.forEach((p) => { const [x, y] = toPx(p); g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fillStyle = '#ffd27a'; g.fill(); });
      }
    }
    const evUV = (e) => { const b = cv.getBoundingClientRect(), k = cv.width / b.width; return toUV((e.clientX - b.left) * k, (e.clientY - b.top) * k); };
    const near = (uv, p, rad = 9) => { const [ax, ay] = toPx(uv), [bx, by] = toPx(p); return Math.hypot(ax - bx, ay - by) < rad * Math.min(devicePixelRatio, 2); };
    const inside = (uv, el) => {
      let c = false;
      for (const poly of [el.poly, el.hole].filter(Boolean)) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > uv[1]) !== (yj > uv[1]) && uv[0] < (xj - xi) * (uv[1] - yi) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const setTool = (t) => { tool = t; draft = null; main.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); cv.style.cursor = t === 'draw' ? 'crosshair' : 'default'; draw(); };
    main.querySelectorAll('[data-tool]').forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });
    $('#dim').oninput = draw; $('#onlysel').onchange = draw; $('#fitv').onclick = fitView;

    function finishDraft() {
      if (!draft || draft.length < 3) { draft = null; draw(); return; }
      const n = doc().elements.filter((e) => e.id.startsWith('el')).length + 1;
      const el = { id: `el${Date.now().toString(36).slice(-5)}`, name: `新元素 ${n}`, depth: 1, make: 'tripo', poly: draft.map((p) => p.map((v) => +v.toFixed(2))) };
      doc().elements.push(el); sel = el; draft = null; setTool('select'); save(); inspector(); gallery();
    }
    cv.oncontextmenu = (e) => e.preventDefault();
    cv.onpointerdown = (e) => {
      cv.setPointerCapture(e.pointerId);
      const uv = evUV(e);
      if (e.button === 2 || e.button === 1 || spaceDown) { drag = { pan: true, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; return; }
      if (tool === 'draw') {
        if (draft && draft.length > 2 && near(uv, draft[0])) return finishDraft();
        (draft ??= []).push(uv.map((v) => clamp(v, -5, 105))); draw(); return;
      }
      // 选择：先看选中元素的顶点，再看元素内部
      if (sel) for (const poly of [sel.poly, sel.hole].filter(Boolean)) {
        const k = poly.findIndex((p) => near(uv, p));
        if (k >= 0) {
          if (e.altKey && poly.length > 3) { poly.splice(k, 1); save(); draw(); return; }
          drag = { poly, k }; return;
        }
      }
      const hit = [...doc().elements].reverse().find((el) => el.id !== 'backdrop' && !el.hole && inside(uv, el)) ?? doc().elements.find((el) => el.hole && inside(uv, el)) ?? doc().elements.find((el) => el.id === 'backdrop' && inside(uv, el));
      sel = hit ?? null;
      if (sel && !sel.hole) drag = { move: true, from: uv, orig: clone(sel.poly) };
      inspector(); gallery(); draw();
    };
    cv.onpointermove = (e) => {
      const uv = evUV(e);
      if (drag?.pan) { const k = cv.width / cv.getBoundingClientRect().width; view.x = drag.vx + (e.clientX - drag.x) * k; view.y = drag.vy + (e.clientY - drag.y) * k; draw(); return; }
      if (drag?.poly) { drag.poly[drag.k] = uv.map((v) => +clamp(v, -5, 105).toFixed(2)); draw(); return; }
      if (drag?.move) { const du = uv[0] - drag.from[0], dv = uv[1] - drag.from[1]; sel.poly = drag.orig.map(([u, v]) => [+(u + du).toFixed(2), +(v + dv).toFixed(2)]); draw(); return; }
      if (draft) { draft.mouse = uv; draw(); }
      else if (sel) { const v = [sel.poly, sel.hole].filter(Boolean).flat().find((p) => near(uv, p)) ?? null; if (v !== hoverV) { hoverV = v; draw(); } }
    };
    cv.onpointerup = () => { if (drag && !drag.pan) { save(); gallery(); } drag = null; };
    cv.ondblclick = (e) => {
      if (tool === 'draw') return finishDraft();
      if (!sel) return;
      // 双击边：插一个顶点
      const uv = evUV(e), poly = sel.poly;
      let best = null;
      for (let i = 0; i < poly.length; i++) {
        const a = toPx(poly[i]), b = toPx(poly[(i + 1) % poly.length]), p = toPx(uv);
        const t = clamp(((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1), 0, 1);
        const d = Math.hypot(a[0] + t * (b[0] - a[0]) - p[0], a[1] + t * (b[1] - a[1]) - p[1]);
        if (!best || d < best.d) best = { d, i };
      }
      if (best && best.d < 14 * Math.min(devicePixelRatio, 2)) { poly.splice(best.i + 1, 0, uv.map((v) => +v.toFixed(2))); save(); draw(); }
    };
    cv.onwheel = (e) => {
      e.preventDefault();
      const b = cv.getBoundingClientRect(), k = cv.width / b.width, mx = (e.clientX - b.left) * k, my = (e.clientY - b.top) * k;
      const f = Math.exp(-e.deltaY * 0.0015);
      view.x = mx - (mx - view.x) * f; view.y = my - (my - view.y) * f; view.s *= f; draw();
    };
    keyHandler = (e) => {
      if (e.target.closest('input, textarea, select')) return;
      if (e.code === 'Space') { spaceDown = e.type === 'keydown'; cv.style.cursor = spaceDown ? 'grab' : tool === 'draw' ? 'crosshair' : 'default'; e.preventDefault(); }
      if (e.type !== 'keydown') return;
      if (e.key === 'v' || e.key === 'V') setTool('select');
      if (e.key === 'p' || e.key === 'P') setTool('draw');
      if (e.key === 'Enter' && draft) finishDraft();
      if (e.key === 'Escape') { draft = null; draw(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !draft) removeEl(sel);
    };
    watch(wrap, fitView);
    redrawSplit = draw;
    fitView();
    inspector(); gallery();
  }
  let keyHandler = null, redrawSplit = () => {};
  window.addEventListener('keydown', (e) => keyHandler?.(e));
  window.addEventListener('keyup', (e) => keyHandler?.(e));

  function removeEl(el) {
    if (!confirm(`删除元素「${el.name}」？`)) return;
    doc().elements.splice(doc().elements.indexOf(el), 1); sel = null; save(); inspector(); gallery(); redrawSplit();
  }

  // 右侧：选中元素的属性
  function inspector() {
    if (step !== 'split') return;
    if (!sel) {
      side.innerHTML = `<h3>元素拆分 · ${L().title}</h3><p class="sub">点原图上的区域选中一个元素，或用「画新元素」圈一块新的。</p>
        <div class="legend">${[['−7', '远景', -7], ['−3', '中后景', -3], ['0', '焦平面（人物）', 0], ['+1.5', '人物身前', 1.5], ['+3', '外框', 3.2]].map(([v, t, d]) => `<div><i style="background:${LAYER_COLOR(d)}"></i>${v} ${t}</div>`).join('')}</div>
        <div class="row"><button id="restore">恢复这扇窗的默认拆分</button></div>`;
      $('#restore').onclick = () => { if (confirm('用默认拆分覆盖这扇窗的所有元素？')) { doc().elements = clone(L().elements); save(); stepSplit(); } };
      return;
    }
    const el = sel;
    side.innerHTML = `
      <h3><i class="dot" style="background:${LAYER_COLOR(el.depth)}"></i> 元素</h3>
      <div class="field"><label>名称</label><input id="f-name" value="${el.name.replace(/"/g, '&quot;')}"></div>
      <div class="field"><label>深度 <span class="val">${el.depth > 0 ? '+' : ''}${el.depth}</span></label><input type="range" id="f-depth" min="-8" max="4" step="0.1" value="${el.depth}"><div class="sub">负数往里，正数朝观众；0 = 焦平面（人物），最清楚</div></div>
      <div class="field"><label>做法</label><div class="seg" id="f-make">${Object.entries(MAKE_LABEL).map(([k, v]) => `<button data-v="${k}" class="${el.make === k ? 'on' : ''}">${v}</button>`).join('')}</div></div>
      <div class="field"><label>备注</label><textarea id="f-note" rows="3">${el.note ?? ''}</textarea></div>
      <div class="sub">${el.poly.length} 个顶点${el.hole ? '，带镂空（窗口）' : ''}</div>
      <div class="row"><button id="f-dup">复制</button><button id="f-del">删除</button><button id="f-done">取消选中</button></div>`;
    const upd = () => { save(); gallery(); redrawSplit(); };
    $('#f-name').oninput = (e) => { el.name = e.target.value; upd(); };
    $('#f-depth').oninput = (e) => { el.depth = +e.target.value; side.querySelector('.val').textContent = `${el.depth > 0 ? '+' : ''}${el.depth}`; upd(); };
    $('#f-note').oninput = (e) => { el.note = e.target.value; save(); };
    side.querySelectorAll('#f-make button').forEach((b) => { b.onclick = () => { el.make = b.dataset.v; inspector(); upd(); }; });
    $('#f-dup').onclick = () => { const c = { ...clone(el), id: `el${Date.now().toString(36).slice(-5)}`, name: `${el.name} 副本`, poly: el.poly.map(([u, v]) => [u + 2, v + 2]) }; doc().elements.push(c); sel = c; upd(); inspector(); };
    $('#f-del').onclick = () => removeEl(el);
    $('#f-done').onclick = () => { sel = null; inspector(); gallery(); redrawSplit(); };
  }

  // 抠图：按多边形从原图（当前原图源，原始分辨率）裁出透明底 PNG
  async function cutout(el, { maxSide = 0 } = {}) {
    const img = await curImg(), r = srcRect(L(), doc().layout.src, img);
    const pts = el.poly.concat(el.hole ?? []);
    const u0 = clamp(Math.min(...pts.map((p) => p[0])), 0, 100), u1 = clamp(Math.max(...pts.map((p) => p[0])), 0, 100);
    const v0 = clamp(Math.min(...pts.map((p) => p[1])), 0, BODY), v1 = clamp(Math.max(...pts.map((p) => p[1])), 0, BODY);
    const sx = r.x + u0 / 100 * r.w, sy = r.y + v0 / 100 * r.h, sw = (u1 - u0) / 100 * r.w, sh = (v1 - v0) / 100 * r.h;
    const k = maxSide ? Math.min(1, maxSide / Math.max(sw, sh)) : 1;
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(sw * k)); c.height = Math.max(2, Math.round(sh * k));
    const g = c.getContext('2d');
    g.beginPath();
    for (const poly of [el.poly, el.hole].filter(Boolean)) { poly.forEach(([u, v], i) => { const x = (r.x + u / 100 * r.w - sx) * k, y = (r.y + v / 100 * r.h - sy) * k; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); }
    g.clip('evenodd');
    g.drawImage(img, -sx * k, -sy * k, img.width * k, img.height * k);
    return { canvas: c, box: [u0, v0, u1, v1] };
  }

  const slotIdOf = (el) => `el_${ORDER[win]}_${el.id.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`.slice(0, 50);
  const ladySlot = () => `mucha_lady_${ORDER[win]}`;
  const slotFor = (el) => (el.id === 'figure' ? ladySlot() : slotIdOf(el));

  // 底部：精修元素陈列
  async function gallery() {
    if (step !== 'split' && step !== 'preview') return;
    const els = [...doc().elements].sort((a, b) => a.depth - b.depth);
    bottom.innerHTML = `<div class="wb-gallery-title">精修元素 · ${L().title}（按深度从远到近）</div><div class="wb-gallery">${els.map((el) => `
      <div class="gcard ${el === sel ? 'on' : ''}" data-id="${el.id}">
        <div class="gthumb"></div>
        <div class="gname"><i class="dot" style="background:${LAYER_COLOR(el.depth)}"></i>${el.name}</div>
        <div class="gmeta">深度 ${el.depth > 0 ? '+' : ''}${el.depth} · ${MAKE_LABEL[el.make]}</div>
        <div class="gstat"></div>
        <div class="gact"><button data-a="png">导出 PNG</button>${el.make === 'tripo' ? '<button data-a="gen">生成 3D</button>' : ''}<button data-a="view" hidden>查看 3D</button></div>
      </div>`).join('')}</div>`;
    for (const el of els) {
      const card = bottom.querySelector(`.gcard[data-id="${el.id}"]`);
      const { canvas } = await cutout(el, { maxSide: 220 });
      card.querySelector('.gthumb').append(canvas);
      card.onclick = (e) => { if (e.target.closest('button')) return; sel = el; if (step === 'split') { inspector(); redrawSplit(); } gallery(); };
      card.querySelector('[data-a=png]').onclick = async () => {
        const { canvas: full } = await cutout(el);
        full.toBlob((b) => { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(b), download: `${ORDER[win]}-${el.id}-${doc().layout.src}.png` }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, 'image/png');
      };
      card.querySelector('[data-a=gen]')?.addEventListener('click', async () => {
        const sid = slotFor(el);
        const { canvas: full } = await cutout(el, { maxSide: 2048 });
        const blob = await new Promise((ok) => full.toBlob(ok, 'image/png'));
        // 先在服务器登记这个精修元素的槽位，再走流水线：人物按人物流程，其余按物件流程
        const slot = slots.find((x) => x.id === sid) ?? { id: sid, name: `${WIN_LABEL[win]} · ${el.name}`, kind: el.id === 'figure' ? 'relief' : 'prop' };
        await window.startPipeline(slot, blob, { kind: el.id === 'figure' ? 'character' : 'object', name: el.name, hint: el.note ?? '' });
      });
      card.querySelector('[data-a=view]').onclick = () => { const s = slots.find((x) => x.id === slotFor(el)); if (s) openViewer(s); };
    }
    paintSlots();
  }
  function paintSlots() {
    bottom.querySelectorAll('.gcard').forEach((card) => {
      const el = doc().elements.find((e) => e.id === card.dataset.id);
      if (!el) return;
      const s = slots.find((x) => x.id === slotFor(el));
      const job = s?.job, running = job && job.done === false;
      card.querySelector('.gstat').textContent = running ? `${job.stage}${job.progress != null ? ` ${job.progress}%` : ''}` : job?.failed ? `失败：${job.message}` : s?.model ? '已有 3D 模型' : '';
      card.querySelector('.gstat').className = 'gstat' + (running ? ' run' : job?.failed ? ' bad' : s?.model ? ' ok' : '');
      card.querySelector('[data-a=view]').hidden = !(s?.model || s?.raw);
      const gen = card.querySelector('[data-a=gen]'); if (gen) gen.disabled = !!running;
    });
  }

  // ======================================================================
  // ③ 3D 预览：元素按深度摆成贴片；有 3D 模型的元素换成模型
  let p3 = null;
  const glbLoader = new GLBLoader(renderer, { dracoDecoderPath: './vendor/jupiter-sdk/decoders/draco/', ktx2TranscoderPath: './vendor/jupiter-sdk/decoders/basis/' });
  const glbCache = new Map();
  const loadGlb = (url) => { if (!glbCache.has(url)) glbCache.set(url, glbLoader.load(url).then((g) => g.scene)); return glbCache.get(url); };

  async function stepPreview() {
    main.innerHTML = '<div class="wb-device big"></div>';
    const dev = device(main.firstChild, { big: true });
    side.innerHTML = `
      <h3>3D 预览 · ${L().title}</h3>
      <div class="field"><label>内容</label><div class="seg" id="p-src"><button data-v="cards" class="on">原图分层</button><button data-v="scene">盒子里的 3D 布景</button></div></div>
      <label class="sw"><input type="checkbox" id="p-wig" checked> 立体摇摆（模拟在裸眼屏前左右看）</label>
      <div class="field"><label>摇摆幅度</label><input type="range" id="p-amp" min="0.3" max="4" step="0.1" value="1.4"></div>
      <label class="sw"><input type="checkbox" id="p-models" checked> 有 3D 模型的元素用模型</label>
      <div class="field"><label>视角</label><div class="seg" id="p-view"><button data-v="front" class="on">正面（屏幕）</button><button data-v="side">侧看分层</button></div></div>
      <div class="info" id="p-info"></div>
      <p class="sub">侧看分层时可以拖动旋转，看各层前后拉开多少。正面视角就是相框上看到的构图。</p>`;
    const r3 = new THREE.WebGLRenderer({ antialias: true });
    r3.outputColorSpace = THREE.SRGBColorSpace;
    dev.screen.querySelector('canvas').replaceWith(r3.domElement);
    const st = { src: 'cards', view: 'front', yaw: 0.9, t: 0 };
    let built = null, world = null;

    async function build() {
      const d = doc(), img = await curImg(), r = srcRect(L(), d.layout.src, img), aspect = r.w / (r.h * BODY / 100);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(d.layout.fill === 'black' ? '#000' : WALL);
      scene.add(new THREE.HemisphereLight('#fff6ea', '#8a7a64', 1.6));
      const sun = new THREE.DirectionalLight('#ffffff', 1.2); sun.position.set(-3, 5, 8); scene.add(sun);
      const cam = new THREE.PerspectiveCamera(2 * Math.atan(HALF_H / CAM_Z) * 180 / Math.PI, SCREEN.px[0] / SCREEN.px[1], 0.3, 300);
      // 屏幕（焦平面）上的排版，和 ① 一致
      const m = screenMap(d.layout, aspect, 2 * HALF_W, 2 * HALF_H);
      const world2 = ([u, v]) => { const [x, y] = m.at([u, v]); return [x - HALF_W, HALF_H - y]; };
      let nModels = 0;
      for (const el of d.elements) {
        const s = (CAM_Z - el.depth) / CAM_Z; // 透视补偿：正面看时各层和原画重合
        const { canvas, box } = await cutout(el, { maxSide: 1400 });
        const [ax, ay] = world2([box[0], box[1]]), [bx, by] = world2([box[2], box[3]]);
        const slot = slots.find((x) => x.id === slotFor(el));
        if ($('#p-models')?.checked && slot?.model) {
          try {
            const src = await loadGlb(`assets/models/${slot.id}.glb?t=${slot.modelTime}`);
            const mdl = src.clone(true);
            const bb = new THREE.Box3().setFromObject(mdl), size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
            const k = ((ay - by) * s) / (size.y || 1);
            mdl.position.sub(c).multiplyScalar(k);
            const g = new THREE.Group(); g.add(mdl); mdl.scale.multiplyScalar(k);
            mdl.traverse((o) => { if (o.isMesh) for (const mm of [].concat(o.material)) mm.metalness = 0; });
            g.position.set((ax + bx) / 2 * s, (ay + by) / 2 * s, el.depth);
            scene.add(g); nModels++;
            continue;
          } catch { /* 模型载入失败就用贴片 */ }
        }
        const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry((bx - ax) * s, (ay - by) * s), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
        mesh.position.set((ax + bx) / 2 * s, (ay + by) / 2 * s, el.depth);
        mesh.renderOrder = el.depth;
        scene.add(mesh);
      }
      const ds = d.elements.map((e) => e.depth);
      $('#p-info').innerHTML = `${d.elements.length} 层，其中 ${nModels} 层用 3D 模型<br>深度 ${Math.min(...ds)} → +${Math.max(...ds)}（焦平面 = 0）`;
      return { scene, cam };
    }
    const rebuild = async () => { built = await build(); };
    side.querySelectorAll('#p-src button').forEach((b) => { b.onclick = async () => { st.src = b.dataset.v; side.querySelectorAll('#p-src button').forEach((x) => x.classList.toggle('on', x === b)); if (st.src === 'scene' && !world) world = await createWorld(); }; });
    side.querySelectorAll('#p-view button').forEach((b) => { b.onclick = () => { st.view = b.dataset.v; side.querySelectorAll('#p-view button').forEach((x) => x.classList.toggle('on', x === b)); }; });
    $('#p-models').onchange = rebuild;
    let drag = null;
    r3.domElement.onpointerdown = (e) => { drag = { x: e.clientX, yaw: st.yaw }; r3.domElement.setPointerCapture(e.pointerId); };
    r3.domElement.onpointermove = (e) => { if (drag && st.view === 'side') st.yaw = clamp(drag.yaw + (e.clientX - drag.x) * 0.006, -1.4, 1.4); };
    r3.domElement.onpointerup = () => { drag = null; };
    const fit = () => { const c = dev.fit(); r3.setPixelRatio(Math.min(devicePixelRatio, 2)); r3.setSize(parseFloat(c.style.width), parseFloat(c.style.height)); };
    watch(main, fit);
    fit();
    await rebuild();
    let prev = performance.now();
    r3.setAnimationLoop((ms) => {
      const dt = Math.min((ms - prev) / 1000, 0.05); prev = ms; st.t += dt;
      if (!root.offsetParent || step !== 'preview') return;
      const sway = $('#p-wig')?.checked ? Math.sin(st.t * 1.8) * +$('#p-amp').value : 0;
      if (st.src === 'scene' && world) {
        const p = (win + 0.45) / 4 * TUNING.trainPhaseEnd;
        world.setAspect(SCREEN.px[0] / SCREEN.px[1]);
        world.update({ worldTime: p * 80, progress: p, letterU: letterPhase(p), parallax: { x: sway, y: 0 }, view: { x: world.panelX(win) } });
        r3.render(world.scene, world.camera);
        return;
      }
      if (!built) return;
      const { scene, cam } = built;
      if (st.view === 'front') { cam.position.set(sway, 0, CAM_Z); cam.lookAt(0, 0, 0); }
      else { const d = CAM_Z * 1.15; cam.position.set(Math.sin(st.yaw) * d, 2, Math.cos(st.yaw) * d); cam.lookAt(0, 0, -1); }
      r3.render(scene, cam);
    });
    p3 = { r3, rebuild };
    gallery();
  }

  // ======================================================================
  async function go(i = win, s = step) {
    if (p3) { p3.r3.setAnimationLoop(null); p3.r3.dispose(); p3 = null; }
    keyHandler = null; redrawSplit = () => {};
    if (i !== win) sel = null;
    win = i; step = s;
    root.querySelectorAll('[data-win]').forEach((b) => b.classList.toggle('on', +b.dataset.win === win));
    root.querySelectorAll('[data-step]').forEach((b) => b.classList.toggle('on', b.dataset.step === step));
    bottom.innerHTML = '';
    if (step === 'layout') await stepLayout();
    else if (step === 'split') await stepSplit();
    else await stepPreview();
  }
  root.querySelectorAll('[data-win]').forEach((b) => { b.onclick = () => go(+b.dataset.win); });
  root.querySelectorAll('[data-step]').forEach((b) => { b.onclick = () => go(win, b.dataset.step); });

  (async () => { await loadDocs(); go(0, 'layout'); })();

  return {
    onSlots(list) {
      const had = new Map(slots.map((s) => [s.id, s.modelTime]));
      slots = list;
      paintSlots();
      // 有元素的 3D 模型刚做好：3D 预览重建一次，把模型换上
      if (p3 && list.some((s) => had.has(s.id) && had.get(s.id) !== s.modelTime)) p3.rebuild();
    },
  };
}

// 制作端：送给谁 → 传照片 → 确认识别 → 写信 → 生成。接口见 Jupitermusic/musicbox_api.py
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const MAX_PHOTOS = 5;
const ORDER = ['start', 'who', 'photos', 'confirm', 'letter', 'make'];
const BIOMES = [['countryside', '田园'], ['mountain', '山野'], ['seaside', '海边'], ['city', '城市'], ['forest', '森林'], ['snow', '雪地']];
const TIMES = [['dawn', '清晨'], ['day', '白天'], ['dusk', '黄昏'], ['night', '夜晚']];
const STATE_TEXT = { pending: '排队中', running: '生成地标中', ready: '地标已完成', failed: '用默认地标', skipped: '用默认地标' };

const state = {
  relation: 'partner', vehicle: 'train', photos: [], abilities: { recognition: false, tripo: false },
  submitted: false, journeyId: null,
};
let nextId = 1;

// —— 页面切换 ——
let current = 'start';
function go(name) {
  current = name;
  for (const el of $$('.screen')) el.hidden = el.dataset.screen !== name;
  const i = ORDER.indexOf(name);
  $('#bar').hidden = i === 0;
  $$('.dots li').forEach((d, k) => d.classList.toggle('on', k < i));
  $('#step-label').textContent = i > 0 ? `${state.demo ? '演示 · ' : ''}${i} / 5` : '';
  $('#back').style.visibility = name === 'make' && state.submitted ? 'hidden' : '';
  $(`.screen[data-screen="${name}"]`).scrollTop = 0;
  if (name === 'confirm') enterConfirm();
  if (name === 'letter' && !$('#greeting').value) $('#greeting').value = `亲爱的${$('#recipient').value.trim() || '你'}：`;
}
$('#back').addEventListener('click', () => go(ORDER[Math.max(1, ORDER.indexOf(current) - 1)]));
$$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

function singleChoice(container, onPick) {
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    $$('button', container).forEach((b) => b.classList.toggle('on', b === btn));
    onPick(btn.dataset.value);
  });
}

// —— S1 ——
singleChoice($('#relation'), (v) => { state.relation = v; });
singleChoice($('#vehicle'), (v) => { state.vehicle = v; });
$('#who-next').addEventListener('click', () => go('photos'));

// —— S2 照片 ——
// 手机上先缩成 ≤1600px 的 JPEG 再上传，省流量也省服务器
async function toJpeg(file, max = 1600) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('这张照片打不开'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width, h = src.height, k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.86);
}

$('#photo-input').addEventListener('change', async (e) => {
  const files = [...e.target.files].filter((f) => f.type.startsWith('image/')).slice(0, MAX_PHOTOS - state.photos.length);
  e.target.value = '';
  for (const file of files) {
    try {
      state.photos.push({ id: nextId++, dataUrl: await toJpeg(file), caption: '', analysis: null, box: null, biome: 'countryside', tod: 'day', place: '', landmark: '' });
    } catch (err) { alertInline(err.message); }
    renderPhotos();
  }
});

function renderPhotos() {
  const list = $('#photo-list');
  list.replaceChildren(...state.photos.map((p, i) => {
    const el = $('#tpl-photo').content.firstElementChild.cloneNode(true);
    $('img', el).src = p.dataUrl;
    $('img', el).alt = `第 ${i + 1} 站`;
    $('.num', el).textContent = i + 1;
    const cap = $('.caption', el);
    cap.value = p.caption;
    cap.id = `caption-${p.id}`;
    cap.setAttribute('aria-label', `第 ${i + 1} 站的一句话`);
    cap.addEventListener('input', () => { p.caption = cap.value; });
    $('.up', el).disabled = i === 0;
    $('.down', el).disabled = i === state.photos.length - 1;
    $('.up', el).addEventListener('click', () => move(i, -1));
    $('.down', el).addEventListener('click', () => move(i, 1));
    $('.remove', el).addEventListener('click', () => { state.photos.splice(i, 1); renderPhotos(); });
    return el;
  }));
  const n = state.photos.length;
  $('#add-photo').hidden = n >= MAX_PHOTOS;
  $('#add-label').textContent = n ? `再加一张（还能加 ${MAX_PHOTOS - n} 张）` : '选择照片（建议 3–5 张）';
  $('#photos-next').disabled = n === 0;
}
function move(i, d) {
  const [p] = state.photos.splice(i, 1);
  state.photos.splice(i + d, 0, p);
  renderPhotos();
}
$('#photos-next').addEventListener('click', () => go('confirm'));

// —— S3 识别确认 ——
async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

function enterConfirm() {
  const list = $('#found-list');
  list.replaceChildren(...state.photos.map((p, i) => buildFound(p, i)));
  const pending = state.photos.filter((p) => !p.analysis);
  updateConfirmNext();
  // 两张一起识别
  let k = 0;
  const worker = async () => {
    while (k < pending.length) {
      const p = pending[k++];
      try { p.analysis = await api('/api/analyze', { photo: p.dataUrl }); }
      catch (err) { p.analysis = { mode: 'manual', reason: err.message }; }
      applyAnalysis(p);
      if (current === 'confirm') refreshFound(p);
      updateConfirmNext();
    }
  };
  worker(); worker();
}

function applyAnalysis(p) {
  const a = p.analysis;
  if (a.mode !== 'ai') return;
  p.place = p.place || a.place;
  p.landmark = p.landmark || a.landmark;
  p.biome = a.biome;
  p.tod = a.time_of_day;
  if (a.landmark && a.landmark_box && a.landmark_box.w > 0 && a.landmark_box.w < 0.98) p.box = a.landmark_box;
}

function buildFound(p, i) {
  const el = $('#tpl-found').content.firstElementChild.cloneNode(true);
  el.dataset.photo = p.id;
  const img = $('img', el);
  img.src = p.dataUrl;
  img.alt = `第 ${i + 1} 站照片，点选地标位置`;
  img.addEventListener('load', () => drawBox(el, p));
  $('.found-photo', el).addEventListener('click', (e) => pickBox(e, el, p));

  const place = $('.place', el), landmark = $('.landmark', el);
  place.id = `place-${p.id}`; landmark.id = `landmark-${p.id}`;
  place.addEventListener('input', () => { p.place = place.value; });
  landmark.addEventListener('input', () => { p.landmark = landmark.value; });

  for (const [group, options, key] of [['.biome', BIOMES, 'biome'], ['.tod', TIMES, 'tod']]) {
    const box = $(group, el);
    box.replaceChildren(...options.map(([v, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.dataset.value = v; b.textContent = label;
      return b;
    }));
    singleChoice(box, (v) => { p[key] = v; });
  }
  refreshFound(p, el);
  return el;
}

function refreshFound(p, el = $(`.found[data-photo="${p.id}"]`)) {
  if (!el) return;
  $('.scanning', el).hidden = !!p.analysis;
  $('.place', el).value = p.place;
  $('.landmark', el).value = p.landmark;
  $$('.biome .chip', el).forEach((b) => b.classList.toggle('on', b.dataset.value === p.biome));
  $$('.tod .chip', el).forEach((b) => b.classList.toggle('on', b.dataset.value === p.tod));
  drawBox(el, p);
  const manual = state.photos.find((x) => x.analysis?.mode === 'manual');
  $('#manual-notice').hidden = !manual;
  if (manual) $('#manual-notice').textContent = `${manual.analysis.reason}：请为每站选好地貌和时段，并写下想做成 3D 的地标。`;
}

// object-fit: contain 下图片实际占的区域
function contentRect(img) {
  const W = img.clientWidth, H = img.clientHeight, r = img.naturalWidth / img.naturalHeight;
  const w = Math.min(W, H * r), h = w / r;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}
function drawBox(el, p) {
  const box = $('.box', el), img = $('img', el);
  if (!p.box || !img.naturalWidth) { box.hidden = true; return; }
  const c = contentRect(img);
  Object.assign(box.style, {
    left: `${c.x + p.box.x * c.w}px`, top: `${c.y + p.box.y * c.h}px`,
    width: `${p.box.w * c.w}px`, height: `${p.box.h * c.h}px`,
  });
  box.hidden = false;
}
function pickBox(e, el, p) {
  const img = $('img', el), r = img.getBoundingClientRect(), c = contentRect(img);
  const px = e.clientX - r.left - c.x, py = e.clientY - r.top - c.y;
  if (px < 0 || py < 0 || px > c.w || py > c.h) return;
  const side = 0.45 * Math.min(c.w, c.h), w = side / c.w, h = side / c.h;
  p.box = {
    x: Math.min(Math.max(px / c.w - w / 2, 0), 1 - w),
    y: Math.min(Math.max(py / c.h - h / 2, 0), 1 - h), w, h,
  };
  drawBox(el, p);
}
window.addEventListener('resize', () => $$('.found').forEach((el) => drawBox(el, state.photos.find((p) => p.id === Number(el.dataset.photo)))));

function updateConfirmNext() {
  $('#confirm-next').disabled = state.photos.some((p) => !p.analysis);
}
$('#confirm-next').addEventListener('click', () => go('letter'));

// —— S4 → S5 生成 ——
// 把地标框裁出来交给 Tripo（四周留一点边），没有框就只传文字
async function cropLandmark(p) {
  if (!p.box) return null;
  const img = new Image();
  img.src = p.dataUrl;
  await img.decode();
  const pad = 0.08;
  const x = Math.max(0, p.box.x - pad) * img.width, y = Math.max(0, p.box.y - pad) * img.height;
  const w = Math.min(1, p.box.x + p.box.w + pad) * img.width - x, h = Math.min(1, p.box.y + p.box.h + pad) * img.height - y;
  const k = Math.min(1, 1024 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}

$('#letter-next').addEventListener('click', async () => {
  go('make');
  if (state.submitted) return;
  $('#make-error').hidden = true;
  renderProgress(state.photos.map((p) => ({ name: p.place || '这一站', caption: p.caption, landmark: { label: p.landmark, status: 'saving' } })));
  try {
    const stations = await Promise.all(state.photos.map(async (p, i) => ({
      photo: p.dataUrl,
      crop: p.landmark ? await cropLandmark(p) : null,
      caption: p.caption,
      name: p.place || `第 ${i + 1} 站`,
      biome: p.biome,
      timeOfDay: p.tod,
      landmark: { label: p.landmark },
    })));
    const { id } = await api('/api/journeys', {
      recipient: $('#recipient').value.trim(),
      relation: state.relation,
      vehicle: state.vehicle,
      letter: { greeting: $('#greeting').value.trim(), body: $('#letter-body').value, signature: $('#signature').value.trim() },
      stations,
    });
    state.submitted = true;
    state.journeyId = id;
    $('#back').style.visibility = 'hidden';
    showDone(id);
    poll(id);
  } catch (err) {
    $('#make-error').textContent = `${err.message}。检查网络后返回上一步再试一次。`;
    $('#make-error').hidden = false;
  }
});

function renderProgress(stations) {
  $('#progress').replaceChildren(...stations.map((st, i) => {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = state.photos[i]?.dataUrl ?? '';
    img.alt = '';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const b = document.createElement('b');
    b.textContent = `${i + 1} · ${st.name}`;
    const small = document.createElement('small');
    small.textContent = st.landmark.label ? `地标：${st.landmark.label}` : '没有地标，用这种地貌的默认布景';
    meta.append(b, small);
    const s = document.createElement('span');
    const status = st.landmark.status;
    s.className = `state ${status}`;
    s.textContent = status === 'saving' ? '上传中' : STATE_TEXT[status] ?? status;
    li.append(img, meta, s);
    return li;
  }));
}

function showDone(id) {
  const frameUrl = new URL(`../?device&journey=${id}`, location.href).href;
  $('#journey-id').textContent = id;
  $('#journey-link').value = frameUrl;
  $('#open-box').href = `../?journey=${id}&open`;
  $('#done').hidden = false;
}

async function poll(id) {
  const data = await api(`/api/journeys/${id}`).catch(() => null);
  if (data) {
    renderProgress(data.stations);
    const busy = data.stations.some((s) => ['pending', 'running'].includes(s.landmark.status));
    $('#make-title').textContent = busy ? '正在把这些地方装进盒子' : '礼物做好了';
    $('#make-hint').textContent = busy
      ? '每站约 1–2 分钟，几站同时生成。现在打开木盒也可以，已完成的地标会先出现。'
      : (state.abilities.tripo ? '所有地标都处理完了。' : '还没有接入 Tripo，地标暂时用每种地貌的默认模型。');
    if (!busy) return;
  }
  setTimeout(() => poll(id), 3000);
}

$('#copy-link').addEventListener('click', async () => {
  const input = $('#journey-link');
  try { await navigator.clipboard.writeText(input.value); $('#copy-link').textContent = '已复制'; }
  catch { input.select(); $('#copy-link').textContent = '已选中'; }
  setTimeout(() => { $('#copy-link').textContent = '复制'; }, 1500);
});
$('#restart').addEventListener('click', () => location.reload());

function alertInline(msg) {
  const hint = $('.screen[data-screen="photos"] .hint');
  hint.textContent = msg;
}

// —— 演示：预填示例照片、一句话、识别结果和信，直接从第 1 步点到生成 ——
const DEMO = {
  recipient: '小满',
  photos: [
    { file: 'sample-cottage', caption: '出发的那个早上', place: '家 · 出发的小屋', landmark: '尖顶小屋', biome: 'countryside', tod: 'dawn', box: { x: 0.12, y: 0.08, w: 0.62, h: 0.86 } },
    { file: 'sample-mountain', caption: '第一次看见雪山', place: '雪山脚下', landmark: '雪山', biome: 'snow', tod: 'day', box: { x: 0.22, y: 0.0, w: 0.42, h: 0.6 } },
    { file: 'sample-lighthouse', caption: '风很大的那天', place: '海边小镇', landmark: '白色灯塔', biome: 'seaside', tod: 'dusk', box: { x: 0.28, y: 0.04, w: 0.42, h: 0.74 } },
  ],
  letter: '献给我们去过的地方，\n也献给尚未抵达的远方。\n\n那天在海边风很大，你说灯塔像一根粉笔，我一直记得这句话。',
  signature: '— 阿杰',
};

$('#demo').addEventListener('click', async () => {
  const btn = $('#demo');
  btn.disabled = true;
  btn.textContent = '正在准备示例…';
  try {
    state.demo = true;
    state.photos = await Promise.all(DEMO.photos.map(async (d) => {
      const blob = await (await fetch(`../assets/photos/${d.file}.jpg`)).blob();
      return {
        id: nextId++, dataUrl: await toJpeg(blob), caption: d.caption, analysis: { mode: 'demo' },
        box: d.box, biome: d.biome, tod: d.tod, place: d.place, landmark: d.landmark,
      };
    }));
    $('#recipient').value = DEMO.recipient;
    $('#letter-body').value = DEMO.letter;
    $('#signature').value = DEMO.signature;
    $('#greeting').value = '';
    renderPhotos();
    go('who');
  } catch {
    btn.textContent = '示例加载失败，点此重试';
    state.demo = false;
  } finally {
    btn.disabled = false;
    if (state.demo) btn.textContent = '用示例照片快速体验';
  }
});

// —— 启动 ——
api('/api/status').then((s) => {
  state.abilities = s;
  if (!s.tripo) $('#confirm-hint').textContent = '每张照片里最有辨识度的东西，接入 Tripo 后会做成盒子里的 3D 小模型；现在先用每种地貌的默认模型。认错了就改掉。';
}).catch(() => {});
renderPhotos();
go('start');

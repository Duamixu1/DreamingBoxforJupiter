// 盒内微缩世界。
// 性能约束：Jupiter 每帧要渲染 9 个视点（RK3566 / Mali-G52），所以静态布景全部合并成
// 少数几个顶点色网格；树叶摆动、水波由着色器读 worldTime 完成，停摇即静止。
import { THREE } from './three.js';
import { Placer } from './assets.js';
import { rng, clamp01, seg, ease, lerp, G, Batch, radialTexture } from './kit.js';
import { buildTerrain, buildRidges, buildIslands, buildMist, createQingniao, createKun, createUnicorn, createLanterns } from './myth.js';
import { SCENE } from './config.js';

const {
  BoxGeometry, CylinderGeometry, ConeGeometry, IcosahedronGeometry, SphereGeometry, PlaneGeometry,
  CircleGeometry, BufferGeometry, BufferAttribute, Float32BufferAttribute, Color, Vector3, Euler,
  Quaternion, Matrix4, Mesh, Group, InstancedMesh, Points, PointsMaterial, MeshLambertMaterial,
  MeshBasicMaterial, ShaderMaterial, Plane, Fog, HemisphereLight, DirectionalLight, AmbientLight,
  CanvasTexture, SRGBColorSpace, AdditiveBlending, DoubleSide, Object3D,
} = THREE;

export const STATION_SPACING = 30;
export const BIOMES = ['countryside', 'mountain', 'seaside', 'city', 'forest', 'snow'];
const HALF_W = 7.5;         // 盒内半宽（场景单位）；竖屏舞台 10:16，取景以它为准
const VIEW_W = 13;          // 景物铺到的半宽：视场最大 52° 时远处天空板约 ±12，留余量，画面两侧不露底
const SKY_Z = -62;          // 天空板退到远山之后
// 竖屏：镜头抬高往下看，让纵深（前景 → 轨道 → 地标 → 远山）铺满画面高度
const CAMERA_POS = new Vector3(0, 8, 16);
const CAMERA_TARGET = new Vector3(0, 1.6, -3.5);

// 不再有盒壁，裁切面放到视野之外，只保留接口（Tripo 模型材质仍会带上它）
export const clip = [new Plane(new Vector3(-1, 0, 0), 60), new Plane(new Vector3(1, 0, 0), 60)];

// 顶点着色器里按 worldTime 让树叶摆、水面起伏
function animatedLambert(uTime, extra = {}) {
  const m = new MeshLambertMaterial({ vertexColors: true, flatShading: true, clippingPlanes: clip, ...extra });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = 'attribute float aSway;\nattribute float aWave;\nuniform float uTime;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.x += aSway * sin(uTime * 1.7 + position.x * 0.9 + position.z * 0.5);
        transformed.z += aSway * 0.5 * cos(uTime * 1.3 + position.x * 0.6);
        transformed.y += aWave * (0.07 * sin(position.x * 1.3 + uTime * 1.6) + 0.05 * sin(position.z * 1.7 - uTime * 1.1));`);
  };
  m.customProgramCacheKey = () => 'musicbox-animated';
  return m;
}

// —— 调色板 ————————————————————————————————————————————————
const C = {
  trunk: '#7a5236', pine: '#3f7a4f', pine2: '#356b47', leaf: '#6aa35a', leaf2: '#86b865', bush: '#5d9450',
  wall: '#f2e2c4', roof: '#b5523b', door: '#6b4128', fence: '#e2d2b0', stone: '#aaa49b', rock: '#8c8a84',
  mtn: '#7d9686', mtn2: '#6c8577', snow: '#f4f6f8', hill: '#86ad66', hill2: '#79a35d',
  sand: '#e6d3a3', water: '#3e8db3', river: '#4b9cc0', lhWhite: '#f3efe6', lhRed: '#c4473a',
  ballast: '#8a7f73', sleeper: '#6b4a33', rail: '#5d6168', platform: '#b9ad98', platformEdge: '#e7dcc4',
  cafe: '#c98f5a', cafeRoof: '#5b3a2a', awningR: '#c9483b', awningW: '#f3ece0', city: '#3a4766', city2: '#2f3a57',
  canopy: '#4f6b5a', buffer: '#c0392b', tent: '#e08a3c', balloon: '#d9573f', balloon2: '#f1c453',
  boat: '#8b5a3c', sail: '#fbf7ee', umbrella: '#e9776a', post: '#3a3f45', cloud: '#ffffff',
  glowWarm: '#ffc66b', glowLamp: '#ffe2a0', glowLight: '#fff1c2',
  engine: '#8e2f2a', engineDark: '#2d2a2a', brass: '#d6a84a', car: '#efe3c8', carRoof: '#3f6b55', carBase: '#3a3434',
};

// —— 环境：每站的时段决定天色，地貌决定地面颜色；站与站之间平滑过渡 ——————————
const SKY = {
  dawn:  { top: '#a5b4e6', bottom: '#ffd8c6', sun: '#ffd2a8', sunI: 1.9, hemiI: 1.15, night: 0.05 },
  day:   { top: '#79b2e6', bottom: '#f1ecdc', sun: '#fff6e8', sunI: 2.4, hemiI: 1.3, night: 0 },
  dusk:  { top: '#4c55a6', bottom: '#ffae7a', sun: '#ffb37a', sunI: 1.7, hemiI: 1.0, night: 0.2 },
  night: { top: '#0b1130', bottom: '#2c2f6c', sun: '#8fa4ff', sunI: 0.45, hemiI: 0.55, night: 1 },
};
const GROUND = { countryside: '#9cbf6e', mountain: '#94bb6a', seaside: '#e3d3a4', city: '#7d9070', forest: '#6f9a5c', snow: '#dfe7ec' };
const NIGHT_GROUND = new Color('#2f4238');

function envKeys(stations, spacing) {
  return stations.map((st, i) => {
    const sky = SKY[st.timeOfDay] ?? SKY.day;
    const ground = new Color(GROUND[st.biome] ?? GROUND.countryside).lerp(NIGHT_GROUND, sky.night * 0.65);
    return { d: i * spacing, ...sky, top: new Color(sky.top), bottom: new Color(sky.bottom), sun: new Color(sky.sun), ground };
  });
}

function envAt(keys, d) {
  if (keys.length === 1) return keys[0];
  let i = 0;
  while (i < keys.length - 2 && d > keys[i + 1].d) i++;
  const a = keys[i], b = keys[i + 1];
  // 每站附近保持该站的天色，在两站中间过渡
  const t = ease(clamp01(((d - a.d) / (b.d - a.d) - 0.35) / 0.3));
  return {
    top: a.top.clone().lerp(b.top, t), bottom: a.bottom.clone().lerp(b.bottom, t),
    ground: a.ground.clone().lerp(b.ground, t), sun: a.sun.clone().lerp(b.sun, t),
    sunI: lerp(a.sunI, b.sunI, t), hemiI: lerp(a.hemiI, b.hemiI, t), night: lerp(a.night, b.night, t),
  };
}

// —— 布景零件 ——————————————————————————————————————————————
function tree(b, shadow, x, z, s = 1, kind = 'pine', r = Math.random) {
  b.add(G.cyl, C.trunk, [x, 0.4 * s, z], { scale: [0.26 * s, 0.8 * s, 0.26 * s] });
  const sw = 0.045 * s;
  if (kind === 'pine') {
    const col = r() < 0.5 ? C.pine : C.pine2;
    b.add(G.cone, col, [x, 1.35 * s, z], { scale: [0.9 * s, 1.5 * s, 0.9 * s], sway: sw * 0.6 });
    b.add(G.cone, col, [x, 2.05 * s, z], { scale: [0.66 * s, 1.2 * s, 0.66 * s], sway: sw });
  } else {
    b.add(G.ico, r() < 0.5 ? C.leaf : C.leaf2, [x, 1.5 * s, z], { scale: [0.85 * s, 0.95 * s, 0.85 * s], rot: [0, r() * 3, 0], sway: sw });
  }
  shadow.add(G.disc, '#000', [x + 0.15 * s, 0.03, z + 0.1 * s], { scale: [0.75 * s, 1, 0.75 * s] });
}

function house(b, glow, shadow, x, z, { w = 2.4, h = 1.6, d = 2, wall = C.wall, roof = C.roof, chimney = true } = {}) {
  const rh = 1.1;
  b.box(wall, x, h / 2, z, w, h, d);
  b.add(G.pyramid, roof, [x, h + rh / 2, z], { scale: [w * 0.82, rh, d * 0.82] });
  b.box(C.door, x, 0.36, z + d / 2 + 0.02, 0.42, 0.72, 0.05);
  if (chimney) b.box(C.stone, x + w * 0.25, h + rh * 0.55, z - d * 0.12, 0.26, 0.7, 0.26);
  for (const sx of [-1, 1]) glow.box(C.glowWarm, x + sx * w * 0.3, h * 0.58, z + d / 2 + 0.03, 0.42, 0.36, 0.04);
  shadow.add(G.disc, '#000', [x + 0.2, 0.025, z + 0.2], { scale: [w * 0.75, 1, d * 0.8] });
}

function cloud(b, x, y, z, s, r) {
  const n = 3 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const k = 0.6 + r() * 0.5;
    b.add(G.ico, C.cloud, [x + (i - n / 2) * 0.9 * s, y + r() * 0.35 * s, z + r() * 0.4], { scale: [k * s, k * 0.7 * s, k * 0.8 * s], rot: [r(), r(), r()] });
  }
}

function mountain(b, x, z, r, h, color = C.mtn, cap = true) {
  b.add(G.cone, color, [x, h / 2, z], { scale: [r, h, r] });
  if (cap) b.add(G.cone, C.snow, [x, h - h * 0.15 + 0.02, z], { scale: [r * 0.31, h * 0.3, r * 0.31] });
}

function lamp(b, glow, halo, x, z) {
  b.add(G.cyl, C.post, [x, 0.9, z], { scale: [0.1, 1.8, 0.1] });
  glow.add(G.sphere, C.glowLamp, [x, 1.9, z], { scale: [0.18, 0.18, 0.18] });
  halo.add(G.halo, C.glowLamp, [x, 1.9, z + 0.2], { scale: [0.9, 0.9, 1] });
}

// —— 到站明信片 ——————————————————————————————————————————
function postcardTexture(src, caption) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 600;
  const g = c.getContext('2d');
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const draw = (img) => {
    g.fillStyle = '#fbf8f1'; g.fillRect(0, 0, c.width, c.height);
    const x = 28, y = 28, w = 456, h = 456;
    g.fillStyle = '#cfc6b8'; g.fillRect(x, y, w, h);
    if (img) {
      const k = Math.max(w / img.width, h / img.height);
      const sw = w / k, sh = h / k;
      g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
    }
    g.fillStyle = '#4a3a2c'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '46px "Kaiti SC","STKaiti","Songti SC",serif';
    g.fillText(caption ?? '', c.width / 2, 545);
    tex.needsUpdate = true;
  };
  draw(null);
  const img = new Image();
  img.onload = () => draw(img);
  img.src = src;
  return tex;
}

// —— 文本信纸 ——————————————————————————————————————————————
function letterTexture(L) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1280;
  const g = c.getContext('2d');
  g.fillStyle = '#fbf3e2'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(150,110,70,.35)'; g.lineWidth = 4; g.strokeRect(44, 44, 936, 1192);
  g.strokeStyle = 'rgba(150,110,70,.12)'; g.lineWidth = 2;
  for (let y = 300; y < 1100; y += 78) { g.beginPath(); g.moveTo(110, y + 18); g.lineTo(914, y + 18); g.stroke(); }
  const zh = '"Songti SC","STSong","Noto Serif SC","Source Han Serif SC",serif';
  g.fillStyle = '#5a3e2b'; g.textBaseline = 'alphabetic';
  g.font = `600 60px ${zh}`; g.fillText(L.greeting, 110, 220);
  // 用户写的信可能很长：按信纸宽度自动折行（中文逐字、英文按词），超出信纸的部分不画
  const wrap = (text, maxW) => {
    const tokens = text.match(/[\u3000-\u9fff\uff00-\uffef]|[^\s\u3000-\u9fff\uff00-\uffef]+|\s+/g) ?? [];
    const rows = [];
    let row = '';
    for (const t of tokens) {
      if (row && g.measureText(row + t).width > maxW) { rows.push(row.trimEnd()); row = t.trimStart(); }
      else row += t;
    }
    if (row.trim()) rows.push(row);
    return rows;
  };
  let y = 330;
  for (const line of L.lines) {
    if (line.gap) { y += 78 * line.gap; continue; }
    g.font = line.style === 'en' ? 'italic 50px Georgia,"Times New Roman",serif' : `52px ${zh}`;
    const x = line.style === 'en' ? 130 : 150;
    for (const row of wrap(line.text, 900 - x)) {
      if (y > 990) break;
      g.fillText(row, x, y);
      y += 78;
    }
  }
  g.textAlign = 'right';
  g.font = `italic 50px Georgia,${zh}`; g.fillText(L.signature, 900, 1060);
  g.font = `36px ${zh}`; g.fillStyle = '#8a6b52'; g.fillText(L.date, 900, 1130);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// opts.from：信封升起的起点（可在每帧改它）；opts.seal / opts.crescent：封蜡颜色，crescent 为真时做成新月形
export function buildLetter(letter, { from = new Vector3(3.2, 0.9, 0.6), seal: sealColor = '#a8322b', crescent = false } = {}) {
  const root = new Group();
  root.visible = false;

  // 信封：背板 / 信纸 / 前袋 / 封口，前后叠放
  const env = new Group();
  const envMats = [];
  const m = (color) => { const mm = new MeshBasicMaterial({ color, transparent: true, side: DoubleSide }); envMats.push(mm); return mm; };
  const W = 3.4, H = 2.2;
  const back = new Mesh(new PlaneGeometry(W, H), m('#e9d9b8')); env.add(back);
  const pocket = new Mesh(new PlaneGeometry(W, H), m('#f3e6c8')); pocket.position.z = 0.04; env.add(pocket);
  const flapShape = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, -H * 0.62)]);
  const flap = new Group(); flap.position.set(0, H / 2, 0.07); env.add(flap);
  flap.add(new Mesh(new THREE.ShapeGeometry(flapShape), m('#ead9b5')));
  const seal = new Mesh(new CircleGeometry(0.2, 20), m(sealColor)); seal.position.set(0, -H * 0.55, 0.01); flap.add(seal);
  if (crescent) { const bite = new Mesh(new CircleGeometry(0.17, 20), m('#ead9b5')); bite.position.set(0.08, 0.05, 0.002); seal.add(bite); }
  root.add(env);

  // 信纸：上下两半，中线对折
  const tex = letterTexture(letter);
  const texTop = tex.clone(); texTop.repeat.set(1, 0.5); texTop.offset.set(0, 0.5); texTop.needsUpdate = true;
  const texBot = tex.clone(); texBot.repeat.set(1, 0.5); texBot.offset.set(0, 0); texBot.needsUpdate = true;
  const PW = 6.4, PH = 8;
  const paper = new Group();
  const half = (map, y) => {
    const g = new Group();
    const front = new Mesh(new PlaneGeometry(PW, PH / 2), new MeshBasicMaterial({ map }));
    const backSide = new Mesh(new PlaneGeometry(PW, PH / 2), new MeshBasicMaterial({ color: '#eadfc6' }));
    backSide.rotation.y = Math.PI; backSide.position.z = -0.002;
    front.position.y = backSide.position.y = y;
    g.add(front, backSide);
    return g;
  };
  paper.add(half(texTop, PH / 4));
  const pivot = new Group(); pivot.position.z = 0.004;
  pivot.add(half(texBot, -PH / 4));
  paper.add(pivot);
  root.add(paper);

  const dim = new Mesh(new PlaneGeometry(80, 60), new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0, depthWrite: false }));
  dim.visible = false;

  const envFrom = from;
  const flat = new Quaternion();

  // 信件的终点姿态跟着镜头算：沿视线放在镜头前方，正对观众
  function update(u, camera) {
    const dir = camera.getWorldDirection(new Vector3());
    const envTo = camera.position.clone().addScaledVector(dir, 14);
    const paperTo = camera.position.clone().addScaledVector(dir, 9);
    dim.position.copy(camera.position).addScaledVector(dir, 9.6);
    dim.quaternion.copy(camera.quaternion);
    root.visible = u > 0;
    dim.visible = u > 0.6;
    if (!root.visible) return;
    const a1 = ease(seg(u, 0, 0.22));   // 信封从终点升起
    const a2 = ease(seg(u, 0.22, 0.4)); // 打开封口
    const a3 = ease(seg(u, 0.4, 0.62)); // 抽出信纸
    const a4 = ease(seg(u, 0.62, 0.92)); // 信纸飞向观众，信封退场
    const a5 = ease(seg(u, 0.7, 1));    // 展开对折

    const s = lerp(0.25, 1, a1);
    const envPos = envFrom.clone().lerp(envTo, a1);
    env.position.copy(envPos).add(new Vector3(0, -4 * a4, 0));
    env.scale.setScalar(s);
    env.quaternion.copy(flat).slerp(camera.quaternion, a1);
    flap.rotation.x = -a2 * Math.PI * 0.92;
    for (const mm of envMats) mm.opacity = 1 - a4;
    env.visible = a4 < 1;

    paper.visible = u >= 0.22;
    const up = new Vector3(0, 1, 0).applyQuaternion(env.quaternion);
    const out = new Vector3(0, 0, 1).applyQuaternion(env.quaternion);
    const inside = envPos.clone().addScaledVector(up, -0.95 + a3 * 1.5).addScaledVector(out, 0.02);
    paper.position.copy(inside.lerp(paperTo, a4));
    paper.scale.setScalar(lerp(0.45, 0.66, a4));
    paper.quaternion.copy(env.quaternion).slerp(camera.quaternion, a4);
    pivot.rotation.x = -Math.PI * 0.985 * (1 - a5);

    dim.material.opacity = 0.45 * a4;
  }

  return { root, dim, update, env };
}

// —— 主体 ——————————————————————————————————————————————————
// story：{ stations: [{ name, biome, timeOfDay, photo, caption, landmark }], letter }
// templates：Tripo 模型（槽位 id → 模板），旅程地标用 'landmark:<站序号>'
export function createWorld(story, templates = new Map()) {
  const stations = story.stations;
  const JOURNEY_LENGTH = STATION_SPACING * Math.max(stations.length - 1, 1);
  const r = rng(20260924);
  const scene = new THREE.Scene();
  const uTime = { value: 0 };
  const camera = new THREE.PerspectiveCamera(45, 10 / 16, 0.5, 120);
  camera.position.copy(CAMERA_POS);
  camera.lookAt(CAMERA_TARGET);

  // 灯光：不用阴影和点光源，保证 9 视点帧率
  const hemi = new HemisphereLight('#fff6e8', '#5a6b4a', 1.2);
  const sun = new DirectionalLight('#fff1d6', 2.2); sun.position.set(-8, 14, 10);
  const ambient = new AmbientLight('#ffffff', 0.25);
  scene.add(hemi, sun, ambient);
  scene.fog = new Fog('#e9e3cf', 34, 80);

  // 天空背板
  const sky = new Mesh(new PlaneGeometry(110, 110), new ShaderMaterial({
    uniforms: { top: { value: new Color() }, bottom: { value: new Color() } },
    vertexShader: 'varying float vY; void main(){ vY = (modelMatrix * vec4(position,1.0)).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying float vY;
      void main(){ float t = smoothstep(-2.0, 20.0, vY); gl_FragColor = vec4(mix(bottom, top, t), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
    depthWrite: false,
  }));
  sky.position.set(0, 20, SKY_Z);
  scene.add(sky);

  const sunDisc = new Mesh(new CircleGeometry(2.2, 32), new MeshBasicMaterial({ color: new Color('#ffd9a0').multiplyScalar(1.6), fog: false }));
  const moon = new Mesh(new CircleGeometry(1.6, 32), new MeshBasicMaterial({ color: new Color('#f3f0ff').multiplyScalar(1.4), fog: false }));
  sunDisc.position.set(-7, 14, SKY_Z + 0.5);
  moon.position.set(7.5, -4, SKY_Z + 0.5);
  const sunHalo = new Mesh(new CircleGeometry(9, 32), new MeshBasicMaterial({ map: radialTexture(), color: '#ffe0b0', transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, fog: false }));
  sunHalo.position.z = -0.1; sunDisc.add(sunHalo);
  scene.add(sunDisc, moon);

  const starGeo = new BufferGeometry();
  const sp = [];
  for (let i = 0; i < 260; i++) sp.push((r() * 2 - 1) * 34, 2 + r() * 50, SKY_Z + 0.3);
  starGeo.setAttribute('position', new Float32BufferAttribute(sp, 3));
  const stars = new Points(starGeo, new PointsMaterial({ color: '#fffbe8', size: 0.16, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  scene.add(stars);

  // 地面（固定，不随旅程移动）。不再做两侧深色内壁：相框上读成两块黑边，改为景物向两侧铺满
  // 固定底面只兜底远处；近处由随旅程移动的连续地形（buildTerrain）着色
  const ground = new Mesh(new PlaneGeometry(140, 100).rotateX(-Math.PI / 2), new MeshLambertMaterial({ color: '#9cbf6e' }));
  ground.position.set(0, -0.01, -27);
  scene.add(ground);

  // —— 随旅程移动的世界 ——
  const world = new Group();
  scene.add(world);
  const b = new Batch(), glow = new Batch(), halo = new Batch(), shadow = new Batch(), clouds = new Batch();
  const S = STATION_SPACING;
  // 有 Tripo 模型就摆模型，没有就用程序化占位
  const placer = new Placer(templates, S);
  const put = (id, x, y, z, opts, fallback) => (placer.has(id) ? placer.put(id, x, y, z, opts) : fallback());
  const putTree = (x, z, s, kind) => {
    const id = kind === 'pine' ? 'tree_pine' : 'tree_round';
    if (placer.has(id)) {
      placer.put(id, x, 0, z, { s, ry: r() * Math.PI * 2 });
      shadow.add(G.disc, '#000', [x + 0.15 * s, 0.03, z + 0.1 * s], { scale: [0.75 * s, 1, 0.75 * s] });
    } else tree(b, shadow, x, z, s, kind, r);
  };
  const putLamp = (x, z) => put('street_lamp', x, 0, z, {}, () => lamp(b, glow, halo, x, z));
  const END = JOURNEY_LENGTH + 4.5;
  const envs = envKeys(stations, S);

  // 轨道：道砟、枕木、钢轨
  const trackLen = END + 22;
  b.box(C.ballast, END - trackLen / 2, 0.06, 0, trackLen, 0.12, 1.8);
  for (let x = -22; x < END; x += 0.7) b.box(C.sleeper, x, 0.15, 0, 0.22, 0.06, 1.3);
  for (const z of [-0.38, 0.38]) b.box(C.rail, END - trackLen / 2, 0.22, z, trackLen, 0.08, 0.08);

  const platform = (cx) => {
    b.box(C.platform, cx, 0.18, 1.85, 6, 0.36, 1.3);
    b.box(C.platformEdge, cx, 0.37, 1.25, 6, 0.04, 0.12);
  };

  // —— 站点：地貌模板 ——
  // 每个模板有一个「主地标」(hero)。这一站有 Tripo 地标时，主地标让位给它。
  const HERO_SPOT = { countryside: [-4, -4], mountain: [5, -4.5], seaside: [5, -5.5], city: [2, -5.6], forest: [4.5, -5], snow: [5, -4.5] };
  const kits = {
    countryside(cx, hero) {
      if (hero) put('house', cx - 4, 0, -4, {}, () => house(b, glow, shadow, cx - 4, -4, {}));
      for (let i = 0; i < 7; i++) b.box(C.fence, cx - 6.6 + i * 0.75, 0.3, -2.4, 0.08, 0.6, 0.08);
      b.box(C.fence, cx - 4.35, 0.42, -2.4, 4.6, 0.07, 0.05);
      b.add(G.cyl, C.post, [cx - 1.6, 0.45, -2.6], { scale: [0.08, 0.9, 0.08] });
      b.box(C.lhRed, cx - 1.6, 0.98, -2.6, 0.36, 0.26, 0.24);
      for (const [x, z, s, k] of [[-9, -6, 1.2, 'round'], [1.5, -6.5, 1.1, 'round'], [4.5, -4, 0.9, 'round'], [-7.5, -9, 1.3, 'pine'], [6.5, -8, 1.2, 'pine'], [-9.5, 4.5, 0.9, 'round']]) putTree(cx + x, z, s, k);
      for (const [x, z, rr, h] of [[-8, -15, 4, 2.2], [0, -17, 5, 3], [9, -15, 4.5, 2.5]]) b.add(G.sphere, r() < 0.5 ? C.hill : C.hill2, [cx + x, 0, z], { scale: [rr, h, rr * 0.6] });
    },
    mountain(cx, hero, snowy = false) {
      b.box(C.river, cx, 0.015, -7.5, 3, 0.03, 29);
      b.box(C.river, cx, 0.015, 14, 3, 0.03, 14);
      put('bridge', cx, 0, 0, {}, () => {
        b.box(C.stone, cx, 0.16, 0, 4.4, 0.18, 1.9);
        for (const z of [-0.85, 0.85]) b.box(C.stone, cx, 0.42, z, 4.4, 0.35, 0.14);
        for (const x of [-1.3, 1.3]) b.box(C.stone, cx + x, 0.08, 0, 0.5, 0.16, 1.9);
      });
      for (const [x, z, rr, h, col] of [[-6, -13, 3.5, 5.5, C.mtn], [1, -16, 4.6, 7.2, C.mtn2], [8, -12.5, 3, 4.5, C.mtn], [-11, -17, 4, 6, C.mtn2]]) {
        put('mountain', cx + x, 0, z, { s: h, ry: r() * 6 }, () => mountain(b, cx + x, z, rr, h, snowy ? C.snow : col));
      }
      if (hero) b.add(G.pyramid, C.tent, [cx + 5, 0.45, -4], { scale: [1, 0.9, 1.1] });
      b.add(G.cyl, C.post, [cx - 3.8, 0.5, 1.7], { scale: [0.08, 1, 0.08] });
      b.box(C.fence, cx - 3.8, 0.95, 1.72, 0.9, 0.32, 0.05);
      for (const [x, z, s] of [[-8, -5, 1.1], [-3, -7, 0.9], [3, -8, 1], [7.5, -6, 1.2], [9, 4.5, 0.8], [-6, 5, 0.9]]) putTree(cx + x, z, s, 'pine');
      for (const [x, z] of [[-2.5, 3.5], [2.6, 4.2]]) b.add(G.ico, C.rock, [cx + x, 0.2, z], { scale: [0.45, 0.3, 0.4], rot: [r(), r(), r()] });
    },
    snow(cx, hero) {
      kits.mountain(cx, hero, true);
    },
    seaside(cx, hero) {
      // 沙滩由连续地形的顶点色给出；海面一直铺到远山脚下
      b.add(new PlaneGeometry(38, 47, 40, 34).rotateX(-Math.PI / 2), C.water, [cx, 0.16, -26.8], { wave: 1 });
      if (hero) {
        put('lighthouse', cx + 5, 0, -5.5, {}, () => {
          b.add(G.cyl, C.rock, [cx + 5, 0.25, -5.5], { scale: [1.9, 0.5, 1.9] });
          const ring = [C.lhWhite, C.lhRed, C.lhWhite, C.lhRed];
          ring.forEach((col, i) => b.add(new CylinderGeometry(0.55 - (i + 1) * 0.04, 0.55 - i * 0.04, 0.9, 12), col, [cx + 5, 0.95 + i * 0.9, -5.5]));
          b.add(G.cyl, C.post, [cx + 5, 4.4, -5.5], { scale: [1.1, 0.1, 1.1] });
          glow.add(G.cyl, C.glowLight, [cx + 5, 4.72, -5.5], { scale: [0.6, 0.5, 0.6] });
          b.add(G.cone, C.lhRed, [cx + 5, 5.17, -5.5], { scale: [0.45, 0.4, 0.45] });
        });
        halo.add(G.halo, C.glowLight, [cx + 5, 4.72, -5.2], { scale: [1.4, 1.4, 1] });
        beacons.push(cx + 5);
      }
      put('beach_umbrella', cx - 4.5, 0, 5, {}, () => {
        b.add(G.cyl, '#e6e0d4', [cx - 4.5, 0.75, 5], { scale: [0.05, 1.5, 0.05] });
        b.add(G.cone, C.umbrella, [cx - 4.5, 1.55, 5], { scale: [1.1, 0.45, 1.1] });
      });
      for (const [x, z, s] of [[-9.5, 2.5, 0.5], [9, 3, 0.4], [-6, -1.6, 0.3], [11, -2, 0.55]]) b.add(G.ico, C.rock, [cx + x, s * 0.5, z], { scale: [s * 1.2, s, s], rot: [r(), r(), r()] });
    },
    city(cx, hero) {
      const cz = -5.6;
      if (hero) put('cafe', cx + 2, 0, cz, {}, () => {
        house(b, glow, shadow, cx + 2, cz, { w: 3.6, h: 2.3, d: 2.2, wall: C.cafe, roof: C.cafeRoof, chimney: false });
        glow.box(C.glowWarm, cx + 2, 0.9, cz + 1.13, 2.0, 1.0, 0.04);
        for (let i = 0; i < 7; i++) b.box(i % 2 ? C.awningW : C.awningR, cx + 0.5 + i * 0.5, 1.75, cz + 1.4, 0.5, 0.06, 0.7, { rot: [0.35, 0, 0] });
        glow.box('#ffd27a', cx + 2, 2.62, cz + 1.13, 1.4, 0.32, 0.05);
        for (const tx of [-0.6, 4.6]) {
          b.add(G.cyl, C.post, [cx + tx, 0.38, cz + 2.4], { scale: [0.7, 0.06, 0.7] });
          b.add(G.cyl, C.post, [cx + tx, 0.19, cz + 2.4], { scale: [0.06, 0.38, 0.06] });
        }
      });
      for (let i = 0; i < 12; i++) {
        const x = cx - 11 + i * 2 + r() * 0.6, h = 2 + r() * 4.5, w = 1.4 + r() * 0.8, z = -12 - r() * 3;
        put('city_block', x, 0, z, { s: h }, () => {
          b.box(r() < 0.5 ? C.city : C.city2, x, h / 2, z, w, h, 1.4);
          for (let wy = 0.7; wy < h - 0.4; wy += 0.7) for (const wx of [-0.3, 0.3]) if (r() < 0.55) glow.box(C.glowWarm, x + wx * w, wy, z + 0.72, 0.22, 0.26, 0.02);
        });
      }
      putLamp(cx - 5, 1.7);
      putLamp(cx + 4.5, 1.7);
      for (const [x, z, s] of [[-9, -5, 0.9], [7.5, -5.5, 1]]) putTree(cx + x, z, s, 'round');
    },
    forest(cx) {
      for (let i = 0; i < 26; i++) {
        const x = cx - 13 + r() * 22, back = r() < 0.75;
        const z = back ? -3.2 - r() * 11 : 4.5 + r() * 3;
        if (!back && x > cx - 8 && x < cx + 6) continue;
        if (back && Math.abs(x - cx - 4.5) < 2 && z > -7) continue; // 给地标留位置
        putTree(x, z, back ? 0.9 + r() * 0.6 : 0.7 + r() * 0.3, 'pine');
      }
    },
  };

  const beacons = [];      // 默认灯塔的位置，夜里亮光束
  const landmarkSpots = []; // Tripo 地标的位置
  stations.forEach((st, i) => {
    const cx = i * S;
    const biome = kits[st.biome] ? st.biome : 'countryside';
    const lmId = `landmark:${i}`;
    const hasLandmark = placer.has(lmId);
    kits[biome](cx, !hasLandmark);
    if (hasLandmark) {
      const [hx, hz] = HERO_SPOT[biome];
      placer.put(lmId, cx + hx, 0, hz, {});
      shadow.add(G.disc, '#000', [cx + hx + 0.2, 0.03, hz + 0.2], { scale: [1.6, 1, 1.4] });
      landmarkSpots.push(cx + hx);
    }
  });

  // 起点与终点站台：不管哪种地貌都有
  platform(0.5);
  {
    const cx = JOURNEY_LENGTH;
    put('station', cx - 0.5, 0, 1.9, {}, () => {
      platform(cx - 0.5);
      for (const x of [-2.6, 1.6]) b.add(G.cyl, C.post, [cx + x, 1.1, 2.3], { scale: [0.1, 1.5, 0.1] });
      b.box(C.canopy, cx - 0.5, 1.9, 1.9, 5, 0.12, 1.6, { rot: [-0.12, 0, 0] });
    });
    putLamp(cx - 5.5, 2.4);
    b.box(C.buffer, END, 0.5, 0, 0.3, 0.5, 1.4);
    b.box(C.awningW, END, 0.5, 0, 0.32, 0.12, 1.42);
  }

  // 站与站之间的过渡树木
  const nearSea = (x) => stations.some((st, k) => st.biome === 'seaside' && Math.abs(x - k * S) < 18);
  for (let i = 0; i < stations.length - 1; i++) {
    const dense = ['forest', 'mountain', 'snow'].includes(stations[i + 1].biome);
    for (const off of [12, 16, 19]) {
      const x = i * S + off + r();
      if (nearSea(x)) continue; // 海边段：后面是海，前面是沙滩
      putTree(x, -4.5 - r() * 5, 0.9 + r() * 0.4, dense ? 'pine' : 'round');
      if (r() < 0.6) putTree(x + 1.5, 4 + r() * 2, 0.7 + r() * 0.3, 'round');
    }
  }

  // 前景：花丛与灌木，补足近处层次（方案第 10 页：前景 / 中景 / 后景 / 远景）
  const flowers = ['#f2c14e', '#e98a7a', '#f5f0e6', '#c58ad6'];
  for (let x = -HALF_W - 2; x < END + 10; x += 1.4 + r() * 1.6) {
    if (stations.some((st, i) => st.biome === 'seaside' && Math.abs(x - i * S) < 17)) continue; // 海滩段前景是沙地
    const z = 4.5 + r() * 5;
    if (r() < 0.45) put('bush', x, 0, z, { s: 0.8 + r() * 0.4, ry: r() * 6 }, () => b.add(G.ico, C.bush, [x, 0.25, z], { scale: [0.55, 0.42, 0.5], rot: [0, r() * 3, 0], sway: 0.02 }));
    else for (let k = 0; k < 3; k++) b.add(G.ico, flowers[Math.floor(r() * 4)], [x + (r() - 0.5) * 0.8, 0.12, z + (r() - 0.5) * 0.6], { scale: [0.13, 0.13, 0.13], sway: 0.03 });
  }

  // 云：整体随世界时间缓慢漂移
  for (let x = -12; x < END + 12; x += 9) cloud(clouds, x + r() * 4, 7 + r() * 3, -10 - r() * 7, 0.8 + r() * 0.5, r);

  const animated = animatedLambert(uTime);
  world.add(b.build(animated));
  const glowMat = new MeshBasicMaterial({ vertexColors: true, clippingPlanes: clip });
  world.add(glow.build(glowMat));
  const haloMat = new MeshBasicMaterial({ map: radialTexture(), vertexColors: true, clippingPlanes: clip, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false });
  world.add(halo.build(haloMat));
  const shadowMat = new MeshBasicMaterial({ color: '#000', clippingPlanes: clip, transparent: true, opacity: 0.16, depthWrite: false });
  world.add(shadow.build(shadowMat));
  const cloudMesh = clouds.build(new MeshLambertMaterial({ vertexColors: true, flatShading: true, clippingPlanes: clip, transparent: true, opacity: 0.95 }));
  world.add(cloudMesh);
  placer.build(world);

  // —— 幻境层（myth.js）：连续地形、远山、浮空仙山、云海过渡、灵兽 ——
  const terrain = buildTerrain(stations, S, -40, END + 40, GROUND);
  world.add(terrain);
  world.add(buildRidges(stations, S, -45, END + 45));
  const islands = buildIslands(r, -20, END + 20);
  world.add(islands.mesh);
  const mist = buildMist(r, stations.slice(1).map((_, i) => i * S + S / 2));
  world.add(mist.mesh);
  const qingniao = createQingniao();
  scene.add(qingniao.group);
  const findStation = (...biomes) => stations.findIndex((st) => biomes.includes(st.biome));
  const kunAt = findStation('seaside') >= 0 ? findStation('seaside') : Math.floor(stations.length / 2);
  const kun = createKun();
  scene.add(kun.group);
  const deerAt = findStation('mountain', 'snow', 'forest');
  const unicorn = createUnicorn();
  unicorn.group.visible = deerAt >= 0;
  unicorn.group.position.set(Math.max(deerAt, 0) * S - 5, 0.55, -6.5);
  unicorn.group.rotation.y = -0.35;
  world.add(unicorn.group);
  const lanternAt = findStation('city');
  const lanterns = lanternAt >= 0 ? createLanterns(lanternAt * S, r) : null;
  if (lanterns) world.add(lanterns.group);

  // 动态小件：有模型用模型，没有用占位
  const lit = (color) => new MeshLambertMaterial({ color, flatShading: true, clippingPlanes: clip });
  const balloon = new Group();
  if (placer.has('hot_air_balloon')) balloon.add(placer.spawn('hot_air_balloon').translateY(-1.6));
  else {
    const envelope = new Mesh(G.sphere, lit(C.balloon)); envelope.scale.set(0.9, 1.05, 0.9); balloon.add(envelope);
    const stripe = new Mesh(G.cyl, lit(C.balloon2)); stripe.scale.set(1.84, 0.35, 1.84); balloon.add(stripe);
    const basket = new Mesh(G.box, lit(C.trunk)); basket.scale.set(0.35, 0.3, 0.35); basket.position.y = -1.45; balloon.add(basket);
  }
  const balloonAt = stations.findIndex((st) => st.biome === 'mountain' || st.biome === 'snow');
  balloon.visible = balloonAt >= 0;
  const balloonX = Math.max(balloonAt, 0) * S + 2;
  balloon.position.set(balloonX, 6.5, -8);
  world.add(balloon);

  const boat = new Group();
  if (placer.has('sailboat')) boat.add(placer.spawn('sailboat').translateY(-0.15));
  else {
    const hull = new Mesh(G.box, lit(C.boat)); hull.scale.set(1.5, 0.3, 0.55); boat.add(hull);
    const sailGeo = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, 1.5), new THREE.Vector2(0.9, 0)]));
    const sail = new Mesh(sailGeo, new MeshLambertMaterial({ color: C.sail, side: DoubleSide, clippingPlanes: clip })); sail.position.set(-0.35, 0.2, 0); boat.add(sail);
  }
  const seaAt = stations.findIndex((st) => st.biome === 'seaside');
  boat.visible = seaAt >= 0;
  boat.position.set(Math.max(seaAt, 0) * S - 3, 0.12, -10);
  world.add(boat);

  const beamGeo = new ConeGeometry(0.9, 7, 18, 1, true).translate(0, -3.5, 0).rotateX(Math.PI / 2);
  const beam = new Mesh(beamGeo, new MeshBasicMaterial({ color: '#fff2b8', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, clippingPlanes: clip, fog: false }));
  beam.visible = beacons.length > 0;
  beam.position.set(beacons[0] ?? 0, 4.72, -5.5);
  world.add(beam);

  const flyGeo = new BufferGeometry();
  const flyBase = [];
  for (let i = 0; i < 46; i++) flyBase.push(JOURNEY_LENGTH - 10 + r() * 18, 0.4 + r() * 2.8, -6 + r() * 11, r() * 6.28);
  flyGeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(46 * 3), 3));
  const flies = new Points(flyGeo, new PointsMaterial({ color: '#ffe27a', size: 0.16, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, clippingPlanes: clip, fog: false }));
  world.add(flies);

  // 到站明信片：立在轨道前方的空地上，随火车接近从地面立起（由世界时间驱动，停摇即停）
  const cardGeo = new PlaneGeometry(2.5, 2.93).translate(0, 1.465, 0);
  const cards = stations.map((st, i) => {
    if (!st.photo || !SCENE.postcards) return null;
    const cx = i * S;
    const stand = new Group();
    stand.position.set(cx + 2, 0, 7);
    stand.rotation.y = -0.15;
    const post = new Mesh(G.box, lit(C.trunk)); post.scale.set(0.12, 0.7, 0.12); post.position.y = 0.35;
    const card = new Group(); card.position.y = 0.55;
    card.add(new Mesh(cardGeo, new MeshBasicMaterial({ map: postcardTexture(st.photo, st.caption), side: DoubleSide, clippingPlanes: clip })));
    stand.add(post, card);
    world.add(stand);
    return { cx, card, stand };
  }).filter(Boolean);

  // —— 火车（固定在画面中间，世界从它身边经过）——
  // 竖屏舞台只有 15 个单位宽，所以是一个车头 + 一节车厢
  const RAIL_TOP = 0.26, CAR_X = -1.35;
  const train = new Group();
  const tb = new Batch(), tg = new Batch();
  const trainGlowMat = new MeshBasicMaterial({ vertexColors: true });
  if (placer.has('train_engine')) train.add(placer.spawn('train_engine').translateX(1.75).translateY(RAIL_TOP));
  else {
    tb.box(C.engineDark, 1.9, 0.78, 0, 3.3, 0.3, 1.0);
    tb.add(G.cyl, C.engine, [2.35, 1.38, 0], { rot: [0, 0, Math.PI / 2], scale: [1.0, 2.0, 1.0] });
    tb.add(G.cyl, C.engineDark, [3.4, 1.38, 0], { rot: [0, 0, Math.PI / 2], scale: [1.06, 0.18, 1.06] });
    tb.add(G.cyl, C.engineDark, [3.0, 2.15, 0], { scale: [0.3, 0.7, 0.3] });
    tb.add(G.cyl, C.engineDark, [3.0, 2.55, 0], { scale: [0.46, 0.16, 0.46] });
    tb.add(G.sphere, C.brass, [2.15, 1.9, 0], { scale: [0.24, 0.2, 0.24] });
    for (const x of [1.7, 2.5, 3.2]) tb.add(G.cyl, C.brass, [x, 1.38, 0], { rot: [0, 0, Math.PI / 2], scale: [1.04, 0.05, 1.04] });
    tb.box(C.engine, 0.82, 1.55, 0, 1.15, 1.35, 1.12);
    tb.box(C.engineDark, 0.82, 2.3, 0, 1.4, 0.12, 1.3);
    tg.box(C.glowWarm, 0.82, 1.8, 0.57, 0.5, 0.36, 0.02);
    tg.box(C.glowWarm, 0.82, 1.8, -0.57, 0.5, 0.36, 0.02);
    tg.add(G.sphere, '#fff3c4', [3.55, 1.85, 0], { scale: [0.13, 0.13, 0.13] });
  }
  tb.box(C.engineDark, -0.25, 0.85, 0, 0.6, 0.12, 0.3); // 车钩
  if (placer.has('train_carriage')) train.add(placer.spawn('train_carriage').translateX(CAR_X).translateY(RAIL_TOP));
  else {
    tb.box(C.carBase, CAR_X, 0.8, 0, 2.6, 0.24, 1.0);
    tb.box(C.car, CAR_X, 1.36, 0, 2.5, 0.92, 1.04);
    tb.box(C.carRoof, CAR_X, 1.9, 0, 2.7, 0.16, 1.2);
    tb.box(C.brass, CAR_X, 0.98, 0, 2.52, 0.06, 1.06);
    for (const wx of [-0.75, 0, 0.75]) for (const z of [0.53, -0.53]) tg.box(C.glowWarm, CAR_X + wx, 1.45, z, 0.46, 0.34, 0.02);
  }
  const trainBody = tb.build(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  train.add(trainBody);
  if (tg.parts.length) train.add(tg.build(trainGlowMat));
  const trainShadow = new Mesh(G.disc, new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.2, depthWrite: false }));
  trainShadow.scale.set(3.4, 1, 0.9); trainShadow.position.set(0.5, 0.13, 0.15);
  train.add(trainShadow);

  // 程序化车轮单独转动；换成 Tripo 车体后车轮就在模型里，不再叠加
  const wheelGeo = (rad, color) => new Batch()
    .add(new CylinderGeometry(rad, rad, 0.12, 12), color, [0, 0, 0], { rot: [Math.PI / 2, 0, 0] })
    .box(C.brass, rad * 0.55, 0, 0.07, rad * 0.5, rad * 0.25, 0.02)
    .geometry();
  const wheelMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const bigWheels = placer.has('train_engine') ? [] : [1.05, 1.95, 2.85].flatMap((x) => [[x, 0.56], [x, -0.56]]);
  const smallWheels = placer.has('train_carriage') ? [] : [CAR_X - 0.8, CAR_X + 0.8].flatMap((x) => [[x, 0.56], [x, -0.56]]);
  const bigR = 0.32, smallR = 0.24;
  const wheelsBig = new InstancedMesh(wheelGeo(bigR, C.engine), wheelMat, Math.max(bigWheels.length, 1));
  const wheelsSmall = new InstancedMesh(wheelGeo(smallR, C.carBase), wheelMat, Math.max(smallWheels.length, 1));
  wheelsBig.visible = bigWheels.length > 0;
  wheelsSmall.visible = smallWheels.length > 0;
  train.add(wheelsBig, wheelsSmall);
  scene.add(train);

  // 烟：发射到世界坐标里，所以会自然落在火车身后
  const SMOKE = 40;
  const smoke = new InstancedMesh(G.ico, new MeshLambertMaterial({ color: '#f4f1ec', flatShading: true, transparent: true, opacity: 0.8, clippingPlanes: clip, depthWrite: false }), SMOKE);
  world.add(smoke);
  const puffs = Array.from({ length: SMOKE }, () => ({ born: -1, x: 0 }));
  let puffIndex = 0, lastPuffDist = 0;

  const letter = buildLetter(story.letter);
  scene.add(letter.root, letter.dim);

  // —— 每帧更新 ——
  const tmp = new Object3D();
  const camOffset = new Vector3();

  function setWheels(mesh, list, radius, y, dist) {
    const angle = -dist / radius;
    list.forEach(([x, z], i) => {
      tmp.position.set(x, y, z); tmp.rotation.set(0, 0, angle); tmp.scale.setScalar(1);
      tmp.updateMatrix(); mesh.setMatrixAt(i, tmp.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  function update({ worldTime, dist, letterU, parallax }) {
    uTime.value = worldTime;
    world.position.x = -dist;
    cloudMesh.position.x = worldTime * 0.12;

    // 环境随行程变化
    const e = envAt(envs, dist);
    sky.material.uniforms.top.value.copy(e.top);
    sky.material.uniforms.bottom.value.copy(e.bottom);
    scene.fog.color.copy(e.bottom);
    ground.material.color.copy(e.ground);
    terrain.material.color.setRGB(1, 1, 1).lerp(new Color('#5b6f86'), e.night * 0.6);
    islands.update(worldTime, e.night);
    mist.update(e.night);
    // 鲲：越过海边站时与火车同向缓游，被火车慢慢超过
    kun.update(worldTime, 12 - (dist - (kunAt * S - 16)) * 0.8, e.night);
    unicorn.update(worldTime, e.night);
    lanterns?.update(worldTime, e.night);
    sun.color.copy(e.sun); sun.intensity = e.sunI;
    hemi.intensity = e.hemiI;
    const glowLevel = 0.3 + e.night * 1.3;
    glowMat.color.setScalar(glowLevel);
    trainGlowMat.color.setScalar(glowLevel);
    haloMat.opacity = e.night * 0.55;
    stars.material.opacity = e.night;
    // 太阳和月亮的高度跟着天色走：越暗太阳越低、月亮越高
    const dim = clamp01(1 - e.sunI / 2.4 + e.night);
    beam.material.opacity = 0.05 + dim * 0.22;
    beam.rotation.y = worldTime * 1.1;
    sunDisc.position.y = lerp(14, -6, dim);
    moon.position.y = lerp(-4, 16, clamp01(e.night * 1.2));
    cloudMesh.material.color.setRGB(1, 1, 1).lerp(new Color('#7c86b8'), e.night * 0.7); // 夜里偏蓝而不是发灰，免得像石块

    balloon.position.y = 6.5 + Math.sin(worldTime * 0.8) * 0.3;
    balloon.position.x = balloonX + worldTime * 0.05;
    boat.position.y = 0.12 + Math.sin(worldTime * 1.5) * 0.06;
    boat.rotation.z = Math.sin(worldTime * 1.2) * 0.06;

    for (const { cx, card, stand } of cards) {
      const up = ease(seg(dist - cx, -3, -0.5));
      stand.visible = up > 0;
      card.rotation.x = -(1 - up) * Math.PI / 2 - 0.45 * up; // 平躺 → 后仰立起，正对俯视的镜头
    }

    flies.material.opacity = e.night;
    const fp = flies.geometry.attributes.position;
    for (let i = 0; i < 46; i++) {
      const [x, y, z, ph] = flyBase.slice(i * 4, i * 4 + 4);
      fp.setXYZ(i, x + Math.sin(worldTime * 0.7 + ph) * 0.6, y + Math.sin(worldTime * 1.1 + ph * 2) * 0.35, z + Math.cos(worldTime * 0.6 + ph) * 0.5);
    }
    fp.needsUpdate = true;

    // 火车
    setWheels(wheelsBig, bigWheels, bigR, 0.26 + bigR, dist);
    setWheels(wheelsSmall, smallWheels, smallR, 0.26 + smallR, dist);
    trainBody.position.y = Math.abs(Math.sin(dist * 4)) * 0.012;

    while (dist - lastPuffDist >= 0.5) {
      lastPuffDist += 0.5;
      puffs[puffIndex] = { born: worldTime, x: lastPuffDist + 3.0 };
      puffIndex = (puffIndex + 1) % SMOKE;
    }
    puffs.forEach((p, i) => {
      const a = p.born < 0 ? 1 : (worldTime - p.born) / 3.2;
      if (a >= 1) tmp.scale.setScalar(0);
      else tmp.scale.setScalar((0.22 + a * 0.75) * Math.min(1, (1 - a) * 3));
      tmp.position.set(p.x - a * 0.8, 2.7 + a * 2.4, Math.sin(p.x) * 0.3 * a);
      tmp.rotation.set(p.x, p.x * 2, 0);
      tmp.updateMatrix(); smoke.setMatrixAt(i, tmp.matrix);
    });
    smoke.instanceMatrix.needsUpdate = true;
    smoke.material.color.setScalar(1 - e.night * 0.45);

    // 桌面 2D 预览时，用鼠标位置模拟一点观看视差；交织模式下由屏幕本身提供
    camOffset.lerp(new Vector3(parallax.x * 1.2, parallax.y * 0.7, 0), 0.08);
    camera.position.copy(CAMERA_POS).add(camOffset);
    camera.lookAt(CAMERA_TARGET);
    camera.updateMatrixWorld();

    letter.update(letterU, camera);
    qingniao.update(worldTime, letterU, letterU > 0 ? letter.env.position : null);
  }

  function reset() {
    puffs.forEach((p) => { p.born = -1; });
    lastPuffDist = 0;
  }

  // 让盒宽始终完整入画（竖屏 10:16 为设计比例）；视场上限 52°
  function setAspect(aspect) {
    const halfW = HALF_W + 0.6, D = CAMERA_POS.distanceTo(CAMERA_TARGET);
    const vfov = 2 * Math.atan(halfW / aspect / D) * 180 / Math.PI;
    camera.aspect = aspect;
    camera.fov = Math.min(Math.max(vfov, 24), 52);
    camera.updateProjectionMatrix();
  }

  return {
    scene, camera, update, reset, setAspect, journeyLength: JOURNEY_LENGTH,
    stationAt: (d) => stations[Math.min(Math.round(d / S), stations.length - 1)],
  };
}

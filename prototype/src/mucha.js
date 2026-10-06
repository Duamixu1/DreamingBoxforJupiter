// 穆夏《一日四时》版布景（故事见 stories/western/）。
// 四扇哥特尖拱窗左右并排：晨春 / 昼夏 / 暮秋 / 夜冬。镜头沿长发向右平移，
// 黑猫叼着信踩着四位女子的长发走完一天，最后在夜的身边蜷起来睡下。
// 一切动作只读 worldTime 与旅程进度：停摇时，女子停在半个懒腰里，猫停在半步，雪停在半空。
import { THREE, GLBLoader } from './three.js';
import { rng, clamp01, seg, ease, lerp, Batch, G, radialTexture } from './kit.js';
import { buildLetter } from './scene.js';
import { TUNING } from './config.js';

const {
  Vector3, Color, Group, Object3D, Mesh, Points, BufferGeometry, BufferAttribute, Float32BufferAttribute,
  PlaneGeometry, CircleGeometry, SphereGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, LatheGeometry,
  ExtrudeGeometry, Shape, Path, CatmullRomCurve3, Vector2, MeshLambertMaterial, MeshBasicMaterial, PointsMaterial,
  ShaderMaterial, HemisphereLight, DirectionalLight, AmbientLight, Fog, PerspectiveCamera, Scene,
  AdditiveBlending, DoubleSide,
} = THREE;

const PANEL = 11;            // 窗与窗的间距（场景单位）
const HALF_W = 5.3;          // 焦平面上要完整入画的半宽（竖屏 10:16）
const CAM_Z = 26;            // 镜头到焦平面（女子、长发、猫）的距离 = DISPLAY.render.focusDistance
const CAM_Y = 6.6, LOOK_Y = 8.2;
const FLOOR = 1.0;           // 女子脚下露台的高度
const FRAME_Z = 4.2;         // 窗框所在深度：全片最近的一层
const SKIN = '#efdcca';
const TAU = Math.PI * 2;

// —— 四季：色板见 stories/western/style.md ————————————————————————
const SEASONS = {
  dawn: {
    sky: ['#f6dccb', '#bfd2e2'], ground: '#b5c99a', ridge: '#b9c8bf', fog: '#ecdcd0',
    hemi: ['#fff3e6', '#a5b48f', 1.3], sun: ['#ffe0bf', 1.35], ambient: 0.3, night: 0,
    robe: '#e8c4b2', bodice: '#f2e8d5', hair: '#dcc792', crown: 'flowers', accent: '#e3b9b0',
    disc: { color: '#f7d29a', r: 2.3, x: 2.0, y: 5.8, z: -9 },
    drift: { color: '#f3c6c6', size: 0.24, n: 60 },
  },
  noon: {
    sky: ['#f2e8d5', '#93bddc'], ground: '#d9b96e', ridge: '#a9b99c', fog: '#efe4cc',
    hemi: ['#fff8ea', '#b39a62', 1.4], sun: ['#fff4dc', 1.6], ambient: 0.32, night: 0,
    robe: '#d6b064', bodice: '#f2e8d5', hair: '#c9a55a', crown: 'wheat', accent: '#9daf8c',
    disc: { color: '#fffaf0', r: 3.0, x: -0.7, y: 12.4, z: -9 },
    drift: { color: '#fff1c4', size: 0.13, n: 40 },
  },
  dusk: {
    sky: ['#ec9f5c', '#7e5a78'], ground: '#9c5a3c', ridge: '#8a6470', fog: '#d9a07a',
    hemi: ['#ffd9b0', '#7e5a60', 1.15], sun: ['#ffb27a', 1.3], ambient: 0.28, night: 0.2,
    robe: '#9c5a3c', bodice: '#7e5a78', hair: '#a3583a', crown: 'leaves', accent: '#c77b3a',
    disc: { color: '#e6703f', r: 2.8, x: 2.3, y: 9.6, z: -9 },
    drift: { color: '#d08a3c', size: 0.3, n: 46 },
  },
  night: {
    sky: ['#3a4170', '#151a36'], ground: '#9aa2b8', ridge: '#3e4672', fog: '#2a3058',
    hemi: ['#9fb0e8', '#3a4060', 1.05], sun: ['#c9d2ff', 0.85], ambient: 0.3, night: 1,
    robe: '#8e95b8', bodice: '#d4d8e2', hair: '#a9b1cf', crown: 'crescent', accent: '#7e86b0',
    disc: { color: '#eef0f6', r: 2.2, x: 2.4, y: 12.6, z: -9 },
    drift: { color: '#ffffff', size: 0.2, n: 150 },
  },
};
const ORDER = ['dawn', 'noon', 'dusk', 'night'];

// —— 材质 ————————————————————————————————————————————————————
// 衣摆：越靠下摆幅越大，读 worldTime
function robeMaterial(color, uTime, uAmp, height) {
  const m = new MeshLambertMaterial({ color });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime; sh.uniforms.uAmp = uAmp;
    sh.vertexShader = 'uniform float uTime;\nuniform float uAmp;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float k = 1.0 - clamp(position.y / ${height.toFixed(2)}, 0.0, 1.0); k *= k;
      float a = atan(position.z, position.x);
      transformed.x += uAmp * k * sin(uTime * 1.3 + a * 2.0 + position.y * 0.7);
      transformed.z += uAmp * 0.6 * k * cos(uTime * 1.1 + a * 3.0);`);
  };
  m.customProgramCacheKey = () => `mucha-robe-${height.toFixed(2)}`;
  return m;
}

// 布景（树、花、垂枝）：顶点色 + aSway 摆动，读 worldTime
function swayMaterial(uTime, extra = {}) {
  const m = new MeshLambertMaterial({ vertexColors: true, flatShading: true, ...extra });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = 'attribute float aSway;\nattribute float aWave;\nuniform float uTime;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.x += aSway * sin(uTime * 1.2 + position.x * 0.8 + position.y * 0.6);
        transformed.z += aSway * 0.5 * cos(uTime * 0.9 + position.x * 0.5);
        transformed.y += aWave * (0.18 * sin(position.x * 0.9 + uTime * 1.1) + 0.12 * sin(position.z * 1.3 - uTime * 0.8));`);
  };
  m.customProgramCacheKey = () => 'mucha-sway';
  return m;
}

// 黑猫：纯黑，只有一圈很淡的暖色边缘光
function catMaterial() {
  return new ShaderMaterial({
    uniforms: { rim: { value: new Color('#ffcf8a') }, rimI: { value: 0.32 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){
        vec4 p = vec4(position, 1.0); vec3 n = normal;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
        #endif
        vec4 mv = modelViewMatrix * p; vN = normalize(normalMatrix * n); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 rim; uniform float rimI; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0); gl_FragColor = vec4(rim * f * rimI, 1.0);
      #include <colorspace_fragment>
      }`,
  });
}

// —— 小工具 ————————————————————————————————————————————————————
// 把几块几何体合成一块（保留位置和法线），省绘制次数：Jupiter 每帧要画 9 个视点
function merge(parts) {
  const geos = parts.map(([g, m]) => { const c = (g.index ? g.toNonIndexed() : g.clone()); c.applyMatrix4(m); return c; });
  const n = geos.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; g.dispose(); }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}
const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(new Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new Vector3(sx, sy, sz));

const lathe = (profile, n = 28) => new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), n);
const mix3 = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
function mixPose(a, b, t) {
  const out = {};
  for (const k of Object.keys(a)) out[k] = Array.isArray(a[k][0]) ? a[k].map((v, i) => mix3(v, b[k][i], t)) : mix3(a[k], b[k], t);
  return out;
}

// —— 女子 ————————————————————————————————————————————————————
// 程序化占位：Tripo 精模到位后替换外形，关节与动作保留。
// 关节：spine（腰）→ neck → head；双臂 shoulder → elbow。L 在画面左侧（-x），R 在右侧（+x）。
function createLady(season, uTime, { seated = false } = {}) {
  const S = SEASONS[season];
  const amp = { value: season === 'noon' ? 0.16 : season === 'night' ? 0.03 : 0.08 };
  const root = new Group();
  const skin = new MeshLambertMaterial({ color: SKIN });
  const bodiceMat = new MeshLambertMaterial({ color: S.bodice });
  const hairMat = new MeshLambertMaterial({ color: S.hair });

  // 侧卧时不用喇叭形裙摆，换成裹着长袍的修长身体轮廓
  const SKIRT = season === 'night'
    ? [[0.001, 0], [0.55, 0.08], [0.82, 0.7], [0.92, 2.0], [1.02, 3.6], [0.86, 4.8], [0.62, 5.6], [0.001, 5.62]]
    : [[0.001, 0], [1.75, 0], [1.5, 0.5], [1.1, 2.4], [0.8, 4.4], [0.6, 5.6], [0.001, 5.62]];
  const skirt = new Mesh(lathe(SKIRT), robeMaterial(S.robe, uTime, amp, 5.6));
  if (seated) skirt.scale.set(1.2, 0.56, 1.25);
  if (season === 'night') skirt.scale.set(1, 1, 0.8);
  root.add(skirt);

  const spine = new Group(); spine.position.y = seated ? 5.6 * 0.56 : 5.6; root.add(spine);
  const bodice = new Mesh(lathe([[0.6, 0], [0.66, 0.6], [0.72, 1.3], [0.74, 1.8], [0.66, 2.1], [0.46, 2.35], [0.22, 2.5], [0.001, 2.53]]), bodiceMat);
  bodice.scale.z = 0.8; spine.add(bodice);
  // 腰带：一道宽的赭金色带子，把裙与上身分开
  const sash = new Mesh(new TorusGeometry(0.64, 0.09, 8, 28), new MeshLambertMaterial({ color: '#c9a55a' }));
  sash.rotation.x = Math.PI / 2; sash.position.y = 0.05; sash.scale.y = 0.8; spine.add(sash);

  const neck = new Group(); neck.position.y = 2.45; spine.add(neck);
  neck.add(new Mesh(new CylinderGeometry(0.16, 0.19, 0.55, 10).translate(0, 0.27, 0), skin));
  const head = new Group(); head.position.y = 0.5; neck.add(head);
  const face = new Mesh(new SphereGeometry(0.46, 20, 14), skin); face.scale.set(0.92, 1.12, 0.98); face.position.y = 0.45; head.add(face);
  const cap = new Mesh(new SphereGeometry(0.5, 20, 14, 0, TAU, 0, Math.PI * 0.6), hairMat);
  cap.position.set(0, 0.52, -0.06); cap.rotation.x = -0.4; head.add(cap);
  const bun = new Mesh(new SphereGeometry(0.36, 16, 12), hairMat); bun.position.set(0, 0.62, -0.42); head.add(bun);
  const anchor = new Object3D(); anchor.position.set(0, 0.6, -0.55); head.add(anchor); // 长发从这里飘出

  // 头饰：每人一件大形状，标明时辰
  const crown = new Group(); crown.position.y = 0.45; head.add(crown);
  const cb = new Batch();
  if (S.crown === 'flowers') {
    const cols = ['#f3d2d2', '#f4ebc8', '#b9a7d6'];
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI * 0.9 + k * (Math.PI * 1.8 / 6);
      cb.add(G.ico, cols[k % 3], [Math.sin(a) * 0.46, 0.42 + Math.cos(a) * 0.08, Math.cos(a) * 0.46 - 0.05], { scale: [0.13, 0.13, 0.13] });
    }
  } else if (S.crown === 'wheat') {
    for (let k = 0; k < 3; k++) cb.add(new ConeGeometry(0.07, 0.7, 6), '#d9b45a', [0.38 + k * 0.05, 0.45 + k * 0.08, -0.25], { rot: [0, 0, -0.7 - k * 0.25] });
  } else if (S.crown === 'leaves') {
    for (let k = 0; k < 3; k++) cb.add(G.ico, ['#c77b3a', '#a3583a', '#d9a25a'][k], [0.36, 0.3 + k * 0.16, -0.2 + k * 0.05], { scale: [0.22, 0.12, 0.06], rot: [0, 0, -0.5 + k * 0.4] });
  } else {
    const c = new Mesh(new TorusGeometry(0.3, 0.06, 8, 24, 4.0), new MeshBasicMaterial({ color: '#efe6c6' }));
    c.position.set(0, 0.62, 0.12); c.rotation.z = 2.0; crown.add(c);
  }
  if (cb.parts.length) crown.add(cb.build(new MeshLambertMaterial({ vertexColors: true, flatShading: true })));

  const arm = {};
  for (const [name, sx] of [['L', -1], ['R', 1]]) {
    const sh = new Group(); sh.position.set(sx * 0.66, 2.1, 0); spine.add(sh);
    sh.add(new Mesh(new CylinderGeometry(0.19, 0.13, 1.85, 10).translate(0, -0.92, 0), bodiceMat));
    const el = new Group(); el.position.y = -1.85; sh.add(el);
    el.add(new Mesh(new CylinderGeometry(0.12, 0.08, 1.6, 10).translate(0, -0.8, 0), skin));
    const hand = new Mesh(new SphereGeometry(0.13, 10, 8), skin); hand.scale.set(0.8, 1.3, 0.6); hand.position.y = -1.7; el.add(hand);
    const tip = new Object3D(); tip.position.y = -1.8; el.add(tip);
    arm[name] = { sh, el, tip };
  }

  function pose(p) {
    spine.rotation.set(...p.spine);
    neck.rotation.set(...p.neck);
    for (const k of ['L', 'R']) { arm[k].sh.rotation.set(...p[k][0]); arm[k].el.rotation.set(...p[k][1]); }
  }
  return { root, spine, head, anchor, arm, pose };
}

// —— Tripo 模型 ————————————————————————————————————————————————
// 按槽位 id 命名放进 prototype/assets/models/，有就替换程序化占位（清单见 stories/western/models.md）
export const MUCHA_SLOTS = ['mucha_lady_dawn', 'mucha_lady_noon', 'mucha_lady_dusk', 'mucha_lady_night', 'mucha_tree', 'mucha_flower_lily', 'mucha_flower_daisy', 'mucha_ornament', 'mucha_butterfly'];
const MODEL_DIR = './assets/models/';

export async function loadMuchaModels(renderer) {
  const out = new Map();
  let ids = [];
  try {
    const html = await (await fetch(MODEL_DIR, { cache: 'no-store' })).text();
    ids = MUCHA_SLOTS.filter((id) => html.includes(`${id}.glb`));
  } catch { return out; }
  const loader = new GLBLoader(renderer, {
    dracoDecoderPath: './vendor/jupiter-sdk/decoders/draco/',
    ktx2TranscoderPath: './vendor/jupiter-sdk/decoders/basis/',
  });
  await Promise.all(ids.map(async (id) => {
    try { out.set(id, (await loader.load(MODEL_DIR + id + '.glb')).scene); console.info(`[穆夏] ${id} 已替换占位`); }
    catch (err) { console.warn(`[穆夏] ${id}.glb 加载失败，继续用占位：`, err); }
  }));
  return out;
}

// 布景小件（tools/jupiter_prop.py 处理过：原点在底面中心）：拆成「几何 + 贴图」，高度归一到 1，按实例摆放
function propTemplate(src) {
  src.updateMatrixWorld(true);
  const parts = [];
  const box = new THREE.Box3();
  src.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    g.computeBoundingBox(); box.union(g.boundingBox);
    parts.push({ g, map: o.material.map });
  });
  const k = 1 / (box.max.y - box.min.y);
  const c = box.getCenter(new Vector3());
  for (const p of parts) p.g.translate(-c.x, -box.min.y, -c.z).scale(k, k, k);
  // 蝴蝶用：身体所在的高度（贴近中线 z≈0 的顶点平均高度）
  let by = 0, bn = 0;
  for (const p of parts) {
    const a = p.g.attributes.position;
    for (let i = 0; i < a.count; i++) if (Math.abs(a.getZ(i)) < 0.03) { by += a.getY(i); bn++; }
  }
  return { parts, bodyY: bn ? by / bn : 0.3 };
}

// 小件材质：贴图 + 一点自发光（保住画的颜色）。sway：越高摆得越多（花、树）；flap：蝴蝶两翅绕身体轴开合
function propMaterial(tpl, uTime, { sway = 0, flap = 0, side = THREE.FrontSide } = {}) {
  const map = tpl.parts[0].map;
  const U = { uTime, uSway: { value: sway }, uFlap: { value: flap }, uBody: { value: tpl.bodyY } };
  const m = new MeshLambertMaterial({ map, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 0.22, side });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'uniform float uTime, uSway, uFlap, uBody;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float ph = 0.0;
      #ifdef USE_INSTANCING
        ph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 0.9;
      #endif
      float hh = transformed.y * transformed.y;
      transformed.x += uSway * hh * sin(uTime * 1.3 + ph);
      transformed.z += uSway * 0.5 * hh * cos(uTime * 1.0 + ph);
      if (uFlap > 0.0) {
        float w = smoothstep(0.03, 0.12, abs(transformed.z));
        float a = sign(transformed.z) * w * uFlap * (0.5 + 0.5 * sin(uTime * 9.0 + ph * 3.0));
        vec3 q = transformed - vec3(0.0, uBody, 0.0);
        float c = cos(a), sn = sin(a);
        transformed = vec3(q.x, q.y * c - q.z * sn, q.y * sn + q.z * c) + vec3(0.0, uBody, 0.0);
      }`);
  };
  m.customProgramCacheKey = () => 'mucha-prop';
  return m;
}

// list：[x, y, z, 高度, 绕 y 转角, 是否镜像]
const _pm = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _pe = new THREE.Euler(), _pv = new Vector3(), _ps = new Vector3();
function propMatrix(x, y, z, h, ry = 0, mirror = false, rz = 0) {
  return _pm.compose(_pv.set(x, y, z), _pq.setFromEuler(_pe.set(0, ry, rz)), _ps.set(mirror ? -h : h, h, h));
}
function placeProps(tpl, mat, list) {
  const g = new Group();
  for (const p of tpl.parts) {
    const inst = new THREE.InstancedMesh(p.g, mat, list.length);
    list.forEach((it, i) => inst.setMatrixAt(i, propMatrix(...it)));
    inst.computeBoundingSphere();
    g.add(inst);
  }
  g.setAt = (i, ...it) => { for (const inst of g.children) { inst.setMatrixAt(i, propMatrix(...it)); inst.instanceMatrix.needsUpdate = true; } };
  return g;
}

// 浮雕人物：Tripo 从穆夏原画生成的半浮雕（只有正面，背后是平的），手臂和身体连成一块、没有骨骼。
// 所以动作改在顶点着色器里做：脖子以上绕颈部转动（低头 → 抬头），胸口呼吸，下摆被风吹动。
// 对外接口与 createLady 相同（root / spine / anchor / arm.R.tip / pose），站内动作表照用。
// depthGain：前后厚度放大倍数。Tripo 浮雕很浅，透镜屏的立体感来自前后差，放大后人物才有体积
function createReliefLady(src, uTime, { height = 10.4, depthGain = 1.8 } = {}) {
  src.updateMatrixWorld(true);
  const geos = [];
  src.traverse((o) => { if (o.isMesh) geos.push({ g: o.geometry.clone().applyMatrix4(o.matrixWorld), map: o.material.map }); });
  const box = new THREE.Box3();
  for (const { g } of geos) { g.computeBoundingBox(); box.union(g.boundingBox); }
  // 头部：最高 0.06 以内的顶点
  const hs = new Vector3(); let hn = 0;
  for (const { g } of geos) {
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) if (p.getY(k) > box.max.y - 0.06) { hs.x += p.getX(k); hs.z += p.getZ(k); hn++; }
  }
  hs.divideScalar(Math.max(hn, 1));
  const neck = new Vector3(hs.x, box.max.y - 0.1, hs.z);
  const s = height / (box.max.y - box.min.y);

  const U = { uTime, uLift: { value: 0 }, uBreath: { value: 0 }, uWind: { value: 0.3 }, uNeck: { value: neck } };
  const root = new Group();
  const body = new Group();
  body.scale.set(s, s, s * depthGain);
  body.position.set(-neck.x * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s * depthGain); // 厚度中线落在焦平面上
  root.add(body);
  const spine = new Group(); root.add(spine); // 只用它的 scale 读呼吸
  for (const { g, map } of geos) {
    const m = new MeshLambertMaterial({ map, color: '#ffffff', emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 0.25 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'uniform float uTime, uLift, uBreath, uWind;\nuniform vec3 uNeck;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float wHead = smoothstep(uNeck.y - 0.02, uNeck.y + 0.03, transformed.y);
        vec3 q = transformed - uNeck;
        float a = uLift * wHead, c = cos(a), sn = sin(a);
        q = vec3(q.x, q.y * c - q.z * sn, q.y * sn + q.z * c);
        transformed = q + uNeck;
        float chest = smoothstep(uNeck.y - 0.26, uNeck.y - 0.16, transformed.y) * (1.0 - smoothstep(uNeck.y - 0.08, uNeck.y - 0.02, transformed.y));
        transformed.z += uBreath * chest;
        float k = 1.0 - smoothstep(uNeck.y - 0.45, uNeck.y - 0.2, transformed.y); k *= k;
        transformed.x += uWind * k * 0.012 * sin(uTime * 1.3 + transformed.y * 40.0);
        transformed.z += uWind * k * 0.008 * cos(uTime * 1.1 + transformed.x * 30.0);`);
    };
    m.customProgramCacheKey = () => 'mucha-relief';
    const mesh = new Mesh(g, m);
    mesh.onBeforeRender = () => { U.uBreath.value = (spine.scale.y - 1) * 0.6; };
    body.add(mesh);
  }
  // 长发从后脑勺飘出：浮雕背面是平的，所以发根放在头后、贴着背面
  const anchorLocal = new Vector3(neck.x, box.max.y - 0.04, box.min.z);
  const anchor = new Object3D(); body.add(anchor);
  const tip = new Object3D(); tip.position.set(box.max.x, neck.y - 0.3, box.max.z); body.add(tip);
  const dummy = () => ({ sh: new Group(), el: new Group(), tip });
  return {
    root, spine, anchor, arm: { L: dummy(), R: dummy() },
    pose(p) {
      const nx = Math.max(-0.15, Math.min(0.5, p.neck[0]));
      U.uLift.value = nx * 0.6;
      U.uWind.value = 0.3 + 0.7 * clamp01((0.5 - nx) / 0.65); // 醒来后晨风才吹起衣摆
      const q = anchorLocal.clone().sub(neck);
      const a = U.uLift.value, c = Math.cos(a), sn = Math.sin(a);
      anchor.position.set(q.x, q.y * c - q.z * sn, q.y * sn + q.z * c).add(neck);
    },
  };
}

// 各位女子的起止姿态（站内进度 0 → 1，见 stories/western/scenes.md）
const REST_ARMS = { L: [[0, 0, -0.1], [0, 0, 0]], R: [[0, 0, 0.1], [0, 0, 0]] };
const POSES = {
  dawn: {
    a: { spine: [0.06, 0, 0], neck: [0.5, 0, 0], L: [[-1.05, 0, 0.45], [-1.7, 0, 0]], R: [[-1.05, 0, -0.45], [-1.7, 0, 0]] },
    b: { spine: [-0.1, 0, 0], neck: [-0.35, 0, 0], L: [[0, 0, -2.55], [0, 0, -0.95]], R: [[0, 0, 2.55], [0, 0, 0.95]] },
    t: (u) => ease(seg(u, 0.15, 0.6)),
  },
  noon: {
    a: { spine: [0, 0.15, 0], neck: [0.35, 0.55, 0], L: [[0, 0, -0.08], [0, 0, 0]], R: [[0, 0, 2.55], [0, 0, 0.45]] },
    b: { spine: [-0.06, -0.1, 0], neck: [-0.45, -0.3, -0.1], L: [[-0.25, 0, -0.7], [0, 0, 0.35]], R: [[0, 0, 2.65], [0, 0, 0.3]] },
    t: (u) => ease(seg(u, 0.3, 0.7)),
  },
  dusk: {
    a: { spine: [0.18, 0, 0.05], neck: [0.1, 0.35, 0], L: [[-1.35, 0, 0.2], [-2.2, 0, 0]], R: [[-0.3, 0, 0.12], [-0.15, 0, 0]] },
    b: { spine: [0.2, 0, 0.05], neck: [0.12, 0.35, 0.22], L: [[-1.35, 0, 0.22], [-2.2, 0, 0]], R: [[-0.95, 0, 0.3], [-0.55, 0, 0]] },
    t: (u) => ease(seg(u, 0.2, 0.5)),
  },
  night: {
    // 侧卧在雪云上，上身微微支起；搭在身前的手，在猫蜷过来时轻轻挪到它身旁
    a: { spine: [0, 0, 0.42], neck: [0, 0, 0.1], L: [[0, 0, -0.1], [0, 0, 0]], R: [[-0.55, 0, 0.05], [-0.2, 0, 0]] },
    b: { spine: [0, 0, 0.42], neck: [0, 0, 0.1], L: [[0, 0, -0.1], [0, 0, 0]], R: [[-0.85, 0, 0.3], [-0.35, 0, 0]] },
    t: (u) => ease(seg(u, 0.7, 0.95)),
  },
};

// —— 长发：程序化飘带。主发同时是猫走的路，副发只做装饰 ——————————————————
class Ribbon {
  constructor(n, colorAt, widthAt, material) {
    this.n = n;
    this.c = Array.from({ length: n }, () => new Vector3());
    this.s = Array.from({ length: n }, () => new Vector3());
    this.w = Float32Array.from({ length: n }, (_, k) => widthAt(k / (n - 1)));
    const pos = new Float32Array(n * 6), nor = new Float32Array(n * 6), col = new Float32Array(n * 6), idx = [];
    for (let k = 0; k < n; k++) {
      const c = colorAt(k / (n - 1));
      for (const j of [0, 1]) { col.set([c.r, c.g, c.b], (k * 2 + j) * 3); nor.set([0, 0, 1], (k * 2 + j) * 3); }
      if (k < n - 1) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(nor, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    geo.setIndex(idx);
    this.mesh = new Mesh(geo, material);
    this.mesh.frustumCulled = false;
  }

  // fn(t, out)：写入中心线上 t 处的点
  set(fn) {
    const { n, c, s, w } = this;
    for (let k = 0; k < n; k++) fn(k / (n - 1), c[k]);
    const pos = this.mesh.geometry.attributes.position;
    for (let k = 0; k < n; k++) {
      const a = c[Math.max(k - 1, 0)], b = c[Math.min(k + 1, n - 1)];
      s[k].set(a.y - b.y, b.x - a.x, 0).normalize();
      if (s[k].y < 0) s[k].negate();
      const h = w[k] / 2;
      pos.setXYZ(k * 2, c[k].x - s[k].x * h, c[k].y - s[k].y * h, c[k].z);
      pos.setXYZ(k * 2 + 1, c[k].x + s[k].x * h, c[k].y + s[k].y * h, c[k].z);
    }
    pos.needsUpdate = true;
  }

  // edge = 1：上沿（猫走的地方）；0：中心线
  at(t, out = new Vector3(), edge = 0) {
    const f = clamp01(t) * (this.n - 1), k = Math.min(Math.floor(f), this.n - 2), r = f - k;
    out.copy(this.c[k]).lerp(this.c[k + 1], r);
    if (edge) out.addScaledVector(this.s[k], edge * lerp(this.w[k], this.w[k + 1], r) / 2);
    return out;
  }

  tangent(t, out = new Vector3()) {
    const f = clamp01(t) * (this.n - 1), k = Math.min(Math.floor(f), this.n - 2);
    return out.subVectors(this.c[k + 1], this.c[k]).normalize();
  }
}

// —— 黑猫 ————————————————————————————————————————————————————
function createCat() {
  const mat = catMaterial();
  const root = new Group();
  const body = new Group(); body.position.y = 0.5; root.add(body);
  const torso = new Mesh(new SphereGeometry(1, 18, 12), mat); body.add(torso);
  const chest = new Mesh(new SphereGeometry(1, 14, 10), mat); chest.scale.set(0.28, 0.25, 0.23); chest.position.set(0.3, 0.05, 0); body.add(chest);
  const head = new Group(); body.add(head);
  head.add(new Mesh(merge([
    [new SphereGeometry(0.23, 16, 12), M(0, 0, 0, 0, 0, 0, 1.05, 0.92, 0.95)],
    [new ConeGeometry(0.085, 0.22, 6), M(0, 0.21, -0.1, -0.25)],
    [new ConeGeometry(0.085, 0.22, 6), M(0, 0.21, 0.1, 0.25)],
    [new SphereGeometry(0.1, 10, 8), M(0.17, -0.06, 0)],
  ]), mat));
  const eyes = new Mesh(merge([[new SphereGeometry(0.038, 8, 6), M(0.17, 0.05, -0.095)], [new SphereGeometry(0.038, 8, 6), M(0.17, 0.05, 0.095)]]), new MeshBasicMaterial({ color: '#e9b949' }));
  head.add(eyes);
  const letter = new Mesh(new PlaneGeometry(0.52, 0.34), new MeshBasicMaterial({ color: '#f2e8d5', side: DoubleSide }));
  letter.position.set(0.3, -0.14, 0.03); letter.rotation.z = -0.25; head.add(letter);

  const legGeo = new CylinderGeometry(0.055, 0.045, 0.42, 6).translate(0, -0.21, 0);
  const legs = [[0.3, -1, 'f'], [0.3, 1, 'f'], [-0.36, -1, 'b'], [-0.36, 1, 'b']].map(([x, z, kind], i) => {
    const g = new Group(); g.position.set(x, -0.08, z * 0.12); g.add(new Mesh(legGeo, mat)); body.add(g);
    return { g, kind, ph: (i % 2) * Math.PI + (kind === 'b' ? Math.PI / 2 : 0) };
  });
  const TAIL = 18;
  const tail = new THREE.InstancedMesh(new SphereGeometry(1, 6, 4), mat, TAIL);
  tail.frustumCulled = false; body.add(tail);
  const tailPos = new Vector3(), tailM = new THREE.Matrix4(), tailQ = new THREE.Quaternion(), tailS = new Vector3();

  // p：walk（走路摆腿幅度）、phase、stretch、sit、curl、headDown、look（转头看向远处）、eyes、carry、breath
  function pose(p) {
    const { walk = 0, phase = 0, stretch = 0, sit = 0, curl = 0, headDown = 0, look = 0, eyes: eo = 0, carry = false, breath = 0 } = p;
    body.position.y = 0.5 - 0.2 * curl - 0.06 * stretch + 0.02 * walk * Math.abs(Math.sin(phase));
    body.rotation.z = -0.32 * stretch + 0.62 * sit * (1 - curl);
    const sc = 1 + breath;
    torso.scale.set(lerp(0.58, 0.42, curl) * sc, lerp(0.27, 0.3, curl) * sc, lerp(0.25, 0.34, curl) * sc);
    head.position.set(lerp(0.52, 0.3, curl), lerp(0.22, 0.02, curl), lerp(0, 0.24, curl));
    head.rotation.set(-look * 0.25, look * 0.8, -0.55 * headDown - 0.15 * stretch - 0.62 * sit * (1 - curl) - 0.35 * curl);
    eyes.visible = eo > 0.5;
    letter.visible = carry;
    for (const L of legs) {
      let a = walk * 0.55 * Math.sin(phase + L.ph);
      if (L.kind === 'f') a += 1.05 * stretch - 0.62 * sit;
      else a += 1.3 * sit;
      L.g.rotation.z = a;
      L.g.scale.set(1, (L.kind === 'b' ? 1 - 0.4 * sit : 1) * (1 - curl), 1);
      L.g.visible = curl < 0.98;
    }
    // 尾巴：走路时翘起轻摆；坐下 / 蜷起时贴地绕到身前
    for (let j = 0; j < TAIL; j++) {
      const a = j / (TAIL - 1);
      const up = new Vector3(-0.55 - 0.5 * a, 0.08 + 0.55 * a * a + 0.07 * Math.sin(phase * 0.5 + a * 3), 0.05 * Math.sin(phase * 0.5 + a * 4));
      const r = lerp(0.42, 0.5, curl), ang = Math.PI + a * 2.4;
      const round = new Vector3(Math.cos(ang) * r - 0.05, -0.3 + 0.12 * curl, Math.sin(ang) * r * 0.9 + 0.05);
      tailPos.copy(up).lerp(round, Math.max(curl, sit * 0.85));
      tail.setMatrixAt(j, tailM.compose(tailPos, tailQ, tailS.setScalar(0.068 - j * 0.0016)));
    }
    tail.instanceMatrix.needsUpdate = true;
  }
  return { root, pose };
}

// —— 布景零件 ————————————————————————————————————————————————————
function archPath(w, ys, ya, y0, P = Path) {
  const p = new P();
  const h = ya - ys;
  p.moveTo(-w, y0); p.lineTo(w, y0); p.lineTo(w, ys);
  p.bezierCurveTo(w, ys + h * 0.55, w * 0.45, ya - h * 0.12, 0, ya);
  p.bezierCurveTo(-w * 0.45, ya - h * 0.12, -w, ys + h * 0.55, -w, ys);
  p.lineTo(-w, y0);
  return p;
}

const ARCH = { w: 3.75, ys: 9.2, ya: 13.8, y0: -2 };

function buildFrame(cx, accent, medallion) {
  const g = new Group();
  const outer = new Shape();
  outer.moveTo(-PANEL / 2, -4); outer.lineTo(PANEL / 2, -4); outer.lineTo(PANEL / 2, 26); outer.lineTo(-PANEL / 2, 26); outer.lineTo(-PANEL / 2, -4);
  outer.holes.push(archPath(ARCH.w, ARCH.ys, ARCH.ya, ARCH.y0));
  const ext = { depth: 0.5, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 2, curveSegments: 24 };
  const wall = new Mesh(new ExtrudeGeometry(outer, ext), new MeshLambertMaterial({ color: '#e6d5ae' }));
  wall.position.set(cx, 0, FRAME_Z);
  // 内圈一道赭金色的宽线脚：大轮廓，不做雕花
  const band = archPath(ARCH.w + 0.32, ARCH.ys, ARCH.ya + 0.4, ARCH.y0, Shape);
  band.holes.push(archPath(ARCH.w, ARCH.ys, ARCH.ya, ARCH.y0));
  const gold = new Mesh(new ExtrudeGeometry(band, { ...ext, depth: 0.2 }), new MeshLambertMaterial({ color: '#c9a55a' }));
  gold.position.set(cx, 0, FRAME_Z + 0.55);
  // 窗台
  const sill = new Mesh(G.box, new MeshLambertMaterial({ color: '#e1cfa5' }));
  sill.scale.set(PANEL, 1.4, 1.5); sill.position.set(cx, 0.7, FRAME_Z + 0.1);
  g.add(wall, gold, sill);
  if (medallion) {
    const ring = new Mesh(new TorusGeometry(1.05, 0.16, 10, 40), new MeshLambertMaterial({ color: '#c9a55a' }));
    const core = new Mesh(new CircleGeometry(0.92, 40), new MeshLambertMaterial({ color: accent }));
    const dot = new Mesh(new SphereGeometry(0.34, 16, 10), new MeshLambertMaterial({ color: '#f2e8d5' }));
    ring.position.set(cx + PANEL / 2, 7.2, FRAME_Z + 0.65); core.position.set(cx + PANEL / 2, 7.2, FRAME_Z + 0.62); dot.position.set(cx + PANEL / 2, 7.2, FRAME_Z + 0.62);
    dot.scale.z = 0.4;
    g.add(ring, core, dot);
  }
  return g;
}

function blossomTree(b, x, z, s, leaf, trunk, r) {
  b.add(G.cyl, trunk, [x, 1.3 * s, z], { scale: [0.28 * s, 2.6 * s, 0.28 * s] });
  for (let k = 0; k < 5; k++) {
    b.add(G.ico, leaf[k % leaf.length], [x + (r() - 0.5) * 2.2 * s, (2.8 + r() * 1.4) * s, z + (r() - 0.5) * 1.2 * s],
      { scale: [(1.0 + r() * 0.6) * s, (0.85 + r() * 0.4) * s, (1.0 + r() * 0.5) * s], rot: [r(), r(), r()], sway: 0.05 * s });
  }
}

function snowPine(b, x, z, s) {
  b.add(G.cyl, '#4a3f3a', [x, 0.5 * s, z], { scale: [0.25 * s, 1 * s, 0.25 * s] });
  for (let k = 0; k < 3; k++) {
    const y = (1.4 + k * 1.1) * s, w = (1.5 - k * 0.38) * s;
    b.add(G.cone, '#33415a', [x, y, z], { scale: [w, 1.6 * s, w], sway: 0.015 * s });
    b.add(G.cone, '#e8ecf2', [x, y + 0.45 * s, z], { scale: [w * 0.72, 0.6 * s, w * 0.72], sway: 0.015 * s });
  }
}

// 垂枝：从窗框上沿垂进画面，全片最近的前景之一
function hangingBranch(b, x0, y0, z, dir, len, stem, blooms, r, sway = 0.06) {
  let x = x0, y = y0;
  for (let k = 0; k < len; k++) {
    const nx = x + dir * (0.32 + r() * 0.2), ny = y - (0.35 + r() * 0.15);
    const mx = (x + nx) / 2, my = (y + ny) / 2, l = Math.hypot(nx - x, ny - y);
    b.add(G.cyl, stem, [mx, my, z], { scale: [0.08, l, 0.08], rot: [0, 0, Math.atan2(nx - x, ny - y) * -1], sway: sway * k / len });
    if (blooms) for (let j = 0; j < 2; j++) {
      b.add(G.ico, blooms[(k + j) % blooms.length], [nx + (r() - 0.5) * 0.5, ny + (r() - 0.5) * 0.4, z + (r() - 0.5) * 0.4],
        { scale: [0.2 + r() * 0.08, 0.2 + r() * 0.08, 0.2], rot: [r(), r(), r()], sway: sway * (k + 1) / len });
    }
    x = nx; y = ny;
  }
}

function ridge(x0, x1, z, base, amp, seed) {
  const r = rng(seed), pos = [];
  let prev = null;
  for (let x = x0; x <= x1; x += 1.6) {
    const h = base + amp * (0.5 + 0.5 * Math.sin(x * 0.13 + seed)) * (0.6 + 0.4 * r());
    if (prev) pos.push(prev[0], 0, z, x, 0, z, x, h, z, prev[0], 0, z, x, h, z, prev[0], prev[1], z);
    prev = [x, h];
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

// 柔边粒子：花瓣 / 光尘 / 落叶 / 雪。位置由 worldTime 直接算出，停摇即静止
function drift(n, { color, size, additive = false }, place) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3));
  const pts = new Points(geo, new PointsMaterial({ color, size, map: radialTexture(), transparent: true, depthWrite: false, blending: additive ? AdditiveBlending : THREE.NormalBlending }));
  pts.frustumCulled = false;
  const seeds = Array.from({ length: n }, (_, i) => { const r = rng(1000 + i * 7919); return [r(), r(), r(), r()]; });
  const out = new Vector3();
  return {
    points: pts,
    update(wt) {
      const p = geo.attributes.position;
      for (let i = 0; i < n; i++) { place(seeds[i], wt, out); p.setXYZ(i, out.x, out.y, out.z); }
      p.needsUpdate = true;
    },
  };
}
const wrap = (v, lo, hi) => lo + (((v - lo) % (hi - lo)) + (hi - lo)) % (hi - lo);

// —— 小生灵 ——————————————————————————————————————————————————
function createSwan() {
  const g = new Group();
  const m = new MeshLambertMaterial({ color: '#f6f1e6' });
  const body = new Mesh(G.sphere, m); body.scale.set(0.6, 0.28, 0.3); g.add(body);
  const neck = new Mesh(new CylinderGeometry(0.06, 0.08, 0.7, 6), m); neck.position.set(0.42, 0.35, 0); neck.rotation.z = -0.25; g.add(neck);
  const head = new Mesh(G.sphere, m); head.scale.set(0.13, 0.1, 0.1); head.position.set(0.52, 0.7, 0); g.add(head);
  const beak = new Mesh(new ConeGeometry(0.04, 0.16, 5), new MeshLambertMaterial({ color: '#d98a4a' })); beak.position.set(0.66, 0.68, 0); beak.rotation.z = -Math.PI / 2; g.add(beak);
  return g;
}

function createFlapper(bodyColor, wingColor, wingShape) {
  const g = new Group();
  const body = new Mesh(G.sphere, new MeshLambertMaterial({ color: bodyColor })); g.add(body);
  const wings = [-1, 1].map((s) => {
    const pivot = new Group(); g.add(pivot);
    const w = new Mesh(wingShape, new MeshLambertMaterial({ color: wingColor, side: DoubleSide })); w.scale.z = s; pivot.add(w);
    return { pivot, s };
  });
  return { g, body, wings, flap(a) { for (const { pivot, s } of wings) pivot.rotation.x = s * a; } };
}

// —— 主体 ——————————————————————————————————————————————————————
export function createMuchaWorld(story, models = new Map()) {
  const T = {};
  for (const [id, sc] of models) if (!id.startsWith('mucha_lady_')) T[id] = propTemplate(sc);
  // 有 Tripo 浮雕人物就用它，没有就用程序化占位
  const ladyFor = (season, opts, fallback) => (models.has(`mucha_lady_${season}`) ? createReliefLady(models.get(`mucha_lady_${season}`), uTime, opts) : fallback());
  const stations = story.stations;
  const N = stations.length;
  const seasons = stations.map((st, i) => SEASONS[st.season] ? st.season : ORDER[i % 4]);
  const scene = new Scene();
  const uTime = { value: 0 };
  const camera = new PerspectiveCamera(36, 10 / 16, 0.5, 160);
  const r = rng(18990101);

  const hemi = new HemisphereLight('#fff', '#888', 1.2);
  const sun = new DirectionalLight('#fff', 1.4); sun.position.set(-6, 14, 12);
  const ambient = new AmbientLight('#ffffff', 0.3);
  scene.add(hemi, sun, ambient);
  scene.fog = new Fog('#eee', 34, 110);

  // 天空、远山、地面：颜色跟着镜头所在的季节过渡
  const sky = new Mesh(new PlaneGeometry(260, 140), new ShaderMaterial({
    uniforms: { top: { value: new Color() }, bottom: { value: new Color() } },
    vertexShader: 'varying float vY; void main(){ vY = (modelMatrix * vec4(position,1.0)).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying float vY;
      void main(){ float t = smoothstep(0.0, 34.0, vY); gl_FragColor = vec4(mix(bottom, top, t), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
    depthWrite: false,
  }));
  sky.position.set(N * PANEL / 2, 30, -80);
  scene.add(sky);

  const X0 = -40, X1 = N * PANEL + 40;
  const ground = new Mesh(new PlaneGeometry(X1 - X0 + 80, 90).rotateX(-Math.PI / 2), new MeshLambertMaterial({ color: '#aaa' }));
  ground.position.set((X0 + X1) / 2, 0, -48);
  scene.add(ground);
  const ridges = [[-30, 4.5, 5, 11], [-42, 6.5, 8, 23], [-56, 9, 10, 37]].map(([z, base, amp, seed]) => {
    const m = new Mesh(ridge(X0, X1, z, base, amp, seed), new MeshBasicMaterial({ color: '#888', side: DoubleSide }));
    scene.add(m);
    return m;
  });
  const terrace = new Mesh(G.box, new MeshLambertMaterial({ color: '#e3d6bd' }));
  terrace.scale.set(X1 - X0, FLOOR, 6.4); terrace.position.set((X0 + X1) / 2, FLOOR / 2, 0.6);
  scene.add(terrace);

  const starGeo = new BufferGeometry();
  const sp = [];
  for (let i = 0; i < 240; i++) sp.push(X0 + r() * (X1 - X0), 10 + r() * 46, -78);
  starGeo.setAttribute('position', new Float32BufferAttribute(sp, 3));
  const stars = new Points(starGeo, new PointsMaterial({ color: '#fffbe8', size: 0.5, map: radialTexture(), transparent: true, opacity: 0, depthWrite: false, fog: false }));
  scene.add(stars);

  const sway = swayMaterial(uTime);
  const M = {
    tree: T.mucha_tree && propMaterial(T.mucha_tree, uTime, { sway: 0.006 }),
    lily: T.mucha_flower_lily && propMaterial(T.mucha_flower_lily, uTime, { sway: 0.05 }),
    daisy: T.mucha_flower_daisy && propMaterial(T.mucha_flower_daisy, uTime, { sway: 0.05 }),
    ornament: T.mucha_ornament && propMaterial(T.mucha_ornament, uTime, { side: DoubleSide }), // 右下角是镜像，要双面
    butterfly: T.mucha_butterfly && propMaterial(T.mucha_butterfly, uTime, { flap: 0.9, side: DoubleSide }),
  };
  // 窗台花：雏菊、百合交替（kinds 里按顺序轮流），落在窗台顶面
  const sillFlowers = (group, cx, kinds) => {
    const lists = kinds.map(() => []);
    for (let k = 0; k < 9; k++) lists[k % kinds.length].push([cx - 4.5 + k * 1.12 + (r() - 0.5) * 0.3, 1.38, FRAME_Z - 0.3 + (r() - 0.5) * 0.3, 1.5 + r() * 0.6, r() * TAU]);
    kinds.forEach((id, j) => group.add(placeProps(T[id], M[id === 'mucha_flower_lily' ? 'lily' : 'daisy'], lists[j])));
  };
  const modelTrees = (group, list) => group.add(placeProps(T.mucha_tree, M.tree, list.map(([x, z, h]) => [x, 0, z, h, r() * TAU])));
  const hairMat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });

  // —— 四扇窗 ——
  const panels = seasons.map((season, i) => {
    const S = SEASONS[season];
    const cx = i * PANEL;
    const group = new Group();
    scene.add(group);
    group.add(buildFrame(cx, S.accent, i < N - 1));
    const b = new Batch();

    // 身后的圆：这一时辰的太阳或月亮
    const disc = new Mesh(new CircleGeometry(S.disc.r, 48), new MeshBasicMaterial({ color: new Color(S.disc.color), fog: false }));
    const glow = new Mesh(new CircleGeometry(S.disc.r * 2.6, 40), new MeshBasicMaterial({ map: radialTexture(), color: S.disc.color, transparent: true, opacity: season === 'noon' ? 0.55 : 0.4, blending: AdditiveBlending, depthWrite: false, fog: false }));
    glow.position.z = -0.1; disc.add(glow);
    disc.position.set(cx + S.disc.x, S.disc.y, S.disc.z);
    group.add(disc);

    let lady, extra = {};
    if (season === 'dawn') {
      lady = models.has('mucha_lady_dawn') ? createReliefLady(models.get('mucha_lady_dawn'), uTime) : createLady('dawn', uTime);
      lady.root.position.set(cx - 0.8, FLOOR, 0);
      if (T.mucha_tree) modelTrees(group, [[cx - 5.2, -9, 6.4], [cx - 2.6, -12, 5.6], [cx + 3.4, -10.5, 7.0], [cx + 6.2, -13, 6.0]]);
      else for (const [x, z, s] of [[-5.2, -9, 1.0], [-2.6, -12, 0.85], [3.4, -10.5, 1.1], [6.2, -13, 0.9]]) blossomTree(b, cx + x, z, s, ['#efc9c9', '#f6e2dc', '#c9d8b0'], '#8c7b66', r);
      const lake = new Mesh(new PlaneGeometry(34, 18).rotateX(-Math.PI / 2), new MeshLambertMaterial({ color: '#a9c6cc' }));
      lake.position.set(cx, 0.05, -27); group.add(lake);
      extra.swans = [createSwan(), createSwan()];
      extra.swans.forEach((s) => { s.scale.setScalar(1.8); group.add(s); });
      hangingBranch(b, cx - 3.4, 13.4, FRAME_Z - 0.4, 1, 7, '#7d6a55', ['#f3d2d2', '#fbeeee'], r);
      hangingBranch(b, cx + 3.4, 13.0, FRAME_Z - 0.4, -1, 5, '#7d6a55', ['#f3d2d2', '#fbeeee'], r);
      if (T.mucha_flower_daisy && T.mucha_flower_lily) sillFlowers(group, cx, ['mucha_flower_daisy', 'mucha_flower_lily']);
      else for (let k = 0; k < 14; k++) {
        const x = cx - 5 + k * 0.75 + r() * 0.3, h = 0.6 + r() * 0.9;
        b.add(G.cyl, '#7f9a64', [x, 1.4 + h / 2, FRAME_Z - 0.2], { scale: [0.06, h, 0.06], sway: 0.02 });
        b.add(G.ico, ['#b9a7d6', '#f4ebc8', '#e3b9b0'][k % 3], [x, 1.45 + h, FRAME_Z - 0.2], { scale: [0.24, 0.2, 0.24], rot: [r(), r(), r()], sway: 0.04 });
      }
      if (T.mucha_butterfly) {
        extra.flyers = placeProps(T.mucha_butterfly, M.butterfly, [[0, -50, 0, 1, 0], [0, -50, 0, 1, 0]]);
        extra.flyers.children.forEach((m) => { m.frustumCulled = false; });
        group.add(extra.flyers);
      }
    } else if (season === 'noon') {
      lady = ladyFor('noon', {}, () => createLady('noon', uTime));
      lady.root.position.set(cx - 0.6, FLOOR, 0);
      if (T.mucha_tree) modelTrees(group, [[cx + 4.2, -7.5, 8.5], [cx - 5.5, -11, 6.2]]);
      else {
        blossomTree(b, cx + 4.2, -7.5, 1.55, ['#8fa77e', '#9daf8c', '#7f9a6c'], '#7a5f45', r);
        blossomTree(b, cx - 5.5, -11, 1.0, ['#8fa77e', '#a3b88f'], '#7a5f45', r);
      }
      // 麦田：顶点起伏，读 worldTime
      b.add(new PlaneGeometry(36, 22, 48, 24).rotateX(-Math.PI / 2), '#d9b96e', [cx, 0.35, -21], { wave: 1 });
      // 高举的手扶着一枝浓绿的枝叶
      const branch = new Batch();
      branch.add(G.cyl, '#6d5a40', [0, -2.3, 0], { scale: [0.06, 1.2, 0.06] });
      for (let k = 0; k < 5; k++) branch.add(G.ico, ['#7f9a6c', '#9daf8c'][k % 2], [(r() - 0.5) * 0.7, -2.4 - k * 0.22, (r() - 0.5) * 0.5], { scale: [0.32, 0.22, 0.28], rot: [r(), r(), r()] });
      lady.arm.R.el.add(branch.build(new MeshLambertMaterial({ vertexColors: true, flatShading: true })));
      hangingBranch(b, cx - 3.5, 13.6, FRAME_Z - 0.4, 1, 6, '#5f6d48', ['#7f9a6c', '#9daf8c', '#6f8a5c'], r, 0.05);
      hangingBranch(b, cx + 3.5, 13.6, FRAME_Z - 0.4, -1, 6, '#5f6d48', ['#7f9a6c', '#9daf8c'], r, 0.05);
      if (T.mucha_flower_lily) sillFlowers(group, cx, ['mucha_flower_lily']);
      else for (let k = 0; k < 14; k++) {
        const x = cx - 5 + k * 0.75 + r() * 0.3, h = 0.7 + r() * 0.9;
        b.add(G.cyl, '#6f8a52', [x, 1.4 + h / 2, FRAME_Z - 0.2], { scale: [0.06, h, 0.06], sway: 0.03 });
        b.add(G.ico, k % 3 === 0 ? '#6f8fc4' : '#c8584a', [x, 1.45 + h, FRAME_Z - 0.2], { scale: [0.26, 0.16, 0.26], rot: [0, r() * 3, 0], sway: 0.05 });
      }
      if (T.mucha_butterfly) {
        extra.flyers = placeProps(T.mucha_butterfly, M.butterfly, [0, 1, 2].map(() => [0, -50, 0, 1, 0]));
        extra.flyers.children.forEach((m) => { m.frustumCulled = false; });
        group.add(extra.flyers);
      } else extra.butterflies = [0, 1, 2].map(() => {
        const f = createFlapper('#5a4a30', '#f3e3a0', new CircleGeometry(0.42, 10).translate(0, 0, 0).rotateX(-Math.PI / 2).translate(0, 0, 0.4));
        f.body.scale.set(0.2, 0.06, 0.06); f.g.scale.setScalar(1.5); group.add(f.g); return f;
      });
    } else if (season === 'dusk') {
      lady = ladyFor('dusk', { height: 8.4 }, () => createLady('dusk', uTime, { seated: true }));
      lady.root.position.set(cx - 1.3, FLOOR, models.has('mucha_lady_dusk') ? -1.4 : -0.3); // 浮雕人物整个退到石栏后面
      // 石栏：她坐在栏后。栏杆柱之间看得见她的裙摆，栏顶就是长发铺开的路
      const stone = new MeshLambertMaterial({ color: '#d9cbb0' });
      const cap = new Mesh(G.box, new MeshLambertMaterial({ color: '#e6dac2' }));
      cap.scale.set(PANEL, 0.3, 0.95); cap.position.set(cx, 2.85, 1.0); group.add(cap);
      const plinth = new Mesh(G.box, stone);
      plinth.scale.set(PANEL, 0.3, 0.9); plinth.position.set(cx, FLOOR + 0.15, 1.0); group.add(plinth);
      const baluster = lathe([[0.001, 0], [0.2, 0], [0.16, 0.25], [0.26, 0.7], [0.14, 1.2], [0.18, 1.4], [0.001, 1.42]], 14);
      for (let k = 0; k < 9; k++) { const m = new Mesh(baluster, stone); m.position.set(cx - 5 + k * 1.25, FLOOR + 0.28, 1.0); group.add(m); }
      for (const [x, z, s, c] of [[-5.5, -9, 1.1, ['#c77b3a', '#d9a25a']], [-2.2, -13, 0.9, ['#b5683a', '#c77b3a']], [3.6, -10, 1.2, ['#a3583a', '#d08a3c']], [6.4, -12.5, 0.9, ['#c77b3a', '#9c5a3c']]]) blossomTree(b, cx + x, z, s, c, '#5a4038', r);
      const lake = new Mesh(new PlaneGeometry(34, 16).rotateX(-Math.PI / 2), new MeshLambertMaterial({ color: '#c99a8e' }));
      lake.position.set(cx, 0.05, -26); group.add(lake);
      hangingBranch(b, cx - 3.4, 13.4, FRAME_Z - 0.4, 1, 5, '#5a4038', ['#a3583a', '#c77b3a'], r);
      hangingBranch(b, cx + 3.4, 13.4, FRAME_Z - 0.4, -1, 6, '#5a4038', ['#c77b3a', '#d9a25a'], r);
      for (let k = 0; k < 16; k++) b.add(G.ico, ['#c77b3a', '#9c5a3c', '#d9a25a'][k % 3], [cx - 5.4 + k * 0.7, 1.45, FRAME_Z - 0.2 + (r() - 0.5) * 0.5], { scale: [0.3, 0.07, 0.22], rot: [0, r() * 3, 0] });
      // 那片落进她掌心的叶子
      extra.leaf = new Mesh(G.ico, new MeshLambertMaterial({ color: '#d9a25a', flatShading: true }));
      extra.leaf.scale.set(0.26, 0.06, 0.18); group.add(extra.leaf);
      extra.geese = Array.from({ length: 7 }, () => {
        const f = createFlapper('#4e3e52', '#4e3e52', new PlaneGeometry(0.9, 0.3).rotateX(-Math.PI / 2).translate(0, 0, 0.45));
        f.body.scale.set(0.4, 0.12, 0.12); f.g.scale.setScalar(1.8); group.add(f.g); return f;
      });
    } else {
      if (models.has('mucha_lady_night')) {
        lady = ladyFor('night', { height: 8.6 }, null);
        lady.root.position.set(cx - 0.9, 2.0, -0.4); // 坐在雪云里，云挡住小腿
      } else {
        lady = createLady('night', uTime);
        lady.root.scale.setScalar(0.74);
        lady.root.rotation.z = Math.PI / 2;               // 侧卧：头朝左
        lady.root.position.set(cx + 4.3, 5.6, -0.2);
      }
      // 雪云：用光滑的大球，避免低多边形在近处像石块
      const cloudMat = new MeshLambertMaterial({ color: '#cfd5e4' });
      for (const [x, y, z, s] of [[-4.2, 3.2, -0.4, 1.6], [-2.4, 3.6, 0.2, 1.9], [-0.2, 3.5, 0.5, 1.8], [2.0, 3.7, 0.0, 1.9], [4.2, 3.3, -0.3, 1.6], [-1.2, 2.6, 1.3, 1.4], [1.2, 2.7, 1.2, 1.5], [3.2, 2.4, 1.0, 1.1], [-3.4, 2.4, 1.0, 1.1], [2.6, 4.0, 0.9, 0.9], [-2.6, 4.0, 0.9, 0.85], [4.6, 4.1, 0.6, 0.8]]) {
        const c = new Mesh(new SphereGeometry(1, 20, 14), cloudMat); c.scale.set(s * 1.2, s * 0.62, s * 0.8); c.position.set(cx + x, y, z); group.add(c);
      }
      for (const [x, z, s] of [[-5.6, -8, 1.1], [-3.2, -12, 0.9], [3.8, -9.5, 1.2], [6.2, -12.5, 1.0], [0.6, -15, 0.8]]) snowPine(b, cx + x, z, s);
      hangingBranch(b, cx - 3.4, 13.4, FRAME_Z - 0.4, 1, 5, '#33415a', ['#e8ecf2', '#33415a'], r, 0.03);
      hangingBranch(b, cx + 3.4, 13.2, FRAME_Z - 0.4, -1, 4, '#33415a', ['#e8ecf2', '#33415a'], r, 0.03);
      for (let k = 0; k < 9; k++) b.add(G.sphere, '#f4f6f8', [cx - 5 + k * 1.25, 1.42, FRAME_Z - 0.1], { scale: [0.9, 0.28, 0.6] });
    }
    group.add(lady.root);
    group.add(b.build(sway));
    if (T.mucha_ornament) group.add(placeProps(T.mucha_ornament, M.ornament, [[cx - 3.85, 1.3, FRAME_Z + 0.2, 2.5, 0.25, false], [cx + 3.85, 1.3, FRAME_Z + 0.2, 2.5, -0.25, true]]));

    // 柔边粒子
    const D = S.drift;
    let place;
    if (season === 'night') place = ([a, c, d, e], wt, o) => o.set(cx + (a - 0.5) * 16 + Math.sin(wt * 0.5 + e * 9) * 0.4, wrap(17 - wt * 0.55 - c * 17, 0, 17), -12 + d * 15.6);
    else if (season === 'noon') place = ([a, c, d, e], wt, o) => o.set(cx + (a - 0.5) * 12 + Math.sin(wt * 0.3 + e * 9) * 0.6, wrap(c * 15 + wt * 0.22, 1, 15), -6 + d * 9);
    else if (season === 'dusk') place = ([a, c, d, e], wt, o) => o.set(cx + (a - 0.5) * 12 + Math.sin(wt * 0.9 + e * 9) * 0.7, wrap(16 - wt * 0.45 - c * 15, 1, 16), -5 + d * 8.8);
    else place = ([a, c, d, e], wt, o) => o.set(cx + wrap((a - 0.5) * 12 + wt * 0.18, -6, 6) + Math.sin(wt * 0.6 + e * 9) * 0.5, wrap(16 - wt * 0.3 - c * 15, 1, 16), -4 + d * 7.8);
    const particles = drift(D.n, { color: D.color, size: D.size, additive: season === 'noon' }, place);
    group.add(particles.points);

    return { season, cx, group, lady, disc, extra, particles, u: 0 };
  });

  // —— 长发 ——
  // 每扇窗一条主发：从左侧窗墙后进来，绕过她的头，从右侧窗墙后出去；相邻两条在窗墙后首尾相接，
  // 所以猫从一位女子的长发走到下一位的长发，接缝永远藏在窗墙后面。第一位的主发从她头上开始。
  const H = (i, x, y, z = 0) => new Vector3(panels[i].cx + x, y, z);
  const PIER_Y = [9.0, 8.4, 7.6];
  const pierOut = (i) => H(i, PANEL / 2, PIER_Y[Math.min(i, PIER_Y.length - 1)]);
  const pierIn = (i) => H(i, -PANEL / 2, PIER_Y[Math.min(i - 1, PIER_Y.length - 1)]);
  const NIGHT_LAND = (i) => H(i, -1.3, 4.35, 1.15); // 猫从长发落到雪云上的点
  const NIGHT_REST = (i) => H(i, 0.15, 4.4, 1.2);  // 猫蜷睡的地方
  const HEAD = 'head';
  // 控制点：HEAD = 发根（每帧取头部位置）。CatmullRom 按段均分参数：第 k 个点在 t = k / (点数 - 1)
  const PATHS = {
    dawnDown: (i) => [HEAD, H(i, -0.1, 7.6, -0.3), H(i, 0.3, 4.6, -0.1), H(i, 0.8, 1.9, 0.2), H(i, 1.05, 1.1, 0.3)],
    dawn: (i) => [HEAD, H(i, 0.5, 7.4, -0.2), H(i, 1.7, 2.75, 0.4), H(i, 3.6, 5.6, 0.2), pierOut(i)],
    noon: (i) => [pierIn(i), H(i, -3.4, 9.8, -0.3), HEAD, H(i, 0.6, 8.6, -0.4), H(i, 1.7, 8.0, 0.4), H(i, 3.6, 8.8, 0.2), pierOut(i)],
    dusk: (i) => [pierIn(i), H(i, -3.6, 8.9, -0.3), HEAD, H(i, -0.4, 4.6, 0.3), H(i, 1.1, 3.1, 1.0), H(i, 3.0, 3.15, 1.0), H(i, 4.8, 5.4, 0.5), pierOut(i)],
    night: (i) => [pierIn(i), H(i, -4.6, 7.6, -0.3), HEAD, H(i, -2.2, 4.9, 1.0), NIGHT_LAND(i)],
    sky: (i) => [HEAD, H(i, -3.6, 8.6, -0.6), H(i, -1.0, 11.2, -0.8), H(i, 2.2, 12.8, -1.0), H(i, 5.6, 15.4, -1.2)],
  };
  const tHead = (pts) => pts.indexOf(HEAD) / (pts.length - 1);

  const ribbons = panels.map((p) => {
    const c = new Color(SEASONS[p.season].hair);
    const main = new Ribbon(110, () => c, (t) => lerp(0.52, 0.38, Math.abs(t - 0.5) * 2) * (t < 0.06 && p.season === 'dawn' ? 0.5 + t * 8 : 1), hairMat);
    const locks = [0, 1].map((j) => new Ribbon(44, (t) => c.clone().multiplyScalar(lerp(0.86 - j * 0.08, 0.7, t)), (t) => lerp(0.42, 0.1, t), hairMat));
    scene.add(main.mesh, ...locks.map((l) => l.mesh));
    let sky = null;
    if (p.season === 'night') {
      const deep = new Color('#2e3352');
      sky = new Ribbon(90, (t) => c.clone().lerp(deep, ease(t)), (t) => lerp(0.7, 0.3, t), hairMat);
      scene.add(sky.mesh);
    }
    return { main, locks, sky, tHead: 0 };
  });
  // 夜之女的长发流进夜空，星星沿发丝明灭
  const hairStars = (() => {
    const n = 16, geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 3), 3));
    const pts = new Points(geo, new PointsMaterial({ size: 0.42, map: radialTexture(), vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false }));
    pts.frustumCulled = false;
    scene.add(pts);
    return { pts, n };
  })();

  const curve = new CatmullRomCurve3([], false, 'centripetal');
  const head = new Vector3(), tmp = new Vector3(), tmp2 = new Vector3();
  const resolve = (pts) => pts.map((q) => (q === HEAD ? head.clone() : q));
  function wave(rb, pts, A, i, wt, fixEnds = true) {
    curve.points = resolve(pts);
    rb.set((t, out) => {
      curve.getPoint(t, out);
      const env = fixEnds ? Math.sin(Math.PI * t) : Math.sin(Math.PI * Math.min(t, 0.5));
      out.y += A * env * Math.sin(t * 11 - wt * 1.5 + i);
      out.z += A * 0.5 * env * Math.cos(t * 8 - wt * 1.1 + i);
    });
  }
  function hairShape(i, lu, wt) {
    const p = panels[i], R = ribbons[i];
    p.lady.anchor.getWorldPosition(head);
    let pts;
    if (p.season === 'dawn') {
      const lift = ease(seg(lu, 0.15, 0.6));
      const up = PATHS.dawn(i);
      pts = PATHS.dawnDown(i).map((d, k) => (d === HEAD ? HEAD : d.lerp(up[k], lift)));
    } else pts = (PATHS[p.season] ?? PATHS.noon)(i);
    R.tHead = tHead(pts);
    const A = { dawn: 0.1 + 0.15 * ease(seg(lu, 0.15, 0.6)), noon: 0.26, dusk: 0.1, night: 0.08 }[p.season] ?? 0.15;
    wave(R.main, pts, A, i, wt);
    if (R.sky) wave(R.sky, PATHS.sky(i), 0.2, i + 2, wt, false);
    // 副发：从发根顺着主发垂下，再自己卷起来
    R.locks.forEach((lock, j) => {
      const len = (0.3 + j * 0.12) * (1 - R.tHead);
      lock.set((t, out) => {
        R.main.at(R.tHead + t * len, out);
        out.y -= (0.4 + 0.3 * j) * Math.sin(Math.PI * t * 0.9);
        out.x += 0.25 * t * Math.sin(t * 7 + wt * 0.9 + j * 2);
        out.y += 0.25 * t * Math.cos(t * 7 + wt * 0.9 + j * 2);
        out.z -= 0.12 + 0.1 * j;
      });
    });
  }

  // —— 黑猫与信 ——
  const cat = createCat();
  cat.root.scale.setScalar(1.05);
  scene.add(cat.root);
  const floorLetter = new Mesh(new PlaneGeometry(0.62, 0.4), new MeshBasicMaterial({ color: '#f2e8d5', side: DoubleSide }));
  floorLetter.rotation.x = -1.1;
  scene.add(floorLetter);
  const letterFrom = new Vector3();
  const letter = buildLetter(story.letter, { from: letterFrom, seal: '#c9a55a', crescent: true });
  scene.add(letter.root, letter.dim);

  function catOnRibbon(i, t, phase) {
    const rb = ribbons[i].main;
    rb.at(t, tmp, 1);
    rb.tangent(t, tmp2);
    return { pos: tmp.clone(), yaw: tmp2.x >= 0 ? 0 : Math.PI, pitch: Math.max(-0.6, Math.min(0.6, Math.atan2(tmp2.y, Math.abs(tmp2.x)))), pose: { walk: 1, phase }, carry: true };
  }

  // 猫的一天：按站内进度分段，见 stories/western/scenes.md。镜头在每站 0.8 → 1 平移，猫此时正走到窗墙后
  function catState(i, lu, s, wt) {
    const phase = s * 46;
    const season = panels[i].season;
    const walkT = (a, b, ua, ub) => catOnRibbon(i, lerp(a, b, seg(lu, ua, ub)), phase);
    if (season === 'dawn') {
      const rest = H(i, 1.7, FLOOR, 1.25);
      floorLetter.position.copy(rest).add(new Vector3(0.62, 0.03, 0.15));
      floorLetter.visible = lu < 0.47;
      if (lu < 0.52) {
        const curl = 1 - ease(seg(lu, 0.2, 0.27));
        return { pos: rest, yaw: 0, pitch: 0, pose: { curl, stretch: Math.sin(Math.PI * seg(lu, 0.27, 0.4)), headDown: Math.sin(Math.PI * seg(lu, 0.4, 0.52)), eyes: lu > 0.22 ? 1 : 0, breath: curl * 0.03 * Math.sin(wt * TAU / 4) }, carry: lu >= 0.47 };
      }
      if (lu < 0.66) {
        const k = ease(seg(lu, 0.52, 0.66));
        const to = ribbons[i].main.at(0.5, new Vector3(), 1);
        return { pos: rest.clone().lerp(to, k).add(new Vector3(0, Math.sin(Math.PI * k) * 1.3, 0)), yaw: 0, pitch: lerp(0.5, -0.2, k), pose: { stretch: 0.4 * Math.sin(Math.PI * k) }, carry: true };
      }
      return lu < 0.8 ? walkT(0.5, 0.75, 0.66, 0.8) : walkT(0.75, 1, 0.8, 1);
    }
    floorLetter.visible = false;
    if (season === 'noon') return lu < 0.8 ? walkT(0, 0.75, 0, 0.8) : walkT(0.75, 1, 0.8, 1);
    if (season === 'dusk') {
      if (lu < 0.42) return walkT(0, 0.62, 0, 0.42);
      if (lu < 0.65) {
        const st = catOnRibbon(i, 0.62, phase);
        const k = Math.sin(Math.PI * seg(lu, 0.42, 0.65));
        st.pitch = 0;
        st.pose = { sit: Math.min(1, k * 1.6), look: Math.min(1, k * 1.6) };
        return st;
      }
      return lu < 0.8 ? walkT(0.62, 0.8, 0.65, 0.8) : walkT(0.8, 1, 0.8, 1);
    }
    // 夜：放下信，转一圈，蜷起来睡
    const land = NIGHT_LAND(i), rest = NIGHT_REST(i);
    if (lu < 0.3) return walkT(0, 1, 0, 0.3);
    if (lu < 0.4) return { pos: land.lerp(rest, seg(lu, 0.3, 0.4)), yaw: 0, pitch: 0, pose: { walk: 1, phase }, carry: true };
    letterFrom.copy(rest).add(new Vector3(0.75, 0.05, 0.25));
    floorLetter.position.copy(letterFrom);
    floorLetter.visible = lu >= 0.48;
    if (lu < 0.55) return { pos: rest, yaw: 0, pitch: 0, pose: { headDown: Math.sin(Math.PI * seg(lu, 0.4, 0.55)) }, carry: lu < 0.48 };
    if (lu < 0.75) {
      const k = ease(seg(lu, 0.55, 0.75));
      return { pos: rest.clone().add(new Vector3(Math.sin(k * TAU) * 0.15, 0, (1 - Math.cos(k * TAU)) * -0.1)), yaw: k * TAU, pitch: 0, pose: { walk: 0.7, phase }, carry: false };
    }
    const curl = ease(seg(lu, 0.75, 0.9));
    return { pos: rest, yaw: 0, pitch: 0, pose: { curl, eyes: lu < 0.85 ? 1 : 0, breath: curl * 0.03 * Math.sin(wt * TAU / 4) }, carry: false };
  }

  // —— 季节过渡 ——
  const envs = seasons.map((s) => {
    const S = SEASONS[s];
    return {
      top: new Color(S.sky[1]), bottom: new Color(S.sky[0]), ground: new Color(S.ground), ridge: new Color(S.ridge), fog: new Color(S.fog),
      hs: new Color(S.hemi[0]), hg: new Color(S.hemi[1]), hi: S.hemi[2], sun: new Color(S.sun[0]), si: S.sun[1], amb: S.ambient, night: S.night,
    };
  });
  const COLOR_KEYS = ['top', 'bottom', 'ground', 'ridge', 'fog', 'hs', 'hg', 'sun'];
  const E = Object.fromEntries(COLOR_KEYS.map((k) => [k, new Color()]));
  function envAt(f) {
    const i = Math.min(Math.floor(f), N - 1), j = Math.min(i + 1, N - 1), t = ease(clamp01(f - i));
    const a = envs[i], b = envs[j];
    for (const k of COLOR_KEYS) E[k].copy(a[k]).lerp(b[k], t);
    E.hi = lerp(a.hi, b.hi, t); E.si = lerp(a.si, b.si, t); E.amb = lerp(a.amb, b.amb, t); E.night = lerp(a.night, b.night, t);
    return E;
  }

  // —— 每帧 ——
  const camOffset = new Vector3();
  const look = new Vector3();
  let current = 0;

  // view：布景工作台用，{ x } 时镜头停在这个横坐标，不跟着故事平移
  function update({ worldTime: wt, progress = 0, letterU, parallax, view = null }) {
    uTime.value = wt;
    const ju = clamp01(progress / TUNING.trainPhaseEnd);
    const s = ju * N;
    const i = Math.min(Math.floor(s), N - 1);
    const lu = s - i;
    current = i;

    // 镜头：每站前 80% 停在这扇窗前，后 20% 沿长发平移到下一扇
    const pan = i < N - 1 ? ease(seg(lu, 0.8, 1)) : 0;
    const camX = view ? view.x : (i + pan) * PANEL;
    const e = envAt(Math.min(Math.max(camX / PANEL, 0), N - 1));
    sky.material.uniforms.top.value.copy(e.top);
    sky.material.uniforms.bottom.value.copy(e.bottom);
    scene.fog.color.copy(e.fog);
    ground.material.color.copy(e.ground);
    ridges.forEach((m, k) => m.material.color.copy(e.ridge).lerp(e.fog, 0.2 + k * 0.25));
    hemi.color.copy(e.hs); hemi.groundColor.copy(e.hg); hemi.intensity = e.hi;
    sun.color.copy(e.sun); sun.intensity = e.si;
    ambient.intensity = e.amb;
    stars.material.opacity = clamp01((e.night - 0.3) / 0.7);

    // 女子：每位只在自己那一站动，之前保持起始姿态、之后保持结束姿态
    panels.forEach((p, k) => {
      const u = clamp01(s - k);
      p.u = u;
      p.group.visible = Math.abs(camX - p.cx) < Math.max(PANEL * 0.98, viewHalf + PANEL / 2); // 停在一扇窗前时只画这一扇；平移时画相邻两扇
      p.lady.root.visible = Math.abs(camX - p.lady.root.position.x) < viewHalf + 3.2; // 女子完全移出画面就不画（浮雕人物是全窗最重的东西）
      const P = POSES[p.season];
      const pose = mixPose(P.a, P.b, P.t(u));
      if (p.season === 'dusk') pose.neck[2] += 0.05 * Math.sin(wt * 0.4);
      p.lady.pose(pose);
      const breath = p.season === 'night' ? 0.022 : 0.008;
      p.lady.spine.scale.set(1 + breath * 0.6 * Math.sin(wt * TAU / 4), 1 + breath * Math.sin(wt * TAU / 4), 1 + breath * Math.sin(wt * TAU / 4));
      p.particles.update(wt);
      if (p.season === 'dusk') {
        p.disc.position.y = lerp(9.8, 4.4, ease(u));
        p.disc.material.color.set('#e6703f').lerp(new Color('#c9403a'), u);
      } else if (p.season === 'dawn') p.disc.position.y = lerp(5.4, 7.2, ease(u));
      const x = p.extra;
      if (x.swans) x.swans.forEach((sw, j) => { sw.position.set(p.cx - 4 + j * 1.6 + wrap(wt * 0.12 + j, 0, 9), 0.12, -21 - j * 2.5); sw.rotation.y = 0; });
      if (x.flyers) {
        // 晨：绕着女子飞；昼：在麦田上方
        const n = p.season === 'dawn' ? 2 : 3;
        for (let j = 0; j < n; j++) {
          const t = wt * (p.season === 'dawn' ? 0.38 : 0.33) + j * 2.4;
          const px = p.season === 'dawn' ? p.cx + 0.4 + Math.sin(t) * 3.1 : p.cx + 1.5 + Math.sin(t) * 3.2;
          const py = p.season === 'dawn' ? 7.2 + j * 1.8 + Math.sin(wt * 0.7 + j) * 0.9 : 3.8 + j * 0.9 + Math.sin(wt * 0.6 + j) * 0.8;
          const pz = p.season === 'dawn' ? 1.6 + 0.7 * Math.cos(t * 0.8) : -5 - j * 1.8;
          const dir = Math.cos(t) >= 0 ? 0 : Math.PI;
          x.flyers.setAt(j, px, py, pz, p.season === 'dawn' ? 0.95 : 1.3, dir + 0.35 * Math.sin(wt * 0.9 + j), false, 0.15 * Math.sin(wt * 1.3 + j));
        }
      }
      if (x.butterflies) x.butterflies.forEach((f, j) => {
        f.g.position.set(p.cx + 1.5 + Math.sin(wt * 0.35 + j * 2.1) * 3.2, 3.8 + j * 0.9 + Math.sin(wt * 0.6 + j) * 0.8, -5 - j * 1.8);
        f.g.rotation.y = Math.cos(wt * 0.35 + j * 2.1) > 0 ? 0.3 : Math.PI - 0.3;
        f.flap(0.2 + 0.9 * Math.abs(Math.sin(wt * 5 + j)));
      });
      if (x.geese) x.geese.forEach((f, j) => {
        const row = Math.ceil(j / 2), side = j % 2 ? 1 : -1;
        f.g.position.set(p.cx + 9 - wrap(wt * 0.5, 0, 22) + row * 1.6, 13 + side * row * 0.9, -24 - row * 0.3);
        f.g.rotation.y = Math.PI;
        f.flap(0.6 * Math.sin(wt * 3.2 + j * 0.5));
      });
      if (x.leaf) {
        // 叶子沿螺旋落下，0.5 时正好落进她摊开的掌心
        const hand = p.lady.arm.R.tip.getWorldPosition(new Vector3()).add(new Vector3(0, 0.15, 0.15));
        const k = seg(u, 0.2, 0.5);
        const from = new Vector3(p.cx + 1.6 + Math.sin(k * 9) * 0.8, lerp(14.5, hand.y, k), 0.6 + Math.cos(k * 9) * 0.5);
        x.leaf.position.copy(from.lerp(hand, ease(seg(k, 0.6, 1))));
        x.leaf.rotation.set(Math.sin(k * 11) * 0.8, k * 6, Math.cos(k * 7) * 0.6);
        x.leaf.visible = u > 0.18;
      }
    });

    for (let k = 0; k < N; k++) hairShape(k, panels[k].u, wt);
    const nightIdx = panels.findIndex((p) => p.season === 'night');
    if (nightIdx >= 0) {
      const pa = hairStars.pts.geometry.attributes.position, co = hairStars.pts.geometry.attributes.color;
      for (let k = 0; k < hairStars.n; k++) {
        const t = 0.18 + 0.8 * k / hairStars.n;
        ribbons[nightIdx].sky.at(t, tmp, (k % 2 ? 1 : -1) * 1.4);
        pa.setXYZ(k, tmp.x, tmp.y, tmp.z + 0.1);
        const tw = 0.55 + 0.45 * Math.sin(wt * 1.3 + k * 2.4);
        co.setXYZ(k, tw, tw * 0.95, tw * 0.8);
      }
      pa.needsUpdate = co.needsUpdate = true;
      hairStars.pts.material.opacity = clamp01((e.night - 0.3) / 0.7);
    }

    const st = catState(i, lu, s, wt);
    cat.root.position.copy(st.pos);
    cat.root.rotation.set(0, st.yaw, st.yaw ? -st.pitch : st.pitch);
    cat.pose({ ...st.pose, carry: st.carry });
    if (letterU > 0) floorLetter.visible = false;

    // 桌面 2D 预览：鼠标位置带一点视差；交织模式由屏幕本身提供
    camOffset.lerp(new Vector3(parallax.x * 1.0, parallax.y * 0.6, 0), 0.08);
    camera.position.set(camX, CAM_Y, CAM_Z).add(camOffset);
    look.set(camX, LOOK_Y, 0);
    camera.lookAt(look);
    camera.updateMatrixWorld();
    letter.update(letterU, camera);
  }

  // halfW：焦平面上要完整入画的半宽。盒子里是一扇窗（HALF_W）；工作台可以一次看两三扇
  let viewHalf = HALF_W;
  function setAspect(aspect, halfW = HALF_W) {
    viewHalf = halfW;
    const D = Math.hypot(CAM_Z, LOOK_Y - CAM_Y);
    const vfov = 2 * Math.atan(halfW / aspect / D) * 180 / Math.PI;
    camera.aspect = aspect;
    camera.fov = Math.min(Math.max(vfov, 12), halfW > HALF_W ? 85 : 52); // 盒子里上限 52°；工作台看多扇窗时放宽
    camera.updateProjectionMatrix();
  }

  return {
    scene, camera, update, setAspect, reset() {},
    hasTrain: false,
    journeyLength: (N - 1) * PANEL,
    panelX: (i) => i * PANEL, panelWidth: PANEL,
    stationAt: () => stations[current],
  };
}

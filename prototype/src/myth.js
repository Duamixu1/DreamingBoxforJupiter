// 幻境层：连续地形、远山、浮空仙山、云海过渡，以及《山海经》/ 希腊神话灵感的灵兽。
// 原则同 scene.js：所有动作只读 worldTime（停摇即静止）；每样东西尽量合成一个网格，9 视点也扛得住。
// 灵兽都是程序化占位，造型取「优雅、修长、少而精」：青鸟、鲲、独角白鹿、天灯。
import { THREE } from './three.js';
import { G, Batch, clamp01, seg, ease, lerp, radialTexture } from './kit.js';

const {
  BufferGeometry, BufferAttribute, Float32BufferAttribute, Color, Vector2, Vector3, Mesh, Group, Points,
  PointsMaterial, MeshLambertMaterial, MeshBasicMaterial, InstancedMesh, Object3D, Shape, ShapeGeometry,
  LatheGeometry, CylinderGeometry, ConeGeometry, PlaneGeometry, CanvasTexture, SRGBColorSpace, RepeatWrapping,
  AdditiveBlending, DoubleSide, Sprite, SpriteMaterial,
} = THREE;

const smooth = (e0, e1, x) => ease(clamp01((x - e0) / (e1 - e0)));

// 一维平滑噪声：远山轮廓用
function noise1(seed) {
  const h = (i) => { const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return s - Math.floor(s); };
  return (x) => { const i = Math.floor(x), f = x - i; return lerp(h(i), h(i + 1), ease(f)); };
}

// 每个 x 上各站的权重：站附近保持本站，两站中段平滑过渡（与天色过渡同一节奏）
export function biomeBlend(stations, S, x) {
  const n = stations.length;
  const u = x / S;
  const i = Math.min(Math.max(Math.floor(u), 0), n - 1);
  if (u <= 0 || i >= n - 1) return [[Math.min(Math.max(Math.round(u), 0), n - 1), 1]];
  const t = ease(clamp01((u - i - 0.35) / 0.3));
  return [[i, 1 - t], [i + 1, t]];
}

// —— 连续地面：顶点色按地貌渐变，取代原来各站一块块硬边的沙地 / 雪地 ——
export function buildTerrain(stations, S, x0, x1, colors) {
  const W = x1 - x0, D = 46;
  const geo = new PlaneGeometry(W, D, Math.ceil(W / 1.5), 23).rotateX(-Math.PI / 2).translate(x0 + W / 2, 0.01, 0);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const pal = stations.map((st) => new Color(colors[st.biome] ?? colors.countryside));
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    c.setRGB(0, 0, 0);
    for (const [k, w] of biomeBlend(stations, S, x)) c.r += pal[k].r * w, c.g += pal[k].g * w, c.b += pal[k].b * w;
    // 细微明暗斑块，地面不再是一张纯色纸
    const v = 0.94 + 0.08 * (Math.sin(x * 0.7 + z * 1.3) * 0.5 + Math.sin(x * 0.23 - z * 0.41) * 0.5);
    col[i * 3] = c.r * v; col[i * 3 + 1] = c.g * v; col[i * 3 + 2] = c.b * v;
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return new Mesh(geo, new MeshLambertMaterial({ vertexColors: true }));
}

// —— 远山：三层水墨式山脊，越远越淡；山野段高耸带雪，海边段压低成海上远岛 ——
export function buildRidges(stations, S, x0, x1) {
  const layers = [
    { z: -30, base: 2.2, amp: 6.5, color: '#6f8f86', seed: 1 },
    { z: -39, base: 3.0, amp: 8.5, color: '#8aa3a6', seed: 2 },
    { z: -49, base: 4.0, amp: 11, color: '#a6b6c6', seed: 3 },
  ];
  const tall = { mountain: 1.5, snow: 1.6, seaside: 0.15, city: 0.7, countryside: 0.8, forest: 1.0 };
  const pos = [], col = [], idx = [];
  const snow = new Color('#f4f6fa');
  for (const L of layers) {
    const n1 = noise1(L.seed), n2 = noise1(L.seed + 9);
    const base = new Color(L.color);
    const start = pos.length / 3;
    let cols = 0;
    for (let x = x0; x <= x1; x += 0.8, cols++) {
      let k = 0, snowy = 0;
      for (const [i, w] of biomeBlend(stations, S, x)) {
        k += (tall[stations[i].biome] ?? 1) * w;
        snowy += (['mountain', 'snow'].includes(stations[i].biome) ? 1 : 0) * w;
      }
      const ridge = 1 - Math.abs(2 * n1(x * 0.07) - 1);        // 尖峰
      const h = (L.base + L.amp * (0.55 * ridge * ridge + 0.45 * n2(x * 0.19))) * k;
      const top = new Color().copy(base).lerp(snow, snowy * smooth(5, 9, h));
      for (const [y, c] of [[-3, base], [h * 0.7, base], [h, top]]) { pos.push(x, y, L.z); col.push(c.r, c.g, c.b); }
    }
    for (let i = 0; i < cols - 1; i++) for (let j = 0; j < 2; j++) {
      const a = start + i * 3 + j, b = a + 3;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return new Mesh(geo, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

// —— 浮空仙山：倒悬岩岛、松与小亭、垂下的瀑布；整体缓缓起伏 ——
function fallTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * 32, w = 1 + Math.random() * 3;
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.3, 'rgba(255,255,255,.9)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(x, Math.random() * 64, w, 64 + Math.random() * 64);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace; t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export function buildIslands(r, x0, x1) {
  const b = new Batch(), falls = new Batch(), mist = new Batch();
  const rock = ['#8d8a96', '#7d7a88'], grass = '#8fc07a', pine = '#3f7a5f';
  let k = 0;
  for (let x = x0 + 6; x < x1; x += 17 + r() * 9, k++) {
    const R = 1.1 + r() * 1.3, y = 8 + r() * 3.2, z = -20 - r() * 8;
    b.add(G.cyl, grass, [x, y, z], { scale: [R * 2, 0.32, R * 1.6] });
    b.add(new ConeGeometry(1, 1, 7), rock[0], [x, y - R * 0.95, z], { rot: [Math.PI, r(), 0], scale: [R, R * 1.9, R * 0.8] });
    b.add(new ConeGeometry(1, 1, 6), rock[1], [x + R * 0.45, y - R * 0.6, z + 0.2], { rot: [Math.PI, r(), 0.2], scale: [R * 0.45, R * 1.3, R * 0.4] });
    for (let t = 0; t < 3; t++) {
      const tx = x + (r() - 0.5) * R * 1.3, tz = z + (r() - 0.5) * R * 0.8, s = 0.45 + r() * 0.35;
      b.add(G.cone, pine, [tx, y + 0.16 + s * 0.6, tz], { scale: [s * 0.45, s * 1.2, s * 0.45] });
    }
    if (k % 2 === 0) {
      // 小亭：朱柱、黛瓦、金顶
      const px = x - R * 0.3, py = y + 0.16;
      for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) b.add(G.cyl, '#b0443a', [px + dx, py + 0.35, z + dz], { scale: [0.07, 0.7, 0.07] });
      b.add(G.pyramid, '#35505a', [px, py + 0.85, z], { scale: [0.75, 0.34, 0.75] });
      b.add(G.pyramid, '#35505a', [px, py + 1.12, z], { scale: [0.45, 0.3, 0.45] });
      b.add(G.sphere, '#e2b65a', [px, py + 1.3, z], { scale: [0.06, 0.08, 0.06] });
    }
    // 瀑布从岛沿垂下，底部化作水雾
    const fx = x + R * 0.7, len = 3 + R * 1.6;
    falls.add(new PlaneGeometry(0.35 + R * 0.15, len), '#ffffff', [fx, y - len / 2 + 0.1, z + R * 0.75]);
    mist.add(G.halo, '#ffffff', [fx, y - len + 0.2, z + R * 0.8], { scale: [0.9, 0.6, 1] });
  }
  const mesh = b.build(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  const tex = fallTexture();
  tex.repeat.set(1, 2);
  const fallMat = new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.75, depthWrite: false, vertexColors: true });
  mesh.add(falls.build(fallMat));
  const mistMat = new MeshBasicMaterial({ map: radialTexture(), transparent: true, opacity: 0.6, depthWrite: false, vertexColors: true });
  mesh.add(mist.build(mistMat));
  return {
    mesh,
    update(wt, night) {
      mesh.position.y = Math.sin(wt * 0.35) * 0.25;
      tex.offset.y = wt * 0.45;
      fallMat.opacity = 0.75 - night * 0.35;
      mesh.material.color.setScalar(1 - night * 0.35);
    },
  };
}

// —— 云海：两站之间一道低云带，火车「穿云」进入下一处风景，遮住地貌交接 ——
// 用柔边粒子而不是多面体：多面体在近处读成白色石块
export function buildMist(r, mids) {
  const back = [], front = [];
  for (const mx of mids) {
    for (let i = 0; i < 22; i++) back.push(mx + (r() - 0.5) * 10, 0.5 + r() * 2, -3 - r() * 15);
    for (let i = 0; i < 6; i++) front.push(mx + (r() - 0.5) * 8, 0.2 + r() * 0.4, 3.5 + r() * 4);
  }
  const tex = radialTexture();
  const make = (pts, size, opacity) => {
    const m = new Points(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pts, 3)),
      new PointsMaterial({ map: tex, color: '#ffffff', size, transparent: true, opacity, depthWrite: false }));
    return m;
  };
  const mesh = new Group();
  const far = make(back, 5.5, 0.42), near = make(front, 3, 0.28);
  mesh.add(far, near);
  return { mesh, update(night) { for (const m of [far, near]) m.material.color.setScalar(1 - night * 0.6); } };
}

// —— 青鸟：西王母的信使。全程伴着火车飞，终点衔来那封信 ——
function wingGeometry(root, tip) {
  const s = new Shape();
  s.moveTo(0.18, 0);
  s.quadraticCurveTo(0.42, 0.75, 0.12, 1.45);
  s.lineTo(-0.02, 1.32); s.lineTo(-0.12, 1.12); s.lineTo(-0.2, 0.9); s.lineTo(-0.28, 0.66);
  s.lineTo(-0.34, 0.4); s.lineTo(-0.38, 0.14); s.lineTo(-0.36, 0);
  const g = new ShapeGeometry(s, 6);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), c = new Color();
  for (let i = 0; i < p.count; i++) {
    c.copy(root).lerp(tip, smooth(0.2, 1.45, p.getY(i)));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

export function createQingniao() {
  const bird = new Group();
  const body = new Batch();
  const teal = '#2c8c99', belly = '#a9ddd4', gold = '#e8c063';
  body.add(G.sphere, teal, [0, 0, 0], { scale: [0.55, 0.2, 0.22] });
  body.add(G.sphere, belly, [0.08, -0.06, 0], { scale: [0.42, 0.13, 0.17] });
  body.add(G.sphere, teal, [0.5, 0.13, 0], { scale: [0.17, 0.15, 0.14] });
  body.add(G.cone, gold, [0.7, 0.11, 0], { rot: [0, 0, -Math.PI / 2], scale: [0.05, 0.2, 0.05] });
  for (const z of [0.1, -0.1]) body.add(G.sphere, '#1b2330', [0.6, 0.17, z], { scale: [0.025, 0.025, 0.025] });
  for (let i = 0; i < 3; i++) body.add(G.cone, gold, [0.42 - i * 0.07, 0.32 + i * 0.02, 0], { rot: [0, 0, 0.9 + i * 0.25], scale: [0.025, 0.32 - i * 0.05, 0.025] });
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide });
  bird.add(body.build(mat));

  const wg = wingGeometry(new Color(teal), new Color('#e6f4ef'));
  const wingL = new Mesh(wg.clone().rotateX(Math.PI / 2), mat);
  const wingR = new Mesh(wg.rotateX(-Math.PI / 2), mat);
  wingL.position.set(0.05, 0.08, 0.1); wingR.position.set(0.05, 0.08, -0.1);
  bird.add(wingL, wingR);

  // 三条尾羽：竖向飘带，越往后越细、由青转金
  const RIB = 3, N = 26, LEN = 2.6;
  const tailPos = new Float32Array(RIB * N * 2 * 3), tailCol = new Float32Array(RIB * N * 2 * 3), tailIdx = [];
  const c0 = new Color(teal), c1 = new Color(gold), c = new Color();
  for (let k = 0; k < RIB; k++) for (let i = 0; i < N; i++) {
    c.copy(c0).lerp(c1, smooth(0.3, 1, i / (N - 1)));
    for (let j = 0; j < 2; j++) tailCol.set([c.r, c.g, c.b], ((k * N + i) * 2 + j) * 3);
    if (i < N - 1) { const a = (k * N + i) * 2; tailIdx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1); }
  }
  const tailGeo = new BufferGeometry();
  tailGeo.setAttribute('position', new BufferAttribute(tailPos, 3));
  tailGeo.setAttribute('color', new BufferAttribute(tailCol, 3));
  tailGeo.setIndex(tailIdx);
  const tail = new Mesh(tailGeo, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.92 }));
  tail.frustumCulled = false;
  bird.add(tail);
  const tipMat = new MeshBasicMaterial({ color: new Color('#ffd98a').multiplyScalar(1.4) });
  const tips = Array.from({ length: RIB }, () => { const m = new Mesh(G.sphere, tipMat); m.scale.setScalar(0.06); bird.add(m); return m; });

  bird.scale.setScalar(1.05);
  const home = new Vector3(0.6, 4.7, 1.2), p = new Vector3(), prev = new Vector3();

  function update(wt, letterU, envelope) {
    // 伴飞：在火车上方缓慢画 8 字
    p.set(home.x + Math.sin(wt * 0.31) * 2.4, home.y + Math.sin(wt * 0.53) * 0.55, home.z + Math.sin(wt * 0.23) * 1.3);
    // 终点：俯身衔起信封，信纸展开时振翅离去
    const carry = ease(seg(letterU, 0, 0.12)) * (1 - ease(seg(letterU, 0.38, 0.6)));
    const leave = ease(seg(letterU, 0.38, 0.85));
    if (envelope && letterU > 0) p.lerp(envelope.clone().add(new Vector3(0, 0.55, 0)), carry);
    p.add(new Vector3(-5 * leave, 7 * leave, -6 * leave));
    const vy = p.y - prev.y;
    prev.copy(p);
    bird.position.copy(p);
    bird.rotation.set(Math.sin(wt * 0.23) * 0.15 - 0.25, -0.45, Math.max(-0.4, Math.min(0.4, vy * 6)) + 0.08, 'YXZ');
    bird.visible = leave < 1;

    const flap = 0.15 + 0.6 * Math.sin(wt * (carry > 0.5 ? 7 : 4.6));
    wingL.rotation.x = -flap; wingR.rotation.x = flap;

    for (let k = 0; k < RIB; k++) {
      const spread = (k - 1) * 0.13;
      for (let i = 0; i < N; i++) {
        const s = i / (N - 1);
        const x = -0.45 - s * LEN;
        const y = -0.05 + Math.sin(wt * 3 - s * 4 + k) * 0.25 * s - s * s * 0.25;
        const z = spread * (0.4 + s * 2) + Math.sin(wt * 2.2 - s * 3 + k * 2) * 0.18 * s;
        const w = lerp(0.1, 0.025, s);
        tailPos.set([x, y + w, z, x, y - w, z], (k * N + i) * 6);
        if (i === N - 1) tips[k].position.set(x, y, z);
      }
    }
    tailGeo.attributes.position.needsUpdate = true;
  }
  return { group: bird, update };
}

// —— 鲲：「北冥有鱼」。海边黄昏，一头云中巨鲲与火车同向缓游，鳍如垂天之翼 ——
export function createKun() {
  const L = 9, R = 1.15;
  const prof = [];
  for (let i = 0; i <= 22; i++) {
    const s = i / 22;                                   // 0 尾 → 1 头
    const r = R * Math.pow(Math.sin(Math.PI * Math.pow(s * 0.985, 0.72)), 0.85) + 0.02;
    prof.push(new Vector2(r, -L / 2 + s * L));
  }
  const geo = new LatheGeometry(prof, 18).rotateZ(-Math.PI / 2);   // 长轴转到 +x，头朝 +x
  geo.scale(1, 0.85, 0.9);
  const p = geo.attributes.position, col = new Float32Array(p.count * 3);
  const back = new Color('#33507e'), mid = new Color('#6f93bd'), belly = new Color('#e6edf3'), c = new Color();
  for (let i = 0; i < p.count; i++) {
    const t = clamp01(p.getY(i) / R * 0.5 + 0.5);
    c.copy(belly).lerp(mid, smooth(0.2, 0.5, t)).lerp(back, smooth(0.55, 0.85, t));
    // 背上一行浅色斑点
    if (t > 0.8 && Math.sin(p.getX(i) * 3.1) > 0.75) c.lerp(belly, 0.5);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));

  const uTime = { value: 0 };
  const swim = (x, t) => 0.32 * Math.sin(t * 1.0 - x * 0.5) * clamp01((0.3 * L - x) / (0.8 * L));
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed.y += 0.32 * sin(uTime * 1.0 - position.x * 0.5) * clamp((${(0.3 * L).toFixed(2)} - position.x) / ${(0.8 * L).toFixed(2)}, 0.0, 1.0);`);
  };
  mat.customProgramCacheKey = () => 'kun-swim';

  const kun = new Group();
  kun.add(new Mesh(geo, mat));
  const plain = new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide });
  // 胸鳍：修长如翼
  const fin = wingGeometry(new Color('#4d6f9c'), new Color('#dfe8f2')).scale(1.6, 2.6, 1);
  const finL = new Mesh(fin.clone().rotateX(Math.PI / 2), plain), finR = new Mesh(fin.rotateX(-Math.PI / 2), plain);
  finL.position.set(1.4, -0.35, 0.7); finR.position.set(1.4, -0.35, -0.7);
  kun.add(finL, finR);
  // 尾鳍：左右两瓣，上下摆
  const fs = new Shape();
  fs.moveTo(0, 0); fs.quadraticCurveTo(-0.6, 0.5, -1.3, 1.5); fs.quadraticCurveTo(-0.7, 0.4, -0.55, 0);
  fs.quadraticCurveTo(-0.7, -0.4, -1.3, -1.5); fs.quadraticCurveTo(-0.6, -0.5, 0, 0);
  const flukeGeo = new ShapeGeometry(fs, 6).rotateX(Math.PI / 2);
  flukeGeo.setAttribute('color', new BufferAttribute(new Float32Array(flukeGeo.attributes.position.count * 3).map((_, i) => [0.24, 0.36, 0.55][i % 3]), 3));
  const fluke = new Mesh(flukeGeo, plain);
  kun.add(fluke);
  for (const z of [0.62, -0.62]) {
    const eye = new Mesh(G.sphere, new MeshBasicMaterial({ color: '#10182a' }));
    eye.scale.setScalar(0.07); eye.position.set(3.25, 0.05, z * 0.95); kun.add(eye);
  }
  // 身周的星点：入夜后亮起
  const sp = [];
  for (let i = 0; i < 40; i++) sp.push(-L / 2 + Math.random() * L, (Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.4);
  const dustMat = new PointsMaterial({ map: radialTexture(), color: '#bfe3ff', size: 0.35, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
  const dust = new Points(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(sp, 3)), dustMat);
  kun.add(dust);

  function update(wt, screenX, night) {
    uTime.value = wt;
    kun.visible = Math.abs(screenX) < 22;
    if (!kun.visible) return;
    kun.position.set(screenX, 10.4 + Math.sin(wt * 0.4) * 0.45, -19.5);
    kun.rotation.z = Math.sin(wt * 0.4 + 1.2) * 0.05;
    kun.rotation.y = -0.18;
    const tx = -L / 2 + 0.05, h = swim(tx, wt), dh = swim(tx + 0.3, wt) - h;
    fluke.position.set(tx, h, 0);
    fluke.rotation.z = -dh * 4;
    const f = Math.sin(wt * 0.9) * 0.28 + 0.1;
    finL.rotation.x = -f; finR.rotation.x = f;
    dustMat.opacity = 0.15 + night * 0.75;
  }
  return { group: kun, update };
}

// —— 独角白鹿：山巅之上，角带微光；低头、抬首，像在等火车经过 ——
export function createUnicorn() {
  const deer = new Group();
  const body = new Batch(), head = new Batch();
  const white = '#f4f1ea', shade = '#dcdde6', hoof = '#c9ab72', mane = '#dfe7f6';
  body.add(G.sphere, white, [0, 1.12, 0], { scale: [0.7, 0.34, 0.3] });
  body.add(G.sphere, white, [0.45, 1.18, 0], { scale: [0.38, 0.36, 0.29] });
  body.add(G.sphere, shade, [-0.45, 1.1, 0], { scale: [0.36, 0.32, 0.28] });
  body.add(new CylinderGeometry(0.12, 0.2, 0.8, 8), white, [0.72, 1.62, 0], { rot: [0, 0, -0.55] });
  for (const [x, z] of [[0.48, 0.13], [0.48, -0.13], [-0.5, 0.13], [-0.5, -0.13]]) {
    body.add(new CylinderGeometry(0.06, 0.045, 0.86, 6), z > 0 ? white : shade, [x, 0.5, z]);
    body.add(G.cyl, hoof, [x, 0.06, z], { scale: [0.11, 0.1, 0.11] });
  }
  for (let i = 0; i < 6; i++) body.add(G.ico, mane, [0.6 + i * 0.07, 1.5 + i * 0.1, 0], { scale: [0.1, 0.13, 0.06], rot: [0, 0, -0.6] });
  for (let i = 0; i < 4; i++) body.add(G.ico, mane, [-0.75 - i * 0.12, 1.05 - i * 0.14, 0], { scale: [0.14 - i * 0.02, 0.1, 0.07], rot: [0, 0, 0.8] });
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  deer.add(body.build(mat));

  const headPivot = new Group();
  headPivot.position.set(0.92, 1.95, 0);
  head.add(G.sphere, white, [0.12, 0.02, 0], { scale: [0.26, 0.16, 0.15] });
  head.add(G.sphere, white, [0.34, -0.06, 0], { scale: [0.15, 0.1, 0.1] });
  for (const z of [0.09, -0.09]) {
    head.add(G.cone, white, [0.02, 0.2, z], { rot: [z * 3, 0, 0.5], scale: [0.04, 0.16, 0.03] });
    head.add(G.sphere, '#1b2330', [0.24, 0.05, z * 1.35], { scale: [0.025, 0.025, 0.025] });
  }
  headPivot.add(head.build(mat));
  const hornMat = new MeshBasicMaterial({ color: new Color('#ffe2a0').multiplyScalar(1.3) });
  const horn = new Mesh(new ConeGeometry(0.04, 0.55, 8), hornMat);
  horn.position.set(0.2, 0.36, 0); horn.rotation.z = -0.55;
  headPivot.add(horn);
  const glow = new Sprite(new SpriteMaterial({ map: radialTexture(), color: '#ffe7b0', transparent: true, blending: AdditiveBlending, depthWrite: false }));
  glow.position.set(0.3, 0.55, 0); glow.scale.setScalar(1.1);
  headPivot.add(glow);
  deer.add(headPivot);

  // 岩台
  const rock = new Batch();
  rock.add(G.ico, '#9c98a6', [0, -0.25, 0], { scale: [1.5, 0.55, 0.9], rot: [0.2, 0.5, 0] });
  rock.add(G.ico, '#8a8796', [0.9, -0.35, 0.3], { scale: [0.7, 0.4, 0.6], rot: [0.5, 0.1, 0.3] });
  deer.add(rock.build(new MeshLambertMaterial({ vertexColors: true, flatShading: true })));

  return {
    group: deer,
    update(wt, night) {
      headPivot.rotation.z = -0.15 + 0.35 * (0.5 + 0.5 * Math.sin(wt * 0.45)) - 0.35;
      glow.material.opacity = 0.5 + night * 0.5 + 0.15 * Math.sin(wt * 2);
    },
  };
}

// —— 天灯：夜城里一盏盏升起，越飞越远 ——
export function createLanterns(cx, r, count = 38) {
  const group = new Group();
  const items = Array.from({ length: count }, () => ({
    x: cx + (r() - 0.5) * 30, z: -15 + r() * 19, y0: r() * 13, sp: 0.25 + r() * 0.2, ph: r() * 6.28,
  }));
  const mat = new MeshBasicMaterial({ color: new Color('#ffb257').multiplyScalar(1.25) });
  const mesh = new InstancedMesh(new CylinderGeometry(0.17, 0.12, 0.32, 8), mat, count);
  const halo = new Points(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(new Float32Array(count * 3), 3)),
    new PointsMaterial({ map: radialTexture(), color: '#ffc27a', size: 1.1, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false }));
  halo.frustumCulled = false;
  group.add(mesh, halo);
  const tmp = new Object3D();
  return {
    group,
    update(wt, night) {
      const hp = halo.geometry.attributes.position;
      items.forEach((it, i) => {
        const y = 0.6 + ((it.y0 + wt * it.sp) % 13);
        const x = it.x + Math.sin(wt * 0.4 + it.ph) * 0.4;
        tmp.position.set(x, y, it.z);
        tmp.rotation.set(0, 0, Math.sin(wt * 0.7 + it.ph) * 0.08);
        tmp.scale.setScalar(Math.min(1, (13.6 - y) / 2.5, (y - 0.4) / 0.6));
        tmp.updateMatrix(); mesh.setMatrixAt(i, tmp.matrix);
        hp.setXYZ(i, x, y, it.z);
      });
      mesh.instanceMatrix.needsUpdate = true;
      hp.needsUpdate = true;
      halo.material.opacity = 0.25 + night * 0.65;
    },
  };
}

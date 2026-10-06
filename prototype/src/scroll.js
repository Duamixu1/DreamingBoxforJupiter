// 通用长卷渲染器：读一份 world.json，把它变成盒子里横向展开的音乐长卷。
// 竖屏（10:16）像一扇窗，随摇柄沿长卷向右平移：每站前 80% 停在窗前，后 20% 平移到下一站；
// 最右端是纪念品，旅程结束后继续摇，纪念品升起、转身，下面浮出一句话。
// 一切动作只读 worldTime 和旅程进度：停摇即静止。和 mucha.js 一样对外提供 scene / camera / update / setAspect。
//
// world.json（见 prototype/worlds/README.md）：
//   stations[i].layers[]：
//     { kind: 'gradient', top, bottom, depth }                 整站底色
//     { kind: 'card', src, x, y, w, h, depth }                 图片贴片（站内像素坐标：宽 1200、高 1920）
//     { kind: 'model', src, x, y, h, depth, anim }             GLB：底边中心在 (x, y)，高 h 像素
//   frame：每站最前面的装饰框（图片，等高放在站中间）；souvenir：{ model, text }；music：{ id }
import { THREE, GLBLoader } from './three.js';
import { TUNING } from './config.js';
import { clamp01, seg, ease, lerp, radialTexture } from './kit.js';

const { Vector3, Color, Group, Mesh, PlaneGeometry, MeshBasicMaterial, ShaderMaterial,
  HemisphereLight, DirectionalLight, AmbientLight, PerspectiveCamera, Scene, TextureLoader, SRGBColorSpace,
  CanvasTexture, Box3, DoubleSide, AdditiveBlending } = THREE;

export const STATION_PX = [1200, 1920];          // 一站 = 相框一屏
const HALF_W = 5.3;                               // 焦平面半宽（场景单位）
const PX = (2 * HALF_W) / STATION_PX[0];          // 1 像素 = 多少场景单位
const PANEL = 2 * HALF_W;                         // 站间距 = 一屏宽，长卷无缝相接
const CAM_Z = 26;
const LOOK_Y = 0;

const resolve = (src, base) => (/^(https?:|\/|assets\/|worlds\/)/.test(src) ? new URL(src, new URL('/', base)).href : new URL(src, base).href);

export async function createScrollWorld(world, baseUrl, renderer) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(36, 10 / 16, 0.3, 400);
  const stations = world.stations ?? [];
  const N = stations.length;
  const panels = N + 1;                           // 最后一屏是纪念品
  const texLoader = new TextureLoader();
  const glb = new GLBLoader(renderer, { dracoDecoderPath: '/vendor/jupiter-sdk/decoders/draco/', ktx2TranscoderPath: '/vendor/jupiter-sdk/decoders/basis/' });
  const loadTex = (src) => new Promise((ok) => texLoader.load(resolve(src, baseUrl), (t) => { t.colorSpace = SRGBColorSpace; t.anisotropy = 4; ok(t); }, undefined, () => ok(null)));
  const loadGlb = async (src) => { try { return (await glb.load(resolve(src, baseUrl))).scene; } catch (e) { console.warn('[长卷] 模型载入失败', src, e); return null; } };

  scene.add(new HemisphereLight('#fff6ea', '#8a7a64', 1.5));
  const sun = new DirectionalLight('#ffffff', 1.3); sun.position.set(-4, 8, 10); scene.add(sun);
  scene.add(new AmbientLight('#ffffff', 0.3));
  scene.background = new Color(world.wall ?? '#e9dcc4');

  // 站内像素 → 场景坐标。深度为 d 的东西做透视补偿：镜头停在这一站中央时，它在屏上的位置和大小正好是设计稿上的样子
  const place = (cx, x, y, d) => {
    const s = (CAM_Z - d) / CAM_Z;
    return [cx + (x - STATION_PX[0] / 2) * PX * s, (STATION_PX[1] / 2 - y) * PX * s, s];
  };

  const animated = [];   // { obj, anim, base }
  const cardFor = (tex, w, h) => new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: DoubleSide }));

  async function buildLayer(L, cx, order) { // eslint-disable-line no-param-reassign
    const d = L.depth ?? 0;
    if (L.kind === 'gradient') {
      const [x, y, s] = place(cx, STATION_PX[0] / 2, STATION_PX[1] / 2, d);
      const m = new Mesh(new PlaneGeometry(PANEL * s * 2.0, STATION_PX[1] * PX * s * 1.4), new ShaderMaterial({
        uniforms: { top: { value: new Color(L.top ?? '#cfdde6') }, bottom: { value: new Color(L.bottom ?? '#efe2cf') } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec2 vUv;
          void main(){ float edge = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x); // 左右淡出，相邻两站的天空自然衔接
          gl_FragColor = vec4(mix(bottom, top, smoothstep(0.15, 0.85, vUv.y)), edge);
          #include <colorspace_fragment>
          }`,
        depthWrite: false, transparent: true,
      }));
      m.position.set(x, y, d); m.renderOrder = -1000 + order;
      return m;
    }
    if (L.kind === 'card') {
      const tex = await loadTex(L.src);
      if (!tex) return null;
      let w = L.w ?? tex.image.width, h = L.h ?? tex.image.height;
      if (L.fit === 'cover' || L.fit === 'contain') {   // 铺满 / 完整放进一站（重画出来的图尺寸不定）
        const k = Math[L.fit === 'cover' ? 'max' : 'min'](STATION_PX[0] / tex.image.width, STATION_PX[1] / tex.image.height) * (L.zoom ?? 1);
        w = tex.image.width * k; h = tex.image.height * k;
        L = { ...L, x: (STATION_PX[0] - w) / 2 + (L.dx ?? 0), y: (STATION_PX[1] - h) / 2 + (L.dy ?? 0) };
      }
      const [x, y, s] = place(cx, L.x + w / 2, L.y + h / 2, d);
      const m = cardFor(tex, w * PX * s, h * PX * s);
      m.position.set(x, y, d); m.renderOrder = d * 10 + order * 0.01;
      if (L.anim) animated.push({ obj: m, anim: L.anim, pos: m.position.clone(), rot: m.rotation.clone(), ph: order });
      return m;
    }
    if (L.kind === 'model') {
      const src = await loadGlb(L.src);
      if (!src) return null;
      const g = new Group(), mdl = src.clone(true);
      mdl.traverse((o) => { if (o.isMesh) for (const mm of [].concat(o.material)) { mm.metalness = 0; mm.roughness = 1; } });
      const box = new Box3().setFromObject(mdl), size = box.getSize(new Vector3()), c = box.getCenter(new Vector3());
      const [x, y, s] = place(cx, L.x, L.y, d);
      const k = (L.h * PX * s) / (size.y || 1);
      mdl.position.set(-c.x, -box.min.y, -c.z);
      const holder = new Group(); holder.add(mdl); holder.scale.setScalar(k); holder.rotation.y = L.ry ?? 0;
      g.add(holder); g.position.set(x, y, d);
      animated.push({ obj: holder, anim: L.anim ?? 'none', pos: holder.position.clone(), rot: holder.rotation.clone(), ph: order });
      return g;
    }
    return null;
  }

  // —— 各站 ——
  const groups = [];
  for (const [i, st] of stations.entries()) {
    const cx = i * PANEL, g = new Group();
    const layers = st.layers ?? [];
    const built = await Promise.all(layers.map((L, k) => buildLayer(L, cx, k)));
    built.filter(Boolean).forEach((m) => g.add(m));
    if (world.frame && st.frame !== false) {
      const tex = await loadTex(world.frame);
      if (tex) {
        const h = STATION_PX[1], w = h * tex.image.width / tex.image.height, d = world.frameDepth ?? 2.6;
        const [x, y, s] = place(cx, STATION_PX[0] / 2, STATION_PX[1] / 2, d);
        const m = cardFor(tex, w * PX * s, h * PX * s); m.position.set(x, y, d); m.renderOrder = 100;
        g.add(m);
      }
    }
    scene.add(g); groups.push(g);
  }

  // —— 纪念品 ——
  const sx = N * PANEL;
  const souvenir = new Group(); scene.add(souvenir);
  const glow = new Mesh(new PlaneGeometry(8, 8), new MeshBasicMaterial({ map: radialTexture(), color: '#fff1c8', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
  glow.position.set(sx, 1.2, -2); scene.add(glow);
  const sg = new Mesh(new PlaneGeometry(PANEL * 1.6, STATION_PX[1] * PX * 1.4), new MeshBasicMaterial({ color: world.souvenir?.bg ?? '#efe3cc' }));
  sg.position.set(sx, 0, -6); sg.renderOrder = -2000; scene.add(sg);
  let souvenirModel = null;
  if (world.souvenir?.model) {
    const src = await loadGlb(world.souvenir.model);
    if (src) {
      const mdl = src.clone(true);
      mdl.traverse((o) => { if (o.isMesh) for (const mm of [].concat(o.material)) { mm.metalness = 0; mm.roughness = 1; } });
      const box = new Box3().setFromObject(mdl), size = box.getSize(new Vector3()), c = box.getCenter(new Vector3());
      mdl.position.set(-c.x, -c.y, -c.z);
      const k = 4.2 / Math.max(size.x, size.y, size.z, 1e-3);
      souvenirModel = new Group(); souvenirModel.add(mdl); souvenirModel.scale.setScalar(k);
      souvenir.add(souvenirModel);
    }
  }
  souvenir.position.set(sx, 1.2, 0);
  // 纪念品下面的一句话（画到画布上；字大、行少，避免透镜屏上的串扰）
  const textMesh = (() => {
    const text = world.souvenir?.text ?? '';
    const c = document.createElement('canvas'); c.width = 1024; c.height = 360;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 1024, 360);
    g.fillStyle = world.souvenir?.ink ?? '#5a3e2b'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '600 64px "Songti SC","STSong","Noto Serif SC",serif';
    const rows = []; let row = '';
    for (const ch of text) { if (g.measureText(row + ch).width > 900) { rows.push(row); row = ch; } else row += ch; }
    if (row) rows.push(row);
    rows.slice(0, 3).forEach((r, i) => g.fillText(r, 512, 180 + (i - (Math.min(rows.length, 3) - 1) / 2) * 92));
    const tex = new CanvasTexture(c); tex.colorSpace = SRGBColorSpace;
    const m = new Mesh(new PlaneGeometry(8, 8 * 360 / 1024), new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
    m.position.set(sx, -4.6, 0.5); scene.add(m);
    return m;
  })();

  // —— 每帧 ——
  let current = 0;
  const camOffset = new Vector3();
  function update({ worldTime: wt, progress = 0, letterU = 0, parallax = { x: 0, y: 0 }, view = null }) {
    const ju = clamp01(progress / TUNING.trainPhaseEnd);
    const s = ju * N;
    const i = Math.min(Math.floor(s), N);
    const lu = s - i;
    current = Math.min(i, N - 1);
    const pan = i < N ? ease(seg(lu, 0.8, 1)) : 0;
    const camX = view ? view.x : (i + pan) * PANEL;
    groups.forEach((g, k) => { g.visible = Math.abs(camX - k * PANEL) < PANEL * 1.4; });

    for (const a of animated) {
      const t = wt + a.ph * 1.7;
      // 动作都很慢、幅度小：透镜屏上快速的小动作会糊
      if (a.anim === 'sway') a.obj.rotation.z = a.rot.z + Math.sin(t * 1.1) * 0.05;
      else if (a.anim === 'bob') a.obj.position.y = a.pos.y + Math.sin(t * 1.4) * 0.12;
      else if (a.anim === 'spin') a.obj.rotation.y = a.rot.y + t * 0.4;
      else if (a.anim === 'breathe') a.obj.scale.y = a.obj.scale.x * (1 + Math.sin(t * 1.6) * 0.012);
      else if (a.anim === 'drift') a.obj.position.x = a.pos.x + Math.sin(t * 0.5) * 0.25;
    }

    // 纪念品：旅程走完以后继续摇，它从下面升起、转身，下面浮出那句话
    const up = ease(seg(letterU, 0, 0.5)), txt = ease(seg(letterU, 0.45, 0.85));
    souvenir.position.y = lerp(-6, 1.2, up) + Math.sin(wt * 1.2) * 0.08 * up;
    if (souvenirModel) souvenirModel.rotation.y = wt * 0.45 + up * Math.PI * 2;
    glow.material.opacity = 0.55 * up;
    textMesh.material.opacity = txt;

    camOffset.lerp(new Vector3(parallax.x, parallax.y * 0.6, 0), 0.08);
    camera.position.set(camX, LOOK_Y, CAM_Z).add(camOffset);
    camera.lookAt(camX, LOOK_Y, 0);
    camera.updateMatrixWorld();
  }

  function setAspect(aspect, halfW = HALF_W) {
    camera.aspect = aspect;
    camera.fov = Math.min(Math.max(2 * Math.atan(halfW / aspect / CAM_Z) * 180 / Math.PI, 12), halfW > HALF_W ? 85 : 52);
    camera.updateProjectionMatrix();
  }

  return {
    scene, camera, update, setAspect, reset() {}, hasTrain: false,
    journeyLength: N * PANEL, panelX: (k) => k * PANEL, panelWidth: PANEL,
    stationAt: () => stations[current] ?? { name: '' },
  };
}

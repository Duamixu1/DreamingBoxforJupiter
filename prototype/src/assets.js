// Tripo 模型槽位。
// 把 Tripo 导出的 GLB 按「槽位 id.glb」放进 prototype/assets/models/，刷新即替换对应的程序化几何体；
// 没有文件的槽位继续用程序化占位，所以可以一个一个换。
//
// fit：模型导入后按哪条轴缩放到多大（场景单位，1 ≈ 盒内 1 cm 左右的微缩尺度）
// yaw：模型正面朝向修正。约定场景里 +z 朝向观众、火车车头朝 +x
// faces：建议面数上限。Jupiter 每帧画 9 个视点，整盒建议 ≤ 30k 三角面/视点
import { THREE, GLBLoader } from './three.js';

const { Box3, Vector3, Matrix4, Quaternion, Euler, Group, Mesh, InstancedMesh, MeshLambertMaterial } = THREE;

export const SLOTS = {
  house:          { name: '家 · 出发的小屋', fit: ['y', 2.8], yaw: 0, faces: 3000, prompt: 'cozy small European cottage, cream walls, red-brown tiled roof, chimney, wooden door, warm lit windows, miniature diorama style, hand-painted, low poly' },
  tree_pine:      { name: '松树', fit: ['y', 2.8], yaw: 0, faces: 300, prompt: 'stylized pine tree, two-tier cone foliage, short brown trunk, miniature diorama, low poly, matte' },
  tree_round:     { name: '圆冠树', fit: ['y', 2.2], yaw: 0, faces: 300, prompt: 'stylized round deciduous tree, soft green faceted canopy, short trunk, miniature diorama, low poly, matte' },
  bush:           { name: '灌木', fit: ['max', 1.0], yaw: 0, faces: 200, prompt: 'small round green bush with a few tiny flowers, miniature diorama, low poly' },
  mountain:       { name: '雪山', fit: ['y', 1], yaw: 0, faces: 800, prompt: 'single stylized mountain peak with snow cap, sage green slopes, miniature diorama, low poly, matte' },
  bridge:         { name: '石拱桥', fit: ['x', 4.4], yaw: 0, faces: 1500, prompt: 'small stone arch railway bridge, single track deck, grey stone, miniature diorama, low poly' },
  hot_air_balloon:{ name: '热气球', fit: ['y', 2.6], yaw: 0, faces: 1200, prompt: 'hot air balloon with red and yellow stripes, small wicker basket, miniature toy style, low poly' },
  lighthouse:     { name: '灯塔', fit: ['y', 5.4], yaw: 0, faces: 2000, prompt: 'red and white striped lighthouse on a rock base, glass lamp room, miniature diorama, low poly' },
  sailboat:       { name: '帆船', fit: ['x', 1.6], yaw: 0, faces: 800, prompt: 'tiny wooden sailboat with one white sail, miniature toy, low poly' },
  beach_umbrella: { name: '遮阳伞', fit: ['y', 1.8], yaw: 0, faces: 300, prompt: 'beach umbrella, coral and white stripes, thin pole, miniature, low poly' },
  cafe:           { name: '夜晚的咖啡馆', fit: ['x', 3.8], yaw: 0, faces: 3000, prompt: 'small corner cafe building, striped red and white awning, large warm glowing windows, two outdoor tables, miniature diorama, low poly' },
  city_block:     { name: '城市楼房', fit: ['y', 1], yaw: 0, faces: 400, prompt: 'simple narrow city apartment building, dark blue facade, small lit windows, miniature, low poly' },
  street_lamp:    { name: '路灯', fit: ['y', 2.1], yaw: 0, faces: 300, prompt: 'old fashioned cast iron street lamp, single lantern head, miniature, low poly' },
  station:        { name: '终点站', fit: ['x', 5.2], yaw: 0, faces: 2500, prompt: 'small countryside train station platform with green canopy roof on posts, bench, hanging lantern, miniature diorama, low poly' },
  train_engine:   { name: '火车头', fit: ['x', 3.6], yaw: Math.PI / 2, faces: 5000, prompt: 'small vintage steam locomotive, deep red body, black boiler front, brass trim, red wheels, toy train, side view, miniature, low poly' },
  train_carriage: { name: '车厢', fit: ['x', 2.7], yaw: Math.PI / 2, faces: 3000, prompt: 'vintage passenger train carriage, cream body, dark green roof, warm lit windows, toy train, miniature, low poly' },
};

const MODEL_DIR = './assets/models/';

// 列出 models 目录里有哪些 GLB：优先解析本地服务器的目录列表（serve.py 自带），其次读 models.json
async function availableIds() {
  try {
    const res = await fetch(MODEL_DIR, { cache: 'no-store' });
    if (res.ok && (res.headers.get('content-type') || '').includes('html')) {
      const html = await res.text();
      return [...html.matchAll(/href="([^"]+)\.glb"/g)].map((m) => decodeURIComponent(m[1])).filter((id) => SLOTS[id]);
    }
  } catch { /* 继续尝试 models.json */ }
  try {
    const res = await fetch(MODEL_DIR + 'models.json', { cache: 'no-store' });
    if (res.ok) return (await res.json()).filter((id) => SLOTS[id]);
  } catch { /* 没有清单 */ }
  return [];
}

// 把 GLB 归一化成「底面中心在原点、按 fit 缩放、按 yaw 转正」的零件列表
function toTemplate(id, scene, clip, slot = SLOTS[id]) {
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  const size = box.getSize(new Vector3()), center = box.getCenter(new Vector3());
  const [axis, target] = slot.fit;
  const dim = axis === 'max' ? Math.max(size.x, size.y, size.z) : size[axis];
  const k = target / (dim || 1);
  const norm = new Matrix4().makeRotationY(slot.yaw)
    .multiply(new Matrix4().makeScale(k, k, k))
    .multiply(new Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));

  const parts = [];
  const mats = new Map();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const src of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!mats.has(src)) {
        // 微缩布景统一用 Lambert：Mali 上便宜，也和程序化部分的光照一致；金属度归零避免无环境贴图时发黑
        mats.set(src, new MeshLambertMaterial({
          map: src.map ?? null, color: src.color ?? 0xffffff,
          emissive: src.emissive ?? 0x000000, emissiveMap: src.emissiveMap ?? null,
          vertexColors: src.vertexColors, transparent: src.transparent, opacity: src.opacity,
          alphaTest: src.alphaTest, side: src.side, clippingPlanes: clip,
        }));
      }
    }
    const material = Array.isArray(o.material) ? o.material.map((m) => mats.get(m)) : mats.get(o.material);
    parts.push({ geometry: o.geometry, material, matrix: norm.clone().multiply(o.matrixWorld) });
  });
  const tris = parts.reduce((s, p) => s + (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3, 0);
  return { id, parts, tris: Math.round(tris) };
}

export async function loadModels(renderer, clip) {
  const ids = await availableIds();
  const templates = new Map();
  if (!ids.length) return templates;
  const loader = new GLBLoader(renderer, {
    dracoDecoderPath: './vendor/jupiter-sdk/decoders/draco/',
    ktx2TranscoderPath: './vendor/jupiter-sdk/decoders/basis/',
  });
  const results = await Promise.allSettled(ids.map((id) => loader.load(MODEL_DIR + id + '.glb')));
  results.forEach((r, i) => {
    const id = ids[i];
    if (r.status === 'fulfilled') {
      const t = toTemplate(id, r.value.scene, clip);
      templates.set(id, t);
      const over = t.tris > SLOTS[id].faces * 1.5 ? `  ⚠ 超过建议 ${SLOTS[id].faces}` : '';
      console.info(`[模型] ${id}（${SLOTS[id].name}）已替换 · ${t.tris} 面${over}`);
    } else {
      console.warn(`[模型] ${id}.glb 加载失败，继续用程序化占位：`, r.reason);
    }
  });
  return templates;
}

// 旅程地标：用户照片经 Tripo 生成的 GLB，每站一个，模板 id 为 'landmark:<站序号>'
const LANDMARK_SLOT = { fit: ['max', 3.6], yaw: 0, faces: 5000 };

export async function loadLandmarks(renderer, clip, stations, baseUrl) {
  const templates = new Map();
  const jobs = stations.map((st, i) => (st.landmark?.glb ? { i, url: new URL(st.landmark.glb, baseUrl).href } : null)).filter(Boolean);
  if (!jobs.length) return templates;
  const loader = new GLBLoader(renderer, {
    dracoDecoderPath: './vendor/jupiter-sdk/decoders/draco/',
    ktx2TranscoderPath: './vendor/jupiter-sdk/decoders/basis/',
  });
  const results = await Promise.allSettled(jobs.map((j) => loader.load(j.url)));
  results.forEach((r, k) => {
    const { i } = jobs[k];
    if (r.status === 'fulfilled') {
      const t = toTemplate(`landmark:${i}`, r.value.scene, clip, LANDMARK_SLOT);
      templates.set(`landmark:${i}`, t);
      console.info(`[地标] 第 ${i + 1} 站「${stations[i].landmark.label ?? ''}」· ${t.tris} 面`);
    } else {
      console.warn(`[地标] 第 ${i + 1} 站加载失败，用该地貌的默认地标：`, r.reason);
    }
  });
  return templates;
}

// 收集摆放位置，最后按「槽位 × 站点分块」生成 InstancedMesh：
// 一个槽位放几十棵树也只有几次绘制，且不在画面里的分块会被视锥剔除
export class Placer {
  constructor(templates, chunkSize) {
    this.templates = templates;
    this.chunkSize = chunkSize;
    this.placements = new Map();
  }

  has(id) { return this.templates.has(id); }

  put(id, x, y, z, { s = 1, ry = 0 } = {}) {
    const chunk = Math.round(x / this.chunkSize);
    const key = `${id}|${chunk}`;
    if (!this.placements.has(key)) this.placements.set(key, []);
    this.placements.get(key).push(new Matrix4().compose(
      new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(0, ry, 0)), new Vector3(s, s, s)));
  }

  build(parent) {
    const m = new Matrix4();
    for (const [key, list] of this.placements) {
      const t = this.templates.get(key.split('|')[0]);
      for (const part of t.parts) {
        const inst = new InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((placement, i) => inst.setMatrixAt(i, m.multiplyMatrices(placement, part.matrix)));
        inst.computeBoundingSphere();
        parent.add(inst);
      }
    }
  }

  // 会动的单件（火车、热气球、帆船）
  spawn(id) {
    const g = new Group();
    for (const part of this.templates.get(id).parts) {
      const mesh = new Mesh(part.geometry, part.material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(part.matrix);
      g.add(mesh);
    }
    return g;
  }
}

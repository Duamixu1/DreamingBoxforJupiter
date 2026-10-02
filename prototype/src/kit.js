// 布景通用零件：随机数、缓动、基础几何体、顶点色合批。scene.js 与 myth.js 共用。
import { THREE } from './three.js';

const {
  BoxGeometry, CylinderGeometry, ConeGeometry, IcosahedronGeometry, SphereGeometry, CircleGeometry,
  BufferGeometry, BufferAttribute, Color, Vector3, Euler, Quaternion, Matrix4, Mesh, CanvasTexture, SRGBColorSpace,
} = THREE;

// —— 小工具 ————————————————————————————————————————————————
export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
export const seg = (u, a, b) => clamp01((u - a) / (b - a));
export const ease = (t) => t * t * (3 - 2 * t);
export const lerp = (a, b, t) => a + (b - a) * t;

export const G = {
  box: new BoxGeometry(1, 1, 1),
  cyl: new CylinderGeometry(0.5, 0.5, 1, 8),
  cone: new ConeGeometry(1, 1, 7),
  pyramid: new ConeGeometry(1, 1, 4).rotateY(Math.PI / 4), // 底面轴对齐，边长 √2
  ico: new IcosahedronGeometry(1, 0),
  sphere: new SphereGeometry(1, 10, 7),
  disc: new CircleGeometry(1, 14).rotateX(-Math.PI / 2),
  halo: new CircleGeometry(1, 20),
};

// 把很多小几何体合成一个顶点色网格（只保留位置；平直着色不需要法线）
export class Batch {
  constructor() { this.parts = []; }

  add(geo, color, [x, y, z], { rot = [0, 0, 0], scale = [1, 1, 1], sway = 0, wave = 0 } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(new Matrix4().compose(
      new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(...rot)), new Vector3(...scale)));
    this.parts.push({ g, color: new Color(color), sway, wave });
    return this;
  }

  box(color, x, y, z, w, h, d, opts) { return this.add(G.box, color, [x, y, z], { ...opts, scale: [w, h, d] }); }

  geometry() {
    const n = this.parts.reduce((s, p) => s + p.g.attributes.position.count, 0);
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const sway = new Float32Array(n), wave = new Float32Array(n);
    let o = 0;
    for (const p of this.parts) {
      const c = p.g.attributes.position.count;
      pos.set(p.g.attributes.position.array, o * 3);
      for (let i = 0; i < c; i++) {
        col[(o + i) * 3] = p.color.r; col[(o + i) * 3 + 1] = p.color.g; col[(o + i) * 3 + 2] = p.color.b;
        sway[o + i] = p.sway; wave[o + i] = p.wave;
      }
      o += c;
    }
    const geo = new BufferGeometry();
    if (this.parts.every((p) => p.g.attributes.uv)) {
      geo.setAttribute('uv', new BufferAttribute(new Float32Array(this.parts.flatMap((p) => [...p.g.attributes.uv.array])), 2));
    }
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    geo.setAttribute('aSway', new BufferAttribute(sway, 1));
    geo.setAttribute('aWave', new BufferAttribute(wave, 1));
    geo.computeBoundingSphere();
    for (const p of this.parts) p.g.dispose();
    this.parts = [];
    return geo;
  }

  build(material) { return new Mesh(this.geometry(), material); }
}

export function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}


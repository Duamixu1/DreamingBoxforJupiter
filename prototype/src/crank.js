// 摇柄输入：把所有来源统一成「本帧转了多少弧度」。
// 来源：屏幕摇柄拖动（桌面预览）/ 相框触屏绕圈 / 空格键 / 滚轮 / 实体摇柄（USB HID 键盘协议，见 firmware/）/ ?auto 匀速自动摇。
import { INPUT } from './config.js';

const TAU = Math.PI * 2;

export class CrankInput {
  constructor({ widget, arm, onLid, surface, auto = false }) {
    this.pending = 0;      // 尚未被消费的转角，顺时针为正
    this.angle = 0;        // 摇柄臂显示角度（含反向）
    this.spaceHeld = false;
    this.source = '—';
    this.onLid = onLid;
    this.arm = arm;
    this.auto = auto;      // 没接实体摇柄时在相框上看连贯效果：匀速 keyboardRevPerSec
    this.#bindWidget(widget, '屏幕摇柄');
    if (surface) this.#bindWidget(surface, '触屏绕圈'); // 相框上手指绕屏幕中心画圈 = 摇柄
    this.#bindKeys();
    window.addEventListener('wheel', (e) => {
      if (e.target.closest?.('.debug')) return;
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.#push(px * INPUT.wheelRadPerPixel, '滚轮');
    }, { passive: false });
  }

  #push(rad, source) { this.pending += rad; this.source = source; }

  #bindWidget(el, source) {
    let prev = null;
    const angleAt = (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      return Math.hypot(dx, dy) < r.width * 0.08 ? null : Math.atan2(dy, dx);
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest?.('.debug')) return;
      el.setPointerCapture(e.pointerId);
      el.classList.add('grabbing');
      prev = angleAt(e);
    });
    el.addEventListener('pointermove', (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      const a = angleAt(e);
      if (a === null) return;
      if (prev !== null) {
        let d = a - prev;
        if (d > Math.PI) d -= TAU;
        if (d < -Math.PI) d += TAU;
        this.#push(d, source);
      }
      prev = a;
    });
    const end = (e) => { el.releasePointerCapture?.(e.pointerId); el.classList.remove('grabbing'); prev = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  #bindKeys() {
    const tick = TAU / INPUT.hidTicksPerRev;
    const k = INPUT.hidKeys;
    window.addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, select, textarea')) return;
      if (e.code === 'Space') { e.preventDefault(); this.spaceHeld = true; return; }
      if (e.key === k.forward) this.#push(tick, '实体摇柄');
      else if (e.key === k.backward) this.#push(-tick, '实体摇柄');
      else if (e.key === k.lidOpen && !e.repeat) this.onLid(true);
      else if (e.key === k.lidClose && !e.repeat) this.onLid(false);
    });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.spaceHeld = false; });
    window.addEventListener('blur', () => { this.spaceHeld = false; });
  }

  // 每帧调用一次：返回 { raw, forward }，并更新摇柄臂显示
  consume(dt) {
    if (this.auto) this.#push(INPUT.keyboardRevPerSec * TAU * dt, '自动');
    else if (this.spaceHeld) this.#push(INPUT.keyboardRevPerSec * TAU * dt, '空格键');
    const raw = this.pending;
    this.pending = 0;
    this.angle += raw;
    this.arm?.setAttribute('transform', `rotate(${(this.angle * 180 / Math.PI).toFixed(2)})`);
    return { raw, forward: Math.max(0, raw) };
  }
}

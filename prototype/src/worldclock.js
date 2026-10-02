// 世界时间：摇柄转动量 → 平滑转速 → 世界速度 → 世界时间 → 旅程进度。
// 火车、镜头、环境动画全部读同一个 worldTime，不各自自动播放（方案第 07 页）。
import { TUNING } from './config.js';

const TAU = Math.PI * 2;

export class WorldClock {
  // duration：常速下整段旅程（含信件）的世界时间，秒；随站数变化
  constructor(duration = 75) { this.duration = duration; this.reset(); }

  reset() {
    this.crankRate = 0;     // 平滑后的正向转速，圈/秒
    this.worldSpeed = 0;
    this.worldTime = 0;
    this.sinceInput = Infinity;
  }

  get progress() { return Math.min(this.worldTime / this.duration, 1); }
  get isCranking() { return this.sinceInput < TUNING.stopTimeout && this.crankRate > 0.03; }

  // forwardRad：本帧正向转角（反向输入已在上游丢弃，MVP 不倒带）
  update(dt, forwardRad, enabled) {
    if (enabled && forwardRad > 0) this.sinceInput = 0;
    else this.sinceInput += dt;

    const stopped = !enabled || this.sinceInput >= TUNING.stopTimeout;
    const instRate = enabled ? forwardRad / TAU / dt : 0;
    const tau = stopped ? TUNING.stopEase : TUNING.rateSmoothing;
    const target = stopped ? 0 : instRate;
    this.crankRate += (target - this.crankRate) * (1 - Math.exp(-dt / tau));
    if (stopped && this.crankRate < 0.02) this.crankRate = 0;

    this.worldSpeed = Math.min(this.crankRate * TUNING.speedPerRev, TUNING.maxWorldSpeed);
    this.worldTime = Math.min(this.worldTime + this.worldSpeed * dt, this.duration);
  }
}

// 旅程进度 → 火车行驶距离。末段平滑减速进站，斜率连续。
export function trainDistance(progress, length) {
  const u = Math.min(progress / TUNING.trainPhaseEnd, 1);
  if (u <= 0.85) return length * u / 0.925;
  const t = (u - 0.85) / 0.15;
  return length * (0.85 + 0.15 * (t - t * t / 2)) / 0.925;
}

// 信件阶段 0 → 1
export function letterPhase(progress) {
  return Math.max(0, (progress - TUNING.trainPhaseEnd) / (1 - TUNING.trainPhaseEnd));
}

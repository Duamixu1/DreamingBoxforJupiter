// 音乐盒声音：音乐跟随「摇没摇」，不跟随「摇多快」（方案第 08 页）。
// 原速原调播放；开始摇淡入，停手淡出并暂停，再摇从暂停处继续。
// 旋律为本项目原创的 3/4 拍小圆舞曲，16 小节无缝循环，全部实时合成，无音频文件。

const BEAT = 0.5; // 秒/拍，120 BPM

// 每小节 3 拍：[midi, 拍数]
const MELODY = [
  [[76, 1], [79, 1], [84, 1]], [[83, 2], [79, 1]], [[81, 1], [79, 1], [76, 1]], [[79, 3]],
  [[77, 1], [81, 1], [86, 1]], [[84, 2], [81, 1]], [[83, 1], [81, 1], [77, 1]], [[79, 3]],
  [[76, 1], [79, 1], [84, 1]], [[88, 2], [86, 1]], [[84, 1], [83, 1], [81, 1]], [[81, 2], [79, 1]],
  [[77, 1], [76, 1], [74, 1]], [[79, 2], [71, 1]], [[74, 1], [76, 1], [74, 1]], [[72, 3]],
];
const BASS = [60, 55, 60, 60, 53, 53, 55, 55, 60, 52, 57, 53, 62, 55, 55, 60];

function buildBeats() {
  const beats = [];
  MELODY.forEach((bar, i) => {
    const slots = [[], [], []];
    let b = 0;
    for (const [midi, len] of bar) { slots[b].push({ midi, vel: b === 0 ? 0.9 : 0.75 }); b += len; }
    const root = BASS[i];
    slots[0].push({ midi: root - 12, vel: 0.55 });
    slots[1].push({ midi: root - 5, vel: 0.3 });
    slots[2].push({ midi: root, vel: 0.3 });
    beats.push(...slots);
  });
  return beats;
}

export class MusicBox {
  constructor() {
    this.ctx = null;
    this.beats = buildBeats();
    this.step = 0;
    this.playing = false;
    this.timer = null;
  }

  // 浏览器要求用户手势后才能发声：在第一次点击/按键时调用
  ensure() {
    if (!this.ctx) {
      const ctx = this.ctx = new AudioContext();
      this.master = ctx.createGain(); this.master.gain.value = 0.8;
      this.master.connect(ctx.destination);
      this.music = ctx.createGain(); this.music.gain.value = 0;
      this.sfx = ctx.createGain(); this.sfx.gain.value = 1;
      const reverb = ctx.createConvolver(); reverb.buffer = this.#impulse(2.4);
      const wet = ctx.createGain(); wet.gain.value = 0.28;
      for (const n of [this.music, this.sfx]) { n.connect(this.master); n.connect(reverb); }
      reverb.connect(wet).connect(this.master);
      this.noise = this.#noiseBuffer(0.4);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  play() {
    if (this.playing || !this.ctx) return;
    this.playing = true;
    const now = this.ctx.currentTime;
    this.#ramp(this.music.gain, 1, 0.35);
    this.nextTime = now + 0.05;
    this.timer = setInterval(() => this.#schedule(), 25);
    this.#schedule();
  }

  pause(fade = 0.45) {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.#ramp(this.music.gain, 0, fade);
  }

  reset() { this.pause(0.1); this.step = 0; }

  #schedule() {
    const ctx = this.ctx;
    while (this.nextTime < ctx.currentTime + 0.12) {
      for (const n of this.beats[this.step]) this.#tine(n.midi, this.nextTime, n.vel);
      this.nextTime += BEAT;
      this.step = (this.step + 1) % this.beats.length;
    }
  }

  // 梳齿音色：基频 + 少量谐波 + 一个快速衰减的非谐泛音
  #tine(midi, t, vel, out = this.music) {
    const ctx = this.ctx;
    const f = 440 * 2 ** ((midi - 69) / 12);
    const decay = Math.min(3, 2.2 * (440 / f) ** 0.35);
    for (const [ratio, amp, d] of [[1, 0.22, 1], [2, 0.05, 0.45], [5.4, 0.018, 0.12]]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = f * ratio;
      const end = t + decay * d;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp * vel, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(g).connect(out);
      osc.start(t); osc.stop(end + 0.05);
    }
  }

  // 火车环境声：一小段滤波噪声，每走过固定距离响一次（因此停摇即停）
  chuff(level = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05 * level, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    src.connect(bp).connect(g).connect(this.sfx);
    src.start(t); src.stop(t + 0.3);
  }

  // 摇柄棘轮的轻微咔哒声
  tick() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.025, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.03);
  }

  // 到站提示：两声轻铃，走 sfx 通道，不受音乐暂停影响
  chime() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.05;
    this.#tine(91, t, 0.8, this.sfx);
    this.#tine(96, t + 0.35, 0.7, this.sfx);
  }

  #ramp(param, value, seconds) {
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + seconds);
  }

  #noiseBuffer(seconds) {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  #impulse(seconds) {
    const rate = this.ctx.sampleRate, len = rate * seconds;
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    return buf;
  }
}

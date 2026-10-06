// 音乐盒声音：音乐跟随「摇没摇」，不跟随「摇多快」（方案第 08 页）。
// 原速原调播放；开始摇淡入，停手淡出并暂停，再摇从暂停处继续。
// 曲库见 SONGS（原创、实时合成）；默认 waltz 为原型一直用的 3/4 拍小圆舞曲。

// 曲库：全部为本项目原创，实时合成，无音频文件。每首 = 每拍秒数 + 每小节拍数 + 旋律小节 + 低音根音。
// 旋律每小节写成 [midi, 拍数] 的列表；低音每小节一个根音，按拍型自动铺成伴奏。
export const SONGS = {
  waltz: {
    name: '晨光圆舞曲', mood: '3/4 拍 · 温柔', beat: 0.5, bar: 3,
    melody: [
      [[76, 1], [79, 1], [84, 1]], [[83, 2], [79, 1]], [[81, 1], [79, 1], [76, 1]], [[79, 3]],
      [[77, 1], [81, 1], [86, 1]], [[84, 2], [81, 1]], [[83, 1], [81, 1], [77, 1]], [[79, 3]],
      [[76, 1], [79, 1], [84, 1]], [[88, 2], [86, 1]], [[84, 1], [83, 1], [81, 1]], [[81, 2], [79, 1]],
      [[77, 1], [76, 1], [74, 1]], [[79, 2], [71, 1]], [[74, 1], [76, 1], [74, 1]], [[72, 3]],
    ],
    bass: [60, 55, 60, 60, 53, 53, 55, 55, 60, 52, 57, 53, 62, 55, 55, 60],
  },
  pentatonic: {
    name: '云山谣', mood: '五声音阶 · 悠远', beat: 0.6, bar: 4,
    melody: [
      [[76, 2], [79, 1], [81, 1]], [[79, 2], [76, 2]], [[74, 1], [76, 1], [79, 2]], [[72, 4]],
      [[81, 2], [84, 1], [81, 1]], [[79, 3], [76, 1]], [[74, 1], [72, 1], [74, 2]], [[76, 4]],
      [[79, 1], [81, 1], [84, 2]], [[86, 2], [84, 2]], [[81, 1], [79, 1], [76, 1], [74, 1]], [[76, 4]],
      [[72, 2], [74, 1], [76, 1]], [[79, 2], [76, 1], [74, 1]], [[72, 1], [69, 1], [72, 2]], [[72, 4]],
    ],
    bass: [60, 57, 55, 60, 57, 55, 62, 60, 55, 62, 57, 60, 57, 55, 57, 60],
  },
  chip: {
    name: '像素小进行曲', mood: '4/4 拍 · 轻快', beat: 0.32, bar: 4,
    melody: [
      [[72, 1], [76, 1], [79, 1], [84, 1]], [[83, 2], [79, 2]], [[81, 1], [77, 1], [81, 1], [84, 1]], [[83, 4]],
      [[72, 1], [76, 1], [79, 1], [84, 1]], [[88, 2], [86, 2]], [[84, 1], [83, 1], [81, 1], [79, 1]], [[77, 4]],
      [[76, 1], [77, 1], [79, 2]], [[81, 1], [79, 1], [77, 2]], [[76, 1], [74, 1], [72, 1], [74, 1]], [[76, 2], [79, 2]],
      [[81, 1], [79, 1], [77, 1], [76, 1]], [[74, 2], [79, 2]], [[76, 1], [74, 1], [71, 1], [74, 1]], [[72, 4]],
    ],
    bass: [60, 55, 53, 55, 60, 57, 53, 55, 52, 53, 57, 60, 53, 55, 55, 60],
  },
  lullaby: {
    name: '小小摇篮曲', mood: '3/4 拍 · 安睡', beat: 0.62, bar: 3,
    melody: [
      [[79, 2], [76, 1]], [[79, 2], [76, 1]], [[77, 1], [79, 1], [81, 1]], [[79, 3]],
      [[76, 2], [74, 1]], [[72, 2], [74, 1]], [[76, 1], [74, 1], [72, 1]], [[74, 3]],
      [[79, 2], [76, 1]], [[79, 2], [84, 1]], [[83, 1], [81, 1], [79, 1]], [[81, 3]],
      [[79, 2], [77, 1]], [[76, 2], [74, 1]], [[72, 1], [74, 1], [71, 1]], [[72, 3]],
    ],
    bass: [60, 60, 53, 60, 57, 53, 55, 55, 60, 52, 53, 53, 55, 60, 55, 60],
  },
};

function buildBeats(song) {
  const beats = [];
  song.melody.forEach((bar, i) => {
    const slots = Array.from({ length: song.bar }, () => []);
    let b = 0;
    for (const [midi, len] of bar) { slots[b].push({ midi, vel: b === 0 ? 0.9 : 0.75 }); b += len; }
    const root = song.bass[i];
    slots[0].push({ midi: root - 12, vel: 0.55 });
    for (let k = 1; k < song.bar; k++) slots[k].push({ midi: k % 2 ? root - 5 : root, vel: 0.28 });
    beats.push(...slots);
  });
  return beats;
}

export class MusicBox {
  constructor(songId = 'waltz') {
    this.ctx = null;
    this.setSong(songId);
    this.step = 0;
    this.playing = false;
    this.timer = null;
  }

  setSong(id) {
    this.song = SONGS[id] ?? SONGS.waltz;
    this.beats = buildBeats(this.song);
    this.step = 0;
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
      this.nextTime += this.song.beat;
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

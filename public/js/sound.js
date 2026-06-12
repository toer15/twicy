// Tiny WebAudio synthesizer — no audio assets needed.
'use strict';

const Sfx = {
  ctx: null,
  master: null,
  enabled: true,
  volume: 1,
  _rainNode: null,

  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      } catch (e) { return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.master) this.master.gain.value = this.volume;
  },

  _tone(freq, endFreq, dur, type, vol) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  },

  _noise(dur, vol, filterFreq) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  },

  place() { this._tone(190, 130, 0.08, 'square', 0.12); this._noise(0.05, 0.1, 1400); },
  breakBlock() { this._noise(0.14, 0.22, 900); this._tone(120, 70, 0.1, 'square', 0.08); },
  dig() { this._noise(0.05, 0.08, 1100); },
  step() { this._noise(0.05, 0.05, 650); },
  hurt() { this._tone(300, 110, 0.2, 'sawtooth', 0.16); },
  splash() { this._noise(0.3, 0.14, 800); },
  click() { this._tone(750, 600, 0.04, 'square', 0.07); },
  pop() { this._tone(520, 900, 0.07, 'sine', 0.12); },
  levelup() { this._tone(440, 880, 0.25, 'sine', 0.1); },
  hit() { this._noise(0.08, 0.2, 500); this._tone(160, 90, 0.09, 'triangle', 0.14); },
  mobDeath() { this._tone(220, 60, 0.35, 'sawtooth', 0.12); this._noise(0.15, 0.1, 700); },
  zombie() { this._tone(110, 70, 0.5, 'sawtooth', 0.07); this._tone(95, 65, 0.5, 'triangle', 0.07); },
  oink() { this._tone(260, 180, 0.12, 'square', 0.08); this._tone(180, 240, 0.1, 'square', 0.06); },
  fuse() { this._noise(1.4, 0.16, 2600); this._tone(2200, 3200, 1.3, 'sawtooth', 0.025); },
  explosion() {
    this._noise(0.8, 0.5, 320);
    this._tone(90, 30, 0.7, 'sawtooth', 0.3);
    setTimeout(() => this._noise(0.5, 0.2, 180), 80);
  },
  thunder() {
    this._noise(1.2, 0.35, 240);
    setTimeout(() => this._noise(0.9, 0.2, 150), 250);
  },
  craft() { this._noise(0.07, 0.1, 1800); this._tone(420, 520, 0.08, 'square', 0.08); },
  equip() { this._noise(0.1, 0.12, 1200); this._tone(300, 380, 0.1, 'triangle', 0.08); },

  // looping rain ambience
  rain(on) {
    if (!this.ctx) return;
    if (on && !this._rainNode && this.enabled) {
      const dur = 2;
      const n = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      const g = this.ctx.createGain();
      g.gain.value = 0.0;
      g.gain.linearRampToValueAtTime(0.055, this.ctx.currentTime + 2);
      src.connect(f).connect(g).connect(this.master);
      src.start();
      this._rainNode = { src, g };
    } else if (!on && this._rainNode) {
      const node = this._rainNode;
      this._rainNode = null;
      try {
        node.g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1.5);
        setTimeout(() => { try { node.src.stop(); } catch (e) {} }, 1700);
      } catch (e) {}
    }
  },
};

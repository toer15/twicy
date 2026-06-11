// Tiny WebAudio synthesizer — no audio assets needed.
'use strict';

const Sfx = {
  ctx: null,
  enabled: true,

  unlock() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
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
    osc.connect(g).connect(this.ctx.destination);
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
    src.connect(f).connect(g).connect(this.ctx.destination);
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
};

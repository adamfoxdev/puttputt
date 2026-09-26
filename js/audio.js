/* Tiny WebAudio synth for game SFX — no audio files needed. */
(function (G) {
  'use strict';
  const PP = G.PP;

  class Sound {
    constructor() {
      this.ctx = null;
      try {
        this.enabled = localStorage.getItem('pp.sound') !== 'off';
      } catch (e) {
        this.enabled = true;
      }
      this.lastBounce = 0;
    }

    ensure() {
      if (!this.enabled) return null;
      if (!this.ctx) {
        const AC = G.AudioContext || G.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    toggle() {
      this.enabled = !this.enabled;
      try {
        localStorage.setItem('pp.sound', this.enabled ? 'on' : 'off');
      } catch (e) { /* ignore */ }
      return this.enabled;
    }

    tone(freq, dur, { type = 'sine', vol = 0.3, delay = 0, slide = 0 } = {}) {
      const ctx = this.ensure();
      if (!ctx) return;
      const t0 = ctx.currentTime + delay;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(this.master);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }

    noise(dur, { vol = 0.3, freq = 1200, q = 0.8, type = 'bandpass', delay = 0, sweep = 0 } = {}) {
      const ctx = this.ensure();
      if (!ctx) return;
      const t0 = ctx.currentTime + delay;
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(freq, t0);
      if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t0 + dur);
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f).connect(g).connect(this.master);
      src.start(t0);
    }

    putt(power) {
      this.noise(0.05, { vol: 0.25 + power * 0.4, freq: 2500, q: 1.5 });
      this.tone(180 + power * 120, 0.09, { type: 'triangle', vol: 0.25 });
    }
    bounce(power) {
      const now = performance.now();
      if (now - this.lastBounce < 45) return;
      this.lastBounce = now;
      const v = Math.min(1, power / 900);
      this.tone(520 + v * 380, 0.06, { type: 'triangle', vol: 0.05 + v * 0.22 });
    }
    bumper() {
      this.tone(880, 0.12, { type: 'square', vol: 0.08, slide: 1.6 });
      this.tone(440, 0.15, { type: 'sine', vol: 0.18, slide: 2 });
    }
    splash() {
      this.noise(0.5, { vol: 0.4, freq: 900, q: 0.6, sweep: 0.3, type: 'lowpass' });
      this.tone(300, 0.3, { vol: 0.12, slide: 0.4 });
    }
    sink() {
      this.noise(0.08, { vol: 0.3, freq: 700, q: 2 });
      [660, 880, 1320].forEach((f, i) => this.tone(f, 0.25, { type: 'sine', vol: 0.2, delay: 0.08 + i * 0.09 }));
    }
    fanfare() {
      [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', vol: 0.18, delay: i * 0.11 }));
    }
    click() {
      this.tone(1200, 0.04, { type: 'sine', vol: 0.08 });
    }
    paint() {
      this.tone(900 + Math.random() * 200, 0.03, { type: 'sine', vol: 0.04 });
    }
  }

  PP.Sound = Sound;
})(typeof window !== 'undefined' ? window : globalThis);

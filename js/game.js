/* Play mode: shots, strokes, hazards, hole flow, particles. */
(function (G) {
  'use strict';
  const PP = G.PP;
  const { cellCenter, isSolid, tileAtPx } = PP;

  const DRAG_FULL = 170; // CSS px of pull for full power

  class Game {
    constructor(app) {
      this.app = app;
      this.r = app.renderer;
      this.sound = app.sound;
      this.levels = [];
      this.scores = [];
      this.meta = {};
      this.particles = [];
      this.flashes = new Map();
      this.drag = null;
      this.aim = null;
    }

    start(levels, meta = {}) {
      this.levels = levels;
      this.meta = meta;
      this.scores = new Array(levels.length).fill(null);
      this.loadHole(0);
    }

    get level() {
      return this.levels[this.index];
    }

    get maxStrokes() {
      return Math.min(this.level.par + 5, 12);
    }

    loadHole(i) {
      this.index = i;
      const lvl = this.level;
      this.r.setLevel(lvl, { crop: true, rotate: true });
      this.app.resize();
      this.sim = new PP.Sim(lvl);
      this.acc = 0;
      const tee = cellCenter(lvl.tee.c, lvl.tee.r);
      this.ball = { x: tee.x, y: tee.y, vx: 0, vy: 0, moving: false, sunk: false, trail: [] };
      this.lastRest = { x: tee.x, y: tee.y };
      this.strokes = 0;
      this.state = 'aim';
      this.timer = 0;
      this.particles = [];
      this.flashes = new Map();
      this.drag = null;
      this.aim = null;
      this.introT = 0;
      this.app.updateHud();
    }

    restartHole() {
      if (this.state === 'done') return;
      this.loadHole(this.index);
      this.introT = 1.2;
    }

    nextHole() {
      if (this.index + 1 < this.levels.length) this.loadHole(this.index + 1);
    }

    totalStrokes() {
      return this.scores.reduce((a, s) => a + (s || 0), 0);
    }

    totalVsPar() {
      let d = 0;
      this.scores.forEach((s, i) => {
        if (s != null) d += s - this.levels[i].par;
      });
      return d;
    }

    /* ---------- Input ---------- */
    pointerDown(e) {
      this.sound.ensure();
      if (this.state !== 'aim') return;
      this.drag = { sx: e.clientX, sy: e.clientY, id: e.pointerId };
      this.aim = { dx: 0, dy: 0, power: 0 };
    }

    pointerMove(e) {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const vx = this.drag.sx - e.clientX;
      const vy = this.drag.sy - e.clientY;
      const len = Math.hypot(vx, vy);
      if (len < 6) {
        this.aim = { dx: 0, dy: 0, power: 0 };
        return;
      }
      const w = this.r.screenDirToWorld(vx, vy);
      const wl = Math.hypot(w.x, w.y) || 1;
      this.aim = { dx: w.x / wl, dy: w.y / wl, power: Math.min(1, len / DRAG_FULL) };
    }

    pointerUp(e) {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const aim = this.aim;
      this.drag = null;
      this.aim = null;
      if (this.state === 'aim' && aim && aim.power > 0.03) this.shoot(aim.dx, aim.dy, aim.power);
    }

    cancelAim() {
      this.drag = null;
      this.aim = null;
    }

    shoot(dx, dy, power) {
      const speed = PP.Physics.MAX_SHOT * Math.pow(power, 1.35);
      Object.assign(this.ball, { vx: dx * speed, vy: dy * speed, moving: true, rollTime: 0, slowTime: 0 });
      this.strokes++;
      this.state = 'rolling';
      this.sound.putt(power);
      this.burst(this.ball.x, this.ball.y, 6, { color: 'rgba(255,255,255,0.8)', speed: 60, life: 0.35, size: 2.5 });
      this.app.updateHud();
    }

    /* ---------- Simulation ---------- */
    update(dt) {
      if (!this.level) return;
      this.introT += dt;
      this.acc = Math.min(this.acc + dt, 0.1);
      const STEP = PP.Physics.STEP;
      const events = [];
      while (this.acc >= STEP) {
        this.sim.step(this.ball, events);
        this.acc -= STEP;
      }
      events.forEach((ev) => this.handle(ev));

      const b = this.ball;
      if (b.moving) {
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 16) b.trail.shift();
      } else if (b.trail.length) {
        b.trail.shift();
      }

      if (this.state === 'water') {
        this.timer += dt;
        if (this.timer > 0.9) {
          b.x = this.lastRest.x;
          b.y = this.lastRest.y;
          b.vx = b.vy = 0;
          b.trail = [];
          this.strokes++; // penalty
          this.state = 'aim';
          this.app.toast('Splash! +1 stroke penalty');
          this.app.updateHud();
          this.checkMax();
        }
      } else if (this.state === 'sinking') {
        this.timer += dt;
        const k = Math.min(1, this.timer / 0.3);
        b.x += (this.sim.hx - b.x) * k * 0.5;
        b.y += (this.sim.hy - b.y) * k * 0.5;
        if (this.timer > 0.45) this.finishHole(false);
      }

      for (const [o, f] of this.flashes) {
        const nf = f - dt * 4;
        if (nf <= 0) this.flashes.delete(o);
        else this.flashes.set(o, nf);
      }
      this.particles = this.particles.filter((p) => {
        p.age += dt;
        p.vy += (p.g || 0) * dt;
        p.vx *= Math.exp(-(p.drag || 0) * dt);
        p.vy *= Math.exp(-(p.drag || 0) * dt);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.spin) p.rot = (p.rot || 0) + p.spin * dt;
        return p.age < p.life;
      });
    }

    handle(ev) {
      const th = PP.themeOf(this.level);
      switch (ev.type) {
        case 'bounce':
          this.sound.bounce(ev.power);
          if (ev.power > 250) this.burst(ev.x, ev.y, 4, { color: 'rgba(255,255,255,0.7)', speed: 70, life: 0.3, size: 2 });
          break;
        case 'bumper':
          this.flashes.set(ev.obj, 1);
          this.sound.bumper();
          this.burst(ev.x, ev.y, 10, { color: th.accent, speed: 160, life: 0.45, size: 3 });
          break;
        case 'knock':
          if (this.state === 'aim') {
            this.cancelAim();
            this.state = 'rolling';
          }
          this.sound.bounce(500);
          break;
        case 'water':
          if (this.state !== 'rolling') break;
          this.state = 'water';
          this.timer = 0;
          this.sound.splash();
          this.burst(ev.x, ev.y, 18, { color: th.water2, speed: 140, life: 0.7, size: 3.2, g: 260, drag: 1.5 });
          for (let i = 0; i < 3; i++)
            this.particles.push({ x: ev.x, y: ev.y, vx: 0, vy: 0, age: -i * 0.15, life: 0.8, size: 14, color: th.water2, shape: 'ring' });
          break;
        case 'sink':
          this.state = 'sinking';
          this.timer = 0;
          this.sound.sink();
          break;
        case 'stop': {
          const b = this.ball;
          if (isSolid(tileAtPx(this.level, b.x, b.y))) {
            b.x = this.lastRest.x;
            b.y = this.lastRest.y;
          }
          if (this.state === 'rolling') {
            this.state = 'aim';
            this.lastRest = { x: b.x, y: b.y };
            this.checkMax();
          }
          break;
        }
      }
    }

    checkMax() {
      if (this.state === 'aim' && this.strokes >= this.maxStrokes) this.finishHole(true);
    }

    finishHole(maxed) {
      this.state = 'done';
      this.ball.moving = false;
      this.scores[this.index] = this.strokes;
      const par = this.level.par;
      if (!maxed) {
        const th = PP.themeOf(this.level);
        const colors = [th.accent, '#ffffff', '#facc15', '#4ade80', '#60a5fa'];
        for (let i = 0; i < 60; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = 120 + Math.random() * 380;
          this.particles.push({
            x: this.sim.hx, y: this.sim.hy,
            vx: Math.cos(a) * s, vy: Math.sin(a) * s - 180,
            g: 520, drag: 1.8, age: 0, life: 1.2 + Math.random() * 0.8,
            size: 6 + Math.random() * 4, color: colors[i % colors.length],
            shape: 'rect', rot: Math.random() * 6, spin: (Math.random() - 0.5) * 16,
          });
        }
        if (this.strokes <= par) this.sound.fanfare();
      }
      this.app.updateHud();
      this.app.onHoleComplete({
        strokes: this.strokes,
        par,
        maxed,
        isLast: this.index === this.levels.length - 1,
      });
    }

    burst(x, y, n, { color, speed, life, size, g = 0, drag = 3 }) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = speed * (0.4 + Math.random() * 0.8);
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, age: 0, life: life * (0.6 + Math.random() * 0.6), size, color, g, drag });
      }
    }

    /* ---------- Rendering ---------- */
    render(t) {
      if (!this.level) return;
      const ctx = this.r.begin();
      const b = this.ball;
      let ballScale = 1;
      if (this.state === 'water') ballScale = Math.max(0, 1 - this.timer * 3);
      else if (this.state === 'sinking') ballScale = Math.max(0.2, 1 - this.timer * 1.8);
      else if (this.state === 'done' && b.sunk) ballScale = 0;
      const hd = Math.hypot(b.x - this.sim.hx, b.y - this.sim.hy);
      this.r.drawWorld(t, {
        objTime: this.sim.time,
        flashes: this.flashes,
        ball: b,
        ballScale,
        aim: this.state === 'aim' ? this.aim : null,
        ballOnTop: true,
        flagAlpha: Math.max(0.15, Math.min(1, (hd - 20) / 90)),
        particles: this.particles,
      });
      if (this.state === 'aim' && !this.drag && this.strokes === 0) this.drawPulse(ctx, t);
      this.drawIntro();
    }

    drawPulse(ctx, t) {
      const b = this.ball;
      const k = (t * 0.9) % 1;
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - k)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 10 + k * 22, 0, Math.PI * 2);
      ctx.stroke();
    }

    drawIntro() {
      const t = this.introT;
      if (t > 2.2) return;
      const a = t < 0.25 ? t / 0.25 : t > 1.7 ? Math.max(0, (2.2 - t) / 0.5) : 1;
      const lvl = this.level;
      const ctx = this.r.screenSpace();
      const W = this.r.canvas.width;
      const H = this.r.canvas.height;
      const u = Math.min(W / 900, H / 420, 2.4 * (G.devicePixelRatio || 1));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(8,10,24,0.55)';
      const bh = 110 * u;
      ctx.fillRect(0, H / 2 - bh / 2, W, bh);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.round(44 * u)}px Outfit, system-ui, sans-serif`;
      const multi = this.levels.length > 1;
      ctx.fillText(multi ? `HOLE ${this.index + 1}` : lvl.name.toUpperCase(), W / 2, H / 2 - 14 * u);
      ctx.font = `500 ${Math.round(20 * u)}px Outfit, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(multi ? `${lvl.name}  ·  Par ${lvl.par}` : `Par ${lvl.par}`, W / 2, H / 2 + 26 * u);
      ctx.restore();
    }
  }

  Game.scoreName = function (strokes, par, maxed) {
    if (maxed) return 'Picked up';
    if (strokes === 1) return 'Hole in one!';
    const d = strokes - par;
    if (d <= -3) return 'Albatross!';
    if (d === -2) return 'Eagle!';
    if (d === -1) return 'Birdie!';
    if (d === 0) return 'Par';
    if (d === 1) return 'Bogey';
    if (d === 2) return 'Double bogey';
    return `+${d}`;
  };

  PP.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);

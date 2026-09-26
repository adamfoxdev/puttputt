/* Canvas renderer: cached static course layer + animated objects, ball, aim guide, particles. */
(function (G) {
  'use strict';
  const PP = G.PP;
  const { T, CELL, THEMES, BOOST_DIR, isBoost, getTile, cellCenter } = PP;

  const themeOf = (lvl) => THEMES[(lvl && lvl.theme) || 0] || THEMES[0];

  /* Screen orientation of the current view, so shadows/flags stay "screen down/up" when rotated. */
  const VIEW = { down: [0, 1], right: [1, 0], upright: 0 };
  /** Offset that appears as (sx, sy) on screen, expressed in world units. */
  const soff = (sx, sy) => [sx * VIEW.right[0] + sy * VIEW.down[0], sx * VIEW.right[1] + sy * VIEW.down[1]];

  /** Adds rounded rects for every cell matching pred to the current path, rounding only outer corners. */
  function regionPath(ctx, lvl, pred, grow, radius) {
    ctx.beginPath();
    for (let r = 0; r < lvl.rows; r++) {
      for (let c = 0; c < lvl.cols; c++) {
        if (!pred(getTile(lvl, c, r), c, r)) continue;
        const up = pred(getTile(lvl, c, r - 1), c, r - 1);
        const dn = pred(getTile(lvl, c, r + 1), c, r + 1);
        const lf = pred(getTile(lvl, c - 1, r), c - 1, r);
        const rt = pred(getTile(lvl, c + 1, r), c + 1, r);
        const rad = [!up && !lf ? radius : 0, !up && !rt ? radius : 0, !dn && !rt ? radius : 0, !dn && !lf ? radius : 0];
        const x = c * CELL - (lf ? CELL * 0.02 : grow);
        const y = r * CELL - (up ? CELL * 0.02 : grow);
        const w = CELL + (lf ? CELL * 0.02 : grow) + (rt ? CELL * 0.02 : grow);
        const h = CELL + (up ? CELL * 0.02 : grow) + (dn ? CELL * 0.02 : grow);
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, rad);
        else ctx.rect(x, y, w, h);
      }
    }
  }

  function hashCell(c, r, k = 0) {
    let h = (c * 374761393 + r * 668265263 + k * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function drawBackground(ctx, lvl, w, h) {
    const th = themeOf(lvl);
    const g = ctx.createRadialGradient(w / 2, h * 0.4, 50, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, th.bg1);
    g.addColorStop(1, th.bg0);
    ctx.fillStyle = g;
    ctx.fillRect(-w, -h, w * 3, h * 3);
    ctx.fillStyle = th.dots;
    for (let y = CELL / 2; y < h; y += CELL / 2)
      for (let x = CELL / 2; x < w; x += CELL / 2) {
        ctx.beginPath();
        ctx.arc(x, y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
  }

  /** Everything that never moves. */
  function drawStatic(ctx, lvl) {
    const th = themeOf(lvl);
    const W = lvl.cols * CELL;
    const H = lvl.rows * CELL;
    drawBackground(ctx, lvl, W, H);

    const course = (t) => t !== T.VOID;

    // Drop shadow of the whole island
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = th.railShade;
    regionPath(ctx, lvl, course, 8, 14);
    ctx.fill();
    ctx.restore();

    // Rail (bumper edge) with a darker lip for depth
    ctx.save();
    ctx.translate(...soff(0, 3));
    ctx.fillStyle = th.railShade;
    regionPath(ctx, lvl, course, 8, 14);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = th.rail;
    regionPath(ctx, lvl, course, 7, 13);
    ctx.fill();

    // Grass with mowing stripes
    ctx.fillStyle = th.grass0;
    regionPath(ctx, lvl, course, 0, 8);
    ctx.fill();
    ctx.save();
    regionPath(ctx, lvl, course, 0, 8);
    ctx.clip();
    ctx.fillStyle = th.grass1;
    for (let c = 0; c < lvl.cols; c += 2) ctx.fillRect(c * CELL, 0, CELL, H);
    // inner shade along edges that meet the rail
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    for (let r = 0; r < lvl.rows; r++)
      for (let c = 0; c < lvl.cols; c++) {
        if (!course(getTile(lvl, c, r))) continue;
        const x = c * CELL;
        const y = r * CELL;
        if (!course(getTile(lvl, c, r - 1))) ctx.fillRect(x, y, CELL, 5);
        if (!course(getTile(lvl, c, r + 1))) ctx.fillRect(x, y + CELL - 3, CELL, 3);
        if (!course(getTile(lvl, c - 1, r))) ctx.fillRect(x, y, 4, CELL);
        if (!course(getTile(lvl, c + 1, r))) ctx.fillRect(x + CELL - 4, y, 4, CELL);
      }
    ctx.restore();

    // Sand
    ctx.fillStyle = th.sand;
    regionPath(ctx, lvl, (t) => t === T.SAND, -2, 14);
    ctx.fill();
    ctx.fillStyle = th.sandDot;
    forCells(lvl, T.SAND, (c, r) => {
      for (let i = 0; i < 7; i++) {
        const x = c * CELL + 6 + hashCell(c, r, i) * (CELL - 12);
        const y = r * CELL + 6 + hashCell(c, r, i + 9) * (CELL - 12);
        ctx.beginPath();
        ctx.arc(x, y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Ice
    ctx.fillStyle = th.ice;
    regionPath(ctx, lvl, (t) => t === T.ICE, -1, 10);
    ctx.fill();
    ctx.strokeStyle = th.ice2;
    ctx.lineWidth = 2;
    forCells(lvl, T.ICE, (c, r) => {
      if (hashCell(c, r) < 0.5) return;
      const x = c * CELL + 10;
      const y = r * CELL + 12;
      ctx.beginPath();
      ctx.moveTo(x, y + 14);
      ctx.lineTo(x + 14, y);
      ctx.moveTo(x + 8, y + 18);
      ctx.lineTo(x + 18, y + 8);
      ctx.stroke();
    });

    // Water basin (animated highlights are drawn per-frame)
    ctx.fillStyle = shade(th.water, -0.25);
    regionPath(ctx, lvl, (t) => t === T.WATER, -1, 14);
    ctx.fill();
    ctx.fillStyle = th.water;
    regionPath(ctx, lvl, (t) => t === T.WATER, -4, 12);
    ctx.fill();

    // Boost plates
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    regionPath(ctx, lvl, (t) => isBoost(t), -3, 8);
    ctx.fill();

    // Tee pad
    if (lvl.tee) {
      const x = lvl.tee.c * CELL;
      const y = lvl.tee.r * CELL;
      ctx.fillStyle = th.tee;
      roundRect(ctx, x + 5, y + 5, CELL - 10, CELL - 10, 8);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      [[12, 12], [CELL - 12, 12], [12, CELL - 12], [CELL - 12, CELL - 12]].forEach(([dx, dy]) => {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, 1.8, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Walls: raised blocks
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = th.wall;
    regionPath(ctx, lvl, (t) => t === T.WALL, 0, 8);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = th.wallTop;
    ctx.save();
    ctx.translate(...soff(0, -4));
    regionPath(ctx, lvl, (t) => t === T.WALL, -1, 7);
    ctx.fill();
    ctx.restore();

    // Cup
    if (lvl.hole) {
      const { x, y } = cellCenter(lvl.hole.c, lvl.hole.r);
      const R = PP.Physics.HOLE_R;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(x, y, R + 3, 0, Math.PI * 2);
      ctx.fill();
      const g = ctx.createRadialGradient(x, y - 4, 2, x, y, R);
      g.addColorStop(0, '#000');
      g.addColorStop(1, '#1d2433');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, R, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function forCells(lvl, type, fn) {
    for (let r = 0; r < lvl.rows; r++) for (let c = 0; c < lvl.cols; c++) if (getTile(lvl, c, r) === type) fn(c, r);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255;
    let g = (n >> 8) & 255;
    let b = n & 255;
    const f = (v) => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }

  /* ---------- Animated layer ---------- */
  function drawWater(ctx, lvl, t) {
    const th = themeOf(lvl);
    ctx.strokeStyle = th.water2;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    forCells(lvl, T.WATER, (c, r) => {
      const ph = hashCell(c, r) * 6.28;
      for (let i = 0; i < 2; i++) {
        const y = r * CELL + 13 + i * 14;
        const x = c * CELL + 9 + Math.sin(t * 1.6 + ph + i * 2) * 4;
        ctx.globalAlpha = 0.35 + 0.3 * Math.sin(t * 2 + ph + i);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 5, y - 4, x + 11, y);
        ctx.quadraticCurveTo(x + 16, y + 4, x + 21, y);
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  }

  function drawBoosts(ctx, lvl, t) {
    const th = themeOf(lvl);
    for (let r = 0; r < lvl.rows; r++) {
      for (let c = 0; c < lvl.cols; c++) {
        const tile = getTile(lvl, c, r);
        if (!isBoost(tile)) continue;
        const [dx, dy] = BOOST_DIR[tile];
        const { x, y } = cellCenter(c, r);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.atan2(dy, dx));
        ctx.beginPath();
        ctx.rect(-CELL / 2 + 4, -CELL / 2 + 4, CELL - 8, CELL - 8);
        ctx.clip();
        ctx.strokeStyle = th.accent;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const off = ((t * 36) % 16) - 24;
        for (let k = 0; k < 4; k++) {
          const px = off + k * 16;
          ctx.globalAlpha = Math.max(0, 1 - Math.abs(px) / 22);
          ctx.beginPath();
          ctx.moveTo(px - 5, -9);
          ctx.lineTo(px + 3, 0);
          ctx.lineTo(px - 5, 9);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawObjects(ctx, lvl, t, flashes) {
    const th = themeOf(lvl);
    const P = PP.Physics;
    for (const o of lvl.objects) {
      if (o.type === 'bumper') {
        const { x, y } = cellCenter(o.c, o.r);
        const f = (flashes && flashes.get(o)) || 0;
        const R = P.BUMPER_R * (1 + f * 0.25);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        const [bx, by] = soff(2, 5);
        ctx.ellipse(x + bx, y + by, R, R, 0, 0, Math.PI * 2);
        ctx.fill();
        if (f > 0) {
          ctx.fillStyle = th.accent;
          ctx.globalAlpha = f * 0.5;
          ctx.beginPath();
          ctx.arc(x, y, R + 10 * f, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        const g = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, R);
        g.addColorStop(0, '#fff');
        g.addColorStop(0.35, th.accent);
        g.addColorStop(1, shade(th.accent, -0.35));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, R - 4, 0, Math.PI * 2);
        ctx.stroke();
      } else if (o.type === 'spinner') {
        const s = PP.spinnerEnds(o, t);
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = P.SPINNER_W * 2 + 2;
        ctx.beginPath();
        const [sx, sy] = soff(3, 6);
        ctx.moveTo(s.ax + sx, s.ay + sy);
        ctx.lineTo(s.bx + sx, s.by + sy);
        ctx.stroke();
        ctx.strokeStyle = th.wallTop;
        ctx.lineWidth = P.SPINNER_W * 2;
        ctx.beginPath();
        ctx.moveTo(s.ax, s.ay);
        ctx.lineTo(s.bx, s.by);
        ctx.stroke();
        ctx.strokeStyle = th.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.ax, s.ay);
        ctx.lineTo(s.bx, s.by);
        ctx.stroke();
        ctx.fillStyle = th.rail;
        ctx.beginPath();
        ctx.arc(s.cx, s.cy, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = th.accent;
        ctx.beginPath();
        ctx.arc(s.cx, s.cy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawFlag(ctx, lvl, t, alpha = 1) {
    if (!lvl.hole || alpha <= 0) return;
    const th = themeOf(lvl);
    const { x, y } = cellCenter(lvl.hole.c, lvl.hole.r);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(VIEW.upright);
    ctx.translate(-x, -y);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 16, y + 6);
    ctx.stroke();
    ctx.strokeStyle = '#f5f5f5';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 44);
    ctx.stroke();
    ctx.fillStyle = th.accent;
    ctx.beginPath();
    ctx.moveTo(x + 1, y - 44);
    for (let i = 0; i <= 6; i++) {
      const fx = x + 1 + i * 4;
      const fy = y - 44 + Math.sin(t * 5 - i * 0.8) * 2 * (i / 6);
      ctx.lineTo(fx, fy + (i / 6) * 8);
    }
    for (let i = 6; i >= 0; i--) {
      const fx = x + 1 + i * 4;
      const fy = y - 28 + Math.sin(t * 5 - i * 0.8) * 2 * (i / 6);
      ctx.lineTo(fx, fy - (i / 6) * 8);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawBall(ctx, ball, lvl, scale = 1) {
    const R = PP.Physics.BALL_R * scale;
    if (R <= 0.2) return;
    const th = themeOf(lvl);
    if (ball.trail && ball.trail.length > 1) {
      ctx.lineCap = 'round';
      for (let i = 1; i < ball.trail.length; i++) {
        const a = ball.trail[i - 1];
        const b = ball.trail[i];
        const k = i / ball.trail.length;
        ctx.strokeStyle = th.accent;
        ctx.globalAlpha = k * 0.45;
        ctx.lineWidth = R * 1.6 * k;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    const [shx, shy] = soff(2.5, 4);
    ctx.ellipse(ball.x + shx, ball.y + shy, R, R, 0, 0, Math.PI * 2);
    ctx.fill();
    const [hlx, hly] = soff(-R * 0.4, -R * 0.45);
    const g = ctx.createRadialGradient(ball.x + hlx, ball.y + hly, R * 0.1, ball.x, ball.y, R);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.7, '#f1f3f8');
    g.addColorStop(1, '#c4cad6');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, R, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawAim(ctx, ball, aim, t) {
    if (!aim || aim.power <= 0) return;
    const { dx, dy, power } = aim;
    const col = power < 0.5 ? mix('#4ade80', '#facc15', power * 2) : mix('#facc15', '#ef4444', (power - 0.5) * 2);
    // power ring
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * power);
    ctx.stroke();
    // dotted guide
    const len = 40 + power * 170;
    ctx.fillStyle = '#fff';
    const off = (t * 40) % 12;
    for (let d = 26 + off; d < len; d += 12) {
      const k = 1 - d / (len + 20);
      ctx.globalAlpha = k;
      ctx.beginPath();
      ctx.arc(ball.x + dx * d, ball.y + dy * d, 2.6 * k + 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // arrow head
    const hx = ball.x + dx * (len + 6);
    const hy = ball.y + dy * (len + 6);
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-6, -7);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function mix(a, b, k) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ch = (s) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }

  function drawParticles(ctx, parts) {
    for (const p of parts) {
      const k = 1 - p.age / p.life;
      if (k <= 0) continue;
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.fillStyle = p.color;
      if (p.shape === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2 * k + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.6 - k), 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.shape === 'rect') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * k, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.level = null;
      this.cache = document.createElement('canvas');
      this.dirty = true;
      this.crop = false; // fit the view to the course bounds
      this.allowRotate = false; // turn the course 90° when that gives a much bigger view
      this.rotated = false;
      this.m = [1, 0, 0, 1, 0, 0];
    }

    /** World rect currently framed by the camera. */
    view() {
      const lvl = this.level;
      const full = { x: 0, y: 0, w: (lvl ? lvl.cols : PP.COLS) * CELL, h: (lvl ? lvl.rows : PP.ROWS) * CELL };
      if (!lvl || !this.crop) return full;
      let c0 = Infinity, r0 = Infinity, c1 = -Infinity, r1 = -Infinity;
      for (let r = 0; r < lvl.rows; r++)
        for (let c = 0; c < lvl.cols; c++)
          if (getTile(lvl, c, r) !== T.VOID) {
            c0 = Math.min(c0, c); r0 = Math.min(r0, r);
            c1 = Math.max(c1, c); r1 = Math.max(r1, r);
          }
      if (c0 === Infinity) return full;
      const pad = 0.75;
      let x = (c0 - pad) * CELL, y = (r0 - pad) * CELL;
      let w = (c1 - c0 + 1 + pad * 2) * CELL, h = (r1 - r0 + 1 + pad * 2) * CELL;
      const minW = 10 * CELL, minH = 7 * CELL;
      if (w < minW) { x -= (minW - w) / 2; w = minW; }
      if (h < minH) { y -= (minH - h) / 2; h = minH; }
      return { x, y, w, h };
    }

    /** Best canvas aspect ratio (w/h) for the available CSS box; decides rotation. */
    aspectFor(aw, ah) {
      const v = this.view();
      const normal = Math.min(aw / v.w, ah / v.h);
      const turned = Math.min(aw / v.h, ah / v.w);
      this.rotated = this.allowRotate && turned > normal * 1.2;
      return this.rotated ? v.h / v.w : v.w / v.h;
    }

    resize(cssW, cssH) {
      const dpr = Math.min(G.devicePixelRatio || 1, 2);
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
      this.cssW = cssW;
      this.cssH = cssH;
      this.dirty = true;
      this.fit();
    }

    fit() {
      const v = this.view();
      const cw = this.canvas.width;
      const ch = this.canvas.height;
      if (this.rotated) {
        // world +x -> screen down, world +y -> screen left
        const s = Math.min(cw / v.h, ch / v.w);
        const ox = (cw - v.h * s) / 2;
        const oy = (ch - v.w * s) / 2;
        this.m = [0, s, -s, 0, ox + (v.y + v.h) * s, oy - v.x * s];
        VIEW.down = [1, 0];
        VIEW.right = [0, -1];
        VIEW.upright = -Math.PI / 2;
      } else {
        const s = Math.min(cw / v.w, ch / v.h);
        const ox = (cw - v.w * s) / 2;
        const oy = (ch - v.h * s) / 2;
        this.m = [s, 0, 0, s, ox - v.x * s, oy - v.y * s];
        VIEW.down = [0, 1];
        VIEW.right = [1, 0];
        VIEW.upright = 0;
      }
      this.scale = Math.hypot(this.m[0], this.m[1]);
    }

    setLevel(lvl, { crop = false, rotate = false } = {}) {
      this.level = lvl;
      this.crop = crop;
      this.allowRotate = rotate;
      if (!rotate) this.rotated = false;
      this.dirty = true;
      this.fit();
    }

    invalidate() {
      this.dirty = true;
    }

    /** CSS client coords -> world coords. */
    toWorld(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const k = this.canvas.width / rect.width;
      const X = (clientX - rect.left) * k - this.m[4];
      const Y = (clientY - rect.top) * k - this.m[5];
      const [a, b, c, d] = this.m;
      const det = a * d - b * c;
      return { x: (d * X - c * Y) / det, y: (-b * X + a * Y) / det };
    }

    /** Screen-space direction -> world-space direction (unnormalized). */
    screenDirToWorld(dx, dy) {
      const [a, b, c, d] = this.m;
      const det = a * d - b * c;
      return { x: (d * dx - c * dy) / det, y: (-b * dx + a * dy) / det };
    }

    begin() {
      const { ctx, canvas } = this;
      this.fit();
      if (this.dirty) {
        this.cache.width = canvas.width;
        this.cache.height = canvas.height;
        const c = this.cache.getContext('2d');
        c.setTransform(...this.m);
        if (this.level) drawStatic(c, this.level);
        this.dirty = false;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.cache, 0, 0);
      ctx.setTransform(...this.m);
      return ctx;
    }

    /** Switch to raw device pixels (for HUD-style overlays). */
    screenSpace() {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      return this.ctx;
    }

    drawWorld(t, opts = {}) {
      const { ctx, level: lvl } = this;
      if (!lvl) return;
      drawWater(ctx, lvl, t);
      drawBoosts(ctx, lvl, t);
      drawObjects(ctx, lvl, opts.objTime != null ? opts.objTime : t, opts.flashes);
      if (opts.ball && !opts.ballOnTop) this.drawBallAndAim(t, opts);
      drawFlag(ctx, lvl, t, opts.flagAlpha != null ? opts.flagAlpha : 1);
      if (opts.ball && opts.ballOnTop) this.drawBallAndAim(t, opts);
      if (opts.particles) drawParticles(ctx, opts.particles);
    }

    drawBallAndAim(t, opts) {
      if (opts.aim) drawAim(this.ctx, opts.ball, opts.aim, t);
      drawBall(this.ctx, opts.ball, this.level, opts.ballScale != null ? opts.ballScale : 1);
    }

    drawGrid() {
      const { ctx, level: lvl } = this;
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 0; c <= lvl.cols; c++) {
        ctx.moveTo(c * CELL, 0);
        ctx.lineTo(c * CELL, lvl.rows * CELL);
      }
      for (let r = 0; r <= lvl.rows; r++) {
        ctx.moveTo(0, r * CELL);
        ctx.lineTo(lvl.cols * CELL, r * CELL);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.strokeRect(0, 0, lvl.cols * CELL, lvl.rows * CELL);
    }

    drawHover(cells, color) {
      const { ctx } = this;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35;
      cells.forEach(({ c, r }) => ctx.fillRect(c * CELL, r * CELL, CELL, CELL));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      cells.forEach(({ c, r }) => ctx.strokeRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2));
    }

    drawTeeMarker(t) {
      const { ctx, level: lvl } = this;
      if (!lvl.tee) return;
      const { x, y } = cellCenter(lvl.tee.c, lvl.tee.r);
      drawBall(ctx, { x, y: y + Math.sin(t * 3) * 1.5 }, lvl);
    }
  }

  /** Small static preview of a level for lists. */
  function renderThumbnail(lvl, width) {
    const W = lvl.cols * CELL;
    const H = lvl.rows * CELL;
    const cv = document.createElement('canvas');
    const dpr = Math.min(G.devicePixelRatio || 1, 2);
    cv.width = Math.round(width * dpr);
    cv.height = Math.round((width * H) / W * dpr);
    const ctx = cv.getContext('2d');
    const s = cv.width / W;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const saved = { ...VIEW };
    Object.assign(VIEW, { down: [0, 1], right: [1, 0], upright: 0 });
    drawStatic(ctx, lvl);
    drawBoosts(ctx, lvl, 0.3);
    drawObjects(ctx, lvl, 0);
    drawFlag(ctx, lvl, 0);
    if (lvl.tee) drawBall(ctx, cellCenter(lvl.tee.c, lvl.tee.r), lvl);
    Object.assign(VIEW, saved);
    return cv;
  }

  PP.Renderer = Renderer;
  PP.renderThumbnail = renderThumbnail;
  PP.themeOf = themeOf;
})(typeof window !== 'undefined' ? window : globalThis);

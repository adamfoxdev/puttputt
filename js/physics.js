/* Ball physics: fixed-step integration, surface friction, tile/bumper/spinner collisions, cup capture. */
(function (G) {
  'use strict';
  const PP = G.PP;
  const { T, CELL, BOOST_DIR, isSolid, isBoost, getTile, tileAtPx, cellCenter } = PP;

  const P = {
    BALL_R: 7,
    HOLE_R: 12,
    BUMPER_R: 13,
    SPINNER_LEN: 54, // half length of the bar
    SPINNER_W: 5, // half thickness
    MAX_SHOT: 1050,
    STEP: 1 / 240,
    WALL_REST: 0.72,
    BOOST_ACC: 1500,
    CAPTURE_SPEED: 430,
    HOLE_PULL: 900,
    STOP_SPEED: 6,
  };

  // k: proportional drag (1/s), d: constant rolling resistance (px/s^2)
  const SURFACE = {
    [T.GRASS]: { k: 0.85, d: 60 },
    [T.SAND]: { k: 3.4, d: 300 },
    [T.ICE]: { k: 0.25, d: 14 },
    [T.WATER]: { k: 0.85, d: 60 },
  };
  const surfaceOf = (t) => SURFACE[t] || SURFACE[T.GRASS];

  const spinnerAngle = (o, t) => (o.phase || 0) + t * (o.speed || 0);

  function spinnerEnds(o, t) {
    const { x, y } = cellCenter(o.c, o.r);
    const a = spinnerAngle(o, t);
    const dx = Math.cos(a) * P.SPINNER_LEN;
    const dy = Math.sin(a) * P.SPINNER_LEN;
    return { cx: x, cy: y, ax: x - dx, ay: y - dy, bx: x + dx, by: y + dy };
  }

  class Sim {
    constructor(level) {
      this.level = level;
      this.time = 0;
      const h = level.hole ? cellCenter(level.hole.c, level.hole.r) : { x: -999, y: -999 };
      this.hx = h.x;
      this.hy = h.y;
    }

    /** Advance one fixed step. Pushes {type,...} into events. */
    step(ball, events) {
      const dt = P.STEP;
      this.time += dt;
      if (ball.sunk) return;
      if (!ball.moving) {
        // A resting ball can still be swatted by a spinner sweeping through it.
        this.collideObjects(ball, events, true);
        if (Math.hypot(ball.vx, ball.vy) > 1) {
          ball.moving = true;
          ball.rollTime = ball.slowTime = 0;
          events.push({ type: 'knock', x: ball.x, y: ball.y });
        }
        return;
      }
      const lvl = this.level;
      const t = tileAtPx(lvl, ball.x, ball.y);

      if (t === T.WATER) {
        ball.moving = false;
        ball.vx = ball.vy = 0;
        events.push({ type: 'water', x: ball.x, y: ball.y });
        return;
      }

      // Boost pads
      const boosting = isBoost(t);
      if (boosting) {
        const [dx, dy] = BOOST_DIR[t];
        ball.vx += dx * P.BOOST_ACC * dt;
        ball.vy += dy * P.BOOST_ACC * dt;
      }

      // Cup: gentle pull near the rim, capture if slow enough.
      const hdx = this.hx - ball.x;
      const hdy = this.hy - ball.y;
      const hd = Math.hypot(hdx, hdy);
      let speed = Math.hypot(ball.vx, ball.vy);
      if (hd < P.HOLE_R + 3) {
        if (hd < P.HOLE_R - 2 && speed < P.CAPTURE_SPEED) {
          ball.moving = false;
          ball.sunk = true;
          events.push({ type: 'sink', x: this.hx, y: this.hy, speed });
          return;
        }
        if (hd > 0.001) {
          ball.vx += (hdx / hd) * P.HOLE_PULL * dt;
          ball.vy += (hdy / hd) * P.HOLE_PULL * dt;
        }
      }

      // Friction
      const s = boosting ? SURFACE[T.GRASS] : surfaceOf(t);
      speed = Math.hypot(ball.vx, ball.vy);
      if (speed > 0) {
        const ns = Math.max(0, speed * Math.exp(-s.k * dt) - s.d * dt);
        const f = ns / speed;
        ball.vx *= f;
        ball.vy *= f;
        speed = ns;
      }
      if (speed > P.MAX_SHOT * 1.6) {
        const f = (P.MAX_SHOT * 1.6) / speed;
        ball.vx *= f;
        ball.vy *= f;
      }

      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      this.collideTiles(ball, events);
      this.collideObjects(ball, events);

      speed = Math.hypot(ball.vx, ball.vy);
      ball.slowTime = speed < 12 ? (ball.slowTime || 0) + dt : 0;
      ball.rollTime = (ball.rollTime || 0) + dt;
      const nearCup = hd < P.HOLE_R + 3;
      if ((speed < P.STOP_SPEED && !boosting && !nearCup) || ball.slowTime > 1.2 || ball.rollTime > 30) {
        ball.vx = ball.vy = 0;
        ball.moving = false;
        events.push({ type: 'stop', x: ball.x, y: ball.y });
      }
    }

    collideTiles(ball, events) {
      const r = P.BALL_R;
      const lvl = this.level;
      const c0 = Math.floor((ball.x - r) / CELL);
      const c1 = Math.floor((ball.x + r) / CELL);
      const r0 = Math.floor((ball.y - r) / CELL);
      const r1 = Math.floor((ball.y + r) / CELL);
      for (let rr = r0; rr <= r1; rr++) {
        for (let cc = c0; cc <= c1; cc++) {
          if (!isSolid(getTile(lvl, cc, rr))) continue;
          const rx = cc * CELL;
          const ry = rr * CELL;
          const px = Math.max(rx, Math.min(ball.x, rx + CELL));
          const py = Math.max(ry, Math.min(ball.y, ry + CELL));
          let dx = ball.x - px;
          let dy = ball.y - py;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          let nx, ny, pen;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            nx = dx / d;
            ny = dy / d;
            pen = r - d;
          } else {
            // Center inside the block: push out along the shallowest axis.
            const left = ball.x - rx;
            const right = rx + CELL - ball.x;
            const top = ball.y - ry;
            const bottom = ry + CELL - ball.y;
            const m = Math.min(left, right, top, bottom);
            if (m === left) [nx, ny, pen] = [-1, 0, left + r];
            else if (m === right) [nx, ny, pen] = [1, 0, right + r];
            else if (m === top) [nx, ny, pen] = [0, -1, top + r];
            else [nx, ny, pen] = [0, 1, bottom + r];
          }
          ball.x += nx * pen;
          ball.y += ny * pen;
          const vn = ball.vx * nx + ball.vy * ny;
          if (vn < 0) {
            ball.vx -= (1 + P.WALL_REST) * vn * nx;
            ball.vy -= (1 + P.WALL_REST) * vn * ny;
            if (-vn > 40) events.push({ type: 'bounce', x: px, y: py, power: -vn });
          }
        }
      }
    }

    collideObjects(ball, events, spinnersOnly = false) {
      const r = P.BALL_R;
      for (const o of this.level.objects) {
        if (o.type === 'bumper') {
          if (spinnersOnly) continue;
          const { x, y } = cellCenter(o.c, o.r);
          const dx = ball.x - x;
          const dy = ball.y - y;
          const d = Math.hypot(dx, dy);
          const min = r + P.BUMPER_R;
          if (d >= min) continue;
          const nx = d > 1e-6 ? dx / d : 1;
          const ny = d > 1e-6 ? dy / d : 0;
          ball.x = x + nx * min;
          ball.y = y + ny * min;
          const vn = ball.vx * nx + ball.vy * ny;
          if (vn < 0) {
            const out = Math.max(-vn * 1.08, 320);
            ball.vx += (-vn + out) * nx;
            ball.vy += (-vn + out) * ny;
            events.push({ type: 'bumper', obj: o, x: x + nx * P.BUMPER_R, y: y + ny * P.BUMPER_R, power: out });
          }
        } else if (o.type === 'spinner') {
          const s = spinnerEnds(o, this.time);
          const abx = s.bx - s.ax;
          const aby = s.by - s.ay;
          let u = ((ball.x - s.ax) * abx + (ball.y - s.ay) * aby) / (abx * abx + aby * aby);
          u = Math.max(0, Math.min(1, u));
          const px = s.ax + abx * u;
          const py = s.ay + aby * u;
          const dx = ball.x - px;
          const dy = ball.y - py;
          const d = Math.hypot(dx, dy);
          const min = r + P.SPINNER_W;
          if (d >= min) continue;
          let nx, ny;
          if (d > 1e-6) {
            nx = dx / d;
            ny = dy / d;
          } else {
            const l = Math.hypot(abx, aby);
            nx = -aby / l;
            ny = abx / l;
          }
          ball.x = px + nx * min;
          ball.y = py + ny * min;
          // Surface velocity of the bar at the contact point.
          const w = o.speed || 0;
          const svx = -w * (py - s.cy);
          const svy = w * (px - s.cx);
          const rvn = (ball.vx - svx) * nx + (ball.vy - svy) * ny;
          if (rvn < 0) {
            ball.vx -= 1.75 * rvn * nx;
            ball.vy -= 1.75 * rvn * ny;
            if (-rvn > 30) events.push({ type: 'bounce', x: px, y: py, power: -rvn });
          }
        }
      }
    }
  }

  PP.Physics = P;
  PP.Sim = Sim;
  PP.spinnerAngle = spinnerAngle;
  PP.spinnerEnds = spinnerEnds;
})(typeof window !== 'undefined' ? window : globalThis);

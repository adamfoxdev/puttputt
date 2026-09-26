/* Procedural level generator: winding corridors + rooms, then hazards and obstacles.
   Every level is validated to have a clear tee -> hole path before it is returned. */
(function (G) {
  'use strict';
  const PP = G.PP;
  const { T, COLS, ROWS, RNG, createLevel, getTile, setTile, findPath, computePar, objectAt } = PP;

  const ADJ = ['Crooked', 'Lazy', 'Neon', 'Windy', 'Sunken', 'Twisty', 'Hidden', 'Frosty', 'Dusty', 'Lucky',
    'Wobbly', 'Secret', 'Rusty', 'Velvet', 'Cosmic', 'Sleepy', 'Rapid', 'Mellow', 'Jagged', 'Golden'];
  const NOUN = ['Canyon', 'Lagoon', 'Alley', 'Bend', 'Maze', 'Hollow', 'Ridge', 'Loop', 'Gulch', 'Garden',
    'Switchback', 'Causeway', 'Quarry', 'Terrace', 'Chicane', 'Spiral', 'Harbor', 'Crossing', 'Dunes', 'Pass'];

  const M = 2; // min distance of a waypoint from the edge

  function generateLevel(seed, opts = {}) {
    const difficulty = Math.max(1, Math.min(3, opts.difficulty || 2));
    for (let attempt = 0; attempt < 80; attempt++) {
      const rng = new RNG(`${seed}|${difficulty}|${attempt}`);
      const lvl = tryGenerate(rng, difficulty);
      if (lvl) {
        lvl.name = `${rng.pick(ADJ)} ${rng.pick(NOUN)}`;
        return lvl;
      }
    }
    return fallbackLevel();
  }

  function generateCourse(seed, holes = 9, opts = {}) {
    const out = [];
    for (let i = 0; i < holes; i++) out.push(generateLevel(`${seed}#${i + 1}`, opts));
    return out;
  }

  function tryGenerate(rng, difficulty) {
    const lvl = createLevel(COLS, ROWS);
    const carve = (c0, r0, w, h, t = T.GRASS) => {
      for (let r = r0; r < r0 + h; r++)
        for (let c = c0; c < c0 + w; c++)
          if (c >= 1 && r >= 1 && c < COLS - 1 && r < ROWS - 1) setTile(lvl, c, r, t);
    };

    /* 1. Waypoints: an axis-alternating random walk. */
    const pts = [{ c: rng.int(M, COLS - M - 1), r: rng.int(M, ROWS - M - 1) }];
    const nSeg = rng.int(2 + difficulty, 3 + difficulty);
    let axis = rng.chance(0.5) ? 'h' : 'v';
    for (let i = 0; i < nSeg; i++) {
      const p = pts[pts.length - 1];
      let q = null;
      for (let tries = 0; tries < 24 && !q; tries++) {
        const len = rng.int(4, axis === 'h' ? 13 : 9) * (rng.chance(0.5) ? 1 : -1);
        const cand = axis === 'h' ? { c: p.c + len, r: p.r } : { c: p.c, r: p.r + len };
        if (cand.c < M || cand.r < M || cand.c > COLS - M - 1 || cand.r > ROWS - M - 1) continue;
        if (pts.slice(0, -1).some((o) => Math.abs(o.c - cand.c) + Math.abs(o.r - cand.r) < 5)) continue;
        q = cand;
      }
      if (!q) break;
      pts.push(q);
      axis = axis === 'h' ? 'v' : 'h';
    }
    if (pts.length < 3) return null;

    /* 2. Carve corridors and rooms. */
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const w = difficulty === 3 ? rng.int(2, 3) : rng.int(2, 4);
      const o = Math.floor((w - 1) / 2);
      if (a.r === b.r) {
        carve(Math.min(a.c, b.c) - o, a.r - o, Math.abs(a.c - b.c) + w, w);
      } else {
        carve(a.c - o, Math.min(a.r, b.r) - o, w, Math.abs(a.r - b.r) + w);
      }
      segs.push({ a, b, w, o });
    }
    const rooms = [];
    pts.forEach((p, i) => {
      const isEnd = i === 0 || i === pts.length - 1;
      if (rng.chance(isEnd ? 0.35 : 0.45)) {
        const rw = rng.int(4, 7);
        const rh = rng.int(3, 6);
        const c0 = Math.max(1, Math.min(COLS - 1 - rw, p.c - Math.floor(rw / 2)));
        const r0 = Math.max(1, Math.min(ROWS - 1 - rh, p.r - Math.floor(rh / 2)));
        carve(c0, r0, rw, rh);
        rooms.push({ c0, r0, w: rw, h: rh });
      }
    });

    const tee = pts[0];
    const hole = pts[pts.length - 1];
    lvl.tee = { c: tee.c, r: tee.r };
    lvl.hole = { c: hole.c, r: hole.r };

    const basePath = findPath(lvl);
    if (!basePath || basePath.length < 14) return null;

    const nearKey = (c, r, p, d) => Math.max(Math.abs(c - p.c), Math.abs(r - p.r)) <= d;
    const protectedCell = (c, r) => nearKey(c, r, tee, 1) || nearKey(c, r, hole, 1);
    const grassCells = () => {
      const cells = [];
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          if (getTile(lvl, c, r) === T.GRASS && !protectedCell(c, r)) cells.push({ c, r });
      return cells;
    };
    const stillSolvable = () => {
      const p = findPath(lvl);
      return p && p.length >= 10;
    };
    /** Apply a change; revert if it breaks the course. */
    const tryChange = (cells, t) => {
      const before = cells.map(({ c, r }) => getTile(lvl, c, r));
      cells.forEach(({ c, r }) => setTile(lvl, c, r, t));
      if (stillSolvable()) return true;
      cells.forEach(({ c, r }, i) => setTile(lvl, c, r, before[i]));
      return false;
    };
    const blob = (start, size) => {
      const cells = [start];
      const seen = new Set([start.c + ',' + start.r]);
      for (let guard = 0; cells.length < size && guard < size * 12; guard++) {
        const from = rng.pick(cells);
        const [dc, dr] = rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
        const n = { c: from.c + dc, r: from.r + dr };
        const k = n.c + ',' + n.r;
        if (seen.has(k) || getTile(lvl, n.c, n.r) !== T.GRASS || protectedCell(n.c, n.r)) continue;
        seen.add(k);
        cells.push(n);
      }
      return cells;
    };

    /* 3. Pillars inside larger rooms. */
    rooms.forEach((room) => {
      if (room.w >= 5 && room.h >= 4 && rng.chance(0.55)) {
        const c = room.c0 + Math.floor(room.w / 2) - (rng.chance(0.5) ? 1 : 0);
        const r = room.r0 + Math.floor(room.h / 2);
        const cells = rng.chance(0.5) ? [{ c, r }] : [{ c, r }, { c: c + 1, r }];
        if (cells.every((p) => getTile(lvl, p.c, p.r) === T.GRASS && !protectedCell(p.c, p.r))) tryChange(cells, T.WALL);
      }
    });

    /* 4. Boost pads across long corridors, pointing along the route. */
    segs.forEach((s) => {
      const len = Math.abs(s.a.c - s.b.c) + Math.abs(s.a.r - s.b.r);
      if (len < 6 || !rng.chance(0.2 + 0.12 * difficulty)) return;
      const horiz = s.a.r === s.b.r;
      const sign = horiz ? Math.sign(s.b.c - s.a.c) : Math.sign(s.b.r - s.a.r);
      const dirTile = horiz ? (sign > 0 ? T.BOOST_E : T.BOOST_W) : sign > 0 ? T.BOOST_S : T.BOOST_N;
      const at = rng.int(2, len - 3);
      const cells = [];
      for (let k = 0; k < s.w; k++) {
        const c = horiz ? s.a.c + sign * at : s.a.c - s.o + k;
        const r = horiz ? s.a.r - s.o + k : s.a.r + sign * at;
        if (getTile(lvl, c, r) === T.GRASS && !protectedCell(c, r)) cells.push({ c, r });
      }
      if (cells.length) tryChange(cells, dirTile);
    });

    /* 5. Terrain hazards. */
    const sandCount = rng.int(difficulty - 1, difficulty + 1);
    for (let i = 0; i < sandCount; i++) {
      const cells = grassCells();
      if (!cells.length) break;
      tryChange(blob(rng.pick(cells), rng.int(3, 8)), T.SAND);
    }
    if (rng.chance(0.2 + 0.1 * difficulty)) {
      const cells = grassCells();
      if (cells.length) tryChange(blob(rng.pick(cells), rng.int(4, 10)), T.ICE);
    }
    const waterCount = rng.int(Math.max(0, difficulty - 2), difficulty);
    for (let i = 0; i < waterCount; i++) {
      const cells = grassCells();
      if (!cells.length) break;
      tryChange(blob(rng.pick(cells), rng.int(2, 6)), T.WATER);
    }

    /* 6. Objects: bumpers and spinners in open areas. */
    const openAround = (c, r, rad) => {
      for (let dr = -rad; dr <= rad; dr++)
        for (let dc = -rad; dc <= rad; dc++) {
          const t = getTile(lvl, c + dc, r + dr);
          if (PP.isSolid(t) || objectAt(lvl, c + dc, r + dr)) return false;
        }
      return true;
    };
    const farFromEnds = (c, r) => !nearKey(c, r, tee, 2) && !nearKey(c, r, hole, 2);
    if (difficulty >= 2) {
      rng.shuffle(rooms.slice()).forEach((room) => {
        if (room.w < 5 || room.h < 5 || !rng.chance(0.35 + 0.15 * difficulty)) return;
        const c = room.c0 + Math.floor(room.w / 2);
        const r = room.r0 + Math.floor(room.h / 2);
        if (!farFromEnds(c, r) || !openAround(c, r, 1)) return;
        lvl.objects.push({ type: 'spinner', c, r, speed: rng.pick([-1, 1]) * rng.float(1.0, 1.4 + 0.3 * difficulty), phase: rng.float(0, Math.PI) });
      });
    }
    const bumperCount = rng.int(0, difficulty + 1);
    for (let i = 0, guard = 0; i < bumperCount && guard < 40; guard++) {
      const cells = grassCells();
      if (!cells.length) break;
      const p = rng.pick(cells);
      if (!farFromEnds(p.c, p.r) || !openAround(p.c, p.r, 1)) continue;
      const obj = { type: 'bumper', c: p.c, r: p.r };
      lvl.objects.push(obj);
      if (!stillSolvable()) lvl.objects.pop();
      else i++;
    }

    if (!stillSolvable()) return null;
    lvl.theme = rng.int(0, PP.THEMES.length - 1);
    lvl.autoPar = true;
    lvl.par = computePar(lvl);
    return lvl;
  }

  function fallbackLevel() {
    const lvl = createLevel(COLS, ROWS);
    for (let r = 6; r < 10; r++) for (let c = 2; c < COLS - 2; c++) setTile(lvl, c, r, T.GRASS);
    lvl.tee = { c: 3, r: 8 };
    lvl.hole = { c: COLS - 4, r: 7 };
    lvl.name = 'Straight Shot';
    lvl.par = 2;
    return lvl;
  }

  Object.assign(PP, { generateLevel, generateCourse });
})(typeof window !== 'undefined' ? window : globalThis);

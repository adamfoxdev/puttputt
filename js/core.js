/* Core: constants, tiles, RNG, level model, serialization, pathing, themes. */
(function (G) {
  'use strict';
  const PP = (G.PP = G.PP || {});

  const COLS = 24;
  const ROWS = 16;
  const CELL = 40;

  const T = {
    VOID: 0,
    GRASS: 1,
    WALL: 2,
    SAND: 3,
    WATER: 4,
    ICE: 5,
    BOOST_N: 6,
    BOOST_E: 7,
    BOOST_S: 8,
    BOOST_W: 9,
  };

  const BOOST_DIR = {
    [T.BOOST_N]: [0, -1],
    [T.BOOST_E]: [1, 0],
    [T.BOOST_S]: [0, 1],
    [T.BOOST_W]: [-1, 0],
  };

  const isSolid = (t) => t === T.VOID || t === T.WALL;
  const isBoost = (t) => t >= T.BOOST_N && t <= T.BOOST_W;
  const isGround = (t) => !isSolid(t);

  /* ---------- RNG ---------- */
  function hashString(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  class RNG {
    constructor(seed) {
      this.s = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
    }
    next() {
      let t = (this.s = (this.s + 0x6d2b79f5) | 0);
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    float(a = 0, b = 1) {
      return a + this.next() * (b - a);
    }
    int(a, b) {
      return a + Math.floor(this.next() * (b - a + 1));
    }
    chance(p) {
      return this.next() < p;
    }
    pick(arr) {
      return arr[Math.floor(this.next() * arr.length)];
    }
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
  }

  /* ---------- Level model ---------- */
  function createLevel(cols = COLS, rows = ROWS) {
    return {
      name: 'Untitled',
      par: 3,
      autoPar: true,
      theme: 0,
      cols,
      rows,
      tiles: new Array(cols * rows).fill(T.VOID),
      tee: null,
      hole: null,
      objects: [],
    };
  }

  const inBounds = (lvl, c, r) => c >= 0 && r >= 0 && c < lvl.cols && r < lvl.rows;
  const getTile = (lvl, c, r) => (inBounds(lvl, c, r) ? lvl.tiles[r * lvl.cols + c] : T.VOID);
  function setTile(lvl, c, r, t) {
    if (inBounds(lvl, c, r)) lvl.tiles[r * lvl.cols + c] = t;
  }
  const tileAtPx = (lvl, x, y) => getTile(lvl, Math.floor(x / CELL), Math.floor(y / CELL));
  const cellCenter = (c, r) => ({ x: (c + 0.5) * CELL, y: (r + 0.5) * CELL });
  const objectAt = (lvl, c, r) => lvl.objects.find((o) => o.c === c && o.r === r);

  function cloneLevel(lvl) {
    return deserialize(serialize(lvl));
  }

  function serialize(lvl) {
    return {
      v: 1,
      name: lvl.name,
      par: lvl.par,
      autoPar: !!lvl.autoPar,
      theme: lvl.theme,
      cols: lvl.cols,
      rows: lvl.rows,
      tiles: lvl.tiles.join(''),
      tee: lvl.tee ? [lvl.tee.c, lvl.tee.r] : null,
      hole: lvl.hole ? [lvl.hole.c, lvl.hole.r] : null,
      objects: lvl.objects.map((o) => ({ ...o })),
    };
  }

  function deserialize(data) {
    if (typeof data === 'string') data = JSON.parse(data);
    if (!data || typeof data !== 'object') throw new Error('Invalid level data');
    const cols = clampInt(data.cols, 4, 64, COLS);
    const rows = clampInt(data.rows, 4, 64, ROWS);
    const lvl = createLevel(cols, rows);
    lvl.name = String(data.name || 'Untitled').slice(0, 40);
    lvl.par = clampInt(data.par, 1, 9, 3);
    lvl.autoPar = data.autoPar !== false;
    lvl.theme = clampInt(data.theme, 0, THEMES.length - 1, 0);
    const str = String(data.tiles || '');
    for (let i = 0; i < cols * rows; i++) {
      const t = str.charCodeAt(i) - 48;
      lvl.tiles[i] = t >= 0 && t <= 9 ? t : T.VOID;
    }
    const pt = (p) =>
      Array.isArray(p) && inBounds(lvl, p[0] | 0, p[1] | 0) ? { c: p[0] | 0, r: p[1] | 0 } : null;
    lvl.tee = pt(data.tee);
    lvl.hole = pt(data.hole);
    lvl.objects = (Array.isArray(data.objects) ? data.objects : [])
      .filter((o) => o && (o.type === 'bumper' || o.type === 'spinner') && inBounds(lvl, o.c | 0, o.r | 0))
      .map((o) => {
        const obj = { type: o.type, c: o.c | 0, r: o.r | 0 };
        if (o.type === 'spinner') {
          obj.speed = Number.isFinite(o.speed) ? Math.max(-4, Math.min(4, o.speed)) : 1.4;
          obj.phase = Number.isFinite(o.phase) ? o.phase : 0;
        }
        return obj;
      });
    return lvl;
  }

  function clampInt(v, lo, hi, dflt) {
    v = parseInt(v, 10);
    if (!Number.isFinite(v)) return dflt;
    return Math.max(lo, Math.min(hi, v));
  }

  /* Compact, URL-safe share codes: RLE the tile string, JSON, base64url. */
  function encodeShare(lvl) {
    const s = serialize(lvl);
    let rle = '';
    for (let i = 0; i < s.tiles.length; ) {
      let j = i;
      while (j < s.tiles.length && s.tiles[j] === s.tiles[i]) j++;
      const n = j - i;
      // Tiles become uppercase letters, run lengths lowercase base36: unambiguous.
      rle += String.fromCharCode(65 + +s.tiles[i]) + (n > 1 ? n.toString(36) : '');
      i = j;
    }
    s.tiles = undefined;
    s.rle = rle;
    const json = JSON.stringify(s);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeShare(code) {
    code = String(code).trim().replace(/-/g, '+').replace(/_/g, '/');
    while (code.length % 4) code += '=';
    const bin = atob(code);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (data.rle != null) {
      let tiles = '';
      const re = /([A-J])([0-9a-z]*)/g;
      let m;
      while ((m = re.exec(data.rle))) {
        tiles += String(m[1].charCodeAt(0) - 65).repeat(m[2] ? parseInt(m[2], 36) : 1);
      }
      data.tiles = tiles;
    }
    return deserialize(data);
  }

  /* ---------- Pathing & analysis ---------- */
  function isPassableCell(lvl, c, r) {
    const t = getTile(lvl, c, r);
    if (isSolid(t) || t === T.WATER) return false;
    const o = objectAt(lvl, c, r);
    return !(o && o.type === 'bumper');
  }

  /** BFS tee -> hole. Returns array of {c,r} or null. */
  function findPath(lvl) {
    if (!lvl.tee || !lvl.hole) return null;
    const { cols, rows } = lvl;
    const prev = new Int32Array(cols * rows).fill(-2);
    const start = lvl.tee.r * cols + lvl.tee.c;
    const goal = lvl.hole.r * cols + lvl.hole.c;
    if (!isPassableCell(lvl, lvl.tee.c, lvl.tee.r) || !isPassableCell(lvl, lvl.hole.c, lvl.hole.r)) return null;
    const q = [start];
    prev[start] = -1;
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi];
      if (cur === goal) break;
      const c = cur % cols;
      const r = (cur / cols) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc;
        const nr = r + dr;
        if (!inBounds(lvl, nc, nr)) continue;
        const ni = nr * cols + nc;
        if (prev[ni] !== -2 || !isPassableCell(lvl, nc, nr)) continue;
        prev[ni] = cur;
        q.push(ni);
      }
    }
    if (prev[goal] === -2) return null;
    const path = [];
    for (let i = goal; i !== -1; i = prev[i]) path.push({ c: i % cols, r: (i / cols) | 0 });
    return path.reverse();
  }

  /** Can a ball roll straight between two cell centers without touching blockers? */
  function lineOfSight(lvl, a, b) {
    const A = cellCenter(a.c, a.r);
    const B = cellCenter(b.c, b.r);
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return true;
    const nx = -dy / len;
    const ny = dx / len;
    const off = 9;
    const steps = Math.ceil(len / 8);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = A.x + dx * t;
      const y = A.y + dy * t;
      for (const s of [-off, 0, off]) {
        const px = x + nx * s;
        const py = y + ny * s;
        const c = Math.floor(px / CELL);
        const r = Math.floor(py / CELL);
        if (!isPassableCell(lvl, c, r)) return false;
      }
    }
    return true;
  }

  /** Estimate par by string-pulling the BFS path into straight shots. */
  function computePar(lvl) {
    const path = findPath(lvl);
    if (!path) return 3;
    let shots = 0;
    let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      while (j > i + 1 && !lineOfSight(lvl, path[i], path[j])) j--;
      const d = Math.hypot(path[j].c - path[i].c, path[j].r - path[i].r);
      shots += 1 + Math.floor(d / 20);
      i = j;
    }
    let hazard = 0;
    for (const p of path) {
      const t = getTile(lvl, p.c, p.r);
      if (t === T.SAND) hazard += 0.15;
    }
    if (lvl.objects.some((o) => o.type === 'spinner')) hazard += 0.5;
    return Math.max(2, Math.min(6, Math.round(shots + 0.4 + hazard)));
  }

  function validateLevel(lvl) {
    const errors = [];
    if (!lvl.tee) errors.push('Place a tee (start).');
    if (!lvl.hole) errors.push('Place a hole (cup).');
    if (lvl.tee && isSolid(getTile(lvl, lvl.tee.c, lvl.tee.r))) errors.push('The tee sits on a wall or void.');
    if (lvl.hole && isSolid(getTile(lvl, lvl.hole.c, lvl.hole.r))) errors.push('The hole sits on a wall or void.');
    if (!errors.length && !findPath(lvl)) errors.push('No clear path from tee to hole.');
    return { ok: errors.length === 0, errors };
  }

  /* ---------- Themes ---------- */
  const THEMES = [
    {
      name: 'Midnight',
      bg0: '#0a0f1f', bg1: '#18204a', dots: 'rgba(255,255,255,0.05)',
      rail: '#e9edff', railShade: '#8e98c9',
      grass0: '#2ec27e', grass1: '#28b373',
      wall: '#3a4475', wallTop: '#5c69ad',
      sand: '#f3d58c', sandDot: '#d6b261',
      water: '#2a73f0', water2: '#7cb4ff',
      ice: '#bdeaff', ice2: '#f0fbff',
      accent: '#ff4f8b', tee: 'rgba(255,255,255,0.18)',
    },
    {
      name: 'Sunset',
      bg0: '#240b2b', bg1: '#5a1d4a', dots: 'rgba(255,220,200,0.06)',
      rail: '#ffeede', railShade: '#c99a8e',
      grass0: '#74cf57', grass1: '#69c24d',
      wall: '#7c2d5e', wallTop: '#b44b86',
      sand: '#ffd79a', sandDot: '#e6b46a',
      water: '#3b6fe0', water2: '#8fb0ff',
      ice: '#d3e9ff', ice2: '#ffffff',
      accent: '#ffb000', tee: 'rgba(255,255,255,0.2)',
    },
    {
      name: 'Arctic',
      bg0: '#0b2433', bg1: '#174a63', dots: 'rgba(255,255,255,0.06)',
      rail: '#f2fbff', railShade: '#94b8c8',
      grass0: '#3fc9a3', grass1: '#37bb97',
      wall: '#2c5b77', wallTop: '#4a86a8',
      sand: '#efe2c0', sandDot: '#d1c08f',
      water: '#1e88e5', water2: '#8fd0ff',
      ice: '#c9f1ff', ice2: '#ffffff',
      accent: '#ff6b4a', tee: 'rgba(255,255,255,0.2)',
    },
    {
      name: 'Desert',
      bg0: '#22160f', bg1: '#4a2f1d', dots: 'rgba(255,230,190,0.05)',
      rail: '#fff2dc', railShade: '#c8a67a',
      grass0: '#8fc34a', grass1: '#83b642',
      wall: '#8a5a36', wallTop: '#b5794b',
      sand: '#f6cf7a', sandDot: '#d9a94c',
      water: '#1f9fb3', water2: '#86e3ef',
      ice: '#e4f4ff', ice2: '#ffffff',
      accent: '#e8453c', tee: 'rgba(255,255,255,0.18)',
    },
    {
      name: 'Neon',
      bg0: '#06060e', bg1: '#1a1238', dots: 'rgba(160,120,255,0.08)',
      rail: '#ff4df0', railShade: '#8a1f86',
      grass0: '#16c79a', grass1: '#12b88d',
      wall: '#2a2160', wallTop: '#4b3bb0',
      sand: '#ffe066', sandDot: '#e0b92e',
      water: '#3d5afe', water2: '#8c9eff',
      ice: '#a7ffeb', ice2: '#e0fff8',
      accent: '#00e5ff', tee: 'rgba(255,255,255,0.16)',
    },
  ];

  Object.assign(PP, {
    COLS, ROWS, CELL, T, BOOST_DIR, THEMES,
    isSolid, isBoost, isGround,
    hashString, RNG,
    createLevel, cloneLevel, inBounds, getTile, setTile, tileAtPx, cellCenter, objectAt,
    serialize, deserialize, encodeShare, decodeShare,
    isPassableCell, findPath, lineOfSight, computePar, validateLevel,
  });
})(typeof window !== 'undefined' ? window : globalThis);

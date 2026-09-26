/* Level editor: paint terrain, place tee/hole/objects, undo/redo, generate, validate. */
(function (G) {
  'use strict';
  const PP = G.PP;
  const { T, COLS, ROWS, CELL, getTile, setTile, inBounds, objectAt, isSolid } = PP;

  const BOOSTS = [T.BOOST_N, T.BOOST_E, T.BOOST_S, T.BOOST_W];

  const TOOLS = [
    { id: 'grass', label: 'Grass', key: '1', tile: T.GRASS, color: '#2ec27e' },
    { id: 'wall', label: 'Wall', key: '2', tile: T.WALL, color: '#5c69ad' },
    { id: 'sand', label: 'Sand', key: '3', tile: T.SAND, color: '#f3d58c' },
    { id: 'water', label: 'Water', key: '4', tile: T.WATER, color: '#2a73f0' },
    { id: 'ice', label: 'Ice', key: '5', tile: T.ICE, color: '#bdeaff' },
    { id: 'boost', label: 'Boost', key: '6', tile: 'boost', color: '#ff4f8b' },
    { id: 'void', label: 'Erase', key: '7', tile: T.VOID, color: '#0a0f1f' },
    { id: 'tee', label: 'Tee', key: '8', color: '#ffffff' },
    { id: 'hole', label: 'Hole', key: '9', color: '#111827' },
    { id: 'bumper', label: 'Bumper', key: 'b', color: '#ff4f8b' },
    { id: 'spinner', label: 'Spinner', key: 'n', color: '#a78bfa' },
  ];

  function starterLevel() {
    const lvl = PP.createLevel(COLS, ROWS);
    for (let r = 4; r < 12; r++) for (let c = 3; c < 21; c++) setTile(lvl, c, r, T.GRASS);
    lvl.tee = { c: 5, r: 8 };
    lvl.hole = { c: 18, r: 7 };
    lvl.name = 'My Level';
    lvl.par = 2;
    return lvl;
  }

  class Editor {
    constructor(app) {
      this.app = app;
      this.r = app.renderer;
      this.tool = 'grass';
      this.brush = 1;
      this.boostDir = 1;
      this.undoStack = [];
      this.redoStack = [];
      this.hover = null;
      this.painting = null;
      this.level = null;
      this.savedId = null;
    }

    static get TOOLS() {
      return TOOLS;
    }

    open(level, savedId = null) {
      this.level = level ? PP.cloneLevel(level) : starterLevel();
      this.savedId = savedId;
      this.undoStack = [];
      this.redoStack = [];
      this.r.setLevel(this.level);
      this.changed(false);
    }

    snapshot() {
      return JSON.stringify(PP.serialize(this.level));
    }

    pushUndo() {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > 150) this.undoStack.shift();
      this.redoStack = [];
    }

    restore(json) {
      this.level = PP.deserialize(json);
      this.r.setLevel(this.level);
      this.changed();
    }

    undo() {
      if (!this.undoStack.length) return;
      this.redoStack.push(this.snapshot());
      this.restore(this.undoStack.pop());
    }

    redo() {
      if (!this.redoStack.length) return;
      this.undoStack.push(this.snapshot());
      this.restore(this.redoStack.pop());
    }

    /** Call after any edit. */
    changed(persist = true) {
      if (this.level.autoPar) this.level.par = PP.computePar(this.level);
      this.r.invalidate();
      this.app.onEditorChange();
      if (persist) {
        try {
          localStorage.setItem('pp.draft', JSON.stringify({ level: PP.serialize(this.level), savedId: this.savedId }));
        } catch (e) { /* ignore */ }
      }
    }

    setTool(id) {
      if (id === 'boost' && this.tool === 'boost') this.rotateBoost();
      this.tool = id;
      this.app.onEditorChange();
    }

    rotateBoost() {
      this.boostDir = (this.boostDir + 1) % 4;
      this.app.onEditorChange();
    }

    generate(difficulty) {
      this.pushUndo();
      const seed = Math.random().toString(36).slice(2, 8);
      const lvl = PP.generateLevel(seed, { difficulty });
      this.level = lvl;
      this.r.setLevel(lvl);
      this.changed();
    }

    clear() {
      this.pushUndo();
      const keep = { name: this.level.name, theme: this.level.theme };
      this.level = Object.assign(PP.createLevel(COLS, ROWS), keep);
      this.r.setLevel(this.level);
      this.changed();
    }

    /* ---------- Painting ---------- */
    cellFromEvent(e) {
      const p = this.r.toWorld(e.clientX, e.clientY);
      return { c: Math.floor(p.x / CELL), r: Math.floor(p.y / CELL) };
    }

    brushCells(c, r) {
      const n = this.brush === 'fill' ? 1 : this.brush;
      const isTerrain = TOOLS.find((t) => t.id === this.tool).tile != null;
      const size = isTerrain ? n : 1;
      const off = Math.floor((size - 1) / 2);
      const cells = [];
      for (let dr = 0; dr < size; dr++)
        for (let dc = 0; dc < size; dc++) {
          const cc = c - off + dc;
          const rr = r - off + dr;
          if (inBounds(this.level, cc, rr)) cells.push({ c: cc, r: rr });
        }
      return cells;
    }

    toolTile(erase) {
      if (erase) return T.VOID;
      const t = TOOLS.find((x) => x.id === this.tool).tile;
      return t === 'boost' ? BOOSTS[this.boostDir] : t;
    }

    pointerDown(e) {
      const cell = this.cellFromEvent(e);
      if (!inBounds(this.level, cell.c, cell.r)) return;
      const erase = e.button === 2 || this.tool === 'void';
      this.pushUndo();
      const tool = TOOLS.find((t) => t.id === this.tool);
      if (!erase && tool.tile == null) {
        this.placeSpecial(cell.c, cell.r);
        this.painting = null;
        this.changed();
        return;
      }
      if (this.brush === 'fill') {
        this.flood(cell.c, cell.r, this.toolTile(erase));
        this.changed();
        return;
      }
      this.painting = { erase, last: cell, id: e.pointerId };
      this.paintAt(cell.c, cell.r, erase);
      this.r.invalidate();
    }

    pointerMove(e) {
      const cell = this.cellFromEvent(e);
      this.hover = inBounds(this.level, cell.c, cell.r) ? cell : null;
      if (!this.painting || e.pointerId !== this.painting.id) return;
      // interpolate so fast drags don't leave gaps
      const { last } = this.painting;
      const steps = Math.max(Math.abs(cell.c - last.c), Math.abs(cell.r - last.r));
      for (let i = 1; i <= steps; i++) {
        const c = Math.round(last.c + ((cell.c - last.c) * i) / steps);
        const r = Math.round(last.r + ((cell.r - last.r) * i) / steps);
        this.paintAt(c, r, this.painting.erase);
      }
      this.painting.last = cell;
      if (steps) this.r.invalidate();
    }

    pointerUp(e) {
      if (!this.painting || (e && e.pointerId !== this.painting.id)) return;
      this.painting = null;
      this.changed();
    }

    pointerLeave() {
      this.hover = null;
    }

    paintAt(c, r, erase) {
      const t = this.toolTile(erase);
      let any = false;
      this.brushCells(c, r).forEach((p) => {
        if (getTile(this.level, p.c, p.r) !== t) {
          setTile(this.level, p.c, p.r, t);
          any = true;
        }
        if (isSolid(t) || t === T.WATER) this.removeObject(p.c, p.r);
        if (erase) {
          if (this.level.tee && this.level.tee.c === p.c && this.level.tee.r === p.r) this.level.tee = null;
          if (this.level.hole && this.level.hole.c === p.c && this.level.hole.r === p.r) this.level.hole = null;
        }
      });
      if (any) this.app.sound.paint();
    }

    flood(c, r, t) {
      const lvl = this.level;
      const from = getTile(lvl, c, r);
      if (from === t) return;
      const stack = [[c, r]];
      while (stack.length) {
        const [x, y] = stack.pop();
        if (!inBounds(lvl, x, y) || getTile(lvl, x, y) !== from) continue;
        setTile(lvl, x, y, t);
        if (isSolid(t) || t === T.WATER) this.removeObject(x, y);
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      this.app.sound.paint();
    }

    removeObject(c, r) {
      const i = this.level.objects.findIndex((o) => o.c === c && o.r === r);
      if (i >= 0) this.level.objects.splice(i, 1);
    }

    ensureGround(c, r) {
      const t = getTile(this.level, c, r);
      if (isSolid(t) || t === T.WATER) setTile(this.level, c, r, T.GRASS);
    }

    placeSpecial(c, r) {
      const lvl = this.level;
      const same = (p) => p && p.c === c && p.r === r;
      if (this.tool === 'tee' || this.tool === 'hole') {
        this.ensureGround(c, r);
        this.removeObject(c, r);
        if (this.tool === 'tee') {
          if (same(lvl.hole)) lvl.hole = null;
          lvl.tee = { c, r };
        } else {
          if (same(lvl.tee)) lvl.tee = null;
          lvl.hole = { c, r };
        }
      } else {
        const existing = objectAt(lvl, c, r);
        if (existing && existing.type === this.tool) {
          this.removeObject(c, r);
        } else {
          if (same(lvl.tee) || same(lvl.hole)) {
            this.app.toast('Keep objects off the tee and hole');
            return;
          }
          this.removeObject(c, r);
          this.ensureGround(c, r);
          const o = { type: this.tool, c, r };
          if (this.tool === 'spinner') Object.assign(o, { speed: 1.4, phase: 0 });
          lvl.objects.push(o);
        }
      }
      this.app.sound.click();
    }

    /* ---------- Rendering ---------- */
    render(t) {
      if (!this.level) return;
      this.r.begin();
      this.r.drawWorld(t, { objTime: t });
      this.r.drawTeeMarker(t);
      this.r.drawGrid();
      if (this.hover && !('ontouchstart' in G && !this.painting)) {
        const tool = TOOLS.find((x) => x.id === this.tool);
        this.r.drawHover(this.brushCells(this.hover.c, this.hover.r), tool.color);
      }
    }
  }

  Editor.BOOSTS = BOOSTS;
  PP.Editor = Editor;
})(typeof window !== 'undefined' ? window : globalThis);

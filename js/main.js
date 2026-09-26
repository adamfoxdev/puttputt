/* App shell: screens, HUD, modals, storage, sharing, input routing, main loop. */
(function (G) {
  'use strict';
  const PP = G.PP;
  const $ = (id) => document.getElementById(id);

  const store = {
    get(key, dflt) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? dflt : JSON.parse(v);
      } catch (e) {
        return dflt;
      }
    },
    set(key, val) {
      try {
        localStorage.setItem(key, JSON.stringify(val));
        return true;
      } catch (e) {
        return false;
      }
    },
  };

  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const fmtVsPar = (d) => (d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`);
  const baseUrl = () => location.href.split('#')[0];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  class App {
    constructor() {
      this.root = $('app');
      this.canvas = $('cv');
      this.renderer = new PP.Renderer(this.canvas);
      this.sound = new PP.Sound();
      this.game = new PP.Game(this);
      this.editor = new PP.Editor(this);
      this.mode = 'menu';
      this.difficulty = store.get('pp.diff', 2);
      this.course = null;
      this.holeActions = [];
      this.menuLevel = PP.generateLevel(Math.random().toString(36).slice(2), { difficulty: 3 });

      this.bindCommon();
      this.bindMenu();
      this.bindPlay();
      this.bindEditor();
      this.bindLevels();
      this.bindModals();
      this.syncSound();

      new ResizeObserver(() => this.resize()).observe($('canvasWrap'));
      G.addEventListener('resize', () => this.resize());
      G.addEventListener('hashchange', () => this.handleHash());

      if (!this.handleHash()) this.setMode('menu');
      this.last = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }

    /* ---------- Modes & layout ---------- */
    setMode(mode) {
      this.mode = mode;
      this.root.dataset.mode = mode;
      this.closeModals();
      if (mode === 'menu' || mode === 'levels') {
        this.renderer.setLevel(this.menuLevel, { crop: true });
        if (location.hash) history.replaceState(null, '', baseUrl());
      }
      if (mode === 'menu') this.refreshMenu();
      if (mode === 'levels') this.renderLevels();
      if (mode === 'editor') {
        this.renderer.setLevel(this.editor.level);
        this.onEditorChange();
      }
      this.resize();
      requestAnimationFrame(() => this.resize());
    }

    resize() {
      const wrap = $('canvasWrap');
      const cs = getComputedStyle(wrap);
      const aw = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const ah = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (aw <= 0 || ah <= 0) return;
      const aspect = this.renderer.aspectFor(aw, ah);
      let w = Math.min(aw, ah * aspect);
      let h = w / aspect;
      w = Math.floor(w);
      h = Math.floor(h);
      if (w !== this.renderer.cssW || h !== this.renderer.cssH) this.renderer.resize(w, h);
    }

    frame(now) {
      const dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      const t = now / 1000;
      if (this.mode === 'play') {
        this.game.update(dt);
        this.game.render(t);
      } else if (this.mode === 'editor') {
        this.editor.render(t);
      } else {
        this.renderer.begin();
        this.renderer.drawWorld(t);
      }
      requestAnimationFrame((n) => this.frame(n));
    }

    /* ---------- Routing via URL hash ---------- */
    handleHash() {
      const h = location.hash.slice(1);
      if (!h) return false;
      const params = new URLSearchParams(h);
      try {
        if (params.get('level')) {
          const lvl = PP.decodeShare(params.get('level'));
          const v = PP.validateLevel(lvl);
          if (!v.ok) throw new Error(v.errors[0]);
          this.playLevels([lvl], { kind: 'shared', title: 'Shared level' });
          return true;
        }
        if (params.get('seed')) {
          const d = parseInt(params.get('d'), 10);
          this.startCourse('seed', params.get('seed'), [1, 2, 3].includes(d) ? d : 2);
          return true;
        }
      } catch (e) {
        this.toast('Could not open link: ' + e.message);
      }
      return false;
    }

    /* ---------- Common ---------- */
    toast(msg, ms = 2400) {
      const el = $('toast');
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
    }

    syncSound() {
      this.root.classList.toggle('muted-audio', !this.sound.enabled);
    }

    async copy(text, label = 'Copied!') {
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      this.toast(label);
    }

    bindCommon() {
      document.querySelectorAll('.sound-btn').forEach((b) =>
        b.addEventListener('click', () => {
          this.sound.toggle();
          this.syncSound();
          this.sound.click();
        })
      );

      const cv = this.canvas;
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      cv.addEventListener('pointerdown', (e) => {
        if (this.mode !== 'play' && this.mode !== 'editor') return;
        e.preventDefault();
        cv.setPointerCapture(e.pointerId);
        if (this.mode === 'play') this.game.pointerDown(e);
        else this.editor.pointerDown(e);
      });
      cv.addEventListener('pointermove', (e) => {
        if (this.mode === 'play') this.game.pointerMove(e);
        else if (this.mode === 'editor') this.editor.pointerMove(e);
      });
      const up = (e) => {
        if (this.mode === 'play') this.game.pointerUp(e);
        else if (this.mode === 'editor') this.editor.pointerUp(e);
      };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', (e) => {
        if (this.mode === 'play') this.game.cancelAim();
        else up(e);
      });
      cv.addEventListener('pointerleave', () => this.mode === 'editor' && this.editor.pointerLeave());

      G.addEventListener('keydown', (e) => this.onKey(e));
    }

    onKey(e) {
      const tag = (e.target && e.target.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const openModal = [...document.querySelectorAll('.modal')].find((m) => !m.hidden);
      if (e.key === 'Escape') {
        if (openModal && openModal.id !== 'holeModal' && openModal.id !== 'cardModal') return this.closeModals();
        if (this.mode === 'play') {
          if (this.game.drag) return this.game.cancelAim();
          if (this.course && this.course.kind === 'test') return this.backToEditor();
          return this.setMode('menu');
        }
        if (this.mode === 'levels') return this.setMode('menu');
        return;
      }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === 'm' && !e.ctrlKey && !e.metaKey) {
        this.sound.toggle();
        this.syncSound();
        return;
      }
      if (this.mode === 'play') {
        if (openModal && openModal.id === 'holeModal' && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          const primary = this.holeActions.find((a) => a.primary);
          if (primary) primary.fn();
          return;
        }
        if (openModal) return;
        if (k === 'r') this.game.restartHole();
        return;
      }
      if (this.mode === 'editor' && !openModal) this.onEditorKey(e, k);
    }

    closeModals() {
      document.querySelectorAll('.modal').forEach((m) => (m.hidden = true));
    }

    openModal(id) {
      this.closeModals();
      $(id).hidden = false;
    }

    confirm(title, text, okLabel = 'OK') {
      return new Promise((resolve) => {
        $('cfTitle').textContent = title;
        $('cfText').textContent = text;
        $('cfOk').textContent = okLabel;
        this.openModal('confirmModal');
        const done = (v) => {
          $('confirmModal').hidden = true;
          $('cfOk').onclick = null;
          $('confirmModal').onclose = null;
          resolve(v);
        };
        $('cfOk').onclick = () => done(true);
        $('confirmModal').onclose = () => done(false);
      });
    }

    bindModals() {
      document.querySelectorAll('.modal').forEach((m) => {
        m.addEventListener('click', (e) => {
          const closer = e.target.closest('[data-close]');
          const backdrop = e.target === m && m.id !== 'holeModal' && m.id !== 'cardModal';
          if (closer || backdrop) {
            m.hidden = true;
            if (m.onclose) m.onclose();
          }
        });
      });
      document.querySelectorAll('[data-copy]').forEach((b) =>
        b.addEventListener('click', () => this.copy($(b.dataset.copy).value))
      );
    }

    /* ---------- Menu ---------- */
    bindMenu() {
      const seg = $('diffSeg');
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-diff]');
        if (!b) return;
        this.difficulty = +b.dataset.diff;
        store.set('pp.diff', this.difficulty);
        this.refreshMenu();
        this.sound.click();
      });
      $('mQuick').addEventListener('click', () => this.startCourse('random'));
      $('mDaily').addEventListener('click', () => this.startCourse('daily'));
      $('mSeedForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const s = $('mSeed').value.trim();
        if (!s) return $('mSeed').focus();
        this.startCourse('seed', s);
      });
      $('mEditor').addEventListener('click', () => this.openEditorDraft());
      $('mLevels').addEventListener('click', () => this.setMode('levels'));
      $('mDailyDate').textContent = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    refreshMenu() {
      document.querySelectorAll('#diffSeg button').forEach((b) =>
        b.setAttribute('aria-checked', String(+b.dataset.diff === this.difficulty))
      );
      $('mLevelsCount').textContent = this.savedLevels().length;
    }

    /* ---------- Play ---------- */
    startCourse(kind, seed, difficulty = this.difficulty) {
      if (kind === 'random') seed = Math.random().toString(36).slice(2, 8);
      if (kind === 'daily') seed = 'daily-' + todayKey();
      const dname = ['', 'Easy', 'Normal', 'Hard'][difficulty];
      const title =
        kind === 'daily'
          ? `Daily · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
          : kind === 'seed'
          ? `Seed “${seed}”`
          : 'Random 9';
      const levels = PP.generateCourse(seed, 9, { difficulty });
      this.playLevels(levels, { kind, seed, difficulty, title: `${title} · ${dname}` });
    }

    playLevels(levels, meta) {
      this.course = meta;
      this.setMode('play');
      $('hudEdit').hidden = meta.kind !== 'test';
      this.game.start(levels, meta);
      this.resize();
    }

    playTest() {
      const lvl = this.editor.level;
      const v = PP.validateLevel(lvl);
      if (!lvl.tee || !lvl.hole) return this.toast(v.errors[0]);
      if (!v.ok) this.toast('Heads up: ' + v.errors[0]);
      this.playLevels([PP.cloneLevel(lvl)], { kind: 'test', title: 'Test play' });
    }

    backToEditor() {
      this.setMode('editor');
    }

    bindPlay() {
      $('hudMenu').addEventListener('click', () => this.setMode('menu'));
      $('hudRestart').addEventListener('click', () => this.game.restartHole());
      $('hudEdit').addEventListener('click', () => this.backToEditor());
      $('scMenu').addEventListener('click', () => this.setMode('menu'));
      $('scReplay').addEventListener('click', () => {
        this.closeModals();
        this.game.start(this.game.levels, this.course);
      });
      $('scNew').addEventListener('click', () => {
        const c = this.course;
        if (c.kind === 'custom' || c.kind === 'shared') return this.setMode(c.kind === 'custom' ? 'levels' : 'menu');
        this.startCourse('random', null, c.difficulty);
      });
      $('scShare').addEventListener('click', () => {
        const c = this.course;
        this.copy(`${baseUrl()}#seed=${encodeURIComponent(c.seed)}&d=${c.difficulty}`, 'Course link copied');
      });
    }

    updateHud() {
      const g = this.game;
      if (!g.level) return;
      const n = g.levels.length;
      $('hudCourse').textContent = (this.course && this.course.title) || '';
      $('hudName').textContent = g.level.name;
      $('hudHole').textContent = `${g.index + 1}/${n}`;
      $('hudPar').textContent = g.level.par;
      const sEl = $('hudStrokes');
      if (sEl.textContent !== String(g.strokes)) {
        sEl.textContent = g.strokes;
        sEl.classList.remove('bump');
        void sEl.offsetWidth;
        sEl.classList.add('bump');
      }
      const d = g.totalVsPar();
      const tEl = $('hudTotal');
      tEl.textContent = fmtVsPar(d);
      tEl.className = d < 0 ? 'under' : d > 0 ? 'over' : '';
      $('hudTotalWrap').hidden = n < 2;
    }

    onHoleComplete({ strokes, par, maxed, isLast }) {
      const c = this.course;
      const name = PP.Game.scoreName(strokes, par, maxed);
      const title = $('hmTitle');
      title.textContent = name;
      title.className = 'result-title' + (strokes < par && !maxed ? '' : strokes > par || maxed ? ' bad' : ' good');
      $('hmSub').textContent = maxed
        ? `Max ${strokes} strokes reached · par ${par}`
        : `${strokes} stroke${strokes === 1 ? '' : 's'} · par ${par}`;

      const acts = [];
      if (c.kind === 'test') {
        acts.push({ label: 'Retry', fn: () => { this.closeModals(); this.game.restartHole(); } });
        acts.push({ label: 'Back to editor', primary: true, fn: () => this.backToEditor() });
      } else if (this.game.levels.length === 1) {
        acts.push({ label: 'Replay', fn: () => { this.closeModals(); this.game.start(this.game.levels, c); } });
        if (c.kind === 'shared')
          acts.push({ label: 'Edit a copy', fn: () => this.openEditorWith(this.game.levels[0], null) });
        acts.push({ label: c.kind === 'custom' ? 'My levels' : 'Menu', primary: true, fn: () => this.setMode(c.kind === 'custom' ? 'levels' : 'menu') });
      } else if (!isLast) {
        acts.push({ label: 'Next hole →', primary: true, fn: () => { this.closeModals(); this.game.nextHole(); } });
      } else {
        acts.push({ label: 'Scorecard', primary: true, fn: () => this.showScorecard() });
      }
      this.holeActions = acts;
      const box = $('hmActions');
      box.innerHTML = '';
      acts.forEach((a) => {
        const b = document.createElement('button');
        b.className = 'btn' + (a.primary ? ' primary' : '');
        b.textContent = a.label;
        b.addEventListener('click', a.fn);
        box.appendChild(b);
      });
      clearTimeout(this.holeTimer);
      this.holeTimer = setTimeout(() => {
        if (this.mode === 'play' && this.game.state === 'done') this.openModal('holeModal');
      }, maxed ? 250 : 800);
    }

    showScorecard() {
      const g = this.game;
      const c = this.course;
      const n = g.levels.length;
      let head = '<tr><th></th>';
      let parRow = '<tr><td class="label">Par</td>';
      let scRow = '<tr><td class="label">Score</td>';
      let parTot = 0;
      let scTot = 0;
      for (let i = 0; i < n; i++) {
        const par = g.levels[i].par;
        const s = g.scores[i];
        parTot += par;
        scTot += s || 0;
        head += `<th>${i + 1}</th>`;
        parRow += `<td>${par}</td>`;
        const cls = s === 1 ? 'ace' : s < par ? 'under' : s > par ? 'over' : '';
        scRow += `<td class="${cls}" title="${esc(g.levels[i].name)}">${s == null ? '–' : s}</td>`;
      }
      head += '<th>Tot</th></tr>';
      parRow += `<td class="tot">${parTot}</td></tr>`;
      scRow += `<td class="tot">${scTot}</td></tr>`;
      $('scTable').innerHTML = head + parRow + scRow;
      const d = scTot - parTot;
      $('scTotal').innerHTML = `${fmtVsPar(d)} <small>${scTot} strokes</small>`;
      $('scTitle').textContent = d < 0 ? 'Under par — nice!' : d === 0 ? 'Right on par' : 'Course complete';
      $('scSub').textContent = c.title + (c.seed && c.kind !== 'daily' ? ` · seed ${c.seed}` : '');
      $('scShare').hidden = !c.seed;
      $('scNew').textContent = c.kind === 'custom' ? 'My levels' : c.kind === 'shared' ? 'Menu' : 'New course';
      if (c.kind === 'daily') {
        const best = store.get('pp.daily', {});
        const key = `${c.seed}|${c.difficulty}`;
        if (best[key] == null || scTot < best[key]) {
          best[key] = scTot;
          store.set('pp.daily', best);
        }
        $('scSub').textContent += ` · best today: ${best[key]}`;
      }
      this.openModal('cardModal');
    }

    /* ---------- Editor ---------- */
    openEditorDraft() {
      const draft = store.get('pp.draft', null);
      if (draft && draft.level) {
        try {
          const lvl = PP.deserialize(draft.level);
          const stillSaved = draft.savedId && this.savedLevels().some((s) => s.id === draft.savedId);
          return this.openEditorWith(lvl, stillSaved ? draft.savedId : null);
        } catch (e) { /* fall through */ }
      }
      this.openEditorWith(null, null);
    }

    openEditorWith(lvl, savedId) {
      this.editor.open(lvl, savedId);
      this.setMode('editor');
    }

    bindEditor() {
      const list = $('toolList');
      PP.Editor.TOOLS.forEach((t) => {
        const b = document.createElement('button');
        b.dataset.tool = t.id;
        b.title = `${t.label} (${t.key.toUpperCase()})`;
        let sw = `<i class="swatch" style="background:${t.color}"></i>`;
        if (t.id === 'boost') sw = `<i class="swatch" style="background:${t.color}"><svg viewBox="0 0 24 24" class="boost-arrow"><path d="M12 19V5M6 11l6-6 6 6"/></svg></i>`;
        if (t.id === 'tee' || t.id === 'hole' || t.id === 'bumper') sw = `<i class="swatch round" style="background:${t.color}"></i>`;
        if (t.id === 'spinner') sw = `<i class="swatch" style="background:transparent"><svg viewBox="0 0 24 24" style="color:${t.color}"><path d="M4 20L20 4"/><circle cx="12" cy="12" r="2.5" class="fill"/></svg></i>`;
        if (t.id === 'void') sw = `<i class="swatch" style="background:${t.color}"><svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg></i>`;
        b.innerHTML = `${sw}<span class="lbl">${t.label}</span><kbd>${t.key.toUpperCase()}</kbd>`;
        b.addEventListener('click', () => this.editor.setTool(t.id));
        list.appendChild(b);
      });
      $('brushList').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-brush]');
        if (!b) return;
        this.editor.brush = b.dataset.brush === 'fill' ? 'fill' : +b.dataset.brush;
        this.onEditorChange();
      });

      const themeSel = $('edTheme');
      PP.THEMES.forEach((th, i) => themeSel.add(new Option(th.name, i)));
      themeSel.addEventListener('change', () => {
        this.editor.level.theme = +themeSel.value;
        this.editor.changed();
      });
      $('edName').addEventListener('input', (e) => {
        this.editor.level.name = e.target.value || 'Untitled';
        this.editor.changed();
      });
      $('edPar').addEventListener('change', (e) => {
        const v = Math.max(1, Math.min(9, parseInt(e.target.value, 10) || 3));
        this.editor.level.par = v;
        this.editor.level.autoPar = false;
        this.editor.changed();
      });
      $('edAutoPar').addEventListener('change', (e) => {
        this.editor.level.autoPar = e.target.checked;
        this.editor.changed();
      });
      $('edBack').addEventListener('click', () => this.setMode('menu'));
      $('edUndo').addEventListener('click', () => this.editor.undo());
      $('edRedo').addEventListener('click', () => this.editor.redo());
      $('edGenerate').addEventListener('click', () => this.editorGenerate());
      $('edClear').addEventListener('click', () => this.editor.clear());
      $('edTest').addEventListener('click', () => this.playTest());
      $('edSave').addEventListener('click', () => this.saveEditorLevel());
      $('edShare').addEventListener('click', () => this.openShare(this.editor.level));
      $('edImport').addEventListener('click', () => this.openImport());
    }

    editorGenerate() {
      const d = +$('edDifficulty').value;
      this.editor.generate(d);
      this.toast(`Generated “${this.editor.level.name}” — Ctrl+Z to undo`);
    }

    onEditorKey(e, k) {
      const ed = this.editor;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && k === 'z') {
        e.preventDefault();
        return e.shiftKey ? ed.redo() : ed.undo();
      }
      if (mod && k === 'y') {
        e.preventDefault();
        return ed.redo();
      }
      if (mod && k === 's') {
        e.preventDefault();
        return this.saveEditorLevel();
      }
      if (mod) return;
      const tool = PP.Editor.TOOLS.find((t) => t.key === k);
      if (tool) return ed.setTool(tool.id);
      if (k === 'r') return ed.rotateBoost();
      if (k === 'f') {
        ed.brush = ed.brush === 'fill' ? 1 : 'fill';
        return this.onEditorChange();
      }
      if (k === '[' || k === ']') {
        const sizes = [1, 2, 3];
        const i = sizes.indexOf(ed.brush === 'fill' ? 1 : ed.brush);
        ed.brush = sizes[Math.max(0, Math.min(2, i + (k === ']' ? 1 : -1)))];
        return this.onEditorChange();
      }
      if (k === 't') return this.playTest();
      if (k === 'g') return this.editorGenerate();
    }

    onEditorChange() {
      const ed = this.editor;
      const lvl = ed.level;
      if (!lvl || this.mode !== 'editor') return;
      document.querySelectorAll('#toolList button').forEach((b) => b.classList.toggle('active', b.dataset.tool === ed.tool));
      const arrow = document.querySelector('.boost-arrow');
      if (arrow) arrow.style.transform = `rotate(${ed.boostDir * 90}deg)`;
      document.querySelectorAll('#brushList button').forEach((b) =>
        b.classList.toggle('active', String(ed.brush) === b.dataset.brush)
      );
      const setVal = (el, v) => {
        if (document.activeElement !== el) el.value = v;
      };
      setVal($('edName'), lvl.name);
      setVal($('edPar'), lvl.par);
      $('edAutoPar').checked = !!lvl.autoPar;
      $('edTheme').value = lvl.theme;
      $('edUndo').disabled = !ed.undoStack.length;
      $('edRedo').disabled = !ed.redoStack.length;
      const v = PP.validateLevel(lvl);
      const st = $('edStatus');
      st.className = 'pal-status ' + (v.ok ? 'ok' : 'bad');
      st.textContent = v.ok ? `✓ Playable · par ${lvl.par}${ed.savedId ? '' : ' · unsaved'}` : v.errors[0];
    }

    /* ---------- Saved levels ---------- */
    savedLevels() {
      const list = store.get('pp.levels', []);
      return Array.isArray(list) ? list : [];
    }

    saveEditorLevel() {
      const lvl = this.editor.level;
      const list = this.savedLevels();
      const data = PP.serialize(lvl);
      let entry = this.editor.savedId && list.find((l) => l.id === this.editor.savedId);
      if (entry) {
        entry.data = data;
        entry.updated = Date.now();
      } else {
        entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), updated: Date.now(), data };
        list.unshift(entry);
        this.editor.savedId = entry.id;
      }
      if (!store.set('pp.levels', list)) return this.toast('Could not save — storage unavailable');
      this.editor.changed();
      const v = PP.validateLevel(lvl);
      this.toast(v.ok ? `Saved “${lvl.name}”` : `Saved (not playable yet: ${v.errors[0]})`);
    }

    bindLevels() {
      $('lvBack').addEventListener('click', () => this.setMode('menu'));
      $('lvNew').addEventListener('click', () => this.openEditorWith(null, null));
      $('lvImport').addEventListener('click', () => this.openImport());
      $('lvPlayAll').addEventListener('click', () => {
        const levels = this.playableSaved();
        if (!levels.length) return this.toast('No playable levels saved yet');
        this.playLevels(levels, { kind: 'custom', title: 'My levels' });
      });
    }

    playableSaved() {
      return this.savedLevels()
        .map((e) => {
          try {
            return PP.deserialize(e.data);
          } catch (err) {
            return null;
          }
        })
        .filter((l) => l && PP.validateLevel(l).ok);
    }

    renderLevels() {
      const grid = $('levelsGrid');
      grid.innerHTML = '';
      const list = this.savedLevels();
      $('levelsEmpty').hidden = list.length > 0;
      list.forEach((entry) => {
        let lvl;
        try {
          lvl = PP.deserialize(entry.data);
        } catch (e) {
          return;
        }
        const ok = PP.validateLevel(lvl).ok;
        const card = document.createElement('div');
        card.className = 'level-card';
        const thumb = PP.renderThumbnail(lvl, 300);
        thumb.title = ok ? 'Play' : 'Edit';
        thumb.addEventListener('click', () =>
          ok ? this.playLevels([lvl], { kind: 'custom', title: lvl.name }) : this.openEditorWith(lvl, entry.id)
        );
        card.appendChild(thumb);
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.innerHTML = `<b>${esc(lvl.name)}</b><span>${ok ? 'Par ' + lvl.par : 'Draft'}</span>`;
        card.appendChild(meta);
        const actions = document.createElement('div');
        actions.className = 'actions';
        const mk = (label, fn, cls = '') => {
          const b = document.createElement('button');
          b.className = 'btn ' + cls;
          b.textContent = label;
          b.addEventListener('click', fn);
          actions.appendChild(b);
          return b;
        };
        const play = mk('Play', () => this.playLevels([lvl], { kind: 'custom', title: lvl.name }), 'primary');
        play.disabled = !ok;
        mk('Edit', () => this.openEditorWith(lvl, entry.id));
        mk('Share', () => this.openShare(lvl));
        mk('Delete', async () => {
          if (!(await this.confirm('Delete level?', `“${lvl.name}” will be removed from this browser.`, 'Delete'))) return;
          store.set('pp.levels', this.savedLevels().filter((l) => l.id !== entry.id));
          this.renderLevels();
        }, 'ghost');
        card.appendChild(actions);
        grid.appendChild(card);
      });
    }

    /* ---------- Share / import ---------- */
    openShare(lvl) {
      const code = PP.encodeShare(lvl);
      $('shCode').value = code;
      $('shLink').value = `${baseUrl()}#level=${code}`;
      $('shDownload').onclick = () => {
        const blob = new Blob([JSON.stringify(PP.serialize(lvl), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (lvl.name || 'level').replace(/[^\w-]+/g, '_').toLowerCase() + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      };
      this.openModal('shareModal');
    }

    openImport() {
      $('imText').value = '';
      $('imError').textContent = '';
      this.openModal('importModal');
      setTimeout(() => $('imText').focus(), 50);
      $('imGo').onclick = () => this.doImport($('imText').value);
      $('imFile').onchange = (e) => {
        const f = e.target.files[0];
        if (!f) return;
        f.text().then((txt) => {
          $('imText').value = txt;
          this.doImport(txt);
        });
        e.target.value = '';
      };
    }

    doImport(text) {
      text = text.trim();
      if (!text) return;
      try {
        let lvl;
        const m = text.match(/[#&]level=([A-Za-z0-9_-]+)/);
        if (m) lvl = PP.decodeShare(m[1]);
        else if (text.startsWith('{')) lvl = PP.deserialize(text);
        else lvl = PP.decodeShare(text);
        this.openEditorWith(lvl, null);
        this.toast(`Imported “${lvl.name}”`);
      } catch (e) {
        $('imError').textContent = 'That doesn’t look like a valid level.';
      }
    }
  }

  G.addEventListener('DOMContentLoaded', () => {
    PP.app = new App();
  });
})(window);

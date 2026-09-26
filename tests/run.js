/* Headless checks for the generator, level codec and physics. Run: node tests/run.js */
'use strict';
const assert = require('assert');
const path = require('path');
for (const f of ['core', 'generator', 'physics']) require(path.join(__dirname, '..', 'js', f + '.js'));
const PP = globalThis.PP;
const { T, CELL } = PP;

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  ok  ' + name);
  } catch (e) {
    failures++;
    console.log('  FAIL ' + name + '\n       ' + e.message);
  }
}

/** Roll a shot to rest; returns final ball + events seen. */
function roll(lvl, from, dx, dy, speed, maxSteps = 240 * 40) {
  const sim = new PP.Sim(lvl);
  const ball = { x: from.x, y: from.y, vx: dx * speed, vy: dy * speed, moving: true, sunk: false };
  const events = [];
  for (let i = 0; i < maxSteps && ball.moving; i++) sim.step(ball, events);
  return { ball, events };
}

test('generator produces valid, solvable levels at every difficulty', () => {
  for (let d = 1; d <= 3; d++) {
    for (let i = 0; i < 200; i++) {
      const lvl = PP.generateLevel('t' + i, { difficulty: d });
      const v = PP.validateLevel(lvl);
      assert(v.ok, `seed t${i} d${d}: ${v.errors.join(', ')}`);
      assert(lvl.par >= 2 && lvl.par <= 6, `par out of range: ${lvl.par}`);
      assert(!lvl.objects.some((o) => o.c === lvl.hole.c && o.r === lvl.hole.r), 'object on hole');
    }
  }
});

test('generation is deterministic per seed', () => {
  const a = JSON.stringify(PP.serialize(PP.generateLevel('same', { difficulty: 2 })));
  const b = JSON.stringify(PP.serialize(PP.generateLevel('same', { difficulty: 2 })));
  assert.strictEqual(a, b);
});

test('share codes round-trip exactly', () => {
  for (let i = 0; i < 50; i++) {
    const lvl = PP.generateLevel('share' + i, { difficulty: (i % 3) + 1 });
    const back = PP.decodeShare(PP.encodeShare(lvl));
    assert.strictEqual(JSON.stringify(PP.serialize(back)), JSON.stringify(PP.serialize(lvl)));
  }
});

test('deserialize rejects junk gracefully', () => {
  const lvl = PP.deserialize({ cols: 24, rows: 16, tiles: 'zz', tee: [99, 99], objects: [{ type: 'nuke', c: 1, r: 1 }] });
  assert.strictEqual(lvl.tee, null);
  assert.strictEqual(lvl.objects.length, 0);
  assert.strictEqual(lvl.tiles[0], T.VOID);
});

test('a straight putt at the cup sinks', () => {
  const lvl = PP.createLevel();
  for (let c = 2; c < 20; c++) for (let r = 6; r < 9; r++) PP.setTile(lvl, c, r, T.GRASS);
  lvl.tee = { c: 3, r: 7 };
  lvl.hole = { c: 9, r: 7 };
  const from = PP.cellCenter(3, 7);
  // Too soft stops short, too hard lips out; a sensible range of speeds must drop.
  const speeds = [];
  for (let s = 200; s <= 1000; s += 50) if (roll(lvl, from, 1, 0, s).ball.sunk) speeds.push(s);
  assert(speeds.length >= 3, `only sank at speeds ${speeds}`);
  assert(!roll(lvl, from, 1, 0, 150).ball.sunk, 'a weak putt should stop short');
});

test('ball bounces off walls and never escapes the course', () => {
  let shots = 0;
  for (let i = 0; i < 60; i++) {
    const lvl = PP.generateLevel('phys' + i, { difficulty: (i % 3) + 1 });
    const tee = PP.cellCenter(lvl.tee.c, lvl.tee.r);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + i;
      const { ball } = roll(lvl, tee, Math.cos(a), Math.sin(a), PP.Physics.MAX_SHOT);
      shots++;
      const t = PP.tileAtPx(lvl, ball.x, ball.y);
      assert(!PP.isSolid(t), `level phys${i} shot ${k}: ball ended inside a solid tile at ${ball.x.toFixed(1)},${ball.y.toFixed(1)}`);
      assert(ball.x > 0 && ball.y > 0 && ball.x < lvl.cols * CELL && ball.y < lvl.rows * CELL, 'ball left the map');
    }
  }
  assert(shots > 0);
});

test('water stops the ball and reports a splash', () => {
  const lvl = PP.createLevel();
  for (let c = 2; c < 20; c++) PP.setTile(lvl, c, 7, T.GRASS);
  PP.setTile(lvl, 10, 7, T.WATER);
  lvl.tee = { c: 3, r: 7 };
  lvl.hole = { c: 18, r: 7 };
  const { ball, events } = roll(lvl, PP.cellCenter(3, 7), 1, 0, 800);
  assert(events.some((e) => e.type === 'water'), 'no water event');
  assert(!ball.moving);
});

test('boost pads accelerate the ball', () => {
  const lvl = PP.createLevel();
  for (let c = 2; c < 22; c++) PP.setTile(lvl, c, 7, T.GRASS);
  const plain = roll(lvl, PP.cellCenter(3, 7), 1, 0, 300).ball.x;
  PP.setTile(lvl, 5, 7, T.BOOST_E);
  const boosted = roll(lvl, PP.cellCenter(3, 7), 1, 0, 300).ball.x;
  assert(boosted > plain + 40, `boost did not help: ${plain} vs ${boosted}`);
});

test('sand slows the ball more than grass, ice less', () => {
  const dist = (tile) => {
    const lvl = PP.createLevel();
    for (let c = 1; c < 23; c++) PP.setTile(lvl, c, 7, tile);
    return roll(lvl, PP.cellCenter(2, 7), 1, 0, 150).ball.x;
  };
  const g = dist(T.GRASS);
  assert(dist(T.SAND) < g, 'sand not slower');
  assert(dist(T.ICE) > g, 'ice not faster');
});

console.log(failures ? `\n${failures} test(s) failed` : '\nall tests passed');
process.exit(failures ? 1 : 0);

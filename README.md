# Putt Putt

A modern HTML5 mini-golf game with a **procedural course generator** and a **level editor**. Plain HTML, CSS and canvas JavaScript: no build step, no dependencies.

## Play

**Online:** https://adamfoxdev.github.io/puttputt/. Every push to `main` deploys there through `.github/workflows/pages.yml`.

**Locally:** open `index.html` in a browser. Double-clicking it works, or you can serve the folder:

```sh
npm start          # http://localhost:8080
```

**Controls:** press anywhere on the course, pull back like a slingshot and release to putt. Pull further for more power.
`R` restarts the hole, `M` mutes, `Esc` goes back to the menu, and `Enter` moves to the next hole.

### Modes
- **Random 9 holes**: a new 9-hole course every time, in Easy, Normal or Hard.
- **Daily course**: everyone gets the same 9 holes each day. Your best score is kept.
- **Seeded course**: type any word to get a repeatable course. Share it with `#seed=<word>&d=<1-3>`.
- **My levels**: play, edit, share or delete the levels you built, or play them all as one course.

### Course elements
| Element | Effect |
|---|---|
| Grass | normal roll |
| Sand | heavy drag |
| Ice | slides much further |
| Water | +1 stroke penalty and the ball goes back to where it last stopped |
| Boost pad | pushes the ball in the arrow's direction |
| Wall | solid block the ball bounces off |
| Bumper | springy, adds speed when hit |
| Spinner | rotating bar that can knock the ball, even when it's at rest |

A hole has a stroke cap of par + 5, and at most 12.

## Level editor
- Paint terrain with brush sizes 1–3 or flood fill (`F`). Right-click erases.
- Place the tee, hole, bumpers and spinners. Click an object again to remove it.
- Boost direction: click the Boost tool again or press `R` to rotate it.
- **Generate** starts from a random level (Easy, Normal or Hard). You can undo it with `Ctrl+Z`.
- Par can be estimated automatically from the shortest route, or set by hand.
- Five color themes.
- **Test** (`T`) plays the level right away. **Save** (`Ctrl+S`) stores it in your browser.
- **Share** gives a link (`#level=<code>`), a code, or a `.json` download. **Import** takes any of those back.
- Your work-in-progress draft is autosaved.

Shortcuts: `1`–`9`, `B` and `N` select tools, `[` and `]` change the brush size, `Ctrl+Z` undoes, `Ctrl+Y` redoes, `G` generates.

## How the generator works
1. It walks a random, axis-alternating path of waypoints across a 24×16 grid.
2. It carves corridors 2–4 cells wide between the waypoints and sometimes widens a waypoint into a room.
3. It adds pillars, boost pads along long corridors pointing down the route, sand, ice, water, bumpers and spinners. The number of each depends on the difficulty.
4. Every hazard is placed tentatively. It is kept only if a clear tee-to-hole path (BFS) still exists afterwards.
5. Par is estimated by "string-pulling" the BFS path into straight-line shots.

The generator is deterministic: the same seed and difficulty always give the same level.

## Project layout
```
index.html        UI shell (menu, HUD, editor bar, modals)
css/style.css     styling, responsive layout
js/core.js        tiles, RNG, level model, share codes, pathing, par, themes
js/generator.js   procedural level generator
js/physics.js     fixed-step ball physics (240 Hz), collisions, cup capture
js/render.js      canvas renderer (cached static layer, crop + portrait auto-rotate)
js/game.js        play mode: shots, strokes, hazards, particles
js/editor.js      level editor
js/audio.js       WebAudio synthesized sound effects
js/main.js        app shell: screens, storage, sharing, input routing
tests/run.js      headless tests for generator, codec and physics
```

## Tests
```sh
npm test
```
The tests generate 600 levels and check each one is solvable. They also check that share codes round-trip exactly, and that the physics behaves: the ball never escapes a wall, putts drop within a sensible speed range, and water, boost, sand and ice each do what they should.

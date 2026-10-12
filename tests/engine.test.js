import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Game, DIFFICULTIES, DIFFICULTY_ORDER } from '../src/engine.js';
import { handler, root } from '../scripts/serve.mjs';

test('difficulty presets configure expected grid dimensions and bug counts', () => {
  for (const key of DIFFICULTY_ORDER) {
    const preset = DIFFICULTIES[key];
    const game = new Game({ seed: 101, difficulty: key });
    assert.equal(game.cols, preset.cols);
    assert.equal(game.rows, preset.rows);
    assert.equal(game.bugs, preset.bugs);
    assert.equal(game.totalCells, preset.cols * preset.rows);
    assert.equal(game.safeCellsTotal, preset.cols * preset.rows - preset.bugs);
    assert.equal(game.status, 'ready');
  }
});

test('first-click safety guarantees a 3x3 bug-free neighborhood across seeds and positions', () => {
  const coords = [
    [0, 0],
    [8, 0],
    [0, 8],
    [8, 8],
    [4, 4],
    [2, 6],
  ];
  for (let seed = 1; seed <= 25; seed++) {
    for (const [x, y] of coords) {
      const game = new Game({ seed, difficulty: 'starter' });
      const res = game.reveal(x, y);
      assert.equal(game.status, 'playing');
      assert.equal(res.action, 'reveal');
      assert.ok(res.changed >= 1);
      assert.equal(game.cells.filter((c) => c.bug).length, game.bugs);
      const clicked = game.cellAt(x, y);
      assert.equal(clicked.bug, false);
      assert.equal(clicked.adjacent, 0, `seed ${seed} at (${x},${y}) should have 0 adjacent bugs`);
      for (const n of game.neighbors(x, y)) {
        assert.equal(n.bug, false);
        assert.equal(n.revealed, true);
      }
    }
  }
});

test('pre-populated bug on first-clicked tile is relocated safely on first reveal', () => {
  const game = new Game({ seed: 7, difficulty: 'starter' });
  game.start();
  // Manually place 10 bugs including at (4,4) and (4,5) before firstRevealDone
  for (let i = 0; i < 10; i++) game.cells[i].bug = true;
  game.cells[0].bug = false;
  game.cells[1].bug = false;
  game.cellAt(4, 4).bug = true;
  game.cellAt(4, 5).bug = true;
  game.recomputeAdjacency();

  const res = game.reveal(4, 4);
  assert.equal(res.action, 'reveal');
  assert.equal(game.cellAt(4, 4).bug, false);
  assert.equal(game.cellAt(4, 5).bug, false);
  assert.equal(game.cellAt(4, 4).adjacent, 0);
  assert.equal(game.cells.filter((c) => c.bug).length, 10);
});

test('flagging blocks accidental reveal and updates remainingBugs', () => {
  const game = new Game({ seed: 12, difficulty: 'starter' });
  game.reveal(4, 4);
  const target = game.cells.find((c) => !c.revealed);
  assert.ok(target);

  assert.equal(game.toggleFlag(target.x, target.y), true);
  assert.equal(game.flagsPlaced, 1);
  assert.equal(game.remainingBugs, game.bugs - 1);

  const blocked = game.reveal(target.x, target.y);
  assert.equal(blocked.action, 'blocked');
  assert.equal(target.revealed, false);

  assert.equal(game.toggleFlag(target.x, target.y), false);
  assert.equal(game.flagsPlaced, 0);
});

test('mode toggle switches actAt between reveal and flag', () => {
  const game = new Game({ seed: 19, difficulty: 'starter' });
  game.start();
  assert.equal(game.mode, 'reveal');
  game.toggleMode();
  assert.equal(game.mode, 'flag');

  const flagResult = game.actAt(1, 1);
  assert.equal(flagResult.action, 'flag');
  assert.equal(game.cellAt(1, 1).flagged, true);

  const unflagResult = game.actAt(1, 1);
  assert.equal(unflagResult.action, 'unflag');
  assert.equal(game.cellAt(1, 1).flagged, false);

  game.toggleMode();
  assert.equal(game.mode, 'reveal');
  const revealResult = game.actAt(1, 1);
  assert.equal(revealResult.action, 'reveal');
  assert.equal(game.cellAt(1, 1).revealed, true);
});

test('chording reveals neighbors when adjacent flags match and blocks when mismatched', () => {
  const game = new Game({ seed: 33, difficulty: 'starter' });
  game.reveal(4, 4);

  // Find a revealed numbered tile with unrevealed neighbors
  const numbered = game.cells.find(
    (c) => c.revealed && c.adjacent > 0 && game.neighbors(c.x, c.y).some((n) => !n.revealed)
  );
  assert.ok(numbered, 'should have a numbered border tile');

  // Without flags, chord is blocked
  const blocked = game.chord(numbered.x, numbered.y);
  assert.equal(blocked.action, 'chord-blocked');

  // Flag the actual adjacent bugs of this numbered tile
  const adjBugs = game.neighbors(numbered.x, numbered.y).filter((n) => n.bug);
  assert.equal(adjBugs.length, numbered.adjacent);
  for (const b of adjBugs) {
    if (!b.flagged) game.toggleFlag(b.x, b.y);
  }

  const unrevealedSafe = game.neighbors(numbered.x, numbered.y).filter((n) => !n.bug && !n.revealed);
  if (unrevealedSafe.length > 0) {
    const chordRes = game.chord(numbered.x, numbered.y);
    assert.equal(chordRes.action, 'chord');
    assert.ok(chordRes.changed >= unrevealedSafe.length);
    for (const s of unrevealedSafe) {
      assert.equal(s.revealed, true);
    }
  }
});

test('misplaced flag during chord or direct bug click triggers game over and marks wrongFlag', () => {
  const game = new Game({ seed: 55, difficulty: 'starter' });
  game.reveal(4, 4);

  const safeTile = game.cells.find((c) => !c.revealed && !c.bug);
  const bugTile = game.cells.find((c) => !c.revealed && c.bug);
  game.toggleFlag(safeTile.x, safeTile.y);

  const res = game.reveal(bugTile.x, bugTile.y);
  assert.equal(res.action, 'boom');
  assert.equal(game.status, 'over');
  assert.equal(game.mood, 'startled');
  assert.equal(bugTile.exploded, true);
  assert.equal(safeTile.wrongFlag, true);
});

test('revealing all safe tiles wins the game and auto-flags remaining bugs', () => {
  const game = new Game({ seed: 77, difficulty: 'starter' });
  game.reveal(4, 4);

  for (const cell of game.cells) {
    if (!cell.bug && !cell.revealed) {
      game.reveal(cell.x, cell.y);
    }
  }

  assert.equal(game.status, 'won');
  assert.equal(game.mood, 'celebrating');
  assert.equal(game.remainingSafe, 0);
  assert.equal(game.remainingBugs, 0);
  assert.equal(game.flagsPlaced, game.bugs);
  assert.ok(game.score > 0);
});

test('pause freezes timer and cursor movement until resumed', () => {
  const game = new Game({ seed: 99, difficulty: 'starter' });
  game.reveal(4, 4);
  game.update(2.5);
  assert.equal(game.elapsed, 2.5);

  assert.equal(game.pause(), true);
  assert.equal(game.status, 'paused');
  game.update(5.0);
  assert.equal(game.elapsed, 2.5);
  assert.equal(game.moveCursor(1, 0), false);

  assert.equal(game.pause(), true);
  assert.equal(game.status, 'playing');
  game.update(1.25);
  assert.equal(game.elapsed, 3.75);
  assert.equal(game.moveCursor(1, 0), true);
});

test('preview server serves published files at root and /mona-sweeper/ and rejects non-published files', async (t) => {
  const server = createServer(handler(root));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const path of ['/', '/mona-sweeper/', '/style.css', '/src/engine.js', '/assets/mona-sweeper-cover.svg']) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, path);
  }
  for (const blocked of ['/package.json', '/.git/config', '/../package.json']) {
    const res = await fetch(`${base}${blocked}`);
    assert.equal(res.status, 404, blocked);
  }
});

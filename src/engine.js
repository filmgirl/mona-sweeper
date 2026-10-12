// Pure, DOM-free Minesweeper simulation for Mona Sweeper.
// Rendering, DOM events, Web Audio, and localStorage live in main.js.

export const DIFFICULTIES = {
  starter: {
    id: 'starter',
    label: 'Starter Repo',
    repo: 'hello-world',
    branch: 'main',
    pr: 'Initialize clean contribution graph',
    cols: 9,
    rows: 9,
    bugs: 10,
  },
  active: {
    id: 'active',
    label: 'Active Repo',
    repo: 'octo-garden',
    branch: 'release/v2',
    pr: 'Sweep sprint regressions before merge',
    cols: 12,
    rows: 12,
    bugs: 22,
  },
  monorepo: {
    id: 'monorepo',
    label: 'Monorepo',
    repo: 'actions-fleet',
    branch: 'production',
    pr: 'Ship zero-bug monorepo release train',
    cols: 14,
    rows: 12,
    bugs: 28,
  },
};

export const DIFFICULTY_ORDER = ['starter', 'active', 'monorepo'];

export function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export class Game {
  constructor({ seed = 1, difficulty = 'starter', onEvent = () => {} } = {}) {
    this.seed = seed >>> 0 || 1;
    this.rng = mulberry32(this.seed);
    this.onEvent = onEvent;
    this.difficulty = DIFFICULTIES[difficulty] ? difficulty : 'starter';
    this.mode = 'reveal'; // 'reveal' | 'flag'
    this.newGame(this.difficulty, { readyOverlay: true });
  }

  get info() {
    return DIFFICULTIES[this.difficulty];
  }

  get totalCells() {
    return this.cols * this.rows;
  }

  get safeCellsTotal() {
    return this.totalCells - this.bugs;
  }

  get remainingSafe() {
    return Math.max(0, this.safeCellsTotal - this.revealedCount);
  }

  get remainingBugs() {
    return this.bugs - this.flagsPlaced;
  }

  get progressPercent() {
    if (this.safeCellsTotal <= 0) return 100;
    return Math.round((this.revealedCount / this.safeCellsTotal) * 100);
  }

  newGame(difficulty = this.difficulty, { readyOverlay = false, seed = null } = {}) {
    if (DIFFICULTIES[difficulty]) this.difficulty = difficulty;
    if (seed !== null) {
      this.seed = seed >>> 0 || 1;
      this.rng = mulberry32(this.seed);
    }
    const preset = this.info;
    this.cols = preset.cols;
    this.rows = preset.rows;
    this.bugs = preset.bugs;
    this.status = readyOverlay ? 'ready' : 'playing';
    this.mood = 'ready'; // 'ready' | 'sweeping' | 'careful' | 'celebrating' | 'startled' | 'paused'
    this.firstRevealDone = false;
    this.revealedCount = 0;
    this.flagsPlaced = 0;
    this.elapsed = 0;
    this.score = 0;
    this.moves = 0;
    this.cursor = {
      x: Math.floor(this.cols / 2),
      y: Math.floor(this.rows / 2),
    };
    this.cells = [];
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const commitLevel = 1 + Math.floor(this.rng() * 4); // 1..4 contribution green shade
        this.cells.push({
          index: y * this.cols + x,
          x,
          y,
          bug: false,
          revealed: false,
          flagged: false,
          exploded: false,
          wrongFlag: false,
          adjacent: 0,
          commitLevel,
        });
      }
    }
    this.onEvent('new-game', { difficulty: this.difficulty, cols: this.cols, rows: this.rows, bugs: this.bugs });
  }

  start() {
    if (this.status === 'ready') {
      this.status = 'playing';
      this.mood = 'sweeping';
      this.onEvent('start', { difficulty: this.difficulty });
    }
  }

  cellAt(x, y) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return null;
    return this.cells[y * this.cols + x];
  }

  neighbors(x, y) {
    const list = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const c = this.cellAt(x + dx, y + dy);
        if (c) list.push(c);
      }
    }
    return list;
  }

  recomputeAdjacency() {
    for (const cell of this.cells) {
      if (cell.bug) {
        cell.adjacent = -1;
        continue;
      }
      let count = 0;
      for (const n of this.neighbors(cell.x, cell.y)) {
        if (n.bug) count += 1;
      }
      cell.adjacent = count;
    }
  }

  placeBugsSafe(safeX, safeY) {
    for (const cell of this.cells) cell.bug = false;

    const isNeighborhood = (c) => Math.abs(c.x - safeX) <= 1 && Math.abs(c.y - safeY) <= 1;
    const isExact = (c) => c.x === safeX && c.y === safeY;

    let pool = this.cells.filter((c) => !isNeighborhood(c));
    if (pool.length < this.bugs) {
      pool = this.cells.filter((c) => !isExact(c));
    }

    // Fisher-Yates shuffle on candidate pool using deterministic RNG
    const candidates = [...pool];
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const count = Math.min(this.bugs, candidates.length);
    for (let i = 0; i < count; i++) {
      candidates[i].bug = true;
    }
    this.recomputeAdjacency();
    this.firstRevealDone = true;
  }

  ensureFirstClickSafe(safeX, safeY) {
    if (!this.firstRevealDone) {
      const hasAnyPreplacedBugs = this.cells.some((c) => c.bug);
      if (!hasAnyPreplacedBugs) {
        this.placeBugsSafe(safeX, safeY);
        return;
      }
      // If a test pre-populated bugs before first reveal, relocate any bugs in the safe zone
      const isNeighborhood = (c) => Math.abs(c.x - safeX) <= 1 && Math.abs(c.y - safeY) <= 1;
      const isExact = (c) => c.x === safeX && c.y === safeY;
      const unsafeCells = this.cells.filter((c) => c.bug && isNeighborhood(c));
      if (unsafeCells.length > 0) {
        let replacements = this.cells.filter((c) => !c.bug && !isNeighborhood(c));
        if (replacements.length < unsafeCells.length) {
          replacements = this.cells.filter((c) => !c.bug && !isExact(c));
        }
        for (const unsafe of unsafeCells) {
          if (replacements.length === 0) break;
          const replacement = replacements.shift();
          unsafe.bug = false;
          replacement.bug = true;
        }
        this.recomputeAdjacency();
      }
      this.firstRevealDone = true;
    }
  }

  setMode(mode) {
    if (mode !== 'reveal' && mode !== 'flag') return this.mode;
    this.mode = mode;
    this.onEvent('mode', { mode: this.mode });
    return this.mode;
  }

  toggleMode() {
    return this.setMode(this.mode === 'reveal' ? 'flag' : 'reveal');
  }

  moveCursor(dx, dy) {
    if (this.status === 'paused') return false;
    const nx = Math.max(0, Math.min(this.cols - 1, this.cursor.x + dx));
    const ny = Math.max(0, Math.min(this.rows - 1, this.cursor.y + dy));
    const moved = nx !== this.cursor.x || ny !== this.cursor.y;
    this.cursor = { x: nx, y: ny };
    if (moved) this.onEvent('cursor', { x: nx, y: ny });
    return moved;
  }

  setCursor(x, y) {
    const cell = this.cellAt(x, y);
    if (!cell) return false;
    this.cursor = { x, y };
    return true;
  }

  actAt(x = this.cursor.x, y = this.cursor.y) {
    const cell = this.cellAt(x, y);
    if (!cell) return { action: 'none', changed: 0 };
    this.cursor = { x, y };
    if (this.status === 'ready') this.start();
    if (this.status !== 'playing') return { action: 'none', changed: 0 };

    if (cell.revealed) {
      if (cell.adjacent > 0) return this.chord(x, y);
      return { action: 'none', changed: 0 };
    }
    if (this.mode === 'flag') {
      const flagged = this.toggleFlag(x, y);
      return { action: flagged ? 'flag' : 'unflag', changed: 1 };
    }
    return this.reveal(x, y);
  }

  toggleFlag(x = this.cursor.x, y = this.cursor.y) {
    const cell = this.cellAt(x, y);
    if (!cell) return null;
    if (this.status === 'ready') this.start();
    if (this.status !== 'playing' || cell.revealed) return null;

    this.cursor = { x, y };
    cell.flagged = !cell.flagged;
    this.flagsPlaced += cell.flagged ? 1 : -1;
    this.mood = 'careful';
    this.onEvent(cell.flagged ? 'flag' : 'unflag', {
      x,
      y,
      flagged: cell.flagged,
      remainingBugs: this.remainingBugs,
    });
    return cell.flagged;
  }

  reveal(x = this.cursor.x, y = this.cursor.y) {
    const cell = this.cellAt(x, y);
    if (!cell) return { action: 'none', changed: 0 };
    if (this.status === 'ready') this.start();
    if (this.status !== 'playing') return { action: 'none', changed: 0 };

    this.cursor = { x, y };
    if (cell.flagged) {
      this.onEvent('blocked', { x, y });
      return { action: 'blocked', changed: 0 };
    }
    if (cell.revealed) {
      if (cell.adjacent > 0) return this.chord(x, y);
      return { action: 'none', changed: 0 };
    }

    this.ensureFirstClickSafe(x, y);
    this.moves += 1;

    if (cell.bug) {
      this.triggerBugLoss(cell);
      return { action: 'boom', changed: 1 };
    }

    const revealedCells = this.floodReveal([cell]);
    this.mood = 'sweeping';
    this.onEvent(revealedCells.length > 1 ? 'cascade' : 'reveal', {
      x,
      y,
      count: revealedCells.length,
      cells: revealedCells,
    });
    this.checkWinCondition();
    return { action: 'reveal', changed: revealedCells.length };
  }

  chord(x = this.cursor.x, y = this.cursor.y) {
    const cell = this.cellAt(x, y);
    if (!cell || this.status !== 'playing' || !cell.revealed || cell.adjacent <= 0) {
      return { action: 'none', changed: 0 };
    }
    this.cursor = { x, y };
    const adj = this.neighbors(x, y);
    const flaggedCount = adj.filter((n) => n.flagged).length;
    if (flaggedCount !== cell.adjacent) {
      this.onEvent('chord-blocked', { x, y, needed: cell.adjacent, flagged: flaggedCount });
      return { action: 'chord-blocked', changed: 0 };
    }

    const unrevealed = adj.filter((n) => !n.flagged && !n.revealed);
    if (unrevealed.length === 0) return { action: 'none', changed: 0 };

    this.moves += 1;
    const hitBug = unrevealed.find((n) => n.bug);
    if (hitBug) {
      this.triggerBugLoss(hitBug);
      return { action: 'boom', changed: 1 };
    }

    const revealedCells = this.floodReveal(unrevealed);
    this.mood = 'sweeping';
    this.onEvent('chord', { x, y, count: revealedCells.length, cells: revealedCells });
    this.checkWinCondition();
    return { action: 'chord', changed: revealedCells.length };
  }

  floodReveal(seeds) {
    const queue = [...seeds];
    const revealed = [];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current.revealed || current.flagged || current.bug) continue;
      current.revealed = true;
      this.revealedCount += 1;
      this.score += 15 + current.commitLevel * 5;
      revealed.push(current);
      if (current.adjacent === 0) {
        for (const n of this.neighbors(current.x, current.y)) {
          if (!n.revealed && !n.flagged && !n.bug) {
            queue.push(n);
          }
        }
      }
    }
    return revealed;
  }

  triggerBugLoss(hitCell) {
    hitCell.revealed = true;
    hitCell.exploded = true;
    for (const c of this.cells) {
      if (c.bug && !c.flagged) c.revealed = true;
      if (!c.bug && c.flagged) c.wrongFlag = true;
    }
    this.status = 'over';
    this.mood = 'startled';
    this.onEvent('over', {
      x: hitCell.x,
      y: hitCell.y,
      score: this.score,
      elapsed: this.elapsed,
    });
  }

  checkWinCondition() {
    if (this.revealedCount < this.safeCellsTotal) return false;
    for (const c of this.cells) {
      if (c.bug && !c.flagged) {
        c.flagged = true;
        this.flagsPlaced += 1;
      }
    }
    const timeBonus = Math.max(50, 500 - Math.floor(this.elapsed) * 2);
    const difficultyMultiplier = this.difficulty === 'monorepo' ? 3 : this.difficulty === 'active' ? 2 : 1;
    this.score += timeBonus * difficultyMultiplier;
    this.status = 'won';
    this.mood = 'celebrating';
    this.onEvent('won', {
      difficulty: this.difficulty,
      score: this.score,
      elapsed: this.elapsed,
      moves: this.moves,
    });
    return true;
  }

  pause() {
    if (this.status === 'playing') {
      this.status = 'paused';
      this.mood = 'paused';
      this.onEvent('pause', {});
      return true;
    }
    if (this.status === 'paused') {
      this.status = 'playing';
      this.mood = 'sweeping';
      this.onEvent('resume', {});
      return true;
    }
    return false;
  }

  update(dt) {
    if (this.status !== 'playing' || !(dt > 0)) return;
    this.elapsed = Math.min(999, this.elapsed + dt);
  }
}

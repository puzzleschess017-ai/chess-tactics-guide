/**
 * Official Lichess Puzzle Database CSV / ZST Importer
 *
 * Usage:
 *   npm run import-puzzles -- <path-to-lichess_db_puzzle.csv[.zst]> [--limit=50000] [--replace] [--validate-chess]
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import zlib from 'zlib';
import {
  ABSOLUTE_MIN_PUZZLE_RATING,
  computePuzzleSignature,
  validateLichessPuzzle,
} from '../src/lib/puzzleValidator.ts';
import { PuzzleDatasetStats } from '../src/types/chess.ts';

const DB_PATH = process.env.PUZZLE_DB_PATH || path.resolve(process.cwd(), 'data', 'puzzles.db');
const UCI_REGEX = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const MAX_RAND_KEY = 2147483647;

function isStructurallyValidRow(
  puzzleId: string,
  fen: string,
  moves: string,
  rating: number
): boolean {
  if (!puzzleId || !fen || !moves || !Number.isFinite(rating) || rating < ABSOLUTE_MIN_PUZZLE_RATING) {
    return false;
  }
  const fenParts = fen.split(/\s+/);
  if (fenParts.length !== 6) return false;
  if (fenParts[1] !== 'w' && fenParts[1] !== 'b') return false;
  const ranks = fenParts[0].split('/');
  if (ranks.length !== 8) return false;

  const moveTokens = moves.split(/\s+/).filter(Boolean);
  if (moveTokens.length < 2 || moveTokens.length % 2 !== 0) return false;
  for (let i = 0; i < moveTokens.length; i++) {
    if (!UCI_REGEX.test(moveTokens[i])) return false;
  }
  return true;
}

async function* iterateLines(filePath: string): AsyncGenerator<string> {
  const isZst = filePath.endsWith('.zst');
  const fileStream = fs.createReadStream(filePath);
  const inputStream = isZst
    ? fileStream.pipe(zlib.createZstdDecompress())
    : fileStream;

  const rl = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    yield line;
  }
}

function createBaseSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS puzzles (
      puzzle_id TEXT PRIMARY KEY,
      fen TEXT NOT NULL,
      moves TEXT NOT NULL,
      rating INTEGER NOT NULL,
      rating_deviation INTEGER NOT NULL DEFAULT 75,
      popularity INTEGER NOT NULL DEFAULT 90,
      nb_plays INTEGER NOT NULL DEFAULT 1000,
      themes TEXT NOT NULL,
      game_url TEXT NOT NULL DEFAULT '',
      is_sample INTEGER NOT NULL DEFAULT 0,
      signature TEXT NOT NULL DEFAULT '',
      rand_key INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS puzzle_themes (
      theme TEXT NOT NULL,
      rating INTEGER NOT NULL,
      rand_key INTEGER NOT NULL,
      puzzle_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS db_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_user_state (
      anon_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_seen_puzzles (
      anon_id TEXT NOT NULL,
      puzzle_id TEXT NOT NULL,
      signature TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      seen_at TEXT NOT NULL,
      PRIMARY KEY (anon_id, puzzle_id, scope)
    );
  `);
}

function createIndexes(db: Database.Database): void {
  console.log('Building SQLite indexes on disk (temp_store=FILE)...');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_puzzles_rating ON puzzles (rating);
    CREATE INDEX IF NOT EXISTS idx_puzzles_signature ON puzzles (signature);
    CREATE INDEX IF NOT EXISTS idx_puzzles_rand_rating ON puzzles (rand_key, rating);
    CREATE INDEX IF NOT EXISTS idx_pt_theme_rand ON puzzle_themes (theme, rand_key, rating);
    CREATE INDEX IF NOT EXISTS idx_pt_theme_rating ON puzzle_themes (theme, rating);
    CREATE INDEX IF NOT EXISTS idx_user_seen_lookup ON user_seen_puzzles (anon_id, scope, signature);
    CREATE INDEX IF NOT EXISTS idx_user_seen_pid ON user_seen_puzzles (anon_id, scope, puzzle_id);
  `);
}

function copyExistingUserTables(sourceDbPath: string, targetDb: Database.Database): void {
  if (!fs.existsSync(sourceDbPath)) return;
  const src = new Database(sourceDbPath, { readonly: true });
  try {
    const stateRows = src
      .prepare('SELECT anon_id, state_json, updated_at FROM local_user_state')
      .all() as Array<{ anon_id: string; state_json: string; updated_at: string }>;
    if (stateRows.length > 0) {
      const ins = targetDb.prepare(
        'INSERT OR REPLACE INTO local_user_state (anon_id, state_json, updated_at) VALUES (?, ?, ?)'
      );
      const tx = targetDb.transaction(() => {
        for (const r of stateRows) {
          ins.run(r.anon_id, r.state_json, r.updated_at);
        }
      });
      tx();
    }

    const seenRows = src
      .prepare('SELECT anon_id, puzzle_id, signature, scope, seen_at FROM user_seen_puzzles')
      .all() as Array<{
      anon_id: string;
      puzzle_id: string;
      signature: string;
      scope: string;
      seen_at: string;
    }>;
    if (seenRows.length > 0) {
      const ins = targetDb.prepare(
        'INSERT OR IGNORE INTO user_seen_puzzles (anon_id, puzzle_id, signature, scope, seen_at) VALUES (?, ?, ?, ?, ?)'
      );
      const tx = targetDb.transaction(() => {
        for (const r of seenRows) {
          ins.run(r.anon_id, r.puzzle_id, r.signature, r.scope, r.seen_at);
        }
      });
      tx();
    }

    console.log(
      `Preserved ${stateRows.length} user profile(s) and ${seenRows.length} seen-puzzle history row(s).`
    );
  } catch (err) {
    console.warn('Note while preserving user tables:', err instanceof Error ? err.message : err);
  } finally {
    src.close();
  }
}

export interface ImportOptions {
  inputPath: string;
  limit?: number;
  replace?: boolean;
  validateChess?: boolean;
  unlinkSource?: boolean;
}

export async function runImport(options: ImportOptions): Promise<number> {
  const { inputPath, limit = Infinity, replace = false, validateChess = false, unlinkSource = false } = options;

  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error(`Ulazni fajl ne postoji: ${inputPath}`);
  }

  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const stagingPath = replace ? `${DB_PATH}.importing` : DB_PATH;
  if (replace) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      if (fs.existsSync(`${stagingPath}${suffix}`)) {
        fs.unlinkSync(`${stagingPath}${suffix}`);
      }
    }
  }

  const db = new Database(stagingPath);
  if (replace) {
    db.pragma('journal_mode = OFF');
    db.pragma('synchronous = OFF');
    db.pragma('locking_mode = EXCLUSIVE');
    db.pragma('cache_size = -32000');
    db.pragma('temp_store = FILE');
    createBaseSchema(db);
    copyExistingUserTables(DB_PATH, db);
  } else {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    createBaseSchema(db);
    createIndexes(db);
  }

  const insertPuzzle = db.prepare(`
    INSERT OR IGNORE INTO puzzles
    (puzzle_id, fen, moves, rating, rating_deviation, popularity, nb_plays, themes, game_url, is_sample, signature, rand_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);

  type RowTuple = [
    string,
    string,
    string,
    number,
    number,
    number,
    number,
    string,
    string,
    string,
    number,
  ];
  const BATCH_SIZE = 10000;
  const batch: RowTuple[] = [];
  const themeCounts: Record<string, number> = {};
  let minR = Infinity;
  let maxR = -Infinity;

  const flush = db.transaction((rows: RowTuple[]) => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      insertPuzzle.run(
        r[0],
        r[1],
        r[2],
        r[3],
        r[4],
        r[5],
        r[6],
        r[7],
        r[8],
        r[9],
        r[10]
      );
      if (r[7]) {
        const tokens = r[7].split(/\s+/);
        for (let j = 0; j < tokens.length; j++) {
          const t = tokens[j];
          if (t) {
            themeCounts[t] = (themeCounts[t] || 0) + 1;
          }
        }
      }
    }
  });

  const startedAt = Date.now();
  let count = 0;
  let rejected = 0;
  let lineNum = 0;

  for await (const line of iterateLines(inputPath)) {
    lineNum++;
    if (!line) continue;
    if (lineNum === 1 && line.startsWith('PuzzleId,')) continue;

    const parts = line.split(',');
    if (parts.length < 9) {
      rejected++;
      continue;
    }

    const puzzleId = parts[0].trim();
    const fen = parts[1].trim();
    const moves = parts[2].trim();
    const rating = parseInt(parts[3], 10);

    if (!isStructurallyValidRow(puzzleId, fen, moves, rating)) {
      rejected++;
      continue;
    }

    const ratingDeviation = parseInt(parts[4], 10) || 75;
    const popularity = parseInt(parts[5], 10) || 85;
    const nbPlays = parseInt(parts[6], 10) || 0;
    const themes = parts[7].trim();
    const gameUrl = parts[8].trim();

    if (validateChess) {
      const res = validateLichessPuzzle(
        {
          puzzleId,
          fen,
          moves,
          rating,
          ratingDeviation,
          popularity,
          nbPlays,
          themes,
          gameUrl,
        },
        { minRating: ABSOLUTE_MIN_PUZZLE_RATING }
      );
      if (!res.valid) {
        rejected++;
        continue;
      }
    }

    const signature = computePuzzleSignature(fen, moves);
    const randKey = 1 + Math.floor(Math.random() * (MAX_RAND_KEY - 1));

    if (rating < minR) minR = rating;
    if (rating > maxR) maxR = rating;

    batch.push([
      puzzleId,
      fen,
      moves,
      rating,
      ratingDeviation,
      popularity,
      nbPlays,
      themes,
      gameUrl,
      signature,
      randKey,
    ]);

    count++;
    if (batch.length >= BATCH_SIZE) {
      flush(batch);
      batch.length = 0;
      if (count % 200000 === 0) {
        const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(
          `Imported ${count.toLocaleString()} puzzles in ${elapsedSec}s (rejected ${rejected.toLocaleString()})...`
        );
      }
    }

    if (count >= limit) break;
  }

  if (batch.length > 0) {
    flush(batch);
    batch.length = 0;
  }

  if (replace) {
    if (unlinkSource && fs.existsSync(inputPath)) {
      fs.unlinkSync(inputPath);
      console.log(`Removed temporary source archive ${inputPath} before indexing to free memory.`);
    }
    createIndexes(db);
    const stats: PuzzleDatasetStats = {
      totalPuzzles: count,
      sourceLabel: `Lichess Open Puzzle Database (${count.toLocaleString()} indexed puzzles)`,
      isSampleDataset: false,
      ratingRange: {
        min: Number.isFinite(minR) ? minR : ABSOLUTE_MIN_PUZZLE_RATING,
        max: Number.isFinite(maxR) ? maxR : 3400,
      },
      themeCounts,
    };
    db.prepare(`
      INSERT INTO db_meta (key, value) VALUES ('dataset_stats_v1', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(stats));

    db.pragma('locking_mode = NORMAL');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.close();

    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      if (fs.existsSync(`${DB_PATH}${suffix}`)) {
        fs.unlinkSync(`${DB_PATH}${suffix}`);
      }
    }
    fs.renameSync(stagingPath, DB_PATH);
    for (const suffix of ['-wal', '-shm', '-journal']) {
      if (fs.existsSync(`${stagingPath}${suffix}`)) {
        fs.unlinkSync(`${stagingPath}${suffix}`);
      }
    }
  } else {
    db.prepare("DELETE FROM db_meta WHERE key = 'dataset_stats_v1'").run();
    db.close();
  }

  const totalSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `Done in ${totalSec}s! Imported ${count.toLocaleString()} official Lichess puzzles into ${DB_PATH} (rejected ${rejected.toLocaleString()}).`
  );
  return count;
}

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args.find((a) => !a.startsWith('--'));
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const replace = args.includes('--replace');
  const validateChess = args.includes('--validate-chess');
  const unlinkSource = args.includes('--unlink-source');
  const maxRows = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error(
      'Usage: npm run import-puzzles -- <path-to-lichess_db_puzzle.csv[.zst]> [--limit=50000] [--replace] [--validate-chess] [--unlink-source]'
    );
    process.exit(1);
  }

  await runImport({
    inputPath,
    limit: maxRows,
    replace,
    validateChess,
    unlinkSource,
  });
}

// Only invoke main when directly executed
const isDirectCli = process.argv[1]?.replace(/\\/g, '/').endsWith('import-lichess-puzzles.ts');
if (isDirectCli) {
  main().catch((err) => {
    console.error('Import failed:', err);
    process.exit(1);
  });
}

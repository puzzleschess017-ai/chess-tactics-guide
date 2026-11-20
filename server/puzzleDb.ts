import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { LichessPuzzle, PuzzleDatasetStats } from '../src/types/chess.ts';
import {
  ABSOLUTE_MIN_PUZZLE_RATING,
  MIN_PUZZLE_RATING,
  computePuzzleSignature,
  selectValidPuzzles,
  validateLichessPuzzle,
} from '../src/lib/puzzleValidator.ts';
import { SAMPLE_DATASET_VERSION, SAMPLE_PUZZLES } from './samplePuzzles.ts';

const DB_PATH = process.env.PUZZLE_DB_PATH || path.resolve(process.cwd(), 'data', 'puzzles.db');
const MAX_RAND_KEY = 2147483647;

let dbInstance: Database.Database | null = null;
let hasThemeIndexCache: boolean | null = null;

function randomRandKey(): number {
  return 1 + Math.floor(Math.random() * (MAX_RAND_KEY - 1));
}

function hasThemeIndex(db: Database.Database): boolean {
  if (hasThemeIndexCache !== null) return hasThemeIndexCache;
  try {
    const row = db.prepare('SELECT 1 as ok FROM puzzle_themes LIMIT 1').get() as
      | { ok: number }
      | undefined;
    hasThemeIndexCache = Boolean(row);
  } catch {
    hasThemeIndexCache = false;
  }
  return hasThemeIndexCache;
}

export function getPuzzleDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

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

    CREATE INDEX IF NOT EXISTS idx_user_seen_lookup
      ON user_seen_puzzles (anon_id, scope, signature);
    CREATE INDEX IF NOT EXISTS idx_user_seen_pid
      ON user_seen_puzzles (anon_id, scope, puzzle_id);
  `);

  // Safe schema migrations for existing DBs
  const cols = db.prepare('PRAGMA table_info(puzzles)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'signature')) {
    db.exec("ALTER TABLE puzzles ADD COLUMN signature TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.some((c) => c.name === 'rand_key')) {
    db.exec('ALTER TABLE puzzles ADD COLUMN rand_key INTEGER NOT NULL DEFAULT 0');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_puzzles_rating ON puzzles (rating);
    CREATE INDEX IF NOT EXISTS idx_puzzles_signature ON puzzles (signature);
    CREATE INDEX IF NOT EXISTS idx_puzzles_rand_rating ON puzzles (rand_key, rating);
    CREATE INDEX IF NOT EXISTS idx_pt_theme_rand ON puzzle_themes (theme, rand_key, rating);
    CREATE INDEX IF NOT EXISTS idx_pt_theme_rating ON puzzle_themes (theme, rating);
  `);

  const hasOfficialRow = db
    .prepare('SELECT 1 as ok FROM puzzles WHERE is_sample = 0 LIMIT 1')
    .get() as { ok: number } | undefined;

  if (!hasOfficialRow) {
    const versionRow = db
      .prepare("SELECT value FROM db_meta WHERE key = 'sample_dataset_version'")
      .get() as { value: string } | undefined;
    const anyRow = db.prepare('SELECT 1 as ok FROM puzzles LIMIT 1').get() as
      | { ok: number }
      | undefined;

    if (!anyRow || versionRow?.value !== SAMPLE_DATASET_VERSION) {
      const syncSamples = db.transaction((items: LichessPuzzle[]) => {
        db.prepare('DELETE FROM puzzles WHERE is_sample = 1').run();
        db.prepare('DELETE FROM puzzle_themes').run();
        const insert = db.prepare(`
          INSERT OR IGNORE INTO puzzles
          (puzzle_id, fen, moves, rating, rating_deviation, popularity, nb_plays, themes, game_url, is_sample, signature, rand_key)
          VALUES (@puzzleId, @fen, @moves, @rating, @ratingDeviation, @popularity, @nbPlays, @themes, @gameUrl, 1, @signature, @randKey)
        `);
        const insertTheme = db.prepare(`
          INSERT INTO puzzle_themes (theme, rating, rand_key, puzzle_id)
          VALUES (?, ?, ?, ?)
        `);
        for (const item of items) {
          if (validateLichessPuzzle(item, { minRating: MIN_PUZZLE_RATING }).valid) {
            const rk = randomRandKey();
            insert.run({
              ...item,
              signature: computePuzzleSignature(item.fen, item.moves),
              randKey: rk,
            });
            const tokens = new Set(item.themes.split(/\s+/).filter(Boolean));
            for (const t of tokens) {
              insertTheme.run(t, item.rating, rk, item.puzzleId);
            }
          }
        }
        db.prepare(`
          INSERT INTO db_meta (key, value) VALUES ('sample_dataset_version', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(SAMPLE_DATASET_VERSION);
        db.prepare("DELETE FROM db_meta WHERE key = 'dataset_stats_v1'").run();
      });
      syncSamples(SAMPLE_PUZZLES);
      hasThemeIndexCache = null;
    }
  }

  // Bounded backfill for any rows missing signature or rand_key (safe on 6M+ DBs)
  const missingSig = db
    .prepare("SELECT 1 as ok FROM puzzles WHERE signature = '' OR signature IS NULL LIMIT 1")
    .get() as { ok: number } | undefined;
  if (missingSig) {
    const selectMissing = db.prepare(
      "SELECT puzzle_id, fen, moves FROM puzzles WHERE signature = '' OR signature IS NULL LIMIT 5000"
    );
    const updSig = db.prepare('UPDATE puzzles SET signature = ? WHERE puzzle_id = ?');
    const backfillSigBatch = db.transaction(
      (rows: Array<{ puzzle_id: string; fen: string; moves: string }>) => {
        for (const r of rows) {
          updSig.run(computePuzzleSignature(r.fen, r.moves), r.puzzle_id);
        }
      }
    );
    while (true) {
      const batch = selectMissing.all() as Array<{ puzzle_id: string; fen: string; moves: string }>;
      if (batch.length === 0) break;
      backfillSigBatch(batch);
    }
  }

  const missingRk = db
    .prepare('SELECT 1 as ok FROM puzzles WHERE rand_key = 0 LIMIT 1')
    .get() as { ok: number } | undefined;
  if (missingRk) {
    const selectMissingRk = db.prepare('SELECT puzzle_id FROM puzzles WHERE rand_key = 0 LIMIT 10000');
    const updRk = db.prepare('UPDATE puzzles SET rand_key = ? WHERE puzzle_id = ?');
    const backfillRkBatch = db.transaction((rows: Array<{ puzzle_id: string }>) => {
      for (const r of rows) {
        updRk.run(randomRandKey(), r.puzzle_id);
      }
    });
    while (true) {
      const batch = selectMissingRk.all() as Array<{ puzzle_id: string }>;
      if (batch.length === 0) break;
      backfillRkBatch(batch);
    }
  }

  dbInstance = db;
  return db;
}

interface RawPuzzleRow {
  puzzle_id: string;
  fen: string;
  moves: string;
  rating: number;
  rating_deviation: number;
  popularity: number;
  nb_plays: number;
  themes: string;
  game_url: string;
  signature: string;
}

function mapRow(row: RawPuzzleRow): LichessPuzzle {
  return {
    puzzleId: row.puzzle_id,
    fen: row.fen,
    moves: row.moves,
    rating: row.rating,
    ratingDeviation: row.rating_deviation,
    popularity: row.popularity,
    nbPlays: row.nb_plays,
    themes: row.themes,
    gameUrl: row.game_url,
  };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}

function normalizeThemeFilter(theme?: string): string | undefined {
  if (!theme || theme === 'all' || theme === 'mixed') return undefined;
  return theme.trim() || undefined;
}

function buildBaseFilter(opts: {
  minRating: number;
  maxRating?: number;
  theme?: string;
}): { conditions: string[]; params: (string | number)[] } {
  const conditions: string[] = ['p.rating >= ?'];
  const params: (string | number)[] = [opts.minRating];

  if (typeof opts.maxRating === 'number') {
    conditions.push('p.rating <= ?');
    params.push(Math.max(opts.minRating, opts.maxRating));
  }

  const cleanTheme = normalizeThemeFilter(opts.theme);
  if (cleanTheme) {
    conditions.push("(' ' || p.themes || ' ') LIKE ? ESCAPE '\\'");
    params.push(`% ${escapeLike(cleanTheme)} %`);
  }

  return { conditions, params };
}

/**
 * O(log N) indexed random sampling across eligible rows using rand_key cursor + wrap-around.
 * Eliminates full-table scans and O(N) LIMIT/OFFSET walks on multi-million-row datasets.
 */
function sampleRandomRows(
  db: Database.Database,
  opts: {
    minRating: number;
    maxRating?: number;
    theme?: string;
    anonId?: string;
    excludedScopes?: string[];
    excludeIds?: string[];
    desiredCount: number;
  }
): RawPuzzleRow[] {
  const cleanTheme = normalizeThemeFilter(opts.theme);
  const useThemesTable = Boolean(cleanTheme && hasThemeIndex(db));
  const desiredCount = Math.max(1, opts.desiredCount);

  if (useThemesTable && cleanTheme) {
    const conditions: string[] = ['pt.theme = ?', 'pt.rating >= ?'];
    const params: (string | number)[] = [cleanTheme, opts.minRating];

    if (typeof opts.maxRating === 'number') {
      conditions.push('pt.rating <= ?');
      params.push(Math.max(opts.minRating, opts.maxRating));
    }

    if (opts.anonId && opts.excludedScopes && opts.excludedScopes.length > 0) {
      const scopePlaceholders = opts.excludedScopes.map(() => '?').join(',');
      conditions.push(
        `NOT EXISTS (
          SELECT 1 FROM user_seen_puzzles s1
          WHERE s1.anon_id = ? AND s1.scope IN (${scopePlaceholders})
            AND s1.puzzle_id = p.puzzle_id
        )`
      );
      params.push(opts.anonId, ...opts.excludedScopes);
      conditions.push(
        `NOT EXISTS (
          SELECT 1 FROM user_seen_puzzles s2
          WHERE s2.anon_id = ? AND s2.scope IN (${scopePlaceholders})
            AND s2.signature = p.signature
        )`
      );
      params.push(opts.anonId, ...opts.excludedScopes);
    }

    if (opts.excludeIds && opts.excludeIds.length > 0) {
      const safe = opts.excludeIds.slice(-900);
      conditions.push(`pt.puzzle_id NOT IN (${safe.map(() => '?').join(',')})`);
      params.push(...safe);
    }

    const whereSql = conditions.join(' AND ');
    const pivot = randomRandKey();

    const rows = db
      .prepare(
        `SELECT p.puzzle_id, p.fen, p.moves, p.rating, p.rating_deviation, p.popularity, p.nb_plays, p.themes, p.game_url, p.signature
         FROM puzzle_themes pt
         JOIN puzzles p ON p.puzzle_id = pt.puzzle_id
         WHERE ${whereSql} AND pt.rand_key >= ?
         ORDER BY pt.rand_key ASC
         LIMIT ?`
      )
      .all(...params, pivot, desiredCount) as RawPuzzleRow[];

    if (rows.length < desiredCount) {
      const remaining = desiredCount - rows.length;
      const seenIds = new Set(rows.map((r) => r.puzzle_id));
      const wrapRows = db
        .prepare(
          `SELECT p.puzzle_id, p.fen, p.moves, p.rating, p.rating_deviation, p.popularity, p.nb_plays, p.themes, p.game_url, p.signature
           FROM puzzle_themes pt
           JOIN puzzles p ON p.puzzle_id = pt.puzzle_id
           WHERE ${whereSql} AND pt.rand_key < ?
           ORDER BY pt.rand_key ASC
           LIMIT ?`
        )
        .all(...params, pivot, remaining) as RawPuzzleRow[];
      for (const r of wrapRows) {
        if (!seenIds.has(r.puzzle_id)) {
          seenIds.add(r.puzzle_id);
          rows.push(r);
        }
      }
    }

    return rows;
  }

  // Standard puzzles table path using idx_puzzles_rand_rating
  const base = buildBaseFilter({
    minRating: opts.minRating,
    maxRating: opts.maxRating,
    theme: cleanTheme,
  });
  const conditions = [...base.conditions];
  const params = [...base.params];

  if (opts.anonId && opts.excludedScopes && opts.excludedScopes.length > 0) {
    const scopePlaceholders = opts.excludedScopes.map(() => '?').join(',');
    conditions.push(
      `NOT EXISTS (
        SELECT 1 FROM user_seen_puzzles s1
        WHERE s1.anon_id = ? AND s1.scope IN (${scopePlaceholders})
          AND s1.puzzle_id = p.puzzle_id
      )`
    );
    params.push(opts.anonId, ...opts.excludedScopes);
    conditions.push(
      `NOT EXISTS (
        SELECT 1 FROM user_seen_puzzles s2
        WHERE s2.anon_id = ? AND s2.scope IN (${scopePlaceholders})
          AND s2.signature = p.signature
      )`
    );
    params.push(opts.anonId, ...opts.excludedScopes);
  }

  if (opts.excludeIds && opts.excludeIds.length > 0) {
    const safe = opts.excludeIds.slice(-900);
    conditions.push(`p.puzzle_id NOT IN (${safe.map(() => '?').join(',')})`);
    params.push(...safe);
  }

  const whereSql = conditions.join(' AND ');
  const pivot = randomRandKey();

  const rows = db
    .prepare(
      `SELECT p.puzzle_id, p.fen, p.moves, p.rating, p.rating_deviation, p.popularity, p.nb_plays, p.themes, p.game_url, p.signature
       FROM puzzles p INDEXED BY idx_puzzles_rand_rating
       WHERE ${whereSql} AND p.rand_key >= ?
       ORDER BY p.rand_key ASC
       LIMIT ?`
    )
    .all(...params, pivot, desiredCount) as RawPuzzleRow[];

  if (rows.length < desiredCount) {
    const remaining = desiredCount - rows.length;
    const seenIds = new Set(rows.map((r) => r.puzzle_id));
    const wrapRows = db
      .prepare(
        `SELECT p.puzzle_id, p.fen, p.moves, p.rating, p.rating_deviation, p.popularity, p.nb_plays, p.themes, p.game_url, p.signature
         FROM puzzles p INDEXED BY idx_puzzles_rand_rating
         WHERE ${whereSql} AND p.rand_key < ?
         ORDER BY p.rand_key ASC
         LIMIT ?`
      )
      .all(...params, pivot, remaining) as RawPuzzleRow[];
    for (const r of wrapRows) {
      if (!seenIds.has(r.puzzle_id)) {
        seenIds.add(r.puzzle_id);
        rows.push(r);
      }
    }
  }

  return rows;
}

export function markPuzzlesSeen(
  anonId: string,
  puzzles: Array<{ puzzleId: string; fen: string; moves: string }>,
  scopes: string[] = ['global']
): void {
  if (!anonId || puzzles.length === 0) return;
  const db = getPuzzleDb();
  const now = new Date().toISOString();

  const insertSeen = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO user_seen_puzzles (anon_id, puzzle_id, signature, scope, seen_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const p of puzzles) {
      const sig = computePuzzleSignature(p.fen, p.moves);
      for (const scope of scopes) {
        stmt.run(anonId, p.puzzleId, sig, scope, now);
      }
    }
  });
  insertSeen();
}

function resetExhaustedPool(
  db: Database.Database,
  anonId: string,
  scope: string,
  baseConditions: string[],
  baseParams: (string | number)[]
): void {
  const baseWhere = baseConditions.join(' AND ');
  // Correlated EXISTS looks up only the user's seen puzzle IDs/signatures by primary/indexed key
  db.prepare(
    `DELETE FROM user_seen_puzzles
     WHERE anon_id = ?
       AND scope = ?
       AND (
         EXISTS (
           SELECT 1 FROM puzzles p
           WHERE p.puzzle_id = user_seen_puzzles.puzzle_id
             AND ${baseWhere}
         )
         OR EXISTS (
           SELECT 1 FROM puzzles p
           WHERE p.signature = user_seen_puzzles.signature
             AND ${baseWhere}
         )
       )`
  ).run(anonId, scope, ...baseParams, ...baseParams);
}

function normalizeScope(scope?: string): string {
  const cleaned = (scope ?? '').trim();
  if (!cleaned) return 'global';
  return /^[a-z0-9:_-]{1,80}$/i.test(cleaned) ? cleaned : 'global';
}

export function getNextPuzzle(opts: {
  minRating: number;
  maxRating: number;
  excludeIds?: string[];
  theme?: string;
  anonId?: string;
  scope?: string;
}): { puzzle: LichessPuzzle; poolReset: boolean } | null {
  const db = getPuzzleDb();
  const rawMin = Number.isFinite(opts.minRating) ? opts.minRating : MIN_PUZZLE_RATING;
  const minRating = Math.max(ABSOLUTE_MIN_PUZZLE_RATING, Math.floor(rawMin));
  const rawMax = Number.isFinite(opts.maxRating) ? opts.maxRating : 3500;
  const maxRating = Math.max(minRating, Math.floor(rawMax));
  const anonId = opts.anonId?.trim() || '';
  const scope = normalizeScope(opts.scope);
  const cleanTheme = normalizeThemeFilter(opts.theme);

  const base = buildBaseFilter({ minRating, maxRating, theme: cleanTheme });
  const excludeIds = Array.from(new Set((opts.excludeIds ?? []).filter(Boolean)));

  const tryPick = (useSeenTable: boolean, idsToExclude: string[]): LichessPuzzle | null => {
    const rows = sampleRandomRows(db, {
      minRating,
      maxRating,
      theme: cleanTheme,
      anonId: useSeenTable ? anonId : undefined,
      excludedScopes: useSeenTable && anonId ? [scope] : undefined,
      excludeIds: idsToExclude,
      desiredCount: 12,
    });
    for (const row of rows) {
      const puzzle = mapRow(row);
      if (validateLichessPuzzle(puzzle, { minRating, maxRating }).valid) {
        return puzzle;
      }
    }
    return null;
  };

  // 1. Pick an unseen puzzle in this scope & filter
  const firstTry = tryPick(Boolean(anonId), excludeIds);
  if (firstTry) {
    if (anonId) {
      markPuzzlesSeen(anonId, [firstTry], [scope]);
    }
    return { puzzle: firstTry, poolReset: false };
  }

  // 2. Check if any puzzle exists in this filter at all (O(1) with LIMIT 1)
  const existsInFilter =
    cleanTheme && hasThemeIndex(db)
      ? (db
          .prepare(
            `SELECT 1 as ok FROM puzzle_themes pt
             WHERE pt.theme = ? AND pt.rating >= ? AND pt.rating <= ?
             LIMIT 1`
          )
          .get(cleanTheme, minRating, maxRating) as { ok: number } | undefined)
      : (db
          .prepare(`SELECT 1 as ok FROM puzzles p WHERE ${base.conditions.join(' AND ')} LIMIT 1`)
          .get(...base.params) as { ok: number } | undefined);

  if (!existsInFilter) {
    return null;
  }

  // Identify most recently seen puzzle in this exhausted pool so reshuffle avoids immediate back-to-back repeats
  const baseWhere = base.conditions.join(' AND ');
  const recentRow = anonId
    ? (db
        .prepare(
          `SELECT s.puzzle_id FROM user_seen_puzzles s
           WHERE s.anon_id = ? AND s.scope = ?
             AND (
               EXISTS (
                 SELECT 1 FROM puzzles p
                 WHERE p.puzzle_id = s.puzzle_id
                   AND ${baseWhere}
               )
               OR EXISTS (
                 SELECT 1 FROM puzzles p
                 WHERE p.signature = s.signature
                   AND ${baseWhere}
               )
             )
           ORDER BY s.seen_at DESC
           LIMIT 1`
        )
        .get(anonId, scope, ...base.params, ...base.params) as { puzzle_id: string } | undefined)
    : undefined;

  let poolReset = false;
  if (anonId) {
    resetExhaustedPool(db, anonId, scope, base.conditions, base.params);
    poolReset = true;
  }

  const immediateExcludeSet = new Set<string>();
  if (excludeIds.length > 0) immediateExcludeSet.add(excludeIds[excludeIds.length - 1]);
  if (recentRow?.puzzle_id) immediateExcludeSet.add(recentRow.puzzle_id);

  const afterReset =
    tryPick(false, Array.from(immediateExcludeSet)) ?? tryPick(false, []);

  if (!afterReset) {
    return null;
  }

  if (anonId) {
    markPuzzlesSeen(anonId, [afterReset], [scope]);
  }

  return { puzzle: afterReset, poolReset };
}

export function searchPuzzles(opts: {
  theme?: string;
  minRating?: number;
  maxRating?: number;
  limit?: number;
  offset?: number;
  shuffle?: boolean;
  excludeIds?: string[];
  anonId?: string;
  scope?: 'global' | 'woodpecker';
  preferUnseen?: boolean;
  markSeen?: boolean;
}): { puzzles: LichessPuzzle[]; total: number; poolReset?: boolean } {
  const db = getPuzzleDb();
  const effectiveMin = Math.max(
    ABSOLUTE_MIN_PUZZLE_RATING,
    opts.minRating ?? MIN_PUZZLE_RATING
  );
  const effectiveMax =
    typeof opts.maxRating === 'number' ? Math.max(effectiveMin, opts.maxRating) : undefined;
  const limit = Math.min(Math.max(opts.limit ?? 24, 1), 250);
  const offset = Math.max(opts.offset ?? 0, 0);
  const anonId = opts.anonId?.trim() || '';
  const cleanTheme = normalizeThemeFilter(opts.theme);

  const base = buildBaseFilter({
    minRating: effectiveMin,
    maxRating: effectiveMax,
    theme: cleanTheme,
  });

  const totalRow =
    cleanTheme && hasThemeIndex(db)
      ? (db
          .prepare(
            `SELECT COUNT(*) as total FROM puzzle_themes pt
             WHERE pt.theme = ? AND pt.rating >= ?${
               typeof effectiveMax === 'number' ? ' AND pt.rating <= ?' : ''
             }`
          )
          .get(
            ...(typeof effectiveMax === 'number'
              ? [cleanTheme, effectiveMin, effectiveMax]
              : [cleanTheme, effectiveMin])
          ) as { total: number })
      : (db
          .prepare(`SELECT COUNT(*) as total FROM puzzles p WHERE ${base.conditions.join(' AND ')}`)
          .get(...base.params) as { total: number });

  if (totalRow.total === 0) {
    return { puzzles: [], total: 0 };
  }

  if (!opts.shuffle) {
    const conditions = [...base.conditions];
    const params = [...base.params];
    if (opts.excludeIds && opts.excludeIds.length > 0) {
      const safeExclude = opts.excludeIds.slice(-900);
      conditions.push(`p.puzzle_id NOT IN (${safeExclude.map(() => '?').join(',')})`);
      params.push(...safeExclude);
    }

    const fetchLimit = Math.min(800, limit * 2);
    const rows =
      cleanTheme && hasThemeIndex(db)
        ? (db
            .prepare(
              `SELECT p.puzzle_id, p.fen, p.moves, p.rating, p.rating_deviation, p.popularity, p.nb_plays, p.themes, p.game_url, p.signature
               FROM puzzle_themes pt
               JOIN puzzles p ON p.puzzle_id = pt.puzzle_id
               WHERE pt.theme = ? AND pt.rating >= ?${
                 typeof effectiveMax === 'number' ? ' AND pt.rating <= ?' : ''
               }${
                 opts.excludeIds && opts.excludeIds.length > 0
                   ? ` AND pt.puzzle_id NOT IN (${opts.excludeIds
                       .slice(-900)
                       .map(() => '?')
                       .join(',')})`
                   : ''
               }
               ORDER BY p.popularity DESC, p.nb_plays DESC, p.rating ASC
               LIMIT ? OFFSET ?`
            )
            .all(
              cleanTheme,
              effectiveMin,
              ...(typeof effectiveMax === 'number' ? [effectiveMax] : []),
              ...(opts.excludeIds && opts.excludeIds.length > 0
                ? opts.excludeIds.slice(-900)
                : []),
              fetchLimit,
              offset
            ) as RawPuzzleRow[])
        : (db
            .prepare(
              `SELECT p.puzzle_id, p.fen, p.moves, p.rating, p.rating_deviation, p.popularity, p.nb_plays, p.themes, p.game_url, p.signature
               FROM puzzles p
               WHERE ${conditions.join(' AND ')}
               ORDER BY p.popularity DESC, p.nb_plays DESC, p.rating ASC
               LIMIT ? OFFSET ?`
            )
            .all(...params, fetchLimit, offset) as RawPuzzleRow[]);

    const valid = selectValidPuzzles(rows.map(mapRow), {
      minRating: effectiveMin,
      maxRating: effectiveMax,
      limit,
      shuffle: false,
    });
    return { puzzles: valid, total: totalRow.total };
  }

  // Randomized search prioritizing unseen puzzles across multi-pivot samples
  const chosenIds = new Set<string>(opts.excludeIds ?? []);
  const chosenSignatures = new Set<string>();
  const collected: LichessPuzzle[] = [];
  let poolReset = false;

  const collectFromScopeExclusion = (excludedScopes: string[], needed: number) => {
    if (needed <= 0) return;
    const sampleSize = Math.min(600, Math.max(needed * 2, needed + 25));
    const sliceCount = needed >= 20 ? 3 : 1;
    const perSlice = Math.ceil(sampleSize / sliceCount);
    const candidateRows: RawPuzzleRow[] = [];
    const seenRowIds = new Set<string>();

    for (let s = 0; s < sliceCount; s++) {
      const sliceRows = sampleRandomRows(db, {
        minRating: effectiveMin,
        maxRating: effectiveMax,
        theme: cleanTheme,
        anonId: anonId && excludedScopes.length > 0 ? anonId : undefined,
        excludedScopes: excludedScopes.length > 0 ? excludedScopes : undefined,
        excludeIds: Array.from(chosenIds),
        desiredCount: perSlice,
      });
      for (const r of sliceRows) {
        if (!seenRowIds.has(r.puzzle_id)) {
          seenRowIds.add(r.puzzle_id);
          candidateRows.push(r);
        }
      }
    }

    const valid = selectValidPuzzles(candidateRows.map(mapRow), {
      minRating: effectiveMin,
      maxRating: effectiveMax,
      excludeIds: chosenIds,
      excludeSignatures: chosenSignatures,
      limit: needed,
      shuffle: true,
    });

    for (const p of valid) {
      chosenIds.add(p.puzzleId);
      chosenSignatures.add(computePuzzleSignature(p.fen, p.moves));
      collected.push(p);
    }
  };

  if (anonId && opts.preferUnseen !== false) {
    collectFromScopeExclusion(['global', 'woodpecker'], limit);

    if (collected.length < limit && opts.scope === 'woodpecker') {
      collectFromScopeExclusion(['woodpecker'], limit - collected.length);
    }

    if (collected.length < limit) {
      const resetScope = opts.scope === 'woodpecker' ? 'woodpecker' : 'global';
      resetExhaustedPool(db, anonId, resetScope, base.conditions, base.params);
      poolReset = true;
      collectFromScopeExclusion([], limit - collected.length);
    }
  } else {
    collectFromScopeExclusion([], limit);
  }

  if (opts.markSeen && anonId && collected.length > 0) {
    const scopesToMark = opts.scope === 'woodpecker' ? ['global', 'woodpecker'] : ['global'];
    markPuzzlesSeen(anonId, collected, scopesToMark);
  }

  return {
    puzzles: collected,
    total: totalRow.total,
    poolReset,
  };
}

export function getPuzzleById(id: string): LichessPuzzle | null {
  const db = getPuzzleDb();
  const row = db
    .prepare(
      `SELECT puzzle_id, fen, moves, rating, rating_deviation, popularity, nb_plays, themes, game_url, signature
       FROM puzzles WHERE puzzle_id = ?`
    )
    .get(id) as RawPuzzleRow | undefined;
  if (!row) return null;
  const puzzle = mapRow(row);
  return validateLichessPuzzle(puzzle, { minRating: ABSOLUTE_MIN_PUZZLE_RATING }).valid
    ? puzzle
    : null;
}

export function getDatasetStats(): PuzzleDatasetStats {
  const db = getPuzzleDb();

  const cachedRow = db
    .prepare("SELECT value FROM db_meta WHERE key = 'dataset_stats_v1'")
    .get() as { value: string } | undefined;
  if (cachedRow?.value) {
    try {
      return JSON.parse(cachedRow.value) as PuzzleDatasetStats;
    } catch {
      // Recompute if corrupted
    }
  }

  const agg = db
    .prepare(
      `SELECT COUNT(*) as total, MIN(rating) as minR, MAX(rating) as maxR,
              SUM(CASE WHEN is_sample = 1 THEN 1 ELSE 0 END) as sampleCount
       FROM puzzles
       WHERE rating >= ?`
    )
    .get(ABSOLUTE_MIN_PUZZLE_RATING) as {
    total: number;
    minR: number | null;
    maxR: number | null;
    sampleCount: number;
  };

  const isSampleOnly = agg.total > 0 && agg.sampleCount === agg.total;
  const themeCounts: Record<string, number> = {};

  if (hasThemeIndex(db)) {
    const grouped = db
      .prepare('SELECT theme, COUNT(*) as cnt FROM puzzle_themes GROUP BY theme')
      .all() as Array<{ theme: string; cnt: number }>;
    for (const r of grouped) {
      themeCounts[r.theme] = r.cnt;
    }
  } else {
    const themeRows = db
      .prepare('SELECT themes FROM puzzles WHERE rating >= ? LIMIT 5000')
      .all(ABSOLUTE_MIN_PUZZLE_RATING) as { themes: string }[];
    for (const r of themeRows) {
      for (const t of r.themes.split(/\s+/)) {
        if (t) themeCounts[t] = (themeCounts[t] || 0) + 1;
      }
    }
  }

  const stats: PuzzleDatasetStats = {
    totalPuzzles: agg.total,
    sourceLabel: isSampleOnly
      ? `Lichess Verified Dataset (${agg.total} puzzles)`
      : `Lichess Open Puzzle Database (${agg.total.toLocaleString()} indexed puzzles)`,
    isSampleDataset: isSampleOnly,
    ratingRange: { min: agg.minR ?? ABSOLUTE_MIN_PUZZLE_RATING, max: agg.maxR ?? 3400 },
    themeCounts,
  };

  db.prepare(`
    INSERT INTO db_meta (key, value) VALUES ('dataset_stats_v1', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(stats));

  return stats;
}

const LEGACY_SYNTHETIC_PUZZLE_ID = /^[a-z0-9]+_(easy|med|medium|hard|expert)_\d+$/i;

function sanitizeLocalUserStateJson(stateJson: string): string {
  try {
    const parsed = JSON.parse(stateJson) as {
      collections?: Array<{
        id: string;
        updatedAt?: string;
        puzzles?: Array<{ puzzleId: string }>;
      }>;
      woodpeckerCycles?: Array<{
        id: string;
        collectionId: string;
        updatedAt?: string;
        createdAt?: string;
        puzzleOrder?: string[];
        currentIndex?: number;
      }>;
    };

    const rawCollections = Array.isArray(parsed.collections) ? parsed.collections : [];
    const rawCycles = Array.isArray(parsed.woodpeckerCycles) ? parsed.woodpeckerCycles : [];

    const isLegacyCol = (col: { puzzles?: Array<{ puzzleId: string }> }) =>
      Array.isArray(col.puzzles) &&
      col.puzzles.length > 0 &&
      col.puzzles.every((p) => LEGACY_SYNTHETIC_PUZZLE_ID.test(p.puzzleId));

    const colMap = new Map<string, (typeof rawCollections)[number]>();
    for (const c of rawCollections) {
      if (!c?.id || isLegacyCol(c)) continue;
      const existing = colMap.get(c.id);
      if (!existing || (c.updatedAt ?? '') >= (existing.updatedAt ?? '')) {
        colMap.set(c.id, c);
      }
    }

    const cycMap = new Map<string, (typeof rawCycles)[number]>();
    for (const cyc of rawCycles) {
      if (!cyc?.id || !cyc.collectionId) continue;
      const backing = colMap.get(cyc.collectionId);
      if (!backing || !Array.isArray(backing.puzzles) || backing.puzzles.length === 0) continue;
      const validIds = new Set(backing.puzzles.map((p) => p.puzzleId));
      const cleanOrder = Array.from(new Set((cyc.puzzleOrder ?? []).filter((id) => validIds.has(id))));
      if (cleanOrder.length === 0) continue;

      const cleaned = {
        ...cyc,
        puzzleOrder: cleanOrder,
        currentIndex: Math.min(Math.max(0, cyc.currentIndex ?? 0), cleanOrder.length - 1),
      };
      const existing = cycMap.get(cleaned.id);
      if (!existing || (cleaned.updatedAt ?? '') >= (existing.updatedAt ?? '')) {
        cycMap.set(cleaned.id, cleaned);
      }
    }

    const sortedCycles = Array.from(cycMap.values()).sort((a, b) =>
      (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
    );

    const referencedIds = new Set(sortedCycles.map((c) => c.collectionId));
    const cleanCollections = Array.from(colMap.values()).filter(
      (c) => referencedIds.has(c.id) || (Array.isArray(c.puzzles) && c.puzzles.length > 0)
    );

    parsed.collections = cleanCollections;
    parsed.woodpeckerCycles = sortedCycles;
    return JSON.stringify(parsed);
  } catch {
    return stateJson;
  }
}

export function getLocalUserState(anonId: string): string | null {
  const db = getPuzzleDb();
  const row = db
    .prepare('SELECT state_json FROM local_user_state WHERE anon_id = ?')
    .get(anonId) as { state_json: string } | undefined;
  if (!row) return null;
  const sanitized = sanitizeLocalUserStateJson(row.state_json);
  if (sanitized !== row.state_json) {
    saveLocalUserState(anonId, sanitized);
  }
  return sanitized;
}

export function saveLocalUserState(anonId: string, stateJson: string): void {
  const db = getPuzzleDb();
  const sanitized = sanitizeLocalUserStateJson(stateJson);
  db.prepare(`
    INSERT INTO local_user_state (anon_id, state_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(anon_id) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
  `).run(anonId, sanitized, new Date().toISOString());
}

import {
  BoardSize,
  BoardTheme,
  CloudSyncStatus,
  LichessPuzzle,
  ModuleRecord,
  PieceSet,
  PuzzleCollection,
  PuzzleDatasetStats,
  TrainingSessionRecord,
  UserPersistedState,
  UserSettings,
  WoodpeckerCycle,
} from '../types/chess';
import { ensureAnonymousSession, getSupabaseClient } from '../lib/supabase';
import { BOARD_THEMES, DEFAULT_BOARD_SIZE_PX, normalizeBoardSizePx } from '../lib/chessUtils';
import {
  ABSOLUTE_MIN_PUZZLE_RATING,
  MIN_PUZZLE_RATING,
  normalizePuzzleDifficulty,
  selectValidPuzzles,
  validateLichessPuzzle,
} from '../lib/puzzleValidator';

const VALID_PIECE_SETS = new Set<PieceSet>([
  'merida',
  'classic',
  'modern',
  'minimalist',
  'elegant',
  'alpha',
]);

function normalizePieceSet(val: unknown): PieceSet {
  return typeof val === 'string' && VALID_PIECE_SETS.has(val as PieceSet)
    ? (val as PieceSet)
    : 'merida';
}

function normalizeTheme(val: unknown): BoardTheme {
  return typeof val === 'string' && val in BOARD_THEMES
    ? (val as BoardTheme)
    : 'green';
}

export const DEFAULT_SETTINGS: UserSettings = {
  board: {
    theme: 'green',
    orientation: 'white',
    pieceSet: 'merida',
    size: DEFAULT_BOARD_SIZE_PX,
    coordinates: 'inside',
    animatePieces: true,
    highlightLegalMoves: true,
    highlightLastMove: true,
  },
  sound: {
    enabled: true,
    moveSound: true,
    correctSound: true,
    incorrectSound: true,
  },
  general: {
    darkTheme: true,
    defaultDifficulty: 'medium',
    autoAdvancePuzzles: true,
  },
};

const LOCAL_STATE_STORAGE_KEY = 'chess_training_local_state_v1';

const LEGACY_SYNTHETIC_PUZZLE_ID = /^[a-z0-9]+_(easy|med|medium|hard|expert)_\d+$/i;

function isLegacySyntheticCollection(col: PuzzleCollection): boolean {
  return (
    col.puzzles.length > 0 &&
    col.puzzles.every((p) => LEGACY_SYNTHETIC_PUZZLE_ID.test(p.puzzleId))
  );
}

export function normalizePersistedCollectionsAndCycles(
  collections: PuzzleCollection[],
  woodpeckerCycles: WoodpeckerCycle[]
): { collections: PuzzleCollection[]; woodpeckerCycles: WoodpeckerCycle[] } {
  const collectionMap = new Map<string, PuzzleCollection>();
  for (const rawCol of collections ?? []) {
    if (!rawCol?.id) continue;
    const cleanedCol: PuzzleCollection = {
      ...rawCol,
      difficulty:
        rawCol.difficulty === 'mixed' ? 'mixed' : normalizePuzzleDifficulty(rawCol.difficulty),
      puzzles: (rawCol.puzzles ?? []).filter(
        (p) => validateLichessPuzzle(p, { minRating: 0 }).valid
      ),
    };
    const existing = collectionMap.get(cleanedCol.id);
    if (!existing || (cleanedCol.updatedAt ?? '') >= (existing.updatedAt ?? '')) {
      collectionMap.set(cleanedCol.id, cleanedCol);
    }
  }

  const cycleMap = new Map<string, WoodpeckerCycle>();
  for (const rawCycle of woodpeckerCycles ?? []) {
    if (!rawCycle?.id || !rawCycle.collectionId) continue;
    const backingCol = collectionMap.get(rawCycle.collectionId);
    if (!backingCol || backingCol.puzzles.length === 0 || isLegacySyntheticCollection(backingCol)) {
      continue;
    }
    const validPuzzleIds = new Set(backingCol.puzzles.map((p) => p.puzzleId));
    const cleanedOrder = Array.from(
      new Set((rawCycle.puzzleOrder ?? []).filter((id) => validPuzzleIds.has(id)))
    );
    if (cleanedOrder.length === 0) continue;

    const cleanedCycle: WoodpeckerCycle = {
      ...rawCycle,
      puzzleOrder: cleanedOrder,
      currentIndex: Math.min(Math.max(0, rawCycle.currentIndex ?? 0), cleanedOrder.length - 1),
    };
    const existing = cycleMap.get(cleanedCycle.id);
    if (!existing || (cleanedCycle.updatedAt ?? '') >= (existing.updatedAt ?? '')) {
      cycleMap.set(cleanedCycle.id, cleanedCycle);
    }
  }

  const sortedCycles = Array.from(cycleMap.values()).sort((a, b) =>
    (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
  );

  // Keep collections referenced by surviving cycles (or non-legacy custom collections)
  const referencedColIds = new Set(sortedCycles.map((c) => c.collectionId));
  const cleanCollections = Array.from(collectionMap.values()).filter(
    (col) => !isLegacySyntheticCollection(col) && (referencedColIds.has(col.id) || col.puzzles.length > 0)
  );

  return {
    collections: cleanCollections,
    woodpeckerCycles: sortedCycles,
  };
}

function createInitialState(anonymousId: string, isCloudConnected: boolean): UserPersistedState {
  return {
    anonymousId,
    isCloudConnected,
    settings: DEFAULT_SETTINGS,
    sessions: [],
    records: {},
    collections: [],
    woodpeckerCycles: [],
  };
}

export async function loadUserState(): Promise<{
  state: UserPersistedState;
  syncStatus: CloudSyncStatus;
  errorMessage?: string;
}> {
  const authResult = await ensureAnonymousSession();
  console.log('[Chess] loadUserState → authResult:', authResult);

  if (authResult.isCloud) {
    const sb = getSupabaseClient();
    if (sb) {
      try {
        const uid = authResult.userId;
        console.log('[Chess] Loading cloud state for uid:', uid);
        const [settingsRes, sessionsRes, recordsRes, collectionsRes, cyclesRes] = await Promise.all([
          sb.from('user_settings').select('settings').eq('user_id', uid).maybeSingle(),
          sb
            .from('training_sessions')
            .select('*')
            .eq('user_id', uid)
            .order('created_at', { ascending: false })
            .limit(200),
          sb.from('module_records').select('*').eq('user_id', uid),
          sb
            .from('puzzle_collections')
            .select('*')
            .eq('user_id', uid)
            .order('updated_at', { ascending: false }),
          sb
            .from('woodpecker_cycles')
            .select('*')
            .eq('user_id', uid)
            .order('updated_at', { ascending: false }),
        ]);

        const mergedSettings: UserSettings = {
          board: {
            ...DEFAULT_SETTINGS.board,
            ...(settingsRes.data?.settings?.board ?? {}),
            orientation: 'white',
            theme: normalizeTheme(settingsRes.data?.settings?.board?.theme),
            pieceSet: normalizePieceSet(settingsRes.data?.settings?.board?.pieceSet),
            size: normalizeBoardSizePx(settingsRes.data?.settings?.board?.size as BoardSize | undefined),
          },
          sound: { ...DEFAULT_SETTINGS.sound, ...(settingsRes.data?.settings?.sound ?? {}) },
          general: {
            ...DEFAULT_SETTINGS.general,
            ...(settingsRes.data?.settings?.general ?? {}),
            defaultDifficulty: normalizePuzzleDifficulty(settingsRes.data?.settings?.general?.defaultDifficulty),
          },
        };

        const sessions: TrainingSessionRecord[] = (sessionsRes.data ?? []).map((row) => ({
          id: row.id,
          module: row.module,
          mode: row.mode,
          score: row.score,
          total: row.total,
          accuracy: Number(row.accuracy),
          durationMs: row.duration_ms,
          bestMetric: row.best_metric !== null ? Number(row.best_metric) : undefined,
          metadata: row.metadata ?? {},
          createdAt: row.created_at,
        }));

        const records: Record<string, ModuleRecord> = {};
        for (const row of recordsRes.data ?? []) {
          records[row.module] = row.records as ModuleRecord;
        }

        const collections: PuzzleCollection[] = (collectionsRes.data ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description ?? '',
          difficulty:
            row.difficulty === 'mixed' ? 'mixed' : normalizePuzzleDifficulty(row.difficulty),
          puzzles: (row.puzzles ?? []).filter(
            (p: LichessPuzzle) => validateLichessPuzzle(p, { minRating: 0 }).valid
          ),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));

        const woodpeckerCycles: WoodpeckerCycle[] = (cyclesRes.data ?? []).map((row) => ({
          id: row.id,
          collectionId: row.collection_id,
          name: row.name,
          targetCycles: row.target_cycles,
          currentCycle: row.current_cycle,
          currentIndex: row.current_index,
          shuffle: row.shuffle,
          status: row.status,
          activeElapsedMs: row.active_elapsed_ms,
          activeCorrect: row.active_correct,
          activeIncorrect: row.active_incorrect,
          cycleLogs: row.cycle_logs ?? [],
          puzzleOrder: row.puzzle_order ?? [],
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));

        const normalized = normalizePersistedCollectionsAndCycles(collections, woodpeckerCycles);

        return {
          state: {
            anonymousId: uid,
            isCloudConnected: true,
            settings: mergedSettings,
            sessions,
            records,
            collections: normalized.collections,
            woodpeckerCycles: normalized.woodpeckerCycles,
          },
          syncStatus: 'cloud_synced',
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load cloud state';
        console.error('[Chess] Cloud load failed:', msg);
        // Keep isCloudConnected: true so future saves still go to Supabase
        const fallback = loadLocalFallbackState(authResult.userId);
        return {
          state: { ...fallback, anonymousId: authResult.userId, isCloudConnected: true },
          syncStatus: 'error',
          errorMessage: msg,
        };
      }
    }
  }

  // Local fallback: compare Express SQLite vs localStorage for the same anonId
  const anonId = authResult.userId;
  const localCache = readRawLocalStateForAnon(anonId);
  try {
    const res = await fetch(`/api/local-profile/${encodeURIComponent(anonId)}`);
    if (res.ok) {
      const data = (await res.json()) as UserPersistedState;
      const serverHydrated = hydrateLocalStateObject(anonId, data);

      const serverTs = Date.parse(serverHydrated.localUpdatedAt ?? '') || 0;
      const localTs = localCache ? Date.parse(localCache.localUpdatedAt ?? '') || 0 : 0;

      if (localCache && localTs > serverTs) {
        // Local cache is newer (e.g. page closed before PUT completed) -> keep & re-sync to server
        void persistLocalFallbackState(localCache);
        return {
          state: localCache,
          syncStatus: 'local_fallback',
          errorMessage: authResult.error,
        };
      }

      writeLocalStateSnapshot(serverHydrated);
      return {
        state: serverHydrated,
        syncStatus: 'local_fallback',
        errorMessage: authResult.error,
      };
    }
  } catch {
    // Fall back silently to localStorage if backend profile endpoint unavailable
  }

  return {
    state: localCache ?? createInitialState(anonId, false),
    syncStatus: 'local_fallback',
    errorMessage: authResult.error,
  };
}

function hydrateLocalStateObject(anonId: string, raw: UserPersistedState): UserPersistedState {
  const normalized = normalizePersistedCollectionsAndCycles(
    raw.collections ?? [],
    raw.woodpeckerCycles ?? []
  );
  return {
    ...createInitialState(anonId, false),
    ...raw,
    anonymousId: anonId,
    isCloudConnected: false,
    settings: {
      board: {
        ...DEFAULT_SETTINGS.board,
        ...(raw.settings?.board ?? {}),
        orientation: 'white',
        theme: normalizeTheme(raw.settings?.board?.theme),
        pieceSet: normalizePieceSet(raw.settings?.board?.pieceSet),
        size: normalizeBoardSizePx(raw.settings?.board?.size as BoardSize | undefined),
      },
      sound: { ...DEFAULT_SETTINGS.sound, ...(raw.settings?.sound ?? {}) },
      general: {
        ...DEFAULT_SETTINGS.general,
        ...(raw.settings?.general ?? {}),
        defaultDifficulty: normalizePuzzleDifficulty(raw.settings?.general?.defaultDifficulty),
      },
    },
    collections: normalized.collections,
    woodpeckerCycles: normalized.woodpeckerCycles,
  };
}

function readRawLocalStateForAnon(anonId: string): UserPersistedState | null {
  try {
    const raw = localStorage.getItem(LOCAL_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserPersistedState;
    if (parsed.anonymousId && parsed.anonymousId !== anonId) {
      return null;
    }
    return hydrateLocalStateObject(anonId, parsed);
  } catch {
    return null;
  }
}

function loadLocalFallbackState(anonId: string): UserPersistedState {
  return readRawLocalStateForAnon(anonId) ?? createInitialState(anonId, false);
}

export function writeLocalStateSnapshot(state: UserPersistedState): void {
  try {
    localStorage.setItem(LOCAL_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

export async function persistLocalFallbackState(state: UserPersistedState): Promise<void> {
  writeLocalStateSnapshot(state);
  if (!state.anonymousId) return;
  try {
    await fetch(`/api/local-profile/${encodeURIComponent(state.anonymousId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
      keepalive: true,
    });
  } catch {
    // localStorage remains updated even if network fails
  }
}

export async function persistSettingsCloud(userId: string, settings: UserSettings): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  const { error } = await sb.from('user_settings').upsert({
    user_id: userId,
    settings,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Settings save failed: ${error.message}`);
}

export async function persistSessionCloud(
  userId: string,
  session: TrainingSessionRecord
): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  console.log('[Chess] persistSessionCloud → userId:', userId, 'module:', session.module);
  const { error } = await sb.from('training_sessions').insert({
    id: session.id,
    user_id: userId,
    module: session.module,
    mode: session.mode,
    score: session.score,
    total: session.total,
    accuracy: session.accuracy,
    duration_ms: session.durationMs,
    best_metric: session.bestMetric ?? null,
    metadata: session.metadata ?? {},
    created_at: session.createdAt,
  });
  if (error) throw new Error(`Session save failed: ${error.message}`);
  console.log('[Chess] Session saved to Supabase ✓');
}

export async function persistModuleRecordCloud(
  userId: string,
  record: ModuleRecord
): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  const { error } = await sb.from('module_records').upsert({
    user_id: userId,
    module: record.module,
    records: record,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Module record save failed: ${error.message}`);
}

export async function persistCollectionCloud(
  userId: string,
  collection: PuzzleCollection
): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  const { error } = await sb.from('puzzle_collections').upsert({
    id: collection.id,
    user_id: userId,
    name: collection.name,
    description: collection.description,
    difficulty: collection.difficulty,
    puzzles: collection.puzzles,
    created_at: collection.createdAt,
    updated_at: collection.updatedAt,
  });
  if (error) throw new Error(`Collection save failed: ${error.message}`);
}

export async function deleteCollectionCloud(userId: string, collectionId: string): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  const { error } = await sb
    .from('puzzle_collections')
    .delete()
    .eq('id', collectionId)
    .eq('user_id', userId);
  if (error) throw new Error(`Collection delete failed: ${error.message}`);
}

export async function persistWoodpeckerCycleCloud(
  userId: string,
  cycle: WoodpeckerCycle
): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  const { error } = await sb.from('woodpecker_cycles').upsert({
    id: cycle.id,
    user_id: userId,
    collection_id: cycle.collectionId,
    name: cycle.name,
    target_cycles: cycle.targetCycles,
    current_cycle: cycle.currentCycle,
    current_index: cycle.currentIndex,
    shuffle: cycle.shuffle,
    status: cycle.status,
    active_elapsed_ms: cycle.activeElapsedMs,
    active_correct: cycle.activeCorrect,
    active_incorrect: cycle.activeIncorrect,
    cycle_logs: cycle.cycleLogs,
    puzzle_order: cycle.puzzleOrder,
    created_at: cycle.createdAt,
    updated_at: cycle.updatedAt,
  });
  if (error) throw new Error(`Woodpecker cycle save failed: ${error.message}`);
}

export async function deleteWoodpeckerCycleCloud(userId: string, cycleId: string): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  const { error } = await sb
    .from('woodpecker_cycles')
    .delete()
    .eq('id', cycleId)
    .eq('user_id', userId);
  if (error) throw new Error(`Woodpecker cycle delete failed: ${error.message}`);
}

// ==================== PUZZLE BACKEND API QUERIES ====================

export class PuzzleFetchError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'PuzzleFetchError';
    this.status = status;
  }
}

export async function fetchNextPuzzle(opts: {
  minRating: number;
  maxRating: number;
  excludeIds?: string[];
  theme?: string;
  anonId?: string;
  scope?: string;
}): Promise<LichessPuzzle> {
  const effectiveMin = Math.max(ABSOLUTE_MIN_PUZZLE_RATING, opts.minRating);
  const effectiveMax = Math.max(effectiveMin, opts.maxRating);
  const excludes = [...(opts.excludeIds ?? [])];

  for (let attempt = 0; attempt < 6; attempt++) {
    const params = new URLSearchParams({
      minRating: String(effectiveMin),
      maxRating: String(effectiveMax),
    });
    if (opts.theme && opts.theme !== 'all' && opts.theme !== 'mixed') {
      params.set('theme', opts.theme);
    }
    if (opts.anonId) {
      params.set('anonId', opts.anonId);
    }
    if (opts.scope) {
      params.set('scope', opts.scope);
    }
    if (excludes.length > 0) {
      params.set('exclude', excludes.slice(-150).join(','));
    }

    let res: Response;
    try {
      res = await fetch(`/api/puzzles/next?${params.toString()}`);
    } catch {
      throw new PuzzleFetchError('Network error while retrieving next puzzle. Please check your connection.', 0);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new PuzzleFetchError(body.error || 'Failed to retrieve puzzle from database.', res.status);
    }

    const puzzle = (await res.json()) as LichessPuzzle;
    const validation = validateLichessPuzzle(puzzle, {
      minRating: effectiveMin,
      maxRating: effectiveMax,
    });
    if (validation.valid) {
      return puzzle;
    }

    if (puzzle?.puzzleId) {
      excludes.push(puzzle.puzzleId);
    }
  }

  throw new PuzzleFetchError('Could not retrieve a valid puzzle matching the selected criteria.', 422);
}

export async function searchPuzzlesApi(opts: {
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
}): Promise<{ puzzles: LichessPuzzle[]; total: number; poolReset?: boolean }> {
  const effectiveMin = Math.max(ABSOLUTE_MIN_PUZZLE_RATING, opts.minRating ?? MIN_PUZZLE_RATING);
  const effectiveMax =
    typeof opts.maxRating === 'number' ? Math.max(effectiveMin, opts.maxRating) : undefined;
  const effectiveTheme =
    opts.theme && opts.theme !== 'all' && opts.theme !== 'mixed' ? opts.theme : undefined;

  let res: Response;
  try {
    res = await fetch('/api/puzzles/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme: effectiveTheme,
        minRating: effectiveMin,
        maxRating: effectiveMax,
        limit: opts.limit,
        offset: opts.offset,
        shuffle: opts.shuffle,
        excludeIds: opts.excludeIds,
        anonId: opts.anonId,
        scope: opts.scope,
        preferUnseen: opts.preferUnseen,
        markSeen: opts.markSeen,
      }),
    });
  } catch {
    throw new PuzzleFetchError('Network error while searching puzzles.', 0);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new PuzzleFetchError(body.error || 'Failed to search puzzles', res.status);
  }

  const data = (await res.json()) as {
    puzzles: LichessPuzzle[];
    total: number;
    poolReset?: boolean;
  };
  return {
    puzzles: selectValidPuzzles(data.puzzles ?? [], {
      minRating: effectiveMin,
      maxRating: effectiveMax,
      shuffle: Boolean(opts.shuffle),
    }),
    total: data.total ?? 0,
    poolReset: data.poolReset,
  };
}

export async function markPuzzlesSeenApi(
  anonId: string,
  puzzles: LichessPuzzle[],
  scopes: string[] = ['global']
): Promise<void> {
  if (!anonId || puzzles.length === 0) return;
  try {
    await fetch('/api/puzzles/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anonId,
        puzzles: puzzles.map((p) => ({
          puzzleId: p.puzzleId,
          fen: p.fen,
          moves: p.moves,
        })),
        scopes,
      }),
    });
  } catch {
    // Non-fatal; local records remain intact
  }
}

export async function fetchDatasetStats(): Promise<PuzzleDatasetStats> {
  const res = await fetch('/api/puzzles/stats');
  if (!res.ok) {
    throw new Error('Failed to load dataset statistics');
  }
  return res.json();
}

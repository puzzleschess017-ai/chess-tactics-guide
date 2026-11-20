import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  getDatasetStats,
  getLocalUserState,
  getNextPuzzle,
  getPuzzleById,
  getPuzzleDb,
  markPuzzlesSeen,
  saveLocalUserState,
  searchPuzzles,
} from './server/puzzleDb.ts';
import { ABSOLUTE_MIN_PUZZLE_RATING, MIN_PUZZLE_RATING } from './src/lib/puzzleValidator.ts';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '5mb' }));

  // Initialize puzzle database eagerly on server boot
  getPuzzleDb();

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Dataset metadata & counts
  app.get('/api/puzzles/stats', (_req, res) => {
    try {
      res.json(getDatasetStats());
    } catch (err) {
      console.error('Failed to fetch puzzle stats:', err);
      res.status(500).json({ error: 'Failed to load puzzle dataset statistics' });
    }
  });

  // Query next puzzle by rating band, theme, mode scope, persistent anonId history, and immediate exclusions
  app.get('/api/puzzles/next', (req, res) => {
    try {
      const rawMin = parseInt(String(req.query.minRating ?? String(MIN_PUZZLE_RATING)), 10);
      const minRating = Math.max(
        ABSOLUTE_MIN_PUZZLE_RATING,
        Number.isFinite(rawMin) ? rawMin : MIN_PUZZLE_RATING
      );
      const rawMax = parseInt(String(req.query.maxRating ?? '3500'), 10);
      const maxRating = Number.isFinite(rawMax) ? rawMax : 3500;
      const theme = typeof req.query.theme === 'string' ? req.query.theme : undefined;
      const anonId = typeof req.query.anonId === 'string' ? req.query.anonId : undefined;
      const scope = typeof req.query.scope === 'string' ? req.query.scope : undefined;
      const excludeRaw = typeof req.query.exclude === 'string' ? req.query.exclude : '';
      const excludeIds = excludeRaw ? excludeRaw.split(',').filter(Boolean) : [];

      const result = getNextPuzzle({ minRating, maxRating, excludeIds, theme, anonId, scope });
      if (!result) {
        return res.status(404).json({ error: 'No puzzles found matching the selected criteria' });
      }
      if (result.poolReset) {
        res.setHeader('X-Puzzle-Pool-Reset', 'true');
      }
      res.json(result.puzzle);
    } catch (err) {
      console.error('Error querying next puzzle:', err);
      res.status(500).json({ error: 'Failed to load puzzle' });
    }
  });

  // Paginated or randomized puzzle search for Woodpecker & Tactical filters
  app.get('/api/puzzles/search', (req, res) => {
    try {
      const theme = typeof req.query.theme === 'string' ? req.query.theme : undefined;
      const minRating = req.query.minRating ? parseInt(String(req.query.minRating), 10) : 1200;
      const maxRating = req.query.maxRating ? parseInt(String(req.query.maxRating), 10) : undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 24;
      const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
      const shuffle = req.query.shuffle === 'true' || req.query.shuffle === '1';
      const anonId = typeof req.query.anonId === 'string' ? req.query.anonId : undefined;
      const scope = req.query.scope === 'woodpecker' ? 'woodpecker' : 'global';
      const preferUnseen = req.query.preferUnseen !== 'false';
      const markSeen = req.query.markSeen === 'true';
      const excludeRaw = typeof req.query.exclude === 'string' ? req.query.exclude : '';
      const excludeIds = excludeRaw ? excludeRaw.split(',').filter(Boolean) : undefined;

      const result = searchPuzzles({
        theme,
        minRating,
        maxRating,
        limit,
        offset,
        shuffle,
        excludeIds,
        anonId,
        scope,
        preferUnseen,
        markSeen,
      });
      res.json(result);
    } catch (err) {
      console.error('Error searching puzzles:', err);
      res.status(500).json({ error: 'Failed to search puzzles' });
    }
  });

  app.post('/api/puzzles/search', (req, res) => {
    try {
      const body = (req.body ?? {}) as {
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
      };
      const result = searchPuzzles({
        theme: typeof body.theme === 'string' ? body.theme : undefined,
        minRating: typeof body.minRating === 'number' ? body.minRating : 1200,
        maxRating: typeof body.maxRating === 'number' ? body.maxRating : undefined,
        limit: typeof body.limit === 'number' ? body.limit : 24,
        offset: typeof body.offset === 'number' ? body.offset : 0,
        shuffle: Boolean(body.shuffle),
        excludeIds: Array.isArray(body.excludeIds) ? body.excludeIds : undefined,
        anonId: typeof body.anonId === 'string' ? body.anonId : undefined,
        scope: body.scope === 'woodpecker' ? 'woodpecker' : 'global',
        preferUnseen: body.preferUnseen !== false,
        markSeen: Boolean(body.markSeen),
      });
      res.json(result);
    } catch (err) {
      console.error('Error searching puzzles:', err);
      res.status(500).json({ error: 'Failed to search puzzles' });
    }
  });

  // Explicitly mark puzzles as seen for a given user/scope
  app.post('/api/puzzles/seen', (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        anonId?: string;
        puzzles?: Array<{ puzzleId: string; fen: string; moves: string }>;
        scopes?: string[];
      };
      if (!body.anonId || !Array.isArray(body.puzzles)) {
        return res.status(400).json({ error: 'anonId and puzzles array are required' });
      }
      const validScopes =
        Array.isArray(body.scopes) && body.scopes.length > 0
          ? body.scopes.filter((s) => typeof s === 'string' && /^[a-z0-9:_-]{1,80}$/i.test(s))
          : ['global'];
      markPuzzlesSeen(body.anonId, body.puzzles, validScopes.length > 0 ? validScopes : ['global']);
      res.json({ ok: true });
    } catch (err) {
      console.error('Error marking puzzles seen:', err);
      res.status(500).json({ error: 'Failed to mark puzzles seen' });
    }
  });

  // Single puzzle lookup
  app.get('/api/puzzles/:id', (req, res) => {
    try {
      const puzzle = getPuzzleById(req.params.id);
      if (!puzzle) {
        return res.status(404).json({ error: 'Puzzle not found' });
      }
      res.json(puzzle);
    } catch (err) {
      console.error('Error fetching puzzle:', err);
      res.status(500).json({ error: 'Failed to fetch puzzle' });
    }
  });

  // Local fallback persistence endpoints (used when Supabase credentials are not configured)
  app.get('/api/local-profile/:anonId', (req, res) => {
    try {
      const raw = getLocalUserState(req.params.anonId);
      if (!raw) {
        return res.status(404).json({ error: 'Profile not found' });
      }
      res.json(JSON.parse(raw));
    } catch (err) {
      console.error('Error reading local profile:', err);
      res.status(500).json({ error: 'Failed to load profile' });
    }
  });

  app.put('/api/local-profile/:anonId', (req, res) => {
    try {
      saveLocalUserState(req.params.anonId, JSON.stringify(req.body));
      res.json({ ok: true });
    } catch (err) {
      console.error('Error saving local profile:', err);
      res.status(500).json({ error: 'Failed to save profile' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Chess Tactics Guide server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

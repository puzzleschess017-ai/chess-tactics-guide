import { Chess, Move, PieceSymbol, Square } from 'chess.js';
import {
  BoardOrientation,
  DifficultyLevel,
  LichessPuzzle,
  PuzzleDifficulty,
} from '../types/chess';

export const PUZZLE_DIFFICULTY_RANGES: Record<
  PuzzleDifficulty,
  { label: string; shortLabel: string; min: number; max: number }
> = {
  medium: { label: 'Beginner', shortLabel: 'Beginner', min: 1200, max: 1600 },
  hard: { label: 'Advanced', shortLabel: 'Advanced', min: 1600, max: 2000 },
  expert: { label: 'Expert', shortLabel: 'Expert', min: 2000, max: 3200 },
};

export const BLINDFOLD_DIFFICULTY_RANGES: Record<
  DifficultyLevel,
  { label: string; min: number; max: number }
> = {
  easy: { label: 'Easy', min: 800, max: 1199 },
  medium: { label: 'Medium', min: 1200, max: 1599 },
  hard: { label: 'Hard', min: 1600, max: 1999 },
  expert: { label: 'Expert', min: 2000, max: 3500 },
};

export const MIN_PUZZLE_RATING = 1200;
export const ABSOLUTE_MIN_PUZZLE_RATING = 350;

export function normalizePuzzleDifficulty(value?: string | null): PuzzleDifficulty {
  if (value === 'hard' || value === 'expert' || value === 'medium') {
    return value;
  }
  return 'medium';
}

export function getPuzzleDifficultyFromRating(rating: number): PuzzleDifficulty {
  if (rating >= 2000) return 'expert';
  if (rating >= 1600) return 'hard';
  return 'medium';
}

function parseUci(uci: string): { from: Square; to: Square; promotion?: PieceSymbol } {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci.length > 4 ? (uci[4] as PieceSymbol) : undefined,
  };
}

const UCI_REGEX = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export interface ValidatedLichessPuzzle {
  valid: true;
  puzzle: LichessPuzzle;
  initialFenBeforeSetup: string;
  fenAfterSetup: string;
  setupMove: Move;
  solutionMoves: string[];
  solutionSans: string[];
  playerColor: BoardOrientation;
  endsInCheckmate: boolean;
}

export interface InvalidLichessPuzzle {
  valid: false;
  reason: string;
}

export type PuzzleValidationResult = ValidatedLichessPuzzle | InvalidLichessPuzzle;

export interface ValidatePuzzleOptions {
  minRating?: number;
  maxRating?: number;
  minPopularity?: number;
  minPlays?: number;
}

/**
 * Strictly validates a Lichess-format puzzle using chess.js.
 *
 * Lichess puzzle convention:
 * - puzzle.fen is the position BEFORE the opponent's first move (moves[0]).
 * - moves[0] is automatically played as the opponent's setup move.
 * - moves[1..] is the player/opponent alternating solution, which MUST start and end on a player move.
 * - Never mutates or patches invalid puzzles; rejects them cleanly.
 */
export function validateLichessPuzzle(
  puzzle: LichessPuzzle,
  options: ValidatePuzzleOptions = {}
): PuzzleValidationResult {
  if (!puzzle || typeof puzzle !== 'object') {
    return { valid: false, reason: 'Missing puzzle object' };
  }
  if (!puzzle.puzzleId || typeof puzzle.puzzleId !== 'string') {
    return { valid: false, reason: 'Missing puzzleId' };
  }
  if (!puzzle.fen || typeof puzzle.fen !== 'string') {
    return { valid: false, reason: 'Missing FEN' };
  }
  if (!puzzle.moves || typeof puzzle.moves !== 'string') {
    return { valid: false, reason: 'Missing moves' };
  }

  const minRating = options.minRating ?? MIN_PUZZLE_RATING;
  if (!Number.isFinite(puzzle.rating) || puzzle.rating < minRating) {
    return { valid: false, reason: `Rating ${puzzle.rating} is below minimum ${minRating}` };
  }
  if (typeof options.maxRating === 'number' && puzzle.rating > options.maxRating) {
    return { valid: false, reason: `Rating ${puzzle.rating} exceeds maximum ${options.maxRating}` };
  }
  if (typeof options.minPopularity === 'number' && puzzle.popularity < options.minPopularity) {
    return { valid: false, reason: `Popularity ${puzzle.popularity} below threshold` };
  }
  if (typeof options.minPlays === 'number' && puzzle.nbPlays < options.minPlays) {
    return { valid: false, reason: `Plays ${puzzle.nbPlays} below threshold` };
  }

  const allMoves = puzzle.moves.trim().split(/\s+/).filter(Boolean);
  if (allMoves.length < 2) {
    return { valid: false, reason: 'Insufficient moves (need setup + at least 1 player move)' };
  }
  if (allMoves.length % 2 !== 0) {
    return {
      valid: false,
      reason: `Incomplete move sequence (${allMoves.length} plies; must be even so solution ends on player move)`,
    };
  }
  for (const uci of allMoves) {
    if (!UCI_REGEX.test(uci)) {
      return { valid: false, reason: `Malformed UCI move "${uci}"` };
    }
  }

  let chess: Chess;
  try {
    chess = new Chess(puzzle.fen);
  } catch (err) {
    return {
      valid: false,
      reason: `Invalid initial FEN: ${err instanceof Error ? err.message : 'parse failure'}`,
    };
  }

  if (chess.isGameOver()) {
    return { valid: false, reason: 'Position before setup move is already game over' };
  }

  let setupMove: Move;
  try {
    setupMove = chess.move(parseUci(allMoves[0]));
  } catch {
    return { valid: false, reason: `Illegal opponent setup move "${allMoves[0]}"` };
  }
  if (!setupMove) {
    return { valid: false, reason: `Failed to play opponent setup move "${allMoves[0]}"` };
  }

  // Verify board position after opponent's setup move is NOT already terminal
  if (chess.isCheckmate()) {
    return { valid: false, reason: 'Position after setup move is already checkmate' };
  }
  if (chess.isStalemate()) {
    return { valid: false, reason: 'Position after setup move is stalemate' };
  }
  if (chess.isDraw() || chess.isInsufficientMaterial() || chess.isThreefoldRepetition()) {
    return { valid: false, reason: 'Position after setup move is already a draw' };
  }
  if (chess.isGameOver() || chess.moves().length === 0) {
    return { valid: false, reason: 'No legal moves available for player after setup move' };
  }

  const fenAfterSetup = chess.fen();
  const playerColor: BoardOrientation = chess.turn() === 'w' ? 'white' : 'black';
  const expectedPlayerTurn = chess.turn();
  const solutionMoves = allMoves.slice(1);
  const solutionSans: string[] = [];

  for (let i = 0; i < solutionMoves.length; i++) {
    const uci = solutionMoves[i];
    let played: Move;
    try {
      played = chess.move(parseUci(uci));
    } catch {
      return { valid: false, reason: `Illegal solution move "${uci}" at ply ${i + 1}` };
    }
    if (!played) {
      return { valid: false, reason: `Invalid solution move "${uci}" at ply ${i + 1}` };
    }
    solutionSans.push(played.san);

    // Intermediate moves should not prematurely terminate the game before solution completes
    if (i < solutionMoves.length - 1 && chess.isGameOver()) {
      return { valid: false, reason: `Solution ended prematurely at ply ${i + 1}` };
    }
  }

  // Last move must have been made by the solving player
  const lastTurn = expectedPlayerTurn;
  const moveAfterSolutionCount = solutionMoves.length;
  if (moveAfterSolutionCount % 2 !== 1) {
    return { valid: false, reason: 'Solution does not end on solving player turn' };
  }
  // Sanity check that the player who just moved on final ply is expectedPlayerTurn
  if (chess.turn() === lastTurn) {
    return { valid: false, reason: 'Turn parity mismatch at end of solution' };
  }

  const endsInCheckmate = chess.isCheckmate();
  const themeTokens = new Set((puzzle.themes || '').split(/\s+/).filter(Boolean));
  if (
    (themeTokens.has('mateIn1') ||
      themeTokens.has('mateIn2') ||
      themeTokens.has('mateIn3') ||
      themeTokens.has('mateIn4') ||
      themeTokens.has('mateIn5') ||
      themeTokens.has('mate')) &&
    !endsInCheckmate
  ) {
    return { valid: false, reason: 'Mate-tagged puzzle does not end in checkmate' };
  }

  return {
    valid: true,
    puzzle,
    initialFenBeforeSetup: puzzle.fen,
    fenAfterSetup,
    setupMove,
    solutionMoves,
    solutionSans,
    playerColor,
    endsInCheckmate,
  };
}

/**
 * Produces a canonical position + solution signature to detect identical puzzles
 * even if they carry different puzzle IDs.
 */
export function computePuzzleSignature(fen: string, moves: string): string {
  const fenParts = (fen || '').trim().split(/\s+/);
  // Board placement, active color, castling availability, en passant square
  const coreFen = fenParts.slice(0, 4).join(' ');
  const normMoves = (moves || '').trim().split(/\s+/).filter(Boolean).join(' ');
  const raw = `${coreFen}|${normMoves}`;

  // Deterministic 96-bit hash (three independent 32-bit FNV-1a lanes) for compact indexing
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b);
    h3 = Math.imul(h3 ^ (c * 31 + i), 0xc2b2ae35);
  }
  return `${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}-${(h3 >>> 0).toString(36)}`;
}

/**
 * Computes a deterministic quality score favoring high popularity, high play count,
 * and well-calibrated rating deviation.
 */
export function getPuzzleQualityScore(puzzle: LichessPuzzle): number {
  const pop = Math.max(0, Math.min(100, puzzle.popularity ?? 80));
  const playsScore = Math.min(30, Math.log10(Math.max(1, puzzle.nbPlays || 1)) * 6);
  const rdPenalty = Math.max(0, ((puzzle.ratingDeviation ?? 75) - 60) * 0.15);
  return pop + playsScore - rdPenalty;
}

/**
 * Filters, deduplicates (by ID and FEN+moves signature), validates, and optionally shuffles puzzle candidates.
 */
export function selectValidPuzzles(
  candidates: LichessPuzzle[],
  options: ValidatePuzzleOptions & {
    excludeIds?: Iterable<string>;
    excludeSignatures?: Iterable<string>;
    limit?: number;
    shuffle?: boolean;
  } = {}
): LichessPuzzle[] {
  const seenIds = new Set<string>(options.excludeIds ?? []);
  const seenSignatures = new Set<string>(options.excludeSignatures ?? []);
  const validList: LichessPuzzle[] = [];

  for (const candidate of candidates) {
    if (!candidate || seenIds.has(candidate.puzzleId)) continue;
    const sig = computePuzzleSignature(candidate.fen, candidate.moves);
    if (seenSignatures.has(sig)) continue;

    const res = validateLichessPuzzle(candidate, options);
    if (!res.valid) continue;

    seenIds.add(candidate.puzzleId);
    seenSignatures.add(sig);
    validList.push(candidate);
  }

  if (options.shuffle) {
    for (let i = validList.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [validList[i], validList[j]] = [validList[j], validList[i]];
    }
  } else {
    validList.sort((a, b) => getPuzzleQualityScore(b) - getPuzzleQualityScore(a));
  }

  if (typeof options.limit === 'number' && options.limit > 0) {
    return validList.slice(0, options.limit);
  }
  return validList;
}

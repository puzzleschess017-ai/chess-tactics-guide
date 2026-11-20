import { Chess, Square, PieceSymbol, Color, Move } from 'chess.js';
import { BoardOrientation, BoardSize, BoardTheme, LichessPuzzle } from '../types/chess';
import { validateLichessPuzzle } from './puzzleValidator';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const;

export const BOARD_SIZE_STEPS = [340, 380, 420, 460, 500, 540, 580, 620, 660] as const;
export const DEFAULT_BOARD_SIZE_PX = 500;

export function normalizeBoardSizePx(size: BoardSize | undefined): number {
  if (typeof size === 'number' && Number.isFinite(size)) {
    return Math.min(660, Math.max(340, Math.round(size)));
  }
  if (size === 'sm') return 380;
  if (size === 'lg') return 600;
  return DEFAULT_BOARD_SIZE_PX;
}

export const BOARD_THEMES: Record<
  BoardTheme,
  { name: string; light: string; dark: string; coordLight: string; coordDark: string }
> = {
  maple: {
    name: 'Maple',
    light: '#e9cdab',
    dark: '#b88b58',
    coordLight: '#8a5d32',
    coordDark: '#f6e6cf',
  },
  wood: {
    name: 'Classic Brown',
    light: '#f0d9b5',
    dark: '#b58863',
    coordLight: '#8c6239',
    coordDark: '#f5e6cf',
  },
  green: {
    name: 'Green & White',
    light: '#eeeed2',
    dark: '#769656',
    coordLight: '#5c7a3e',
    coordDark: '#f2f2dc',
  },
  blue: {
    name: 'Blue & White',
    light: '#dee3e6',
    dark: '#5b82a6',
    coordLight: '#466786',
    coordDark: '#f1f5f8',
  },
  grey: {
    name: 'Grey & White',
    light: '#e5e7eb',
    dark: '#7b8491',
    coordLight: '#565e69',
    coordDark: '#f4f5f7',
  },
  dark: {
    name: 'Dark Slate',
    light: '#475569',
    dark: '#1e293b',
    coordLight: '#cbd5e1',
    coordDark: '#94a3b8',
  },
  'emerald-night': {
    name: 'Emerald Night',
    light: '#2c445e',
    dark: '#162538',
    coordLight: '#a7f3d0',
    coordDark: '#6ee7b7',
  },
  ocean: {
    name: 'Ocean Teal',
    light: '#e2eef2',
    dark: '#3d7b8c',
    coordLight: '#2c606e',
    coordDark: '#edf6f9',
  },
  purple: {
    name: 'Royal Violet',
    light: '#eae2f8',
    dark: '#7b61a8',
    coordLight: '#5d4588',
    coordDark: '#f2ecfa',
  },
  coral: {
    name: 'Coral Sand',
    light: '#f5e8db',
    dark: '#b96b52',
    coordLight: '#8e4b36',
    coordDark: '#fbf1e8',
  },
  classic: {
    name: 'Classic Amber',
    light: '#f5ebd6',
    dark: '#8f6246',
    coordLight: '#754c33',
    coordDark: '#f7efe0',
  },
};

export const PIECE_FULL_NAMES: Record<PieceSymbol, string> = {
  k: 'King',
  q: 'Queen',
  r: 'Rook',
  b: 'Bishop',
  n: 'Knight',
  p: 'Pawn',
};

/**
 * Maps visual grid row (0..7 top->bottom) and col (0..7 left->right)
 * to algebraic square ('a1'..'h8') with a true 180-degree rotation when flipped.
 */
export function gridCoordsToSquare(
  row: number,
  col: number,
  orientation: BoardOrientation
): Square {
  const fileIndex = orientation === 'white' ? col : 7 - col;
  const rankIndex = orientation === 'white' ? row : 7 - row;
  return `${FILES[fileIndex]}${RANKS[rankIndex]}` as Square;
}

export function squareToGridCoords(
  square: Square,
  orientation: BoardOrientation
): { row: number; col: number } {
  const fileIdx = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rankIdx = RANKS.indexOf(square[1] as (typeof RANKS)[number]);
  return {
    row: orientation === 'white' ? rankIdx : 7 - rankIdx,
    col: orientation === 'white' ? fileIdx : 7 - fileIdx,
  };
}

export function isLightSquare(square: Square): boolean {
  const fileIdx = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rankNum = parseInt(square[1], 10);
  // a1 (file 0, rank 1): 0 + 1 = 1 (odd) -> dark; even sums (e.g. a8, h1, e4) -> light
  return (fileIdx + rankNum) % 2 === 0;
}

export function getRandomSquare(): Square {
  const f = FILES[Math.floor(Math.random() * 8)];
  const r = RANKS[Math.floor(Math.random() * 8)];
  return `${f}${r}` as Square;
}

export function parseUciMove(uci: string): {
  from: Square;
  to: Square;
  promotion?: PieceSymbol;
} {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci.length > 4 ? (uci[4] as PieceSymbol) : undefined,
  };
}

export function moveToUci(move: { from: string; to: string; promotion?: string }): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

/**
 * Sets up a Lichess puzzle: validates FEN + move sequence via shared validator,
 * plays moves[0] (the opponent's setup move), and returns the resulting Chess instance,
 * setup move details, and remaining solution UCI moves.
 */
export function setupLichessPuzzle(puzzle: LichessPuzzle): {
  chess: Chess;
  initialFenBeforeSetup: string;
  setupMove: Move;
  solutionMoves: string[];
  playerColor: BoardOrientation;
} {
  const result = validateLichessPuzzle(puzzle, { minRating: 0 });
  if (!result.valid) {
    throw new Error(`Invalid puzzle ${puzzle.puzzleId}: ${result.reason}`);
  }
  return {
    chess: new Chess(result.fenAfterSetup),
    initialFenBeforeSetup: result.initialFenBeforeSetup,
    setupMove: result.setupMove,
    solutionMoves: result.solutionMoves,
    playerColor: result.playerColor,
  };
}

/**
 * Computes Lichess-style pseudo-legal premove target squares for a piece at `fromSquare`.
 * Allows rays/jumps/pawn-captures that could become legal after the opponent moves;
 * actual legality is strictly enforced by chess.js when the player's turn arrives.
 */
export function getPremoveDestinations(fen: string, fromSquare: Square): Square[] {
  const pieces = parseFenPieces(fen);
  const piece = pieces.get(fromSquare);
  if (!piece) return [];

  const fileIdx = FILES.indexOf(fromSquare[0] as (typeof FILES)[number]);
  const rankIdx = parseInt(fromSquare[1], 10) - 1; // 0..7 bottom->top
  if (fileIdx < 0 || rankIdx < 0) return [];

  const targets = new Set<Square>();
  const add = (f: number, r: number) => {
    if (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const sq = `${FILES[f]}${r + 1}` as Square;
      if (sq !== fromSquare) targets.add(sq);
    }
  };

  switch (piece.type) {
    case 'p': {
      const dir = piece.color === 'w' ? 1 : -1;
      add(fileIdx, rankIdx + dir);
      add(fileIdx - 1, rankIdx + dir);
      add(fileIdx + 1, rankIdx + dir);
      const startRankIdx = piece.color === 'w' ? 1 : 6;
      if (rankIdx === startRankIdx) {
        add(fileIdx, rankIdx + 2 * dir);
      }
      break;
    }
    case 'n': {
      const jumps = [
        [1, 2], [2, 1], [2, -1], [1, -2],
        [-1, -2], [-2, -1], [-2, 1], [-1, 2],
      ];
      for (const [df, dr] of jumps) add(fileIdx + df, rankIdx + dr);
      break;
    }
    case 'b': {
      for (const [df, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        for (let step = 1; step < 8; step++) {
          add(fileIdx + df * step, rankIdx + dr * step);
        }
      }
      break;
    }
    case 'r': {
      for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let step = 1; step < 8; step++) {
          add(fileIdx + df * step, rankIdx + dr * step);
        }
      }
      break;
    }
    case 'q': {
      for (const [df, dr] of [
        [1, 1], [1, -1], [-1, 1], [-1, -1],
        [1, 0], [-1, 0], [0, 1], [0, -1],
      ]) {
        for (let step = 1; step < 8; step++) {
          add(fileIdx + df * step, rankIdx + dr * step);
        }
      }
      break;
    }
    case 'k': {
      for (let df = -1; df <= 1; df++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (df !== 0 || dr !== 0) add(fileIdx + df, rankIdx + dr);
        }
      }
      if (piece.color === 'w' && fromSquare === 'e1') {
        targets.add('g1');
        targets.add('c1');
      } else if (piece.color === 'b' && fromSquare === 'e8') {
        targets.add('g8');
        targets.add('c8');
      }
      break;
    }
  }

  return Array.from(targets);
}

export function getKnightMovesFrom(square: Square, boardSize = 8): Square[] {
  const fileIdx = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rankNum = parseInt(square[1], 10) - 1; // 0..7 bottom->top
  const deltas = [
    [1, 2],
    [2, 1],
    [2, -1],
    [1, -2],
    [-1, -2],
    [-2, -1],
    [-2, 1],
    [-1, 2],
  ];
  const result: Square[] = [];
  for (const [df, dr] of deltas) {
    const nf = fileIdx + df;
    const nr = rankNum + dr;
    if (nf >= 0 && nf < boardSize && nr >= 0 && nr < boardSize) {
      result.push(`${FILES[nf]}${nr + 1}` as Square);
    }
  }
  return result;
}

export function isValidKnightMove(from: Square, to: Square): boolean {
  const df = Math.abs(FILES.indexOf(from[0] as (typeof FILES)[number]) - FILES.indexOf(to[0] as (typeof FILES)[number]));
  const dr = Math.abs(parseInt(from[1], 10) - parseInt(to[1], 10));
  return (df === 1 && dr === 2) || (df === 2 && dr === 1);
}

/**
 * Computes shortest knight path (BFS) between start and target squares.
 */
export function bfsShortestKnightPath(start: Square, target: Square): Square[] {
  if (start === target) return [start];
  const queue: Square[][] = [[start]];
  const visited = new Set<Square>([start]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const curr = path[path.length - 1];
    for (const next of getKnightMovesFrom(curr)) {
      if (next === target) {
        return [...path, next];
      }
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return [start];
}

/**
 * Warnsdorff's rule suggestion for Knight Tour
 */
export function getWarnsdorffNextSquare(
  current: Square,
  visited: Set<Square>,
  boardSize = 8
): Square | null {
  const candidates = getKnightMovesFrom(current, boardSize).filter((sq) => !visited.has(sq));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const degA = getKnightMovesFrom(a, boardSize).filter((s) => !visited.has(s)).length;
    const degB = getKnightMovesFrom(b, boardSize).filter((s) => !visited.has(s)).length;
    return degA - degB;
  });
  return candidates[0];
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatDurationPrecise(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0.0s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function extractPiecesFromFen(fen: string): Array<{
  square: Square;
  type: PieceSymbol;
  color: Color;
}> {
  const map = parseFenPieces(fen);
  const pieces: Array<{ square: Square; type: PieceSymbol; color: Color }> = [];
  map.forEach((p, square) => {
    pieces.push({ square, type: p.type, color: p.color });
  });
  return pieces;
}

/**
 * Parses the piece-placement field of any FEN string (including empty or partial boards without kings).
 */
export function parseFenPieces(fen: string): Map<Square, { type: PieceSymbol; color: Color }> {
  const map = new Map<Square, { type: PieceSymbol; color: Color }>();
  const placement = (fen || '').trim().split(/\s+/)[0] || '';
  if (!placement) return map;

  const ranks = placement.split('/');
  if (ranks.length !== 8) return map;

  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of ranks[r]) {
      if (f >= 8) break;
      if (ch >= '1' && ch <= '8') {
        f += parseInt(ch, 10);
      } else {
        const lower = ch.toLowerCase();
        if (lower === 'p' || lower === 'n' || lower === 'b' || lower === 'r' || lower === 'q' || lower === 'k') {
          const color: Color = ch === lower ? 'b' : 'w';
          const sq = `${FILES[f]}${RANKS[r]}` as Square;
          map.set(sq, { type: lower as PieceSymbol, color });
        }
        f += 1;
      }
    }
  }
  return map;
}

/**
 * Constructs a valid piece-placement FEN string from arbitrary pieces without requiring kings.
 */
export function buildPiecePlacementFen(
  pieces: Array<{ square: Square; type: PieceSymbol; color: Color }>
): string {
  const grid: Array<Array<string | null>> = Array.from({ length: 8 }, () =>
    Array(8).fill(null)
  );
  for (const p of pieces) {
    const fileIdx = FILES.indexOf(p.square[0] as (typeof FILES)[number]);
    const rankIdx = RANKS.indexOf(p.square[1] as (typeof RANKS)[number]);
    if (fileIdx >= 0 && rankIdx >= 0) {
      grid[rankIdx][fileIdx] = p.color === 'w' ? p.type.toUpperCase() : p.type.toLowerCase();
    }
  }
  const placement = grid
    .map((row) => {
      let out = '';
      let empty = 0;
      for (const cell of row) {
        if (!cell) {
          empty++;
        } else {
          if (empty > 0) {
            out += String(empty);
            empty = 0;
          }
          out += cell;
        }
      }
      if (empty > 0) out += String(empty);
      return out;
    })
    .join('/');
  return `${placement} w - - 0 1`;
}

/**
 * Parses a PGN string containing one or more games/puzzles into LichessPuzzle-compatible objects.
 * Supports PGNs with [FEN "..."] + solution moves, or standard games (takes tactical turning point / last moves).
 */
export function parsePgnToPuzzles(pgnText: string): LichessPuzzle[] {
  const blocks = pgnText
    .trim()
    .split(/\n(?=\[Event\s|\n\[FEN\s)/i)
    .map((b) => b.trim())
    .filter(Boolean);

  const results: LichessPuzzle[] = [];

  blocks.forEach((block, idx) => {
    try {
      const fenMatch = block.match(/\[FEN\s+"([^"]+)"\]/i);
      const eventMatch = block.match(/\[Event\s+"([^"]+)"\]/i);
      const siteMatch = block.match(/\[Site\s+"([^"]+)"\]/i);

      const chess = new Chess();
      chess.loadPgn(block);
      const history = chess.history({ verbose: true });
      if (history.length === 0) return;

      if (fenMatch) {
        // Puzzle PGN starting from FEN: synthesize a dummy setup or start directly if 2+ moves
        const baseChess = new Chess(fenMatch[1]);
        const uciMoves = history.map((m) => moveToUci(m));
        if (uciMoves.length >= 2) {
          const candidate: LichessPuzzle = {
            puzzleId: `pgn-${Date.now()}-${idx}`,
            fen: baseChess.fen(),
            moves: uciMoves.join(' '),
            rating: 1400,
            ratingDeviation: 100,
            popularity: 90,
            nbPlays: 1,
            themes: 'custom pgnImport',
            gameUrl: siteMatch?.[1] || '',
          };
          if (validateLichessPuzzle(candidate, { minRating: 0 }).valid) {
            results.push(candidate);
          }
        }
      } else if (history.length >= 4) {
        // Full game PGN: extract final tactical sequence (last 4 plies)
        const startIdx = Math.max(0, history.length - 4);
        const startFen = history[startIdx].before;
        const tailMoves = history.slice(startIdx).map((m) => moveToUci(m));
        const candidate: LichessPuzzle = {
          puzzleId: `pgn-${Date.now()}-${idx}`,
          fen: startFen,
          moves: tailMoves.join(' '),
          rating: 1450,
          ratingDeviation: 100,
          popularity: 85,
          nbPlays: 1,
          themes: eventMatch ? `custom ${eventMatch[1].toLowerCase().replace(/\s+/g, '_')}` : 'custom',
          gameUrl: siteMatch?.[1] || '',
        };
        if (validateLichessPuzzle(candidate, { minRating: 0 }).valid) {
          results.push(candidate);
        }
      }
    } catch {
      // Skip malformed PGN block
    }
  });

  return results;
}

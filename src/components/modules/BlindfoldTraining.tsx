import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Chess, Color, PieceSymbol, Square } from 'chess.js';
import { Play, Eye, EyeOff, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import { Chessboard, SquareHighlightType } from '../chess/Chessboard';
import { ChessPiece } from '../chess/ChessPiece';
import {
  FILES,
  PIECE_FULL_NAMES,
  RANKS,
  extractPiecesFromFen,
  formatDurationPrecise,
  isLightSquare,
  setupLichessPuzzle,
} from '../../lib/chessUtils';
import {
  BLINDFOLD_DIFFICULTY_RANGES,
  computePuzzleSignature,
  validateLichessPuzzle,
} from '../../lib/puzzleValidator';
import { PuzzleFetchError, fetchNextPuzzle } from '../../services/dataService';
import { useApp } from '../../context/AppContext';
import { soundEngine } from '../../lib/sound';
import {
  getEffectiveUserKey,
  pickNonRepeatingFromPool,
  readBucketHistory,
  recordLastItem,
} from '../../lib/trainingHistory';
import { DifficultyLevel, LichessPuzzle } from '../../types/chess';

export type BlindfoldMode =
  | 'blind-board'
  | 'follow-moves'
  | 'piece-tracking'
  | 'position-memory'
  | 'square-color';

const ALL_64_SQUARES: Square[] = FILES.flatMap((f) => RANKS.map((r) => `${f}${r}` as Square));

const PIECE_SORT_ORDER: Record<PieceSymbol, number> = {
  k: 0,
  q: 1,
  r: 2,
  b: 3,
  n: 4,
  p: 5,
};

export function pickNextSquareColorTarget(usedSquares: Set<Square>, lastSquare: Square | null): Square {
  let pool = ALL_64_SQUARES.filter((sq) => !usedSquares.has(sq) && sq !== lastSquare);
  if (pool.length === 0) {
    usedSquares.clear();
    pool = ALL_64_SQUARES.filter((sq) => sq !== lastSquare);
  }
  const next = pool[Math.floor(Math.random() * pool.length)];
  usedSquares.add(next);
  return next;
}

interface BlindfoldExercise {
  puzzleId: string;
  puzzleRating: number;
  prompt: string;
  instruction: string;
  inputType: 'square' | 'choice' | 'memory-place';
  choices?: string[];
  expectedSquare?: Square;
  expectedChoice?: string;
  displayFen: string;
  hidePiecesImmediately: boolean;
  studyMs?: number;
  movesText?: string[];
  memoryTargetPiece?: { square: Square; type: PieceSymbol; color: Color };
}

function selectUniqueOrNonPawnPiece(
  pieces: Array<{ square: Square; type: PieceSymbol; color: Color }>,
  fen: string,
  lastTargetSignature: string | null
) {
  const counts = new Map<string, number>();
  for (const p of pieces) {
    const key = `${p.color}:${p.type}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const nonPawns = pieces.filter((p) => p.type !== 'p');
  const uniqueNonPawns = nonPawns.filter((p) => (counts.get(`${p.color}:${p.type}`) ?? 0) === 1);
  const uniqueNonKings = uniqueNonPawns.filter((p) => p.type !== 'k');

  const basePool =
    uniqueNonKings.length > 0
      ? uniqueNonKings
      : uniqueNonPawns.length > 0
      ? uniqueNonPawns
      : nonPawns.length > 0
      ? nonPawns
      : pieces;

  const filtered = basePool.filter(
    (p) => `${fen}:${p.color}:${p.type}:${p.square}` !== lastTargetSignature
  );
  const finalPool = filtered.length > 0 ? filtered : basePool;
  return finalPool[Math.floor(Math.random() * finalPool.length)];
}

function buildExerciseFromLichessPuzzle(
  mode: Exclude<BlindfoldMode, 'square-color'>,
  difficulty: DifficultyLevel,
  puzzle: LichessPuzzle,
  lastTargetSignature: string | null
): { exercise: BlindfoldExercise; targetSignature: string } {
  const setup = setupLichessPuzzle(puzzle);
  const positionFen = setup.chess.fen();
  const pieces = extractPiecesFromFen(positionFen).sort(
    (a, b) => PIECE_SORT_ORDER[a.type] - PIECE_SORT_ORDER[b.type] || a.square.localeCompare(b.square)
  );

  if (mode === 'blind-board') {
    const pieceListWhite = pieces
      .filter((p) => p.color === 'w')
      .map((p) => `${p.type.toUpperCase()}${p.square}`)
      .join(', ');
    const pieceListBlack = pieces
      .filter((p) => p.color === 'b')
      .map((p) => `${p.type.toUpperCase()}${p.square}`)
      .join(', ');

    const target = selectUniqueOrNonPawnPiece(pieces, positionFen, lastTargetSignature);
    const colorName = target.color === 'w' ? 'White' : 'Black';
    const sig = `${positionFen}:${target.color}:${target.type}:${target.square}`;

    if (Math.random() < 0.65) {
      return {
        targetSignature: sig,
        exercise: {
          puzzleId: puzzle.puzzleId,
          puzzleRating: puzzle.rating,
          instruction: `Visualize the position below on the empty board.\nWhite: ${pieceListWhite}\nBlack: ${pieceListBlack}`,
          prompt: `Click the square occupied by the ${colorName} ${PIECE_FULL_NAMES[target.type]}.`,
          inputType: 'square',
          expectedSquare: target.square,
          displayFen: '8/8/8/8/8/8/8/8 w - - 0 1',
          hidePiecesImmediately: true,
        },
      };
    }

    const isLight = isLightSquare(target.square);
    return {
      targetSignature: sig,
      exercise: {
        puzzleId: puzzle.puzzleId,
        puzzleRating: puzzle.rating,
        instruction: `Visualize the position mentally.\nWhite: ${pieceListWhite}\nBlack: ${pieceListBlack}`,
        prompt: `What square color does the ${colorName} ${PIECE_FULL_NAMES[target.type]} on ${target.square} stand on?`,
        inputType: 'choice',
        choices: ['Light Square', 'Dark Square'],
        expectedChoice: isLight ? 'Light Square' : 'Dark Square',
        displayFen: '8/8/8/8/8/8/8/8 w - - 0 1',
        hidePiecesImmediately: true,
      },
    };
  }

  if (mode === 'follow-moves' || mode === 'piece-tracking') {
    const plyCount =
      difficulty === 'easy' ? 2 : difficulty === 'medium' ? 4 : difficulty === 'hard' ? 5 : 6;

    const sim = new Chess(positionFen);
    const sanList: string[] = [];
    const movedPieces: Array<{
      finalSquare: Square;
      type: PieceSymbol;
      color: Color;
      startSquare: Square;
    }> = [];

    for (let i = 0; i < plyCount; i++) {
      const legal = sim.moves({ verbose: true });
      if (legal.length === 0) break;
      const nonMate = i < plyCount - 1 ? legal.filter((m) => !m.san.includes('#')) : legal;
      const poolAfterMateCheck = nonMate.length > 0 ? nonMate : legal;
      const nonKing = poolAfterMateCheck.filter((m) => m.piece !== 'k');
      const choices = nonKing.length > 0 ? nonKing : poolAfterMateCheck;
      const move = choices[Math.floor(Math.random() * choices.length)];
      sim.move(move);
      sanList.push(move.san);

      const existing = movedPieces.find((mp) => mp.finalSquare === move.from);
      if (existing) {
        existing.finalSquare = move.to;
      } else {
        movedPieces.push({
          startSquare: move.from,
          finalSquare: move.to,
          type: move.piece,
          color: move.color,
        });
      }
    }

    const tracked =
      movedPieces[Math.floor(Math.random() * movedPieces.length)] || {
        startSquare: pieces[0].square,
        finalSquare: pieces[0].square,
        type: pieces[0].type,
        color: pieces[0].color,
      };

    const colorWord = tracked.color === 'w' ? 'White' : 'Black';

    return {
      targetSignature: `${positionFen}:${sanList.join(' ')}:${tracked.startSquare}`,
      exercise: {
        puzzleId: puzzle.puzzleId,
        puzzleRating: puzzle.rating,
        instruction:
          mode === 'follow-moves'
            ? 'Follow the move sequence mentally from the starting position. Pieces will not move on the board.'
            : `Track the ${colorWord} ${PIECE_FULL_NAMES[tracked.type]} starting on ${tracked.startSquare} through the sequence.`,
        prompt: `After these moves, click the final square of the ${colorWord} ${PIECE_FULL_NAMES[tracked.type]} (started on ${tracked.startSquare}).`,
        inputType: 'square',
        expectedSquare: tracked.finalSquare,
        displayFen: positionFen,
        hidePiecesImmediately: false,
        movesText: sanList,
      },
    };
  }

  // Mode D: Position Memory
  const studyMs =
    difficulty === 'easy' ? 6000 : difficulty === 'medium' ? 4500 : difficulty === 'hard' ? 3000 : 2200;
  const memTarget = selectUniqueOrNonPawnPiece(pieces, positionFen, lastTargetSignature);
  const colorWord = memTarget.color === 'w' ? 'White' : 'Black';

  return {
    targetSignature: `${positionFen}:${memTarget.color}:${memTarget.type}:${memTarget.square}`,
    exercise: {
      puzzleId: puzzle.puzzleId,
      puzzleRating: puzzle.rating,
      instruction: `Memorize the piece locations before the timer expires (${(studyMs / 1000).toFixed(1)}s).`,
      prompt: `Where was the ${colorWord} ${PIECE_FULL_NAMES[memTarget.type]} located? Click its square.`,
      inputType: 'memory-place',
      expectedSquare: memTarget.square,
      displayFen: positionFen,
      hidePiecesImmediately: false,
      studyMs,
      memoryTargetPiece: memTarget,
    },
  };
}

export const BlindfoldTraining: React.FC = () => {
  const { authUser, anonymousId, settings, records, recordTrainingSession } = useApp();
  const effectiveUserKey = getEffectiveUserKey(authUser?.id, anonymousId);

  const [mode, setMode] = useState<BlindfoldMode>('blind-board');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(settings.general.defaultDifficulty);

  const [exercise, setExercise] = useState<BlindfoldExercise | null>(null);
  const [isLoadingExercise, setIsLoadingExercise] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isStudyingMemory, setIsStudyingMemory] = useState(false);
  const [memoryCountdownMs, setMemoryCountdownMs] = useState(0);
  const [isSolved, setIsSolved] = useState(false);
  const [feedback, setFeedback] = useState<{ correct: boolean; message: string } | null>(null);
  const [highlights, setHighlights] = useState<Partial<Record<Square, SquareHighlightType>>>({});

  // Dedicated Square Color Recognition state (never uses a chessboard)
  const [colorSquare, setColorSquare] = useState<Square>(() =>
    pickNonRepeatingFromPool(
      ALL_64_SQUARES,
      (sq) => sq,
      'blindfold-color',
      effectiveUserKey,
      'square-color'
    )
  );
  const [colorFeedbackState, setColorFeedbackState] = useState<'neutral' | 'correct' | 'incorrect'>(
    'neutral'
  );
  const [colorCorrectCount, setColorCorrectCount] = useState(0);
  const [colorIncorrectCount, setColorIncorrectCount] = useState(0);

  const [correctCount, setCorrectCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const sessionStartRef = useRef<number>(Date.now());
  const colorPromptStartRef = useRef<number>(Date.now());
  const timeoutsRef = useRef<number[]>([]);
  const exerciseGenRef = useRef<number>(0);
  const sessionSeenIdsRef = useRef<Set<string>>(new Set());
  const sessionSeenSignaturesRef = useRef<Set<string>>(new Set());

  const clearScheduledTimeouts = useCallback(() => {
    for (const id of timeoutsRef.current) {
      window.clearTimeout(id);
    }
    timeoutsRef.current = [];
  }, []);

  useEffect(() => {
    return () => clearScheduledTimeouts();
  }, [clearScheduledTimeouts]);

  const advanceSquareColorPrompt = useCallback(() => {
    const next = pickNonRepeatingFromPool(
      ALL_64_SQUARES,
      (sq) => sq,
      'blindfold-color',
      effectiveUserKey,
      'square-color'
    );
    setColorSquare(next);
    setColorFeedbackState('neutral');
    colorPromptStartRef.current = Date.now();
  }, [effectiveUserKey]);

  const startExercise = async (
    nextMode: BlindfoldMode = mode,
    nextDiff: DifficultyLevel = difficulty
  ) => {
    clearScheduledTimeouts();
    const activeGen = ++exerciseGenRef.current;

    if (nextMode === 'square-color') {
      advanceSquareColorPrompt();
      return;
    }

    setIsLoadingExercise(true);
    setErrorMsg(null);
    setIsSolved(false);
    setFeedback(null);
    setHighlights({});
    setIsStudyingMemory(false);

    const band = BLINDFOLD_DIFFICULTY_RANGES[nextDiff];
    const bucketKey = `${nextMode}:${nextDiff}`;
    const scope = `blindfold:${nextMode}:${nextDiff}`;
    const persistedLast = readBucketHistory('blindfold', effectiveUserKey, bucketKey).last;
    const attemptExcludes = Array.from(
      new Set([...Array.from(sessionSeenIdsRef.current), ...(persistedLast ? [persistedLast] : [])])
    );

    try {
      let validPuzzle: LichessPuzzle | null = null;

      for (let attempt = 0; attempt < 8; attempt++) {
        const candidate = await fetchNextPuzzle({
          minRating: band.min,
          maxRating: band.max,
          excludeIds: attemptExcludes,
          anonId: effectiveUserKey,
          scope,
        });
        if (exerciseGenRef.current !== activeGen) return;

        attemptExcludes.push(candidate.puzzleId);
        const sig = computePuzzleSignature(candidate.fen, candidate.moves);
        if (sessionSeenSignaturesRef.current.has(sig)) continue;

        if (validateLichessPuzzle(candidate, { minRating: band.min, maxRating: band.max }).valid) {
          validPuzzle = candidate;
          break;
        }
      }

      if (!validPuzzle) {
        const fallback = await fetchNextPuzzle({
          minRating: band.min,
          maxRating: band.max,
          excludeIds: persistedLast ? [persistedLast] : undefined,
          anonId: effectiveUserKey,
          scope,
        });
        if (exerciseGenRef.current !== activeGen) return;
        if (!validateLichessPuzzle(fallback, { minRating: band.min, maxRating: band.max }).valid) {
          throw new Error('Could not find a verified Lichess position for this difficulty.');
        }
        validPuzzle = fallback;
      }

      sessionSeenIdsRef.current.add(validPuzzle.puzzleId);
      sessionSeenSignaturesRef.current.add(
        computePuzzleSignature(validPuzzle.fen, validPuzzle.moves)
      );
      recordLastItem('blindfold', effectiveUserKey, bucketKey, validPuzzle.puzzleId);

      const lastTargetSig = readBucketHistory(
        'blindfold-target',
        effectiveUserKey,
        bucketKey
      ).last;

      const { exercise: ex, targetSignature } = buildExerciseFromLichessPuzzle(
        nextMode,
        nextDiff,
        validPuzzle,
        lastTargetSig
      );
      recordLastItem('blindfold-target', effectiveUserKey, bucketKey, targetSignature);

      if (exerciseGenRef.current !== activeGen) return;

      setExercise(ex);
      setIsLoadingExercise(false);
      if (totalCount === 0) {
        sessionStartRef.current = Date.now();
      }

      if (ex.inputType === 'memory-place' && ex.studyMs) {
        setIsStudyingMemory(true);
        setMemoryCountdownMs(ex.studyMs);
      } else {
        setIsStudyingMemory(false);
      }
    } catch (err) {
      if (exerciseGenRef.current !== activeGen) return;
      setIsLoadingExercise(false);
      setErrorMsg(
        err instanceof PuzzleFetchError || err instanceof Error
          ? err.message
          : 'Failed to load blindfold position from server.'
      );
    }
  };

  useEffect(() => {
    if (!isStudyingMemory || !exercise?.studyMs) return;
    const start = Date.now();
    const timer = setInterval(() => {
      const remaining = exercise.studyMs! - (Date.now() - start);
      if (remaining <= 0) {
        setMemoryCountdownMs(0);
        setIsStudyingMemory(false);
        clearInterval(timer);
      } else {
        setMemoryCountdownMs(remaining);
      }
    }, 80);
    return () => clearInterval(timer);
  }, [isStudyingMemory, exercise]);

  const handleIncorrectGuess = (message: string, wrongSquare?: Square) => {
    soundEngine.playIncorrect(settings.sound);
    setFeedback({ correct: false, message });

    if (wrongSquare) {
      const gen = exerciseGenRef.current;
      setHighlights({ [wrongSquare]: 'wrong' });
      const tid = window.setTimeout(() => {
        if (exerciseGenRef.current !== gen) return;
        setHighlights((prev) => (prev[wrongSquare] === 'wrong' ? {} : prev));
      }, 450);
      timeoutsRef.current.push(tid);
    } else {
      setHighlights({});
    }
  };

  const handleCorrectAnswer = async (
    message: string,
    hl: Partial<Record<Square, SquareHighlightType>>
  ) => {
    clearScheduledTimeouts();
    const gen = exerciseGenRef.current;

    setIsSolved(true);
    setFeedback({ correct: true, message });
    setHighlights(hl);
    soundEngine.playCorrect(settings.sound);

    const nextTotal = totalCount + 1;
    const nextCorrect = correctCount + 1;
    setTotalCount(nextTotal);
    setCorrectCount(nextCorrect);

    const durationMs = Math.max(1000, Date.now() - sessionStartRef.current);
    sessionStartRef.current = Date.now();

    void recordTrainingSession({
      module: 'blindfold',
      mode,
      score: 1,
      total: 1,
      accuracy: 100,
      durationMs,
      recordUpdates: {
        bestStreak: nextCorrect,
      },
    });

    const activeMode = mode;
    const activeDiff = difficulty;
    const tid = window.setTimeout(() => {
      if (exerciseGenRef.current !== gen) return;
      void startExercise(activeMode, activeDiff);
    }, 650);
    timeoutsRef.current.push(tid);
  };

  const handleSquareClick = (sq: Square) => {
    if (!exercise || isSolved || isStudyingMemory || isLoadingExercise) return;
    if (exercise.inputType === 'choice') return;

    const target = exercise.expectedSquare!;
    if (sq === target) {
      void handleCorrectAnswer(`Correct! Square ${target} found.`, { [sq]: 'correct' });
    } else {
      handleIncorrectGuess(`Incorrect (${sq}) — keep trying!`, sq);
    }
  };

  const handleChoiceClick = (choice: string) => {
    if (!exercise || isSolved || isLoadingExercise) return;
    if (choice === exercise.expectedChoice) {
      void handleCorrectAnswer(`Correct! ${exercise.expectedChoice}.`, {});
    } else {
      handleIncorrectGuess('Incorrect — try another option.');
    }
  };

  const handleSquareColorAnswer = (guess: 'black' | 'white') => {
    if (colorFeedbackState !== 'neutral') return;
    clearScheduledTimeouts();
    const gen = exerciseGenRef.current;

    const expected: 'black' | 'white' = isLightSquare(colorSquare) ? 'white' : 'black';
    const isCorrect = guess === expected;
    const durationMs = Math.max(300, Date.now() - colorPromptStartRef.current);

    setTotalCount((t) => t + 1);
    if (isCorrect) {
      setColorFeedbackState('correct');
      setColorCorrectCount((c) => c + 1);
      setCorrectCount((c) => c + 1);
      soundEngine.playCorrect(settings.sound);
    } else {
      setColorFeedbackState('incorrect');
      setColorIncorrectCount((c) => c + 1);
      soundEngine.playIncorrect(settings.sound);
    }

    void recordTrainingSession({
      module: 'blindfold',
      mode: 'square-color',
      score: isCorrect ? 1 : 0,
      total: 1,
      accuracy: isCorrect ? 100 : 0,
      durationMs,
      recordUpdates: isCorrect
        ? {
            bestStreak: colorCorrectCount + 1,
          }
        : undefined,
    });

    const tid = window.setTimeout(() => {
      if (exerciseGenRef.current !== gen) return;
      advanceSquareColorPrompt();
    }, 480);
    timeoutsRef.current.push(tid);
  };

  const hideBoardPieces =
    !exercise ||
    exercise.hidePiecesImmediately ||
    (exercise.inputType === 'memory-place' && !isStudyingMemory && !isSolved);

  const accuracyPct = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
  const colorTotal = colorCorrectCount + colorIncorrectCount;
  const colorAccuracyPct = colorTotal > 0 ? Math.round((colorCorrectCount / colorTotal) * 100) : 0;
  const rec = records['blindfold'];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left Arena: Strictly NO Chessboard when mode === 'square-color' */}
        <div className="xl:col-span-7 flex flex-col items-center p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
          {mode === 'square-color' ? (
            <div className="w-full max-w-[540px] py-3 sm:py-4 px-3 flex flex-col items-center text-center space-y-5">
              <div>
                <div className="text-sm font-bold uppercase tracking-wider text-emerald-600 dark:text-[#39FF88]">
                  Square Color Recognition
                </div>
                <p className="mt-1 font-body text-sm font-medium text-slate-600 dark:text-[#CBD5E1]">
                  Identify whether this coordinate is a black or white square without looking at a chessboard.
                </p>
              </div>

              {/* Centered Large Coordinate Prompt */}
              <div className="w-full py-6 sm:py-8 rounded-2xl bg-slate-100 dark:bg-[#101B30] border border-slate-200 dark:border-[#263D5C] flex flex-col items-center justify-center">
                <div
                  data-testid="square-color-coordinate"
                  className={`text-6xl sm:text-7xl font-bold tracking-tight font-ui transition-colors duration-150 ${
                    colorFeedbackState === 'correct'
                      ? 'text-emerald-600 dark:text-[#39FF88]'
                      : colorFeedbackState === 'incorrect'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-900 dark:text-[#F1F5F9]'
                  }`}
                >
                  {colorSquare}
                </div>
              </div>

              {/* Large BLACK and WHITE Buttons directly underneath */}
              <div className="grid grid-cols-2 gap-3 w-full">
                <button
                  type="button"
                  disabled={colorFeedbackState !== 'neutral'}
                  onClick={() => handleSquareColorAnswer('black')}
                  className="py-4 px-5 rounded-xl bg-[#0B1220] hover:bg-[#162238] text-[#F1F5F9] border-2 border-[#263D5C] hover:border-[#39FF88]/70 text-lg font-bold tracking-wide flex items-center justify-center gap-3 cursor-pointer disabled:opacity-80 transition-colors shadow-sm"
                >
                  <span className="w-5 h-5 rounded-sm bg-[#111827] border border-slate-500 shrink-0" />
                  BLACK
                </button>

                <button
                  type="button"
                  disabled={colorFeedbackState !== 'neutral'}
                  onClick={() => handleSquareColorAnswer('white')}
                  className="py-4 px-5 rounded-xl bg-[#F8FAFC] hover:bg-white text-[#0F172A] border-2 border-slate-300 hover:border-emerald-500 text-lg font-bold tracking-wide flex items-center justify-center gap-3 cursor-pointer disabled:opacity-80 transition-colors shadow-sm"
                >
                  <span className="w-5 h-5 rounded-sm bg-white border border-slate-400 shrink-0" />
                  WHITE
                </button>
              </div>

              {/* Dedicated Square Color Recognition Score Summary */}
              <div className="grid grid-cols-3 gap-2.5 w-full text-sm">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-200/70 dark:border-[#263D5C]">
                  <div className="text-slate-600 dark:text-[#94A3B8] font-semibold">Correct</div>
                  <div className="mt-0.5 text-xl font-bold font-mono-tabular text-emerald-600 dark:text-[#39FF88]">
                    {colorCorrectCount}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-200/70 dark:border-[#263D5C]">
                  <div className="text-slate-600 dark:text-[#94A3B8] font-semibold">Incorrect</div>
                  <div className="mt-0.5 text-xl font-bold font-mono-tabular text-rose-500 dark:text-rose-400">
                    {colorIncorrectCount}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-200/70 dark:border-[#263D5C]">
                  <div className="text-slate-600 dark:text-[#94A3B8] font-semibold">Accuracy</div>
                  <div className="mt-0.5 text-xl font-bold font-mono-tabular text-slate-900 dark:text-[#F1F5F9]">
                    {colorTotal > 0 ? `${colorAccuracyPct}%` : '—'}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Exercise Prompt Box */}
              <div className="w-full max-w-[560px] mb-3 p-3 rounded-xl bg-slate-100 dark:bg-[#101B30] border border-slate-200 dark:border-[#263D5C]">
                {isLoadingExercise && !exercise ? (
                  <div className="font-body text-sm font-semibold text-slate-700 dark:text-[#CBD5E1]">
                    Loading Lichess position...
                  </div>
                ) : !exercise ? (
                  <div className="font-body text-sm font-semibold text-slate-700 dark:text-[#CBD5E1]">
                    Select a mode and difficulty on the right, then press{' '}
                    <strong className="font-ui font-bold text-slate-900 dark:text-[#F1F5F9]">Start Exercise</strong>.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs sm:text-sm text-slate-700 dark:text-[#CBD5E1]">
                      <span className="font-ui font-bold capitalize text-slate-900 dark:text-[#F1F5F9]">
                        {mode.replace('-', ' ')} · #{exercise.puzzleId} ({exercise.puzzleRating})
                      </span>
                      <span className="flex items-center gap-1.5 font-mono-tabular font-bold">
                        {hideBoardPieces ? (
                          <>
                            <EyeOff className="w-4 h-4" /> Pieces Hidden
                          </>
                        ) : isStudyingMemory ? (
                          <>
                            <Eye className="w-4 h-4 text-emerald-600 dark:text-[#39FF88]" /> Memorize:{' '}
                            {formatDurationPrecise(memoryCountdownMs)}
                          </>
                        ) : (
                          <>
                            <Eye className="w-4 h-4" /> Reference Position
                          </>
                        )}
                      </span>
                    </div>

                    <p className="font-body text-xs sm:text-sm font-medium whitespace-pre-line leading-snug text-slate-700 dark:text-[#CBD5E1]">
                      {exercise.instruction}
                    </p>

                    {exercise.movesText && exercise.movesText.length > 0 && (
                      <div className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] font-mono-tabular text-sm sm:text-base font-bold text-emerald-600 dark:text-[#39FF88]">
                        Moves: {exercise.movesText.join('  ')}
                      </div>
                    )}

                    {!isStudyingMemory && (
                      <div className="pt-0.5 flex items-center gap-2 font-ui text-sm sm:text-base font-bold text-slate-900 dark:text-[#F1F5F9]">
                        {exercise.memoryTargetPiece && (
                          <span className="w-5 h-5 inline-block shrink-0">
                            <ChessPiece
                              type={exercise.memoryTargetPiece.type}
                              color={exercise.memoryTargetPiece.color}
                              pieceSet={settings.board.pieceSet ?? 'merida'}
                            />
                          </span>
                        )}
                        <span>{exercise.prompt}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Chessboard
                fen={exercise ? exercise.displayFen : '8/8/8/8/8/8/8/8 w - - 0 1'}
                hidePieces={hideBoardPieces}
                squareHighlights={highlights}
                onSquareClick={handleSquareClick}
                disabled={
                  !exercise ||
                  isLoadingExercise ||
                  isStudyingMemory ||
                  isSolved ||
                  exercise.inputType === 'choice'
                }
              />

              {/* Choice Buttons (for square color / non-square questions in Mode A) */}
              {exercise?.inputType === 'choice' && exercise.choices && !isSolved && (
                <div className="mt-3 flex gap-3 w-full max-w-[560px]">
                  {exercise.choices.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => handleChoiceClick(c)}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-slate-100 dark:bg-[#101B30] hover:bg-emerald-600/20 dark:hover:bg-[#39FF88]/15 border border-slate-200 dark:border-[#263D5C] hover:border-emerald-500/40 dark:hover:border-[#39FF88]/60 text-sm sm:text-base font-semibold text-slate-900 dark:text-[#F1F5F9] cursor-pointer transition-colors"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}

              {errorMsg && (
                <div className="mt-3 w-full max-w-[560px] p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs sm:text-sm text-rose-400 flex items-center justify-between gap-3">
                  <span className="font-body">{errorMsg}</span>
                  <button
                    type="button"
                    onClick={() => void startExercise()}
                    className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium cursor-pointer shrink-0"
                  >
                    Retry
                  </button>
                </div>
              )}

              {feedback && (
                <div
                  className={`mt-3 w-full max-w-[560px] p-3 rounded-xl border flex items-center justify-between gap-3 text-sm ${
                    feedback.correct
                      ? 'bg-emerald-500/10 dark:bg-[#39FF88]/10 border-emerald-500/30 dark:border-[#39FF88]/40 text-emerald-700 dark:text-[#39FF88]'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  <span className="flex items-center gap-2 font-ui font-semibold">
                    {feedback.correct ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 shrink-0" />
                    )}
                    {feedback.message}
                  </span>
                  {feedback.correct && (
                    <button
                      type="button"
                      onClick={() => void startExercise()}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 dark:bg-[#39FF88] dark:hover:bg-[#52FF99] text-white dark:text-[#080F1E] text-xs sm:text-sm font-semibold cursor-pointer whitespace-nowrap"
                    >
                      Next Drill
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Mode Selector & Stats */}
        <div className="xl:col-span-5 space-y-3">
          <div className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
              Blindfold Drill Setup
            </h2>

            <div className="space-y-1.5">
              {(
                [
                  ['blind-board', 'Mode A — Blind Board', 'Receive pieces in notation and locate them on an empty board.'],
                  ['follow-moves', 'Mode B — Follow the Moves', 'Track mental piece changes from a sequence of SAN moves.'],
                  ['piece-tracking', 'Mode C — Piece Visualization', 'Follow one specific piece across multiple legal moves.'],
                  ['position-memory', 'Mode D — Position Memory', 'Brief study window before pieces disappear for recall.'],
                  ['square-color', 'Mode E — Square Color Recognition', 'Name whether any coordinate (a1–h8) is Black or White with no board shown.'],
                ] as const
              ).map(([id, title, desc]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    clearScheduledTimeouts();
                    exerciseGenRef.current += 1;
                    setMode(id);
                    setExercise(null);
                    setIsLoadingExercise(false);
                    setErrorMsg(null);
                    setIsSolved(false);
                    setFeedback(null);
                    setHighlights({});
                    if (id === 'square-color') {
                      advanceSquareColorPrompt();
                    }
                  }}
                  className={`w-full px-3 py-2 rounded-xl border text-left transition-colors cursor-pointer ${
                    mode === id
                      ? 'bg-emerald-600/12 dark:bg-[#39FF88]/12 border-emerald-500/45 dark:border-[#39FF88]/60'
                      : 'border-slate-200 dark:border-[#263D5C] hover:bg-slate-50 dark:hover:bg-[#101B30]'
                  }`}
                >
                  <div
                    className={`font-ui text-sm font-bold ${
                      mode === id
                        ? 'text-emerald-700 dark:text-[#39FF88]'
                        : 'text-slate-900 dark:text-[#F1F5F9]'
                    }`}
                  >
                    {title}
                  </div>
                  <div className="mt-0.5 font-body text-xs leading-snug text-slate-500 dark:text-[#94A3B8]">
                    {desc}
                  </div>
                </button>
              ))}
            </div>

            {mode !== 'square-color' && (
              <>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                    Difficulty Level
                  </label>
                  <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#101B30] border border-slate-200/70 dark:border-[#263D5C]">
                    {(['easy', 'medium', 'hard', 'expert'] as const).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setDifficulty(lvl)}
                        className={`py-1.5 rounded-lg text-xs sm:text-sm font-semibold capitalize cursor-pointer transition-colors ${
                          difficulty === lvl
                            ? 'bg-white dark:bg-[#14233A] text-slate-900 dark:text-[#39FF88] border border-slate-200 dark:border-[#39FF88]/50 shadow-sm'
                            : 'text-slate-500 dark:text-[#94A3B8] border border-transparent'
                        }`}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isLoadingExercise}
                  onClick={() => void startExercise()}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 dark:bg-[#39FF88] dark:hover:bg-[#52FF99] text-white dark:text-[#080F1E] text-sm sm:text-base font-bold transition-colors cursor-pointer disabled:opacity-60"
                >
                  {exercise ? <RotateCcw className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {isLoadingExercise ? 'Loading...' : exercise ? 'New Exercise' : 'Start Exercise'}
                </button>
              </>
            )}

            {mode === 'square-color' && (
              <button
                type="button"
                onClick={() => advanceSquareColorPrompt()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 dark:bg-[#39FF88] dark:hover:bg-[#52FF99] text-white dark:text-[#080F1E] text-sm sm:text-base font-bold transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Next Square
              </button>
            )}
          </div>

          <div className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
            <h3 className="text-base font-bold text-slate-900 dark:text-[#F1F5F9] mb-2.5">
              Blindfold Statistics
            </h3>
            <div className="grid grid-cols-3 gap-2.5 text-sm">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-xs text-slate-600 dark:text-[#94A3B8] font-semibold">Session</div>
                <div className="mt-1 text-lg sm:text-xl font-bold font-mono-tabular text-slate-900 dark:text-[#F1F5F9]">
                  {correctCount}/{totalCount}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-xs text-slate-600 dark:text-[#94A3B8] font-semibold">Accuracy</div>
                <div className="mt-1 text-lg sm:text-xl font-bold font-mono-tabular text-emerald-600 dark:text-[#39FF88]">
                  {totalCount > 0 ? `${accuracyPct}%` : '—'}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-xs text-slate-600 dark:text-[#94A3B8] font-semibold">All-Time</div>
                <div className="mt-1 text-lg sm:text-xl font-bold font-mono-tabular text-slate-900 dark:text-[#F1F5F9]">
                  {rec ? `${rec.totalCorrect}/${rec.totalAttempts}` : '0'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { Chess, PieceSymbol, Square } from 'chess.js';
import { Target, ArrowRight, RotateCcw, CheckCircle2, XCircle, Trophy } from 'lucide-react';
import { Chessboard, SquareHighlightType } from '../chess/Chessboard';
import { moveToUci, parseUciMove, setupLichessPuzzle } from '../../lib/chessUtils';
import {
  MIN_PUZZLE_RATING,
  PUZZLE_DIFFICULTY_RANGES,
  validateLichessPuzzle,
} from '../../lib/puzzleValidator';
import { PuzzleFetchError, fetchNextPuzzle } from '../../services/dataService';
import { getEffectiveUserKey, readBucketHistory, recordLastItem } from '../../lib/trainingHistory';
import { useApp } from '../../context/AppContext';
import { soundEngine } from '../../lib/sound';
import { LichessPuzzle, PuzzleDifficulty } from '../../types/chess';

const TACTICAL_THEMES = [
  { id: 'mateIn1', label: 'Mate in 1' },
  { id: 'mateIn2', label: 'Mate in 2' },
  { id: 'mateIn3', label: 'Mate in 3' },
  { id: 'fork', label: 'Fork' },
  { id: 'pin', label: 'Pin' },
  { id: 'skewer', label: 'Skewer' },
  { id: 'discoveredAttack', label: 'Discovered Attack' },
  { id: 'deflection', label: 'Deflection' },
  { id: 'sacrifice', label: 'Sacrifice' },
  { id: 'backRankMate', label: 'Back Rank Mate' },
];

const DIFFICULTY_BANDS: Record<PuzzleDifficulty | 'all', { label: string; min: number; max: number }> = {
  all: { label: 'All Levels', min: 1200, max: 3200 },
  medium: PUZZLE_DIFFICULTY_RANGES.medium,
  hard: PUZZLE_DIFFICULTY_RANGES.hard,
  expert: PUZZLE_DIFFICULTY_RANGES.expert,
};

const INITIAL_TACTICAL_ELO = 1500;

function calculateTacticalElo(
  currentRating: number,
  puzzleRating: number,
  isCorrect: boolean
): { nextRating: number; delta: number } {
  const expected = 1 / (1 + Math.pow(10, (puzzleRating - currentRating) / 400));
  const difficultyFactor = 1 - expected;
  const rawDelta = isCorrect
    ? Math.max(2, Math.round(32 * difficultyFactor))
    : -Math.max(2, Math.round(24 * difficultyFactor));
  const nextRating = Math.max(100, currentRating + rawDelta);
  return {
    nextRating,
    delta: nextRating - currentRating,
  };
}

export const TacticalThemes: React.FC = () => {
  const { authUser, anonymousId, settings, records, recordTrainingSession } = useApp();
  const effectiveUserKey = getEffectiveUserKey(authUser?.id, anonymousId);

  const rawStoredElo = records['tactical-themes']?.extra?.eloRating;
  const persistedElo =
    typeof rawStoredElo === 'number' && Number.isFinite(rawStoredElo)
      ? Math.round(rawStoredElo)
      : INITIAL_TACTICAL_ELO;

  const [eloRating, setEloRating] = useState<number>(persistedElo);
  const [lastRatingDelta, setLastRatingDelta] = useState<number | null>(null);

  useEffect(() => {
    setEloRating(persistedElo);
  }, [persistedElo]);

  const [selectedTheme, setSelectedTheme] = useState<string>(TACTICAL_THEMES[0].id);
  const [selectedDifficulty, setSelectedDifficulty] = useState<PuzzleDifficulty | 'all'>('all');

  const [puzzle, setPuzzle] = useState<LichessPuzzle | null>(null);
  const [fen, setFen] = useState('8/8/8/8/8/8/8/8 w - - 0 1');
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [highlights, setHighlights] = useState<Partial<Record<Square, SquareHighlightType>>>({});
  const [solutionMoves, setSolutionMoves] = useState<string[]>([]);
  const [solutionStep, setSolutionStep] = useState(0);

  const [status, setStatus] = useState<'loading' | 'playing' | 'solved' | 'failed'>('loading');
  const [isWaitingOpponent, setIsWaitingOpponent] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const chessRef = useRef<Chess>(new Chess());
  const puzzleStartRef = useRef<number>(Date.now());
  const lastPuzzleIdRef = useRef<string | null>(null);
  const timeoutsRef = useRef<number[]>([]);
  const loadGenRef = useRef<number>(0);
  const ratingSettledRef = useRef<boolean>(false);

  const clearScheduledTimeouts = () => {
    for (const id of timeoutsRef.current) {
      window.clearTimeout(id);
    }
    timeoutsRef.current = [];
  };

  useEffect(() => {
    return () => clearScheduledTimeouts();
  }, []);

  const loadThemePuzzle = async (theme = selectedTheme, diff = selectedDifficulty) => {
    clearScheduledTimeouts();
    const genId = ++loadGenRef.current;

    setStatus('loading');
    setIsWaitingOpponent(false);
    setErrorMsg(null);
    setHighlights({});

    try {
      const band = DIFFICULTY_BANDS[diff];
      const bucket = `${theme}:${diff}`;
      const scope = `tactical-themes:${bucket}`;
      const persistedLast = readBucketHistory('tactical-themes', effectiveUserKey, bucket).last;
      let fetched: LichessPuzzle | null = null;
      const immediateExcludes = Array.from(
        new Set(
          [lastPuzzleIdRef.current, persistedLast].filter((v): v is string => Boolean(v))
        )
      );

      for (let attempt = 0; attempt < 5; attempt++) {
        let candidate: LichessPuzzle;
        try {
          candidate = await fetchNextPuzzle({
            minRating: band.min,
            maxRating: band.max,
            theme,
            excludeIds: immediateExcludes,
            anonId: effectiveUserKey,
            scope,
          });
        } catch (err) {
          // Only relax rating band if server explicitly returned 404 (no puzzles in that theme+band)
          if (err instanceof PuzzleFetchError && err.status === 404 && diff !== 'all') {
            candidate = await fetchNextPuzzle({
              minRating: MIN_PUZZLE_RATING,
              maxRating: 3200,
              theme,
              excludeIds: immediateExcludes,
              anonId: effectiveUserKey,
              scope: `tactical-themes:${theme}:all`,
            });
          } else {
            throw err;
          }
        }
        if (loadGenRef.current !== genId) return;

        immediateExcludes.push(candidate.puzzleId);
        if (validateLichessPuzzle(candidate, { minRating: MIN_PUZZLE_RATING }).valid) {
          fetched = candidate;
          break;
        }
      }

      if (!fetched) {
        throw new Error('Could not find a verified tactical puzzle for this filter.');
      }

      const pre = new Chess(fetched.fen);
      const setup = setupLichessPuzzle(fetched);

      lastPuzzleIdRef.current = fetched.puzzleId;
      recordLastItem('tactical-themes', effectiveUserKey, bucket, fetched.puzzleId);
      ratingSettledRef.current = false;
      setPuzzle(fetched);
      setOrientation(setup.playerColor);
      setSolutionMoves(setup.solutionMoves);
      setSolutionStep(0);
      setFen(pre.fen());
      setLastMove(null);
      setStatus('playing');
      setIsWaitingOpponent(true);

      const tid = window.setTimeout(() => {
        if (loadGenRef.current !== genId) return;
        chessRef.current = setup.chess;
        setFen(setup.chess.fen());
        setLastMove({ from: setup.setupMove.from, to: setup.setupMove.to });
        soundEngine.playMove(settings.sound, Boolean(setup.setupMove.captured));
        setIsWaitingOpponent(false);
        puzzleStartRef.current = Date.now();
      }, 320);
      timeoutsRef.current.push(tid);
    } catch (err) {
      if (loadGenRef.current !== genId) return;
      setIsWaitingOpponent(false);
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not retrieve tactical puzzle from server.'
      );
      setStatus('failed');
    }
  };

  useEffect(() => {
    void loadThemePuzzle(selectedTheme, selectedDifficulty);
  }, [selectedTheme, selectedDifficulty, effectiveUserKey]);

  const handleMove = (from: Square, to: Square, promotion?: PieceSymbol): boolean => {
    if (status !== 'playing' || isWaitingOpponent || !puzzle) return false;

    const chess = new Chess(chessRef.current.fen());
    let moveObj;
    try {
      moveObj = chess.move(promotion ? { from, to, promotion } : { from, to, promotion: 'q' });
    } catch {
      return false;
    }
    if (!moveObj) return false;

    const playedUci = moveToUci(moveObj);
    const expectedUci = solutionMoves[solutionStep];
    const isCorrect =
      playedUci === expectedUci || (chess.isCheckmate() && solutionStep === solutionMoves.length - 1);

    if (!isCorrect) {
      soundEngine.playIncorrect(settings.sound);
      setHighlights({ [from]: 'wrong', [to]: 'wrong' });
      setStatus('failed');

      let recordUpdates: { extra: { eloRating: number } } | undefined;
      if (!ratingSettledRef.current) {
        ratingSettledRef.current = true;
        const { nextRating, delta } = calculateTacticalElo(eloRating, puzzle.rating, false);
        setEloRating(nextRating);
        setLastRatingDelta(delta);
        recordUpdates = { extra: { eloRating: nextRating } };
      }

      void recordTrainingSession({
        module: 'tactical-themes',
        mode: selectedTheme,
        score: 0,
        total: 1,
        accuracy: 0,
        durationMs: Date.now() - puzzleStartRef.current,
        metadata: { puzzleId: puzzle.puzzleId, rating: puzzle.rating },
        recordUpdates,
      });
      return false;
    }

    chessRef.current = chess;
    setFen(chess.fen());
    setLastMove({ from: moveObj.from, to: moveObj.to });
    setHighlights({ [to]: 'correct' });
    soundEngine.playMove(settings.sound, Boolean(moveObj.captured));

    const nextStep = solutionStep + 1;
    const genId = loadGenRef.current;

    if (nextStep >= solutionMoves.length || chess.isCheckmate()) {
      soundEngine.playCorrect(settings.sound);
      setStatus('solved');

      let eloExtra: { eloRating: number } | undefined;
      if (!ratingSettledRef.current) {
        ratingSettledRef.current = true;
        const { nextRating, delta } = calculateTacticalElo(eloRating, puzzle.rating, true);
        setEloRating(nextRating);
        setLastRatingDelta(delta);
        eloExtra = { eloRating: nextRating };
      }

      void recordTrainingSession({
        module: 'tactical-themes',
        mode: selectedTheme,
        score: 1,
        total: 1,
        accuracy: 100,
        durationMs: Date.now() - puzzleStartRef.current,
        metadata: { puzzleId: puzzle.puzzleId, rating: puzzle.rating },
        recordUpdates: {
          highestRating: puzzle.rating,
          ...(eloExtra ? { extra: eloExtra } : {}),
        },
      });

      const nextTid = window.setTimeout(() => {
        if (loadGenRef.current !== genId) return;
        void loadThemePuzzle(selectedTheme, selectedDifficulty);
      }, 500);
      timeoutsRef.current.push(nextTid);
      return true;
    }

    setIsWaitingOpponent(true);
    const tid = window.setTimeout(() => {
      if (loadGenRef.current !== genId) return;
      const reply = new Chess(chess.fen());
      const opp = reply.move(parseUciMove(solutionMoves[nextStep]));
      if (opp) {
        chessRef.current = reply;
        setFen(reply.fen());
        setLastMove({ from: opp.from, to: opp.to });
        setHighlights({});
        soundEngine.playMove(settings.sound, Boolean(opp.captured));
        setSolutionStep(nextStep + 1);
      }
      setIsWaitingOpponent(false);
    }, 300);
    timeoutsRef.current.push(tid);

    return true;
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <div className="xl:col-span-7 flex flex-col items-center p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
          <div className="w-full max-w-[560px] mb-3 px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-[#101B30] border border-slate-200 dark:border-[#263D5C] flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-base sm:text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
              <Target className="w-5 h-5 text-emerald-600 dark:text-[#39FF88]" />
              {puzzle
                ? `${orientation === 'white' ? 'White' : 'Black'} to move`
                : 'Loading puzzle...'}
            </div>
            {puzzle && (
              <div className="text-sm sm:text-[15px] font-mono-tabular font-semibold text-slate-700 dark:text-[#CBD5E1]">
                #{puzzle.puzzleId} · Rating {puzzle.rating}
              </div>
            )}
          </div>

          <Chessboard
            fen={fen}
            orientation={orientation}
            playerColor={orientation}
            allowPremoves={status === 'playing' && Boolean(puzzle)}
            isOpponentTurn={isWaitingOpponent}
            resetKey={puzzle?.puzzleId ?? 'loading'}
            lastMove={lastMove}
            squareHighlights={highlights}
            onMove={handleMove}
            disabled={status !== 'playing' || !puzzle}
          />

          {status === 'failed' && (
            <div className="mt-4 w-full max-w-[560px] flex flex-wrap items-center justify-end gap-2">
              {puzzle && (
                <button
                  type="button"
                  onClick={() => {
                    const setup = setupLichessPuzzle(puzzle);
                    chessRef.current = setup.chess;
                    setFen(setup.chess.fen());
                    setLastMove({ from: setup.setupMove.from, to: setup.setupMove.to });
                    setSolutionStep(0);
                    setHighlights({});
                    setIsWaitingOpponent(false);
                    setStatus('playing');
                    puzzleStartRef.current = Date.now();
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-[#263D5C] text-sm sm:text-base font-semibold text-slate-700 dark:text-[#F1F5F9] hover:bg-slate-100 dark:hover:bg-[#101B30] cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={() => void loadThemePuzzle(selectedTheme, selectedDifficulty)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 dark:bg-[#39FF88] dark:hover:bg-[#52FF99] text-white dark:text-[#080F1E] text-sm sm:text-base font-semibold cursor-pointer"
              >
                Next Puzzle
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {status === 'solved' && (
            <div className="mt-3 w-full max-w-[560px] p-3.5 rounded-xl bg-emerald-500/10 dark:bg-[#39FF88]/10 border border-emerald-500/30 dark:border-[#39FF88]/40 font-body text-sm sm:text-base font-medium text-emerald-700 dark:text-[#39FF88] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Puzzle solved! Loading next puzzle...
            </div>
          )}

          {status === 'failed' && (
            <div className="mt-3 w-full max-w-[560px] p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 font-body text-sm sm:text-base font-medium text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <XCircle className="w-4 h-4 shrink-0" />
              {errorMsg || 'Incorrect move — try again or advance to the next puzzle.'}
            </div>
          )}
        </div>

        {/* Theme & Difficulty Filters */}
        <div className="xl:col-span-5 space-y-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] space-y-3">
            <h2 className="text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
              Tactical Motif
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {TACTICAL_THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTheme(t.id)}
                  className={`px-3 py-2 rounded-xl border text-sm font-semibold text-left cursor-pointer transition-colors ${
                    selectedTheme === t.id
                      ? 'bg-emerald-600/15 dark:bg-[#39FF88]/12 border-emerald-500/45 dark:border-[#39FF88]/60 text-emerald-700 dark:text-[#39FF88]'
                      : 'border-slate-200 dark:border-[#263D5C] text-slate-700 dark:text-[#F1F5F9] hover:bg-slate-50 dark:hover:bg-[#101B30]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] space-y-2.5">
              <h2 className="text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
                Difficulty
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(DIFFICULTY_BANDS) as Array<PuzzleDifficulty | 'all'>).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setSelectedDifficulty(d)}
                    className={`w-full px-3.5 py-2.5 rounded-xl border text-sm font-semibold text-left cursor-pointer transition-colors ${
                      selectedDifficulty === d
                        ? 'bg-emerald-600/15 dark:bg-[#39FF88]/12 border-emerald-500/45 dark:border-[#39FF88]/60 text-emerald-700 dark:text-[#39FF88]'
                        : 'border-slate-200 dark:border-[#263D5C] text-slate-600 dark:text-[#F1F5F9] hover:bg-slate-50 dark:hover:bg-[#101B30]'
                    }`}
                  >
                    {DIFFICULTY_BANDS[d].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-4 py-3 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Trophy className="w-5 h-5 text-emerald-600 dark:text-[#39FF88] shrink-0" />
                <span className="text-sm font-semibold text-slate-700 dark:text-[#CBD5E1]">
                  Tactical Rating
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono-tabular text-xl sm:text-2xl font-bold text-slate-900 dark:text-[#F1F5F9]">
                  {eloRating}
                </span>
                {lastRatingDelta !== null && (
                  <span
                    className={`font-mono-tabular text-sm font-bold ${
                      lastRatingDelta >= 0
                        ? 'text-emerald-600 dark:text-[#39FF88]'
                        : 'text-rose-500 dark:text-rose-400'
                    }`}
                  >
                    {lastRatingDelta >= 0 ? `+${lastRatingDelta}` : lastRatingDelta}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

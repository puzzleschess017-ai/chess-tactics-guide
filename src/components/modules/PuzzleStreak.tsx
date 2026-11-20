import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, PieceSymbol, Square } from 'chess.js';
import { Flame, Play, RotateCcw, AlertTriangle } from 'lucide-react';
import { Chessboard, SquareHighlightType } from '../chess/Chessboard';
import {
  formatDurationPrecise,
  moveToUci,
  parseUciMove,
  setupLichessPuzzle,
} from '../../lib/chessUtils';
import {
  STREAK_PROGRESSION_STAGES,
  StreakProgressionStage,
  formatStreakModeLabel,
  getStreakProgressionStage,
} from '../../lib/puzzleStreak';
import { computePuzzleSignature, validateLichessPuzzle } from '../../lib/puzzleValidator';
import { getEffectiveUserKey, readBucketHistory, recordLastItem } from '../../lib/trainingHistory';
import { PuzzleFetchError, fetchNextPuzzle } from '../../services/dataService';
import { useApp } from '../../context/AppContext';
import { soundEngine } from '../../lib/sound';
import { LichessPuzzle } from '../../types/chess';

export const PuzzleStreak: React.FC = () => {
  const { authUser, anonymousId, settings, records, sessions, recordTrainingSession } = useApp();
  const effectiveUserKey = getEffectiveUserKey(authUser?.id, anonymousId);

  const [phase, setPhase] = useState<'ready' | 'playing' | 'gameover'>('ready');
  const [currentStage, setCurrentStage] = useState<StreakProgressionStage>(
    STREAK_PROGRESSION_STAGES[0]
  );

  const [puzzle, setPuzzle] = useState<LichessPuzzle | null>(null);
  const [fen, setFen] = useState<string>('8/8/8/8/8/8/8/8 w - - 0 1');
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [solutionMoves, setSolutionMoves] = useState<string[]>([]);
  const [solutionStep, setSolutionStep] = useState<number>(0);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [highlights, setHighlights] = useState<Partial<Record<Square, SquareHighlightType>>>({});
  const [isOpponentThinking, setIsOpponentThinking] = useState(false);
  const [isAdvancingPuzzle, setIsAdvancingPuzzle] = useState(false);

  const [currentStreak, setCurrentStreak] = useState(0);
  const [highestRatingSolved, setHighestRatingSolved] = useState<number>(0);
  const [solveTimesMs, setSolveTimesMs] = useState<number[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const chessRef = useRef<Chess>(new Chess());
  const puzzleStartRef = useRef<number>(Date.now());
  const sessionStartRef = useRef<number>(Date.now());
  const runSeenIdsRef = useRef<Set<string>>(new Set());
  const runSeenSignaturesRef = useRef<Set<string>>(new Set());
  const timeoutsRef = useRef<number[]>([]);
  const runIdRef = useRef<number>(0);

  const clearScheduledTimeouts = () => {
    for (const id of timeoutsRef.current) {
      window.clearTimeout(id);
    }
    timeoutsRef.current = [];
  };

  useEffect(() => {
    return () => clearScheduledTimeouts();
  }, []);

  const loadPuzzleIntoBoard = async (activeRunId: number, streakSolvedCount: number) => {
    clearScheduledTimeouts();
    setErrorMsg(null);
    setHighlights({});
    setIsAdvancingPuzzle(false);
    setIsOpponentThinking(true);

    const stage = getStreakProgressionStage(streakSolvedCount);
    setCurrentStage(stage);

    try {
      let validPuzzle: LichessPuzzle | null = null;
      const persistedLast = readBucketHistory('puzzle-streak', effectiveUserKey, 'all').last;
      const attemptExcludes = Array.from(
        new Set([...Array.from(runSeenIdsRef.current), ...(persistedLast ? [persistedLast] : [])])
      );

      for (let attempt = 0; attempt < 8; attempt++) {
        const candidate = await fetchNextPuzzle({
          minRating: stage.minRating,
          maxRating: stage.maxRating,
          excludeIds: attemptExcludes,
          anonId: effectiveUserKey,
          scope: 'puzzle-streak',
        });
        if (runIdRef.current !== activeRunId) return;

        attemptExcludes.push(candidate.puzzleId);
        const sig = computePuzzleSignature(candidate.fen, candidate.moves);
        if (runSeenSignaturesRef.current.has(sig)) continue;

        const validation = validateLichessPuzzle(candidate, {
          minRating: stage.minRating,
          maxRating: stage.maxRating,
        });
        if (validation.valid) {
          validPuzzle = candidate;
          runSeenIdsRef.current.add(candidate.puzzleId);
          runSeenSignaturesRef.current.add(sig);
          recordLastItem('puzzle-streak', effectiveUserKey, 'all', candidate.puzzleId);
          break;
        }
      }

      if (!validPuzzle) {
        const fallback = await fetchNextPuzzle({
          minRating: stage.minRating,
          maxRating: stage.maxRating,
          excludeIds: persistedLast ? [persistedLast] : undefined,
          anonId: effectiveUserKey,
          scope: 'puzzle-streak',
        });
        if (runIdRef.current !== activeRunId) return;
        const validation = validateLichessPuzzle(fallback, {
          minRating: stage.minRating,
          maxRating: stage.maxRating,
        });
        if (!validation.valid) {
          throw new Error('Could not find a verified puzzle for this streak stage.');
        }
        validPuzzle = fallback;
        runSeenIdsRef.current.add(fallback.puzzleId);
        runSeenSignaturesRef.current.add(computePuzzleSignature(fallback.fen, fallback.moves));
        recordLastItem('puzzle-streak', effectiveUserKey, 'all', fallback.puzzleId);
      }

      const initialChess = new Chess(validPuzzle.fen);
      const setup = setupLichessPuzzle(validPuzzle);

      setPuzzle(validPuzzle);
      setOrientation(setup.playerColor);
      setSolutionMoves(setup.solutionMoves);
      setSolutionStep(0);

      setFen(initialChess.fen());
      setLastMove(null);

      const tid = window.setTimeout(() => {
        if (runIdRef.current !== activeRunId) return;
        chessRef.current = setup.chess;
        setFen(setup.chess.fen());
        setLastMove({ from: setup.setupMove.from, to: setup.setupMove.to });
        soundEngine.playMove(settings.sound, Boolean(setup.setupMove.captured));
        setIsOpponentThinking(false);
        puzzleStartRef.current = Date.now();
      }, 360);
      timeoutsRef.current.push(tid);
    } catch (err) {
      if (runIdRef.current !== activeRunId) return;
      setIsOpponentThinking(false);
      setErrorMsg(
        err instanceof PuzzleFetchError || err instanceof Error
          ? err.message
          : 'Failed to load puzzle from server.'
      );
    }
  };

  const startStreak = () => {
    clearScheduledTimeouts();
    const nextRunId = ++runIdRef.current;
    runSeenIdsRef.current.clear();
    runSeenSignaturesRef.current.clear();
    setCurrentStreak(0);
    setHighestRatingSolved(0);
    setSolveTimesMs([]);
    setCurrentStage(STREAK_PROGRESSION_STAGES[0]);
    sessionStartRef.current = Date.now();
    setPhase('playing');
    void loadPuzzleIntoBoard(nextRunId, 0);
  };

  const handleMove = (from: Square, to: Square, promotion?: PieceSymbol): boolean => {
    if (phase !== 'playing' || isOpponentThinking || !puzzle) return false;

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

    const isMate = chess.isCheckmate();
    const isCorrect =
      playedUci === expectedUci || (isMate && solutionStep === solutionMoves.length - 1);

    if (!isCorrect) {
      clearScheduledTimeouts();
      soundEngine.playIncorrect(settings.sound);
      setHighlights({ [from]: 'wrong', [to]: 'wrong' });
      setPhase('gameover');

      const durationMs = Date.now() - sessionStartRef.current;
      const totalAttempted = currentStreak + 1;
      const avgSolveMs =
        solveTimesMs.length > 0
          ? Math.round(solveTimesMs.reduce((a, b) => a + b, 0) / solveTimesMs.length)
          : undefined;

      void recordTrainingSession({
        module: 'puzzle-streak',
        mode: 'progressive',
        score: currentStreak,
        total: totalAttempted,
        accuracy: (currentStreak / totalAttempted) * 100,
        durationMs,
        bestMetric: currentStreak,
        metadata: {
          highestRatingSolved,
          highestTier: currentStage.tierLabel,
        },
        recordUpdates: {
          bestStreak: currentStreak,
          highestRating: highestRatingSolved > 0 ? highestRatingSolved : undefined,
          fastestAvgMs: avgSolveMs,
        },
      });
      return false;
    }

    // Correct user move
    chessRef.current = chess;
    setFen(chess.fen());
    setLastMove({ from: moveObj.from, to: moveObj.to });
    setHighlights({ [to]: 'correct' });
    soundEngine.playMove(settings.sound, Boolean(moveObj.captured));

    const nextStep = solutionStep + 1;
    const activeRunId = runIdRef.current;

    if (nextStep >= solutionMoves.length || chess.isCheckmate()) {
      const solveDuration = Date.now() - puzzleStartRef.current;
      const nextStreak = currentStreak + 1;
      setCurrentStreak(nextStreak);
      setHighestRatingSolved((h) => Math.max(h, puzzle.rating));
      setSolveTimesMs((prev) => [...prev, solveDuration]);
      setIsAdvancingPuzzle(true);
      soundEngine.playCorrect(settings.sound);

      const tid = window.setTimeout(() => {
        if (runIdRef.current !== activeRunId) return;
        void loadPuzzleIntoBoard(activeRunId, nextStreak);
      }, 480);
      timeoutsRef.current.push(tid);
      return true;
    }

    setIsOpponentThinking(true);
    const tid = window.setTimeout(() => {
      if (runIdRef.current !== activeRunId) return;
      const oppUci = parseUciMove(solutionMoves[nextStep]);
      const replyChess = new Chess(chess.fen());
      const oppMove = replyChess.move(oppUci);
      if (oppMove) {
        chessRef.current = replyChess;
        setFen(replyChess.fen());
        setLastMove({ from: oppMove.from, to: oppMove.to });
        setHighlights({});
        soundEngine.playMove(settings.sound, Boolean(oppMove.captured));
        setSolutionStep(nextStep + 1);
      }
      setIsOpponentThinking(false);
    }, 340);
    timeoutsRef.current.push(tid);

    return true;
  };

  const rec = records['puzzle-streak'];
  const recentStreaks = useMemo(
    () => sessions.filter((s) => s.module === 'puzzle-streak').slice(0, 6),
    [sessions]
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Board Column */}
        <div className="xl:col-span-7 flex flex-col items-center p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
          {/* Turn & Streak Banner */}
          <div className="w-full max-w-[560px] mb-3 px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-[#101B30] border border-slate-200 dark:border-[#263D5C] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Flame
                className={`w-5 h-5 ${
                  phase === 'playing' ? 'text-amber-400' : 'text-slate-400 dark:text-[#94A3B8]'
                }`}
              />
              <div>
                <div className="text-sm font-semibold text-slate-700 dark:text-[#CBD5E1]">
                  Current Streak
                </div>
                <div className="text-2xl sm:text-3xl font-bold font-mono-tabular text-slate-900 dark:text-[#F1F5F9]">
                  {currentStreak}
                </div>
              </div>
            </div>

            {phase === 'playing' && puzzle && (
              <div className="text-center">
                <div className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
                  {orientation === 'white' ? 'White to move' : 'Black to move'}
                </div>
                <div className="text-sm sm:text-[15px] font-mono-tabular font-semibold text-slate-700 dark:text-[#CBD5E1]">
                  Puzzle #{puzzle.puzzleId} · Rating {puzzle.rating}
                </div>
              </div>
            )}

            <div className="text-right">
              <div className="text-sm font-semibold text-slate-700 dark:text-[#CBD5E1]">Personal Best</div>
              <div className="text-2xl sm:text-3xl font-bold font-mono-tabular text-emerald-600 dark:text-[#39FF88]">
                {Math.max(currentStreak, rec?.bestStreak ?? 0)}
              </div>
            </div>
          </div>

          <div className="relative w-full flex justify-center">
            <Chessboard
              fen={fen}
              orientation={orientation}
              playerColor={orientation}
              allowPremoves={phase === 'playing' && Boolean(puzzle) && !errorMsg && !isAdvancingPuzzle}
              isOpponentTurn={isOpponentThinking}
              resetKey={puzzle?.puzzleId ?? 'streak-idle'}
              lastMove={lastMove}
              squareHighlights={highlights}
              onMove={handleMove}
              disabled={phase !== 'playing' || !puzzle || Boolean(errorMsg) || isAdvancingPuzzle}
            />

            {/* Simplified Central Setup Overlay: Only Start Streak button */}
            {phase === 'ready' && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#080F1E]/78 backdrop-blur-[2px] rounded-xl p-4">
                <div className="w-full max-w-sm bg-[#14233A] border border-[#263D5C] rounded-2xl p-6 text-center shadow-2xl space-y-5">
                  <div className="inline-flex p-3 rounded-full bg-[#39FF88]/15 text-[#39FF88]">
                    <Flame className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-[#F1F5F9]">Puzzle Streak</h2>
                    <p className="mt-1.5 font-body text-sm sm:text-base text-[#94A3B8]">
                      Start with easier tactics and climb through harder ratings with every puzzle solved.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={startStreak}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-[#39FF88] hover:bg-[#52FF99] text-[#080F1E] text-base sm:text-lg font-bold cursor-pointer transition-colors"
                  >
                    <Play className="w-4 h-4" />
                    Start Streak
                  </button>
                </div>
              </div>
            )}

            {/* Game Over Overlay Card (No difficulty options) */}
            {phase === 'gameover' && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#080F1E]/85 backdrop-blur-[2px] rounded-xl p-4">
                <div className="w-full max-w-sm bg-[#14233A] border border-[#263D5C] rounded-2xl p-6 text-center shadow-2xl space-y-4">
                  <div className="inline-flex p-3 rounded-full bg-rose-500/15 text-rose-400">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-[#F1F5F9]">Streak Ended</h3>
                    <p className="mt-1 font-body text-sm sm:text-base text-[#94A3B8]">
                      Reached {currentStage.tierLabel} level
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm font-mono-tabular">
                    <div className="p-3 rounded-xl bg-[#101B30] border border-[#263D5C]">
                      <div className="text-[#CBD5E1] font-semibold">Streak Achieved</div>
                      <div className="mt-1 text-2xl sm:text-3xl font-bold text-[#39FF88]">
                        {currentStreak}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#101B30] border border-[#263D5C]">
                      <div className="text-[#CBD5E1] font-semibold">Highest Rating</div>
                      <div className="mt-1 text-2xl sm:text-3xl font-bold text-[#F1F5F9]">
                        {highestRatingSolved || '—'}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={startStreak}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-[#39FF88] hover:bg-[#52FF99] text-[#080F1E] text-base font-bold cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Start Streak
                  </button>
                </div>
              </div>
            )}
          </div>

          {phase === 'playing' && (
            <div className="mt-2.5 w-full max-w-[560px] flex items-center justify-between gap-3">
              <span className="text-sm sm:text-base font-semibold text-slate-700 dark:text-[#CBD5E1]">
                Level: <span className="text-slate-900 dark:text-[#F1F5F9] font-bold">{currentStage.tierLabel}</span>
              </span>
              <button
                type="button"
                onClick={startStreak}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-[#263D5C] text-slate-700 dark:text-[#F1F5F9] hover:bg-slate-100 dark:hover:bg-[#101B30] text-sm sm:text-base font-semibold cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Restart Streak
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="mt-3 w-full max-w-[560px] p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs sm:text-sm text-rose-400 flex items-center justify-between gap-3">
              <span className="font-body">{errorMsg}</span>
              <button
                type="button"
                onClick={() => void loadPuzzleIntoBoard(runIdRef.current, currentStreak)}
                className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium cursor-pointer shrink-0"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Right Panel: Focused strictly on Puzzle Streak Statistics & Recent Streak Results */}
        <div className="xl:col-span-5 space-y-5">
          <div className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] space-y-4">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-[#F1F5F9]">
              Puzzle Streak Statistics
            </h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-slate-600 dark:text-[#94A3B8] font-semibold">Best Streak</div>
                <div className="mt-1 text-xl sm:text-2xl font-bold font-mono-tabular text-emerald-600 dark:text-[#39FF88]">
                  {rec?.bestStreak ?? 0}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-slate-600 dark:text-[#94A3B8] font-semibold">Total Solved</div>
                <div className="mt-1 text-xl sm:text-2xl font-bold font-mono-tabular text-slate-900 dark:text-[#F1F5F9]">
                  {rec?.totalCorrect ?? 0}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-slate-600 dark:text-[#94A3B8] font-semibold">Avg Solve Time</div>
                <div className="mt-1 text-xl sm:text-2xl font-bold font-mono-tabular text-slate-900 dark:text-[#F1F5F9]">
                  {rec?.fastestAvgMs ? formatDurationPrecise(rec.fastestAvgMs) : '—'}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-slate-600 dark:text-[#94A3B8] font-semibold">Highest Rating</div>
                <div className="mt-1 text-xl sm:text-2xl font-bold font-mono-tabular text-emerald-600 dark:text-[#39FF88]">
                  {rec?.highestRating ?? '—'}
                </div>
              </div>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] space-y-3">
            <h3 className="text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
              Recent Streak Results
            </h3>

            {recentStreaks.length === 0 ? (
              <p className="font-body text-sm sm:text-base text-slate-500 dark:text-[#94A3B8]">
                Complete a Puzzle Streak run to track your streak length and peak rating here.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-[#263D5C]/60">
                {recentStreaks.map((s) => {
                  const peak =
                    typeof s.metadata?.highestRatingSolved === 'number' &&
                    s.metadata.highestRatingSolved > 0
                      ? s.metadata.highestRatingSolved
                      : null;
                  return (
                    <div
                      key={s.id}
                      className="py-2.5 flex items-center justify-between gap-2 text-sm sm:text-[15px] font-mono-tabular"
                    >
                      <div className="min-w-0">
                        <span className="font-ui font-semibold text-slate-900 dark:text-[#F1F5F9]">
                          {formatStreakModeLabel(s.mode)}
                        </span>
                        {peak && (
                          <span className="ml-1.5 font-body text-xs text-slate-500 dark:text-[#94A3B8]">
                            · Peak {peak}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-bold text-emerald-600 dark:text-[#39FF88]">
                          {s.score} streak
                        </span>
                        <span className="hidden sm:inline text-slate-400 dark:text-[#94A3B8]">
                          {formatDurationPrecise(s.durationMs)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

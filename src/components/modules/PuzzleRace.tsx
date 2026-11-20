import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, PieceSymbol, Square } from 'chess.js';
import {
  Timer,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Trophy,
  Flag,
} from 'lucide-react';
import { Chessboard, SquareHighlightType } from '../chess/Chessboard';
import {
  formatDurationPrecise,
  moveToUci,
  parseUciMove,
  setupLichessPuzzle,
} from '../../lib/chessUtils';
import {
  MIN_PUZZLE_RATING,
  computePuzzleSignature,
  validateLichessPuzzle,
} from '../../lib/puzzleValidator';
import {
  PuzzleRaceTimeMinutes,
  RACE_PROGRESSION_STAGES,
  RACE_TIME_OPTIONS,
  RaceDifficultyTier,
  RaceProgressionStage,
  formatRaceModeLabel,
  getRaceProgressionStage,
} from '../../lib/puzzleRace';
import { getEffectiveUserKey, readBucketHistory, recordLastItem } from '../../lib/trainingHistory';
import { PuzzleFetchError, fetchNextPuzzle } from '../../services/dataService';
import { useApp } from '../../context/AppContext';
import { soundEngine } from '../../lib/sound';
import { LichessPuzzle } from '../../types/chess';

type RacePhase = 'setup' | 'playing' | 'finished';

interface RaceSummary {
  solvedCorrectly: number;
  totalAttempted: number;
  accuracyPct: number;
  highestTier: RaceDifficultyTier;
  highestRatingSolved: number;
  totalTimePlayedMs: number;
  timeLimitMinutes: PuzzleRaceTimeMinutes;
}

function formatCountdownMs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const PuzzleRace: React.FC = () => {
  const { authUser, anonymousId, settings, records, sessions, recordTrainingSession } = useApp();
  const effectiveUserKey = getEffectiveUserKey(authUser?.id, anonymousId);

  const [selectedMinutes, setSelectedMinutes] = useState<PuzzleRaceTimeMinutes>(3);
  const [phase, setPhase] = useState<RacePhase>('setup');
  const [remainingMs, setRemainingMs] = useState<number>(3 * 60 * 1000);

  const [puzzle, setPuzzle] = useState<LichessPuzzle | null>(null);
  const [fen, setFen] = useState<string>('8/8/8/8/8/8/8/8 w - - 0 1');
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [solutionMoves, setSolutionMoves] = useState<string[]>([]);
  const [solutionStep, setSolutionStep] = useState<number>(0);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [highlights, setHighlights] = useState<Partial<Record<Square, SquareHighlightType>>>({});
  const [isOpponentThinking, setIsOpponentThinking] = useState<boolean>(false);
  const [isAdvancingPuzzle, setIsAdvancingPuzzle] = useState<boolean>(false);
  const [isLoadingPuzzle, setIsLoadingPuzzle] = useState<boolean>(false);

  const [solvedCount, setSolvedCount] = useState<number>(0);
  const [attemptedCount, setAttemptedCount] = useState<number>(0);
  const [currentStage, setCurrentStage] = useState<RaceProgressionStage>(RACE_PROGRESSION_STAGES[0]);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<RaceSummary | null>(null);

  const chessRef = useRef<Chess>(new Chess());
  const phaseRef = useRef<RacePhase>('setup');
  const runIdRef = useRef<number>(0);
  const timeoutsRef = useRef<number[]>([]);
  const feedbackTimerRef = useRef<number | null>(null);

  // Authoritative synchronous race counters
  const raceStartMsRef = useRef<number>(0);
  const raceEndMsRef = useRef<number>(0);
  const selectedMinutesRef = useRef<PuzzleRaceTimeMinutes>(3);
  const solvedCountRef = useRef<number>(0);
  const attemptedCountRef = useRef<number>(0);
  const cleanSolvesRef = useRef<number>(0);
  const highestStageRef = useRef<RaceProgressionStage>(RACE_PROGRESSION_STAGES[0]);
  const highestRatingSolvedRef = useRef<number>(0);
  const raceSeenIdsRef = useRef<Set<string>>(new Set());
  const raceSeenSignaturesRef = useRef<Set<string>>(new Set());
  const raceSavedRef = useRef<boolean>(false);

  const clearScheduledTimeouts = useCallback(() => {
    for (const id of timeoutsRef.current) {
      window.clearTimeout(id);
    }
    timeoutsRef.current = [];
  }, []);

  const clearFeedbackTimer = useCallback(() => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
  }, []);

  const showTransientFeedback = useCallback(
    (next: { type: 'ok' | 'err'; text: string }, durationMs = 1100) => {
      clearFeedbackTimer();
      setFeedback(next);
      feedbackTimerRef.current = window.setTimeout(() => {
        setFeedback(null);
        feedbackTimerRef.current = null;
      }, durationMs);
    },
    [clearFeedbackTimer]
  );

  useEffect(() => {
    return () => {
      clearScheduledTimeouts();
      clearFeedbackTimer();
    };
  }, [clearScheduledTimeouts, clearFeedbackTimer]);

  const finishRace = useCallback(
    (endedByTimer: boolean) => {
      if (phaseRef.current !== 'playing' || raceSavedRef.current) return;
      raceSavedRef.current = true;
      phaseRef.current = 'finished';
      clearScheduledTimeouts();
      clearFeedbackTimer();

      const now = Date.now();
      const plannedDurationMs = selectedMinutesRef.current * 60 * 1000;
      const elapsedMs = endedByTimer
        ? plannedDurationMs
        : Math.min(plannedDurationMs, Math.max(1000, now - raceStartMsRef.current));

      const finalAttempted = attemptedCountRef.current;
      const finalSolved = solvedCountRef.current;
      const accuracyPct =
        finalAttempted > 0 ? Math.round((finalSolved / finalAttempted) * 100) : 0;

      const summary: RaceSummary = {
        solvedCorrectly: finalSolved,
        totalAttempted: finalAttempted,
        accuracyPct,
        highestTier: highestStageRef.current.tierLabel,
        highestRatingSolved: highestRatingSolvedRef.current,
        totalTimePlayedMs: elapsedMs,
        timeLimitMinutes: selectedMinutesRef.current,
      };

      setRemainingMs(endedByTimer ? 0 : Math.max(0, raceEndMsRef.current - now));
      setAttemptedCount(finalAttempted);
      setIsOpponentThinking(false);
      setIsAdvancingPuzzle(false);
      setIsLoadingPuzzle(false);
      setHighlights({});
      setFeedback(null);
      setPhase('finished');
      setLastResults(summary);
      soundEngine.playComplete(settings.sound);

      const modeKey = `${selectedMinutesRef.current}m`;
      const prevExtra = records['puzzle-race']?.extra ?? {};
      const bestForModeKey = `bestScore_${modeKey}`;
      const prevModeBest =
        typeof prevExtra[bestForModeKey] === 'number'
          ? (prevExtra[bestForModeKey] as number)
          : Number(prevExtra[bestForModeKey] ?? 0) || 0;
      const prevBestTierIdx =
        typeof prevExtra.highestTierIndex === 'number'
          ? (prevExtra.highestTierIndex as number)
          : Number(prevExtra.highestTierIndex ?? -1);

      const nextExtra: Record<string, number | string> = {
        [bestForModeKey]: Math.max(prevModeBest, finalSolved),
      };
      if (highestStageRef.current.tierIndex >= prevBestTierIdx) {
        nextExtra.highestTierIndex = highestStageRef.current.tierIndex;
        nextExtra.highestDifficultyReached = highestStageRef.current.tierLabel;
      }

      void recordTrainingSession({
        module: 'puzzle-race',
        mode: modeKey,
        score: finalSolved,
        total: finalAttempted,
        accuracy: accuracyPct,
        durationMs: elapsedMs,
        bestMetric: finalSolved,
        metadata: {
          timeLimitMinutes: selectedMinutesRef.current,
          highestTierReached: highestStageRef.current.tierLabel,
          highestRatingSolved: highestRatingSolvedRef.current,
        },
        recordUpdates: {
          bestStreak: finalSolved,
          highestRating:
            highestRatingSolvedRef.current > 0 ? highestRatingSolvedRef.current : undefined,
          extra: nextExtra,
        },
      });
    },
    [clearScheduledTimeouts, clearFeedbackTimer, records, recordTrainingSession, settings.sound]
  );

  // Authoritative drift-free countdown timer while playing (never pauses or resets between puzzles)
  useEffect(() => {
    if (phase !== 'playing') return;
    const interval = window.setInterval(() => {
      const rem = raceEndMsRef.current - Date.now();
      if (rem <= 0) {
        window.clearInterval(interval);
        finishRace(true);
      } else {
        setRemainingMs(rem);
      }
    }, 100);
    return () => window.clearInterval(interval);
  }, [phase, finishRace]);

  const loadNextPuzzle = useCallback(
    async (activeRunId: number) => {
      if (phaseRef.current !== 'playing' || Date.now() >= raceEndMsRef.current) {
        return;
      }

      clearScheduledTimeouts();
      setErrorMsg(null);
      setHighlights({});
      setIsAdvancingPuzzle(false);
      setIsOpponentThinking(true);
      setIsLoadingPuzzle(true);

      const stage = getRaceProgressionStage(cleanSolvesRef.current);
      setCurrentStage(stage);

      try {
        let validPuzzle: LichessPuzzle | null = null;
        const persistedLast = readBucketHistory('puzzle-race', effectiveUserKey, 'all').last;
        const attemptExcludes = new Set<string>([
          ...Array.from(raceSeenIdsRef.current),
          ...(persistedLast ? [persistedLast] : []),
        ]);

        // Stay strictly within current difficulty tier; widen only if this race exhausted every puzzle in that tier
        const searchWindows: Array<{ min: number; max: number }> = [
          { min: stage.minRating, max: stage.maxRating },
          {
            min: Math.max(MIN_PUZZLE_RATING, stage.minRating - 100),
            max: Math.min(3200, stage.maxRating + 120),
          },
          { min: MIN_PUZZLE_RATING, max: 3200 },
        ];

        for (const win of searchWindows) {
          if (validPuzzle) break;
          for (let attempt = 0; attempt < 5; attempt++) {
            if (runIdRef.current !== activeRunId || phaseRef.current !== 'playing') return;
            try {
              const candidate = await fetchNextPuzzle({
                minRating: win.min,
                maxRating: win.max,
                excludeIds: Array.from(attemptExcludes),
                anonId: effectiveUserKey,
                scope: 'puzzle-race',
              });
              if (runIdRef.current !== activeRunId || phaseRef.current !== 'playing') return;

              attemptExcludes.add(candidate.puzzleId);
              const sig = computePuzzleSignature(candidate.fen, candidate.moves);
              if (
                raceSeenIdsRef.current.has(candidate.puzzleId) ||
                raceSeenSignaturesRef.current.has(sig)
              ) {
                continue;
              }

              const validation = validateLichessPuzzle(candidate, {
                minRating: win.min,
                maxRating: win.max,
              });
              if (validation.valid) {
                validPuzzle = candidate;
                break;
              }
            } catch (err) {
              if (err instanceof PuzzleFetchError && err.status === 404) {
                break;
              }
              throw err;
            }
          }
        }

        if (!validPuzzle) {
          throw new Error('Could not find an unseen puzzle in the database.');
        }

        const initialChess = new Chess(validPuzzle.fen);
        const setup = setupLichessPuzzle(validPuzzle);

        raceSeenIdsRef.current.add(validPuzzle.puzzleId);
        raceSeenSignaturesRef.current.add(
          computePuzzleSignature(validPuzzle.fen, validPuzzle.moves)
        );
        recordLastItem('puzzle-race', effectiveUserKey, 'all', validPuzzle.puzzleId);

        setPuzzle(validPuzzle);
        setOrientation(setup.playerColor);
        setSolutionMoves(setup.solutionMoves);
        setSolutionStep(0);
        setIsLoadingPuzzle(false);

        setFen(initialChess.fen());
        setLastMove(null);

        const tid = window.setTimeout(() => {
          if (runIdRef.current !== activeRunId || phaseRef.current !== 'playing') return;
          if (Date.now() >= raceEndMsRef.current) {
            finishRace(true);
            return;
          }
          chessRef.current = setup.chess;
          setFen(setup.chess.fen());
          setLastMove({ from: setup.setupMove.from, to: setup.setupMove.to });
          soundEngine.playMove(settings.sound, Boolean(setup.setupMove.captured));
          setIsOpponentThinking(false);
        }, 160);
        timeoutsRef.current.push(tid);
      } catch (err) {
        if (runIdRef.current !== activeRunId || phaseRef.current !== 'playing') return;
        setIsOpponentThinking(false);
        setIsLoadingPuzzle(false);
        setErrorMsg(
          err instanceof PuzzleFetchError || err instanceof Error
            ? err.message
            : 'Failed to load puzzle from server.'
        );
      }
    },
    [effectiveUserKey, clearScheduledTimeouts, finishRace, settings.sound]
  );

  const startRace = (minutesOverride?: PuzzleRaceTimeMinutes) => {
    const chosenMinutes = minutesOverride ?? selectedMinutes;
    if (minutesOverride !== undefined) {
      setSelectedMinutes(minutesOverride);
    }

    clearScheduledTimeouts();
    clearFeedbackTimer();
    const nextRunId = ++runIdRef.current;
    const now = Date.now();
    const durationMs = chosenMinutes * 60 * 1000;

    selectedMinutesRef.current = chosenMinutes;
    raceStartMsRef.current = now;
    raceEndMsRef.current = now + durationMs;
    solvedCountRef.current = 0;
    attemptedCountRef.current = 0;
    cleanSolvesRef.current = 0;
    highestStageRef.current = RACE_PROGRESSION_STAGES[0];
    highestRatingSolvedRef.current = 0;
    raceSeenIdsRef.current = new Set();
    raceSeenSignaturesRef.current = new Set();
    raceSavedRef.current = false;
    phaseRef.current = 'playing';

    setSolvedCount(0);
    setAttemptedCount(0);
    setCurrentStage(RACE_PROGRESSION_STAGES[0]);
    setRemainingMs(durationMs);
    setLastResults(null);
    setFeedback(null);
    setErrorMsg(null);
    setHighlights({});
    setPhase('playing');

    void loadNextPuzzle(nextRunId);
  };

  const handleMove = (from: Square, to: Square, promotion?: PieceSymbol): boolean => {
    if (phaseRef.current !== 'playing' || isOpponentThinking || isAdvancingPuzzle || !puzzle) {
      return false;
    }
    if (Date.now() >= raceEndMsRef.current) {
      finishRace(true);
      return false;
    }

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

    const activeRunId = runIdRef.current;

    if (!isCorrect) {
      // Incorrect move: do NOT highlight any square or reveal solution; immediately skip to next puzzle at same difficulty
      const nextAttempted = attemptedCountRef.current + 1;
      attemptedCountRef.current = nextAttempted;
      setAttemptedCount(nextAttempted);
      setHighlights({});
      setIsAdvancingPuzzle(true);
      soundEngine.playIncorrect(settings.sound);
      showTransientFeedback(
        {
          type: 'err',
          text: `Incorrect — next puzzle (${currentStage.tierLabel})`,
        },
        1100
      );

      void loadNextPuzzle(activeRunId);
      return false;
    }

    // Correct move
    chessRef.current = chess;
    setFen(chess.fen());
    setLastMove({ from: moveObj.from, to: moveObj.to });
    setHighlights({ [to]: 'correct' });
    soundEngine.playMove(settings.sound, Boolean(moveObj.captured));

    const nextStep = solutionStep + 1;

    if (nextStep >= solutionMoves.length || chess.isCheckmate()) {
      const nextAttempted = attemptedCountRef.current + 1;
      attemptedCountRef.current = nextAttempted;
      setAttemptedCount(nextAttempted);

      const nextSolved = solvedCountRef.current + 1;
      solvedCountRef.current = nextSolved;
      cleanSolvesRef.current += 1;
      setSolvedCount(nextSolved);

      const nextStage = getRaceProgressionStage(cleanSolvesRef.current);
      if (currentStage.tierIndex >= highestStageRef.current.tierIndex) {
        highestStageRef.current = currentStage;
      }
      if (nextStage.tierIndex > highestStageRef.current.tierIndex) {
        highestStageRef.current = nextStage;
      }
      if (puzzle.rating > highestRatingSolvedRef.current) {
        highestRatingSolvedRef.current = puzzle.rating;
      }

      setIsAdvancingPuzzle(true);
      soundEngine.playCorrect(settings.sound);
      showTransientFeedback({ type: 'ok', text: 'Solved!' }, 800);

      const tid = window.setTimeout(() => {
        if (runIdRef.current !== activeRunId || phaseRef.current !== 'playing') return;
        if (Date.now() >= raceEndMsRef.current) {
          finishRace(true);
          return;
        }
        void loadNextPuzzle(activeRunId);
      }, 220);
      timeoutsRef.current.push(tid);
      return true;
    }

    // Multi-move puzzle: play opponent's forced reply
    setIsOpponentThinking(true);
    const tid = window.setTimeout(() => {
      if (runIdRef.current !== activeRunId || phaseRef.current !== 'playing') return;
      if (Date.now() >= raceEndMsRef.current) {
        finishRace(true);
        return;
      }
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
    }, 200);
    timeoutsRef.current.push(tid);

    return true;
  };

  const raceRecord = records['puzzle-race'];
  const recentRaces = useMemo(
    () => sessions.filter((s) => s.module === 'puzzle-race').slice(0, 6),
    [sessions]
  );

  const isLowTime = phase === 'playing' && remainingMs <= 15000;
  const isWarningTime = phase === 'playing' && remainingMs <= 30000 && remainingMs > 15000;
  const liveAccuracyPct =
    attemptedCount > 0 ? Math.round((solvedCount / attemptedCount) * 100) : 100;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Main Board / Race Arena */}
        <div className="xl:col-span-7 flex flex-col items-center p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
          {/* Top HUD Banner */}
          <div className="w-full max-w-[560px] mb-3 px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-[#101B30] border border-slate-200 dark:border-[#263D5C] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Timer
                className={`w-5 h-5 shrink-0 ${
                  isLowTime
                    ? 'text-rose-400 animate-pulse'
                    : isWarningTime
                    ? 'text-amber-400'
                    : phase === 'playing'
                    ? 'text-emerald-600 dark:text-[#39FF88]'
                    : 'text-slate-400 dark:text-[#94A3B8]'
                }`}
              />
              <div>
                <div className="text-sm font-semibold text-slate-700 dark:text-[#CBD5E1]">Time Left</div>
                <div
                  className={`text-2xl sm:text-3xl font-bold font-mono-tabular ${
                    isLowTime
                      ? 'text-rose-500 dark:text-rose-400'
                      : isWarningTime
                      ? 'text-amber-500 dark:text-amber-400'
                      : 'text-slate-900 dark:text-[#F1F5F9]'
                  }`}
                >
                  {phase === 'setup'
                    ? formatCountdownMs(selectedMinutes * 60 * 1000)
                    : formatCountdownMs(remainingMs)}
                </div>
              </div>
            </div>

            {phase === 'playing' && puzzle && (
              <div className="text-center min-w-0">
                <div className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
                  {orientation === 'white' ? 'White to move' : 'Black to move'}
                </div>
                <div className="text-sm sm:text-[15px] font-mono-tabular font-semibold text-emerald-700 dark:text-[#39FF88] truncate">
                  {currentStage.tierLabel} · Rating {puzzle.rating}
                </div>
              </div>
            )}

            <div className="text-right">
              <div className="text-sm font-semibold text-slate-700 dark:text-[#CBD5E1]">Score</div>
              <div className="text-2xl sm:text-3xl font-bold font-mono-tabular text-emerald-600 dark:text-[#39FF88]">
                {solvedCount}
                <span className="text-base font-semibold text-slate-500 dark:text-[#CBD5E1] ml-1">
                  /{attemptedCount}
                </span>
              </div>
            </div>
          </div>

          <div className="relative w-full flex justify-center">
            <Chessboard
              fen={fen}
              orientation={orientation}
              playerColor={orientation}
              allowPremoves={
                phase === 'playing' &&
                Boolean(puzzle) &&
                !errorMsg &&
                !isAdvancingPuzzle &&
                !isLoadingPuzzle
              }
              isOpponentTurn={isOpponentThinking}
              resetKey={puzzle?.puzzleId ?? 'race-idle'}
              lastMove={lastMove}
              squareHighlights={highlights}
              onMove={handleMove}
              disabled={
                phase !== 'playing' ||
                !puzzle ||
                Boolean(errorMsg) ||
                isAdvancingPuzzle ||
                isLoadingPuzzle
              }
            />

            {/* Central Setup Overlay (All Setup & Start Controls live here) */}
            {phase === 'setup' && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#080F1E]/78 backdrop-blur-[2px] rounded-xl p-4">
                <div className="w-full max-w-sm bg-[#14233A] border border-[#263D5C] rounded-2xl p-6 text-center shadow-2xl space-y-4">
                  <div className="inline-flex p-3 rounded-full bg-[#39FF88]/15 text-[#39FF88]">
                    <Timer className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-[#F1F5F9]">Ready to Race</h2>
                    <p className="mt-1.5 font-body text-sm sm:text-base text-[#94A3B8]">
                      Choose a race time limit. Solve puzzles cleanly to climb rating tiers; an incorrect move moves directly to the next puzzle at your current level.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {RACE_TIME_OPTIONS.map((opt) => (
                      <button
                        key={opt.minutes}
                        type="button"
                        onClick={() => {
                          setSelectedMinutes(opt.minutes);
                          setRemainingMs(opt.minutes * 60 * 1000);
                        }}
                        className={`py-2.5 px-2 rounded-xl border cursor-pointer transition-colors ${
                          selectedMinutes === opt.minutes
                            ? 'bg-[#39FF88]/15 border-[#39FF88] text-[#39FF88]'
                            : 'bg-[#101B30] border-[#263D5C] text-[#F1F5F9] hover:border-[#39FF88]/50'
                        }`}
                      >
                        <div className="text-sm sm:text-base font-bold">{opt.minutes} min</div>
                        <div className="font-body text-xs opacity-80 mt-0.5">
                          {opt.subtitle}
                        </div>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => startRace()}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-[#39FF88] hover:bg-[#52FF99] text-[#080F1E] text-base sm:text-lg font-bold cursor-pointer transition-colors"
                  >
                    <Play className="w-4 h-4" />
                    Start {selectedMinutes}-Minute Puzzle Race
                  </button>
                </div>
              </div>
            )}

            {/* End-of-Race Results Overlay */}
            {phase === 'finished' && lastResults && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#080F1E]/85 backdrop-blur-[2px] rounded-xl p-4">
                <div className="w-full max-w-md bg-[#14233A] border border-[#263D5C] rounded-2xl p-6 text-center shadow-2xl space-y-4">
                  <div className="inline-flex p-3 rounded-full bg-[#39FF88]/15 text-[#39FF88]">
                    <Trophy className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-[#F1F5F9]">Race Complete</h2>
                    <p className="mt-1 font-body text-xs sm:text-sm text-[#94A3B8]">
                      {lastResults.timeLimitMinutes}-Minute Puzzle Race
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs sm:text-sm font-mono-tabular text-left">
                    <div className="p-3 rounded-xl bg-[#101B30] border border-[#263D5C]">
                      <div className="text-[#CBD5E1] font-semibold">Solved Correctly</div>
                      <div className="mt-1 text-2xl font-bold text-[#39FF88]">
                        {lastResults.solvedCorrectly}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#101B30] border border-[#263D5C]">
                      <div className="text-[#CBD5E1] font-semibold">Attempted</div>
                      <div className="mt-1 text-2xl font-bold text-[#F1F5F9]">
                        {lastResults.totalAttempted}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#101B30] border border-[#263D5C]">
                      <div className="text-[#CBD5E1] font-semibold">Accuracy</div>
                      <div className="mt-1 text-lg sm:text-xl font-bold text-[#F1F5F9]">
                        {lastResults.accuracyPct}%
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#101B30] border border-[#263D5C]">
                      <div className="text-[#CBD5E1] font-semibold">Time Played</div>
                      <div className="mt-1 text-lg sm:text-xl font-bold text-[#F1F5F9]">
                        {formatCountdownMs(lastResults.totalTimePlayedMs)}
                      </div>
                    </div>
                    <div className="col-span-2 p-3 rounded-xl bg-[#101B30] border border-[#263D5C] flex items-center justify-between gap-2">
                      <span className="text-[#CBD5E1] font-semibold">Highest Level Reached</span>
                      <span className="text-sm sm:text-base font-bold text-[#39FF88]">
                        {lastResults.highestTier}
                        {lastResults.highestRatingSolved > 0
                          ? ` (${lastResults.highestRatingSolved})`
                          : ''}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {RACE_TIME_OPTIONS.map((opt) => (
                      <button
                        key={opt.minutes}
                        type="button"
                        onClick={() => setSelectedMinutes(opt.minutes)}
                        className={`py-2 px-2 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                          selectedMinutes === opt.minutes
                            ? 'bg-[#39FF88]/15 border-[#39FF88] text-[#39FF88]'
                            : 'bg-[#101B30] border-[#263D5C] text-[#F1F5F9] hover:border-[#39FF88]/50'
                        }`}
                      >
                        {opt.minutes} min
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => startRace()}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#39FF88] hover:bg-[#52FF99] text-[#080F1E] text-sm sm:text-base font-bold cursor-pointer transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Play Again ({selectedMinutes} min)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Active Race Quick Controls + Transient Feedback */}
          {phase === 'playing' && (
            <div className="mt-2.5 w-full max-w-[560px] flex flex-wrap items-center justify-between gap-3">
              <div className="min-h-[36px] flex items-center">
                {feedback ? (
                  <div
                    className={`px-3.5 py-2 rounded-xl border flex items-center gap-2 text-xs sm:text-sm font-semibold ${
                      feedback.type === 'ok'
                        ? 'bg-emerald-500/10 dark:bg-[#39FF88]/10 border-emerald-500/30 dark:border-[#39FF88]/40 text-emerald-700 dark:text-[#39FF88]'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    {feedback.type === 'ok' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 shrink-0" />
                    )}
                    <span>{feedback.text}</span>
                  </div>
                ) : (
                  <span className="text-xs sm:text-sm font-mono-tabular font-semibold text-slate-700 dark:text-[#CBD5E1]">
                    Live Accuracy: {attemptedCount > 0 ? `${liveAccuracyPct}%` : '—'}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => finishRace(false)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 text-sm sm:text-base font-semibold cursor-pointer"
                >
                  <Flag className="w-4 h-4" />
                  End Race
                </button>
                <button
                  type="button"
                  onClick={() => startRace()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-[#263D5C] text-slate-700 dark:text-[#F1F5F9] hover:bg-slate-100 dark:hover:bg-[#101B30] text-sm sm:text-base font-semibold cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  Restart
                </button>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="mt-3 w-full max-w-[560px] p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-400 flex items-center justify-between gap-3">
              <span className="font-body">{errorMsg}</span>
              <button
                type="button"
                onClick={() => void loadNextPuzzle(runIdRef.current)}
                className="px-3.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-semibold cursor-pointer shrink-0"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Right Panel: Focused strictly on Puzzle Race Stats & Recent Race Results */}
        <div className="xl:col-span-5 space-y-5">
          <div className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] space-y-4">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-[#F1F5F9]">
              Puzzle Race Stats
            </h2>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-slate-600 dark:text-[#94A3B8] font-semibold">Best Score</div>
                <div className="mt-1 text-xl sm:text-2xl font-bold font-mono-tabular text-emerald-600 dark:text-[#39FF88]">
                  {raceRecord?.bestStreak ?? 0}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-slate-600 dark:text-[#94A3B8] font-semibold">Races Completed</div>
                <div className="mt-1 text-xl sm:text-2xl font-bold font-mono-tabular text-slate-900 dark:text-[#F1F5F9]">
                  {raceRecord?.totalSessions ?? 0}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-slate-600 dark:text-[#94A3B8] font-semibold">Current Tier</div>
                <div className="mt-1 text-base sm:text-lg font-bold text-slate-900 dark:text-[#F1F5F9] truncate">
                  {phase === 'playing'
                    ? currentStage.tierLabel
                    : lastResults?.highestTier ??
                      (raceRecord?.extra?.highestDifficultyReached as string | undefined) ??
                      '—'}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-slate-600 dark:text-[#94A3B8] font-semibold">Highest Rating</div>
                <div className="mt-1 text-xl sm:text-2xl font-bold font-mono-tabular text-slate-900 dark:text-[#F1F5F9]">
                  {raceRecord?.highestRating ?? '—'}
                </div>
              </div>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] space-y-3">
            <h3 className="text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
              Recent Race Results
            </h3>

            {recentRaces.length === 0 ? (
              <p className="font-body text-sm sm:text-base text-slate-500 dark:text-[#94A3B8]">
                Complete a Puzzle Race to record your score, accuracy, and top tier here.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-[#263D5C]/60">
                {recentRaces.map((r) => {
                  const tier =
                    typeof r.metadata?.highestTierReached === 'string'
                      ? r.metadata.highestTierReached
                      : null;
                  return (
                    <div
                      key={r.id}
                      className="py-2.5 flex items-center justify-between gap-2 text-sm sm:text-[15px] font-mono-tabular"
                    >
                      <div className="min-w-0">
                        <span className="font-ui font-semibold text-slate-900 dark:text-[#F1F5F9]">
                          {formatRaceModeLabel(r.mode)}
                        </span>
                        {tier && (
                          <span className="ml-1.5 font-body text-xs text-slate-500 dark:text-[#94A3B8]">
                            · {tier}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-bold text-emerald-600 dark:text-[#39FF88]">
                          {r.score}/{r.total}
                        </span>
                        <span className="text-slate-500 dark:text-[#94A3B8]">
                          {Math.round(r.accuracy)}%
                        </span>
                        <span className="hidden sm:inline text-slate-400 dark:text-[#94A3B8]">
                          {formatDurationPrecise(r.durationMs)}
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

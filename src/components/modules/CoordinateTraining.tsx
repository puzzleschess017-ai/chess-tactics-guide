import React, { useEffect, useRef, useState } from 'react';
import { Square } from 'chess.js';
import { RotateCcw, Play, Square as StopIcon, EyeOff, Eye } from 'lucide-react';
import { Chessboard, SquareHighlightType } from '../chess/Chessboard';
import { FILES, RANKS, formatDurationPrecise } from '../../lib/chessUtils';
import { getEffectiveUserKey, pickNonRepeatingFromPool } from '../../lib/trainingHistory';
import { useApp } from '../../context/AppContext';
import { soundEngine } from '../../lib/sound';
import { BoardOrientation } from '../../types/chess';

type CoordMode = 'timed' | 'endless';

const TIMED_CHALLENGE_DURATION_MS = 30000;
const ALL_64_SQUARES: Square[] = FILES.flatMap((f) => RANKS.map((r) => `${f}${r}` as Square));

export const CoordinateTraining: React.FC = () => {
  const { authUser, anonymousId, settings, records, recordTrainingSession } = useApp();
  const effectiveUserKey = getEffectiveUserKey(authUser?.id, anonymousId);

  const [mode, setMode] = useState<CoordMode>('timed');
  const [orientationChoice, setOrientationChoice] = useState<BoardOrientation>('white');
  const [hideCoordinates, setHideCoordinates] = useState<boolean>(true);

  const [isRunning, setIsRunning] = useState(false);
  const [currentTarget, setCurrentTarget] = useState<Square | null>(null);
  const [highlights, setHighlights] = useState<Partial<Record<Square, SquareHighlightType>>>({});

  const [correctCount, setCorrectCount] = useState(0);
  const [incorrectCount, setIncorrectCount] = useState(0);
  const [responseTimes, setResponseTimes] = useState<number[]>([]);
  const [timeLeftMs, setTimeLeftMs] = useState(TIMED_CHALLENGE_DURATION_MS);
  const [sessionSummary, setSessionSummary] = useState<{
    correct: number;
    incorrect: number;
    accuracy: number;
    avgMs: number;
    durationMs: number;
  } | null>(null);

  const promptStartRef = useRef<number>(Date.now());
  const sessionStartRef = useRef<number>(Date.now());
  const correctCountRef = useRef<number>(0);
  const incorrectCountRef = useRef<number>(0);
  const responseTimesRef = useRef<number[]>([]);
  const highlightTimeoutRef = useRef<number | null>(null);

  correctCountRef.current = correctCount;
  incorrectCountRef.current = incorrectCount;
  responseTimesRef.current = responseTimes;

  const clearHighlightTimeout = () => {
    if (highlightTimeoutRef.current !== null) {
      window.clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearHighlightTimeout();
  }, []);

  const nextTarget = (prev?: Square | null): Square => {
    let sq = pickNonRepeatingFromPool(
      ALL_64_SQUARES,
      (item) => item,
      'coordinate',
      effectiveUserKey,
      orientationChoice
    );
    if (prev && sq === prev) {
      sq = pickNonRepeatingFromPool(
        ALL_64_SQUARES,
        (item) => item,
        'coordinate',
        effectiveUserKey,
        orientationChoice
      );
    }
    return sq;
  };

  const startSession = () => {
    clearHighlightTimeout();
    setCorrectCount(0);
    setIncorrectCount(0);
    setResponseTimes([]);
    correctCountRef.current = 0;
    incorrectCountRef.current = 0;
    responseTimesRef.current = [];
    setHighlights({});
    setSessionSummary(null);

    const now = Date.now();
    sessionStartRef.current = now;
    promptStartRef.current = now;
    setCurrentTarget(nextTarget(null));

    if (mode === 'timed') {
      setTimeLeftMs(TIMED_CHALLENGE_DURATION_MS);
    }

    setIsRunning(true);
  };

  const finishSession = async (
    finalCorrect = correctCountRef.current,
    finalIncorrect = incorrectCountRef.current,
    times = responseTimesRef.current
  ) => {
    clearHighlightTimeout();
    setIsRunning(false);
    setCurrentTarget(null);
    const total = finalCorrect + finalIncorrect;
    const accuracy = total > 0 ? (finalCorrect / total) * 100 : 0;
    const avgMs =
      times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    const durationMs = Date.now() - sessionStartRef.current;

    setSessionSummary({
      correct: finalCorrect,
      incorrect: finalIncorrect,
      accuracy,
      avgMs,
      durationMs,
    });

    if (total > 0) {
      soundEngine.playComplete(settings.sound);
      await recordTrainingSession({
        module: 'coordinate',
        mode,
        score: finalCorrect,
        total,
        accuracy,
        durationMs,
        bestMetric: avgMs || undefined,
        recordUpdates: {
          bestStreak: finalCorrect,
          fastestAvgMs: avgMs > 0 ? avgMs : undefined,
        },
      });
    }
  };

  const finishSessionRef = useRef(finishSession);
  finishSessionRef.current = finishSession;

  useEffect(() => {
    if (!isRunning || mode !== 'timed') return;
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - sessionStartRef.current;
      const remaining = TIMED_CHALLENGE_DURATION_MS - elapsed;
      if (remaining <= 0) {
        setTimeLeftMs(0);
        window.clearInterval(interval);
        void finishSessionRef.current();
      } else {
        setTimeLeftMs(remaining);
      }
    }, 100);
    return () => window.clearInterval(interval);
  }, [isRunning, mode]);

  const handleSquareClick = (square: Square) => {
    if (!isRunning || !currentTarget) return;

    const now = Date.now();
    const rt = now - promptStartRef.current;

    if (square === currentTarget) {
      soundEngine.playCorrect(settings.sound);
      const nextCorrect = correctCount + 1;
      const nextTimes = [...responseTimes, rt];
      setCorrectCount(nextCorrect);
      setResponseTimes(nextTimes);
      setHighlights({ [square]: 'correct' });
      clearHighlightTimeout();
      highlightTimeoutRef.current = window.setTimeout(() => setHighlights({}), 220);

      setCurrentTarget(nextTarget(currentTarget));
      promptStartRef.current = Date.now();
    } else {
      soundEngine.playIncorrect(settings.sound);
      setIncorrectCount((c) => c + 1);
      clearHighlightTimeout();
      setHighlights({});
    }
  };

  const totalAttempts = correctCount + incorrectCount;
  const liveAccuracy = totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : 100;
  const avgResponseMs =
    responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : 0;
  const coordRecord = records['coordinate'];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Chessboard Area */}
        <div className="xl:col-span-7 flex flex-col items-center p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
          {/* Target Banner */}
          <div className="w-full max-w-[560px] mb-3 flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-[#101B30] border border-slate-200 dark:border-[#263D5C]">
            <div>
              <div className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-[#CBD5E1]">
                {isRunning
                  ? `Find Square (${orientationChoice === 'white' ? 'White' : 'Black'} side)`
                  : `Ready · ${orientationChoice === 'white' ? 'White' : 'Black'} side`}
              </div>
              <div className="text-2xl sm:text-3xl font-bold font-mono-tabular text-slate-900 dark:text-[#F1F5F9]">
                {isRunning && currentTarget ? currentTarget : '—'}
              </div>
            </div>

            <div className="text-right">
              <div className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-[#CBD5E1]">
                Time Remaining
              </div>
              <div className="text-2xl sm:text-3xl font-bold font-mono-tabular text-emerald-600 dark:text-[#39FF88]">
                {mode === 'timed' ? formatDurationPrecise(timeLeftMs) : '∞'}
              </div>
            </div>
          </div>

          <Chessboard
            fen="8/8/8/8/8/8/8/8 w - - 0 1"
            orientation={orientationChoice}
            coordinates={hideCoordinates ? 'none' : settings.board.coordinates}
            squareHighlights={highlights}
            onSquareClick={handleSquareClick}
            disabled={!isRunning}
            bottomReservePx={96}
          />
        </div>

        {/* Controls & Live Telemetry */}
        <div className="xl:col-span-5 space-y-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] space-y-3">
            <h2 className="text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
              Session Configuration
            </h2>

            <div>
              <label className="block text-sm sm:text-[15px] font-semibold text-slate-600 dark:text-[#CBD5E1] mb-2">
                Training Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['timed', 'Timed Challenge'],
                    ['endless', 'Endless Practice'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    disabled={isRunning}
                    onClick={() => setMode(id)}
                    className={`px-3.5 py-3 rounded-xl text-sm sm:text-base font-semibold border transition-colors cursor-pointer disabled:opacity-50 ${
                      mode === id
                        ? 'bg-emerald-600/15 dark:bg-[#39FF88]/12 border-emerald-500/50 dark:border-[#39FF88]/60 text-emerald-700 dark:text-[#39FF88]'
                        : 'border-slate-200 dark:border-[#263D5C] text-slate-600 dark:text-[#F1F5F9] hover:bg-slate-50 dark:hover:bg-[#101B30]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm sm:text-[15px] font-semibold text-slate-600 dark:text-[#CBD5E1] mb-2">
                Board Orientation
              </label>
              <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#101B30] border border-slate-200/70 dark:border-[#263D5C]">
                {(['white', 'black'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setOrientationChoice(opt)}
                    className={`flex-1 py-2.5 rounded-lg text-sm sm:text-base font-semibold capitalize cursor-pointer transition-colors ${
                      orientationChoice === opt
                        ? 'bg-white dark:bg-[#14233A] text-slate-900 dark:text-[#39FF88] border border-slate-200 dark:border-[#39FF88]/50 shadow-sm'
                        : 'text-slate-500 dark:text-[#94A3B8] hover:text-slate-700 dark:hover:text-[#F1F5F9] border border-transparent'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              {!isRunning ? (
                <button
                  type="button"
                  onClick={startSession}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 dark:bg-[#39FF88] dark:hover:bg-[#52FF99] text-white dark:text-[#080F1E] text-base font-bold transition-colors cursor-pointer"
                >
                  <Play className="w-4 h-4" />
                  {sessionSummary ? 'Run Again' : 'Start Training'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void finishSession()}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-base font-bold transition-colors cursor-pointer"
                >
                  <StopIcon className="w-4 h-4" />
                  Finish &amp; Save Session
                </button>
              )}
              {sessionSummary && !isRunning && (
                <button
                  type="button"
                  onClick={startSession}
                  className="px-3.5 py-3 rounded-xl border border-slate-200 dark:border-[#263D5C] text-slate-600 dark:text-[#F1F5F9] hover:bg-slate-100 dark:hover:bg-[#101B30] cursor-pointer"
                  aria-label="Restart"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Live Stats */}
          <div className="p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F1F5F9] mb-3">
              Live Performance &amp; Records
            </h3>
            <div className="grid grid-cols-2 gap-2.5 text-sm">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-slate-600 dark:text-[#94A3B8] font-semibold">Correct / Wrong</div>
                <div className="mt-1 text-xl font-bold font-mono-tabular">
                  <span className="text-emerald-600 dark:text-[#39FF88]">{correctCount}</span>
                  <span className="text-slate-400 mx-1">/</span>
                  <span className="text-rose-500 dark:text-rose-400">{incorrectCount}</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-slate-600 dark:text-[#94A3B8] font-semibold">Accuracy</div>
                <div className="mt-1 text-xl font-bold font-mono-tabular text-slate-900 dark:text-[#F1F5F9]">
                  {totalAttempts > 0 ? `${liveAccuracy}%` : '—'}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-slate-600 dark:text-[#94A3B8] font-semibold">Avg Response</div>
                <div className="mt-1 text-xl font-bold font-mono-tabular text-slate-900 dark:text-[#F1F5F9]">
                  {avgResponseMs > 0 ? `${avgResponseMs}ms` : '—'}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-slate-600 dark:text-[#94A3B8] font-semibold">Personal Best</div>
                <div className="mt-1 text-xl font-bold font-mono-tabular text-emerald-600 dark:text-[#39FF88]">
                  {coordRecord?.bestStreak !== undefined
                    ? `${coordRecord.bestStreak} hits`
                    : '—'}
                </div>
              </div>
            </div>

            {coordRecord && (
              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-[#263D5C] flex items-center justify-between text-xs sm:text-sm text-slate-600 dark:text-[#94A3B8] font-mono-tabular">
                <span>Total attempts: {coordRecord.totalAttempts}</span>
                <span>
                  Fastest avg:{' '}
                  {coordRecord.fastestAvgMs ? `${Math.round(coordRecord.fastestAvgMs)}ms` : '—'}
                </span>
              </div>
            )}

            {sessionSummary && (
              <div className="mt-3 p-3 rounded-xl bg-emerald-500/10 dark:bg-[#39FF88]/10 border border-emerald-500/25 dark:border-[#39FF88]/40 text-sm">
                <div className="font-bold text-emerald-700 dark:text-[#39FF88]">
                  Session Saved
                </div>
                <div className="mt-1 text-slate-600 dark:text-[#F1F5F9] font-mono-tabular">
                  Score: {sessionSummary.correct}/{sessionSummary.correct + sessionSummary.incorrect} ·{' '}
                  {Math.round(sessionSummary.accuracy)}% · Avg {sessionSummary.avgMs}ms
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-start sm:justify-end">
        <button
          type="button"
          onClick={() => setHideCoordinates((v) => !v)}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-[#263D5C] bg-white dark:bg-[#14233A] text-sm font-semibold text-slate-700 dark:text-[#F1F5F9] hover:border-emerald-500/40 dark:hover:border-[#39FF88]/60 cursor-pointer whitespace-nowrap shrink-0"
        >
          {hideCoordinates ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {hideCoordinates ? 'Clean Mode: Labels Hidden' : 'Labels Visible'}
        </button>
      </div>
    </div>
  );
};

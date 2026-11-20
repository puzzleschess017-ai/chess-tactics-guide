import React, { useEffect, useRef, useState } from 'react';
import { Square } from 'chess.js';
import { Play, RotateCcw, Lightbulb, CheckCircle2, XCircle } from 'lucide-react';
import { Chessboard, SquareHighlightType } from '../chess/Chessboard';
import {
  FILES,
  RANKS,
  bfsShortestKnightPath,
  buildPiecePlacementFen,
  formatDurationPrecise,
  getKnightMovesFrom,
  getWarnsdorffNextSquare,
  isValidKnightMove,
} from '../../lib/chessUtils';
import { getEffectiveUserKey, pickNonRepeatingFromPool } from '../../lib/trainingHistory';
import { useApp } from '../../context/AppContext';
import { soundEngine } from '../../lib/sound';
import { DifficultyLevel } from '../../types/chess';

type KnightMode = 'destination' | 'shortest-path' | 'knight-tour' | 'visualization';

const ALL_64_SQUARES: Square[] = FILES.flatMap((f) => RANKS.map((r) => `${f}${r}` as Square));

function buildFenWithKnight(sq: Square, targetSq?: Square): string {
  const pieces: Array<{ square: Square; type: 'n' | 'p'; color: 'w' | 'b' }> = [
    { square: sq, type: 'n', color: 'w' },
  ];
  if (targetSq && targetSq !== sq) {
    pieces.push({ square: targetSq, type: 'p', color: 'b' });
  }
  return buildPiecePlacementFen(pieces);
}

export const KnightTraining: React.FC = () => {
  const { authUser, anonymousId, settings, records, recordTrainingSession } = useApp();
  const effectiveUserKey = getEffectiveUserKey(authUser?.id, anonymousId);

  const [mode, setMode] = useState<KnightMode>('destination');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(settings.general.defaultDifficulty);

  const [isRunning, setIsRunning] = useState(false);
  const [knightSquare, setKnightSquare] = useState<Square>('b1');
  const [targetSquare, setTargetSquare] = useState<Square | null>(null);
  const [foundDestinations, setFoundDestinations] = useState<Set<Square>>(new Set());
  const [requiredDestinations, setRequiredDestinations] = useState<Square[]>([]);

  // Shortest path state
  const [pathHistory, setPathHistory] = useState<Square[]>([]);
  const [optimalSteps, setOptimalSteps] = useState<number>(0);

  // Knight tour state
  const [tourVisited, setTourVisited] = useState<Square[]>([]);

  // Knight visualization state
  const [vizMoves, setVizMoves] = useState<string[]>([]);
  const [vizAnswer, setVizAnswer] = useState<Square | null>(null);
  const [hideVizKnight, setHideVizKnight] = useState(false);

  const [highlights, setHighlights] = useState<Partial<Record<Square, SquareHighlightType>>>({});
  const [markers, setMarkers] = useState<Partial<Record<Square, number>>>({});
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [score, setScore] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setElapsedMs(Date.now() - startRef.current), 100);
    return () => clearInterval(t);
  }, [isRunning]);

  const startExercise = () => {
    setFeedback(null);
    setHighlights({});
    setMarkers({});
    setMistakes(0);
    setScore(0);
    startRef.current = Date.now();
    setElapsedMs(0);
    setIsRunning(true);

    const bucketKey = `${mode}:${difficulty}`;

    if (mode === 'destination') {
      const sq = pickNonRepeatingFromPool(
        ALL_64_SQUARES,
        (s) => s,
        'knight',
        effectiveUserKey,
        bucketKey
      );
      const legal = getKnightMovesFrom(sq);
      setKnightSquare(sq);
      setTargetSquare(null);
      setRequiredDestinations(legal);
      setFoundDestinations(new Set());
      setHideVizKnight(false);
    } else if (mode === 'shortest-path') {
      const start = pickNonRepeatingFromPool(
        ALL_64_SQUARES,
        (s) => s,
        'knight',
        effectiveUserKey,
        bucketKey
      );
      const minDist = difficulty === 'easy' ? 2 : difficulty === 'medium' ? 3 : 4;
      const validTargets = ALL_64_SQUARES.filter(
        (s) => s !== start && bfsShortestKnightPath(start, s).length - 1 >= minDist
      );
      const candidatePool = validTargets.length > 0 ? validTargets : ALL_64_SQUARES.filter((s) => s !== start);
      const target = pickNonRepeatingFromPool(
        candidatePool,
        (s) => s,
        'knight-target',
        effectiveUserKey,
        bucketKey
      );
      const path = bfsShortestKnightPath(start, target);
      setKnightSquare(start);
      setTargetSquare(target);
      setPathHistory([start]);
      setOptimalSteps(path.length - 1);
      setHighlights({ [target]: 'target' });
      setHideVizKnight(false);
    } else if (mode === 'knight-tour') {
      const start = pickNonRepeatingFromPool(
        ALL_64_SQUARES,
        (s) => s,
        'knight',
        effectiveUserKey,
        bucketKey
      );
      setKnightSquare(start);
      setTargetSquare(null);
      setTourVisited([start]);
      setMarkers({ [start]: 1 });
      setHighlights({ [start]: 'visited' });
      setHideVizKnight(false);
    } else if (mode === 'visualization') {
      const steps = difficulty === 'easy' ? 2 : difficulty === 'medium' ? 3 : difficulty === 'hard' ? 4 : 5;
      let curr = pickNonRepeatingFromPool(
        ALL_64_SQUARES,
        (s) => s,
        'knight',
        effectiveUserKey,
        bucketKey
      );
      const startSq = curr;
      const moveNotations: string[] = [];
      let prev: Square | null = null;
      for (let i = 0; i < steps; i++) {
        const opts = getKnightMovesFrom(curr).filter((s) => s !== prev);
        const next = opts[Math.floor(Math.random() * opts.length)];
        moveNotations.push(`N${next}`);
        prev = curr;
        curr = next;
      }
      setKnightSquare(startSq);
      setVizMoves(moveNotations);
      setVizAnswer(curr);
      setHideVizKnight(false);
      setTargetSquare(null);
    }
  };

  const completeDrill = async (finalScore: number, totalAttempts: number, extraBestTime?: number) => {
    setIsRunning(false);
    const durationMs = Date.now() - startRef.current;
    const acc = totalAttempts > 0 ? (finalScore / totalAttempts) * 100 : 100;
    soundEngine.playComplete(settings.sound);
    await recordTrainingSession({
      module: 'knight',
      mode,
      score: finalScore,
      total: totalAttempts,
      accuracy: acc,
      durationMs,
      recordUpdates: {
        bestStreak: finalScore,
        bestTimeMs: extraBestTime,
      },
    });
  };

  const handleSquareClick = (sq: Square) => {
    if (!isRunning) return;

    if (mode === 'destination') {
      if (requiredDestinations.includes(sq)) {
        if (foundDestinations.has(sq)) return;
        const nextSet = new Set(foundDestinations);
        nextSet.add(sq);
        setFoundDestinations(nextSet);
        setHighlights((prev) => ({ ...prev, [sq]: 'correct' }));
        soundEngine.playCorrect(settings.sound);

        if (nextSet.size === requiredDestinations.length) {
          const total = requiredDestinations.length + mistakes;
          setScore(requiredDestinations.length);
          setFeedback({
            type: 'ok',
            text: `All ${requiredDestinations.length} destinations found in ${formatDurationPrecise(
              Date.now() - startRef.current
            )}!`,
          });
          void completeDrill(requiredDestinations.length, total, Date.now() - startRef.current);
        }
      } else if (sq !== knightSquare) {
        soundEngine.playIncorrect(settings.sound);
        setMistakes((m) => m + 1);
        setHighlights((prev) => ({ ...prev, [sq]: 'wrong' }));
        setTimeout(() => {
          setHighlights((prev) => {
            const copy = { ...prev };
            if (copy[sq] === 'wrong') delete copy[sq];
            return copy;
          });
        }, 350);
      }
      return;
    }

    if (mode === 'shortest-path' && targetSquare) {
      if (!isValidKnightMove(knightSquare, sq)) {
        soundEngine.playIncorrect(settings.sound);
        setMistakes((m) => m + 1);
        setFeedback({ type: 'err', text: `${knightSquare} → ${sq} is not a legal knight move.` });
        return;
      }

      const nextHistory = [...pathHistory, sq];
      const movesTaken = nextHistory.length - 1;
      setPathHistory(nextHistory);
      setKnightSquare(sq);
      soundEngine.playMove(settings.sound, sq === targetSquare);

      if (sq === targetSquare) {
        const isOptimal = movesTaken <= optimalSteps;
        setHighlights({ [sq]: 'correct' });
        setFeedback({
          type: isOptimal ? 'ok' : 'err',
          text: isOptimal
            ? `Optimal route found in ${movesTaken} move${movesTaken === 1 ? '' : 's'}!`
            : `Reached in ${movesTaken} moves (optimal shortest path is ${optimalSteps}).`,
        });
        setScore(isOptimal ? 1 : 0);
        void completeDrill(isOptimal ? 1 : 0, 1 + mistakes, isOptimal ? Date.now() - startRef.current : undefined);
      } else {
        setHighlights({ [targetSquare]: 'target', [sq]: 'visited' });
      }
      return;
    }

    if (mode === 'knight-tour') {
      if (tourVisited.includes(sq)) {
        soundEngine.playIncorrect(settings.sound);
        setMistakes((m) => m + 1);
        setFeedback({ type: 'err', text: `Square ${sq} was already visited.` });
        return;
      }
      if (!isValidKnightMove(knightSquare, sq)) {
        soundEngine.playIncorrect(settings.sound);
        setMistakes((m) => m + 1);
        setFeedback({ type: 'err', text: `Illegal knight move from ${knightSquare} to ${sq}.` });
        return;
      }

      const nextVisited = [...tourVisited, sq];
      setTourVisited(nextVisited);
      setKnightSquare(sq);
      soundEngine.playMove(settings.sound, false);
      setFeedback(null);

      const nextHighlights: Partial<Record<Square, SquareHighlightType>> = {};
      const nextMarkers: Partial<Record<Square, number>> = {};
      nextVisited.forEach((s, idx) => {
        nextHighlights[s] = 'visited';
        nextMarkers[s] = idx + 1;
      });
      setHighlights(nextHighlights);
      setMarkers(nextMarkers);

      if (nextVisited.length === 64) {
        setFeedback({
          type: 'ok',
          text: `Complete 64-square Knight's Tour finished in ${formatDurationPrecise(
            Date.now() - startRef.current
          )}!`,
        });
        void completeDrill(64, 64 + mistakes, Date.now() - startRef.current);
      }
      return;
    }

    if (mode === 'visualization' && vizAnswer) {
      if (sq === vizAnswer) {
        soundEngine.playCorrect(settings.sound);
        setHighlights({ [sq]: 'correct' });
        setKnightSquare(sq);
        setFeedback({ type: 'ok', text: `Correct! Final square is ${vizAnswer}.` });
        void completeDrill(1, 1 + mistakes, Date.now() - startRef.current);
      } else {
        soundEngine.playIncorrect(settings.sound);
        setMistakes((m) => m + 1);
        setHighlights({ [sq]: 'wrong', [vizAnswer]: 'correct' });
        setFeedback({
          type: 'err',
          text: `Incorrect — you clicked ${sq}, final square was ${vizAnswer}.`,
        });
        void completeDrill(0, 1 + mistakes);
      }
    }
  };

  const showWarnsdorffHint = () => {
    if (!isRunning || mode !== 'knight-tour') return;
    const hintSq = getWarnsdorffNextSquare(knightSquare, new Set(tourVisited));
    if (hintSq) {
      setHighlights((prev) => ({ ...prev, [hintSq]: 'hint' }));
    }
  };

  const boardFen =
    mode === 'shortest-path' && targetSquare
      ? buildFenWithKnight(knightSquare, targetSquare)
      : buildFenWithKnight(knightSquare);

  const rec = records['knight'];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <div className="xl:col-span-7 flex flex-col items-center p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
          {/* Instruction Header */}
          <div className="w-full max-w-[560px] mb-3 px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-[#101B30] border border-slate-200 dark:border-[#263D5C] flex items-center justify-between gap-4">
            <div className="font-ui text-sm sm:text-base font-bold text-slate-800 dark:text-[#F1F5F9]">
              {!isRunning && !feedback && 'Press Start Drill to begin.'}
              {isRunning && mode === 'destination' && (
                <span>
                  Click all <strong>{requiredDestinations.length}</strong> legal knight destinations from{' '}
                  <strong className="font-mono-tabular text-emerald-600 dark:text-[#39FF88]">{knightSquare}</strong> (
                  {foundDestinations.size}/{requiredDestinations.length})
                </span>
              )}
              {isRunning && mode === 'shortest-path' && targetSquare && (
                <span>
                  Move from <strong className="font-mono-tabular">{knightSquare}</strong> to{' '}
                  <strong className="font-mono-tabular text-sky-400">{targetSquare}</strong> in{' '}
                  <strong>{optimalSteps}</strong> moves (taken: {pathHistory.length - 1})
                </span>
              )}
              {isRunning && mode === 'knight-tour' && (
                <span>
                  Visited <strong className="font-mono-tabular text-emerald-600 dark:text-[#39FF88]">{tourVisited.length} / 64</strong>{' '}
                  squares · Current: <strong className="font-mono-tabular">{knightSquare}</strong>
                </span>
              )}
              {isRunning && mode === 'visualization' && (
                <div>
                  <div className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-[#CBD5E1]">
                    Starting from <strong className="font-mono-tabular text-slate-900 dark:text-[#F1F5F9]">{knightSquare}</strong>, follow:
                  </div>
                  <div className="mt-0.5 font-mono-tabular text-base sm:text-lg font-bold text-emerald-600 dark:text-[#39FF88]">
                    {vizMoves.join(' → ')}
                  </div>
                </div>
              )}
              {!isRunning && feedback && feedback.text}
            </div>

            <div className="text-right font-mono-tabular text-base sm:text-lg font-bold text-slate-900 dark:text-[#F1F5F9] shrink-0">
              {formatDurationPrecise(elapsedMs)}
            </div>
          </div>

          <Chessboard
            fen={boardFen}
            hidePieces={hideVizKnight}
            squareHighlights={highlights}
            customMarkers={markers}
            onSquareClick={handleSquareClick}
            disabled={!isRunning}
          />

          {feedback && (
            <div
              className={`mt-3 w-full max-w-[500px] p-3 rounded-xl border flex items-center justify-between gap-3 text-sm font-medium ${
                feedback.type === 'ok'
                  ? 'bg-emerald-500/10 dark:bg-[#39FF88]/10 border-emerald-500/30 dark:border-[#39FF88]/40 text-emerald-700 dark:text-[#39FF88]'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
              }`}
            >
              <span className="flex items-center gap-2">
                {feedback.type === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 shrink-0" />
                )}
                {feedback.text}
              </span>
              {!isRunning && (
                <button
                  type="button"
                  onClick={startExercise}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 dark:bg-[#39FF88] dark:hover:bg-[#52FF99] text-white dark:text-[#080F1E] text-xs sm:text-sm font-semibold cursor-pointer"
                >
                  Next
                </button>
              )}
            </div>
          )}
        </div>

        <div className="xl:col-span-5 space-y-3">
          <div className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
              Knight Mode Selection
            </h2>

            <div className="space-y-1.5">
              {(
                [
                  ['destination', 'A. Find the Destination', 'Identify every square reachable by the knight in 1 move.'],
                  ['shortest-path', 'B. Shortest Knight Path', 'Navigate to the target square in the minimum number of hops.'],
                  ['knight-tour', 'C. Knight Tour (64 Squares)', 'Visit every square on the board exactly once.'],
                  ['visualization', 'D. Knight Visualization', 'Calculate a sequence of knight hops mentally to the final square.'],
                ] as const
              ).map(([id, title, desc]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setMode(id);
                    setIsRunning(false);
                    setFeedback(null);
                    setHighlights({});
                    setMarkers({});
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
                  <div className="mt-0.5 font-body text-xs leading-snug text-slate-500 dark:text-[#94A3B8]">{desc}</div>
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 dark:text-[#CBD5E1] mb-1.5">
                Difficulty
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

            <div className="flex gap-2">
              <button
                type="button"
                onClick={startExercise}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 dark:bg-[#39FF88] dark:hover:bg-[#52FF99] text-white dark:text-[#080F1E] text-sm sm:text-base font-bold transition-colors cursor-pointer"
              >
                {isRunning ? <RotateCcw className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {isRunning ? 'Restart Drill' : 'Start Drill'}
              </button>
              {mode === 'knight-tour' && isRunning && (
                <button
                  type="button"
                  onClick={showWarnsdorffHint}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-amber-500/40 text-amber-500 hover:bg-amber-500/10 text-sm font-semibold cursor-pointer"
                >
                  <Lightbulb className="w-4 h-4" />
                  Hint
                </button>
              )}
            </div>
          </div>

          <div className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
            <h3 className="text-base font-bold text-slate-900 dark:text-[#F1F5F9] mb-2.5">
              Knight Records
            </h3>
            <div className="grid grid-cols-3 gap-2.5 text-sm">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-xs text-slate-600 dark:text-[#94A3B8] font-semibold">Mistakes</div>
                <div className="mt-1 text-lg sm:text-xl font-bold font-mono-tabular text-rose-500 dark:text-rose-400">
                  {mistakes}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-xs text-slate-600 dark:text-[#94A3B8] font-semibold">Sessions</div>
                <div className="mt-1 text-lg sm:text-xl font-bold font-mono-tabular text-slate-900 dark:text-[#F1F5F9]">
                  {rec?.totalSessions ?? 0}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                <div className="text-xs text-slate-600 dark:text-[#94A3B8] font-semibold">Best Time</div>
                <div className="mt-1 text-lg sm:text-xl font-bold font-mono-tabular text-emerald-600 dark:text-[#39FF88]">
                  {rec?.bestTimeMs ? formatDurationPrecise(rec.bestTimeMs) : '—'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

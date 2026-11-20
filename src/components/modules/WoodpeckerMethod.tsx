import React, { useEffect, useRef, useState } from 'react';
import { Chess, PieceSymbol, Square } from 'chess.js';
import {
  Repeat,
  Play,
  Pause,
  Plus,
  Trash2,
  Upload,
  CheckCircle2,
  TrendingUp,
  Eye,
  AlertCircle,
} from 'lucide-react';
import { Chessboard, SquareHighlightType } from '../chess/Chessboard';
import {
  formatDuration,
  formatDurationPrecise,
  moveToUci,
  parseUciMove,
  setupLichessPuzzle,
} from '../../lib/chessUtils';
import {
  PUZZLE_DIFFICULTY_RANGES,
  computePuzzleSignature,
  normalizePuzzleDifficulty,
  selectValidPuzzles,
  validateLichessPuzzle,
} from '../../lib/puzzleValidator';
import { markPuzzlesSeenApi, searchPuzzlesApi } from '../../services/dataService';
import { getEffectiveUserKey } from '../../lib/trainingHistory';
import { useApp } from '../../context/AppContext';
import { soundEngine } from '../../lib/sound';
import {
  LichessPuzzle,
  PuzzleCollection,
  PuzzleDifficulty,
  WoodpeckerCycle,
  WoodpeckerCycleLog,
} from '../../types/chess';

const RATING_BANDS: Record<PuzzleDifficulty, { min: number; max: number }> = {
  medium: PUZZLE_DIFFICULTY_RANGES.medium,
  hard: PUZZLE_DIFFICULTY_RANGES.hard,
  expert: PUZZLE_DIFFICULTY_RANGES.expert,
};

const WOODPECKER_PUZZLE_COUNTS = [10, 30, 50, 100, 200] as const;
type WoodpeckerPuzzleCount = (typeof WOODPECKER_PUZZLE_COUNTS)[number];

export const WoodpeckerMethod: React.FC = () => {
  const {
    authUser,
    anonymousId,
    settings,
    records,
    collections,
    woodpeckerCycles,
    saveCollection,
    saveWoodpeckerCycle,
    deleteWoodpeckerCycle,
    recordTrainingSession,
    updateModuleExtra,
  } = useApp();

  // Show intro screen only the first time a user opens Woodpecker Method (never resets saved cycles)
  const effectiveUserKey = getEffectiveUserKey(authUser?.id, anonymousId);
  const introStorageKey = `ctg_woodpecker_intro_seen:${effectiveUserKey}`;
  const [introDismissedLocally, setIntroDismissedLocally] = useState(false);

  const hasCompletedIntroInRecords =
    records['woodpecker']?.extra?.introCompleted === 1 ||
    records['woodpecker']?.extra?.introCompleted === '1';
  const hasCompletedIntroInStorage = (() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(introStorageKey) === '1';
    } catch {
      return false;
    }
  })();

  const showIntro =
    !introDismissedLocally && !hasCompletedIntroInRecords && !hasCompletedIntroInStorage;

  const handleCompleteIntro = () => {
    setIntroDismissedLocally(true);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(introStorageKey, '1');
      }
    } catch {
      // Ignore storage errors
    }
    void updateModuleExtra('woodpecker', (prev) => ({
      ...prev,
      introCompleted: 1,
    }));
  };

  // Creation form state
  const [showCreator, setShowCreator] = useState(false);
  const [cycleName, setCycleName] = useState('');
  const [cycleNameTouched, setCycleNameTouched] = useState(false);
  const [puzzleCount, setPuzzleCount] = useState<WoodpeckerPuzzleCount>(10);
  const [difficulty, setDifficulty] = useState<PuzzleDifficulty>(() =>
    normalizePuzzleDifficulty(settings.general.defaultDifficulty)
  );
  const [targetCycles, setTargetCycles] = useState(3);
  const [shuffleOrder, setShuffleOrder] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const trimmedCycleName = cycleName.trim();
  const isCycleNameValid = trimmedCycleName.length > 0;

  // Active cycle runner state (remember last viewed/played cycle per anonId)
  const selectionStorageKey = anonymousId ? `ctg_woodpecker_selected_${anonymousId}` : null;
  const [activeCycleId, setActiveCycleId] = useState<string | null>(null);

  const selectActiveCycle = (cycleId: string | null) => {
    setActiveCycleId(cycleId);
    if (!selectionStorageKey) return;
    try {
      if (cycleId) {
        localStorage.setItem(selectionStorageKey, cycleId);
      } else {
        localStorage.removeItem(selectionStorageKey);
      }
    } catch {
      // Ignore storage errors
    }
  };

  useEffect(() => {
    const validCycles = woodpeckerCycles.filter((c) =>
      collections.some((col) => col.id === c.collectionId && col.puzzles.length > 0)
    );
    if (validCycles.length === 0) {
      if (activeCycleId !== null) setActiveCycleId(null);
      return;
    }

    if (activeCycleId && validCycles.some((c) => c.id === activeCycleId)) {
      return;
    }

    let storedId: string | null = null;
    if (selectionStorageKey) {
      try {
        storedId = localStorage.getItem(selectionStorageKey);
      } catch {
        storedId = null;
      }
    }

    const storedMatch = storedId ? validCycles.find((c) => c.id === storedId) : undefined;
    // Default to the most recently updated cycle (woodpeckerCycles is sorted by updatedAt desc)
    const nextId = storedMatch ? storedMatch.id : validCycles[0].id;
    selectActiveCycle(nextId);
  }, [activeCycleId, woodpeckerCycles, collections, selectionStorageKey]);

  const activeCycle = woodpeckerCycles.find((c) => c.id === activeCycleId) ?? null;
  const activeCollection = activeCycle
    ? collections.find((c) => c.id === activeCycle.collectionId) ?? null
    : null;

  const [fen, setFen] = useState('8/8/8/8/8/8/8/8 w - - 0 1');
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [highlights, setHighlights] = useState<Partial<Record<Square, SquareHighlightType>>>({});
  const [solutionMoves, setSolutionMoves] = useState<string[]>([]);
  const [solutionStep, setSolutionStep] = useState(0);
  const [isWaitingOpponent, setIsWaitingOpponent] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [liveElapsedMs, setLiveElapsedMs] = useState(0);
  const [puzzleAttemptedWrong, setPuzzleAttemptedWrong] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'wrong' | 'solved'; text: string } | null>(null);

  const chessRef = useRef<Chess>(new Chess());
  const resumeTickRef = useRef<number>(Date.now());
  const timeoutsRef = useRef<number[]>([]);
  const advancingRef = useRef<boolean>(false);
  const showSolutionRef = useRef<boolean>(false);
  const activeCycleRef = useRef<WoodpeckerCycle | null>(activeCycle);
  const activeCollectionRef = useRef<PuzzleCollection | null>(activeCollection);

  showSolutionRef.current = showSolution;
  activeCycleRef.current = activeCycle;
  activeCollectionRef.current = activeCollection;

  const clearScheduledTimeouts = () => {
    for (const id of timeoutsRef.current) {
      window.clearTimeout(id);
    }
    timeoutsRef.current = [];
  };

  useEffect(() => {
    return () => clearScheduledTimeouts();
  }, []);

  const getCurrentPuzzle = (
    cyc: WoodpeckerCycle | null = activeCycle,
    col: PuzzleCollection | null = activeCollection
  ): LichessPuzzle | null => {
    if (!cyc || !col) return null;
    const pid = cyc.puzzleOrder[cyc.currentIndex];
    return col.puzzles.find((p) => p.puzzleId === pid) ?? col.puzzles[cyc.currentIndex] ?? null;
  };

  const advancePuzzleInCycle = async (
    wasCleanSolve: boolean,
    cycleOverride?: WoodpeckerCycle,
    collectionOverride?: PuzzleCollection
  ) => {
    if (advancingRef.current) return;
    const cyc = cycleOverride ?? activeCycleRef.current;
    const col = collectionOverride ?? activeCollectionRef.current;
    if (!cyc || !col) return;

    advancingRef.current = true;
    clearScheduledTimeouts();

    try {
      const totalInSet = cyc.puzzleOrder.length;
      const elapsedSoFar =
        cyc.status === 'active'
          ? cyc.activeElapsedMs + Math.max(0, Date.now() - resumeTickRef.current)
          : cyc.activeElapsedMs;
      const nextCorrect = cyc.activeCorrect + (wasCleanSolve ? 1 : 0);
      const nextIncorrect = cyc.activeIncorrect + (wasCleanSolve ? 0 : 1);
      const nextIndex = cyc.currentIndex + 1;
      const now = new Date().toISOString();

      if (nextIndex < totalInSet) {
        resumeTickRef.current = Date.now();
        await saveWoodpeckerCycle({
          ...cyc,
          currentIndex: nextIndex,
          activeElapsedMs: elapsedSoFar,
          activeCorrect: nextCorrect,
          activeIncorrect: nextIncorrect,
          updatedAt: now,
        });
        return;
      }

      // Cycle Completed!
      const cycleLog: WoodpeckerCycleLog = {
        cycleNumber: cyc.currentCycle,
        solvedCount: nextCorrect,
        incorrectCount: nextIncorrect,
        totalPuzzles: totalInSet,
        durationMs: elapsedSoFar,
        avgTimePerPuzzleMs: Math.round(elapsedSoFar / Math.max(1, totalInSet)),
        accuracy: Math.round((nextCorrect / Math.max(1, totalInSet)) * 100),
        completedAt: now,
      };

      soundEngine.playComplete(settings.sound);

      const isAllCyclesDone = cyc.currentCycle >= cyc.targetCycles;
      const validIds = selectValidPuzzles(col.puzzles, { minRating: 0 }).map((p) => p.puzzleId);
      let nextOrder = Array.from(
        new Set(validIds.length > 0 ? validIds : col.puzzles.map((p) => p.puzzleId))
      );
      if (!isAllCyclesDone && cyc.shuffle) {
        nextOrder = [...nextOrder];
        for (let i = nextOrder.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [nextOrder[i], nextOrder[j]] = [nextOrder[j], nextOrder[i]];
        }
      }

      resumeTickRef.current = Date.now();
      await saveWoodpeckerCycle({
        ...cyc,
        currentCycle: isAllCyclesDone ? cyc.currentCycle : cyc.currentCycle + 1,
        currentIndex: 0,
        status: isAllCyclesDone ? 'completed' : 'active',
        activeElapsedMs: 0,
        activeCorrect: 0,
        activeIncorrect: 0,
        cycleLogs: [...cyc.cycleLogs, cycleLog],
        puzzleOrder: nextOrder,
        updatedAt: now,
      });

      await recordTrainingSession({
        module: 'woodpecker',
        mode: `Cycle ${cyc.currentCycle}`,
        score: nextCorrect,
        total: totalInSet,
        accuracy: cycleLog.accuracy,
        durationMs: elapsedSoFar,
        bestMetric: cycleLog.avgTimePerPuzzleMs,
        metadata: { cycleName: cyc.name, cycleNumber: cyc.currentCycle },
        recordUpdates: {
          bestTimeMs: elapsedSoFar,
          fastestAvgMs: cycleLog.avgTimePerPuzzleMs,
        },
      });
    } finally {
      advancingRef.current = false;
    }
  };

  // Load current puzzle onto board whenever activeCycle index/status changes
  useEffect(() => {
    clearScheduledTimeouts();
    if (!activeCycle || !activeCollection) return;

    if (activeCycle.status !== 'active') {
      setLiveElapsedMs(activeCycle.activeElapsedMs);
      setIsWaitingOpponent(false);
      setIsAdvancing(false);
      return;
    }

    const p = getCurrentPuzzle(activeCycle, activeCollection);
    if (!p) return;

    setLiveElapsedMs(activeCycle.activeElapsedMs);
    resumeTickRef.current = Date.now();
    setPuzzleAttemptedWrong(false);
    setShowSolution(false);
    setIsAdvancing(false);
    setFeedback(null);
    setHighlights({});

    const validation = validateLichessPuzzle(p, { minRating: 0 });
    if (!validation.valid) {
      // Automatically skip corrupted/invalid puzzle in legacy saved cycles
      const tid = window.setTimeout(() => {
        void advancePuzzleInCycle(false, activeCycle, activeCollection);
      }, 50);
      timeoutsRef.current.push(tid);
      return () => clearScheduledTimeouts();
    }

    const preChess = new Chess(p.fen);
    const setup = setupLichessPuzzle(p);
    setOrientation(setup.playerColor);
    setSolutionMoves(setup.solutionMoves);
    setSolutionStep(0);
    setFen(preChess.fen());
    setLastMove(null);
    setIsWaitingOpponent(true);

    const expectedCycleId = activeCycle.id;
    const expectedIndex = activeCycle.currentIndex;
    const expectedCycleNum = activeCycle.currentCycle;

    const tid = window.setTimeout(() => {
      const latest = activeCycleRef.current;
      if (
        !latest ||
        latest.id !== expectedCycleId ||
        latest.currentIndex !== expectedIndex ||
        latest.currentCycle !== expectedCycleNum ||
        latest.status !== 'active'
      ) {
        return;
      }
      chessRef.current = setup.chess;
      setFen(setup.chess.fen());
      setLastMove({ from: setup.setupMove.from, to: setup.setupMove.to });
      soundEngine.playMove(settings.sound, Boolean(setup.setupMove.captured));
      setIsWaitingOpponent(false);
    }, 300);
    timeoutsRef.current.push(tid);

    return () => clearScheduledTimeouts();
  }, [activeCycle?.id, activeCycle?.currentCycle, activeCycle?.currentIndex, activeCycle?.status]);

  // Live timer while cycle is active
  useEffect(() => {
    if (!activeCycle || activeCycle.status !== 'active') return;
    resumeTickRef.current = Date.now();
    const interval = window.setInterval(() => {
      setLiveElapsedMs(activeCycle.activeElapsedMs + (Date.now() - resumeTickRef.current));
    }, 200);
    return () => window.clearInterval(interval);
  }, [activeCycle?.id, activeCycle?.status, activeCycle?.activeElapsedMs]);

  const handleCreateCycle = async (e: React.FormEvent) => {
    e.preventDefault();
    setCycleNameTouched(true);
    setCreateError(null);

    if (!trimmedCycleName) {
      setCreateError('Please enter a cycle name before creating a cycle.');
      return;
    }

    setIsCreating(true);

    try {
      const now = new Date().toISOString();
      const band = RATING_BANDS[difficulty];
      const usedKey = `usedIds_${difficulty}`;
      const rawUsed = records['woodpecker']?.extra?.[usedKey];
      const liveCycleCollectionIds = new Set(woodpeckerCycles.map((c) => c.collectionId));
      const activeDifficultyCollections = collections.filter(
        (c) => liveCycleCollectionIds.has(c.id) && c.difficulty === difficulty
      );
      const usedIds: string[] =
        typeof rawUsed === 'string' && rawUsed.trim().length > 0
          ? rawUsed.split(',').filter(Boolean)
          : Array.from(
              new Set(
                activeDifficultyCollections.flatMap((c) => c.puzzles.map((p) => p.puzzleId))
              )
            );
      const usedSignatures = new Set<string>(
        activeDifficultyCollections.flatMap((c) =>
          c.puzzles.map((p) => computePuzzleSignature(p.fen, p.moves))
        )
      );

      const res = await searchPuzzlesApi({
        minRating: band.min,
        maxRating: band.max,
        limit: puzzleCount,
        shuffle: true,
        excludeIds: usedIds,
        anonId: anonymousId,
        scope: 'woodpecker',
        preferUnseen: true,
        markSeen: false,
      });

      const unseenValid = selectValidPuzzles(res.puzzles, {
        minRating: band.min,
        maxRating: band.max,
        excludeIds: usedIds,
        excludeSignatures: usedSignatures,
        limit: puzzleCount,
        shuffle: true,
      });

      let validSet = [...unseenValid];
      let poolExhausted = Boolean(res.poolReset);

      if (validSet.length < puzzleCount) {
        poolExhausted = true;
        const alreadyChosenIds = validSet.map((p) => p.puzzleId);
        const alreadyChosenSignatures = validSet.map((p) => computePuzzleSignature(p.fen, p.moves));
        const remainingNeeded = puzzleCount - validSet.length;

        const resetRes = await searchPuzzlesApi({
          minRating: band.min,
          maxRating: band.max,
          limit: remainingNeeded,
          shuffle: true,
          excludeIds: alreadyChosenIds,
          anonId: anonymousId,
          scope: 'woodpecker',
          preferUnseen: false,
          markSeen: false,
        });

        const filler = selectValidPuzzles(resetRes.puzzles, {
          minRating: band.min,
          maxRating: band.max,
          excludeIds: alreadyChosenIds,
          excludeSignatures: alreadyChosenSignatures,
          limit: remainingNeeded,
          shuffle: true,
        });

        validSet = [...validSet, ...filler];
      }

      if (validSet.length === 0) {
        throw new Error('No verified puzzles found for the chosen difficulty.');
      }

      const chosenIds = Array.from(new Set(validSet.map((p) => p.puzzleId)));
      const nextUsedIds = poolExhausted
        ? chosenIds
        : Array.from(new Set([...usedIds, ...chosenIds]));

      await markPuzzlesSeenApi(anonymousId, validSet, ['global', 'woodpecker']);
      await updateModuleExtra('woodpecker', (prev) => ({
        ...prev,
        [usedKey]: nextUsedIds.join(','),
      }));

      const col: PuzzleCollection = {
        id: crypto.randomUUID(),
        name: `${trimmedCycleName} Set`,
        description: `${validSet.length} puzzles (${PUZZLE_DIFFICULTY_RANGES[difficulty].label})`,
        difficulty,
        puzzles: validSet,
        createdAt: now,
        updatedAt: now,
      };
      await saveCollection(col);

      const order = chosenIds;
      const newCycle: WoodpeckerCycle = {
        id: crypto.randomUUID(),
        collectionId: col.id,
        name: trimmedCycleName,
        targetCycles,
        currentCycle: 1,
        currentIndex: 0,
        shuffle: shuffleOrder,
        status: 'active',
        activeElapsedMs: 0,
        activeCorrect: 0,
        activeIncorrect: 0,
        cycleLogs: [],
        puzzleOrder: order,
        createdAt: now,
        updatedAt: now,
      };

      await saveWoodpeckerCycle(newCycle);
      selectActiveCycle(newCycle.id);
      setCycleName('');
      setCycleNameTouched(false);
      setShowCreator(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create Woodpecker cycle');
    } finally {
      setIsCreating(false);
    }
  };

  const handlePauseResume = async () => {
    if (!activeCycle) return;
    clearScheduledTimeouts();
    const now = new Date().toISOString();
    if (activeCycle.status === 'active') {
      const accumulated =
        activeCycle.activeElapsedMs + Math.max(0, Date.now() - resumeTickRef.current);
      setLiveElapsedMs(accumulated);
      await saveWoodpeckerCycle({
        ...activeCycle,
        status: 'paused',
        activeElapsedMs: accumulated,
        updatedAt: now,
      });
    } else if (activeCycle.status === 'paused') {
      resumeTickRef.current = Date.now();
      await saveWoodpeckerCycle({
        ...activeCycle,
        status: 'active',
        updatedAt: now,
      });
    }
  };

  const handleMove = (from: Square, to: Square, promotion?: PieceSymbol): boolean => {
    if (!activeCycle || activeCycle.status !== 'active' || isWaitingOpponent) return false;

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
      setPuzzleAttemptedWrong(true);
      setFeedback({
        type: 'wrong',
        text: 'Incorrect move — marked wrong for this cycle. Find the winning continuation or view the solution.',
      });
      setHighlights({ [from]: 'wrong', [to]: 'wrong' });
      const tid = window.setTimeout(() => {
        if (showSolutionRef.current && expectedUci) {
          const parsedHint = parseUciMove(expectedUci);
          setHighlights({ [parsedHint.from]: 'hint', [parsedHint.to]: 'hint' });
        } else {
          setHighlights({});
        }
      }, 450);
      timeoutsRef.current.push(tid);
      return false;
    }

    chessRef.current = chess;
    setFen(chess.fen());
    setLastMove({ from: moveObj.from, to: moveObj.to });
    setHighlights({ [to]: 'correct' });
    soundEngine.playMove(settings.sound, Boolean(moveObj.captured));

    const nextStep = solutionStep + 1;
    const cycleSnap = activeCycle;
    const colSnap = activeCollection ?? undefined;

    if (nextStep >= solutionMoves.length || chess.isCheckmate()) {
      soundEngine.playCorrect(settings.sound);
      setIsAdvancing(true);
      setFeedback({
        type: 'solved',
        text: puzzleAttemptedWrong ? 'Solved (with mistake)' : 'Clean solve!',
      });
      const tid = window.setTimeout(() => {
        void advancePuzzleInCycle(!puzzleAttemptedWrong, cycleSnap, colSnap);
      }, 360);
      timeoutsRef.current.push(tid);
      return true;
    }

    setIsWaitingOpponent(true);
    const tid = window.setTimeout(() => {
      const latest = activeCycleRef.current;
      if (
        !latest ||
        latest.id !== cycleSnap.id ||
        latest.currentIndex !== cycleSnap.currentIndex ||
        latest.status !== 'active'
      ) {
        return;
      }
      const reply = new Chess(chess.fen());
      const opp = reply.move(parseUciMove(solutionMoves[nextStep]));
      if (opp) {
        chessRef.current = reply;
        setFen(reply.fen());
        setLastMove({ from: opp.from, to: opp.to });
        const nextPlayerStep = nextStep + 1;
        if (showSolutionRef.current && solutionMoves[nextPlayerStep]) {
          const parsedHint = parseUciMove(solutionMoves[nextPlayerStep]);
          setHighlights({ [parsedHint.from]: 'hint', [parsedHint.to]: 'hint' });
        } else {
          setHighlights({});
        }
        soundEngine.playMove(settings.sound, Boolean(opp.captured));
        setSolutionStep(nextPlayerStep);
      }
      setIsWaitingOpponent(false);
    }, 300);
    timeoutsRef.current.push(tid);

    return true;
  };

  const currentPuzzle = getCurrentPuzzle();

  const computedSolutionLine = React.useMemo(() => {
    if (!currentPuzzle) return '';
    try {
      const setup = setupLichessPuzzle(currentPuzzle);
      const sim = new Chess(setup.chess.fen());
      const tokens: string[] = [];
      let moveNum = 1;
      setup.solutionMoves.forEach((uci, idx) => {
        const m = sim.move(parseUciMove(uci));
        if (!m) return;
        if (m.color === 'w') {
          tokens.push(`${moveNum}. ${m.san}`);
        } else {
          tokens.push(idx === 0 ? `${moveNum}... ${m.san}` : m.san);
          moveNum += 1;
        }
      });
      return tokens.join(' ');
    } catch {
      return '';
    }
  }, [currentPuzzle]);

  const handleShowSolution = () => {
    if (!puzzleAttemptedWrong || !activeCycle || activeCycle.status !== 'active') return;
    setShowSolution(true);
    const expectedUci = solutionMoves[solutionStep];
    if (expectedUci) {
      const parsed = parseUciMove(expectedUci);
      setHighlights({ [parsed.from]: 'hint', [parsed.to]: 'hint' });
    }
  };

  if (showIntro) {
    return (
      <div className="min-h-[calc(100vh-140px)] flex items-center justify-center px-2 py-4">
        <div className="w-full max-w-xl flex flex-col items-center text-center space-y-6">
          {/* Speech Bubble */}
          <div className="relative p-6 sm:p-8 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] shadow-xl">
            <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-emerald-500/12 dark:bg-[#39FF88]/12 text-emerald-600 dark:text-[#39FF88] mb-4">
              <Repeat className="w-5 h-5" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-[#F1F5F9] mb-3">
              Woodpecker Method
            </h1>
            <p className="font-body text-base sm:text-[17px] leading-relaxed text-slate-700 dark:text-[#CBD5E1]">
              The Woodenpecker Method is a chess training technique based on solving the same collection of puzzles repeatedly. By repeating puzzles over multiple cycles, you improve pattern recognition, calculation speed, and tactical awareness.
            </p>
            {/* Speech bubble pointer tail */}
            <div
              aria-hidden="true"
              className="absolute left-1/2 -bottom-2.5 -translate-x-1/2 w-5 h-5 rotate-45 bg-white dark:bg-[#14233A] border-r border-b border-slate-200 dark:border-[#263D5C]"
            />
          </div>

          <button
            type="button"
            onClick={handleCompleteIntro}
            className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 dark:bg-[#39FF88] dark:hover:bg-[#52FF99] text-white dark:text-[#080F1E] text-base sm:text-lg font-bold shadow-lg cursor-pointer transition-colors"
          >
            Let&apos;s Get Started
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setShowCreator((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 dark:bg-[#39FF88] dark:hover:bg-[#52FF99] text-white dark:text-[#080F1E] text-sm sm:text-base font-semibold cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          New Woodpecker Cycle
        </button>
      </div>

      {/* Creation Modal / Drawer */}
      {showCreator && (
        <form
          onSubmit={(e) => void handleCreateCycle(e)}
          className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-emerald-500/35 dark:border-[#39FF88]/45 space-y-4"
        >
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-[#F1F5F9]">
            Configure New Woodpecker Training Cycle
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm sm:text-[15px] font-semibold text-slate-600 dark:text-[#CBD5E1] mb-1.5">
                Cycle Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={cycleName}
                onChange={(e) => {
                  setCycleName(e.target.value);
                  if (createError && e.target.value.trim()) {
                    setCreateError(null);
                  }
                }}
                onBlur={() => setCycleNameTouched(true)}
                placeholder="Enter cycle name"
                required
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-200 dark:border-[#263D5C] text-base text-slate-900 dark:text-[#F1F5F9] placeholder:text-slate-400 dark:placeholder:text-[#94A3B8]/60 focus:outline-none focus:border-emerald-500 dark:focus:border-[#39FF88]"
              />
              {cycleNameTouched && !isCycleNameValid && (
                <p className="mt-1 text-sm text-rose-400">Cycle name is required.</p>
              )}
            </div>

            <div>
              <label className="block text-sm sm:text-[15px] font-semibold text-slate-600 dark:text-[#CBD5E1] mb-1.5">
                Target Cycles
              </label>
              <select
                value={targetCycles}
                onChange={(e) => setTargetCycles(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-200 dark:border-[#263D5C] text-base font-mono-tabular text-slate-900 dark:text-[#F1F5F9]"
              >
                {[2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm sm:text-[15px] font-semibold text-slate-600 dark:text-[#CBD5E1] mb-1.5">
                Number of Puzzles
              </label>
              <select
                value={puzzleCount}
                onChange={(e) => {
                  const val = Number(e.target.value) as WoodpeckerPuzzleCount;
                  if (WOODPECKER_PUZZLE_COUNTS.includes(val)) {
                    setPuzzleCount(val);
                  }
                }}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-200 dark:border-[#263D5C] text-base font-mono-tabular text-slate-900 dark:text-[#F1F5F9]"
              >
                {WOODPECKER_PUZZLE_COUNTS.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm sm:text-[15px] font-semibold text-slate-600 dark:text-[#CBD5E1] mb-1.5">
                Difficulty
              </label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as PuzzleDifficulty)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-200 dark:border-[#263D5C] text-base text-slate-900 dark:text-[#F1F5F9]"
              >
                {(Object.keys(PUZZLE_DIFFICULTY_RANGES) as PuzzleDifficulty[]).map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {PUZZLE_DIFFICULTY_RANGES[lvl].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-sm sm:text-[15px] text-slate-600 dark:text-[#94A3B8] cursor-pointer">
            <input
              type="checkbox"
              checked={shuffleOrder}
              onChange={(e) => setShuffleOrder(e.target.checked)}
              className="rounded border-slate-400 dark:border-[#263D5C] accent-[#39FF88]"
            />
            Shuffle puzzle order between cycles (default keeps exact same sequence)
          </label>

          {createError && <p className="text-sm text-rose-400">{createError}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreator(false)}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-[#263D5C] text-sm sm:text-base font-semibold text-slate-600 dark:text-[#F1F5F9] hover:bg-slate-50 dark:hover:bg-[#101B30] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreating || !isCycleNameValid}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 dark:bg-[#39FF88] dark:hover:bg-[#52FF99] text-white dark:text-[#080F1E] text-sm sm:text-base font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Upload className="w-4 h-4" />
              {isCreating ? 'Building Set...' : 'Create & Start Cycle 1'}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Active Cycle Board */}
        <div className="xl:col-span-7 flex flex-col items-center p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
          {activeCycle && activeCollection ? (
            <>
              <div className="w-full max-w-[560px] mb-3 px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-[#101B30] border border-slate-200 dark:border-[#263D5C] flex items-center justify-between gap-4">
                <div>
                  <div className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
                    {activeCycle.name} · Cycle {activeCycle.currentCycle}/{activeCycle.targetCycles}
                  </div>
                  <div className="mt-1 text-sm sm:text-[15px] font-semibold font-mono-tabular text-slate-700 dark:text-[#CBD5E1]">
                    Puzzle {Math.min(activeCycle.currentIndex + 1, activeCycle.puzzleOrder.length)} of{' '}
                    {activeCycle.puzzleOrder.length} ·{' '}
                    <span className="font-bold text-slate-900 dark:text-[#F1F5F9]">
                      {orientation === 'white' ? 'White to move' : 'Black to move'}
                    </span>{' '}
                    · {activeCycle.activeCorrect} clean / {activeCycle.activeIncorrect} missed
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono-tabular text-xl sm:text-2xl font-bold text-emerald-600 dark:text-[#39FF88]">
                    {formatDuration(liveElapsedMs)}
                  </span>
                  {activeCycle.status !== 'completed' && (
                    <button
                      type="button"
                      onClick={() => void handlePauseResume()}
                      className="p-2 rounded-lg bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] text-slate-700 dark:text-[#F1F5F9] hover:border-[#39FF88]/60 cursor-pointer"
                      aria-label={activeCycle.status === 'active' ? 'Pause cycle' : 'Resume cycle'}
                    >
                      {activeCycle.status === 'active' ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {activeCycle.status === 'completed' ? (
                <div className="w-full max-w-[500px] py-12 px-6 rounded-2xl bg-emerald-500/10 dark:bg-[#39FF88]/10 border border-emerald-500/25 dark:border-[#39FF88]/40 text-center space-y-3">
                  <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-[#39FF88] mx-auto" />
                  <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-[#F1F5F9]">
                    All {activeCycle.targetCycles} Woodpecker Cycles Completed!
                  </h3>
                  {activeCycle.cycleLogs.length >= 2 && (
                    <p className="text-sm font-semibold text-slate-700 dark:text-[#CBD5E1] font-mono-tabular">
                      Time improved from{' '}
                      {formatDuration(activeCycle.cycleLogs[0].durationMs)} (Cycle 1) to{' '}
                      {formatDuration(
                        activeCycle.cycleLogs[activeCycle.cycleLogs.length - 1].durationMs
                      )}{' '}
                      (Cycle {activeCycle.cycleLogs.length}).
                    </p>
                  )}
                </div>
              ) : (
                <div className="relative w-full flex justify-center">
                  <Chessboard
                    fen={fen}
                    orientation={orientation}
                    playerColor={orientation}
                    allowPremoves={activeCycle.status === 'active' && !isAdvancing}
                    isOpponentTurn={isWaitingOpponent}
                    resetKey={`${activeCycle.id}-${activeCycle.currentCycle}-${activeCycle.currentIndex}`}
                    lastMove={lastMove}
                    squareHighlights={highlights}
                    onMove={handleMove}
                    disabled={activeCycle.status !== 'active' || isAdvancing}
                  />
                  {activeCycle.status === 'paused' && (
                    <div className="absolute inset-0 z-20 bg-[#080F1E]/80 backdrop-blur-[2px] flex flex-col items-center justify-center rounded-xl gap-3">
                      <p className="text-sm font-bold text-[#F1F5F9]">Cycle Paused</p>
                      <button
                        type="button"
                        onClick={() => void handlePauseResume()}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#39FF88] hover:bg-[#52FF99] text-[#080F1E] text-sm font-semibold cursor-pointer"
                      >
                        <Play className="w-4 h-4" />
                        Resume Cycle
                      </button>
                    </div>
                  )}
                </div>
              )}

              {feedback && activeCycle.status !== 'completed' && (
                <div
                  className={`mt-3 w-full max-w-[560px] px-3.5 py-2.5 rounded-xl border font-body text-xs sm:text-sm font-medium flex items-center gap-2 ${
                    feedback.type === 'solved'
                      ? 'bg-emerald-500/10 dark:bg-[#39FF88]/10 border-emerald-500/30 dark:border-[#39FF88]/40 text-emerald-700 dark:text-[#39FF88]'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {feedback.type === 'solved' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{feedback.text}</span>
                </div>
              )}

              {showSolution &&
                puzzleAttemptedWrong &&
                computedSolutionLine &&
                activeCycle.status === 'active' && (
                  <div className="mt-3 w-full max-w-[560px] px-4 py-3 rounded-xl bg-slate-100 dark:bg-[#101B30] border border-emerald-500/35 dark:border-[#39FF88]/45 flex flex-col gap-1">
                    <div className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-[#39FF88]">
                      Verified Solution
                    </div>
                    <div className="font-mono-tabular text-sm sm:text-base font-bold text-slate-900 dark:text-[#F1F5F9]">
                      {computedSolutionLine}
                    </div>
                  </div>
                )}

              {currentPuzzle && activeCycle.status !== 'completed' && (
                <div className="mt-4 w-full max-w-[560px] flex flex-wrap items-center justify-between gap-2 text-sm sm:text-[15px] font-semibold text-slate-700 dark:text-[#CBD5E1]">
                  <span className="font-mono-tabular">
                    ID {currentPuzzle.puzzleId} · Rating {currentPuzzle.rating}
                  </span>
                  {puzzleAttemptedWrong &&
                    activeCycle.status === 'active' &&
                    !isAdvancing &&
                    !showSolution && (
                      <button
                        type="button"
                        onClick={handleShowSolution}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#101B30] border border-slate-300 dark:border-[#263D5C] hover:border-emerald-500 dark:hover:border-[#39FF88] text-slate-800 dark:text-[#F1F5F9] hover:text-emerald-700 dark:hover:text-[#39FF88] text-sm sm:text-base font-semibold transition-colors cursor-pointer"
                      >
                        <Eye className="w-4 h-4" />
                        Show Solution
                      </button>
                    )}
                </div>
              )}
            </>
          ) : (
            <div className="py-20 text-center max-w-md space-y-3">
              <Repeat className="w-10 h-10 text-emerald-600 dark:text-[#39FF88] mx-auto" />
              <h3 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-[#F1F5F9]">
                No Active Woodpecker Set Selected
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-[#94A3B8]">
                Create a new Woodpecker cycle or select an existing cycle on the right to continue training.
              </p>
              <button
                type="button"
                onClick={() => setShowCreator(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 dark:bg-[#39FF88] dark:hover:bg-[#52FF99] text-white dark:text-[#080F1E] text-sm font-semibold cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Create First Cycle
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Cycles List & Cycle Improvement Metrics */}
        <div className="xl:col-span-5 space-y-5">
          {activeCycle && activeCycle.cycleLogs.length > 0 && (
            <div className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
                  Cycle Speed &amp; Accuracy Comparison
                </h3>
                <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-[#39FF88]" />
              </div>

              <div className="divide-y divide-slate-100 dark:divide-[#263D5C]/60 text-sm sm:text-[15px] font-mono-tabular">
                {activeCycle.cycleLogs.map((log, idx) => {
                  const firstDuration = activeCycle.cycleLogs[0].durationMs;
                  const speedGain =
                    idx > 0 && firstDuration > 0
                      ? Math.round(((firstDuration - log.durationMs) / firstDuration) * 100)
                      : null;

                  return (
                    <div key={log.cycleNumber} className="py-2.5 flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800 dark:text-[#F1F5F9]">
                        Cycle {log.cycleNumber}
                      </span>
                      <span className="text-slate-600 dark:text-[#CBD5E1] font-medium">
                        {log.solvedCount}/{log.totalPuzzles} ({log.accuracy}%)
                      </span>
                      <span className="text-slate-800 dark:text-[#F1F5F9] font-medium">
                        {formatDuration(log.durationMs)} · avg {formatDurationPrecise(log.avgTimePerPuzzleMs)}
                      </span>
                      {speedGain !== null && (
                        <span className={speedGain >= 0 ? 'text-emerald-600 dark:text-[#39FF88]' : 'text-rose-400'}>
                          {speedGain >= 0 ? `-${speedGain}%` : `+${Math.abs(speedGain)}%`}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] space-y-3">
            <h3 className="text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
              Your Woodpecker Cycles
            </h3>
            {woodpeckerCycles.length === 0 ? (
              <p className="text-sm sm:text-base text-slate-500 dark:text-[#94A3B8]">
                No Woodpecker cycles created yet.
              </p>
            ) : (
              <div className="space-y-2">
                {woodpeckerCycles.map((cyc) => (
                  <div
                    key={cyc.id}
                    className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                      cyc.id === activeCycleId
                        ? 'bg-emerald-600/12 dark:bg-[#39FF88]/10 border-emerald-500/45 dark:border-[#39FF88]/60'
                        : 'border-slate-200 dark:border-[#263D5C] hover:bg-slate-50 dark:hover:bg-[#101B30]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => selectActiveCycle(cyc.id)}
                      className="text-left flex-1 cursor-pointer"
                    >
                      <div className="text-base font-bold text-slate-900 dark:text-[#F1F5F9]">
                        {cyc.name}
                      </div>
                      <div className="mt-0.5 text-sm font-semibold font-mono-tabular text-slate-600 dark:text-[#94A3B8]">
                        Cycle {cyc.currentCycle}/{cyc.targetCycles} · {cyc.puzzleOrder.length} puzzles ·{' '}
                        <span className="capitalize">{cyc.status}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (cyc.id === activeCycleId) {
                          selectActiveCycle(null);
                        }
                        void deleteWoodpeckerCycle(cyc.id);
                      }}
                      className="p-1.5 rounded-lg text-slate-400 dark:text-[#94A3B8] hover:text-rose-400 cursor-pointer"
                      aria-label={`Delete cycle ${cyc.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

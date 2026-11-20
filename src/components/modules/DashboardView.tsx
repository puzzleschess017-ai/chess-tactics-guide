import React, { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatDuration } from '../../lib/chessUtils';
import { formatRaceModeLabel } from '../../lib/puzzleRace';
import { TrainingModuleId } from '../../types/chess';
import { SimpleBarChart, SimpleLineChart } from '../charts/TrainingCharts';

type AnalyticsWindow = '7d' | '30d' | '90d';

const ACTIVE_MODULES: Array<{ id: TrainingModuleId; label: string }> = [
  { id: 'woodpecker', label: 'Woodpecker Method' },
  { id: 'puzzle-streak', label: 'Puzzle Streak' },
  { id: 'puzzle-race', label: 'Puzzle Race' },
  { id: 'tactical-themes', label: 'Tactical Themes' },
  { id: 'coordinate', label: 'Coordinate Training' },
  { id: 'blindfold', label: 'Blindfold Training' },
  { id: 'knight', label: 'Knight Training' },
];

const MODULE_NAME_MAP: Record<TrainingModuleId, string> = {
  woodpecker: 'Woodpecker Method',
  'puzzle-streak': 'Puzzle Streak',
  'puzzle-race': 'Puzzle Race',
  'tactical-themes': 'Tactical Themes',
  coordinate: 'Coordinate Training',
  blindfold: 'Blindfold Training',
  knight: 'Knight Training',
};

const PUZZLE_MODULES = new Set<TrainingModuleId>([
  'puzzle-streak',
  'puzzle-race',
  'woodpecker',
  'tactical-themes',
]);

function computeStreaks(sessionDates: string[]): { currentStreak: number; bestStreak: number } {
  if (sessionDates.length === 0) return { currentStreak: 0, bestStreak: 0 };
  const uniqueDays = Array.from(
    new Set(sessionDates.map((iso) => iso.slice(0, 10)))
  ).sort();

  const toDayNum = (yyyyMmDd: string) =>
    Math.floor(Date.parse(yyyyMmDd + 'T00:00:00Z') / 86400000);
  const dayNums = uniqueDays.map(toDayNum);

  let best = 1;
  let run = 1;
  for (let i = 1; i < dayNums.length; i++) {
    if (dayNums[i] === dayNums[i - 1] + 1) {
      run++;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }

  const todayNum = toDayNum(new Date().toISOString().slice(0, 10));
  const lastDayNum = dayNums[dayNums.length - 1];
  let current = 0;
  if (lastDayNum === todayNum || lastDayNum === todayNum - 1) {
    current = 1;
    for (let i = dayNums.length - 2; i >= 0; i--) {
      if (dayNums[i] === dayNums[i + 1] - 1) {
        current++;
      } else {
        break;
      }
    }
  }

  return { currentStreak: current, bestStreak: best };
}

function formatModeLabel(module: TrainingModuleId, mode: string): string {
  if (module === 'puzzle-streak') {
    if (mode === 'medium') return 'Beginner';
    if (mode === 'hard') return 'Advanced';
    if (mode === 'expert') return 'Expert';
  }
  if (module === 'puzzle-race') {
    return formatRaceModeLabel(mode);
  }
  return mode;
}

export const DashboardView: React.FC = () => {
  const { isAuthenticated, authUser, sessions, records, woodpeckerCycles, setCurrentNav } = useApp();
  const [analyticsWindow, setAnalyticsWindow] = useState<AnalyticsWindow>('7d');
  const greetingUsername = isAuthenticated
    ? authUser?.username || authUser?.email?.split('@')[0] || 'Player'
    : null;

  const validSessions = useMemo(
    () => sessions.filter((s) => s.module in MODULE_NAME_MAP),
    [sessions]
  );

  const currentTacticalElo = useMemo(() => {
    const raw = records['tactical-themes']?.extra?.eloRating;
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 1500;
  }, [records]);

  const summary = useMemo(() => {
    const totalPuzzlesSolved = validSessions
      .filter((s) => PUZZLE_MODULES.has(s.module))
      .reduce((acc, s) => acc + s.score, 0);

    const totalTrainingMs = validSessions.reduce((acc, s) => acc + s.durationMs, 0);

    const avgAccuracy =
      validSessions.length > 0
        ? Math.round(
            validSessions.reduce((acc, s) => acc + s.accuracy, 0) / validSessions.length
          )
        : 0;

    const { currentStreak, bestStreak } = computeStreaks(
      validSessions.map((s) => s.createdAt)
    );

    return {
      totalPuzzlesSolved,
      totalTrainingMs,
      avgAccuracy,
      currentStreak,
      bestStreak,
    };
  }, [validSessions]);

  // Analytics Series driven by selected 7d / 30d / 90d timeframe
  const activitySeries = useMemo(() => {
    if (analyticsWindow === '7d' || analyticsWindow === '30d') {
      const totalDays = analyticsWindow === '7d' ? 7 : 30;
      const days: Array<{ key: string; label: string; count: number; minutes: number }> = [];
      for (let i = totalDays - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const key = d.toISOString().slice(0, 10);
        const label =
          totalDays === 7
            ? d.toLocaleDateString(undefined, { weekday: 'short' })
            : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const daySessions = validSessions.filter((s) => s.createdAt.startsWith(key));
        const minutes = Math.round(
          daySessions.reduce((acc, s) => acc + s.durationMs, 0) / 60000
        );
        days.push({ key, label, count: daySessions.length, minutes });
      }
      return days;
    }

    // 90 days grouped cleanly into 13 weekly buckets (~7 days each)
    const buckets: Array<{ key: string; label: string; count: number; minutes: number }> = [];
    const msPerDay = 86400000;
    const now = Date.now();
    for (let w = 12; w >= 0; w--) {
      const endMs = now - w * 7 * msPerDay;
      const startMs = endMs - 6 * msPerDay;
      const startDate = new Date(startMs);
      const endDate = new Date(endMs);
      const startKey = startDate.toISOString().slice(0, 10);
      const endKey = endDate.toISOString().slice(0, 10);
      const label = startDate.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
      const weekSessions = validSessions.filter((s) => {
        const dayKey = s.createdAt.slice(0, 10);
        return dayKey >= startKey && dayKey <= endKey;
      });
      const minutes = Math.round(
        weekSessions.reduce((acc, s) => acc + s.durationMs, 0) / 60000
      );
      buckets.push({
        key: `${startKey}_${endKey}`,
        label,
        count: weekSessions.length,
        minutes,
      });
    }
    return buckets;
  }, [validSessions, analyticsWindow]);

  const cutoffIso = useMemo(() => {
    const days = analyticsWindow === '7d' ? 7 : analyticsWindow === '30d' ? 30 : 90;
    return new Date(Date.now() - days * 86400000).toISOString();
  }, [analyticsWindow]);

  const puzzleAccuracyTrend = useMemo(() => {
    return validSessions
      .filter(
        (s) => PUZZLE_MODULES.has(s.module) && s.createdAt >= cutoffIso
      )
      .slice(0, 20)
      .reverse()
      .map((s, idx) => ({
        label: `#${idx + 1}`,
        value: s.accuracy,
        secondaryLabel: MODULE_NAME_MAP[s.module],
      }));
  }, [validSessions, cutoffIso]);

  const woodpeckerTrend = useMemo(() => {
    const logs = woodpeckerCycles
      .flatMap((c) => c.cycleLogs)
      .filter((l) => !l.completedAt || l.completedAt >= cutoffIso);
    return logs.slice(-12).map((l) => ({
      label: `Cycle ${l.cycleNumber}`,
      value: Math.round(l.durationMs / 1000),
      secondaryLabel: `${Math.round(l.accuracy)}% accuracy`,
    }));
  }, [woodpeckerCycles, cutoffIso]);

  // Section C — Training Progress across the 6 active modules (real data only)
  const moduleProgressList = useMemo(() => {
    return ACTIVE_MODULES.map((mod) => {
      const rec = records[mod.id];
      const modSessions = validSessions.filter((s) => s.module === mod.id);
      const totalSessions = rec?.totalSessions ?? modSessions.length;
      const totalAttempts = rec?.totalAttempts ?? modSessions.reduce((a, s) => a + s.total, 0);
      const totalCorrect = rec?.totalCorrect ?? modSessions.reduce((a, s) => a + s.score, 0);
      const totalTimeMs =
        rec?.totalTimeMs ?? modSessions.reduce((a, s) => a + s.durationMs, 0);

      const hasData = totalSessions > 0 || totalAttempts > 0;
      const accuracyPct =
        totalAttempts > 0
          ? Math.min(100, Math.max(0, Math.round((totalCorrect / totalAttempts) * 100)))
          : modSessions.length > 0
          ? Math.min(
              100,
              Math.max(
                0,
                Math.round(
                  modSessions.reduce((a, s) => a + s.accuracy, 0) / modSessions.length
                )
              )
            )
          : 0;

      return {
        id: mod.id,
        label: mod.label,
        hasData,
        accuracyPct,
        totalSessions,
        totalAttempts,
        totalCorrect,
        totalTimeMs,
      };
    });
  }, [records, validSessions]);

  // Section D — Personal Records Summary
  const personalRecordsSummary = useMemo(() => {
    const highestPuzzleStreak = records['puzzle-streak']?.bestStreak ?? null;

    const tacticalRec = records['tactical-themes'];
    const tacticalPlayed =
      (tacticalRec?.totalAttempts ?? 0) > 0 ||
      validSessions.some((s) => s.module === 'tactical-themes');
    const highestTacticalRating = tacticalPlayed ? Math.max(1500, currentTacticalElo) : null;

    const puzzleBestAccuracies: number[] = [];
    (['woodpecker', 'puzzle-streak', 'puzzle-race', 'tactical-themes'] as TrainingModuleId[]).forEach(
      (id) => {
        const ba = records[id]?.bestAccuracy;
        if (ba !== undefined) puzzleBestAccuracies.push(ba);
      }
    );
    validSessions
      .filter((s) => PUZZLE_MODULES.has(s.module))
      .forEach((s) => puzzleBestAccuracies.push(s.accuracy));

    const bestPuzzleAccuracy =
      puzzleBestAccuracies.length > 0
        ? Math.round(Math.max(...puzzleBestAccuracies))
        : null;

    const longestSessionMs =
      validSessions.length > 0
        ? Math.max(...validSessions.map((s) => s.durationMs))
        : 0;

    return [
      {
        label: 'Highest Puzzle Streak',
        value: highestPuzzleStreak !== null ? `${highestPuzzleStreak}` : '—',
        accent: highestPuzzleStreak !== null && highestPuzzleStreak > 0,
      },
      {
        label: 'Highest Tactical Themes Rating',
        value: highestTacticalRating !== null ? `${highestTacticalRating}` : '—',
        accent: false,
      },
      {
        label: 'Best Puzzle Accuracy',
        value: bestPuzzleAccuracy !== null ? `${bestPuzzleAccuracy}%` : '—',
        accent: bestPuzzleAccuracy !== null && bestPuzzleAccuracy >= 80,
      },
      {
        label: 'Longest Training Session',
        value: longestSessionMs > 0 ? formatDuration(longestSessionMs) : '—',
        accent: false,
      },
      {
        label: 'Total Puzzles Solved',
        value: `${summary.totalPuzzlesSolved}`,
        accent: summary.totalPuzzlesSolved > 0,
      },
      {
        label: 'Total Training Time',
        value: formatDuration(summary.totalTrainingMs),
        accent: false,
      },
    ];
  }, [records, validSessions, currentTacticalElo, summary]);

  const recentSessions = validSessions.slice(0, 6);
  const windowLabel =
    analyticsWindow === '7d'
      ? 'Last 7 days'
      : analyticsWindow === '30d'
      ? 'Last 30 days'
      : 'Last 90 days';

  return (
    <div className="space-y-8">
      {greetingUsername && (
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-[#F1F5F9]">
          Hello, {greetingUsername}!
        </h1>
      )}

      {/* A. Training Overview (6 Core Metric Cards) */}
      <section aria-labelledby="training-overview-heading" className="space-y-3.5">
        <h2
          id="training-overview-heading"
          className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-[#F1F5F9]"
        >
          Training Overview
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
            <div className="font-ui text-sm font-semibold text-slate-600 dark:text-[#CBD5E1]">
              Puzzles Solved
            </div>
            <div className="mt-2.5 text-3xl sm:text-4xl font-bold font-mono-tabular tracking-tight text-slate-900 dark:text-[#F1F5F9]">
              {summary.totalPuzzlesSolved}
            </div>
            <div className="mt-1.5 font-body text-xs sm:text-[13px] text-slate-500 dark:text-[#94A3B8]">
              Across all puzzle modes
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
            <div className="font-ui text-sm font-semibold text-slate-600 dark:text-[#CBD5E1]">
              Total Training Time
            </div>
            <div className="mt-2.5 text-3xl sm:text-4xl font-bold font-mono-tabular tracking-tight text-slate-900 dark:text-[#F1F5F9]">
              {formatDuration(summary.totalTrainingMs)}
            </div>
            <div className="mt-1.5 font-body text-xs sm:text-[13px] text-slate-500 dark:text-[#94A3B8]">
              {validSessions.length} total session{validSessions.length === 1 ? '' : 's'}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
            <div className="font-ui text-sm font-semibold text-slate-600 dark:text-[#CBD5E1]">
              Current Daily Streak
            </div>
            <div className="mt-2.5 text-3xl sm:text-4xl font-bold font-mono-tabular tracking-tight text-emerald-600 dark:text-[#39FF88]">
              {summary.currentStreak}d
            </div>
            <div className="mt-1.5 font-body text-xs sm:text-[13px] text-slate-500 dark:text-[#94A3B8]">
              Best streak: {summary.bestStreak}d
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
            <div className="font-ui text-sm font-semibold text-slate-600 dark:text-[#CBD5E1]">
              Average Accuracy
            </div>
            <div className="mt-2.5 text-3xl sm:text-4xl font-bold font-mono-tabular tracking-tight text-slate-900 dark:text-[#F1F5F9]">
              {validSessions.length > 0 ? `${summary.avgAccuracy}%` : '—'}
            </div>
            <div className="mt-1.5 font-body text-xs sm:text-[13px] text-slate-500 dark:text-[#94A3B8]">
              {validSessions.length > 0 ? 'All training drills' : 'No sessions yet'}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
            <div className="font-ui text-sm font-semibold text-slate-600 dark:text-[#CBD5E1]">
              Best Puzzle Streak
            </div>
            <div className="mt-2.5 text-3xl sm:text-4xl font-bold font-mono-tabular tracking-tight text-emerald-600 dark:text-[#39FF88]">
              {records['puzzle-streak']?.bestStreak ?? 0}
            </div>
            <div className="mt-1.5 font-body text-xs sm:text-[13px] text-slate-500 dark:text-[#94A3B8]">
              Top puzzle: {records['puzzle-streak']?.highestRating ?? '—'}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
            <div className="font-ui text-sm font-semibold text-slate-600 dark:text-[#CBD5E1]">
              Current Tactical Themes Rating
            </div>
            <div className="mt-2.5 text-3xl sm:text-4xl font-bold font-mono-tabular tracking-tight text-emerald-600 dark:text-[#39FF88]">
              {currentTacticalElo}
            </div>
            <div className="mt-1.5 font-body text-xs sm:text-[13px] text-slate-500 dark:text-[#94A3B8]">
              {records['tactical-themes']?.totalAttempts
                ? `${records['tactical-themes'].totalAttempts} puzzles attempted`
                : 'Starting rating'}
            </div>
          </div>
        </div>
      </section>

      {/* B. Training Analytics (4 Charts with 7 / 30 / 90 day filters) */}
      <section aria-labelledby="training-analytics-heading" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2
              id="training-analytics-heading"
              className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-[#F1F5F9]"
            >
              Training Analytics
            </h2>
            <p className="font-body text-sm text-slate-500 dark:text-[#94A3B8]">
              Performance trends across {windowLabel.toLowerCase()}
            </p>
          </div>

          <div
            role="group"
            aria-label="Analytics timeframe"
            className="inline-flex items-center gap-1 p-1 rounded-xl bg-white dark:bg-[#101B30] border border-slate-200 dark:border-[#263D5C] self-start sm:self-auto"
          >
            {(
              [
                { id: '7d', label: '7 Days' },
                { id: '30d', label: '30 Days' },
                { id: '90d', label: '90 Days' },
              ] as const
            ).map((opt) => {
              const active = analyticsWindow === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAnalyticsWindow(opt.id)}
                  className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-emerald-600 dark:bg-[#39FF88] text-white dark:text-[#080F1E] font-bold'
                      : 'text-slate-600 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-[#F1F5F9]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
                Daily Training Activity
              </h3>
              <span className="text-xs sm:text-sm text-slate-500 dark:text-[#94A3B8]">
                {analyticsWindow === '90d'
                  ? 'Weekly sessions (90 days)'
                  : `${windowLabel} (sessions)`}
              </span>
            </div>
            <SimpleBarChart
              data={activitySeries.map((d) => ({ label: d.label, value: d.count }))}
              emptyText="Complete any drill or puzzle session to plot training activity."
            />
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
                Weekly Training Time
              </h3>
              <span className="text-xs sm:text-sm text-slate-500 dark:text-[#94A3B8]">
                {analyticsWindow === '90d'
                  ? 'Minutes per week'
                  : `Minutes per day (${windowLabel.toLowerCase()})`}
              </span>
            </div>
            <SimpleBarChart
              data={activitySeries.map((d) => ({ label: d.label, value: d.minutes }))}
              unit="m"
              barColor="#38BDF8"
              emptyText="Training duration across the selected period will appear here."
            />
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
                Puzzle-Solving Accuracy
              </h3>
              <span className="text-xs sm:text-sm text-slate-500 dark:text-[#94A3B8]">
                {windowLabel}
              </span>
            </div>
            <SimpleLineChart
              data={puzzleAccuracyTrend}
              emptyText="Solve puzzles in Woodpecker Method, Puzzle Streak, or Tactical Themes."
            />
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
                Woodpecker Progress
              </h3>
              <span className="text-xs sm:text-sm text-slate-500 dark:text-[#94A3B8]">
                Cycle duration (seconds)
              </span>
            </div>
            <SimpleBarChart
              data={woodpeckerTrend}
              unit="s"
              barColor="#F59E0B"
              emptyText="Complete Woodpecker cycles in this timeframe to compare solving speed."
            />
          </div>
        </div>
      </section>

      {/* C. Training Progress (6 Active Modules) */}
      <section aria-labelledby="training-progress-heading" className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2
              id="training-progress-heading"
              className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-[#F1F5F9]"
            >
              Training Progress
            </h2>
            <p className="font-body text-sm text-slate-500 dark:text-[#94A3B8]">
              Measured accuracy and logged volume across all 7 training disciplines
            </p>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
            {moduleProgressList.map((item) => (
              <div key={item.id} className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-ui text-[15px] sm:text-base font-bold text-slate-900 dark:text-[#F1F5F9]">
                      {item.label}
                    </span>
                    <span className="ml-2 text-xs sm:text-sm text-slate-500 dark:text-[#94A3B8] font-mono-tabular">
                      {item.hasData
                        ? `${item.totalSessions} session${
                            item.totalSessions === 1 ? '' : 's'
                          } · ${formatDuration(item.totalTimeMs)}`
                        : 'No sessions yet'}
                    </span>
                  </div>
                  <span
                    className={`text-base sm:text-lg font-bold font-mono-tabular shrink-0 ${
                      item.hasData
                        ? 'text-emerald-600 dark:text-[#39FF88]'
                        : 'text-slate-400 dark:text-[#94A3B8]'
                    }`}
                  >
                    {item.hasData ? `${item.accuracyPct}%` : '—'}
                  </span>
                </div>

                <div
                  role="progressbar"
                  aria-label={`${item.label} accuracy`}
                  aria-valuenow={item.hasData ? item.accuracyPct : 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-2 w-full rounded-full bg-slate-100 dark:bg-[#0B1426] overflow-hidden"
                >
                  <div
                    style={{ width: `${item.hasData ? item.accuracyPct : 0}%` }}
                    className="h-full rounded-full bg-emerald-500 dark:bg-[#39FF88] transition-all duration-300 ease-out"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* D. Personal Records and Recent Activity */}
      <section className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Personal Records */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
                Personal Records
              </h2>
              <button
                type="button"
                onClick={() => setCurrentNav('personal-records')}
                className="text-sm font-semibold text-emerald-600 dark:text-[#39FF88] hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                All records
              </button>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-[#263D5C]/60">
              {personalRecordsSummary.map((rec) => (
                <div
                  key={rec.label}
                  className="py-2.5 flex items-center justify-between gap-4 text-sm"
                >
                  <span className="font-ui text-slate-600 dark:text-[#CBD5E1] font-medium">
                    {rec.label}
                  </span>
                  <span
                    className={`text-base sm:text-lg font-bold font-mono-tabular shrink-0 ${
                      rec.accent
                        ? 'text-emerald-600 dark:text-[#39FF88]'
                        : 'text-slate-900 dark:text-[#F1F5F9]'
                    }`}
                  >
                    {rec.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-3 p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
              Recent Activity
            </h2>
            <button
              type="button"
              onClick={() => setCurrentNav('training-history')}
              className="text-sm font-semibold text-emerald-600 dark:text-[#39FF88] hover:underline cursor-pointer whitespace-nowrap shrink-0"
            >
              Training History
            </button>
          </div>

          {recentSessions.length === 0 ? (
            <div className="py-10 text-center border border-dashed border-slate-200 dark:border-[#263D5C] rounded-xl px-4">
              <p className="font-ui text-base font-semibold text-slate-600 dark:text-[#CBD5E1]">
                No training sessions recorded yet.
              </p>
              <p className="mt-1 font-body text-sm text-slate-400 dark:text-[#94A3B8]">
                Choose a puzzle or training module from the sidebar to log your first session.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-[#263D5C]/60">
              {recentSessions.map((s) => (
                <div
                  key={s.id}
                  className="py-3 flex items-center justify-between gap-4 text-sm sm:text-[15px]"
                >
                  <div className="min-w-0">
                    <div className="font-ui font-semibold text-slate-900 dark:text-[#F1F5F9] truncate">
                      {MODULE_NAME_MAP[s.module]}
                      <span className="text-slate-400 dark:text-[#94A3B8] mx-1.5">·</span>
                      <span className="font-body text-slate-500 dark:text-[#94A3B8] font-normal capitalize">
                        {formatModeLabel(s.module, s.mode)}
                      </span>
                    </div>
                    <div className="font-body text-xs sm:text-sm text-slate-500 dark:text-[#94A3B8]">
                      {new Date(s.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm font-mono-tabular shrink-0">
                    <span className="text-slate-700 dark:text-[#F1F5F9]">
                      {s.score}/{s.total}
                    </span>
                    <span
                      className={
                        s.accuracy >= 80
                          ? 'text-emerald-600 dark:text-[#39FF88] font-bold'
                          : s.accuracy >= 50
                          ? 'text-amber-400 font-bold'
                          : 'text-rose-400 font-bold'
                      }
                    >
                      {Math.round(s.accuracy)}%
                    </span>
                    <span className="text-slate-500 dark:text-[#94A3B8] flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {formatDuration(s.durationMs)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { BarChart3, History, Trophy, Clock } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatDuration, formatDurationPrecise } from '../../lib/chessUtils';
import { formatRaceModeLabel } from '../../lib/puzzleRace';
import { SimpleBarChart } from '../charts/TrainingCharts';
import { TrainingModuleId } from '../../types/chess';

const MODULE_LABELS: Record<TrainingModuleId, string> = {
  'puzzle-streak': 'Puzzle Streak',
  'puzzle-race': 'Puzzle Race',
  woodpecker: 'Woodpecker Method',
  'tactical-themes': 'Tactical Themes',
  coordinate: 'Coordinate Training',
  blindfold: 'Blindfold Training',
  knight: 'Knight Training',
};

export const StatisticsView: React.FC = () => {
  const { sessions, records, setCurrentNav } = useApp();

  const moduleBreakdown = useMemo(() => {
    return (Object.keys(MODULE_LABELS) as TrainingModuleId[]).map((mod) => {
      const rec = records[mod];
      const modSessions = sessions.filter((s) => s.module === mod);
      const avgAcc =
        rec && rec.totalAttempts > 0
          ? Math.round((rec.totalCorrect / rec.totalAttempts) * 100)
          : modSessions.length > 0
          ? Math.round(modSessions.reduce((a, b) => a + b.accuracy, 0) / modSessions.length)
          : 0;
      return {
        module: mod,
        label: MODULE_LABELS[mod],
        sessions: rec?.totalSessions ?? 0,
        attempts: rec?.totalAttempts ?? 0,
        correct: rec?.totalCorrect ?? 0,
        accuracy: avgAcc,
        timeMs: rec?.totalTimeMs ?? 0,
      };
    });
  }, [records, sessions]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-[#F1F5F9]">
          Statistics
        </h1>
        <p className="mt-2 font-body text-sm sm:text-base text-slate-500 dark:text-[#94A3B8]">
          Detailed performance breakdown across every training discipline.
        </p>
      </div>

      <div className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C]">
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-[#F1F5F9]">
            Sessions by Training Module
          </h2>
          <BarChart3 className="w-4 h-4 text-slate-400 dark:text-[#94A3B8]" />
        </div>
        <SimpleBarChart
          data={moduleBreakdown.map((m) => ({
            label: m.label.split(' ')[0],
            value: m.sessions,
          }))}
          emptyText="No training sessions logged yet. Start any training module to generate real statistics."
        />
      </div>

      <div className="rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm sm:text-[15px]">
            <thead className="border-b border-slate-200 dark:border-[#263D5C] text-slate-600 dark:text-[#CBD5E1] bg-slate-50 dark:bg-[#101B30]">
              <tr>
                <th className="py-3.5 px-4 font-semibold">Module</th>
                <th className="py-3.5 px-4 font-semibold text-right">Sessions</th>
                <th className="py-3.5 px-4 font-semibold text-right">Correct / Total</th>
                <th className="py-3.5 px-4 font-semibold text-right">Accuracy</th>
                <th className="py-3.5 px-4 font-semibold text-right">Time Spent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#263D5C]/60 font-mono-tabular">
              {moduleBreakdown.map((row) => (
                <tr
                  key={row.module}
                  onClick={() => setCurrentNav(row.module)}
                  className="hover:bg-slate-50 dark:hover:bg-[#101B30] cursor-pointer transition-colors"
                >
                  <td className="py-3.5 px-4 font-ui font-medium text-slate-900 dark:text-[#F1F5F9]">
                    {row.label}
                  </td>
                  <td className="py-3.5 px-4 text-right text-slate-600 dark:text-[#F1F5F9]">
                    {row.sessions}
                  </td>
                  <td className="py-3.5 px-4 text-right text-slate-600 dark:text-[#F1F5F9]">
                    {row.correct} / {row.attempts}
                  </td>
                  <td className="py-3.5 px-4 text-right text-emerald-600 dark:text-[#39FF88] font-semibold">
                    {row.attempts > 0 ? `${row.accuracy}%` : '—'}
                  </td>
                  <td className="py-3.5 px-4 text-right text-slate-500 dark:text-[#94A3B8]">
                    {formatDuration(row.timeMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const TrainingHistoryView: React.FC = () => {
  const { sessions } = useApp();
  const [moduleFilter, setModuleFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    const valid = sessions.filter((s) => s.module in MODULE_LABELS);
    if (moduleFilter === 'all') return valid;
    return valid.filter((s) => s.module === moduleFilter);
  }, [sessions, moduleFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-[#F1F5F9]">
            Training History
          </h1>
          <p className="mt-2 font-body text-sm sm:text-base text-slate-500 dark:text-[#94A3B8]">
            Chronological log of all completed training runs and puzzle sessions.
          </p>
        </div>

        <select
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          className="px-4 py-2.5 rounded-xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] text-sm sm:text-base font-semibold text-slate-700 dark:text-[#F1F5F9]"
        >
          <option value="all">All Modules</option>
          {(Object.keys(MODULE_LABELS) as TrainingModuleId[]).map((id) => (
            <option key={id} value={id}>
              {MODULE_LABELS[id]}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="p-12 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] text-center space-y-2.5">
          <History className="w-8 h-8 text-slate-400 dark:text-[#94A3B8] mx-auto" />
          <p className="font-ui text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
            No Sessions Recorded
          </p>
          <p className="font-body text-sm sm:text-base text-slate-500 dark:text-[#94A3B8]">
            Completed exercises and puzzle streaks will be logged here automatically.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] overflow-hidden">
          <div className="divide-y divide-slate-100 dark:divide-[#263D5C]/60">
            {filtered.map((s) => (
              <div
                key={s.id}
                className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm sm:text-[15px]"
              >
                <div>
                  <div className="font-ui font-bold text-base text-slate-900 dark:text-[#F1F5F9]">
                    {MODULE_LABELS[s.module]} ·{' '}
                    <span className="font-body font-normal text-slate-500 dark:text-[#94A3B8] capitalize">
                      {s.module === 'puzzle-streak'
                        ? s.mode === 'medium'
                          ? 'Beginner'
                          : s.mode === 'hard'
                          ? 'Advanced'
                          : s.mode === 'expert'
                          ? 'Expert'
                          : s.mode
                        : s.module === 'puzzle-race'
                        ? formatRaceModeLabel(s.mode)
                        : s.mode}
                    </span>
                  </div>
                  <div className="mt-1 font-body text-xs sm:text-sm text-slate-500 dark:text-[#94A3B8]">
                    {new Date(s.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-5 font-mono-tabular">
                  <span className="text-slate-700 dark:text-[#F1F5F9]">
                    Score {s.score}/{s.total}
                  </span>
                  <span
                    className={
                      s.accuracy >= 80
                        ? 'text-emerald-600 dark:text-[#39FF88] font-semibold'
                        : s.accuracy >= 50
                        ? 'text-amber-400'
                        : 'text-rose-400'
                    }
                  >
                    {Math.round(s.accuracy)}%
                  </span>
                  <span className="text-slate-500 dark:text-[#94A3B8] flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    {formatDurationPrecise(s.durationMs)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const PersonalRecordsView: React.FC = () => {
  const { records } = useApp();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-[#F1F5F9]">
          Personal Records
        </h1>
        <p className="mt-2 font-body text-sm sm:text-base text-slate-500 dark:text-[#94A3B8]">
          Your verified all-time bests across every training discipline.
        </p>
      </div>

      {Object.keys(records).length === 0 ? (
        <div className="p-12 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] text-center space-y-2.5">
          <Trophy className="w-8 h-8 text-slate-400 dark:text-[#94A3B8] mx-auto" />
          <p className="font-ui text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
            No Personal Records Yet
          </p>
          <p className="font-body text-sm sm:text-base text-slate-500 dark:text-[#94A3B8]">
            Finish a Coordinate drill, Puzzle Streak, or Woodpecker cycle to set your first benchmark.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(Object.keys(MODULE_LABELS) as TrainingModuleId[]).map((mod) => {
            const rec = records[mod];
            if (!rec) return null;
            return (
              <div
                key={mod}
                className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] space-y-3.5"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F1F5F9]">
                    {MODULE_LABELS[mod]}
                  </h3>
                  <Trophy className="w-4 h-4 text-amber-400" />
                </div>
                <div className="grid grid-cols-2 gap-2.5 text-sm font-mono-tabular">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                    <div className="font-ui font-medium text-slate-600 dark:text-[#94A3B8]">Best Streak</div>
                    <div className="mt-1 text-lg sm:text-xl font-bold text-emerald-600 dark:text-[#39FF88]">
                      {rec.bestStreak ?? '—'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                    <div className="font-ui font-medium text-slate-600 dark:text-[#94A3B8]">Best Accuracy</div>
                    <div className="mt-1 text-lg sm:text-xl font-bold text-slate-900 dark:text-[#F1F5F9]">
                      {rec.bestAccuracy !== undefined ? `${Math.round(rec.bestAccuracy)}%` : '—'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                    <div className="font-ui font-medium text-slate-600 dark:text-[#94A3B8]">Best Time</div>
                    <div className="mt-1 text-lg sm:text-xl font-bold text-slate-900 dark:text-[#F1F5F9]">
                      {rec.bestTimeMs ? formatDurationPrecise(rec.bestTimeMs) : '—'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60">
                    <div className="font-ui font-medium text-slate-600 dark:text-[#94A3B8]">Top Rating</div>
                    <div className="mt-1 text-lg sm:text-xl font-bold text-slate-900 dark:text-[#F1F5F9]">
                      {rec.highestRating ?? '—'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

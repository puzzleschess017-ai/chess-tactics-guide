import React, { useState } from 'react';
import { Chess, Square } from 'chess.js';
import { Cloud, HardDrive, Trash2, CheckCircle2, LogOut } from 'lucide-react';
import { Chessboard } from '../chess/Chessboard';
import { ChessPiece, PIECE_SETS } from '../chess/ChessPiece';
import { BOARD_THEMES } from '../../lib/chessUtils';
import { useApp } from '../../context/AppContext';
import { soundEngine } from '../../lib/sound';
import {
  BoardTheme,
  CoordinateDisplay,
} from '../../types/chess';

export const BoardAppearanceSettings: React.FC = () => {
  const { settings, updateSettings } = useApp();
  const [previewChess, setPreviewChess] = useState(
    () => new Chess('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3')
  );
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>({
    from: 'f3',
    to: 'g5',
  });

  const activeTheme = BOARD_THEMES[settings.board.theme] ?? BOARD_THEMES.green;
  const activePieceSet = PIECE_SETS.find((p) => p.id === (settings.board.pieceSet ?? 'merida')) ?? PIECE_SETS[0];

  const handlePreviewMove = (from: Square, to: Square) => {
    const next = new Chess(previewChess.fen());
    try {
      const m = next.move({ from, to, promotion: 'q' });
      if (m) {
        setPreviewChess(next);
        setLastMove({ from: m.from, to: m.to });
        soundEngine.playMove(settings.sound, Boolean(m.captured));
        return true;
      }
    } catch {
      return false;
    }
    return false;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-[#F1F5F9]">
          Board Appearance
        </h1>
        <p className="mt-2 font-body text-base text-slate-500 dark:text-[#94A3B8]">
          All board colors and piece styles apply globally across every training and puzzle module. Resize boards directly from the corner control on any chessboard.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-6 p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] flex flex-col items-center">
          <div className="w-full flex items-center justify-between mb-3 text-sm sm:text-base text-slate-700 dark:text-[#CBD5E1] font-ui">
            <span className="font-bold">Live Interactive Preview</span>
            <span className="font-mono-tabular font-semibold">
              {activeTheme.name} · {activePieceSet.name}
            </span>
          </div>
          <Chessboard
            fen={previewChess.fen()}
            lastMove={lastMove}
            onMove={handlePreviewMove}
          />
        </div>

        <div className="xl:col-span-6 p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] space-y-6">
          {/* Board Themes */}
          <div>
            <label className="block text-base font-bold text-slate-700 dark:text-[#F1F5F9] mb-3">
              Board Color Theme
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {(Object.keys(BOARD_THEMES) as BoardTheme[]).map((themeKey) => {
                const t = BOARD_THEMES[themeKey];
                const active = settings.board.theme === themeKey;
                return (
                  <button
                    key={themeKey}
                    type="button"
                    onClick={() =>
                      updateSettings((prev) => ({
                        ...prev,
                        board: { ...prev.board, theme: themeKey },
                      }))
                    }
                    className={`p-2.5 rounded-xl border flex items-center gap-2.5 text-left cursor-pointer transition-colors ${
                      active
                        ? 'border-emerald-500 dark:border-[#39FF88] bg-emerald-500/10 dark:bg-[#39FF88]/10'
                        : 'border-slate-200 dark:border-[#263D5C] hover:bg-slate-50 dark:hover:bg-[#101B30]'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg overflow-hidden grid grid-cols-2 grid-rows-2 shrink-0 border border-black/20">
                      <span style={{ backgroundColor: t.light }} />
                      <span style={{ backgroundColor: t.dark }} />
                      <span style={{ backgroundColor: t.dark }} />
                      <span style={{ backgroundColor: t.light }} />
                    </div>
                    <span className="text-sm sm:text-[15px] font-semibold text-slate-800 dark:text-[#F1F5F9] truncate">
                      {t.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Piece Sets with Visual Previews */}
          <div>
            <label className="block text-base font-bold text-slate-700 dark:text-[#F1F5F9] mb-3">
              Piece Set
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {PIECE_SETS.map((ps) => {
                const active = (settings.board.pieceSet ?? 'merida') === ps.id;
                return (
                  <button
                    key={ps.id}
                    type="button"
                    onClick={() =>
                      updateSettings((prev) => ({
                        ...prev,
                        board: { ...prev.board, pieceSet: ps.id },
                      }))
                    }
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-colors ${
                      active
                        ? 'border-emerald-500 dark:border-[#39FF88] bg-emerald-500/10 dark:bg-[#39FF88]/10'
                        : 'border-slate-200 dark:border-[#263D5C] hover:bg-slate-50 dark:hover:bg-[#101B30]'
                    }`}
                  >
                    <div
                      style={{ backgroundColor: activeTheme.light }}
                      className="w-full h-11 rounded-lg border border-black/15 flex items-center justify-around px-1.5 mb-2"
                    >
                      <div className="w-7 h-7">
                        <ChessPiece type="k" color="w" pieceSet={ps.id} />
                      </div>
                      <div className="w-7 h-7">
                        <ChessPiece type="q" color="b" pieceSet={ps.id} />
                      </div>
                      <div className="w-7 h-7">
                        <ChessPiece type="n" color="w" pieceSet={ps.id} />
                      </div>
                    </div>
                    <div className="text-sm sm:text-[15px] font-bold text-slate-900 dark:text-[#F1F5F9] truncate">
                      {ps.name}
                    </div>
                    <div className="font-body text-xs sm:text-[13px] text-slate-500 dark:text-[#94A3B8] truncate">
                      {ps.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Coordinate Labels */}
          <div>
            <label className="block text-base font-bold text-slate-700 dark:text-[#F1F5F9] mb-2.5">
              Coordinate Labels
            </label>
            <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#101B30] border border-slate-200/70 dark:border-[#263D5C]">
              {(
                [
                  ['inside', 'Inside Squares'],
                  ['outside', 'Outside Rim'],
                  ['none', 'Hidden'],
                ] as Array<[CoordinateDisplay, string]>
              ).map(([c, lbl]) => (
                <button
                  key={c}
                  type="button"
                  onClick={() =>
                    updateSettings((prev) => ({
                      ...prev,
                      board: { ...prev.board, coordinates: c },
                    }))
                  }
                  className={`flex-1 py-2.5 rounded-lg text-sm sm:text-[15px] font-semibold cursor-pointer transition-colors ${
                    settings.board.coordinates === c
                      ? 'bg-white dark:bg-[#14233A] text-slate-900 dark:text-[#39FF88] border border-slate-200 dark:border-[#39FF88]/50 shadow-sm'
                      : 'text-slate-500 dark:text-[#94A3B8] border border-transparent'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Boolean toggles */}
          <div className="space-y-3.5 pt-3.5 border-t border-slate-100 dark:border-[#263D5C]">
            {(
              [
                ['animatePieces', 'Smooth piece movement animations'],
                ['highlightLegalMoves', 'Highlight legal move destinations'],
                ['highlightLastMove', 'Highlight last move squares'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between text-sm sm:text-base font-medium cursor-pointer">
                <span className="text-slate-700 dark:text-[#F1F5F9]">{label}</span>
                <input
                  type="checkbox"
                  checked={settings.board[key]}
                  onChange={(e) =>
                    updateSettings((prev) => ({
                      ...prev,
                      board: { ...prev.board, [key]: e.target.checked },
                    }))
                  }
                  className="w-4 h-4 rounded border-slate-400 dark:border-[#263D5C] accent-[#39FF88]"
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const GeneralSettingsView: React.FC = () => {
  const {
    settings,
    updateSettings,
    syncStatus,
    syncError,
    isCloudConfigured,
    anonymousId,
    isAuthenticated,
    authUser,
    logout,
    resetAllLocalData,
  } = useApp();

  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-[#F1F5F9]">
          General Settings &amp; Cloud Configuration
        </h1>
        <p className="mt-2 font-body text-base text-slate-500 dark:text-[#94A3B8]">
          Manage default preferences, active session access, and cloud synchronization settings.
        </p>
      </div>

      {/* Session & Account */}
      <div className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-[#F1F5F9]">
            {isAuthenticated ? 'Authenticated Account' : 'Guest Browser Session'}
          </h2>
          <p className="mt-1 font-body text-sm sm:text-[15px] text-slate-500 dark:text-[#94A3B8]">
            {isAuthenticated
              ? `Signed in as ${authUser?.email ?? 'registered user'}. Your session stays active across visits until you log out.`
              : 'Guest access stays active in this browser tab on refresh. Your training progress remains saved locally.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-[#263D5C] hover:border-emerald-500 dark:hover:border-[#39FF88] text-slate-800 dark:text-[#F1F5F9] text-sm sm:text-base font-semibold cursor-pointer shrink-0 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          {isAuthenticated ? 'Log Out' : 'Exit Guest Session'}
        </button>
      </div>

      {/* Preferences */}
      <div className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] space-y-5">
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-[#F1F5F9]">
          Training Preferences
        </h2>

        <label className="flex items-center justify-between text-base cursor-pointer">
          <div>
            <div className="font-ui font-semibold text-slate-900 dark:text-[#F1F5F9]">Dark Navy Theme</div>
            <div className="font-body text-sm text-slate-500 dark:text-[#94A3B8]">
              Deep navy workspace with neon green accents optimized for long study sessions
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.general.darkTheme}
            onChange={(e) =>
              updateSettings((prev) => ({
                ...prev,
                general: { ...prev.general, darkTheme: e.target.checked },
              }))
            }
            className="w-4 h-4 rounded accent-[#39FF88]"
          />
        </label>
      </div>

      {/* Honest Cloud Sync Status & Setup Guide */}
      <div className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-[#F1F5F9]">
            Cloud Sync &amp; Anonymous Identity
          </h2>
          {syncStatus === 'cloud_synced' ? (
            <span className="inline-flex items-center gap-1.5 font-ui text-xs sm:text-sm font-medium text-emerald-600 dark:text-[#39FF88]">
              <Cloud className="w-4 h-4" />
              Supabase Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-ui text-xs sm:text-sm font-medium text-amber-400">
              <HardDrive className="w-4 h-4" />
              Local Development Fallback Active
            </span>
          )}
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#101B30] border border-slate-100 dark:border-[#263D5C]/60 text-xs sm:text-sm font-mono-tabular text-slate-600 dark:text-[#94A3B8]">
          Anonymous Identity ID: <span className="text-slate-900 dark:text-[#F1F5F9]">{anonymousId || 'initializing...'}</span>
        </div>

        {!isCloudConfigured ? (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 font-body text-xs sm:text-sm space-y-2 text-slate-700 dark:text-[#F1F5F9]">
            <div className="font-ui font-semibold text-amber-600 dark:text-amber-400">
              Supabase Credentials Not Configured — Running Locally
            </div>
            <p className="font-body leading-relaxed dark:text-[#94A3B8]">
              Progress, settings, and Woodpecker cycles are currently saved in your local browser &amp; SQLite fallback storage. To enable Supabase cloud sync across devices:
            </p>
            <ol className="list-decimal list-inside space-y-1.5 dark:text-[#94A3B8]">
              <li>Create a Supabase project and enable <strong className="dark:text-[#F1F5F9]">Anonymous Sign-Ins</strong> under Authentication → Providers.</li>
              <li>Run <code className="font-mono-tabular dark:text-[#F1F5F9]">supabase/migrations/001_initial_schema.sql</code> in the Supabase SQL Editor (configures tables + RLS policies).</li>
              <li>Set <code className="font-mono-tabular dark:text-[#F1F5F9]">VITE_SUPABASE_URL</code> and <code className="font-mono-tabular dark:text-[#F1F5F9]">VITE_SUPABASE_ANON_KEY</code> in your environment variables and restart the server.</li>
            </ol>
          </div>
        ) : (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 dark:bg-[#39FF88]/10 border border-emerald-500/25 dark:border-[#39FF88]/40 font-body text-xs sm:text-sm text-emerald-700 dark:text-[#39FF88] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Anonymous Supabase session active with Row Level Security (RLS). Ready for future email/OAuth account linking.
          </div>
        )}

        {syncError && <p className="font-body text-xs sm:text-sm text-rose-400">Sync notice: {syncError}</p>}
      </div>

      {/* Danger / Reset */}
      <div className="p-5 rounded-2xl bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] flex items-center justify-between gap-4">
        <div>
          <div className="font-ui text-base font-bold text-slate-900 dark:text-[#F1F5F9]">
            Reset Local Progress
          </div>
          <div className="font-body text-sm text-slate-500 dark:text-[#94A3B8]">
            Clears local sessions, records, and Woodpecker sets for this device.
          </div>
        </div>
        {!confirmReset ? (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 text-sm sm:text-base font-semibold cursor-pointer shrink-0"
          >
            <Trash2 className="w-4 h-4" />
            Reset Data
          </button>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-[#263D5C] text-sm sm:text-base font-semibold text-slate-700 dark:text-[#F1F5F9] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void resetAllLocalData();
                setConfirmReset(false);
              }}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm sm:text-base font-semibold cursor-pointer"
            >
              Confirm Reset
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

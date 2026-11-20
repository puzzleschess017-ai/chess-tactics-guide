/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/layout/Sidebar';
import { WelcomeScreen } from './components/layout/WelcomeScreen';
import { DashboardView } from './components/modules/DashboardView';
import { CoordinateTraining } from './components/modules/CoordinateTraining';
import { BlindfoldTraining } from './components/modules/BlindfoldTraining';
import { KnightTraining } from './components/modules/KnightTraining';
import { PuzzleStreak } from './components/modules/PuzzleStreak';
import { PuzzleRace } from './components/modules/PuzzleRace';
import { WoodpeckerMethod } from './components/modules/WoodpeckerMethod';
import { TacticalThemes } from './components/modules/TacticalThemes';
import {
  PersonalRecordsView,
  StatisticsView,
  TrainingHistoryView,
} from './components/modules/ProgressViews';
import {
  BoardAppearanceSettings,
  GeneralSettingsView,
} from './components/modules/SettingsViews';

const WorkspaceContent: React.FC = () => {
  const {
    currentNav,
    isLoading,
    isAuthChecking,
    canAccessApp,
    isCloudConfigured,
    enterAsGuest,
    signInWithEmail,
    signUpWithEmail,
  } = useApp();

  if (isAuthChecking && !canAccessApp) {
    return (
      <div className="min-h-screen w-full bg-[#080F1E] flex items-center justify-center">
        <div className="w-10 h-10 rounded-xl border-2 border-[#263D5C] border-t-[#39FF88] animate-spin" />
      </div>
    );
  }

  if (!canAccessApp) {
    return (
      <WelcomeScreen
        onEnterAsGuest={enterAsGuest}
        isAuthAvailable={isCloudConfigured}
        onSignIn={signInWithEmail}
        onSignUp={signUpWithEmail}
      />
    );
  }

  const renderPage = () => {
    switch (currentNav) {
      case 'dashboard':
        return <DashboardView />;
      case 'coordinate':
        return <CoordinateTraining />;
      case 'blindfold':
        return <BlindfoldTraining />;
      case 'knight':
        return <KnightTraining />;
      case 'puzzle-streak':
        return <PuzzleStreak />;
      case 'puzzle-race':
        return <PuzzleRace />;
      case 'woodpecker':
        return <WoodpeckerMethod />;
      case 'tactical-themes':
        return <TacticalThemes />;
      case 'statistics':
        return <StatisticsView />;
      case 'training-history':
        return <TrainingHistoryView />;
      case 'personal-records':
        return <PersonalRecordsView />;
      case 'settings-board':
        return <BoardAppearanceSettings />;
      case 'settings-general':
        return <GeneralSettingsView />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#f4f5f7] dark:bg-[#080F1E] text-slate-900 dark:text-[#F1F5F9]">
      <Sidebar />

      <div className="flex-1 min-w-0 lg:pl-72">
        <main className="w-full max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4 lg:py-5">
          {isLoading ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-8 w-56 rounded-lg bg-slate-200 dark:bg-[#14233A]" />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-24 rounded-2xl bg-slate-200 dark:bg-[#14233A]" />
                ))}
              </div>
              <div className="h-64 rounded-2xl bg-slate-200 dark:bg-[#14233A]" />
            </div>
          ) : (
            renderPage()
          )}
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <WorkspaceContent />
    </AppProvider>
  );
}

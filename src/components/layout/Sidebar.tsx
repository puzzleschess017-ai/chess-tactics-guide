import React, { useEffect, useState } from 'react';
import {
  Home,
  Flame,
  Timer,
  Repeat,
  Target,
  Crosshair,
  EyeOff,
  Compass,
  BarChart3,
  History,
  Trophy,
  Palette,
  Sliders,
  ChevronDown,
  ChevronRight,
  Cloud,
  HardDrive,
  LogOut,
  ArrowLeft,
} from 'lucide-react';
import { NavSectionId } from '../../types/chess';
import { useApp } from '../../context/AppContext';

type GroupId = 'puzzles' | 'training' | 'progress' | 'settings';

interface NavItem {
  id: NavSectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  id: GroupId;
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'puzzles',
    label: 'Puzzles',
    items: [
      { id: 'woodpecker', label: 'Woodpecker Method', icon: Repeat },
      { id: 'puzzle-streak', label: 'Puzzle Streak', icon: Flame },
      { id: 'puzzle-race', label: 'Puzzle Race', icon: Timer },
      { id: 'tactical-themes', label: 'Tactical Themes', icon: Target },
    ],
  },
  {
    id: 'training',
    label: 'Training',
    items: [
      { id: 'coordinate', label: 'Coordinate Training', icon: Crosshair },
      { id: 'blindfold', label: 'Blindfold Training', icon: EyeOff },
      { id: 'knight', label: 'Knight Training', icon: Compass },
    ],
  },
  {
    id: 'progress',
    label: 'Progress',
    items: [
      { id: 'statistics', label: 'Statistics', icon: BarChart3 },
      { id: 'training-history', label: 'Training History', icon: History },
      { id: 'personal-records', label: 'Personal Records', icon: Trophy },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { id: 'settings-board', label: 'Board Appearance', icon: Palette },
      { id: 'settings-general', label: 'General Settings', icon: Sliders },
    ],
  },
];

function getGroupForNav(nav: NavSectionId): GroupId | 'home' {
  if (nav === 'dashboard') return 'home';
  for (const group of NAV_GROUPS) {
    if (group.items.some((item) => item.id === nav)) {
      return group.id;
    }
  }
  return 'home';
}

export const Sidebar: React.FC = () => {
  const { currentNav, setCurrentNav, syncStatus, isAuthenticated, authUser, logout } = useApp();

  const [expandedGroups, setExpandedGroups] = useState<Record<GroupId, boolean>>({
    puzzles: true,
    training: true,
    progress: true,
    settings: true,
  });

  // Automatically expand the group containing the currently active page
  useEffect(() => {
    const activeGroup = getGroupForNav(currentNav);
    if (activeGroup !== 'home') {
      setExpandedGroups((prev) => (prev[activeGroup] ? prev : { ...prev, [activeGroup]: true }));
    }
  }, [currentNav]);

  const toggleGroup = (groupId: GroupId) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const activeCategory = getGroupForNav(currentNav);
  const activeMobileGroup = NAV_GROUPS.find((g) => g.id === activeCategory) ?? null;

  const handleMobileSectionSelect = (target: 'home' | GroupId) => {
    if (target === 'home') {
      setCurrentNav('dashboard');
      return;
    }
    const group = NAV_GROUPS.find((g) => g.id === target);
    if (!group) return;
    const alreadyInGroup = group.items.some((item) => item.id === currentNav);
    if (!alreadyInGroup && group.items[0]) {
      setCurrentNav(group.items[0].id);
    }
  };

  return (
    <>
      {/* Desktop: Permanently Visible, Stationary Fixed Left Sidebar */}
      <aside
        aria-label="Primary Navigation"
        className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 lg:w-72 bg-white dark:bg-[#101B30] border-r border-slate-200 dark:border-[#263D5C] z-30 select-none"
      >
        {/* Brand Header */}
        <div className="px-4 h-16 border-b border-slate-200 dark:border-[#263D5C] flex items-center shrink-0">
          <button
            type="button"
            onClick={() => setCurrentNav('dashboard')}
            className="flex items-center gap-2.5 text-left cursor-pointer group min-w-0 w-full"
          >
            <div className="w-9 h-9 rounded-xl bg-[#0B1426] dark:bg-transparent p-1 dark:p-0 flex items-center justify-center shrink-0">
              <img
                src="/assets/aistudio/Add_a_heading__16_-removebg-preview_c70fa2ca.png"
                alt="Chess Tactics Guide logo"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="min-w-0 font-ui">
              <div className="text-base sm:text-[17px] font-bold tracking-tight text-slate-900 dark:text-[#F1F5F9] group-hover:text-emerald-600 dark:group-hover:text-[#39FF88] transition-colors whitespace-nowrap truncate">
                Chess Tactics Guide
              </div>
              <div className="font-body text-xs font-medium tracking-wide text-slate-500 dark:text-[#94A3B8] whitespace-nowrap truncate">
                Improve Every Day
              </div>
            </div>
          </button>
        </div>

        {/* Scrollable Navigation Sections */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
          {/* Home */}
          <div>
            <button
              type="button"
              onClick={() => setCurrentNav('dashboard')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[15px] transition-colors text-left cursor-pointer whitespace-nowrap ${
                currentNav === 'dashboard'
                  ? 'bg-emerald-500/12 dark:bg-[#39FF88]/12 text-emerald-700 dark:text-[#39FF88] border border-emerald-500/35 dark:border-[#39FF88]/40 font-semibold'
                  : 'text-slate-700 dark:text-[#F1F5F9] hover:bg-slate-100 dark:hover:bg-[#14233A] border border-transparent font-medium'
              }`}
            >
              <Home
                className={`w-[18px] h-[18px] shrink-0 ${
                  currentNav === 'dashboard'
                    ? 'text-emerald-600 dark:text-[#39FF88]'
                    : 'text-slate-400 dark:text-[#94A3B8]'
                }`}
              />
              <span>Home</span>
            </button>
          </div>

          {/* Expandable Navigation Groups (Puzzles before Training, Progress, Settings) */}
          {NAV_GROUPS.map((group) => {
            const isOpen = expandedGroups[group.id];
            const hasActiveChild = group.items.some((item) => item.id === currentNav);

            return (
              <div key={group.id} className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#94A3B8] hover:text-slate-800 dark:hover:text-[#F1F5F9] transition-colors cursor-pointer"
                >
                  <span
                    className={
                      hasActiveChild ? 'text-emerald-700 dark:text-[#39FF88]' : undefined
                    }
                  >
                    {group.label}
                  </span>
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 opacity-75 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 opacity-75 shrink-0" />
                  )}
                </button>

                {isOpen && (
                  <div className="space-y-1 pl-1">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = currentNav === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setCurrentNav(item.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[15px] transition-colors text-left cursor-pointer whitespace-nowrap ${
                            isActive
                              ? 'bg-emerald-500/12 dark:bg-[#39FF88]/12 text-emerald-700 dark:text-[#39FF88] border border-emerald-500/35 dark:border-[#39FF88]/40 font-semibold'
                              : 'text-slate-600 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-[#F1F5F9] hover:bg-slate-100 dark:hover:bg-[#14233A] border border-transparent font-medium'
                          }`}
                        >
                          <Icon
                            className={`w-[18px] h-[18px] shrink-0 ${
                              isActive
                                ? 'text-emerald-600 dark:text-[#39FF88]'
                                : 'text-slate-400 dark:text-[#94A3B8]'
                            }`}
                          />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer Sync & Account Indicator */}
        <div className="px-4 py-3.5 border-t border-slate-200 dark:border-[#263D5C] shrink-0 space-y-2.5">
          {isAuthenticated ? (
            <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
              <span className="font-medium text-slate-700 dark:text-[#F1F5F9] truncate" title={authUser?.username || authUser?.email || ''}>
                Hello, <span className="font-bold text-emerald-600 dark:text-[#39FF88]">{authUser?.username || authUser?.email?.split('@')[0] || 'Player'}</span>
              </span>
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-[#263D5C] text-xs font-semibold text-slate-700 dark:text-[#F1F5F9] hover:border-rose-500/50 hover:text-rose-400 transition-colors cursor-pointer shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                Log Out
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
              <span className="font-medium text-slate-500 dark:text-[#94A3B8] text-xs truncate">
                Guest Mode
              </span>
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-[#263D5C] text-xs font-semibold text-slate-700 dark:text-[#F1F5F9] hover:border-emerald-500/50 hover:text-emerald-600 dark:hover:text-[#39FF88] transition-colors cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Login Page
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setCurrentNav('settings-general')}
            className="w-full flex items-center justify-between gap-2 text-xs sm:text-sm text-slate-500 dark:text-[#94A3B8] hover:text-slate-800 dark:hover:text-[#F1F5F9] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2 min-w-0">
              {syncStatus === 'cloud_synced' ? (
                <Cloud className="w-4 h-4 text-emerald-600 dark:text-[#39FF88] shrink-0" />
              ) : (
                <HardDrive className="w-4 h-4 text-amber-500 shrink-0" />
              )}
              <span className="truncate font-medium">
                {syncStatus === 'cloud_synced'
                  ? 'Cloud Synced'
                  : syncStatus === 'syncing'
                  ? 'Syncing...'
                  : 'Local Mode'}
              </span>
            </span>
            <span className="text-xs sm:text-sm font-semibold text-emerald-600 dark:text-[#39FF88] shrink-0">
              Settings
            </span>
          </button>
        </div>
      </aside>

      {/* Mobile & Tablet (< lg): Compact Non-Overlapping In-Flow Navigation Strip (No Hamburger) */}
      <header className="lg:hidden bg-white dark:bg-[#101B30] border-b border-slate-200 dark:border-[#263D5C]">
        <div className="px-4 pt-3 pb-2.5 space-y-2.5">
          {/* Compact Brand + Top-Level Sections */}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => handleMobileSectionSelect('home')}
              className="flex items-center gap-2 text-left cursor-pointer shrink-0"
            >
              <div className="w-8 h-8 rounded-lg bg-[#0B1426] dark:bg-transparent p-1 dark:p-0 flex items-center justify-center shrink-0">
                <img
                  src="/assets/aistudio/Add_a_heading__16_-removebg-preview_c70fa2ca.png"
                  alt="Chess Tactics Guide logo"
                  className="w-full h-full object-contain"
                />
              </div>
              <span className="text-base font-bold tracking-tight text-slate-900 dark:text-[#F1F5F9] whitespace-nowrap">
                Chess Tactics Guide
              </span>
            </button>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {isAuthenticated ? (
                <>
                  <span className="text-xs font-medium text-slate-700 dark:text-[#F1F5F9] hidden sm:inline">
                    Hello, <span className="font-bold text-emerald-600 dark:text-[#39FF88]">{authUser?.username || authUser?.email?.split('@')[0] || 'Player'}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-[#263D5C] text-xs font-semibold text-slate-700 dark:text-[#F1F5F9] hover:text-rose-400 cursor-pointer whitespace-nowrap"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Log Out
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-[#263D5C] text-xs font-semibold text-slate-700 dark:text-[#F1F5F9] hover:text-emerald-600 dark:hover:text-[#39FF88] cursor-pointer whitespace-nowrap"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to Login
                </button>
              )}
              <button
                type="button"
                onClick={() => setCurrentNav('settings-general')}
                className="text-xs sm:text-sm font-medium text-slate-500 dark:text-[#94A3B8] hover:text-emerald-600 dark:hover:text-[#39FF88] flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                {syncStatus === 'cloud_synced' ? (
                  <Cloud className="w-3.5 h-3.5 text-emerald-600 dark:text-[#39FF88]" />
                ) : (
                  <HardDrive className="w-3.5 h-3.5 text-amber-500" />
                )}
                <span>{syncStatus === 'cloud_synced' ? 'Cloud' : 'Local'}</span>
              </button>
            </div>
          </div>

          {/* Primary Sections Row */}
          <nav aria-label="Mobile Primary Sections" className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => handleMobileSectionSelect('home')}
              className={`px-3.5 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeCategory === 'home'
                  ? 'bg-emerald-600 dark:bg-[#39FF88] text-white dark:text-[#080F1E]'
                  : 'bg-slate-100 dark:bg-[#14233A] text-slate-700 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-[#F1F5F9]'
              }`}
            >
              Home
            </button>
            {NAV_GROUPS.map((group) => {
              const isGroupActive = activeCategory === group.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => handleMobileSectionSelect(group.id)}
                  className={`px-3.5 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    isGroupActive
                      ? 'bg-emerald-600 dark:bg-[#39FF88] text-white dark:text-[#080F1E]'
                      : 'bg-slate-100 dark:bg-[#14233A] text-slate-700 dark:text-[#94A3B8] hover:text-slate-900 dark:hover:text-[#F1F5F9]'
                  }`}
                >
                  {group.label}
                </button>
              );
            })}
          </nav>

          {/* Sub-mode Row for Active Section */}
          {activeMobileGroup && (
            <div className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-slate-100 dark:border-[#263D5C]/70">
              {activeMobileGroup.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCurrentNav(item.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0 border ${
                      isActive
                        ? 'bg-emerald-500/12 dark:bg-[#39FF88]/12 text-emerald-700 dark:text-[#39FF88] border-emerald-500/35 dark:border-[#39FF88]/40 font-semibold'
                        : 'bg-transparent text-slate-600 dark:text-[#94A3B8] border-transparent hover:bg-slate-100 dark:hover:bg-[#14233A] font-medium'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>
    </>
  );
};

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  CloudSyncStatus,
  ModuleRecord,
  NavSectionId,
  PuzzleCollection,
  TrainingModuleId,
  TrainingSessionRecord,
  UserPersistedState,
  UserSettings,
  WoodpeckerCycle,
} from '../types/chess';
import {
  DEFAULT_SETTINGS,
  deleteCollectionCloud,
  deleteWoodpeckerCycleCloud,
  loadUserState,
  normalizePersistedCollectionsAndCycles,
  persistCollectionCloud,
  persistLocalFallbackState,
  persistModuleRecordCloud,
  persistSessionCloud,
  persistSettingsCloud,
  persistWoodpeckerCycleCloud,
  writeLocalStateSnapshot,
} from '../services/dataService';
import {
  AuthenticatedUser,
  getAuthenticatedSessionUser,
  isSupabaseConfigured,
  onSupabaseAuthChange,
  signInWithSupabaseEmail,
  signOutSupabase,
  signUpWithSupabaseEmail,
} from '../lib/supabase';
import {
  clearLegacyGuestPersistence,
  readGuestSessionActive,
  writeGuestSessionActive,
} from '../lib/sessionAccess';

interface RecordSessionInput {
  module: TrainingModuleId;
  mode: string;
  score: number;
  total: number;
  accuracy: number;
  durationMs: number;
  bestMetric?: number;
  metadata?: Record<string, unknown>;
  recordUpdates?: Partial<ModuleRecord>;
}

interface AppContextValue {
  currentNav: NavSectionId;
  setCurrentNav: (nav: NavSectionId) => void;
  isLoading: boolean;
  isAuthChecking: boolean;
  isAuthenticated: boolean;
  isGuestSession: boolean;
  canAccessApp: boolean;
  authUser: AuthenticatedUser | null;
  enterAsGuest: () => void;
  signInWithEmail: (identifier: string, password: string) => Promise<void>;
  signUpWithEmail: (
    email: string,
    password: string,
    username: string
  ) => Promise<{ needsEmailConfirmation?: boolean; username: string }>;
  logout: () => Promise<void>;
  syncStatus: CloudSyncStatus;
  syncError?: string;
  isCloudConfigured: boolean;
  anonymousId: string;
  settings: UserSettings;
  updateSettings: (updater: (prev: UserSettings) => UserSettings) => void;
  sessions: TrainingSessionRecord[];
  records: Record<string, ModuleRecord>;
  collections: PuzzleCollection[];
  woodpeckerCycles: WoodpeckerCycle[];
  recordTrainingSession: (input: RecordSessionInput) => Promise<void>;
  updateModuleExtra: (
    module: TrainingModuleId,
    updater: (prevExtra: Record<string, number | string>) => Record<string, number | string>
  ) => Promise<void>;
  saveCollection: (collection: PuzzleCollection) => Promise<void>;
  deleteCollection: (collectionId: string) => Promise<void>;
  saveWoodpeckerCycle: (cycle: WoodpeckerCycle) => Promise<void>;
  deleteWoodpeckerCycle: (cycleId: string) => Promise<void>;
  resetAllLocalData: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentNav, setCurrentNav] = useState<NavSectionId>('dashboard');
  const [isGuestSession, setIsGuestSession] = useState<boolean>(() => readGuestSessionActive());
  const [authUser, setAuthUser] = useState<AuthenticatedUser | null>(null);
  const isRegisteringRef = useRef<boolean>(false);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(() => isSupabaseConfigured);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('local_fallback');
  const [syncError, setSyncError] = useState<string | undefined>(undefined);
  const [state, setState] = useState<UserPersistedState>({
    anonymousId: '',
    isCloudConnected: false,
    settings: DEFAULT_SETTINGS,
    sessions: [],
    records: {},
    collections: [],
    woodpeckerCycles: [],
  });

  const stateRef = useRef<UserPersistedState>(state);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Clean up any legacy permanent Guest localStorage flag on startup
  useEffect(() => {
    clearLegacyGuestPersistence();
  }, []);

  // Restore real authenticated session persistently when auth provider is configured
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthUser(null);
      setIsAuthChecking(false);
      return;
    }

    let active = true;
    void getAuthenticatedSessionUser().then((user) => {
      if (!active) return;
      setAuthUser(user);
      setIsAuthChecking(false);
    });

    const unsubscribe = onSupabaseAuthChange((user) => {
      if (!active) return;
      if (isRegisteringRef.current) return;
      setAuthUser(user);
      setIsAuthChecking(false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const isAuthenticated = Boolean(authUser);
  const canAccessApp = isAuthenticated || isGuestSession;

  // Load persisted training state once the user is either authenticated or in an active Guest session
  useEffect(() => {
    if (!canAccessApp) {
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);
    loadUserState().then(({ state: loaded, syncStatus: status, errorMessage }) => {
      if (!active) return;
      stateRef.current = loaded;
      setState(loaded);
      setSyncStatus(status);
      setSyncError(errorMessage);
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [canAccessApp, authUser?.id]);

  // Sync dark theme class on documentElement whenever inside app & general.darkTheme changes
  useEffect(() => {
    const root = document.documentElement;
    if (!canAccessApp) {
      root.classList.add('dark');
      return;
    }
    if (state.settings.general.darkTheme) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [canAccessApp, state.settings.general.darkTheme]);

  const enterAsGuest = useCallback(() => {
    writeGuestSessionActive(true);
    setIsGuestSession(true);
    setCurrentNav('dashboard');
  }, []);

  const signInWithEmail = useCallback(async (identifier: string, password: string) => {
    const { user } = await signInWithSupabaseEmail(identifier, password);
    writeGuestSessionActive(false);
    setIsGuestSession(false);
    setAuthUser(user);
    setCurrentNav('dashboard');
  }, []);

  const signUpWithEmail = useCallback(
    async (email: string, password: string, username: string) => {
      isRegisteringRef.current = true;
      try {
        const res = await signUpWithSupabaseEmail(email, password, username);
        setAuthUser(null);
        return {
          needsEmailConfirmation: res.needsEmailConfirmation,
          username: res.username,
        };
      } finally {
        setTimeout(() => {
          isRegisteringRef.current = false;
        }, 800);
      }
    },
    []
  );

  const logout = useCallback(async () => {
    if (isAuthenticated) {
      await signOutSupabase();
    }
    writeGuestSessionActive(false);
    setIsGuestSession(false);
    setAuthUser(null);
    setCurrentNav('dashboard');
  }, [isAuthenticated]);

  const enqueuePersist = useCallback(
    (nextState: UserPersistedState, cloudOp?: () => Promise<void>): Promise<void> => {
      console.log('[Chess] enqueuePersist → isCloudConnected:', nextState.isCloudConnected, 'hasCloudOp:', !!cloudOp);
      if (!nextState.isCloudConnected) {
        writeLocalStateSnapshot(nextState);
      }

      const task = persistQueueRef.current.then(async () => {
        if (nextState.isCloudConnected && cloudOp) {
          setSyncStatus('syncing');
          try {
            await cloudOp();
            setSyncStatus('cloud_synced');
            setSyncError(undefined);
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Cloud sync error';
            console.error('[Chess] Cloud save failed:', msg);
            setSyncStatus('error');
            setSyncError(msg);
          }
        } else {
          console.log('[Chess] Saving locally (not cloud)');
          await persistLocalFallbackState(nextState);
        }
      });

      persistQueueRef.current = task.catch(() => {
        // Keep queue chain healthy after transient errors
      });
      return task;
    },
    []
  );

  const commitMutation = useCallback(
    (
      computeNext: (prev: UserPersistedState) => {
        nextState: UserPersistedState;
        cloudOp?: () => Promise<void>;
      }
    ): Promise<void> => {
      const prev = stateRef.current;
      const { nextState: rawNext, cloudOp } = computeNext(prev);
      const normalized = normalizePersistedCollectionsAndCycles(
        rawNext.collections,
        rawNext.woodpeckerCycles
      );
      const stampedNext: UserPersistedState = {
        ...rawNext,
        collections: normalized.collections,
        woodpeckerCycles: normalized.woodpeckerCycles,
        localUpdatedAt: new Date().toISOString(),
      };
      stateRef.current = stampedNext;
      setState(stampedNext);
      return enqueuePersist(stampedNext, cloudOp);
    },
    [enqueuePersist]
  );

  const updateSettings = useCallback(
    (updater: (prev: UserSettings) => UserSettings) => {
      void commitMutation((prev) => {
        const nextSettings = updater(prev.settings);
        return {
          nextState: { ...prev, settings: nextSettings },
          cloudOp: () => persistSettingsCloud(prev.anonymousId, nextSettings),
        };
      });
    },
    [commitMutation]
  );

  const recordTrainingSession = useCallback(
    async (input: RecordSessionInput) => {
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const session: TrainingSessionRecord = {
        id,
        module: input.module,
        mode: input.mode,
        score: input.score,
        total: input.total,
        accuracy: Math.round(input.accuracy * 100) / 100,
        durationMs: Math.max(0, Math.round(input.durationMs)),
        bestMetric: input.bestMetric,
        metadata: input.metadata,
        createdAt: new Date().toISOString(),
      };

      await commitMutation((prev) => {
        const existing: ModuleRecord = prev.records[input.module] ?? {
          module: input.module,
          totalSessions: 0,
          totalAttempts: 0,
          totalCorrect: 0,
          totalTimeMs: 0,
          lastUpdatedAt: session.createdAt,
        };

        const ru = input.recordUpdates ?? {};
        const updatedRecord: ModuleRecord = {
          ...existing,
          ...ru,
          module: input.module,
          totalSessions: existing.totalSessions + 1,
          totalAttempts: existing.totalAttempts + input.total,
          totalCorrect: existing.totalCorrect + input.score,
          totalTimeMs: existing.totalTimeMs + session.durationMs,
          bestAccuracy:
            existing.bestAccuracy !== undefined
              ? Math.max(existing.bestAccuracy, session.accuracy)
              : session.accuracy,
          bestStreak:
            ru.bestStreak !== undefined
              ? Math.max(existing.bestStreak ?? 0, ru.bestStreak)
              : existing.bestStreak,
          bestTimeMs:
            ru.bestTimeMs !== undefined
              ? existing.bestTimeMs !== undefined
                ? Math.min(existing.bestTimeMs, ru.bestTimeMs)
                : ru.bestTimeMs
              : existing.bestTimeMs,
          fastestAvgMs:
            ru.fastestAvgMs !== undefined
              ? existing.fastestAvgMs !== undefined
                ? Math.min(existing.fastestAvgMs, ru.fastestAvgMs)
                : ru.fastestAvgMs
              : existing.fastestAvgMs,
          highestRating:
            ru.highestRating !== undefined
              ? Math.max(existing.highestRating ?? 0, ru.highestRating)
              : existing.highestRating,
          extra: ru.extra ? { ...(existing.extra ?? {}), ...ru.extra } : existing.extra,
          lastUpdatedAt: session.createdAt,
        };

        return {
          nextState: {
            ...prev,
            sessions: [session, ...prev.sessions].slice(0, 300),
            records: {
              ...prev.records,
              [input.module]: updatedRecord,
            },
          },
          cloudOp: async () => {
            await Promise.all([
              persistSessionCloud(prev.anonymousId, session),
              persistModuleRecordCloud(prev.anonymousId, updatedRecord),
            ]);
          },
        };
      });
    },
    [commitMutation]
  );

  const updateModuleExtra = useCallback(
    async (
      module: TrainingModuleId,
      updater: (prevExtra: Record<string, number | string>) => Record<string, number | string>
    ) => {
      await commitMutation((prev) => {
        const now = new Date().toISOString();
        const existing: ModuleRecord = prev.records[module] ?? {
          module,
          totalSessions: 0,
          totalAttempts: 0,
          totalCorrect: 0,
          totalTimeMs: 0,
          lastUpdatedAt: now,
        };
        const updatedRecord: ModuleRecord = {
          ...existing,
          extra: updater(existing.extra ?? {}),
          lastUpdatedAt: now,
        };
        return {
          nextState: {
            ...prev,
            records: {
              ...prev.records,
              [module]: updatedRecord,
            },
          },
          cloudOp: () => persistModuleRecordCloud(prev.anonymousId, updatedRecord),
        };
      });
    },
    [commitMutation]
  );

  const saveCollection = useCallback(
    async (collection: PuzzleCollection) => {
      await commitMutation((prev) => {
        const exists = prev.collections.some((c) => c.id === collection.id);
        const nextCollections = exists
          ? prev.collections.map((c) => (c.id === collection.id ? collection : c))
          : [collection, ...prev.collections];
        return {
          nextState: { ...prev, collections: nextCollections },
          cloudOp: () => persistCollectionCloud(prev.anonymousId, collection),
        };
      });
    },
    [commitMutation]
  );

  const deleteCollection = useCallback(
    async (collectionId: string) => {
      await commitMutation((prev) => ({
        nextState: {
          ...prev,
          collections: prev.collections.filter((c) => c.id !== collectionId),
        },
        cloudOp: () => deleteCollectionCloud(prev.anonymousId, collectionId),
      }));
    },
    [commitMutation]
  );

  const saveWoodpeckerCycle = useCallback(
    async (cycle: WoodpeckerCycle) => {
      await commitMutation((prev) => {
        const exists = prev.woodpeckerCycles.some((c) => c.id === cycle.id);
        const nextCycles = exists
          ? prev.woodpeckerCycles.map((c) => (c.id === cycle.id ? cycle : c))
          : [cycle, ...prev.woodpeckerCycles];
        return {
          nextState: { ...prev, woodpeckerCycles: nextCycles },
          cloudOp: () => persistWoodpeckerCycleCloud(prev.anonymousId, cycle),
        };
      });
    },
    [commitMutation]
  );

  const deleteWoodpeckerCycle = useCallback(
    async (cycleId: string) => {
      await commitMutation((prev) => {
        const target = prev.woodpeckerCycles.find((c) => c.id === cycleId);
        const remainingCycles = prev.woodpeckerCycles.filter((c) => c.id !== cycleId);
        const stillReferenced = target
          ? remainingCycles.some((c) => c.collectionId === target.collectionId)
          : false;
        const nextCollections =
          target && !stillReferenced
            ? prev.collections.filter((c) => c.id !== target.collectionId)
            : prev.collections;

        return {
          nextState: {
            ...prev,
            collections: nextCollections,
            woodpeckerCycles: remainingCycles,
          },
          cloudOp: async () => {
            await deleteWoodpeckerCycleCloud(prev.anonymousId, cycleId);
            if (target && !stillReferenced) {
              await deleteCollectionCloud(prev.anonymousId, target.collectionId);
            }
          },
        };
      });
    },
    [commitMutation]
  );

  const resetAllLocalData = useCallback(async () => {
    await commitMutation((prev) => ({
      nextState: {
        anonymousId: prev.anonymousId,
        isCloudConnected: prev.isCloudConnected,
        settings: DEFAULT_SETTINGS,
        sessions: [],
        records: {},
        collections: [],
        woodpeckerCycles: [],
      },
    }));
  }, [commitMutation]);

  return (
    <AppContext.Provider
      value={{
        currentNav,
        setCurrentNav,
        isLoading,
        isAuthChecking,
        isAuthenticated,
        isGuestSession,
        canAccessApp,
        authUser,
        enterAsGuest,
        signInWithEmail,
        signUpWithEmail,
        logout,
        syncStatus,
        syncError,
        isCloudConfigured: isSupabaseConfigured,
        anonymousId: state.anonymousId,
        settings: state.settings,
        updateSettings,
        sessions: state.sessions,
        records: state.records,
        collections: state.collections,
        woodpeckerCycles: state.woodpeckerCycles,
        recordTrainingSession,
        updateModuleExtra,
        saveCollection,
        deleteCollection,
        saveWoodpeckerCycle,
        deleteWoodpeckerCycle,
        resetAllLocalData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

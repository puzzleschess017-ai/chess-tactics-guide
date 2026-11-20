export type NavSectionId =
  | 'dashboard'
  | 'coordinate'
  | 'blindfold'
  | 'knight'
  | 'puzzle-streak'
  | 'puzzle-race'
  | 'woodpecker'
  | 'tactical-themes'
  | 'statistics'
  | 'training-history'
  | 'personal-records'
  | 'settings-board'
  | 'settings-general';

export type BoardTheme =
  | 'maple'
  | 'wood'
  | 'green'
  | 'blue'
  | 'grey'
  | 'dark'
  | 'emerald-night'
  | 'ocean'
  | 'purple'
  | 'coral'
  | 'classic';
export type BoardOrientation = 'white' | 'black';
export type BoardSize = number | 'sm' | 'md' | 'lg';
export type CoordinateDisplay = 'inside' | 'outside' | 'none';
export type PieceSet = 'merida' | 'classic' | 'modern' | 'minimalist' | 'elegant' | 'alpha';
export type DifficultyLevel = 'easy' | 'medium' | 'hard' | 'expert';
export type PuzzleDifficulty = 'medium' | 'hard' | 'expert';

export type TrainingModuleId =
  | 'coordinate'
  | 'blindfold'
  | 'knight'
  | 'puzzle-streak'
  | 'puzzle-race'
  | 'woodpecker'
  | 'tactical-themes';

export interface BoardSettings {
  theme: BoardTheme;
  orientation: BoardOrientation;
  pieceSet?: PieceSet;
  size: BoardSize;
  coordinates: CoordinateDisplay;
  animatePieces: boolean;
  highlightLegalMoves: boolean;
  highlightLastMove: boolean;
}

export interface SoundSettings {
  enabled: boolean;
  moveSound: boolean;
  correctSound: boolean;
  incorrectSound: boolean;
}

export interface GeneralSettings {
  darkTheme: boolean;
  defaultDifficulty: PuzzleDifficulty;
  autoAdvancePuzzles: boolean;
}

export interface UserSettings {
  board: BoardSettings;
  sound: SoundSettings;
  general: GeneralSettings;
}

export interface LichessPuzzle {
  puzzleId: string;
  fen: string; // Position BEFORE opponent's first move (Lichess convention)
  moves: string; // Space-separated UCI moves; moves[0] is opponent's setup move
  rating: number;
  ratingDeviation: number;
  popularity: number;
  nbPlays: number;
  themes: string; // Space-separated Lichess themes
  gameUrl: string;
}

export interface TrainingSessionRecord {
  id: string;
  module: TrainingModuleId;
  mode: string;
  score: number;
  total: number;
  accuracy: number;
  durationMs: number;
  bestMetric?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ModuleRecord {
  module: TrainingModuleId;
  bestStreak?: number;
  bestAccuracy?: number;
  bestTimeMs?: number;
  fastestAvgMs?: number;
  highestRating?: number;
  totalSessions: number;
  totalAttempts: number;
  totalCorrect: number;
  totalTimeMs: number;
  lastUpdatedAt: string;
  extra?: Record<string, number | string>;
}

export interface PuzzleCollection {
  id: string;
  name: string;
  description: string;
  difficulty: PuzzleDifficulty | 'mixed';
  puzzles: LichessPuzzle[];
  createdAt: string;
  updatedAt: string;
}

export interface WoodpeckerCycleLog {
  cycleNumber: number;
  solvedCount: number;
  incorrectCount: number;
  totalPuzzles: number;
  durationMs: number;
  avgTimePerPuzzleMs: number;
  accuracy: number;
  completedAt: string;
}

export interface WoodpeckerCycle {
  id: string;
  collectionId: string;
  name: string;
  targetCycles: number;
  currentCycle: number;
  currentIndex: number;
  shuffle: boolean;
  status: 'active' | 'paused' | 'completed';
  activeElapsedMs: number;
  activeCorrect: number;
  activeIncorrect: number;
  cycleLogs: WoodpeckerCycleLog[];
  puzzleOrder: string[];
  createdAt: string;
  updatedAt: string;
}

export type CloudSyncStatus = 'cloud_synced' | 'local_fallback' | 'syncing' | 'error';

export interface UserPersistedState {
  anonymousId: string;
  isCloudConnected: boolean;
  localUpdatedAt?: string;
  settings: UserSettings;
  sessions: TrainingSessionRecord[];
  records: Record<string, ModuleRecord>;
  collections: PuzzleCollection[];
  woodpeckerCycles: WoodpeckerCycle[];
}

export interface PuzzleDatasetStats {
  totalPuzzles: number;
  sourceLabel: string;
  isSampleDataset: boolean;
  ratingRange: { min: number; max: number };
  themeCounts: Record<string, number>;
}

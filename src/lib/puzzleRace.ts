import { MIN_PUZZLE_RATING } from './puzzleValidator';

export type PuzzleRaceTimeMinutes = 3 | 5 | 10;

export interface RaceTimeOption {
  minutes: PuzzleRaceTimeMinutes;
  label: string;
  durationMs: number;
  subtitle: string;
}

export const RACE_TIME_OPTIONS: RaceTimeOption[] = [
  { minutes: 3, label: '3 Minutes', durationMs: 3 * 60 * 1000, subtitle: 'Fast sprint' },
  { minutes: 5, label: '5 Minutes', durationMs: 5 * 60 * 1000, subtitle: 'Balanced race' },
  { minutes: 10, label: '10 Minutes', durationMs: 10 * 60 * 1000, subtitle: 'Deep marathon' },
];

export type RaceDifficultyTier =
  | 'Beginner'
  | 'Early Intermediate'
  | 'Intermediate'
  | 'Upper Intermediate'
  | 'Advanced'
  | 'Expert';

export interface RaceProgressionStage {
  tierIndex: number;
  tierLabel: RaceDifficultyTier;
  minRating: number;
  maxRating: number;
}

export const RACE_PROGRESSION_STAGES: RaceProgressionStage[] = [
  { tierIndex: 0, tierLabel: 'Beginner', minRating: MIN_PUZZLE_RATING, maxRating: 1360 },
  { tierIndex: 1, tierLabel: 'Early Intermediate', minRating: 1320, maxRating: 1500 },
  { tierIndex: 2, tierLabel: 'Intermediate', minRating: 1450, maxRating: 1650 },
  { tierIndex: 3, tierLabel: 'Upper Intermediate', minRating: 1600, maxRating: 1800 },
  { tierIndex: 4, tierLabel: 'Advanced', minRating: 1750, maxRating: 1990 },
  { tierIndex: 5, tierLabel: 'Expert', minRating: 1980, maxRating: 3200 },
];

/**
 * Smoothly maps clean puzzle solves into overlapping progressive rating bands.
 * Starts at Beginner (1200-1360) and advances every 2 clean solves up through Expert (1980+).
 * Incorrect moves never advance this counter, keeping the next puzzle at the same difficulty.
 */
export function getRaceProgressionStage(cleanSolves: number): RaceProgressionStage {
  const safeSolves = Math.max(0, Math.floor(cleanSolves));
  const stageIdx = Math.min(RACE_PROGRESSION_STAGES.length - 1, Math.floor(safeSolves / 2));
  return RACE_PROGRESSION_STAGES[stageIdx];
}

export function formatRaceModeLabel(mode: string): string {
  if (mode === '3m') return '3 Minutes';
  if (mode === '5m') return '5 Minutes';
  if (mode === '10m') return '10 Minutes';
  return mode;
}

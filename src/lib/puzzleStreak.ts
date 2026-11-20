import { MIN_PUZZLE_RATING } from './puzzleValidator';

export type StreakDifficultyTier =
  | 'Beginner'
  | 'Developing'
  | 'Intermediate'
  | 'Upper Intermediate'
  | 'Advanced'
  | 'Expert'
  | 'Master';

export interface StreakProgressionStage {
  tierIndex: number;
  tierLabel: StreakDifficultyTier;
  minRating: number;
  maxRating: number;
}

export const STREAK_PROGRESSION_STAGES: StreakProgressionStage[] = [
  { tierIndex: 0, tierLabel: 'Beginner', minRating: MIN_PUZZLE_RATING, maxRating: 1360 },
  { tierIndex: 1, tierLabel: 'Developing', minRating: 1320, maxRating: 1500 },
  { tierIndex: 2, tierLabel: 'Intermediate', minRating: 1450, maxRating: 1650 },
  { tierIndex: 3, tierLabel: 'Upper Intermediate', minRating: 1600, maxRating: 1820 },
  { tierIndex: 4, tierLabel: 'Advanced', minRating: 1780, maxRating: 2020 },
  { tierIndex: 5, tierLabel: 'Expert', minRating: 1980, maxRating: 2250 },
  { tierIndex: 6, tierLabel: 'Master', minRating: 2150, maxRating: 3200 },
];

/**
 * Progressive rating ladder for Puzzle Streak:
 * starts at Beginner (1200-1360) and rises smoothly as solved puzzles accumulate.
 */
export function getStreakProgressionStage(solvedCount: number): StreakProgressionStage {
  const safeSolved = Math.max(0, Math.floor(solvedCount));
  if (safeSolved < 2) return STREAK_PROGRESSION_STAGES[0];
  if (safeSolved < 4) return STREAK_PROGRESSION_STAGES[1];
  if (safeSolved < 6) return STREAK_PROGRESSION_STAGES[2];
  if (safeSolved < 9) return STREAK_PROGRESSION_STAGES[3];
  if (safeSolved < 12) return STREAK_PROGRESSION_STAGES[4];
  if (safeSolved < 15) return STREAK_PROGRESSION_STAGES[5];
  return STREAK_PROGRESSION_STAGES[6];
}

export function formatStreakModeLabel(mode: string): string {
  if (mode === 'progressive') return 'Progressive';
  if (mode === 'medium') return 'Beginner';
  if (mode === 'hard') return 'Advanced';
  if (mode === 'expert') return 'Expert';
  return mode;
}

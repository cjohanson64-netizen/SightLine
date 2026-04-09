export interface AssessmentAccessState {
  tier: 'free' | 'paid';
  dailyLimit: number | null;
  usedToday: number;
  remainingToday: number | null;
  canRun: boolean;
  message: string | null;
  blockedMessage: string | null;
}


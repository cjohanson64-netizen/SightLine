import type { AssessmentAccessState } from './types';
import { readAssessmentUsageCount } from './trackAssessmentUsage';

export const FREE_ASSESSMENTS_PER_DAY = 3;
// Temporary switch: leave usage counting intact, but disable free-tier blocking for today.
// Flip back to `true` to restore the daily assessment limit.
const ENFORCE_DAILY_FREE_ASSESSMENT_LIMIT = false;

interface GetAssessmentAccessInput {
  identityKey: string;
  isPaid: boolean;
}

export function getAssessmentAccess({
  identityKey,
  isPaid,
}: GetAssessmentAccessInput): AssessmentAccessState {
  if (isPaid) {
    return {
      tier: 'paid',
      dailyLimit: null,
      usedToday: 0,
      remainingToday: null,
      canRun: true,
      message: null,
      blockedMessage: null,
    };
  }

  const usedToday = readAssessmentUsageCount(identityKey);
  const remainingToday = Math.max(0, FREE_ASSESSMENTS_PER_DAY - usedToday);
  const canRun = ENFORCE_DAILY_FREE_ASSESSMENT_LIMIT ? remainingToday > 0 : true;

  return {
    tier: 'free',
    dailyLimit: FREE_ASSESSMENTS_PER_DAY,
    usedToday,
    remainingToday,
    canRun,
    message: ENFORCE_DAILY_FREE_ASSESSMENT_LIMIT
      ? canRun
        ? `You have ${remainingToday} free assessment${remainingToday === 1 ? '' : 's'} left today.`
        : `You've used your ${FREE_ASSESSMENTS_PER_DAY} free assessments for today.`
      : null,
    blockedMessage:
      ENFORCE_DAILY_FREE_ASSESSMENT_LIMIT && !canRun
        ? `You've used your ${FREE_ASSESSMENTS_PER_DAY} free assessments for today. Upgrade for unlimited assessments.`
        : null,
  };
}

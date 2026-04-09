import type { AssessmentAccessState } from './types';
import { readAssessmentUsageCount } from './trackAssessmentUsage';

export const FREE_ASSESSMENTS_PER_DAY = 3;

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
  const canRun = remainingToday > 0;

  return {
    tier: 'free',
    dailyLimit: FREE_ASSESSMENTS_PER_DAY,
    usedToday,
    remainingToday,
    canRun,
    message: canRun
      ? `You have ${remainingToday} free assessment${remainingToday === 1 ? '' : 's'} left today.`
      : `You've used your ${FREE_ASSESSMENTS_PER_DAY} free assessments for today.`,
    blockedMessage: canRun
      ? null
      : `You've used your ${FREE_ASSESSMENTS_PER_DAY} free assessments for today. Upgrade for unlimited assessments.`,
  };
}

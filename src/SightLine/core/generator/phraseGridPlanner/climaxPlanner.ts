import type { PhraseGridMeasurePlan } from './phraseGridPlanner';
import type { PhrasePlan } from '../phrasePlanner';

export function resolveClimaxOnset(input: {
  measures: PhraseGridMeasurePlan[];
  climaxMeasure: number;
  phrasePlan: PhrasePlan;
}): number {
  const climaxMeasurePlan = input.measures.find(
    (measure) => measure.measure === input.climaxMeasure
  );

  if (!climaxMeasurePlan) {
    return 1;
  }

  if (input.phrasePlan.climaxStyle === 'delayed') {
    return (
      climaxMeasurePlan.onsets[
        Math.max(0, climaxMeasurePlan.onsets.length - 1)
      ] ?? 1
    );
  }

  if (climaxMeasurePlan.onsets.includes(3)) {
    return 3;
  }

  return (
    climaxMeasurePlan.onsets[
      Math.max(0, climaxMeasurePlan.onsets.length - 1)
    ] ?? 1
  );
}
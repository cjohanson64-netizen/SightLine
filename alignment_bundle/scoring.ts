import type { AssayMetric, MelodyEvent } from '../../tat/models/schema';

export interface CandidateScore {
  score: number;
  metrics: AssayMetric[];
}

export function scoreMelody(melody: MelodyEvent[]): CandidateScore {
  if (melody.length === 0) {
    return {
      score: Number.NEGATIVE_INFINITY,
      metrics: [
        { name: 'empty_penalty', value: -1000 },
        { name: 'stepwise_ratio', value: 0 },
        { name: 'range_span', value: 0 }
      ]
    };
  }

  let stepwiseCount = 0;
  let leapPenalty = 0;
  let minMidi = melody[0].midi;
  let maxMidi = melody[0].midi;

  for (let i = 1; i < melody.length; i += 1) {
    const interval = Math.abs(melody[i].midi - melody[i - 1].midi);
    if (interval <= 2) {
      stepwiseCount += 1;
    }
    if (interval > 7) {
      leapPenalty += interval - 7;
    }

    minMidi = Math.min(minMidi, melody[i].midi);
    maxMidi = Math.max(maxMidi, melody[i].midi);
  }

  const stepwiseRatio = stepwiseCount / Math.max(1, melody.length - 1);
  const rangeSpan = maxMidi - minMidi;
  const score = stepwiseRatio * 60 - leapPenalty * 5 - Math.max(0, rangeSpan - 16) * 1.2;

  return {
    score,
    metrics: [
      { name: 'stepwise_ratio', value: Number(stepwiseRatio.toFixed(3)) },
      { name: 'leap_penalty', value: leapPenalty },
      { name: 'range_span', value: rangeSpan },
      { name: 'overall_score', value: Number(score.toFixed(3)) }
    ]
  };
}

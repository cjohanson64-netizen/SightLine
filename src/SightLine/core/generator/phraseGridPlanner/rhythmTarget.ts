import type { RhythmWeights } from '@/SightLine/domain/music';

export type RhythmTarget = {
  EE: number;
  Q: number;
  H: number;
  W: number;
};

export function resolveRhythmTarget(input: {
  rhythmWeights: RhythmWeights;
  rhythmDist?: RhythmTarget;
}): RhythmTarget {
  return (
    input.rhythmDist ?? {
      EE: input.rhythmWeights.eighth,
      Q: input.rhythmWeights.quarter,
      H: input.rhythmWeights.half,
      W: input.rhythmWeights.whole
    }
  );
}
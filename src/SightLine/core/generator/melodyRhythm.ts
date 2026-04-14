import type { ExerciseSpec, RhythmWeights } from "@/SightLine/domain/music";
import { defaultRhythmWeights } from "./melodyPipelineCore";

export interface MelodyRhythmContext {
  effectiveMinEePairsPerPhrase: number;
  maxLeapSemitones: number;
  maxLargeLeapsPerPhrase: number;
  rhythmWeights: RhythmWeights;
}

export function assignRhythm(spec: ExerciseSpec): MelodyRhythmContext {
  const rhythmWeights: RhythmWeights = {
    ...defaultRhythmWeights,
    ...(spec.rhythmWeights ?? {}),
  };
  const configuredMaxLeapSemitones = Math.max(
    1,
    spec.userConstraints?.maxLeapSemitones ?? 12,
  );
  const configuredMaxLargeLeapsPerPhrase = Math.max(
    0,
    spec.userConstraints?.maxLargeLeapsPerPhrase ?? 1,
  );
  const rhythmWeightTotal =
    rhythmWeights.whole +
    rhythmWeights.half +
    rhythmWeights.quarter +
    rhythmWeights.eighth;
  const normalizedEeShare =
    rhythmWeightTotal > 0 ? rhythmWeights.eighth / rhythmWeightTotal : 0;
  const eePairsFromWeight = Math.max(
    0,
    Math.round(normalizedEeShare * Math.max(0, spec.phraseLengthMeasures - 1)),
  );
  const effectiveMinEePairsPerPhrase = Math.max(
    rhythmWeights.minEighthPairsPerPhrase ?? 0,
    eePairsFromWeight,
  );

  return {
    effectiveMinEePairsPerPhrase,
    maxLeapSemitones: configuredMaxLeapSemitones,
    maxLargeLeapsPerPhrase: configuredMaxLargeLeapsPerPhrase,
    rhythmWeights,
  };
}

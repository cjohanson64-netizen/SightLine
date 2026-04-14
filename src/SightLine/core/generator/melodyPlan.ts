import type { ExerciseSpec, PhraseSpec } from "@/SightLine/domain/music";
import { generatePhrasePlan, type PhrasePlan } from "./phrasePlanner";

export interface BuildMelodyPlanInput {
  phraseLengthMeasures: number;
  phraseSpec: PhraseSpec;
  seed: number;
  spec: ExerciseSpec;
  startDegreeUserSpecified: boolean;
}

export function buildMelodyPlan({
  phraseLengthMeasures,
  phraseSpec,
  seed,
  spec,
  startDegreeUserSpecified,
}: BuildMelodyPlanInput): PhrasePlan {
  return generatePhrasePlan({
    measures: phraseLengthMeasures,
    timeSignature: spec.timeSig,
    key: spec.key,
    mode: spec.mode,
    range: spec.range,
    difficulty: 2,
    cadence: phraseSpec.cadence,
    startDegree: spec.startingDegree,
    startDegreeLocked: startDegreeUserSpecified,
    seed,
  });
}

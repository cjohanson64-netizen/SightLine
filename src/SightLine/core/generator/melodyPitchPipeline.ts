import type { ExerciseSpec, HarmonyEvent, MelodyEvent, PhraseSpec } from "@/SightLine/domain/music";
import type { PhraseGridPlan } from "./phraseGridPlanner";
import type { PhrasePlan } from "./phrasePlanner";
import {
  generateStructuralSkeleton,
  mergePrimeWithBaseFirstHalf,
  realizePhraseGridPitches,
  toAbsolutePhraseEvents,
  toRelativePhraseEvents,
} from "./melodyPipelineCore";
import type { MelodySelectionTrace } from "./melody/types";

export interface CachedLabelPhrase {
  eventsRelative: MelodyEvent[];
}

export interface GeneratePitchSequenceInput {
  beatsPerMeasure: number;
  harmony: HarmonyEvent[];
  keyId: string;
  keyScale: number[];
  phraseGrid: PhraseGridPlan;
  phraseIndex: number;
  phraseLengthMeasures: number;
  phrasePlan: PhrasePlan;
  phraseSpec: PhraseSpec;
  prevMidi: number;
  rangeMax: number;
  rangeMin: number;
  seed: number;
  spec: ExerciseSpec;
  startDegreeUserSpecified: boolean;
  tonicPc: number;
  cachedLabelPhrase?: CachedLabelPhrase;
}

export interface PhrasePitchSequenceResult {
  events: MelodyEvent[];
  trace: MelodySelectionTrace[];
}

export function generatePitchSequence(
  input: GeneratePitchSequenceInput,
): PhrasePitchSequenceResult {
  const phraseStartMeasure = input.phraseIndex * input.phraseLengthMeasures + 1;
  const skeleton = generateStructuralSkeleton({
    spec: input.spec,
    phraseSpec: input.phraseSpec,
    phrasePlan: input.phrasePlan,
    phraseIndex: input.phraseIndex,
    phraseLengthMeasures: input.phraseLengthMeasures,
    beatsPerMeasure: input.beatsPerMeasure,
    harmony: input.harmony,
    keyId: input.keyId,
    keyScale: input.keyScale,
    rangeMin: input.rangeMin,
    rangeMax: input.rangeMax,
    maxLeapSemitones: input.spec.userConstraints?.maxLeapSemitones ?? 12,
    tonicPc: input.tonicPc,
    seed: input.seed,
    startPrevMidi: input.prevMidi,
    startDegreePreference: input.spec.startingDegree,
    startDegreeUserSpecified: input.startDegreeUserSpecified,
    phraseGrid: input.phraseGrid,
  });

  const realized = realizePhraseGridPitches({
    spec: input.spec,
    phraseSpec: input.phraseSpec,
    phraseIndex: input.phraseIndex,
    phraseLengthMeasures: input.phraseLengthMeasures,
    beatsPerMeasure: input.beatsPerMeasure,
    phraseGrid: input.phraseGrid,
    harmony: input.harmony,
    skeleton,
    keyId: input.keyId,
    keyScale: input.keyScale,
    rangeMin: input.rangeMin,
    rangeMax: input.rangeMax,
    maxLeapSemitones: input.spec.userConstraints?.maxLeapSemitones ?? 12,
    seed: input.seed,
  });

  let phraseEventsForOutput = realized.melody;
  if (input.phraseSpec.prime && input.cachedLabelPhrase) {
    const generatedRelative = toRelativePhraseEvents(
      phraseEventsForOutput,
      phraseStartMeasure,
    );
    const mergedRelative = mergePrimeWithBaseFirstHalf(
      generatedRelative,
      input.cachedLabelPhrase.eventsRelative,
      input.phraseLengthMeasures,
      input.beatsPerMeasure,
    );
    phraseEventsForOutput = toAbsolutePhraseEvents(
      mergedRelative,
      phraseStartMeasure,
      input.phraseIndex + 1,
    );
  }

  return {
    events: phraseEventsForOutput,
    trace: realized.trace,
  };
}

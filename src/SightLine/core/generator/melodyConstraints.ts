import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";
import { runPhraseConstraintPasses, runFinalizationPipeline } from "./melody/passRunner";
import type { MelodySelectionTrace } from "./melody/types";
import {
  applyDominantTendencyVoiceLeadingPass,
  applyIllegalRulesAdjacencyPass,
  applyUserConstraintsPass10,
  buildPlaybackArrayPass5,
  countEePairs,
  enforceEePairMelodicRules,
  enforceLeapBudgetPerPhrasePass,
  filterRenderableAttackEvents,
  noteValueCounts,
  removeStrayPhraseStartTrailingEighths,
  renderPlaybackPass11,
  validateAllMustPass10,
} from "./melodyPipelineCore";
import { midiToDegree } from "./melody/utils";

export interface ApplyPhraseMelodyConstraintsInput {
  beatsPerMeasure: number;
  events: MelodyEvent[];
  keyId: string;
  keyScale: number[];
  maxLargeLeapsPerPhrase: number;
  maxLeapSemitones: number;
  rangeMax: number;
  rangeMin: number;
  spec: ExerciseSpec;
  tonicPc: number;
}

export function applyMelodyConstraints(
  input: ApplyPhraseMelodyConstraintsInput,
): MelodyEvent[] {
  const phrasePasses = runPhraseConstraintPasses({
    events: input.events,
    applyIllegalRulesAdjacencyPass,
    applyDominantTendencyVoiceLeadingPass,
    enforceLeapBudgetPerPhrasePass,
    enforceEePairMelodicRules,
    passContext: {
      spec: input.spec,
      keyScale: input.keyScale,
      rangeMin: input.rangeMin,
      rangeMax: input.rangeMax,
      maxLeapSemitones: input.maxLeapSemitones,
      maxLargeLeapsPerPhrase: input.maxLargeLeapsPerPhrase,
      beatsPerMeasure: input.beatsPerMeasure,
      keyId: input.keyId,
      tonicPc: input.tonicPc,
    },
  });

  if (phrasePasses.leapBudgetRepairs > 0) {
    console.debug(
      `[pass5-leapBudget] repairs=${phrasePasses.leapBudgetRepairs}`,
    );
  }

  return phrasePasses.events;
}

export interface FinalizeMelodyConstraintsInput {
  beatsPerMeasure: number;
  keyId: string;
  keyScale: number[];
  melody: MelodyEvent[];
  phrases: ExerciseSpec["phrases"];
  phraseLengthMeasures: number;
  rangeMax: number;
  rangeMin: number;
  spec: ExerciseSpec;
}

export function finalizeMelodyConstraints(
  input: FinalizeMelodyConstraintsInput,
): MelodyEvent[] {
  const lastPhraseCadence =
    input.phrases[input.phrases.length - 1]?.cadence ?? "authentic";
  const computedCadenceType: "authentic" | "half" | "plagal" =
    lastPhraseCadence === "half"
      ? "half"
      : lastPhraseCadence === "plagal"
        ? "plagal"
        : "authentic";
  const userCadenceType =
    input.spec.userConstraints?.cadenceType ?? computedCadenceType;
  const userMinEePairs =
    input.spec.userConstraints?.minEighthPairsPerPhrase ??
    input.spec.rhythmWeights?.minEighthPairsPerPhrase ??
    0;

  const { pass5ConstraintSweep, pass5FinalMelody: initialPass5FinalMelody } =
    runFinalizationPipeline({
      melody: input.melody,
      beatsPerMeasure: input.beatsPerMeasure,
      buildPlaybackArrayPass5,
      filterRenderableAttackEvents,
      applyUserConstraintsPass10,
      pass10Ctx: {
        keyId: input.keyId,
        mode: input.spec.mode,
        tessitura: { minMidi: input.rangeMin, maxMidi: input.rangeMax },
        illegalDegrees: input.spec.illegalDegrees,
        illegalIntervalsSemis: input.spec.illegalIntervalsSemis,
        illegalTransitions: input.spec.illegalTransitions,
        allowedNoteValues: input.spec.userConstraints?.allowedNoteValues,
        lockFinalRhythmFromPass2: true,
        user: {
          hardStartDo: input.spec.userConstraints?.hardStartDo === true,
          cadenceType: userCadenceType,
          endOnDoHard:
            input.spec.userConstraints?.endOnDoHard ??
            (userCadenceType !== "half"),
          rhythmDist: undefined,
          minEighthPairsPerPhrase: userMinEePairs,
          maxLeapSemitones:
            input.spec.userConstraints?.maxLeapSemitones ?? 12,
        },
        beatsPerMeasure: input.beatsPerMeasure,
      },
    });

  const pass5FinalMelody = removeStrayPhraseStartTrailingEighths(
    initialPass5FinalMelody,
    input.phraseLengthMeasures,
    input.beatsPerMeasure,
  );
  const pass6Playback = renderPlaybackPass11(pass5FinalMelody, {
    beatsPerMeasure: input.beatsPerMeasure,
  });
  const finalCounts = noteValueCounts(pass5FinalMelody);
  const finalAttacks = filterRenderableAttackEvents(pass5FinalMelody);
  const firstDegree = finalAttacks[0]
    ? midiToDegree(finalAttacks[0].midi, input.keyScale)
    : null;
  const lastDegree =
    finalAttacks.length > 0
      ? midiToDegree(finalAttacks[finalAttacks.length - 1].midi, input.keyScale)
      : null;
  const pass5Validation = validateAllMustPass10(pass5FinalMelody, {
    keyId: input.keyId,
    mode: input.spec.mode,
    tessitura: { minMidi: input.rangeMin, maxMidi: input.rangeMax },
    illegalDegrees: input.spec.illegalDegrees,
    illegalIntervalsSemis: input.spec.illegalIntervalsSemis,
    illegalTransitions: input.spec.illegalTransitions,
    allowedNoteValues: input.spec.userConstraints?.allowedNoteValues,
    user: {
      hardStartDo: input.spec.userConstraints?.hardStartDo === true,
      cadenceType: userCadenceType,
      minEighthPairsPerPhrase: userMinEePairs,
      maxLeapSemitones: input.spec.userConstraints?.maxLeapSemitones ?? 12,
    },
    beatsPerMeasure: input.beatsPerMeasure,
  });

  console.debug(
    `[pass5] startDeg=${String(firstDegree)} endDeg=${String(lastDegree)} eePairs=${countEePairs(pass5FinalMelody)} W=${finalCounts.W} H=${finalCounts.H} Q=${finalCounts.Q} EE=${finalCounts.EE} mustViolations=${pass5Validation.violations.length}`,
  );
  console.debug(`[pass6-playback] events=${pass6Playback.length}`);
  if (pass5ConstraintSweep.constraintLog.length > 0) {
    console.debug(`[pass5] constraints=${pass5ConstraintSweep.constraintLog.length}`);
  }

  return pass5FinalMelody;
}

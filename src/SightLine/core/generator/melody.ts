import type { ExerciseSpec, HarmonyEvent, PhraseSpec } from "@/SightLine/domain/music";
import { KEY_TO_PC } from "../midi";
import type { TonnetzGraph } from "../tonnetz/buildTonnetz";
import { buildMelodyGrid } from "./melodyGrid";
import { applyMelodyConstraints, finalizeMelodyConstraints } from "./melodyConstraints";
import { finalizeMelody } from "./melodyFinalize";
import { buildMelodyPlan } from "./melodyPlan";
import {
  type CachedLabelPhrase,
  generatePitchSequence,
} from "./melodyPitchPipeline";
import {
  defaultRhythmWeights,
  filterRenderableAttackEvents,
  getFinalRenderEvents,
  insertSmoothingEighthFill,
  normalizeAndValidatePass0,
  parseRangeByScaleDegree,
  modeScale,
  renderPlaybackPass11,
  repairPass4,
  rewriteAttacksAndQuantizeByMeasure,
  tieMergeRepeatedPitchesInMeasure,
  applyRhythmTemplates,
} from "./melodyPipelineCore";
import { assignRhythm } from "./melodyRhythm";
import type {
  MelodyCandidateResult,
  MelodyGenerationOutput,
  MelodyNoSolutionDetails,
  MelodySelectionTrace,
  Pass10ConstraintLogEntry,
  Pass10UserConstraintContext,
  Pass4RepairContext,
  Pass4RepairLogEntry,
  PlaybackEvent,
  MeasureTemplateId,
  RewriteAttackOptions,
} from "./melody/types";
import { toRelativePhraseEvents } from "./melodyPipelineCore";

export type {
  MeasureTemplateId,
  MelodyCandidateResult,
  MelodyGenerationOutput,
  MelodyNoSolutionDetails,
  MelodySelectionTrace,
  Pass10ConstraintLogEntry,
  Pass10UserConstraintContext,
  Pass4RepairContext,
  Pass4RepairLogEntry,
  PlaybackEvent,
  RewriteAttackOptions,
} from "./melody/types";

export {
  applyRhythmTemplates,
  defaultRhythmWeights,
  filterRenderableAttackEvents,
  getFinalRenderEvents,
  insertSmoothingEighthFill,
  renderPlaybackPass11,
  repairPass4,
  rewriteAttacksAndQuantizeByMeasure,
  tieMergeRepeatedPitchesInMeasure,
};

export class MelodyNoSolutionError extends Error {
  readonly details: MelodyNoSolutionDetails;

  constructor(details: MelodyNoSolutionDetails) {
    super("constraints_too_strict");
    this.name = "MelodyNoSolutionError";
    this.details = details;
  }
}

type LabelKey = PhraseSpec["label"];

export function createMelodyCandidates(
  spec: ExerciseSpec,
  harmony: HarmonyEvent[],
  _tonnetz: TonnetzGraph,
  seed: number,
): MelodyGenerationOutput {
  const normalizedSpec = normalizeAndValidatePass0(spec);
  const [rangeMin, rangeMax] = parseRangeByScaleDegree(normalizedSpec);
  const beatsPerMeasure = Math.max(
    1,
    Number(normalizedSpec.timeSig.split("/")[0]) || 4,
  );
  const phraseLengthMeasures = normalizedSpec.phraseLengthMeasures;
  const phrases: PhraseSpec[] =
    normalizedSpec.phrases.length > 0
      ? normalizedSpec.phrases
      : [{ label: "A", prime: false, cadence: "authentic" }];

  const tonicPc = KEY_TO_PC[normalizedSpec.key] ?? 0;
  const scale = modeScale(normalizedSpec.mode);
  const keyScale = scale.map((step) => (tonicPc + step) % 12);
  const keyId = `${normalizedSpec.key}-${normalizedSpec.mode}`;
  const variants = 3;
  const results: MelodyCandidateResult[] = [];
  const startDegreeUserSpecified =
    normalizedSpec.userConstraints?.startDegreeLocked === true;
  const rhythmContext = assignRhythm(normalizedSpec);

  for (let variant = 0; variant < variants; variant += 1) {
    const melody = [];
    const trace: MelodySelectionTrace[] = [];
    const labelPhraseCache = new Map<LabelKey, CachedLabelPhrase>();
    let prevMidi = Math.max(rangeMin, Math.min(rangeMax, 60 + variant));

    for (let phraseIndex = 0; phraseIndex < phrases.length; phraseIndex += 1) {
      const phraseSpec = phrases[phraseIndex];
      const phraseStartMeasure = phraseIndex * phraseLengthMeasures + 1;
      const cachedLabelPhrase = labelPhraseCache.get(phraseSpec.label);

      if (!phraseSpec.prime && cachedLabelPhrase) {
        const copied = cachedLabelPhrase.eventsRelative.map((event) => ({
          ...event,
          measure: event.measure + phraseStartMeasure - 1,
          phraseIndex: phraseIndex + 1,
        }));
        melody.push(...copied);
        prevMidi = copied[copied.length - 1]?.midi ?? prevMidi;
        trace.push({
          measure: phraseStartMeasure,
          beat: 1,
          steps: [
            {
              step: "phraseReuse",
              remainingCandidateCount: copied.length,
              reason: `reused_label=${phraseSpec.label}`,
            },
          ],
        });
        continue;
      }

      const phrasePlan = buildMelodyPlan({
        phraseLengthMeasures,
        phraseSpec,
        seed: seed + variant * 131 + phraseIndex * 977,
        spec: normalizedSpec,
        startDegreeUserSpecified,
      });
      console.debug(
        `[pass2] phrase=${phraseIndex + 1} direction=${phrasePlan.direction} start=${phrasePlan.startDegree} peakM=${phrasePlan.peakMeasure} peakDeg=${phrasePlan.peakDegree} cadence=[${phrasePlan.cadenceDegrees.join(",")}] targets=${phrasePlan.targets.map((target) => `${target.measure}.${target.beat}:${target.targetDegree}:${target.priority}`).join("|")}`,
      );

      const phraseGrid = buildMelodyGrid({
        phrasePlan,
        phraseSpec,
        phraseStartMeasure,
        phraseLengthMeasures,
        beatsPerMeasure,
        seed: seed + variant * 577 + phraseIndex * 43,
        rhythmWeights: {
          ...rhythmContext.rhythmWeights,
          minEighthPairsPerPhrase: rhythmContext.effectiveMinEePairsPerPhrase,
        },
        rhythmDist: normalizedSpec.userConstraints?.rhythmDist,
        minEighthPairsPerPhrase:
          normalizedSpec.userConstraints?.minEighthPairsPerPhrase ??
          rhythmContext.effectiveMinEePairsPerPhrase,
        lockRhythmConstraints: true,
        allowedNoteValues: normalizedSpec.userConstraints?.allowedNoteValues,
      });

      const pass2Target = normalizedSpec.userConstraints?.rhythmDist ?? {
        W: rhythmContext.rhythmWeights.whole,
        H: rhythmContext.rhythmWeights.half,
        Q: rhythmContext.rhythmWeights.quarter,
        EE: rhythmContext.rhythmWeights.eighth,
      };
      console.debug(
        `[pass2-grid] phrase=${phraseIndex + 1} plan=${phraseGrid.measures.map((m) => `m${m.measure}:${m.templateId}[${m.onsets.join(",")}]`).join(" ")}`,
      );
      console.debug(
        `[pass2-grid] phrase=${phraseIndex + 1} lock=true countsTarget(W/H/Q/EE)=${pass2Target.W}/${pass2Target.H}/${pass2Target.Q}/${pass2Target.EE} countsGrid(W/H/Q/EE)=${phraseGrid.noteValueCounts.W}/${phraseGrid.noteValueCounts.H}/${phraseGrid.noteValueCounts.Q}/${phraseGrid.noteValueCounts.EE}`,
      );

      const phrasePitchSequence = generatePitchSequence({
        beatsPerMeasure,
        harmony,
        keyId,
        keyScale,
        phraseGrid,
        phraseIndex,
        phraseLengthMeasures,
        phrasePlan,
        phraseSpec,
        prevMidi,
        rangeMax,
        rangeMin,
        seed: seed + variant * 811 + phraseIndex * 31,
        spec: {
          ...normalizedSpec,
          userConstraints: {
            ...normalizedSpec.userConstraints,
            maxLeapSemitones: rhythmContext.maxLeapSemitones,
          },
        },
        startDegreeUserSpecified,
        tonicPc,
        cachedLabelPhrase,
      });

      let phraseEventsForOutput = applyMelodyConstraints({
        beatsPerMeasure,
        events: phrasePitchSequence.events,
        keyId,
        keyScale,
        maxLargeLeapsPerPhrase: rhythmContext.maxLargeLeapsPerPhrase,
        maxLeapSemitones: rhythmContext.maxLeapSemitones,
        rangeMax,
        rangeMin,
        spec: normalizedSpec,
        tonicPc,
      });
      const eighthEvents = phraseEventsForOutput.filter(
        (event) => (event.durationBeats ?? 0) === 0.5,
      ).length;
      console.debug(
        `[rhythm] phrase=${phraseIndex + 1} eighthEvents=${eighthEvents} eeMeasures=[${phraseGrid.eeMeasures.join(",")}]`,
      );

      melody.push(...phraseEventsForOutput);
      trace.push(...phrasePitchSequence.trace);
      prevMidi =
        phraseEventsForOutput[phraseEventsForOutput.length - 1]?.midi ?? prevMidi;
      if (!labelPhraseCache.has(phraseSpec.label)) {
        labelPhraseCache.set(phraseSpec.label, {
          eventsRelative: toRelativePhraseEvents(
            phraseEventsForOutput,
            phraseStartMeasure,
          ),
        });
      }
    }

    const constrainedMelody = finalizeMelodyConstraints({
      beatsPerMeasure,
      keyId,
      keyScale,
      melody,
      phrases,
      phraseLengthMeasures,
      rangeMax,
      rangeMin,
      spec: {
        ...normalizedSpec,
        userConstraints: {
          ...normalizedSpec.userConstraints,
          maxLeapSemitones: rhythmContext.maxLeapSemitones,
        },
      },
    });

    results.push({
      melody: finalizeMelody(constrainedMelody),
      trace,
      relaxationTier: 0,
      relaxedRules: [],
    });
  }

  if (results.length === 0) {
    return {
      status: "no_solution",
      reasonCode: "constraints_too_strict",
      details: {
        illegalDegrees: [...spec.illegalDegrees],
        illegalIntervalsSemis: [...spec.illegalIntervalsSemis],
        illegalTransitions: [...spec.illegalTransitions],
      },
    };
  }

  return {
    status: "ok",
    candidates: results,
  };
}

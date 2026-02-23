import type { ExerciseSpec, HarmonyEvent, MelodyEvent, PhraseSpec, RhythmWeights } from '../../tat/models/schema';
import type { TonnetzGraph } from '../tonnetz/buildTonnetz';
import { generatePhrasePlan, type PhrasePlan } from './phrasePlanner';
import { generatePhraseGrid, type PhraseGridPlan } from './phraseGridPlanner';
import { applyCadencePolicy } from './cadenceVoiceLeading';
import type {
  CadenceSlotContext,
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
  RewriteAttackOptions
} from './melody/types';
import { runFinalizationPipeline, runPhraseConstraintPasses } from './melody/passRunner';
import {
  chordToneCandidatesInRange,
  collectCandidateMidisFromPcs,
  degreeCandidatesInRange,
  midiToDegree,
  nearestAllowedPcWithinLeapCap,
  nearestChordToneMidi,
  nearestMidiWithPcInRange,
  nearestPcWithinLeapCap,
  nextScaleStepMidi,
  toOctave,
  toPitchName,
  toPitchString
} from './melody/utils';

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
  PlaybackEvent
} from './melody/types';

const KEY_TO_PC: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11
};

const ENVELOPE_AMPLITUDE_MIDI = 6;
const W_ENVELOPE = 1.3;
const W_VOICE_LEADING = 0.42;
const W_HARMONY = 9;
const W_UP_AFTER_CLIMAX = 1.8;
const W_FINAL_NON_DO_MI = 120;
const W_FINAL_SOL = 220;
const W_HALF_FINAL_SOL_REWARD = 12;
const W_HALF_FINAL_OTHER_PENALTY = 7;
const W_FIRST_DO_REWARD = 5;
const W_FIRST_SOL_PENALTY = 5;
const W_PRE_CLIMAX_LEAP_INTO = 6;
const W_PRE_CLIMAX_ASC_STEP = 2;
const W_CLIMAX_BIG_UP_LEAP_REWARD = 5;
const W_POST_CLIMAX_LEAP = 14;
const W_POST_CLIMAX_LARGE_DOWN_LEAP = 24;
const W_POST_CLIMAX_STEP_DOWN_REWARD = 7;
const W_LEAP_RECOVERY_FAIL = 12;
const W_SOFT_CEILING = 4;
const MAX_MELODIC_LEAP_SEMIS = 12;
const DEBUG_INTERVAL_CAP = false;

export class MelodyNoSolutionError extends Error {
  readonly details: MelodyNoSolutionDetails;

  constructor(details: MelodyNoSolutionDetails) {
    super('constraints_too_strict');
    this.name = 'MelodyNoSolutionError';
    this.details = details;
  }
}

interface StructuralSlot {
  localMeasure: number;
  globalMeasure: number;
  beat: number;
  index: number;
  durationToNextBeats: number;
  harmonyEvent: HarmonyEvent;
  cadenceContext?: CadenceSlotContext;
  envelopeTargetMidi: number;
}

interface StructuralSelection {
  slots: StructuralSlot[];
  notes: MelodyEvent[];
  trace: MelodySelectionTrace[];
  endMidi: number;
}

interface EmbellishInput {
  spec: ExerciseSpec;
  phraseIndex: number;
  phraseLengthMeasures: number;
  beatsPerMeasure: number;
  phraseSpec: PhraseSpec;
  harmony: HarmonyEvent[];
  skeleton: StructuralSelection;
  keyId: string;
  keyScale: number[];
  rangeMin: number;
  rangeMax: number;
  maxLeapSemitones: number;
  seed: number;
}

interface RhythmMeasureTags {
  measure: number;
  is_final_measure: boolean;
  is_pre_cadence_measure: boolean;
  has_climax_in_measure: boolean;
  needs_smoothing_in_measure: boolean;
  run_intensity: number;
  stability_needed: boolean;
}

type RhythmTemplate = {
  id: MeasureTemplateId;
  grid: number[];
  counts: { whole: number; half: number; quarter: number; eighth: number };
  tags: { stable?: boolean; run?: boolean; smoothing?: boolean; climax?: boolean; cadence?: boolean };
};

export const defaultRhythmWeights: RhythmWeights = {
  whole: 0.2,
  half: 0.6,
  quarter: 1.0,
  eighth: 1.4,
  minEighthPairsPerPhrase: 1,
  preferEighthInPreClimax: true
};

function normalizeAndValidatePass0(spec: ExerciseSpec): ExerciseSpec {
  const normalized: ExerciseSpec = {
    ...spec,
    rhythmWeights: {
      ...defaultRhythmWeights,
      ...(spec.rhythmWeights ?? {})
    },
    userConstraints: {
      ...(spec.userConstraints ?? {})
    }
  };
  const weights = normalized.rhythmWeights!;
  const rhythmPercentTotal = weights.whole + weights.half + weights.quarter + weights.eighth;
  if (Math.abs(rhythmPercentTotal - 100) > 1e-6) {
    throw new Error(`input_invalid_rhythm_weight_total expected=100 actual=${rhythmPercentTotal}`);
  }
  const inferredCadenceType: 'authentic' | 'half' =
    normalized.userConstraints?.cadenceType ??
    ((normalized.phrases[normalized.phrases.length - 1]?.cadence ?? 'authentic') === 'half' ? 'half' : 'authentic');
  normalized.userConstraints = {
    startDegreeLocked: normalized.userConstraints?.startDegreeLocked === true,
    hardStartDo: normalized.userConstraints?.hardStartDo === true,
    cadenceType: inferredCadenceType,
    endOnDoHard: normalized.userConstraints?.endOnDoHard ?? (inferredCadenceType !== 'half'),
    maxLeapSemitones: Math.max(1, normalized.userConstraints?.maxLeapSemitones ?? MAX_MELODIC_LEAP_SEMIS),
    maxLargeLeapsPerPhrase: Number.isFinite(normalized.userConstraints?.maxLargeLeapsPerPhrase)
      ? Math.max(0, Math.floor(normalized.userConstraints?.maxLargeLeapsPerPhrase ?? 1))
      : 1,
    minEighthPairsPerPhrase: Math.max(
      0,
      normalized.userConstraints?.minEighthPairsPerPhrase ?? normalized.rhythmWeights?.minEighthPairsPerPhrase ?? 0
    ),
    allowedNoteValues: Array.from(
      new Set((normalized.userConstraints?.allowedNoteValues ?? ['EE', 'Q', 'H']) as Array<'EE' | 'Q' | 'H' | 'W'>)
    ),
    rhythmDist: normalized.userConstraints?.rhythmDist ?? {
      EE: weights.eighth,
      Q: weights.quarter,
      H: weights.half,
      W: weights.whole
    }
  };
  if ((normalized.userConstraints.allowedNoteValues?.length ?? 0) === 4) {
    throw new Error('input_invalid_allowed_note_values_max_three');
  }
  return normalized;
}

const RHYTHM_TEMPLATES: RhythmTemplate[] = [
  {
    id: 'STABLE',
    grid: [1, 2, 3, 4],
    counts: { whole: 0, half: 0, quarter: 4, eighth: 0 },
    tags: { stable: true }
  },
  {
    id: 'SMOOTH_BEAT1',
    grid: [1, 1.5, 2, 3, 4],
    counts: { whole: 0, half: 0, quarter: 3, eighth: 2 },
    tags: { smoothing: true, run: true }
  },
  {
    id: 'SMOOTH_BEAT2',
    grid: [1, 2, 2.5, 3, 4],
    counts: { whole: 0, half: 0, quarter: 3, eighth: 2 },
    tags: { smoothing: true, run: true }
  },
  {
    id: 'SMOOTH_BEAT3',
    grid: [1, 2, 3, 3.5, 4],
    counts: { whole: 0, half: 0, quarter: 3, eighth: 2 },
    tags: { smoothing: true, run: true }
  },
  {
    id: 'RUN_EEEEH',
    grid: [1, 1.5, 2, 2.5, 3],
    counts: { whole: 0, half: 1, quarter: 0, eighth: 4 },
    tags: { run: true, smoothing: true }
  },
  {
    id: 'RUN_HEEEE',
    grid: [1, 3, 3.5, 4, 4.5],
    counts: { whole: 0, half: 1, quarter: 0, eighth: 4 },
    tags: { run: true, smoothing: true }
  },
  {
    id: 'CADENCE_W',
    grid: [1],
    counts: { whole: 1, half: 0, quarter: 0, eighth: 0 },
    tags: { cadence: true }
  },
  {
    id: 'CADENCE_HH',
    grid: [1, 3],
    counts: { whole: 0, half: 2, quarter: 0, eighth: 0 },
    tags: { cadence: true }
  },
  {
    id: 'CLIMAX_SIMPLE',
    grid: [1, 3],
    counts: { whole: 0, half: 2, quarter: 0, eighth: 0 },
    tags: { climax: true }
  }
];

function templateById(id: MeasureTemplateId): RhythmTemplate {
  return RHYTHM_TEMPLATES.find((template) => template.id === id) ?? RHYTHM_TEMPLATES[0];
}

function durationToDivisions(duration: string): number {
  if (duration === 'whole') {
    return 8;
  }
  if (duration === 'half') {
    return 4;
  }
  if (duration === 'eighth') {
    return 1;
  }
  return 2;
}

function divisionsToDuration(divisions: number): string {
  if (divisions >= 8) {
    return 'whole';
  }
  if (divisions >= 4) {
    return 'half';
  }
  if (divisions <= 1) {
    return 'eighth';
  }
  return 'quarter';
}

function modeScale(mode: ExerciseSpec['mode']): number[] {
  return mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
}

function cadenceTail(cadence: PhraseSpec['cadence']): [number, number] {
  if (cadence === 'plagal') {
    return [4, 1];
  }
  if (cadence === 'half') {
    return [2, 5];
  }
  return [5, 1];
}

function chordForDegree(tonicPc: number, mode: ExerciseSpec['mode'], degree: number): number[] {
  const scale = modeScale(mode);
  const root = (tonicPc + scale[(degree - 1) % 7]) % 12;
  const third = (tonicPc + scale[(degree + 1) % 7]) % 12;
  const fifth = (tonicPc + scale[(degree + 3) % 7]) % 12;
  return [root, third, fifth];
}

function qualityByDegree(mode: ExerciseSpec['mode'], degree: number): HarmonyEvent['quality'] {
  if (mode === 'major') {
    const map: HarmonyEvent['quality'][] = ['major', 'minor', 'minor', 'major', 'major', 'minor', 'diminished'];
    return map[(degree - 1) % 7];
  }
  const map: HarmonyEvent['quality'][] = ['minor', 'diminished', 'major', 'minor', 'minor', 'major', 'major'];
  return map[(degree - 1) % 7];
}

function parseRangeByScaleDegree(spec: ExerciseSpec): [number, number] {
  const tonicPc = KEY_TO_PC[spec.key] ?? 0;
  const scale = modeScale(spec.mode);
  const lowPc = (tonicPc + scale[(spec.range.lowDegree - 1 + 700) % 7]) % 12;
  const highPc = (tonicPc + scale[(spec.range.highDegree - 1 + 700) % 7]) % 12;
  const lowMidi = (spec.range.lowOctave + 1) * 12 + lowPc;
  const highMidi = (spec.range.highOctave + 1) * 12 + highPc;
  return lowMidi <= highMidi ? [lowMidi, highMidi] : [highMidi, lowMidi];
}

function activeHarmonyForBeat(harmony: HarmonyEvent[], measure: number, beat: number): HarmonyEvent {
  const inMeasure = harmony.filter((event) => event.measure === measure);
  if (inMeasure.length === 0) {
    return harmony[harmony.length - 1] ?? harmony[0];
  }

  const sorted = [...inMeasure].sort((a, b) => a.beat - b.beat);
  const onOrBefore = sorted.filter((event) => event.beat <= beat);
  return onOrBefore[onOrBefore.length - 1] ?? sorted[0];
}

function resolveHarmonyEvent(
  harmony: HarmonyEvent[],
  slotGlobalMeasure: number,
  slotBeat: number,
  phraseLengthMeasures: number,
  beatsPerMeasure: number,
  phraseSpec: PhraseSpec,
  tonicPc: number,
  mode: ExerciseSpec['mode']
): HarmonyEvent {
  const [cadencePenultDegree, cadenceFinalDegree] = cadenceTail(phraseSpec.cadence);
  const localM = ((slotGlobalMeasure - 1) % phraseLengthMeasures) + 1;
  const isPenult = localM === phraseLengthMeasures && beatsPerMeasure >= 2 && slotBeat === beatsPerMeasure - 1;
  const isFinal = localM === phraseLengthMeasures && beatsPerMeasure >= 2 && slotBeat === beatsPerMeasure;

  if (isPenult || isFinal) {
    const degree = isFinal ? cadenceFinalDegree : cadencePenultDegree;
    const chord = chordForDegree(tonicPc, mode, degree);
    return {
      measure: slotGlobalMeasure,
      beat: slotBeat,
      degree,
      rootPc: chord[0],
      chordPcs: chord,
      quality: qualityByDegree(mode, degree)
    };
  }

  return activeHarmonyForBeat(harmony, slotGlobalMeasure, slotBeat);
}

function deterministicUnit(seed: number): number {
  const x = (1664525 * (seed >>> 0) + 1013904223) >>> 0;
  return x / 0x100000000;
}

function debugInterval(message: string): void {
  if (DEBUG_INTERVAL_CAP) {
    console.debug(message);
  }
}

function isStrongBeat(beat: number): boolean {
  return beat === 1 || beat === 3;
}

function tonicCandidatesInOctaveSpan(tonicPc: number, lowOctave: number, highOctave: number): number[] {
  const result: number[] = [];
  for (let octave = lowOctave; octave <= highOctave; octave += 1) {
    result.push((octave + 1) * 12 + tonicPc);
  }
  return result;
}


function findClimaxIndex(slots: StructuralSlot[], peakMeasure: number): number {
  if (slots.length === 0) {
    return 0;
  }

  const exactBeatOne = slots.findIndex((slot) => slot.localMeasure === peakMeasure && slot.beat === 1);
  if (exactBeatOne !== -1) {
    return exactBeatOne;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < slots.length; i += 1) {
    const distance = Math.abs(slots[i].localMeasure - peakMeasure) * 4 + Math.abs(slots[i].beat - 1);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function choosePass3ClimaxIndex(
  slots: StructuralSlot[],
  phrasePlanPeakMeasure: number,
  phraseGrid?: PhraseGridPlan
): number {
  if (slots.length === 0) {
    return 0;
  }
  const gridByMeasure = new Map<number, PhraseGridPlan['measures'][number]>();
  for (const measurePlan of phraseGrid?.measures ?? []) {
    gridByMeasure.set(measurePlan.measure, measurePlan);
  }

  let bestIdx = findClimaxIndex(slots, phrasePlanPeakMeasure);
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const inCadence = slot.cadenceContext?.slotTag === 'final';
    const longLanding = slot.durationToNextBeats >= 2;
    const measurePlan = gridByMeasure.get(slot.globalMeasure);
    const prevMeasurePlan = gridByMeasure.get(slot.globalMeasure - 1);
    const runIntoClimax =
      measurePlan?.templateId === 'SMOOTH_BEAT1' ||
      measurePlan?.templateId === 'RUN_EEEEH' ||
      measurePlan?.templateId === 'RUN_HEEEE' ||
      (measurePlan?.templateId === 'SMOOTH_BEAT2' && Math.abs(slot.beat - 3) < 0.001) ||
      (measurePlan?.templateId === 'SMOOTH_BEAT3' && Math.abs(slot.beat - 4) < 0.001) ||
      prevMeasurePlan?.templateId === 'SMOOTH_BEAT1' ||
      prevMeasurePlan?.templateId === 'RUN_EEEEH' ||
      prevMeasurePlan?.templateId === 'RUN_HEEEE' ||
      prevMeasurePlan?.templateId === 'SMOOTH_BEAT2' ||
      prevMeasurePlan?.templateId === 'SMOOTH_BEAT3';

    const measureDistance = Math.abs(slot.localMeasure - phrasePlanPeakMeasure);
    const beatDistanceFrom3 = Math.abs(slot.beat - 3);
    let score = measureDistance * 10 + beatDistanceFrom3 * 2;
    if (longLanding) {
      score -= 8;
    }
    if (runIntoClimax) {
      score -= 5;
    }
    if (inCadence) {
      score += 6;
    }
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function retuneEventMidi(event: MelodyEvent, midi: number): MelodyEvent {
  const pc = ((midi % 12) + 12) % 12;
  const octave = toOctave(midi);
  return {
    ...event,
    pitch: `${toPitchName(pc)}${octave}`,
    octave,
    midi,
    role: 'ChordTone',
    nonHarmonicTone: false
  };
}

export function generateStructuralSkeleton(input: {
  spec: ExerciseSpec;
  phraseSpec: PhraseSpec;
  phrasePlan: PhrasePlan;
  phraseIndex: number;
  phraseLengthMeasures: number;
  beatsPerMeasure: number;
  harmony: HarmonyEvent[];
  keyId: string;
  keyScale: number[];
  rangeMin: number;
  rangeMax: number;
  maxLeapSemitones: number;
  tonicPc: number;
  seed: number;
  startPrevMidi: number;
  startDegreePreference?: 1 | 3 | 5;
  startDegreeUserSpecified: boolean;
  phraseGrid?: PhraseGridPlan;
}): StructuralSelection {
  const slots: StructuralSlot[] = [];
  const trace: MelodySelectionTrace[] = [];
  const finalStructuralBeat = input.beatsPerMeasure >= 3 ? 3 : 1;
  const penultimateStructuralBeat = finalStructuralBeat === 3 ? 1 : null;

  for (let localMeasure = 1; localMeasure <= input.phraseLengthMeasures; localMeasure += 1) {
    const globalMeasure = input.phraseIndex * input.phraseLengthMeasures + localMeasure;
    const plannedMeasure = input.phraseGrid?.measures.find((m) => m.measure === globalMeasure);
    const plannedAnchors = plannedMeasure?.anchorOnsets?.length ? plannedMeasure.anchorOnsets : [1, 3].filter((b) => b <= input.beatsPerMeasure);
    for (const beat of plannedAnchors) {

      const cadenceContext: CadenceSlotContext | undefined =
        localMeasure === input.phraseLengthMeasures && penultimateStructuralBeat !== null && beat === penultimateStructuralBeat
          ? { type: input.phraseSpec.cadence, slotTag: 'penultimate' }
          : localMeasure === input.phraseLengthMeasures && beat === finalStructuralBeat
            ? { type: input.phraseSpec.cadence, slotTag: 'final' }
            : undefined;

      const slotIndex = slots.length;
      const N = Math.max(1, input.phraseLengthMeasures * (input.beatsPerMeasure >= 3 ? 2 : 1));
      const t = N <= 1 ? 0 : slotIndex / Math.max(1, N - 1);
      const base = (input.rangeMin + input.rangeMax) / 2;
      const envelopeTargetMidi = base + ENVELOPE_AMPLITUDE_MIDI * Math.sin(Math.PI * t);

      slots.push({
        localMeasure,
        globalMeasure,
        beat,
        index: slotIndex,
        durationToNextBeats: 1,
        cadenceContext,
        harmonyEvent: resolveHarmonyEvent(
          input.harmony,
          globalMeasure,
          beat,
          input.phraseLengthMeasures,
          input.beatsPerMeasure,
          input.phraseSpec,
          input.tonicPc,
          input.spec.mode
        ),
        envelopeTargetMidi
      });
    }
  }

  const sortedByIndex = [...slots].sort((a, b) => a.index - b.index);
  for (let i = 0; i < sortedByIndex.length; i += 1) {
    const curr = sortedByIndex[i];
    const next = sortedByIndex[i + 1];
    const currPos = (curr.localMeasure - 1) * input.beatsPerMeasure + (curr.beat - 1);
    const nextPos = next
      ? (next.localMeasure - 1) * input.beatsPerMeasure + (next.beat - 1)
      : input.phraseLengthMeasures * input.beatsPerMeasure;
    curr.durationToNextBeats = Number(Math.max(0.5, nextPos - currPos).toFixed(3));
  }

  const climaxIndex = choosePass3ClimaxIndex(slots, input.phrasePlan.peakMeasure, input.phraseGrid);
  const notes: MelodyEvent[] = [];
  let prevMidi = input.startPrevMidi;

  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const fromDegree = midiToDegree(prevMidi, input.keyScale);
    const prevInterval = i >= 2 ? notes[i - 1].midi - notes[i - 2].midi : 0;
    const prevWasLeap = Math.abs(prevInterval) >= 3;
    const prevDirection = prevInterval === 0 ? 0 : prevInterval > 0 ? 1 : -1;
    const highestSoFar =
      notes.length > 0 ? notes.reduce((max, note) => Math.max(max, note.midi), Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY;
    const prevIsHighestSoFar = notes.length > 0 && notes[notes.length - 1].midi >= highestSoFar;
    const isPreClimaxRegion = i < climaxIndex;
    const isPostClimaxRegion = i > climaxIndex;
    const isAtOrAfterPeak = i >= climaxIndex;
    const isImmediateAfterClimax = i === climaxIndex + 1;
    let candidates = chordToneCandidatesInRange(slot.harmonyEvent.chordPcs, input.rangeMin, input.rangeMax);

    const startDegree = input.startDegreePreference ?? 1;
    if (i === 0 && input.startDegreeUserSpecified) {
      // Hard start boundary: when start is requested, force first structural anchor to that degree.
      const hardStart = degreeCandidatesInRange(startDegree, input.keyScale, input.rangeMin, input.rangeMax);
      if (hardStart.length > 0) {
        candidates = hardStart;
      } else if (startDegree === 1) {
        const octaveFallback = tonicCandidatesInOctaveSpan(
          input.tonicPc,
          Math.min(input.spec.range.lowOctave, input.spec.range.highOctave),
          Math.max(input.spec.range.lowOctave, input.spec.range.highOctave)
        );
        if (octaveFallback.length > 0) {
          candidates = octaveFallback;
        }
      }
    } else if (i === 0) {
      // Default opening: allow Do or Mi, avoid Sol as a starting degree unless constraints force fallback.
      const openingPreferred = candidates.filter((midi) => {
        const degree = midiToDegree(midi, input.keyScale);
        return degree === 1 || degree === 3;
      });
      if (openingPreferred.length > 0) {
        candidates = openingPreferred;
      }
    }

    if (slot.cadenceContext && candidates.length > 0) {
      const policy = applyCadencePolicy({
        cadenceType: slot.cadenceContext.type,
        fromDegree,
        slotTag: slot.cadenceContext.slotTag,
        tonicDegree: 1,
        candidates: candidates.map((midi) => ({ midi, degree: midiToDegree(midi, input.keyScale) }))
      });
      const allowed = new Set(policy.candidatesOut.map((entry) => entry.midi));
      candidates = candidates.filter((midi) => allowed.has(midi));
    }

    if (input.spec.illegalDegrees.length > 0 && candidates.length > 0) {
      const illegalDegreeSet = new Set(input.spec.illegalDegrees);
      const legalDegreeCandidates = candidates.filter((midi) => !illegalDegreeSet.has(midiToDegree(midi, input.keyScale)));
      if (legalDegreeCandidates.length > 0) {
        candidates = legalDegreeCandidates;
      }
    }

    if (i > 0) {
      const leapCapped = candidates.filter((midi) => Math.abs(midi - prevMidi) <= input.maxLeapSemitones);
      if (leapCapped.length > 0) {
        candidates = leapCapped;
      }
    }

    if (candidates.length === 0) {
      candidates = [nearestChordToneMidi(slot.harmonyEvent, prevMidi, input.rangeMin, input.rangeMax)];
    }

    if (isImmediateAfterClimax && prevIsHighestSoFar && isAtOrAfterPeak) {
      const guarded = candidates.filter((midi) => {
        const drop = prevMidi - midi;
        return drop > 0 && drop <= 4;
      });
      if (guarded.length > 0) {
        candidates = guarded;
      }
    }

    const chosenMidi = candidates
      .map((midi) => {
        const pc = ((midi % 12) + 12) % 12;
        const candidateDegree = midiToDegree(midi, input.keyScale);
        const harmonyPenalty = slot.harmonyEvent.chordPcs.includes(pc) ? 0 : 1;
        const upAfterClimaxPenalty = i > climaxIndex && midi > prevMidi ? (midi - prevMidi) : 0;
        const nearCeilingPenalty = i !== climaxIndex && midi >= input.rangeMax - 1 ? W_SOFT_CEILING : 0;
        const interval = midi - prevMidi;
        const absInterval = Math.abs(interval);
        const isLeap = absInterval >= 3;
        const isFinalStructural = i === slots.length - 1;
        const isFirstStructural = i === 0;

        let endpointPenalty = 0;
        if (isFinalStructural) {
          if (input.phraseSpec.cadence !== 'half') {
            // Default cadence gravity: allow final Do or Mi, strongly discourage Sol.
            if (candidateDegree !== 1 && candidateDegree !== 3) {
              endpointPenalty += W_FINAL_NON_DO_MI;
            }
            if (candidateDegree === 5) {
              endpointPenalty += W_FINAL_SOL;
            }
          } else {
            // Half cadence permits and prefers Sol, but keeps alternatives legal if constrained.
            endpointPenalty += candidateDegree === 5 ? -W_HALF_FINAL_SOL_REWARD : W_HALF_FINAL_OTHER_PENALTY;
          }
        }

        if (isFirstStructural) {
          if (input.startDegreeUserSpecified && input.startDegreePreference !== undefined) {
            endpointPenalty += candidateDegree === input.startDegreePreference ? 0 : 10_000;
          } else {
            endpointPenalty += candidateDegree === 1 ? -W_FIRST_DO_REWARD : 0;
            endpointPenalty += candidateDegree === 5 ? W_FIRST_SOL_PENALTY : 0;
          }
        }

        let climaxTransitionPenalty = 0;
        if (isPreClimaxRegion) {
          const nearPeakWindow = i >= Math.max(0, climaxIndex - 1);
          const landingNearEnvelope = Math.abs(midi - slot.envelopeTargetMidi) <= 2;
          if (nearPeakWindow && interval > 0 && isLeap && landingNearEnvelope) {
            // Prefer occasional singable leaps into climax.
            climaxTransitionPenalty -= W_PRE_CLIMAX_LEAP_INTO;
          }
          if (interval > 0 && absInterval > 0 && absInterval <= 2) {
            // Encourage ascending scalar preparation into the climax region.
            climaxTransitionPenalty -= W_PRE_CLIMAX_ASC_STEP;
          }
        }

        if (i === climaxIndex && interval > 0 && (absInterval === 7 || absInterval === 8 || absInterval === 9 || absInterval === 12)) {
          // A controlled large upward leap into climax (5th/6th/8ve) is musically valid.
          climaxTransitionPenalty -= W_CLIMAX_BIG_UP_LEAP_REWARD;
        }

        if (isPostClimaxRegion && prevIsHighestSoFar) {
          if (isLeap) {
            climaxTransitionPenalty += W_POST_CLIMAX_LEAP;
          }
          if (interval < 0 && absInterval > 7) {
            climaxTransitionPenalty += W_POST_CLIMAX_LARGE_DOWN_LEAP;
          }
          if (interval < 0 && absInterval <= 2) {
            // Favor stepwise downward release after peak.
            climaxTransitionPenalty -= W_POST_CLIMAX_STEP_DOWN_REWARD;
          }
        }

        let leapRecoveryPenalty = 0;
        if (prevWasLeap) {
          const isStep = absInterval <= 2 && absInterval > 0;
          const oppositeDirection = prevDirection !== 0 && interval !== 0 && Math.sign(interval) === -prevDirection;
          if (!(isStep && oppositeDirection)) {
            leapRecoveryPenalty += W_LEAP_RECOVERY_FAIL;
          }
        }

        const cost =
          W_ENVELOPE * Math.abs(midi - slot.envelopeTargetMidi) +
          W_VOICE_LEADING * Math.abs(midi - prevMidi) +
          W_HARMONY * harmonyPenalty +
          W_UP_AFTER_CLIMAX * upAfterClimaxPenalty +
          nearCeilingPenalty +
          endpointPenalty +
          climaxTransitionPenalty +
          leapRecoveryPenalty;
        return { midi, cost };
      })
      .sort((a, b) => {
        if (a.cost !== b.cost) {
          return a.cost - b.cost;
        }
        return Math.abs(a.midi - prevMidi) - Math.abs(b.midi - prevMidi);
      })[0].midi;

    let safeChosenMidi = chosenMidi;
    if (i === climaxIndex) {
      const prevForClimax = i > 0 ? notes[i - 1].midi : prevMidi;
      const nextForClimax = i + 1 < notes.length ? notes[i + 1].midi : null;
      const illegalDegreeSet = new Set(input.spec.illegalDegrees);
      const highestFeasible = chordToneCandidatesInRange(slot.harmonyEvent.chordPcs, input.rangeMin, input.rangeMax)
        .filter((midi) => !illegalDegreeSet.has(midiToDegree(midi, input.keyScale)))
        .filter((midi) => Math.abs(midi - prevForClimax) <= input.maxLeapSemitones)
        .filter((midi) => (nextForClimax === null ? true : Math.abs(nextForClimax - midi) <= input.maxLeapSemitones))
        .sort((a, b) => b - a)[0];
      if (highestFeasible !== undefined) {
        safeChosenMidi = highestFeasible;
      }
    }
    if (i > 0 && Math.abs(safeChosenMidi - prevMidi) > input.maxLeapSemitones) {
      const repaired = nearestPcWithinLeapCap(safeChosenMidi, prevMidi, input.rangeMin, input.rangeMax, input.maxLeapSemitones);
      if (repaired !== null) {
        debugInterval(
          `intervalCapRepair structural m${slot.globalMeasure} b${slot.beat} from=${prevMidi} raw=${safeChosenMidi} repaired=${repaired}`
        );
        safeChosenMidi = repaired;
      }
    }

    const event: MelodyEvent = {
      pitch: toPitchString(safeChosenMidi),
      octave: toOctave(safeChosenMidi),
      midi: safeChosenMidi,
      duration: 'quarter',
      measure: slot.globalMeasure,
      beat: slot.beat,
      phraseIndex: input.phraseIndex + 1,
      role: 'ChordTone',
      reason: 'structuralSkeleton_chordTone',
      chordId: `m${slot.harmonyEvent.measure}-b${slot.harmonyEvent.beat}-d${slot.harmonyEvent.degree}`,
      keyId: input.keyId,
      nonHarmonicTone: false
    };

    notes.push(event);
    trace.push({
      measure: slot.globalMeasure,
      beat: slot.beat,
      steps: [
        {
          step: 'structuralSelect',
          remainingCandidateCount: candidates.length,
          chosenPitch: toPitchString(safeChosenMidi),
          reason: `envelopeTarget=${slot.envelopeTargetMidi.toFixed(2)} climaxIndex=${climaxIndex}`
        }
      ]
    });

    prevMidi = safeChosenMidi;
  }

  if (notes.length > 0) {
    let climaxMidi = notes[climaxIndex]?.midi ?? notes[0].midi;
    const climaxSlot = slots[climaxIndex];
    const prevClimaxMidi = climaxIndex > 0 ? notes[climaxIndex - 1].midi : null;
    const nextClimaxMidi = climaxIndex + 1 < notes.length ? notes[climaxIndex + 1].midi : null;
    const illegalDegreeSet = new Set(input.spec.illegalDegrees);
    const highestFeasibleClimax = chordToneCandidatesInRange(climaxSlot.harmonyEvent.chordPcs, input.rangeMin, input.rangeMax)
      .filter((midi) => !illegalDegreeSet.has(midiToDegree(midi, input.keyScale)))
      .filter((midi) => (prevClimaxMidi === null ? true : Math.abs(midi - prevClimaxMidi) <= input.maxLeapSemitones))
      .filter((midi) => (nextClimaxMidi === null ? true : Math.abs(nextClimaxMidi - midi) <= input.maxLeapSemitones))
      .sort((a, b) => b - a)[0];
    if (highestFeasibleClimax !== undefined) {
      notes[climaxIndex] = retuneEventMidi(notes[climaxIndex], highestFeasibleClimax);
      climaxMidi = highestFeasibleClimax;
    }

    const maxOther = notes.reduce((max, note, index) => (index === climaxIndex ? max : Math.max(max, note.midi)), Number.NEGATIVE_INFINITY);
    if (climaxMidi <= maxOther) {
      const slot = slots[climaxIndex];
      const candidates = chordToneCandidatesInRange(slot.harmonyEvent.chordPcs, input.rangeMin, input.rangeMax)
        .filter((midi) => midi > maxOther)
        .sort((a, b) => a - b);
      if (candidates.length > 0) {
        notes[climaxIndex] = retuneEventMidi(notes[climaxIndex], candidates[0]);
        climaxMidi = candidates[0];
      }
    }

    for (let i = 0; i < notes.length; i += 1) {
      if (i === climaxIndex || notes[i].midi < climaxMidi) {
        continue;
      }
      const slot = slots[i];
      const lower = chordToneCandidatesInRange(slot.harmonyEvent.chordPcs, input.rangeMin, input.rangeMax)
        .filter((midi) => midi < climaxMidi)
        .sort((a, b) => Math.abs(a - notes[i].midi) - Math.abs(b - notes[i].midi));
      if (lower.length > 0) {
        notes[i] = retuneEventMidi(notes[i], lower[0]);
      }
    }
  }

  return {
    slots,
    notes,
    trace,
    endMidi: notes[notes.length - 1]?.midi ?? input.startPrevMidi
  };
}

function buildWeakBeatNonHarmonic(
  prevMidi: number,
  nextStructuralMidi: number | null,
  weakHarmony: HarmonyEvent,
  keyScale: number[],
  rangeMin: number,
  rangeMax: number,
  seed: number
): { midi: number; reason: string } | null {
  if (nextStructuralMidi === null) {
    return null;
  }

  const weakHarmonySet = new Set(weakHarmony.chordPcs);
  const candidates: Array<{ midi: number; reason: string }> = [];

  const passing = (() => {
    const dir = nextStructuralMidi > prevMidi ? 1 : nextStructuralMidi < prevMidi ? -1 : 0;
    if (dir === 0) {
      return null;
    }
    const step = nextScaleStepMidi(prevMidi, dir as 1 | -1, keyScale, rangeMin, rangeMax);
    if (step === null) {
      return null;
    }
    if (Math.abs(nextStructuralMidi - step) > 2) {
      return null;
    }
    const pc = ((step % 12) + 12) % 12;
    if (weakHarmonySet.has(pc)) {
      return null;
    }
    return { midi: step, reason: 'embellish_passingTone' };
  })();

  if (passing) {
    candidates.push(passing);
  }

  const neighbor = (() => {
    if (nextStructuralMidi !== prevMidi) {
      return null;
    }
    const up = nextScaleStepMidi(prevMidi, 1, keyScale, rangeMin, rangeMax);
    const down = nextScaleStepMidi(prevMidi, -1, keyScale, rangeMin, rangeMax);
    const pick = deterministicUnit(seed) < 0.5 ? up : down;
    if (pick === null) {
      return null;
    }
    const pc = ((pick % 12) + 12) % 12;
    if (weakHarmonySet.has(pc)) {
      return null;
    }
    return { midi: pick, reason: 'embellish_neighborTone' };
  })();

  if (neighbor) {
    candidates.push(neighbor);
  }

  const suspension = (() => {
    const pc = ((prevMidi % 12) + 12) % 12;
    if (!weakHarmonySet.has(pc) && nextStructuralMidi < prevMidi && Math.abs(nextStructuralMidi - prevMidi) <= 2) {
      return { midi: prevMidi, reason: 'embellish_suspension' };
    }
    return null;
  })();

  if (suspension) {
    candidates.push(suspension);
  }

  const escape = (() => {
    const stepDir: 1 | -1 = deterministicUnit(seed + 11) < 0.5 ? 1 : -1;
    const step = nextScaleStepMidi(prevMidi, stepDir, keyScale, rangeMin, rangeMax);
    if (step === null) {
      return null;
    }

    const leapToNext = nextStructuralMidi - step;
    if (Math.abs(leapToNext) < 3) {
      return null;
    }

    const firstMotion = step - prevMidi;
    if (Math.sign(firstMotion) === Math.sign(leapToNext)) {
      return null;
    }

    const pc = ((step % 12) + 12) % 12;
    if (weakHarmonySet.has(pc)) {
      return null;
    }

    return { midi: step, reason: 'embellish_escapeTone' };
  })();

  if (escape) {
    candidates.push(escape);
  }

  if (candidates.length === 0) {
    return null;
  }

  return candidates[Math.floor(deterministicUnit(seed + 29) * candidates.length)];
}

export function embellishSkeleton(input: EmbellishInput): { melody: MelodyEvent[]; trace: MelodySelectionTrace[] } {
  const trace: MelodySelectionTrace[] = [...input.skeleton.trace];
  const slotByBeat = new Map<string, MelodyEvent>();
  for (const note of input.skeleton.notes) {
    slotByBeat.set(`${note.measure}:${note.beat}`, note);
  }

  const melody: MelodyEvent[] = [];
  const localStartMeasure = input.phraseIndex * input.phraseLengthMeasures + 1;
  let prevMidi = input.skeleton.notes[0]?.midi ?? input.skeleton.endMidi;

  const structuralByPosition = [...input.skeleton.notes].sort((a, b) => (a.measure - b.measure) * 16 + (a.beat - b.beat));
  const structuralPosition = (event: MelodyEvent): number => (event.measure - localStartMeasure) * input.beatsPerMeasure + event.beat;

  for (let localMeasure = 1; localMeasure <= input.phraseLengthMeasures; localMeasure += 1) {
    const globalMeasure = input.phraseIndex * input.phraseLengthMeasures + localMeasure;

    for (let beat = 1; beat <= input.beatsPerMeasure; beat += 1) {
      const structural = slotByBeat.get(`${globalMeasure}:${beat}`);
      if (structural) {
        melody.push(structural);
        prevMidi = structural.midi;
        continue;
      }

      const isWeak = !isStrongBeat(beat);
      const isPenultimateCadenceBeat =
        localMeasure === input.phraseLengthMeasures && input.beatsPerMeasure >= 2 && beat === input.beatsPerMeasure - 1;
      const isFinalCadenceBeat =
        localMeasure === input.phraseLengthMeasures && input.beatsPerMeasure >= 2 && beat === input.beatsPerMeasure;

      const harmonyEvent = resolveHarmonyEvent(
        input.harmony,
        globalMeasure,
        beat,
        input.phraseLengthMeasures,
        input.beatsPerMeasure,
        input.phraseSpec,
        KEY_TO_PC[input.spec.key] ?? 0,
        input.spec.mode
      );

      let weakMidi = nearestChordToneMidi(harmonyEvent, prevMidi, input.rangeMin, input.rangeMax);
      let role: MelodyEvent['role'] = 'ChordTone';
      let reason = 'embellish_chordToneFill';

      if (isWeak && !isPenultimateCadenceBeat && !isFinalCadenceBeat) {
        const currentPos = (globalMeasure - localStartMeasure) * input.beatsPerMeasure + beat;
        const nextStructural = structuralByPosition.find((event) => structuralPosition(event) > currentPos) ?? null;
        const nonHarmonic = buildWeakBeatNonHarmonic(
          prevMidi,
          nextStructural?.midi ?? null,
          harmonyEvent,
          input.keyScale,
          input.rangeMin,
          input.rangeMax,
          input.seed + globalMeasure * 31 + beat * 17
        );

        if (nonHarmonic) {
          weakMidi = nonHarmonic.midi;
          role = 'NonHarmonicTone';
          reason = nonHarmonic.reason;
        }
      }

      if (Math.abs(weakMidi - prevMidi) > input.maxLeapSemitones) {
        const repairedSamePc = nearestPcWithinLeapCap(
          weakMidi,
          prevMidi,
          input.rangeMin,
          input.rangeMax,
          input.maxLeapSemitones
        );
        if (repairedSamePc !== null) {
          debugInterval(
            `intervalCapRepair embellish m${globalMeasure} b${beat} from=${prevMidi} raw=${weakMidi} repaired=${repairedSamePc}`
          );
          weakMidi = repairedSamePc;
          reason = `${reason}|intervalCapRepair`;
        } else {
          const fallbackAllowed = role === 'ChordTone' ? harmonyEvent.chordPcs : input.keyScale;
          const repairedAlt = nearestAllowedPcWithinLeapCap(
            fallbackAllowed,
            weakMidi,
            prevMidi,
            input.rangeMin,
            input.rangeMax,
            input.maxLeapSemitones
          );
          if (repairedAlt !== null) {
            debugInterval(
              `intervalCapRepairAlt embellish m${globalMeasure} b${beat} from=${prevMidi} raw=${weakMidi} repaired=${repairedAlt}`
            );
            weakMidi = repairedAlt;
            reason = `${reason}|intervalCapRepairAlt`;
          }
        }
      }

      if (input.spec.illegalDegrees.length > 0) {
        const illegalDegreeSet = new Set(input.spec.illegalDegrees);
        const weakDegree = midiToDegree(weakMidi, input.keyScale);
        if (illegalDegreeSet.has(weakDegree)) {
          const preferredPool = chordToneCandidatesInRange(harmonyEvent.chordPcs, input.rangeMin, input.rangeMax);
          const fallbackPool: number[] = [];
          for (let midi = input.rangeMin; midi <= input.rangeMax; midi += 1) {
            const pc = ((midi % 12) + 12) % 12;
            if (input.keyScale.includes(pc)) {
              fallbackPool.push(midi);
            }
          }
          const legalPreferred = preferredPool.filter(
            (midi) => !illegalDegreeSet.has(midiToDegree(midi, input.keyScale)) && Math.abs(midi - prevMidi) <= input.maxLeapSemitones
          );
          const legalFallback = fallbackPool.filter(
            (midi) => !illegalDegreeSet.has(midiToDegree(midi, input.keyScale)) && Math.abs(midi - prevMidi) <= input.maxLeapSemitones
          );
          const replacementPool = legalPreferred.length > 0 ? legalPreferred : legalFallback;
          if (replacementPool.length > 0) {
            const replacement = replacementPool.reduce((best, midi) =>
              Math.abs(midi - weakMidi) < Math.abs(best - weakMidi) ? midi : best
            );
            weakMidi = replacement;
            reason = `${reason}|illegalDegreeAvoid`;
          }
        }
      }

      const weakEvent: MelodyEvent = {
        pitch: toPitchString(weakMidi),
        octave: toOctave(weakMidi),
        midi: weakMidi,
        duration: 'quarter',
        measure: globalMeasure,
        beat,
        phraseIndex: input.phraseIndex + 1,
        role,
        reason,
        chordId: `m${harmonyEvent.measure}-b${harmonyEvent.beat}-d${harmonyEvent.degree}`,
        keyId: input.keyId,
        nonHarmonicTone: role === 'NonHarmonicTone'
      };

      melody.push(weakEvent);
      trace.push({
        measure: globalMeasure,
        beat,
        steps: [
          {
            step: 'embellish',
            remainingCandidateCount: 1,
            chosenPitch: toPitchString(weakMidi),
            reason
          }
        ]
      });

      prevMidi = weakMidi;
    }
  }

  return { melody, trace };
}

function enforceEeMotionInMeasureDuringFill(
  measureEvents: MelodyEvent[],
  keyScale: number[],
  rangeMin: number,
  rangeMax: number
): void {
  const sorted = [...measureEvents].sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
  const enforceWindow = (start: number): void => {
    const e1 = sorted.find((event) => Math.abs((event.onsetBeat ?? event.beat) - start) < 0.001);
    const e2 = sorted.find((event) => Math.abs((event.onsetBeat ?? event.beat) - (start + 0.5)) < 0.001);
    if (!e1 || !e2) {
      return;
    }
    let delta = Math.abs(e2.midi - e1.midi);
    if (delta > 4) {
      const dir: 1 | -1 = e2.midi >= e1.midi ? 1 : -1;
      const step = nextScaleStepMidi(e1.midi, dir, keyScale, rangeMin, rangeMax);
      if (step !== null) {
        Object.assign(e2, retuneEvent(e2, step));
      }
      delta = Math.abs(e2.midi - e1.midi);
    }
    if (delta === 3 || delta === 4) {
      const idx = sorted.findIndex((event) => event === e2);
      const next = sorted[idx + 1];
      if (next && Math.abs(next.midi - e2.midi) > 2 && !isLockedAttack(next)) {
        const dir: 1 | -1 = next.midi >= e2.midi ? 1 : -1;
        const step = nextScaleStepMidi(e2.midi, dir, keyScale, rangeMin, rangeMax);
        if (step !== null) {
          Object.assign(next, retuneEvent(next, step));
        }
      }
    }
  };
  enforceWindow(2);
  enforceWindow(3);
}

function isDominantFunctionHarmonyDegree(degree: number | null): boolean {
  return degree === 5 || degree === 7;
}

function isTendencyResolutionOverridden(
  spec: ExerciseSpec,
  sourceDegree: number,
  targetDegree: number
): boolean {
  const illegalDegrees = new Set(spec.illegalDegrees ?? []);
  if (illegalDegrees.has(sourceDegree) || illegalDegrees.has(targetDegree)) {
    return true;
  }
  const illegalIntervals = new Set(spec.illegalIntervalsSemis ?? []);
  if (illegalIntervals.has(1) || illegalIntervals.has(2)) {
    return true;
  }
  const illegalTransitions = spec.illegalTransitions ?? [];
  return illegalTransitions.some((rule) => rule.mode === 'adjacent' && rule.a === sourceDegree && rule.b === targetDegree);
}

function chooseNearestLegalMidiForIllegalRepair(input: {
  event: MelodyEvent;
  prev: MelodyEvent | null;
  next: MelodyEvent | null;
  spec: ExerciseSpec;
  keyScale: number[];
  rangeMin: number;
  rangeMax: number;
  maxLeapSemitones: number;
}): number | null {
  const illegalDegreeSet = new Set(input.spec.illegalDegrees ?? []);
  const illegalIntervalSet = new Set(input.spec.illegalIntervalsSemis ?? []);
  const illegalTransitions = input.spec.illegalTransitions ?? [];

  const { tonicPc, mode } = parseKeyFromEvent(input.event);
  const harmonyDegree = chordDegreeFromChordId(input.event.chordId);
  const chordPcs = harmonyDegree ? chordForDegree(tonicPc, mode, harmonyDegree) : [];
  const keyPcs = input.keyScale;
  const candidatePool = [
    ...collectCandidateMidisFromPcs(chordPcs, input.rangeMin, input.rangeMax),
    ...collectCandidateMidisFromPcs(keyPcs, input.rangeMin, input.rangeMax)
  ].filter((midi, idx, arr) => arr.indexOf(midi) === idx);

  const prevDegree = input.prev ? midiToDegree(input.prev.midi, input.keyScale) : null;
  const nextDegree = input.next ? midiToDegree(input.next.midi, input.keyScale) : null;

  const valid = candidatePool
    .filter((midi) => {
      const degree = midiToDegree(midi, input.keyScale);
      if (illegalDegreeSet.has(degree)) {
        return false;
      }
      if (input.prev) {
        const intv = Math.abs(midi - input.prev.midi);
        if (intv > input.maxLeapSemitones || illegalIntervalSet.has(intv)) {
          return false;
        }
        if (prevDegree !== null && isIllegalTransition(prevDegree, degree, illegalTransitions)) {
          return false;
        }
      }
      if (input.next) {
        const intv = Math.abs(input.next.midi - midi);
        if (intv > input.maxLeapSemitones || illegalIntervalSet.has(intv)) {
          return false;
        }
        if (nextDegree !== null && isIllegalTransition(degree, nextDegree, illegalTransitions)) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => Math.abs(a - input.event.midi) - Math.abs(b - input.event.midi));

  return valid[0] ?? null;
}

function applyIllegalRulesAdjacencyPass(input: {
  events: MelodyEvent[];
  spec: ExerciseSpec;
  keyScale: number[];
  rangeMin: number;
  rangeMax: number;
  maxLeapSemitones: number;
}): MelodyEvent[] {
  const events = [...input.events].map((event) => ({ ...event }));
  const illegalDegreeSet = new Set(input.spec.illegalDegrees ?? []);
  const illegalIntervalSet = new Set(input.spec.illegalIntervalsSemis ?? []);
  const illegalTransitions = input.spec.illegalTransitions ?? [];

  for (let guard = 0; guard < 3; guard += 1) {
    const attacks = filterRenderableAttackEvents(events).sort(
      (a, b) => a.measure - b.measure || (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat)
    );
    let changed = false;

    for (let i = 0; i < attacks.length; i += 1) {
      const curr = attacks[i];
      const prev = i > 0 ? attacks[i - 1] : null;
      const next = i + 1 < attacks.length ? attacks[i + 1] : null;
      const currDegree = midiToDegree(curr.midi, input.keyScale);
      const prevDegree = prev ? midiToDegree(prev.midi, input.keyScale) : null;

      const degreeViolation = illegalDegreeSet.has(currDegree);
      const intervalViolation = prev ? illegalIntervalSet.has(Math.abs(curr.midi - prev.midi)) : false;
      const transitionViolation = prev && prevDegree !== null ? isIllegalTransition(prevDegree, currDegree, illegalTransitions) : false;
      if (!degreeViolation && !intervalViolation && !transitionViolation) {
        continue;
      }

      const retune = chooseNearestLegalMidiForIllegalRepair({
        event: curr,
        prev,
        next,
        spec: input.spec,
        keyScale: input.keyScale,
        rangeMin: input.rangeMin,
        rangeMax: input.rangeMax,
        maxLeapSemitones: input.maxLeapSemitones
      });
      if (retune !== null && retune !== curr.midi) {
        Object.assign(curr, retuneEvent(curr, retune));
        curr.reason = `${curr.reason}|illegalRuleRepair`;
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }
  return events;
}

function applyDominantTendencyVoiceLeadingPass(input: {
  events: MelodyEvent[];
  spec: ExerciseSpec;
  keyScale: number[];
  rangeMin: number;
  rangeMax: number;
  maxLeapSemitones: number;
}): MelodyEvent[] {
  const events = [...input.events].map((event) => ({ ...event }));
  const attacks = filterRenderableAttackEvents(events).sort(
    (a, b) => a.measure - b.measure || (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat)
  );

  for (let i = 0; i < attacks.length - 1; i += 1) {
    const curr = attacks[i];
    const next = attacks[i + 1];
    const nextNext = attacks[i + 2] ?? null;
    const harmonyDegree = chordDegreeFromChordId(curr.chordId);
    if (!isDominantFunctionHarmonyDegree(harmonyDegree)) {
      continue;
    }

    const currDegree = midiToDegree(curr.midi, input.keyScale);
    let targetDegree: 3 | 1 | null = null;
    let requiredDirection: 1 | -1 = -1;
    let debugRule = '';
    if (currDegree === 4) {
      targetDegree = 3;
      requiredDirection = -1;
      debugRule = 'fa_to_mi';
    } else if (currDegree === 7) {
      targetDegree = 1;
      requiredDirection = 1;
      debugRule = 'ti_to_do';
    }
    if (targetDegree === null) {
      continue;
    }
    if (isTendencyResolutionOverridden(input.spec, currDegree, targetDegree)) {
      continue;
    }

    const nextDegree = midiToDegree(next.midi, input.keyScale);
    const interval = next.midi - curr.midi;
    const stepOnly = Math.abs(interval) <= 2 && interval !== 0;
    const directionOk = Math.sign(interval) === requiredDirection;
    if (nextDegree === targetDegree && stepOnly && directionOk) {
      continue;
    }

    const { tonicPc, mode } = parseKeyFromEvent(next);
    const nextHarmonyDegree = chordDegreeFromChordId(next.chordId);
    const nextHarmonyPcs = nextHarmonyDegree ? chordForDegree(tonicPc, mode, nextHarmonyDegree) : [];
    const rawCandidates = degreeCandidatesInRange(targetDegree, input.keyScale, input.rangeMin, input.rangeMax)
      .filter((midi) => {
        const delta = midi - curr.midi;
        return Math.abs(delta) <= 2 && delta !== 0 && Math.sign(delta) === requiredDirection;
      })
      .filter((midi) => Math.abs(midi - curr.midi) <= input.maxLeapSemitones)
      .filter((midi) => (nextNext ? Math.abs(nextNext.midi - midi) <= input.maxLeapSemitones : true));
    if (rawCandidates.length === 0) {
      continue;
    }
    const candidates = [...rawCandidates].sort((a, b) => {
      const aChordToneBonus = nextHarmonyPcs.includes(((a % 12) + 12) % 12) ? 0 : 1;
      const bChordToneBonus = nextHarmonyPcs.includes(((b % 12) + 12) % 12) ? 0 : 1;
      if (aChordToneBonus !== bChordToneBonus) {
        return aChordToneBonus - bChordToneBonus;
      }
      return Math.abs(a - next.midi) - Math.abs(b - next.midi);
    });
    const chosen = candidates[0];
    if (chosen !== next.midi) {
      Object.assign(next, retuneEvent(next, chosen));
      next.reason = `${next.reason}|vl_${debugRule}`;
      console.debug(
        `[pass4-voiceLeading] ${debugRule} m${curr.measure}b${(curr.onsetBeat ?? curr.beat).toFixed(1)} -> m${next.measure}b${(
          next.onsetBeat ?? next.beat
        ).toFixed(1)} from=${curr.midi} to=${chosen}`
      );
    }
  }

  return events;
}

function enforceLeapBudgetPerPhrasePass(
  events: MelodyEvent[],
  ctx: {
    beatsPerMeasure: number;
    tessitura: { minMidi: number; maxMidi: number };
    keyId: string;
    mode: ExerciseSpec['mode'];
    user: {
      maxLeapSemitones: number;
      maxLargeLeapsPerPhrase: number;
    };
  },
  repairLog: Array<{ code: string; detail: unknown }>
): MelodyEvent[] {
  const next = [...events].map((event) => ({ ...event }));
  const largeThreshold = 4;
  const maxLeapSemis = Math.max(1, ctx.user.maxLeapSemitones);
  const allowedLarge = Math.max(0, Math.floor(ctx.user.maxLargeLeapsPerPhrase));

  const phraseIds = new Set<number>();
  for (const event of filterRenderableAttackEvents(next)) {
    phraseIds.add(event.phraseIndex ?? 1);
  }
  if (phraseIds.size === 0) {
    phraseIds.add(1);
  }

  const attacksForPhrase = (phraseId: number): MelodyEvent[] =>
    filterRenderableAttackEvents(next).filter((event) => (event.phraseIndex ?? 1) === phraseId);

  const chooseKeptLargeLeapIndices = (attacks: MelodyEvent[], largeIndices: number[]): Set<number> => {
    if (allowedLarge <= 0 || largeIndices.length === 0) {
      return new Set<number>();
    }
    const preferred = largeIndices.find((idx) => {
      const curr = attacks[idx];
      const prev = attacks[idx - 1];
      const intoClimax = (curr.functionTags ?? []).includes('climax') && curr.midi - prev.midi > 0;
      return intoClimax;
    });
    const ordered = preferred === undefined ? [...largeIndices] : [preferred, ...largeIndices.filter((idx) => idx !== preferred)];
    return new Set(ordered.slice(0, allowedLarge));
  };

  const gatherScaleCandidates = (keyScale: number[], minMidi: number, maxMidi: number): number[] =>
    collectCandidateMidisFromPcs(keyScale, minMidi, maxMidi);

  const chooseRepairMidi = (
    curr: MelodyEvent,
    prev: MelodyEvent,
    nextAttack: MelodyEvent | null,
    chordPcs: number[],
    keyScale: number[]
  ): number | null => {
    const scored: Array<{ midi: number; score: number }> = [];
    const chordCandidates = collectCandidateMidisFromPcs(chordPcs, ctx.tessitura.minMidi, ctx.tessitura.maxMidi);
    const scaleCandidates = gatherScaleCandidates(keyScale, ctx.tessitura.minMidi, ctx.tessitura.maxMidi);
    const pushCandidate = (midi: number, nonChordPenalty: number): void => {
      const leapPrev = Math.abs(midi - prev.midi);
      if (leapPrev > largeThreshold || leapPrev > maxLeapSemis) {
        return;
      }
      if (nextAttack && Math.abs(nextAttack.midi - midi) > maxLeapSemis) {
        return;
      }
      scored.push({
        midi,
        score: Math.abs(midi - curr.midi) * 10 + Math.abs(midi - prev.midi) + nonChordPenalty
      });
    };
    for (const midi of chordCandidates) {
      pushCandidate(midi, 0);
    }
    for (const midi of scaleCandidates) {
      pushCandidate(midi, 35);
    }
    scored.sort((a, b) => a.score - b.score);
    return scored[0]?.midi ?? null;
  };

  const chooseOctaveRepairSamePc = (curr: MelodyEvent, prev: MelodyEvent, nextAttack: MelodyEvent | null): number | null => {
    const pc = ((curr.midi % 12) + 12) % 12;
    let best: number | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let midi = ctx.tessitura.minMidi; midi <= ctx.tessitura.maxMidi; midi += 1) {
      if (((midi % 12) + 12) % 12 !== pc) {
        continue;
      }
      const leapPrev = Math.abs(midi - prev.midi);
      if (leapPrev > largeThreshold || leapPrev > maxLeapSemis) {
        continue;
      }
      if (nextAttack && Math.abs(nextAttack.midi - midi) > maxLeapSemis) {
        continue;
      }
      const score = Math.abs(midi - curr.midi) * 10 + Math.abs(midi - prev.midi);
      if (score < bestScore) {
        bestScore = score;
        best = midi;
      }
    }
    return best;
  };

  const chooseStepwiseRecovery = (
    prev: MelodyEvent,
    curr: MelodyEvent,
    nextAttack: MelodyEvent,
    nextNext: MelodyEvent | null
  ): number | null => {
    const { keyScale } = parseKeyFromEvent(nextAttack);
    const leapDir = Math.sign(curr.midi - prev.midi) >= 0 ? 1 : -1;
    const preferredDir: 1 | -1 = leapDir > 0 ? -1 : 1;
    const candidates: number[] = [];
    const primary = nextScaleStepMidi(curr.midi, preferredDir, keyScale, ctx.tessitura.minMidi, ctx.tessitura.maxMidi);
    const secondary = nextScaleStepMidi(curr.midi, preferredDir === 1 ? -1 : 1, keyScale, ctx.tessitura.minMidi, ctx.tessitura.maxMidi);
    if (primary !== null) {
      candidates.push(primary);
    }
    if (secondary !== null) {
      candidates.push(secondary);
    }
    for (let delta = -2; delta <= 2; delta += 1) {
      if (delta === 0) {
        continue;
      }
      const midi = curr.midi + delta;
      if (midi < ctx.tessitura.minMidi || midi > ctx.tessitura.maxMidi) {
        continue;
      }
      const pc = ((midi % 12) + 12) % 12;
      if (!keyScale.includes(pc)) {
        continue;
      }
      candidates.push(midi);
    }
    const unique = [...new Set(candidates)];
    const valid = unique
      .filter((midi) => Math.abs(midi - curr.midi) <= 2)
      .filter((midi) => Math.abs(midi - curr.midi) <= maxLeapSemis)
      .filter((midi) => (nextNext ? Math.abs(nextNext.midi - midi) <= maxLeapSemis : true))
      .sort((a, b) => {
        const aDirPenalty = Math.sign(a - curr.midi) === preferredDir ? 0 : 1;
        const bDirPenalty = Math.sign(b - curr.midi) === preferredDir ? 0 : 1;
        if (aDirPenalty !== bDirPenalty) {
          return aDirPenalty - bDirPenalty;
        }
        return Math.abs(a - nextAttack.midi) - Math.abs(b - nextAttack.midi);
      });
    return valid[0] ?? null;
  };

  for (const phraseId of phraseIds) {
    for (let guard = 0; guard < 64; guard += 1) {
      const attacks = attacksForPhrase(phraseId);
      const largeIndices = attacks
        .map((event, idx) => ({ idx, event }))
        .filter((entry) => entry.idx > 0 && Math.abs(entry.event.midi - attacks[entry.idx - 1].midi) > largeThreshold)
        .map((entry) => entry.idx);
      if (largeIndices.length <= allowedLarge) {
        break;
      }
      const kept = chooseKeptLargeLeapIndices(attacks, largeIndices);
      const offending = largeIndices.find((idx) => !kept.has(idx));
      if (offending === undefined) {
        break;
      }
      const prev = attacks[offending - 1];
      const curr = attacks[offending];
      const nextAttack = attacks[offending + 1] ?? null;
      const original = curr.midi;
      let repaired = false;

      if (!isLockedAttack(curr)) {
        const { tonicPc, keyScale } = parseKeyFromEvent(curr);
        const degree = chordDegreeFromChordId(curr.chordId);
        const chordPcs = degree ? chordForDegree(tonicPc, ctx.mode, degree) : [];
        const candidate = chooseRepairMidi(curr, prev, nextAttack, chordPcs, keyScale);
        if (candidate !== null && candidate !== curr.midi) {
          Object.assign(curr, retuneEvent(curr, candidate));
          repaired = true;
          repairLog.push({
            code: 'pass5_leapBudget_repair',
            detail: { phraseIndex: phraseId, idx: offending, prevMidi: prev.midi, from: original, to: candidate, reason: 'retune_harmony_or_scale' }
          });
        }
      }

      if (!repaired && !isLockedAttack(curr)) {
        const octaveCandidate = chooseOctaveRepairSamePc(curr, prev, nextAttack);
        if (octaveCandidate !== null && octaveCandidate !== curr.midi) {
          const from = curr.midi;
          Object.assign(curr, retuneEvent(curr, octaveCandidate));
          repaired = true;
          repairLog.push({
            code: 'pass5_leapBudget_repair',
            detail: { phraseIndex: phraseId, idx: offending, prevMidi: prev.midi, from, to: octaveCandidate, reason: 'octave_same_pc' }
          });
        }
      }

      if (!repaired && !isLockedAttack(curr)) {
        curr.isAttack = false;
        curr.tieStop = true;
        ensureMeasureValidity(next, ctx.beatsPerMeasure, repairLog as Pass4RepairLogEntry[]);
        repaired = true;
        repairLog.push({
          code: 'pass5_leapBudget_repair',
          detail: { phraseIndex: phraseId, idx: offending, prevMidi: prev.midi, from: original, to: null, reason: 'demote_attack' }
        });
      }

      if (!repaired && !isLockedAttack(curr)) {
        const { tonicPc } = parseKeyFromEvent(curr);
        const degree = chordDegreeFromChordId(curr.chordId);
        const chordPcs = degree ? chordForDegree(tonicPc, ctx.mode, degree) : [];
        const relaxed = nearestAllowedPcWithinLeapCap(
          chordPcs,
          curr.midi,
          prev.midi,
          ctx.tessitura.minMidi,
          ctx.tessitura.maxMidi,
          maxLeapSemis
        );
        if (relaxed !== null && relaxed !== curr.midi) {
          Object.assign(curr, retuneEvent(curr, relaxed));
          repaired = true;
          repairLog.push({
            code: 'pass5_leapBudget_repair',
            detail: {
              phraseIndex: phraseId,
              idx: offending,
              prevMidi: prev.midi,
              from: original,
              to: relaxed,
              reason: 'shortfall_relaxed_to_maxLeap'
            }
          });
        }
      }

      if (!repaired) {
        repairLog.push({
          code: 'pass5_leapBudget_repair_unresolved',
          detail: { phraseIndex: phraseId, idx: offending, prevMidi: prev.midi, midi: curr.midi }
        });
        break;
      }
    }

    const attacks = attacksForPhrase(phraseId);
    const largeIndices = attacks
      .map((event, idx) => ({ idx, event }))
      .filter((entry) => entry.idx > 0 && Math.abs(entry.event.midi - attacks[entry.idx - 1].midi) > largeThreshold)
      .map((entry) => entry.idx);
    for (const idx of largeIndices) {
      const prev = attacks[idx - 1];
      const curr = attacks[idx];
      const nextAttack = attacks[idx + 1];
      const nextNext = attacks[idx + 2] ?? null;
      if (!nextAttack) {
        continue;
      }
      const intervalOut = nextAttack.midi - curr.midi;
      if (Math.abs(intervalOut) <= 2 && intervalOut !== 0) {
        continue;
      }
      if (!isLockedAttack(nextAttack)) {
        const stepCandidate = chooseStepwiseRecovery(prev, curr, nextAttack, nextNext);
        if (stepCandidate !== null && stepCandidate !== nextAttack.midi) {
          const from = nextAttack.midi;
          Object.assign(nextAttack, retuneEvent(nextAttack, stepCandidate));
          repairLog.push({
            code: 'pass5_leapBudget_recovery',
            detail: { phraseIndex: phraseId, afterIdx: idx, from, to: stepCandidate, dir: Math.sign(stepCandidate - curr.midi) }
          });
        }
      } else if (!isLockedAttack(curr)) {
        const { tonicPc, keyScale } = parseKeyFromEvent(curr);
        const degree = chordDegreeFromChordId(curr.chordId);
        const chordPcs = degree ? chordForDegree(tonicPc, ctx.mode, degree) : [];
        const currCandidates = [...collectCandidateMidisFromPcs(chordPcs, ctx.tessitura.minMidi, ctx.tessitura.maxMidi), ...collectCandidateMidisFromPcs(keyScale, ctx.tessitura.minMidi, ctx.tessitura.maxMidi)];
        const uniqueCurr = [...new Set(currCandidates)];
        const retuneCurr = uniqueCurr
          .filter((midi) => Math.abs(midi - prev.midi) <= maxLeapSemis)
          .filter((midi) => Math.abs(nextAttack.midi - midi) <= 2 && Math.abs(nextAttack.midi - midi) > 0)
          .sort((a, b) => Math.abs(a - curr.midi) - Math.abs(b - curr.midi))[0];
        if (retuneCurr !== undefined && retuneCurr !== curr.midi) {
          const from = curr.midi;
          Object.assign(curr, retuneEvent(curr, retuneCurr));
          repairLog.push({
            code: 'pass5_leapBudget_recovery',
            detail: { phraseIndex: phraseId, afterIdx: idx, from, to: retuneCurr, dir: Math.sign(nextAttack.midi - retuneCurr) }
          });
        }
      }
    }
  }

  enforceMaxLeap(next, ctx.tessitura, repairLog as Pass4RepairLogEntry[], maxLeapSemis, false);
  ensureMeasureValidity(next, ctx.beatsPerMeasure, repairLog as Pass4RepairLogEntry[]);
  return next;
}

function realizePhraseGridPitches(input: {
  spec: ExerciseSpec;
  phraseSpec: PhraseSpec;
  phraseIndex: number;
  phraseLengthMeasures: number;
  beatsPerMeasure: number;
  phraseGrid: PhraseGridPlan;
  harmony: HarmonyEvent[];
  skeleton: StructuralSelection;
  keyId: string;
  keyScale: number[];
  rangeMin: number;
  rangeMax: number;
  maxLeapSemitones: number;
  seed: number;
}): { melody: MelodyEvent[]; trace: MelodySelectionTrace[] } {
  const trace: MelodySelectionTrace[] = [...input.skeleton.trace];
  const melody: MelodyEvent[] = [];
  const illegalDegreeSet = new Set(input.spec.illegalDegrees ?? []);
  const skeletonByKey = new Map<string, MelodyEvent>();
  for (const note of input.skeleton.notes) {
    skeletonByKey.set(`${note.measure}:${note.beat}`, note);
  }

  const allOnsets: Array<{ measure: number; onset: number; isAnchor: boolean; isClimax: boolean; isCadence: boolean }> = [];
  for (const measurePlan of input.phraseGrid.measures) {
    for (const onset of measurePlan.onsets) {
      allOnsets.push({
        measure: measurePlan.measure,
        onset,
        isAnchor: measurePlan.anchorOnsets.some((b) => Math.abs(b - onset) < 0.001),
        isClimax: measurePlan.isClimaxMeasure && Math.abs(onset - input.phraseGrid.climax.onset) < 0.001,
        isCadence: measurePlan.isCadenceMeasure
      });
    }
  }
  allOnsets.sort((a, b) => a.measure - b.measure || a.onset - b.onset);

  const anchorSlots = allOnsets.filter((slot) => slot.isAnchor || slot.isClimax || slot.isCadence);
  const isAnchorSlot = (slot: { measure: number; onset: number; isAnchor: boolean; isClimax: boolean; isCadence: boolean }): boolean =>
    slot.isAnchor || slot.isClimax || slot.isCadence;
  const slotKey = (measure: number, onset: number): string => `${measure}:${onset}`;
  const eventBySlot = new Map<string, MelodyEvent>();

  const createAnchorEvent = (slot: (typeof allOnsets)[number], skeletonNote: MelodyEvent): MelodyEvent => {
    const tags: NonNullable<MelodyEvent['functionTags']>[number][] = [...(skeletonNote.functionTags ?? []), 'anchor', 'structural'];
    if (slot.isClimax) {
      tags.push('climax');
    }
    if (slot.isCadence) {
      tags.push('cadence');
    }
    return {
      ...skeletonNote,
      beat: slot.onset,
      onsetBeat: slot.onset,
      isAttack: true,
      functionTags: [...new Set(tags)]
    };
  };

  const allScaleCandidates = collectCandidateMidisFromPcs(input.keyScale, input.rangeMin, input.rangeMax);

  const chooseEdgeCandidate = (inputEdge: {
    prevMidi: number;
    targetMidi: number;
    remainingSlots: number;
    slot: (typeof allOnsets)[number];
    intent: 'step_chain' | 'third_bridge' | 'smoothing_run' | 'neighbor_return';
    desiredMidi: number;
    direction: -1 | 0 | 1;
    allowThird: boolean;
  }): number => {
    const harmonyEvent = resolveHarmonyEvent(
      input.harmony,
      inputEdge.slot.measure,
      inputEdge.slot.onset,
      input.phraseLengthMeasures,
      input.beatsPerMeasure,
      input.phraseSpec,
      KEY_TO_PC[input.spec.key] ?? 0,
      input.spec.mode
    );
    const strong = isStrongBeat(inputEdge.slot.onset);
    const chordCandidates = chordToneCandidatesInRange(harmonyEvent.chordPcs, input.rangeMin, input.rangeMax);
    const perStepCapBase =
      inputEdge.intent === 'step_chain' ? 2 : inputEdge.intent === 'third_bridge' ? 4 : inputEdge.intent === 'neighbor_return' ? 2 : 2;
    const capSequence = inputEdge.allowThird
      ? [Math.min(perStepCapBase, input.maxLeapSemitones), Math.min(4, input.maxLeapSemitones)]
      : [Math.min(2, input.maxLeapSemitones), Math.min(4, input.maxLeapSemitones)];
    for (const cap of capSequence) {
      let best: number | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const midi of allScaleCandidates) {
        const toPrev = midi - inputEdge.prevMidi;
        const leap = Math.abs(toPrev);
        if (leap === 0 || leap > cap || leap > input.maxLeapSemitones) {
          continue;
        }
        const degree = midiToDegree(midi, input.keyScale);
        if (illegalDegreeSet.has(degree)) {
          continue;
        }
        if (inputEdge.direction > 0 && midi < inputEdge.prevMidi) {
          continue;
        }
        if (inputEdge.direction < 0 && midi > inputEdge.prevMidi) {
          continue;
        }
        const remainingDistance = Math.abs(inputEdge.targetMidi - midi);
        if (remainingDistance > input.maxLeapSemitones * Math.max(1, inputEdge.remainingSlots)) {
          continue;
        }
        const chordTone = chordCandidates.includes(midi);
        const towardTarget = Math.sign(inputEdge.targetMidi - inputEdge.prevMidi) === Math.sign(midi - inputEdge.prevMidi);
        const score =
          Math.abs(midi - inputEdge.desiredMidi) * 3 +
          Math.abs(midi - inputEdge.prevMidi) +
          (strong && !chordTone ? 4 : 0) +
          (!strong && chordTone ? 1.5 : 0) +
          (towardTarget ? 0 : 3);
        if (score < bestScore) {
          best = midi;
          bestScore = score;
        }
      }
      if (best !== null) {
        return best;
      }
    }
    return nearestChordToneMidi(harmonyEvent, inputEdge.prevMidi, input.rangeMin, input.rangeMax);
  };

  const enforceThirdResolutionInSpan = (spanMidis: number[], targetMidi: number): void => {
    // spanMidis includes A at index 0 and intermediate nodes only; B is targetMidi.
    for (let i = 1; i < spanMidis.length - 1; i += 1) {
      const prev = spanMidis[i - 1];
      const curr = spanMidis[i];
      const next = spanMidis[i + 1];
      const leap = Math.abs(curr - prev);
      if (leap < 3 || leap > 4) {
        continue;
      }
      if (Math.abs(next - curr) <= 2) {
        continue;
      }
      const dir: 1 | -1 = targetMidi >= curr ? 1 : -1;
      const step = nextScaleStepMidi(curr, dir, input.keyScale, input.rangeMin, input.rangeMax);
      if (step !== null && Math.abs(step - curr) <= 2) {
        spanMidis[i + 1] = step;
      }
    }
  };

  for (const slot of anchorSlots) {
    const skeletonNote = skeletonByKey.get(slotKey(slot.measure, slot.onset));
    if (!skeletonNote) {
      continue;
    }
    eventBySlot.set(slotKey(slot.measure, slot.onset), createAnchorEvent(slot, skeletonNote));
  }

  for (let anchorIndex = 0; anchorIndex < anchorSlots.length - 1; anchorIndex += 1) {
    const start = anchorSlots[anchorIndex];
    const end = anchorSlots[anchorIndex + 1];
    const startEvent = eventBySlot.get(slotKey(start.measure, start.onset));
    const endEvent = eventBySlot.get(slotKey(end.measure, end.onset));
    if (!startEvent || !endEvent) {
      continue;
    }

    const intermediates = allOnsets.filter((slot) => {
      const t = slot.measure * 16 + slot.onset;
      const a = start.measure * 16 + start.onset;
      const b = end.measure * 16 + end.onset;
      return t > a && t < b && !isAnchorSlot(slot);
    });
    if (intermediates.length === 0) {
      continue;
    }

    const interval = endEvent.midi - startEvent.midi;
    const absInterval = Math.abs(interval);
    const baseDirection: -1 | 0 | 1 = interval > 0 ? 1 : interval < 0 ? -1 : 0;
    const preClimaxToClimax = start.measure <= end.measure && !start.isClimax && end.isClimax;
    const cadenceArrival = end.isCadence;
    const direction: -1 | 0 | 1 =
      preClimaxToClimax && endEvent.midi >= startEvent.midi
        ? 1
        : cadenceArrival && endEvent.midi <= startEvent.midi
          ? -1
          : baseDirection;
    const intent: 'step_chain' | 'third_bridge' | 'smoothing_run' | 'neighbor_return' =
      absInterval === 0 ? 'neighbor_return' : absInterval <= 2 ? 'step_chain' : absInterval <= 4 ? 'third_bridge' : 'smoothing_run';

    const spanMidis: number[] = [startEvent.midi];
    let prevMidi = startEvent.midi;
    for (let j = 0; j < intermediates.length; j += 1) {
      const slot = intermediates[j];
      const fraction = (j + 1) / (intermediates.length + 1);
      const desiredMidi =
        intent === 'neighbor_return'
          ? startEvent.midi + (j % 2 === 0 ? 1 : -1)
          : Math.round(startEvent.midi + (endEvent.midi - startEvent.midi) * fraction);
      const remainingSlots = intermediates.length - (j + 1) + 1; // +1 for landing B
      const allowThird = intent !== 'step_chain' && j > 0;
      const midi = chooseEdgeCandidate({
        prevMidi,
        targetMidi: endEvent.midi,
        remainingSlots,
        slot,
        intent,
        desiredMidi,
        direction,
        allowThird
      });
      const repaired =
        Math.abs(midi - prevMidi) > input.maxLeapSemitones
          ? (nearestPcWithinLeapCap(midi, prevMidi, input.rangeMin, input.rangeMax, input.maxLeapSemitones) ?? midi)
          : midi;
      spanMidis.push(repaired);
      prevMidi = repaired;
    }

    enforceThirdResolutionInSpan(spanMidis, endEvent.midi);

    const composedIntermediateMidis: number[] = [];
    for (let j = 0; j < intermediates.length; j += 1) {
      const slot = intermediates[j];
      const midi = spanMidis[j + 1];
      const harmonyEvent = resolveHarmonyEvent(
        input.harmony,
        slot.measure,
        slot.onset,
        input.phraseLengthMeasures,
        input.beatsPerMeasure,
        input.phraseSpec,
        KEY_TO_PC[input.spec.key] ?? 0,
        input.spec.mode
      );
      const isChordTone = harmonyEvent.chordPcs.includes(((midi % 12) + 12) % 12);
      const tags: NonNullable<MelodyEvent['functionTags']>[number][] = [];
      if (intent === 'smoothing_run') {
        tags.push('smoothing_run');
      }
      if (!isChordTone) {
        tags.push('connective_nht');
      }
      const event: MelodyEvent = {
        pitch: toPitchString(midi),
        octave: toOctave(midi),
        midi,
        duration: 'quarter',
        measure: slot.measure,
        beat: slot.onset,
        onsetBeat: slot.onset,
        durationBeats: 1,
        isAttack: true,
        phraseIndex: input.phraseIndex + 1,
        role: isChordTone ? 'ChordTone' : 'NonHarmonicTone',
        reason: `pass4_edge_${intent}`,
        chordId: `m${harmonyEvent.measure}-b${harmonyEvent.beat}-d${harmonyEvent.degree}`,
        keyId: input.keyId,
        nonHarmonicTone: !isChordTone,
        functionTags: [...new Set(tags)]
      };
      eventBySlot.set(slotKey(slot.measure, slot.onset), event);
      composedIntermediateMidis.push(midi);
    }

    console.debug(
      `[pass4-edge] span=${anchorIndex + 1} A=${startEvent.midi}->B=${endEvent.midi} intent=${intent} mids=[${composedIntermediateMidis.join(
        ','
      )}]`
    );
  }

  for (const slot of allOnsets) {
    const existing = eventBySlot.get(slotKey(slot.measure, slot.onset));
    if (existing) {
      melody.push(existing);
      continue;
    }
    // Fallback only when an edge slot could not be composed.
    const harmonyEvent = resolveHarmonyEvent(
      input.harmony,
      slot.measure,
      slot.onset,
      input.phraseLengthMeasures,
      input.beatsPerMeasure,
      input.phraseSpec,
      KEY_TO_PC[input.spec.key] ?? 0,
      input.spec.mode
    );
    const fallbackMidi = nearestChordToneMidi(harmonyEvent, input.skeleton.notes[0]?.midi ?? 60, input.rangeMin, input.rangeMax);
    eventBySlot.set(slotKey(slot.measure, slot.onset), {
      pitch: toPitchString(fallbackMidi),
      octave: toOctave(fallbackMidi),
      midi: fallbackMidi,
      duration: 'quarter',
      measure: slot.measure,
      beat: slot.onset,
      onsetBeat: slot.onset,
      durationBeats: 1,
      isAttack: true,
      phraseIndex: input.phraseIndex + 1,
      role: 'ChordTone',
      reason: 'pass4_edge_fallback',
      chordId: `m${harmonyEvent.measure}-b${harmonyEvent.beat}-d${harmonyEvent.degree}`,
      keyId: input.keyId,
      nonHarmonicTone: false,
      functionTags: []
    });
    melody.push(eventBySlot.get(slotKey(slot.measure, slot.onset))!);
  }

  const grouped = new Map<number, MelodyEvent[]>();
  for (const event of melody) {
    if (!grouped.has(event.measure)) {
      grouped.set(event.measure, []);
    }
    grouped.get(event.measure)!.push(event);
  }
  for (const inMeasure of grouped.values()) {
    inMeasure.sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
    enforceEeMotionInMeasureDuringFill(inMeasure, input.keyScale, input.rangeMin, input.rangeMax);
    for (let i = 0; i < inMeasure.length; i += 1) {
      const curr = inMeasure[i];
      const next = inMeasure[i + 1];
      const onset = curr.onsetBeat ?? curr.beat;
      const nextOnset = next ? (next.onsetBeat ?? next.beat) : input.beatsPerMeasure + 1;
      const durationBeats = Number((nextOnset - onset).toFixed(3));
      curr.durationBeats = durationBeats;
      curr.duration = beatsToDuration(durationBeats);
    }
  }

  return {
    melody: filterRenderableAttackEvents(melody),
    trace
  };
}

export function classifyMeasuresForRhythm(
  _phrase: PhraseSpec,
  events: MelodyEvent[],
  _phrasePlan: PhrasePlan,
  _harmonyFrames: HarmonyEvent[]
): RhythmMeasureTags[] {
  const grouped = new Map<number, MelodyEvent[]>();
  for (const event of events) {
    if (!grouped.has(event.measure)) {
      grouped.set(event.measure, []);
    }
    grouped.get(event.measure)!.push(event);
  }

  const sortedEvents = [...events].sort((a, b) => a.measure - b.measure || a.beat - b.beat);
  const climaxMidi = sortedEvents.reduce((max, event) => Math.max(max, event.midi), Number.NEGATIVE_INFINITY);
  const climaxMeasure = sortedEvents.find((event) => event.midi === climaxMidi)?.measure ?? sortedEvents[0]?.measure ?? 1;
  const finalMeasure = sortedEvents[sortedEvents.length - 1]?.measure ?? 1;
  const preCadenceMeasure = Math.max(1, finalMeasure - 1);

  const tags: RhythmMeasureTags[] = [];
  for (const [measure, inMeasureUnsorted] of grouped.entries()) {
    const inMeasure = [...inMeasureUnsorted].sort((a, b) => a.beat - b.beat);
    let leaps = 0;
    let steps = 0;
    let smoothingEdge = false;
    for (let i = 1; i < inMeasure.length; i += 1) {
      const semis = Math.abs(inMeasure[i].midi - inMeasure[i - 1].midi);
      if (semis >= 5) {
        smoothingEdge = true;
      }
      if (semis >= 3) {
        leaps += 1;
      } else if (semis > 0 && semis <= 2) {
        steps += 1;
      }
    }

    const runIntensity = steps / Math.max(1, inMeasure.length - 1);
    const hasClimaxInMeasure = inMeasure.some((event) => event.midi === climaxMidi);
    const stabilityNeeded = measure > climaxMeasure || measure >= preCadenceMeasure;

    tags.push({
      measure,
      is_final_measure: measure === finalMeasure,
      is_pre_cadence_measure: measure === preCadenceMeasure,
      has_climax_in_measure: hasClimaxInMeasure,
      needs_smoothing_in_measure: smoothingEdge || leaps >= 2,
      run_intensity: runIntensity,
      stability_needed: stabilityNeeded
    });
  }

  return tags.sort((a, b) => a.measure - b.measure);
}

function eligibleTemplatesForMeasure(tags: RhythmMeasureTags): RhythmTemplate[] {
  if (tags.is_final_measure) {
    return RHYTHM_TEMPLATES.filter((template) => template.tags.cadence);
  }
  if (tags.has_climax_in_measure) {
    return RHYTHM_TEMPLATES.filter((template) => template.tags.climax || template.tags.stable);
  }
  if (tags.needs_smoothing_in_measure) {
    return RHYTHM_TEMPLATES.filter((template) => template.tags.smoothing || template.tags.stable);
  }
  return RHYTHM_TEMPLATES.filter((template) => template.tags.stable || template.tags.run);
}

function templateWeightFit(template: RhythmTemplate, weights: RhythmWeights): number {
  return (
    template.counts.whole * weights.whole +
    template.counts.half * weights.half +
    template.counts.quarter * weights.quarter +
    template.counts.eighth * weights.eighth
  );
}

export function chooseMeasureTemplate(tags: RhythmMeasureTags, weights: RhythmWeights): MeasureTemplateId {
  const eligible = eligibleTemplatesForMeasure(tags);
  const scored = eligible
    .map((template) => ({
      template,
      score: templateWeightFit(template, weights)
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.template.id ?? 'STABLE';
}

function beatsToDuration(beats: number): string {
  if (beats >= 4) {
    return 'whole';
  }
  if (beats >= 2) {
    return 'half';
  }
  if (beats <= 0.5) {
    return 'eighth';
  }
  return 'quarter';
}

type MeasureRhythmMode = 'normal' | 'smoothing' | 'climax' | 'cadence';

function labelEventFunctions(events: MelodyEvent[], _phrasePlan: PhrasePlan): MelodyEvent[] {
  const sorted = [...events].sort((a, b) => a.measure - b.measure || a.beat - b.beat);
  const climaxMidi = sorted.reduce((max, event) => Math.max(max, event.midi), Number.NEGATIVE_INFINITY);
  const finalMeasure = sorted[sorted.length - 1]?.measure ?? 1;
  const cadenceBeatFloor = 3;

  return sorted.map((event, index) => {
    const tags = new Set<NonNullable<MelodyEvent['functionTags']>[number]>();
    if (event.reason.includes('structuralSkeleton')) {
      tags.add('anchor');
      tags.add('structural');
    }
    if (event.role === 'NonHarmonicTone') {
      tags.add('connective_nht');
    }
    const next = sorted[index + 1];
    if (next && next.measure === event.measure && Math.abs(next.midi - event.midi) >= 5) {
      tags.add('smoothing_run');
    }
    if (event.midi === climaxMidi) {
      tags.add('climax');
    }
    if (event.measure === finalMeasure && event.beat >= cadenceBeatFloor) {
      tags.add('cadence');
    }
    return {
      ...event,
      functionTags: [...tags]
    };
  });
}

export function classifyMeasureRhythmMode(eventsInMeasure: MelodyEvent[]): MeasureRhythmMode {
  const hasCadence = eventsInMeasure.some((event) => event.functionTags?.includes('cadence'));
  if (hasCadence) {
    return 'cadence';
  }

  const hasClimax = eventsInMeasure.some((event) => event.functionTags?.includes('climax'));
  if (hasClimax) {
    return 'climax';
  }

  const hasSmoothingTag = eventsInMeasure.some((event) => event.functionTags?.includes('smoothing_run'));
  const hasLargeLeap = eventsInMeasure.some((event, index) => {
    if (index === 0) {
      return false;
    }
    return Math.abs(event.midi - eventsInMeasure[index - 1].midi) >= 5;
  });
  if (hasSmoothingTag || hasLargeLeap) {
    return 'smoothing';
  }

  return 'normal';
}

export function chooseGrid(mode: MeasureRhythmMode, eventsInMeasure: MelodyEvent[]): number[] {
  if (mode === 'normal') {
    return [1, 2, 3, 4];
  }

  if (mode === 'cadence') {
    const hardCount = eventsInMeasure.filter((event) =>
      (event.functionTags ?? []).some((tag) => tag === 'anchor' || tag === 'structural' || tag === 'cadence')
    ).length;
    return hardCount <= 1 ? [1] : [1, 3];
  }

  if (mode === 'climax') {
    const hasStrongThree = eventsInMeasure.some((event) => event.beat >= 3 && event.beat < 4);
    return hasStrongThree ? [1, 3] : [1];
  }

  const runBeats = eventsInMeasure
    .filter((event) => event.functionTags?.includes('smoothing_run'))
    .map((event) => event.beat);
  const center = runBeats.length > 0 ? runBeats.reduce((a, b) => a + b, 0) / runBeats.length : 2.5;
  // Allow eighth attacks only in one EE window.
  return center < 3 ? [1, 2, 2.5, 3, 4] : [1, 2, 3, 3.5, 4];
}

function eventPriority(event: MelodyEvent): number {
  const tags = event.functionTags ?? [];
  if (tags.includes('cadence')) {
    return 100;
  }
  if (tags.includes('climax')) {
    return 95;
  }
  if (tags.includes('anchor') || tags.includes('structural')) {
    return 90;
  }
  if (tags.includes('smoothing_run')) {
    return 60;
  }
  if (tags.includes('connective_nht')) {
    return 40;
  }
  return 20;
}

function isHardKeepEvent(event: MelodyEvent): boolean {
  const tags = event.functionTags ?? [];
  return tags.includes('anchor') || tags.includes('structural') || tags.includes('climax') || tags.includes('cadence');
}

export function filterRenderableAttackEvents(events: MelodyEvent[]): MelodyEvent[] {
  return events
    .filter((event) => event.isAttack === true)
    .sort((a, b) => a.measure - b.measure || (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
}

export function getFinalRenderEvents(events: MelodyEvent[]): MelodyEvent[] {
  return filterRenderableAttackEvents(events);
}

const PASS4_ALLOWED_DURATIONS = new Set([0.5, 1, 2, 4]);

function allowedEeBeatBasesForMeter(beatsPerMeasure: number): Array<1 | 2 | 3 | 4> {
  const candidates: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];
  return candidates.filter((beat) => beat + 0.5 <= beatsPerMeasure + 1e-6);
}

function pass4SafeGrids(beatsPerMeasure: number): number[][] {
  const quarterGrid = Array.from({ length: Math.max(1, Math.floor(beatsPerMeasure)) }, (_, i) => i + 1);
  const grids: number[][] = [quarterGrid];
  for (const beatBase of allowedEeBeatBasesForMeter(beatsPerMeasure)) {
    const withEe = [...quarterGrid];
    const idx = withEe.findIndex((v) => Math.abs(v - beatBase) < 1e-6);
    if (idx >= 0) {
      withEe.splice(idx + 1, 0, beatBase + 0.5);
      grids.push(withEe);
    }
  }
  return grids;
}

function normalizeAllowEighthBeats(
  input: Array<1 | 2 | 3 | 4> | 1 | 2 | 3 | 4 | undefined,
  beatsPerMeasure: number
): Array<1 | 2 | 3 | 4> {
  const byMeter = allowedEeBeatBasesForMeter(beatsPerMeasure);
  if (Array.isArray(input)) {
    const filtered = input.filter((b): b is 1 | 2 | 3 | 4 => byMeter.includes(b));
    return filtered.length > 0 ? filtered : byMeter;
  }
  if (input !== undefined && byMeter.includes(input)) {
    return [input];
  }
  return byMeter;
}

function retuneEvent(event: MelodyEvent, midi: number): MelodyEvent {
  return {
    ...event,
    midi,
    pitch: toPitchString(midi),
    octave: toOctave(midi)
  };
}

function parseKeyFromEvent(event: MelodyEvent): { tonicPc: number; mode: ExerciseSpec['mode']; keyScale: number[] } {
  const [key, modeRaw] = String(event.keyId ?? 'C-major').split('-');
  const mode: ExerciseSpec['mode'] = modeRaw === 'minor' ? 'minor' : 'major';
  const tonicPc = KEY_TO_PC[key] ?? 0;
  const scale = modeScale(mode).map((step) => (tonicPc + step) % 12);
  return { tonicPc, mode, keyScale: scale };
}

function chooseBestGridForMeasure(onsets: number[], beatsPerMeasure: number): number[] {
  const safeGrids = pass4SafeGrids(beatsPerMeasure);
  let best = safeGrids[0];
  let bestCost = Number.POSITIVE_INFINITY;
  for (const grid of safeGrids) {
    if (onsets.length > grid.length) {
      continue;
    }
    let cost = 0;
    for (let i = 0; i < onsets.length; i += 1) {
      cost += Math.abs(onsets[i] - grid[Math.min(i, grid.length - 1)]);
    }
    if (cost < bestCost) {
      best = grid;
      bestCost = cost;
    }
  }
  return best;
}

function chooseBestGridSlots(onsets: number[], grid: number[]): number[] {
  const need = onsets.length;
  if (need <= 0) {
    return [];
  }
  if (need >= grid.length) {
    return [...grid];
  }

  let best: number[] = grid.slice(0, need);
  let bestCost = Number.POSITIVE_INFINITY;

  const recurse = (start: number, picked: number[]): void => {
    if (picked.length === need) {
      if (Math.abs((picked[0] ?? 0) - 1) > 0.001) {
        return;
      }
      const durations: number[] = [];
      for (let i = 0; i < picked.length; i += 1) {
        const next = picked[i + 1] ?? 5;
        durations.push(next - picked[i]);
      }
      if (!durations.every((dur) => PASS4_ALLOWED_DURATIONS.has(dur))) {
        return;
      }
      let cost = 0;
      for (let i = 0; i < need; i += 1) {
        cost += Math.abs(onsets[i] - picked[i]);
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = [...picked];
      }
      return;
    }
    for (let i = start; i < grid.length; i += 1) {
      picked.push(grid[i]);
      recurse(i + 1, picked);
      picked.pop();
    }
  };

  recurse(0, []);
  return best;
}

function recomputeMeasureAttackDurations(
  events: MelodyEvent[],
  measure: number,
  beatsPerMeasure: number,
  repairLog: Pass4RepairLogEntry[]
): void {
  const attacks = events
    .filter((event) => event.measure === measure && event.isAttack === true)
    .sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
  for (let i = 0; i < attacks.length; i += 1) {
    const curr = attacks[i];
    const next = attacks[i + 1];
    const onset = curr.onsetBeat ?? curr.beat;
    const nextOnset = next ? (next.onsetBeat ?? next.beat) : beatsPerMeasure + 1;
    const newDur = nextOnset - onset;
    if (Math.abs((curr.durationBeats ?? -1) - newDur) > 1e-6) {
      repairLog.push({
        code: 'must0_recompute_duration',
        detail: { measure, onset, from: curr.durationBeats, to: newDur }
      });
    }
    curr.durationBeats = newDur;
    curr.duration = beatsToDuration(newDur);
  }
}

function quantizeMeasureToSafeGrid(
  events: MelodyEvent[],
  measure: number,
  beatsPerMeasure: number,
  repairLog: Pass4RepairLogEntry[]
): void {
  const inMeasure = events
    .filter((event) => event.measure === measure)
    .sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
  let attacks = inMeasure.filter((event) => event.isAttack === true);
  if (attacks.length === 0) {
    return;
  }

  const onsets = attacks.map((event) => event.onsetBeat ?? event.beat);
  const hasBeat2Half = onsets.some((onset) => Math.abs(onset - 2.5) < 0.001);
  const hasBeat3Half = onsets.some((onset) => Math.abs(onset - 3.5) < 0.001);
  let grid = hasBeat2Half
    ? [1, 2, 2.5, 3, 4]
    : hasBeat3Half
      ? [1, 2, 3, 3.5, 4]
      : chooseBestGridForMeasure(onsets, beatsPerMeasure);
  grid = grid.filter((onset) => onset <= beatsPerMeasure + 1e-6);

  while (attacks.length > grid.length) {
    const removable = attacks
      .filter((event) => !isHardKeepEvent(event))
      .sort((a, b) => eventPriority(a) - eventPriority(b));
    const victim = removable[0];
    if (!victim) {
      break;
    }
    victim.isAttack = false;
    victim.tieStop = true;
    repairLog.push({
      code: 'must0_demote_attack_for_grid',
      detail: { measure, onset: victim.onsetBeat ?? victim.beat, midi: victim.midi }
    });
    attacks = inMeasure.filter((event) => event.isAttack === true);
    const reducedOnsets = attacks.map((event) => event.onsetBeat ?? event.beat);
    const reducedHasBeat2Half = reducedOnsets.some((onset) => Math.abs(onset - 2.5) < 0.001);
    const reducedHasBeat3Half = reducedOnsets.some((onset) => Math.abs(onset - 3.5) < 0.001);
    grid = reducedHasBeat2Half
      ? [1, 2, 2.5, 3, 4]
      : reducedHasBeat3Half
        ? [1, 2, 3, 3.5, 4]
        : chooseBestGridForMeasure(reducedOnsets, beatsPerMeasure);
    grid = grid.filter((onset) => onset <= beatsPerMeasure + 1e-6);
  }

  attacks.sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
  const chosenSlots = chooseBestGridSlots(
    attacks.map((event) => event.onsetBeat ?? event.beat),
    grid
  );
  for (let i = 0; i < attacks.length; i += 1) {
    const targetOnset = chosenSlots[Math.min(i, chosenSlots.length - 1)];
    const prevOnset = attacks[i].onsetBeat ?? attacks[i].beat;
    if (Math.abs(prevOnset - targetOnset) > 1e-6) {
      repairLog.push({
        code: 'must0_quantize_onset',
        detail: { measure, from: prevOnset, to: targetOnset, midi: attacks[i].midi }
      });
    }
    attacks[i].onsetBeat = targetOnset;
    attacks[i].beat = targetOnset;
  }

  recomputeMeasureAttackDurations(events, measure, beatsPerMeasure, repairLog);
}

function ensureMeasureValidity(
  events: MelodyEvent[],
  beatsPerMeasure: number,
  repairLog: Pass4RepairLogEntry[]
): void {
  const measures = [...new Set(events.map((event) => event.measure))];
  for (const measure of measures) {
    quantizeMeasureToSafeGrid(events, measure, beatsPerMeasure, repairLog);
    const attacks = events
      .filter((event) => event.measure === measure && event.isAttack === true)
      .sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
    for (const attack of attacks) {
      const onset = attack.onsetBeat ?? attack.beat;
      if (!(onset >= 1 && onset < beatsPerMeasure + 1)) {
        const clamped = Math.max(1, Math.min(beatsPerMeasure, Math.round(onset)));
        repairLog.push({
          code: 'must0_onset_clamp',
          detail: { measure, from: onset, to: clamped, midi: attack.midi }
        });
        attack.onsetBeat = clamped;
        attack.beat = clamped;
      }
    }
    recomputeMeasureAttackDurations(events, measure, beatsPerMeasure, repairLog);
  }
}

function chordDegreeFromChordId(chordId: string): number | null {
  const match = /-d(\d+)$/.exec(chordId);
  if (!match) {
    return null;
  }
  const degree = Number(match[1]);
  return Number.isFinite(degree) ? degree : null;
}

function eePairExistsInMeasure(events: MelodyEvent[], measure: number, beatBase: 1 | 2 | 3 | 4): boolean {
  const attacks = events.filter((event) => event.measure === measure && event.isAttack === true);
  const hasA = attacks.some((event) => Math.abs((event.onsetBeat ?? event.beat) - beatBase) < 0.001);
  const hasB = attacks.some((event) => Math.abs((event.onsetBeat ?? event.beat) - (beatBase + 0.5)) < 0.001);
  return hasA && hasB;
}

function enforceNoLoneEighths(
  events: MelodyEvent[],
  beatsPerMeasure: number,
  allowEighthBeats: Array<1 | 2 | 3 | 4>,
  minEighthPairsPerPhrase: number,
  repairLog: Pass4RepairLogEntry[]
): void {
  const measures = [...new Set(events.map((event) => event.measure))].sort((a, b) => a - b);

  const clearHalfAttacksInMeasure = (measure: number): void => {
    const inMeasure = events
      .filter((event) => event.measure === measure)
      .sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
    const activeOnsets = new Set(
      inMeasure
        .filter((event) => event.isAttack === true)
        .map((event) => Number((event.onsetBeat ?? event.beat).toFixed(3)))
    );
    let changed = false;
    for (const event of inMeasure) {
      if (event.isAttack !== true) {
        continue;
      }
      const onset = event.onsetBeat ?? event.beat;
      const frac = onset % 1;
      const isHalfOnset = Math.abs(frac - 0.5) < 0.001;
      if (!isHalfOnset) {
        continue;
      }
      const validHalf = allowEighthBeats.some((beatBase) => Math.abs(onset - (beatBase + 0.5)) < 0.001);
      const pairedOnBeat = Number((onset - 0.5).toFixed(3));
      const hasPair = activeOnsets.has(pairedOnBeat);
      if (!validHalf || !hasPair) {
        event.isAttack = false;
        event.tieStop = true;
        changed = true;
        repairLog.push({
          code: !validHalf ? 'must1_remove_disallowed_half_onset' : 'must1_remove_unpaired_half_onset',
          detail: { measure, onset, midi: event.midi, pairedOnBeat }
        });
      }
    }
    if (changed) {
      quantizeMeasureToSafeGrid(events, measure, beatsPerMeasure, repairLog);
    }
  };

  for (const measure of measures) {
    clearHalfAttacksInMeasure(measure);
    const attacks = events
      .filter((event) => event.measure === measure && event.isAttack === true)
      .sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));

    for (const attack of attacks) {
      const onset = attack.onsetBeat ?? attack.beat;
      const dur = attack.durationBeats ?? 0;
      if (Math.abs(dur - 0.5) > 1e-6) {
        continue;
      }
      const isStart = allowEighthBeats.some((beatBase) => Math.abs(onset - beatBase) < 0.001);
      const pairOnset = onset + 0.5;
      const hasPair = attacks.some((event) => Math.abs((event.onsetBeat ?? event.beat) - pairOnset) < 0.001);
      if (isStart && hasPair) {
        continue;
      }
      attack.isAttack = false;
      attack.tieStop = true;
      repairLog.push({
        code: 'must1_demote_lone_eighth',
        detail: { measure, onset, midi: attack.midi }
      });
      quantizeMeasureToSafeGrid(events, measure, beatsPerMeasure, repairLog);
      break;
    }
  }

  let pairCount = 0;
  for (const measure of measures) {
    for (const beatBase of allowEighthBeats) {
      if (eePairExistsInMeasure(events, measure, beatBase)) {
        pairCount += 1;
      }
    }
  }

  if (minEighthPairsPerPhrase > pairCount) {
    for (const measure of measures) {
      if (pairCount >= minEighthPairsPerPhrase) {
        break;
      }
      const inMeasure = events
        .filter((event) => event.measure === measure && event.isAttack === true)
        .sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
      // To preserve no-dotted durations, forced EE needs a legal 4-onset frame: [1, b, b+0.5, b+1].
      if (inMeasure.length < 4) {
        continue;
      }
      const beatBase = allowEighthBeats.includes(2) ? 2 : 3;
      if (eePairExistsInMeasure(events, measure, beatBase)) {
        continue;
      }
      inMeasure[0].onsetBeat = 1;
      inMeasure[0].beat = 1;
      inMeasure[1].onsetBeat = beatBase;
      inMeasure[1].beat = beatBase;
      inMeasure[2].onsetBeat = beatBase + 0.5;
      inMeasure[2].beat = beatBase + 0.5;
      inMeasure[3].onsetBeat = beatBase + 1;
      inMeasure[3].beat = beatBase + 1;
      repairLog.push({
        code: 'must1_force_ee_pair',
        detail: { measure, onsets: [1, beatBase, beatBase + 0.5, beatBase + 1] }
      });
      recomputeMeasureAttackDurations(events, measure, beatsPerMeasure, repairLog);
      pairCount += 1;
    }
  }
}

function enforceHardStartDo(
  events: MelodyEvent[],
  tessitura: { minMidi: number; maxMidi: number },
  hardStartDo: boolean,
  repairLog: Pass4RepairLogEntry[]
): void {
  if (!hardStartDo) {
    return;
  }
  const attacks = filterRenderableAttackEvents(events);
  const first = attacks[0];
  if (!first) {
    return;
  }
  const { tonicPc } = parseKeyFromEvent(first);
  const target = nearestMidiWithPcInRange(tonicPc, first.midi, tessitura.minMidi, tessitura.maxMidi);
  if (target !== null && target !== first.midi) {
    repairLog.push({
      code: 'must2_hard_start_do_octave',
      detail: { from: first.midi, to: target }
    });
    const tuned = retuneEvent(first, target);
    Object.assign(first, tuned);
  }
  if (((first.midi % 12) + 12) % 12 !== tonicPc) {
    const tonicInRange = nearestMidiWithPcInRange(tonicPc, first.midi, tessitura.minMidi, tessitura.maxMidi);
    if (tonicInRange !== null) {
      repairLog.push({
        code: 'must2_hard_start_do_pc',
        detail: { from: first.midi, to: tonicInRange }
      });
      const tuned = retuneEvent(first, tonicInRange);
      Object.assign(first, tuned);
    }
  }
}

function enforceDefaultOpeningDoOrMi(
  events: MelodyEvent[],
  tessitura: { minMidi: number; maxMidi: number },
  hardStartDo: boolean,
  repairLog: Pass4RepairLogEntry[]
): void {
  if (hardStartDo) {
    return;
  }
  const attacks = filterRenderableAttackEvents(events);
  const first = attacks[0];
  if (!first) {
    return;
  }
  const { tonicPc, keyScale } = parseKeyFromEvent(first);
  const firstDegree = midiToDegree(first.midi, keyScale);
  if (firstDegree === 1 || firstDegree === 3) {
    return;
  }
  const doPc = tonicPc;
  const miPc = keyScale[(3 - 1 + 7) % 7];
  const doTarget = nearestMidiWithPcInRange(doPc, first.midi, tessitura.minMidi, tessitura.maxMidi);
  const miTarget = nearestMidiWithPcInRange(miPc, first.midi, tessitura.minMidi, tessitura.maxMidi);
  const targets = [doTarget, miTarget].filter((midi): midi is number => midi !== null);
  if (targets.length === 0) {
    return;
  }
  const chosen = targets.reduce((best, midi) => (Math.abs(midi - first.midi) < Math.abs(best - first.midi) ? midi : best));
  if (chosen !== first.midi) {
    repairLog.push({
      code: 'pass10_default_start_do_or_mi',
      detail: { from: first.midi, to: chosen }
    });
    const tuned = retuneEvent(first, chosen);
    Object.assign(first, tuned);
  }
}

function enforceTessitura(
  events: MelodyEvent[],
  tessitura: { minMidi: number; maxMidi: number },
  repairLog: Pass4RepairLogEntry[]
): void {
  for (const event of events.filter((entry) => entry.isAttack === true)) {
    if (event.midi >= tessitura.minMidi && event.midi <= tessitura.maxMidi) {
      continue;
    }
    const shifted = nearestMidiWithPcInRange(((event.midi % 12) + 12) % 12, event.midi, tessitura.minMidi, tessitura.maxMidi);
    if (shifted !== null) {
      repairLog.push({
        code: 'must4_tessitura_octave_shift',
        detail: { measure: event.measure, onset: event.onsetBeat ?? event.beat, from: event.midi, to: shifted }
      });
      Object.assign(event, retuneEvent(event, shifted));
      continue;
    }
    const { tonicPc, mode } = parseKeyFromEvent(event);
    const degree = chordDegreeFromChordId(event.chordId);
    const chordPcs = degree ? chordForDegree(tonicPc, mode, degree) : [tonicPc];
    const inRange = chordToneCandidatesInRange(chordPcs, tessitura.minMidi, tessitura.maxMidi).sort(
      (a, b) => Math.abs(a - event.midi) - Math.abs(b - event.midi)
    );
    if (inRange.length > 0) {
      repairLog.push({
        code: 'must4_tessitura_chord_swap',
        detail: { measure: event.measure, onset: event.onsetBeat ?? event.beat, from: event.midi, to: inRange[0] }
      });
      Object.assign(event, retuneEvent(event, inRange[0]));
    }
  }
}

function enforceMaxLeap(
  events: MelodyEvent[],
  tessitura: { minMidi: number; maxMidi: number },
  repairLog: Pass4RepairLogEntry[],
  maxLeapSemitones: number,
  allowAttackDemotion = true
): void {
  const attacks = filterRenderableAttackEvents(events);
  for (let i = 1; i < attacks.length; i += 1) {
    const prev = attacks[i - 1];
    const curr = attacks[i];
    const interval = curr.midi - prev.midi;
    if (Math.abs(interval) <= maxLeapSemitones) {
      continue;
    }
    const samePc = nearestPcWithinLeapCap(curr.midi, prev.midi, tessitura.minMidi, tessitura.maxMidi, maxLeapSemitones);
    if (samePc !== null) {
      repairLog.push({
        code: 'must3_interval_octave_repair',
        detail: { from: curr.midi, to: samePc, prev: prev.midi }
      });
      Object.assign(curr, retuneEvent(curr, samePc));
      continue;
    }

    if (!isLockedAttack(curr)) {
      const { tonicPc, mode } = parseKeyFromEvent(curr);
      const degree = chordDegreeFromChordId(curr.chordId);
      const chordPcs = degree ? chordForDegree(tonicPc, mode, degree) : [];
      const chordRepair = nearestAllowedPcWithinLeapCap(
        chordPcs,
        curr.midi,
        prev.midi,
        tessitura.minMidi,
        tessitura.maxMidi,
        maxLeapSemitones
      );
      if (chordRepair !== null) {
        repairLog.push({
          code: 'must3_interval_chord_swap',
          detail: { from: curr.midi, to: chordRepair, prev: prev.midi }
        });
        Object.assign(curr, retuneEvent(curr, chordRepair));
        continue;
      }
    }

    if (allowAttackDemotion && !isLockedAttack(curr)) {
      curr.isAttack = false;
      curr.tieStop = true;
      repairLog.push({
        code: 'must3_demote_unrepairable_attack',
        detail: { measure: curr.measure, onset: curr.onsetBeat ?? curr.beat, midi: curr.midi, prev: prev.midi }
      });
    } else if (!allowAttackDemotion) {
      repairLog.push({
        code: 'must3_unresolved_without_demotion',
        detail: { measure: curr.measure, onset: curr.onsetBeat ?? curr.beat, midi: curr.midi, prev: prev.midi }
      });
    }
  }
}

function enforceEeMotionLawPass4(
  events: MelodyEvent[],
  tessitura: { minMidi: number; maxMidi: number },
  repairLog: Pass4RepairLogEntry[]
): void {
  const attacks = filterRenderableAttackEvents(events);
  for (let i = 0; i < attacks.length - 1; i += 1) {
    const e1 = attacks[i];
    const e2 = attacks[i + 1];
    if (e1.measure !== e2.measure) {
      continue;
    }
    const a = e1.onsetBeat ?? e1.beat;
    const b = e2.onsetBeat ?? e2.beat;
    const isEePair = (Math.abs(a - 2) < 0.001 && Math.abs(b - 2.5) < 0.001) || (Math.abs(a - 3) < 0.001 && Math.abs(b - 3.5) < 0.001);
    if (!isEePair) {
      continue;
    }
    let delta = Math.abs(e2.midi - e1.midi);
    const next = attacks[i + 2];
    if (delta > 4) {
      const { keyScale } = parseKeyFromEvent(e2);
      const target = next?.midi ?? e2.midi;
      const step = chooseHarmonyAwareStepTowardTarget(e1.midi, target, e2, { mode: parseKeyFromEvent(e2).mode } as ExerciseSpec, parseKeyFromEvent(e2).tonicPc, keyScale, tessitura.minMidi, tessitura.maxMidi);
      repairLog.push({
        code: 'must5_pair_interval_repair',
        detail: { measure: e1.measure, from: e2.midi, to: step, e1: e1.midi, target }
      });
      Object.assign(e2, retuneEvent(e2, step));
      delta = Math.abs(e2.midi - e1.midi);
    }

    if ((delta === 3 || delta === 4) && next) {
      const resolution = Math.abs(next.midi - e2.midi);
      if (resolution > 2) {
        if (isLockedAttack(next)) {
          const { tonicPc, mode, keyScale } = parseKeyFromEvent(e2);
          const stepwise = chooseHarmonyAwareStepTowardTarget(
            e1.midi,
            next.midi,
            e2,
            { mode } as ExerciseSpec,
            tonicPc,
            keyScale,
            tessitura.minMidi,
            tessitura.maxMidi
          );
          if (Math.abs(stepwise - e1.midi) <= 2) {
            repairLog.push({
              code: 'must5_forbid_third_locked_next',
              detail: { measure: e1.measure, from: e2.midi, to: stepwise, next: next.midi }
            });
            Object.assign(e2, retuneEvent(e2, stepwise));
          }
        } else {
          const { keyScale } = parseKeyFromEvent(next);
          const dir: 1 | -1 = next.midi >= e2.midi ? 1 : -1;
          const step = nextScaleStepMidi(e2.midi, dir, keyScale, tessitura.minMidi, tessitura.maxMidi);
          if (step !== null) {
            repairLog.push({
              code: 'must5_resolve_third_with_next',
              detail: { measure: e1.measure, from: next.midi, to: step, e2: e2.midi }
            });
            Object.assign(next, retuneEvent(next, step));
          }
        }
      }
    }
  }
}

function applyCadenceShouldRule(
  events: MelodyEvent[],
  cadenceType: 'authentic' | 'half',
  tessitura: { minMidi: number; maxMidi: number },
  repairLog: Pass4RepairLogEntry[]
): void {
  if (cadenceType === 'half') {
    return;
  }
  const attacks = filterRenderableAttackEvents(events);
  const last = attacks[attacks.length - 1];
  const penult = attacks[attacks.length - 2];
  if (!last) {
    return;
  }
  const { tonicPc, keyScale } = parseKeyFromEvent(last);
  const doPc = tonicPc;
  const miPc = keyScale[(3 - 1 + 7) % 7];
  const doTarget = nearestMidiWithPcInRange(doPc, last.midi, tessitura.minMidi, tessitura.maxMidi);
  const miTarget = nearestMidiWithPcInRange(miPc, last.midi, tessitura.minMidi, tessitura.maxMidi);
  const cadenceTargets = [doTarget, miTarget].filter((midi): midi is number => midi !== null);
  const cadenceTarget =
    cadenceTargets.length > 0
      ? cadenceTargets.reduce((best, midi) => (Math.abs(midi - last.midi) < Math.abs(best - last.midi) ? midi : best))
      : null;
  const finalDegree = midiToDegree(last.midi, keyScale);
  if (cadenceTarget !== null && finalDegree !== 1 && finalDegree !== 3) {
    repairLog.push({
      code: 'should1_final_to_do_or_mi',
      detail: { from: last.midi, to: cadenceTarget }
    });
    Object.assign(last, retuneEvent(last, cadenceTarget));
  }

  if (!penult) {
    return;
  }
  if (Math.abs(last.midi - penult.midi) <= 2) {
    return;
  }
  const deg2Pc = keyScale[(2 - 1 + 7) % 7];
  const deg7Pc = keyScale[(7 - 1 + 7) % 7];
  const candidates = [deg2Pc, deg7Pc]
    .map((pc) => nearestMidiWithPcInRange(pc, penult.midi, tessitura.minMidi, tessitura.maxMidi))
    .filter((midi): midi is number => midi !== null)
    .filter((midi) => Math.abs(last.midi - midi) <= 2);
  if (candidates.length > 0) {
    if (isLockedAttack(penult)) {
      repairLog.push({
        code: 'should1_cadence_unlock_penult',
        detail: { from: penult.midi, to: candidates[0], final: last.midi }
      });
    }
    repairLog.push({
      code: 'should1_penult_step_to_final',
      detail: { from: penult.midi, to: candidates[0], final: last.midi }
    });
    Object.assign(penult, retuneEvent(penult, candidates[0]));
    return;
  }

  // Fallback cadence unlock: if 2/7 cannot satisfy, force nearest diatonic step into final.
  const upStep = nextScaleStepMidi(last.midi, 1, keyScale, tessitura.minMidi, tessitura.maxMidi);
  const downStep = nextScaleStepMidi(last.midi, -1, keyScale, tessitura.minMidi, tessitura.maxMidi);
  const stepCandidates = [upStep, downStep]
    .filter((midi): midi is number => midi !== null)
    .filter((midi) => Math.abs(last.midi - midi) <= 2)
    .sort((a, b) => Math.abs(a - penult.midi) - Math.abs(b - penult.midi));
  if (stepCandidates.length > 0) {
    if (isLockedAttack(penult)) {
      repairLog.push({
        code: 'should1_cadence_unlock_penult_fallback',
        detail: { from: penult.midi, to: stepCandidates[0], final: last.midi }
      });
    }
    Object.assign(penult, retuneEvent(penult, stepCandidates[0]));
  }
}

function applyClimaxShouldRule(
  events: MelodyEvent[],
  tessitura: { minMidi: number; maxMidi: number },
  repairLog: Pass4RepairLogEntry[],
  maxLeapSemitones: number
): void {
  const attacks = filterRenderableAttackEvents(events);
  if (attacks.length === 0) {
    return;
  }
  const taggedClimaxIndices = attacks
    .map((event, idx) => ({ event, idx }))
    .filter(({ event }) => (event.functionTags ?? []).includes('climax'))
    .map(({ idx }) => idx);
  const maxMidi = Math.max(...attacks.map((event) => event.midi));
  if (taggedClimaxIndices.length > 0) {
    const targetIdx = taggedClimaxIndices[0];
    const target = attacks[targetIdx];
    if (target.midi < maxMidi) {
      const raised = nearestMidiWithPcInRange(((target.midi % 12) + 12) % 12, maxMidi + 1, tessitura.minMidi, tessitura.maxMidi);
      if (raised !== null) {
        repairLog.push({
          code: 'should2_raise_tagged_climax',
          detail: { from: target.midi, to: raised }
        });
        Object.assign(target, retuneEvent(target, raised));
      }
    }
  }
  const peak = Math.max(...attacks.map((event) => event.midi));
  const peakIndices = attacks.map((event, idx) => ({ event, idx })).filter(({ event }) => event.midi === peak).map(({ idx }) => idx);
  for (let i = 1; i < peakIndices.length; i += 1) {
    const event = attacks[peakIndices[i]];
    if (isLockedAttack(event)) {
      continue;
    }
    const down = nearestMidiWithPcInRange(((event.midi % 12) + 12) % 12, event.midi - 1, tessitura.minMidi, tessitura.maxMidi);
    if (down !== null && down < event.midi) {
      repairLog.push({
        code: 'should2_reduce_competing_peak',
        detail: { measure: event.measure, from: event.midi, to: down }
      });
      Object.assign(event, retuneEvent(event, down));
    }
  }

  const refreshed = filterRenderableAttackEvents(events);
  const climaxIndex = refreshed.reduce((best, event, idx) => (event.midi > refreshed[best].midi ? idx : best), 0);
  for (let i = climaxIndex + 1; i < refreshed.length; i += 1) {
    const prev = refreshed[i - 1];
    const curr = refreshed[i];
    if (Math.abs(curr.midi - prev.midi) <= 4) {
      continue;
    }
    if (isLockedAttack(curr)) {
      continue;
    }
    const preferred = nearestPcWithinLeapCap(curr.midi, prev.midi, tessitura.minMidi, tessitura.maxMidi, maxLeapSemitones);
    if (preferred !== null) {
      repairLog.push({
        code: 'should2_smooth_post_climax',
        detail: { from: curr.midi, to: preferred, prev: prev.midi }
      });
      Object.assign(curr, retuneEvent(curr, preferred));
    }
  }
}

function tieMergeRepeatedAttacks(
  events: MelodyEvent[],
  beatsPerMeasure: number,
  allowEighthBeats: Array<1 | 2 | 3 | 4>,
  repairLog: Pass4RepairLogEntry[]
): void {
  const measures = [...new Set(events.map((event) => event.measure))];
  for (const measure of measures) {
    const attacks = events
      .filter((event) => event.measure === measure && event.isAttack === true)
      .sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
    for (let i = 1; i < attacks.length; i += 1) {
      const prev = attacks[i - 1];
      const curr = attacks[i];
      if (prev.midi !== curr.midi) {
        continue;
      }
      const prevOnset = prev.onsetBeat ?? prev.beat;
      const currOnset = curr.onsetBeat ?? curr.beat;
      const isEePair = allowEighthBeats.some(
        (beatBase) => Math.abs(prevOnset - beatBase) < 0.001 && Math.abs(currOnset - (beatBase + 0.5)) < 0.001
      );
      if (isEePair) {
        continue;
      }
      curr.isAttack = false;
      prev.tieStart = true;
      curr.tieStop = true;
      repairLog.push({
        code: 'should3_tie_merge_repeat',
        detail: { measure, onset: curr.onsetBeat ?? curr.beat, midi: curr.midi }
      });
    }
    quantizeMeasureToSafeGrid(events, measure, beatsPerMeasure, repairLog);
  }
}

function assertPass4(
  events: MelodyEvent[],
  ctx: Pass4RepairContext
): void {
  const beatsPerMeasure = ctx.timeSigBeatsPerMeasure;
  const attacks = filterRenderableAttackEvents(events);
  const allowEeBeats = normalizeAllowEighthBeats(ctx.allowEighthBeats, beatsPerMeasure);
  const measures = [...new Set(attacks.map((event) => event.measure))];
  for (const measure of measures) {
    const inMeasure = attacks
      .filter((event) => event.measure === measure)
      .sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
    const sum = inMeasure.reduce((acc, event) => acc + (event.durationBeats ?? 0), 0);
    if (Math.abs(sum - beatsPerMeasure) > 1e-6) {
      throw new Error(`pass4_assert_measure_sum m${measure} sum=${sum.toFixed(6)} expected=${beatsPerMeasure}`);
    }
    for (const event of inMeasure) {
      const dur = event.durationBeats ?? 0;
      if (!PASS4_ALLOWED_DURATIONS.has(dur)) {
        throw new Error(`pass4_assert_duration m${measure} onset=${String(event.onsetBeat ?? event.beat)} dur=${dur}`);
      }
      const onset = event.onsetBeat ?? event.beat;
      if (!(onset >= 1 && onset < beatsPerMeasure + 1)) {
        throw new Error(`pass4_assert_onset_bounds m${measure} onset=${onset}`);
      }
      if (event.midi < ctx.tessitura.minMidi || event.midi > ctx.tessitura.maxMidi) {
        throw new Error(`pass4_assert_tessitura m${measure} onset=${onset} midi=${event.midi}`);
      }
    }
  }
  for (let i = 1; i < attacks.length; i += 1) {
    const interval = Math.abs(attacks[i].midi - attacks[i - 1].midi);
    const maxLeap = Math.max(1, ctx.user.maxLeapSemitones ?? MAX_MELODIC_LEAP_SEMIS);
    if (interval > maxLeap) {
      throw new Error(`pass4_assert_interval idx=${i} interval=${interval}`);
    }
  }
  for (const measure of measures) {
    const inMeasure = attacks
      .filter((event) => event.measure === measure)
      .sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
    for (const event of inMeasure) {
      if (Math.abs((event.durationBeats ?? 0) - 0.5) > 1e-6) {
        continue;
      }
      const onset = event.onsetBeat ?? event.beat;
      const frac = onset % 1;
      if (Math.abs(frac) < 0.001) {
        const validBase = allowEeBeats.some((beatBase) => Math.abs(onset - beatBase) < 0.001);
        const pair = inMeasure.some((candidate) => Math.abs((candidate.onsetBeat ?? candidate.beat) - (onset + 0.5)) < 0.001);
        if (!validBase || !pair) {
          throw new Error(`pass4_assert_lone_eighth m${measure} onset=${onset}`);
        }
      } else if (Math.abs(frac - 0.5) < 0.001) {
        const validHalf = allowEeBeats.some((beatBase) => Math.abs(onset - (beatBase + 0.5)) < 0.001);
        const pair = inMeasure.some((candidate) => Math.abs((candidate.onsetBeat ?? candidate.beat) - (onset - 0.5)) < 0.001);
        if (!validHalf || !pair) {
          throw new Error(`pass4_assert_lone_eighth m${measure} onset=${onset}`);
        }
      } else {
        throw new Error(`pass4_assert_lone_eighth m${measure} onset=${onset}`);
      }
    }
    for (const beatBase of allowEeBeats) {
      const e1 = inMeasure.find((event) => Math.abs((event.onsetBeat ?? event.beat) - beatBase) < 0.001);
      const e2 = inMeasure.find((event) => Math.abs((event.onsetBeat ?? event.beat) - (beatBase + 0.5)) < 0.001);
      if (!e1 || !e2) {
        continue;
      }
      const pairDelta = Math.abs(e2.midi - e1.midi);
      if (pairDelta > 4) {
        throw new Error(`pass4_assert_ee_motion m${measure} beat=${beatBase} delta=${pairDelta}`);
      }
      if (pairDelta === 3 || pairDelta === 4) {
        const idx = attacks.findIndex((event) => event === e2);
        const next = attacks[idx + 1];
        if (next && Math.abs(next.midi - e2.midi) > 2) {
          throw new Error(`pass4_assert_ee_resolution m${measure} beat=${beatBase}`);
        }
      }
    }
  }
  if (ctx.user.hardStartDo) {
    const first = attacks[0];
    if (first) {
      const { tonicPc } = parseKeyFromEvent(first);
      if (((first.midi % 12) + 12) % 12 !== tonicPc) {
        throw new Error(`pass4_assert_hard_start_do midi=${first.midi} tonicPc=${tonicPc}`);
      }
    }
  }
}

export function repairPass4(
  events: MelodyEvent[],
  ctx: Pass4RepairContext
): { events: MelodyEvent[]; repairLog: Pass4RepairLogEntry[] } {
  const beatsPerMeasure = ctx.timeSigBeatsPerMeasure;
  const allowEeBeats = normalizeAllowEighthBeats(ctx.allowEighthBeats, beatsPerMeasure);
  const minEePairs = Math.max(0, ctx.user.minEighthPairsPerPhrase ?? 0);
  const maxLeapSemitones = Math.max(1, ctx.user.maxLeapSemitones ?? MAX_MELODIC_LEAP_SEMIS);
  const repaired = [...events].map((event) => ({ ...event, isAttack: event.isAttack ?? true }));
  const repairLog: Pass4RepairLogEntry[] = [];

  // MUST-0
  ensureMeasureValidity(repaired, beatsPerMeasure, repairLog);

  // MUST-2
  enforceHardStartDo(repaired, ctx.tessitura, ctx.user.hardStartDo === true, repairLog);

  // User cadence intent is highest-priority preference before secondary shaping.
  applyCadenceShouldRule(repaired, ctx.user.cadenceType ?? 'authentic', ctx.tessitura, repairLog);

  // MUST-1
  enforceNoLoneEighths(repaired, beatsPerMeasure, allowEeBeats, minEePairs, repairLog);

  // MUST-3
  enforceMaxLeap(repaired, ctx.tessitura, repairLog, maxLeapSemitones);
  ensureMeasureValidity(repaired, beatsPerMeasure, repairLog);

  // MUST-4
  enforceTessitura(repaired, ctx.tessitura, repairLog);

  // MUST-5
  enforceEeMotionLawPass4(repaired, ctx.tessitura, repairLog);

  // Re-assert user-driven constraints so later repairs cannot drift them.
  enforceHardStartDo(repaired, ctx.tessitura, ctx.user.hardStartDo === true, repairLog);
  applyCadenceShouldRule(repaired, ctx.user.cadenceType ?? 'authentic', ctx.tessitura, repairLog);
  enforceNoLoneEighths(repaired, beatsPerMeasure, allowEeBeats, minEePairs, repairLog);
  ensureMeasureValidity(repaired, beatsPerMeasure, repairLog);

  // SHOULD-2 climax
  applyClimaxShouldRule(repaired, ctx.tessitura, repairLog, maxLeapSemitones);

  // SHOULD-3 tie merge repeated
  if (minEePairs <= 0) {
    tieMergeRepeatedAttacks(repaired, beatsPerMeasure, allowEeBeats, repairLog);
  }
  ensureMeasureValidity(repaired, beatsPerMeasure, repairLog);
  // Keep EE enforcement as the final rhythm rewrite so quantization cannot strip required pairs.
  enforceNoLoneEighths(repaired, beatsPerMeasure, allowEeBeats, minEePairs, repairLog);
  ensureMeasureValidity(repaired, beatsPerMeasure, repairLog);

  const finalEvents = filterRenderableAttackEvents(repaired);
  const finalMinEe = Math.max(0, ctx.user.minEighthPairsPerPhrase ?? 0);
  if (finalMinEe > 0) {
    const measures = [...new Set(finalEvents.map((event) => event.measure))];
    let pairCount = 0;
    for (const measure of measures) {
      for (const beatBase of allowEeBeats) {
        if (eePairExistsInMeasure(finalEvents, measure, beatBase)) {
          pairCount += 1;
        }
      }
    }
    if (pairCount < finalMinEe) {
      repairLog.push({
        code: 'must1_min_ee_shortfall',
        detail: { required: finalMinEe, actual: pairCount }
      });
    }
  }
  assertPass4(finalEvents, ctx);
  return { events: finalEvents, repairLog };
}

function countEePairs(events: MelodyEvent[]): number {
  const attacks = filterRenderableAttackEvents(events);
  const measures = [...new Set(attacks.map((event) => event.measure))];
  let pairs = 0;
  for (const measure of measures) {
    if (eePairExistsInMeasure(attacks, measure, 2)) {
      pairs += 1;
    }
    if (eePairExistsInMeasure(attacks, measure, 3)) {
      pairs += 1;
    }
  }
  return pairs;
}

function noteValueCounts(events: MelodyEvent[]): { W: number; H: number; Q: number; EE: number } {
  const counts = { W: 0, H: 0, Q: 0, EE: 0 };
  for (const event of filterRenderableAttackEvents(events)) {
    const dur = event.durationBeats ?? 0;
    if (Math.abs(dur - 4) < 1e-6) {
      counts.W += 1;
    } else if (Math.abs(dur - 2) < 1e-6) {
      counts.H += 1;
    } else if (Math.abs(dur - 1) < 1e-6) {
      counts.Q += 1;
    } else if (Math.abs(dur - 0.5) < 1e-6) {
      counts.EE += 1;
    }
  }
  return counts;
}

function nudgeRhythmDistributionTowardUserTarget(
  events: MelodyEvent[],
  beatsPerMeasure: number,
  minEePairs: number,
  target?: { EE: number; Q: number; H: number; W: number },
  cadenceType: 'authentic' | 'half' = 'authentic',
  repairLog: Pass10ConstraintLogEntry[] = []
): MelodyEvent[] {
  if (!target) {
    return events;
  }
  const next = [...events].map((event) => ({ ...event }));
  const attacks = filterRenderableAttackEvents(next);
  if (attacks.length === 0) {
    return next;
  }
  const measureIds = [...new Set(attacks.map((event) => event.measure))].sort((a, b) => a - b);
  const finalMeasure = measureIds[measureIds.length - 1];
  const counts = noteValueCounts(next);
  const needWholeCadence = target.W > target.H && cadenceType !== 'half';

  const finalAttacks = next
    .filter((event) => event.measure === finalMeasure && event.isAttack === true)
    .sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
  if (needWholeCadence && finalAttacks.length > 0) {
    finalAttacks[0].onsetBeat = 1;
    finalAttacks[0].beat = 1;
    for (let i = 1; i < finalAttacks.length; i += 1) {
      if (!isHardKeepEvent(finalAttacks[i])) {
        finalAttacks[i].isAttack = false;
        finalAttacks[i].tieStop = true;
      }
    }
    repairLog.push({
      code: 'pass10_rhythm_nudge_cadence_whole',
      detail: { finalMeasure }
    });
    ensureMeasureValidity(next, beatsPerMeasure, repairLog);
  } else if (target.H > target.W && finalAttacks.length >= 2) {
    finalAttacks[0].onsetBeat = 1;
    finalAttacks[0].beat = 1;
    finalAttacks[1].onsetBeat = 3;
    finalAttacks[1].beat = 3;
    repairLog.push({
      code: 'pass10_rhythm_nudge_cadence_half_half',
      detail: { finalMeasure }
    });
    ensureMeasureValidity(next, beatsPerMeasure, repairLog);
  }

  // If user strongly prefers EE, bias one non-final measure into an EE-safe grid.
  if (target.EE >= Math.max(target.Q, target.H, target.W)) {
    const currentPairs = countEePairs(next);
    if (currentPairs < Math.max(1, minEePairs)) {
      for (const measure of measureIds) {
        if (measure === finalMeasure) {
          continue;
        }
        const inMeasure = next
          .filter((event) => event.measure === measure && event.isAttack === true)
          .sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
        if (inMeasure.length < 4) {
          continue;
        }
        inMeasure[0].onsetBeat = 1;
        inMeasure[0].beat = 1;
        inMeasure[1].onsetBeat = 2;
        inMeasure[1].beat = 2;
        inMeasure[2].onsetBeat = 2.5;
        inMeasure[2].beat = 2.5;
        inMeasure[3].onsetBeat = 3;
        inMeasure[3].beat = 3;
        repairLog.push({
          code: 'pass10_rhythm_nudge_force_ee_grid',
          detail: { measure, onsets: [1, 2, 2.5, 3] }
        });
        break;
      }
      ensureMeasureValidity(next, beatsPerMeasure, repairLog);
      enforceNoLoneEighths(next, beatsPerMeasure, allowedEeBeatBasesForMeter(beatsPerMeasure), Math.max(1, minEePairs), repairLog);
      ensureMeasureValidity(next, beatsPerMeasure, repairLog);
    }
  } else if (counts.EE > 0 && target.EE === 0) {
    enforceNoLoneEighths(next, beatsPerMeasure, allowedEeBeatBasesForMeter(beatsPerMeasure), 0, repairLog);
    ensureMeasureValidity(next, beatsPerMeasure, repairLog);
  }

  return next;
}

interface Pass10IllegalViolationCounts {
  illegalDegreeCount: number;
  illegalIntervalCount: number;
  illegalTransitionCount: number;
}

function isIllegalTransition(prevDegree: number, currDegree: number, transitions: ExerciseSpec['illegalTransitions']): boolean {
  return transitions.some((rule) => rule.mode === 'adjacent' && rule.a === prevDegree && rule.b === currDegree);
}

function countIllegalRuleViolations(events: MelodyEvent[], ctx: Pass10UserConstraintContext): Pass10IllegalViolationCounts {
  const attacks = filterRenderableAttackEvents(events);
  const illegalDegreeSet = new Set(ctx.illegalDegrees ?? []);
  const illegalIntervalSet = new Set(ctx.illegalIntervalsSemis ?? []);
  const illegalTransitions = ctx.illegalTransitions ?? [];
  let illegalDegreeCount = 0;
  let illegalIntervalCount = 0;
  let illegalTransitionCount = 0;

  for (let i = 0; i < attacks.length; i += 1) {
    const curr = attacks[i];
    const { keyScale } = parseKeyFromEvent(curr);
    const currDegree = midiToDegree(curr.midi, keyScale);
    if (illegalDegreeSet.has(currDegree)) {
      illegalDegreeCount += 1;
    }
    if (i === 0) {
      continue;
    }
    const prev = attacks[i - 1];
    const prevDegree = midiToDegree(prev.midi, keyScale);
    const interval = Math.abs(curr.midi - prev.midi);
    if (illegalIntervalSet.has(interval)) {
      illegalIntervalCount += 1;
    }
    if (isIllegalTransition(prevDegree, currDegree, illegalTransitions)) {
      illegalTransitionCount += 1;
    }
  }

  return { illegalDegreeCount, illegalIntervalCount, illegalTransitionCount };
}

function validateAllMustPass10(
  events: MelodyEvent[],
  ctx: Pass10UserConstraintContext
): { violations: string[]; illegalCounts: Pass10IllegalViolationCounts } {
  const violations: string[] = [];
  const allowedNoteValues = new Set<'EE' | 'Q' | 'H' | 'W'>(ctx.allowedNoteValues ?? ['EE', 'Q', 'H']);
  const beatsPerMeasure = ctx.beatsPerMeasure ?? 4;
  const attacks = filterRenderableAttackEvents(events);
  const grouped = new Map<number, MelodyEvent[]>();
  for (const event of attacks) {
    if (!grouped.has(event.measure)) {
      grouped.set(event.measure, []);
    }
    grouped.get(event.measure)!.push(event);
  }
  for (const [measure, inMeasure] of grouped.entries()) {
    const sorted = [...inMeasure].sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
    const sum = sorted.reduce((acc, event) => acc + (event.durationBeats ?? 0), 0);
    if (Math.abs(sum - beatsPerMeasure) > 1e-6) {
      violations.push(`measure_sum m${measure}=${sum}`);
    }
    for (const event of sorted) {
      if (!PASS4_ALLOWED_DURATIONS.has(event.durationBeats ?? -1)) {
        violations.push(`duration m${measure} onset=${String(event.onsetBeat ?? event.beat)} dur=${String(event.durationBeats)}`);
      }
      if (!isDurationAllowedByNoteValues(event.durationBeats ?? -1, allowedNoteValues)) {
        violations.push(`allowed_note_values m${measure} onset=${String(event.onsetBeat ?? event.beat)} dur=${String(event.durationBeats)}`);
      }
      if (event.midi < ctx.tessitura.minMidi || event.midi > ctx.tessitura.maxMidi) {
        violations.push(`tessitura m${measure} onset=${String(event.onsetBeat ?? event.beat)} midi=${event.midi}`);
      }
    }
  }
  const maxLeap = Math.max(1, ctx.user.maxLeapSemitones ?? MAX_MELODIC_LEAP_SEMIS);
  for (let i = 1; i < attacks.length; i += 1) {
    if (Math.abs(attacks[i].midi - attacks[i - 1].midi) > maxLeap) {
      violations.push(`max_leap idx=${i}`);
    }
  }
  return {
    violations,
    illegalCounts: countIllegalRuleViolations(events, ctx)
  };
}

function resolveChordPcsForEvent(event: MelodyEvent): number[] {
  const { tonicPc, mode } = parseKeyFromEvent(event);
  const degree = chordDegreeFromChordId(event.chordId);
  return degree ? chordForDegree(tonicPc, mode, degree) : [];
}

function pickNearestLegalRetune(
  curr: MelodyEvent,
  prev: MelodyEvent | null,
  next: MelodyEvent | null,
  ctx: Pass10UserConstraintContext,
  preferChordTone: boolean
): number | null {
  const illegalDegreeSet = new Set(ctx.illegalDegrees ?? []);
  const illegalIntervalSet = new Set(ctx.illegalIntervalsSemis ?? []);
  const illegalTransitions = ctx.illegalTransitions ?? [];
  const maxLeap = Math.max(1, ctx.user.maxLeapSemitones ?? MAX_MELODIC_LEAP_SEMIS);
  const { keyScale } = parseKeyFromEvent(curr);
  const chordPcs = resolveChordPcsForEvent(curr);
  const allowedPcs = preferChordTone && chordPcs.length > 0 ? new Set(chordPcs) : new Set(keyScale);

  let best: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let midi = ctx.tessitura.minMidi; midi <= ctx.tessitura.maxMidi; midi += 1) {
    const pc = ((midi % 12) + 12) % 12;
    if (!allowedPcs.has(pc)) {
      continue;
    }
    const degree = midiToDegree(midi, keyScale);
    if (illegalDegreeSet.has(degree)) {
      continue;
    }
    if (prev) {
      const prevDegree = midiToDegree(prev.midi, keyScale);
      const prevInterval = Math.abs(midi - prev.midi);
      if (prevInterval > maxLeap || illegalIntervalSet.has(prevInterval)) {
        continue;
      }
      if (isIllegalTransition(prevDegree, degree, illegalTransitions)) {
        continue;
      }
    }
    if (next) {
      const nextDegree = midiToDegree(next.midi, keyScale);
      const nextInterval = Math.abs(next.midi - midi);
      if (nextInterval > maxLeap || illegalIntervalSet.has(nextInterval)) {
        continue;
      }
      if (isIllegalTransition(degree, nextDegree, illegalTransitions)) {
        continue;
      }
    }
    const score =
      Math.abs(midi - curr.midi) * 10 +
      (prev ? Math.abs(midi - prev.midi) : 0) +
      (next ? Math.abs(next.midi - midi) : 0);
    if (score < bestScore) {
      bestScore = score;
      best = midi;
    }
  }
  return best;
}

function stabilizeAfterIllegalRepair(
  events: MelodyEvent[],
  ctx: Pass10UserConstraintContext,
  repairLog: Pass10ConstraintLogEntry[]
): void {
  const beatsPerMeasure = ctx.beatsPerMeasure ?? 4;
  const minEePairs = Math.max(0, ctx.user.minEighthPairsPerPhrase ?? 0);
  const maxLeapSemitones = Math.max(1, ctx.user.maxLeapSemitones ?? MAX_MELODIC_LEAP_SEMIS);
  const lockFinalRhythm = ctx.lockFinalRhythmFromPass2 !== false;
  if (!lockFinalRhythm) {
    ensureMeasureValidity(events, beatsPerMeasure, repairLog);
    enforceNoLoneEighths(events, beatsPerMeasure, allowedEeBeatBasesForMeter(beatsPerMeasure), minEePairs, repairLog);
  }
  enforceMaxLeap(events, ctx.tessitura, repairLog, maxLeapSemitones, !lockFinalRhythm);
  enforceTessitura(events, ctx.tessitura, repairLog);
  enforceHardStartDo(events, ctx.tessitura, ctx.user.hardStartDo === true, repairLog);
  applyCadenceShouldRule(events, ctx.user.cadenceType ?? 'authentic', ctx.tessitura, repairLog);
  if (!lockFinalRhythm) {
    ensureMeasureValidity(events, beatsPerMeasure, repairLog);
  }
}

function isDurationAllowedByNoteValues(durationBeats: number, allowed: Set<'EE' | 'Q' | 'H' | 'W'>): boolean {
  if (Math.abs(durationBeats - 4) < 1e-6) {
    return allowed.has('W');
  }
  if (Math.abs(durationBeats - 2) < 1e-6) {
    return allowed.has('H');
  }
  if (Math.abs(durationBeats - 1) < 1e-6) {
    return allowed.has('Q');
  }
  if (Math.abs(durationBeats - 0.5) < 1e-6) {
    return allowed.has('EE');
  }
  return false;
}

function enforceAllowedNoteValuesPass10(
  events: MelodyEvent[],
  ctx: Pass10UserConstraintContext,
  repairLog: Pass10ConstraintLogEntry[]
): void {
  const allowed = new Set<'EE' | 'Q' | 'H' | 'W'>(ctx.allowedNoteValues ?? ['EE', 'Q', 'H']);
  const beatsPerMeasure = ctx.beatsPerMeasure ?? 4;
  const measures = [...new Set(events.filter((e) => e.isAttack === true).map((e) => e.measure))].sort((a, b) => a - b);

  for (const measure of measures) {
    let guard = 0;
    while (guard < 16) {
      guard += 1;
      const attacks = events
        .filter((e) => e.measure === measure && e.isAttack === true)
        .sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
      let changed = false;
      for (let i = 0; i < attacks.length; i += 1) {
        const curr = attacks[i];
        const onset = curr.onsetBeat ?? curr.beat;
        const nextOnset = i + 1 < attacks.length ? (attacks[i + 1].onsetBeat ?? attacks[i + 1].beat) : beatsPerMeasure + 1;
        const dur = Number((nextOnset - onset).toFixed(3));
        if (isDurationAllowedByNoteValues(dur, allowed)) {
          continue;
        }

        const insertAt = (newOnset: number): boolean => {
          const collision = attacks.some((a) => Math.abs((a.onsetBeat ?? a.beat) - newOnset) < 1e-6);
          if (collision) {
            return false;
          }
          const clone: MelodyEvent = {
            ...curr,
            beat: newOnset,
            onsetBeat: newOnset,
            isAttack: true,
            tieStart: undefined,
            tieStop: undefined,
            reason: `${curr.reason}|pass10_allowed_note_values_split`
          };
          events.push(clone);
          return true;
        };

        if (Math.abs(dur - 4) < 1e-6) {
          if (allowed.has('H')) {
            changed = insertAt(onset + 2) || changed;
          } else if (allowed.has('Q')) {
            changed = insertAt(onset + 1) || changed;
            changed = insertAt(onset + 2) || changed;
            changed = insertAt(onset + 3) || changed;
          }
        } else if (Math.abs(dur - 2) < 1e-6) {
          if (allowed.has('Q')) {
            changed = insertAt(onset + 1) || changed;
          }
        }

        if (changed) {
          repairLog.push({
            code: 'pass10_enforce_allowed_note_values',
            detail: { measure, onset, duration: dur, allowed: [...allowed] }
          });
          break;
        }
      }

      if (!changed) {
        break;
      }
      ensureMeasureValidity(events, beatsPerMeasure, repairLog);
      enforceNoLoneEighths(
        events,
        beatsPerMeasure,
        allowedEeBeatBasesForMeter(beatsPerMeasure),
        Math.max(0, ctx.user.minEighthPairsPerPhrase ?? 0),
        repairLog
      );
      ensureMeasureValidity(events, beatsPerMeasure, repairLog);
    }
  }
}

function enforceIllegalDegreesPass10(
  events: MelodyEvent[],
  ctx: Pass10UserConstraintContext,
  repairLog: Pass10ConstraintLogEntry[]
): void {
  const allowAttackDemotion = ctx.lockFinalRhythmFromPass2 !== true;
  const illegalDegreeSet = new Set(ctx.illegalDegrees ?? []);
  if (illegalDegreeSet.size === 0) {
    return;
  }
  for (let guard = 0; guard < 128; guard += 1) {
    const attacks = filterRenderableAttackEvents(events);
    let changed = false;
    for (let i = 0; i < attacks.length; i += 1) {
      const curr = attacks[i];
      const prev = i > 0 ? attacks[i - 1] : null;
      const next = i + 1 < attacks.length ? attacks[i + 1] : null;
      const { keyScale } = parseKeyFromEvent(curr);
      const degree = midiToDegree(curr.midi, keyScale);
      if (!illegalDegreeSet.has(degree)) {
        continue;
      }
      const chordRetune = pickNearestLegalRetune(curr, prev, next, ctx, true);
      if (chordRetune !== null) {
        Object.assign(curr, retuneEvent(curr, chordRetune));
        repairLog.push({ code: 'pass10_illegal_degree_retune_chord', detail: { fromDegree: degree, toMidi: chordRetune } });
        changed = true;
        break;
      }
      const scaleRetune = pickNearestLegalRetune(curr, prev, next, ctx, false);
      if (scaleRetune !== null) {
        Object.assign(curr, retuneEvent(curr, scaleRetune));
        repairLog.push({ code: 'pass10_illegal_degree_retune_scale', detail: { fromDegree: degree, toMidi: scaleRetune } });
        changed = true;
        break;
      }
      if (allowAttackDemotion && !isLockedAttack(curr)) {
        curr.isAttack = false;
        curr.tieStop = true;
        repairLog.push({ code: 'pass10_illegal_degree_demote', detail: { measure: curr.measure, onset: curr.onsetBeat ?? curr.beat } });
        changed = true;
        break;
      }
      repairLog.push({
        code: allowAttackDemotion ? 'pass10_illegal_degree_unresolved_locked' : 'pass10_illegal_degree_unresolved_rhythm_locked',
        detail: { measure: curr.measure, onset: curr.onsetBeat ?? curr.beat }
      });
    }
    if (!changed) {
      break;
    }
    stabilizeAfterIllegalRepair(events, ctx, repairLog);
  }
}

function enforceIllegalIntervalsPass10(
  events: MelodyEvent[],
  ctx: Pass10UserConstraintContext,
  repairLog: Pass10ConstraintLogEntry[]
): void {
  const allowAttackDemotion = ctx.lockFinalRhythmFromPass2 !== true;
  const illegalIntervalSet = new Set(ctx.illegalIntervalsSemis ?? []);
  if (illegalIntervalSet.size === 0) {
    return;
  }
  for (let guard = 0; guard < 128; guard += 1) {
    const attacks = filterRenderableAttackEvents(events);
    let changed = false;
    for (let i = 1; i < attacks.length; i += 1) {
      const prev = attacks[i - 1];
      const curr = attacks[i];
      const next = i + 1 < attacks.length ? attacks[i + 1] : null;
      const interval = Math.abs(curr.midi - prev.midi);
      if (!illegalIntervalSet.has(interval)) {
        continue;
      }
      const chordRetune = pickNearestLegalRetune(curr, prev, next, ctx, true);
      if (chordRetune !== null) {
        Object.assign(curr, retuneEvent(curr, chordRetune));
        repairLog.push({ code: 'pass10_illegal_interval_retune_chord', detail: { fromInterval: interval, toMidi: chordRetune } });
        changed = true;
        break;
      }
      const scaleRetune = pickNearestLegalRetune(curr, prev, next, ctx, false);
      if (scaleRetune !== null) {
        Object.assign(curr, retuneEvent(curr, scaleRetune));
        repairLog.push({ code: 'pass10_illegal_interval_retune_scale', detail: { fromInterval: interval, toMidi: scaleRetune } });
        changed = true;
        break;
      }
      if (allowAttackDemotion && !isLockedAttack(curr)) {
        curr.isAttack = false;
        curr.tieStop = true;
        repairLog.push({ code: 'pass10_illegal_interval_demote', detail: { measure: curr.measure, onset: curr.onsetBeat ?? curr.beat } });
        changed = true;
        break;
      }
      repairLog.push({
        code: allowAttackDemotion ? 'pass10_illegal_interval_unresolved_locked' : 'pass10_illegal_interval_unresolved_rhythm_locked',
        detail: { measure: curr.measure, onset: curr.onsetBeat ?? curr.beat }
      });
    }
    if (!changed) {
      break;
    }
    stabilizeAfterIllegalRepair(events, ctx, repairLog);
  }
}

function enforceIllegalTransitionsPass10(
  events: MelodyEvent[],
  ctx: Pass10UserConstraintContext,
  repairLog: Pass10ConstraintLogEntry[]
): void {
  const allowAttackDemotion = ctx.lockFinalRhythmFromPass2 !== true;
  const illegalTransitions = ctx.illegalTransitions ?? [];
  if (illegalTransitions.length === 0) {
    return;
  }
  for (let guard = 0; guard < 128; guard += 1) {
    const attacks = filterRenderableAttackEvents(events);
    let changed = false;
    for (let i = 1; i < attacks.length; i += 1) {
      const prev = attacks[i - 1];
      const curr = attacks[i];
      const next = i + 1 < attacks.length ? attacks[i + 1] : null;
      const { keyScale } = parseKeyFromEvent(curr);
      const prevDegree = midiToDegree(prev.midi, keyScale);
      const currDegree = midiToDegree(curr.midi, keyScale);
      if (!isIllegalTransition(prevDegree, currDegree, illegalTransitions)) {
        continue;
      }
      const chordRetune = pickNearestLegalRetune(curr, prev, next, ctx, true);
      if (chordRetune !== null) {
        Object.assign(curr, retuneEvent(curr, chordRetune));
        repairLog.push({
          code: 'pass10_illegal_transition_retune_chord',
          detail: { fromTransition: [prevDegree, currDegree], toMidi: chordRetune }
        });
        changed = true;
        break;
      }
      const scaleRetune = pickNearestLegalRetune(curr, prev, next, ctx, false);
      if (scaleRetune !== null) {
        Object.assign(curr, retuneEvent(curr, scaleRetune));
        repairLog.push({
          code: 'pass10_illegal_transition_retune_scale',
          detail: { fromTransition: [prevDegree, currDegree], toMidi: scaleRetune }
        });
        changed = true;
        break;
      }
      if (allowAttackDemotion && !isLockedAttack(curr)) {
        curr.isAttack = false;
        curr.tieStop = true;
        repairLog.push({
          code: 'pass10_illegal_transition_demote',
          detail: { measure: curr.measure, onset: curr.onsetBeat ?? curr.beat, fromTransition: [prevDegree, currDegree] }
        });
        changed = true;
        break;
      }
      repairLog.push({
        code: allowAttackDemotion ? 'pass10_illegal_transition_unresolved_locked' : 'pass10_illegal_transition_unresolved_rhythm_locked',
        detail: { measure: curr.measure, onset: curr.onsetBeat ?? curr.beat, fromTransition: [prevDegree, currDegree] }
      });
    }
    if (!changed) {
      break;
    }
    stabilizeAfterIllegalRepair(events, ctx, repairLog);
  }
}

export function applyUserConstraintsPass10(
  events: MelodyEvent[],
  ctx: Pass10UserConstraintContext
): { events: MelodyEvent[]; constraintLog: Pass10ConstraintLogEntry[] } {
  const beatsPerMeasure = ctx.beatsPerMeasure ?? 4;
  const rhythmDist = ctx.user.rhythmDist;
  const minEePairs = Math.max(0, ctx.user.minEighthPairsPerPhrase ?? 0);
  const cadenceType = ctx.user.cadenceType ?? 'authentic';
  const hardStartDo = ctx.user.hardStartDo === true;
  const maxLeapSemitones = Math.max(1, ctx.user.maxLeapSemitones ?? MAX_MELODIC_LEAP_SEMIS);
  const lockFinalRhythm = ctx.lockFinalRhythmFromPass2 !== false;

  let constrained: MelodyEvent[];
  const constraintLog: Pass10ConstraintLogEntry[] = [];
  if (lockFinalRhythm) {
    constrained = filterRenderableAttackEvents(events).map((event) => ({ ...event, isAttack: true }));
    constraintLog.push({
      code: 'pass10_rhythm_locked_from_pass2',
      detail: { events: constrained.length }
    });
  } else {
    const pass4 = repairPass4(events, {
      timeSigBeatsPerMeasure: beatsPerMeasure,
      allowEighthBeats: allowedEeBeatBasesForMeter(beatsPerMeasure),
      tessitura: ctx.tessitura,
      user: {
        hardStartDo,
        cadenceType: cadenceType === 'half' ? 'half' : 'authentic',
        minEighthPairsPerPhrase: minEePairs,
        maxLeapSemitones
      }
    });
    constrained = [...pass4.events].map((event) => ({ ...event }));
    constraintLog.push(
      ...pass4.repairLog.map((entry) => ({
        code: entry.code,
        detail: entry.detail
      }))
    );
  }

  if (!lockFinalRhythm) {
    constrained = nudgeRhythmDistributionTowardUserTarget(
      constrained,
      beatsPerMeasure,
      minEePairs,
      rhythmDist,
      cadenceType,
      constraintLog
    );
  }

  // Authoritative illegal-rule cleanup on ATTACK events.
  enforceIllegalDegreesPass10(constrained, ctx, constraintLog);
  enforceIllegalIntervalsPass10(constrained, ctx, constraintLog);
  enforceIllegalTransitionsPass10(constrained, ctx, constraintLog);
  stabilizeAfterIllegalRepair(constrained, ctx, constraintLog);
  if (!lockFinalRhythm) {
    enforceAllowedNoteValuesPass10(constrained, ctx, constraintLog);
  }
  stabilizeAfterIllegalRepair(constrained, ctx, constraintLog);

  // Final authority re-assertion of hard user intent.
  enforceDefaultOpeningDoOrMi(constrained, ctx.tessitura, hardStartDo, constraintLog);
  enforceHardStartDo(constrained, ctx.tessitura, hardStartDo, constraintLog);
  applyCadenceShouldRule(constrained, cadenceType, ctx.tessitura, constraintLog);
  if (!lockFinalRhythm) {
    enforceNoLoneEighths(constrained, beatsPerMeasure, allowedEeBeatBasesForMeter(beatsPerMeasure), minEePairs, constraintLog);
    ensureMeasureValidity(constrained, beatsPerMeasure, constraintLog);
  }
  enforceMaxLeap(constrained, ctx.tessitura, constraintLog, maxLeapSemitones, !lockFinalRhythm);
  if (!lockFinalRhythm) {
    ensureMeasureValidity(constrained, beatsPerMeasure, constraintLog);
  }

  const validation = validateAllMustPass10(constrained, ctx);
  if (validation.violations.length > 0) {
    constraintLog.push({
      code: 'pass10_must_violation',
      detail: { violations: validation.violations, illegalCounts: validation.illegalCounts }
    });
  }

  return {
    events: filterRenderableAttackEvents(constrained),
    constraintLog
  };
}

function mergeTiedPlaybackEvents(events: MelodyEvent[], beatsPerMeasure: number): PlaybackEvent[] {
  const attacks = filterRenderableAttackEvents(events);
  const playback: PlaybackEvent[] = [];
  for (const attack of attacks) {
    const onsetBeat = attack.onsetBeat ?? attack.beat;
    const durationBeats = attack.durationBeats ?? 1;
    const startBeats = (attack.measure - 1) * beatsPerMeasure + (onsetBeat - 1);
    const prev = playback[playback.length - 1];
    if (
      prev &&
      prev.midi === attack.midi &&
      Math.abs(prev.startBeats + prev.durationBeats - startBeats) < 1e-6 &&
      (attack.tieStop || attack.tieStart || (attack.functionTags ?? []).includes('cadence'))
    ) {
      prev.durationBeats += durationBeats;
      continue;
    }
    playback.push({
      midi: attack.midi,
      measure: attack.measure,
      onsetBeat,
      durationBeats,
      startBeats
    });
  }
  return playback;
}

function assertPlaybackMatchesNotation(playback: PlaybackEvent[], events: MelodyEvent[], beatsPerMeasure: number): void {
  const attacks = filterRenderableAttackEvents(events);
  if (playback.length > attacks.length) {
    throw new Error(`pass11_assert_event_count playback=${playback.length} notation=${attacks.length}`);
  }
  for (const event of playback) {
    const inNotation = attacks.some((attack) => {
      const attackStart = (attack.measure - 1) * beatsPerMeasure + ((attack.onsetBeat ?? attack.beat) - 1);
      return Math.abs(attackStart - event.startBeats) < 1e-6 && attack.midi === event.midi;
    });
    if (!inNotation) {
      throw new Error(`pass11_assert_timing_mismatch midi=${event.midi} start=${event.startBeats}`);
    }
  }
}

export function renderPlaybackPass11(
  events: MelodyEvent[],
  playbackCtx: { beatsPerMeasure: number; tempoBpm?: number }
): PlaybackEvent[] {
  const beatsPerMeasure = Math.max(1, playbackCtx.beatsPerMeasure);
  const playback = mergeTiedPlaybackEvents(events, beatsPerMeasure);
  assertPlaybackMatchesNotation(playback, events, beatsPerMeasure);
  return playback;
}

export function buildPlaybackArrayPass5(events: MelodyEvent[], beatsPerMeasure: number): MelodyEvent[] {
  const attacks = filterRenderableAttackEvents(events);
  const byMeasure = new Map<number, MelodyEvent[]>();
  for (const event of attacks) {
    if (!byMeasure.has(event.measure)) {
      byMeasure.set(event.measure, []);
    }
    byMeasure.get(event.measure)!.push({ ...event });
  }

  const result: MelodyEvent[] = [];
  const sortedMeasures = [...byMeasure.keys()].sort((a, b) => a - b);
  for (const measure of sortedMeasures) {
    const rawInMeasure = byMeasure
      .get(measure)!
      .sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
    const onsetSet = new Set(rawInMeasure.map((event) => Number(((event.onsetBeat ?? event.beat)).toFixed(3))));
    let inMeasure = rawInMeasure.filter((event) => {
      const onset = Number(((event.onsetBeat ?? event.beat)).toFixed(3));
      const frac = Number((onset % 1).toFixed(3));
      if (Math.abs(frac - 0.5) < 0.001) {
        // Hard final guard: any half-beat attack must have the paired on-beat attack.
        return onsetSet.has(Number((onset - 0.5).toFixed(3)));
      }
      return true;
    });

    const isAllowedDuration = (dur: number): boolean =>
      Math.abs(dur - 0.5) < 1e-6 || Math.abs(dur - 1) < 1e-6 || Math.abs(dur - 2) < 1e-6 || Math.abs(dur - 4) < 1e-6;

    // Final Pass5 safety: eliminate attacks that create unsupported durations (e.g., 1.5 in 3/4).
    for (let guard = 0; guard < 16; guard += 1) {
      let badIndex = -1;
      for (let i = 0; i < inMeasure.length; i += 1) {
        const onset = inMeasure[i].onsetBeat ?? inMeasure[i].beat;
        const nextOnset = i + 1 < inMeasure.length ? (inMeasure[i + 1].onsetBeat ?? inMeasure[i + 1].beat) : beatsPerMeasure + 1;
        const durationBeats = Number((nextOnset - onset).toFixed(3));
        if (!isAllowedDuration(durationBeats)) {
          badIndex = i;
          break;
        }
      }
      if (badIndex === -1 || inMeasure.length <= 1) {
        break;
      }
      const removeIndex = badIndex + 1 < inMeasure.length ? badIndex + 1 : badIndex;
      inMeasure.splice(removeIndex, 1);
    }

    for (let i = 0; i < inMeasure.length; i += 1) {
      const current = inMeasure[i];
      const next = inMeasure[i + 1];
      const onset = current.onsetBeat ?? current.beat;
      const nextOnset = next ? (next.onsetBeat ?? next.beat) : beatsPerMeasure + 1;
      const durationBeats = Number((nextOnset - onset).toFixed(3));
      result.push({
        ...current,
        beat: onset,
        onsetBeat: onset,
        durationBeats,
        duration: beatsToDuration(durationBeats),
        isAttack: true
      });
    }
  }

  return result.sort((a, b) => a.measure - b.measure || (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
}

function removeStrayPhraseStartTrailingEighths(
  events: MelodyEvent[],
  phraseLengthMeasures: number,
  beatsPerMeasure: number
): MelodyEvent[] {
  if (Math.abs(beatsPerMeasure - 3) > 0.001) {
    return events;
  }
  const phraseStartMeasures = new Set<number>();
  const maxMeasure = events.reduce((max, event) => Math.max(max, event.measure), 0);
  for (let measure = 1; measure <= maxMeasure; measure += phraseLengthMeasures) {
    phraseStartMeasures.add(measure);
  }

  const next = [...events].map((event) => ({ ...event }));
  const byMeasure = new Map<number, MelodyEvent[]>();
  for (const event of next) {
    if (!byMeasure.has(event.measure)) {
      byMeasure.set(event.measure, []);
    }
    byMeasure.get(event.measure)!.push(event);
  }

  for (const measure of phraseStartMeasures) {
    const inMeasure = (byMeasure.get(measure) ?? [])
      .filter((event) => event.isAttack === true)
      .sort((a, b) => (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));
    if (inMeasure.length === 0) {
      continue;
    }
    const at3 = inMeasure.find((event) => Math.abs((event.onsetBeat ?? event.beat) - 3) < 0.001) ?? null;
    const at35 = inMeasure.find((event) => Math.abs((event.onsetBeat ?? event.beat) - 3.5) < 0.001) ?? null;
    if (!at35) {
      continue;
    }
    const hasTruePair = Boolean(at3 && Math.abs((at3.durationBeats ?? 0) - 0.5) < 0.001 && Math.abs((at35.durationBeats ?? 0) - 0.5) < 0.001);
    if (hasTruePair) {
      continue;
    }
    at35.isAttack = false;
    at35.tieStop = true;
    at35.durationBeats = 0;
  }

  return buildPlaybackArrayPass5(filterRenderableAttackEvents(next), beatsPerMeasure);
}

function isLockedAttack(event: MelodyEvent): boolean {
  const tags = event.functionTags ?? [];
  return tags.includes('anchor') || tags.includes('structural') || tags.includes('climax') || tags.includes('cadence');
}

function eePairOnsetWindow(onset: number): 2 | 3 | null {
  if (Math.abs(onset - 2) < 0.001 || Math.abs(onset - 2.5) < 0.001) {
    return 2;
  }
  if (Math.abs(onset - 3) < 0.001 || Math.abs(onset - 3.5) < 0.001) {
    return 3;
  }
  return null;
}

function chooseHarmonyAwareStepTowardTarget(
  fromMidi: number,
  targetMidi: number,
  reference: MelodyEvent,
  spec: ExerciseSpec,
  tonicPc: number,
  keyScale: number[],
  rangeMin: number,
  rangeMax: number
): number {
  const direction: 1 | -1 = targetMidi >= fromMidi ? 1 : -1;
  const direct = nextScaleStepMidi(fromMidi, direction, keyScale, rangeMin, rangeMax);
  const reverse = nextScaleStepMidi(fromMidi, direction === 1 ? -1 : 1, keyScale, rangeMin, rangeMax);
  const base = direct ?? reverse ?? fromMidi;

  const degree = chordDegreeFromChordId(reference.chordId);
  const chordPcs = degree ? chordForDegree(tonicPc, spec.mode, degree) : [];
  if (chordPcs.length === 0) {
    return base;
  }

  const harmonyCandidates = chordToneCandidatesInRange(chordPcs, rangeMin, rangeMax)
    .filter((midi) => Math.abs(midi - fromMidi) <= 4)
    .sort((a, b) => Math.abs(a - targetMidi) - Math.abs(b - targetMidi));
  return harmonyCandidates[0] ?? base;
}

function enforceEePairMelodicRules(
  events: MelodyEvent[],
  spec: ExerciseSpec,
  tonicPc: number,
  keyScale: number[],
  rangeMin: number,
  rangeMax: number
): MelodyEvent[] {
  const repaired = [...events]
    .map((event) => ({ ...event }))
    .sort((a, b) => a.measure - b.measure || (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat));

  const logRepair = (message: string): void => {
    console.debug(`[rhythm-ee-repair] ${message}`);
  };

  const validatePair = (e1: MelodyEvent, e2: MelodyEvent, nextAttack: MelodyEvent | undefined): void => {
    const pairDelta = Math.abs(e2.midi - e1.midi);
    if (pairDelta > 4) {
      const dir: 1 | -1 = e2.midi >= e1.midi ? 1 : -1;
      const step = nextScaleStepMidi(e1.midi, dir, keyScale, rangeMin, rangeMax);
      if (step !== null) {
        e2.midi = step;
        e2.pitch = toPitchString(step);
        e2.octave = toOctave(step);
        e2.reason = `${e2.reason}|eePairHardClamp`;
      } else {
        e2.midi = e1.midi;
        e2.pitch = toPitchString(e1.midi);
        e2.octave = toOctave(e1.midi);
        e2.reason = `${e2.reason}|eePairHardClamp`;
      }
      console.debug(
        `[rhythm-ee-repair] hardClamp m${e1.measure} onsets=${String(e1.onsetBeat ?? e1.beat)},${String(e2.onsetBeat ?? e2.beat)}`
      );
    }
    if ((pairDelta === 3 || pairDelta === 4) && nextAttack) {
      const resolution = Math.abs(nextAttack.midi - e2.midi);
      if (resolution > 2) {
        console.debug(
          `[rhythm-ee-repair] unresolvedThird m${e1.measure} pairInterval=${pairDelta} resolution=${resolution}`
        );
      }
    }
  };

  for (let i = 0; i < repaired.length - 1; i += 1) {
    const e1 = repaired[i];
    const e2 = repaired[i + 1];
    if (e1.measure !== e2.measure) {
      continue;
    }
    const start = e1.onsetBeat ?? e1.beat;
    const half = e2.onsetBeat ?? e2.beat;
    const window = eePairOnsetWindow(start);
    if (!window || Math.abs(half - (window + 0.5)) > 0.001) {
      continue;
    }

    const nextAttack = repaired[i + 2];
    const pairDelta = Math.abs(e2.midi - e1.midi);

    if (pairDelta > 4) {
      const target = nextAttack?.midi ?? e2.midi;
      const rewritten = chooseHarmonyAwareStepTowardTarget(e1.midi, target, e2, spec, tonicPc, keyScale, rangeMin, rangeMax);
      if (rewritten !== e2.midi) {
        logRepair(
          `pairIntervalClamp m${e1.measure} window=${window} from=${e2.midi} to=${rewritten} delta=${pairDelta} target=${target}`
        );
        e2.midi = rewritten;
        e2.pitch = toPitchString(rewritten);
        e2.octave = toOctave(rewritten);
        e2.reason = `${e2.reason}|eePairIntervalRepair`;
      }
    }

    const repairedDelta = Math.abs(e2.midi - e1.midi);
    if ((repairedDelta === 3 || repairedDelta === 4) && nextAttack) {
      const resolution = Math.abs(nextAttack.midi - e2.midi);
      if (resolution > 2) {
        if (!isLockedAttack(nextAttack)) {
          const stepDir: 1 | -1 = nextAttack.midi >= e2.midi ? 1 : -1;
          const resolvedNext = nextScaleStepMidi(e2.midi, stepDir, keyScale, rangeMin, rangeMax);
          if (resolvedNext !== null) {
            logRepair(
              `thirdResolutionNext m${e1.measure} window=${window} nextFrom=${nextAttack.midi} nextTo=${resolvedNext} resolution=${resolution}`
            );
            nextAttack.midi = resolvedNext;
            nextAttack.pitch = toPitchString(resolvedNext);
            nextAttack.octave = toOctave(resolvedNext);
            nextAttack.reason = `${nextAttack.reason}|eeThirdResolutionRepair`;
          }
        } else {
          const target = nextAttack.midi;
          const stepwise = chooseHarmonyAwareStepTowardTarget(e1.midi, target, e2, spec, tonicPc, keyScale, rangeMin, rangeMax);
          const stepDelta = Math.abs(stepwise - e1.midi);
          if (stepDelta <= 2 && stepwise !== e2.midi) {
            logRepair(
              `thirdForbiddenLockedNext m${e1.measure} window=${window} from=${e2.midi} to=${stepwise} lockedNext=${nextAttack.midi}`
            );
            e2.midi = stepwise;
            e2.pitch = toPitchString(stepwise);
            e2.octave = toOctave(stepwise);
            e2.reason = `${e2.reason}|eeThirdToStepRepair`;
          }
        }
      }
    }

    validatePair(e1, e2, nextAttack);
  }

  return repaired;
}

export function rewriteAttacksAndQuantizeByMeasure(
  events: MelodyEvent[],
  phrasePlan: PhrasePlan,
  options: RewriteAttackOptions = {}
): MelodyEvent[] {
  const beatsPerMeasure = options.beatsPerMeasure ?? 4;
  const tagged = labelEventFunctions(events, phrasePlan);
  const byMeasure = new Map<number, MelodyEvent[]>();
  for (const event of tagged) {
    if (!byMeasure.has(event.measure)) {
      byMeasure.set(event.measure, []);
    }
    byMeasure.get(event.measure)!.push({ ...event });
  }

  const rewritten: MelodyEvent[] = [];

  for (const [measure, inMeasureUnsorted] of byMeasure.entries()) {
    const inMeasure = [...inMeasureUnsorted].sort((a, b) => a.beat - b.beat);
    const mode = classifyMeasureRhythmMode(inMeasure);
    const selectedTemplateId = options.templatesByMeasure?.get(measure);
    const template = selectedTemplateId ? templateById(selectedTemplateId) : null;
    let grid = template?.grid ?? chooseGrid(mode, inMeasure);
    const eeSlots = grid.filter((slot) => Math.abs((slot % 1) - 0.5) < 0.001);
    const usesEeGrid = eeSlots.length === 2;
    const hardKeepIndices = inMeasure.map((event, idx) => (isHardKeepEvent(event) ? idx : -1)).filter((idx) => idx >= 0);
    if (hardKeepIndices.length > grid.length) {
      grid = [1, 2, 3, 4];
    }
    if (hardKeepIndices.length > grid.length) {
      grid = [1, 2, 3, 4];
    }

    const selected = new Set<number>(hardKeepIndices);
    selected.add(0);
    const forcedEeIndices = new Set<number>();

    if (mode === 'smoothing') {
      const halfSlots = new Set(grid.filter((slot) => Math.abs(slot % 1 - 0.5) < 0.001));
      const smoothingIdx = inMeasure
        .map((event, idx) => ({ event, idx }))
        .filter(({ event }) => event.functionTags?.includes('smoothing_run'))
        .filter(({ event }) => halfSlots.size === 0 || [...halfSlots].some((slot) => Math.abs(event.beat - slot) <= 0.6))
        .sort((a, b) => b.event.beat - a.event.beat)
        .slice(0, 2)
        .map(({ idx }) => idx)
        .sort((a, b) => a - b);
      for (const idx of smoothingIdx) {
        selected.add(idx);
      }
    }

    if (usesEeGrid) {
      const pool = inMeasure
        .map((event, idx) => ({ event, idx }))
        .filter(({ event }) => event.functionTags?.includes('smoothing_run'))
        .concat(inMeasure.map((event, idx) => ({ event, idx })))
        .filter((item, index, arr) => arr.findIndex((other) => other.idx === item.idx) === index);
      const slotTargets = [...eeSlots].sort((a, b) => a - b);
      for (const slot of slotTargets) {
        const candidate = pool
          .filter(({ idx }) => !forcedEeIndices.has(idx))
          .sort((a, b) => Math.abs(a.event.beat - slot) - Math.abs(b.event.beat - slot))[0];
        if (candidate) {
          forcedEeIndices.add(candidate.idx);
          selected.add(candidate.idx);
        }
      }
    }

    if (selected.size < grid.length) {
      const connective = inMeasure
        .map((event, idx) => ({ event, idx }))
        .filter(({ idx, event }) => !selected.has(idx) && event.functionTags?.includes('connective_nht'))
        .sort((a, b) => a.event.beat - b.event.beat);
      for (const item of connective) {
        if (selected.size >= grid.length) {
          break;
        }
        selected.add(item.idx);
      }
    }

    let selectedIndices = [...selected].sort((a, b) => inMeasure[a].beat - inMeasure[b].beat);
    if (selectedIndices.length > grid.length) {
      const removable = selectedIndices
        .filter((idx) => !isHardKeepEvent(inMeasure[idx]) && !forcedEeIndices.has(idx))
        .sort((a, b) => eventPriority(inMeasure[a]) - eventPriority(inMeasure[b]));
      for (const idx of removable) {
        if (selectedIndices.length <= grid.length) {
          break;
        }
        selected.delete(idx);
        selectedIndices = [...selected].sort((a, b) => inMeasure[a].beat - inMeasure[b].beat);
      }
    }

    const attackMap = new Map<number, number>();
    let gridCursor = 0;
    for (let i = 0; i < selectedIndices.length; i += 1) {
      const idx = selectedIndices[i];
      const beat = inMeasure[idx].beat;
      const remainingCandidates = selectedIndices.length - i;
      const maxSlot = grid.length - remainingCandidates;
      let bestSlot = gridCursor;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let slotIndex = gridCursor; slotIndex <= maxSlot; slotIndex += 1) {
        const distance = Math.abs(grid[slotIndex] - beat);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestSlot = slotIndex;
        }
      }
      attackMap.set(idx, grid[bestSlot]);
      gridCursor = bestSlot + 1;
    }

    if (usesEeGrid && forcedEeIndices.size > 0) {
      const forced = [...forcedEeIndices].sort((a, b) => inMeasure[a].beat - inMeasure[b].beat);
      const slots = [...eeSlots].sort((a, b) => a - b);
      for (let i = 0; i < Math.min(forced.length, slots.length); i += 1) {
        attackMap.set(forced[i], slots[i]);
      }
    }

    const attackEvents = [...attackMap.entries()]
      .map(([idx, onset]) => ({
        idx,
        onset,
        event: { ...inMeasure[idx] }
      }))
      .sort((a, b) => a.onset - b.onset);

    const mergedAttacks: Array<{ idx: number; onset: number; event: MelodyEvent }> = [];
    for (const item of attackEvents) {
      const prev = mergedAttacks[mergedAttacks.length - 1];
      const preserveEeAttack =
        usesEeGrid &&
        eeSlots.some((slot) => Math.abs(slot - prev?.onset!) < 0.001) &&
        eeSlots.some((slot) => Math.abs(slot - item.onset) < 0.001);
      if (prev && prev.event.midi === item.event.midi && !preserveEeAttack) {
        prev.event.tieStart = true;
        prev.event.reason = `${prev.event.reason}|tieMerge`;
        continue;
      }
      mergedAttacks.push(item);
    }

    for (let i = 0; i < mergedAttacks.length; i += 1) {
      const current = mergedAttacks[i];
      const next = mergedAttacks[i + 1];
      const durationBeats = (next?.onset ?? 5) - current.onset;
      rewritten.push({
        ...current.event,
        beat: current.onset,
        onsetBeat: current.onset,
        durationBeats,
        duration: beatsToDuration(durationBeats),
        isAttack: true,
        tieStop: undefined,
        reason: `${current.event.reason}${usesEeGrid ? '|rhythm:smoothing_window' : ''}`
      });
    }

    const selectedSet = new Set(mergedAttacks.map((item) => item.idx));
    for (let i = 0; i < inMeasure.length; i += 1) {
      if (selectedSet.has(i)) {
        continue;
      }
      rewritten.push({
        ...inMeasure[i],
        isAttack: false,
        onsetBeat: inMeasure[i].beat,
        durationBeats: 0,
        tieStop: true
      });
    }
  }

  const attacksOnly = filterRenderableAttackEvents(rewritten);

  const grouped = new Map<number, MelodyEvent[]>();
  for (const event of attacksOnly) {
    if (!grouped.has(event.measure)) {
      grouped.set(event.measure, []);
    }
    grouped.get(event.measure)!.push(event);
  }

  for (const [measure, inMeasure] of grouped.entries()) {
    const sum = inMeasure.reduce((acc, event) => acc + (event.durationBeats ?? 0), 0);
    if (Math.abs(sum - beatsPerMeasure) > 0.001) {
      throw new Error(`rhythm_assert_measure_sum_failed m${measure} sum=${sum.toFixed(3)} expected=${beatsPerMeasure}`);
    }
    for (const event of inMeasure) {
      const onset = event.onsetBeat ?? event.beat;
      if (onset < 1 || onset >= beatsPerMeasure + 1) {
        throw new Error(`rhythm_assert_onset_bounds_failed m${measure} onset=${onset.toFixed(3)}`);
      }
    }
  }

  return attacksOnly;
}

export function insertSmoothingEighthFill(
  events: MelodyEvent[],
  keyScale: number[],
  smoothingMeasures: Set<number>
): { events: MelodyEvent[]; smoothingCount: number } {
  const sorted = [...events].sort((a, b) => a.measure - b.measure || a.beat - b.beat);
  const output: MelodyEvent[] = [];
  let smoothingCount = 0;

  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    output.push(current);
    if (!next) {
      continue;
    }
    if (current.measure !== next.measure || !smoothingMeasures.has(current.measure)) {
      continue;
    }

    const interval = next.midi - current.midi;
    const abs = Math.abs(interval);
    if (abs < 5) {
      continue;
    }
    if (next.beat - current.beat !== 1) {
      continue;
    }

    const direction: 1 | -1 = interval > 0 ? 1 : -1;
    const stepMidi = nextScaleStepMidi(current.midi, direction, keyScale, Math.min(current.midi, next.midi), Math.max(current.midi, next.midi));
    if (stepMidi === null) {
      continue;
    }

    const stepPc = ((stepMidi % 12) + 12) % 12;
    const octave = toOctave(stepMidi);
    output.push({
      ...current,
      pitch: `${toPitchName(stepPc)}${octave}`,
      octave,
      midi: stepMidi,
      beat: current.beat + 0.5,
      duration: 'eighth',
      role: 'NonHarmonicTone',
      reason: 'smoothing_fill_eighth',
      nonHarmonicTone: true
    });
    smoothingCount += 1;
  }

  return { events: output.sort((a, b) => a.measure - b.measure || a.beat - b.beat), smoothingCount };
}

export function tieMergeRepeatedPitchesInMeasure(events: MelodyEvent[]): { events: MelodyEvent[]; mergedCount: number } {
  const sorted = [...events].sort((a, b) => a.measure - b.measure || a.beat - b.beat);
  const merged: MelodyEvent[] = [];
  let mergedCount = 0;

  for (const event of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev || prev.measure !== event.measure || prev.midi !== event.midi) {
      merged.push({ ...event });
      continue;
    }

    const totalDivs = durationToDivisions(prev.duration) + durationToDivisions(event.duration);
    if (totalDivs === 2 || totalDivs === 4 || totalDivs === 8) {
      prev.duration = divisionsToDuration(totalDivs);
      prev.reason = `${prev.reason}+tieMerge`;
      mergedCount += 1;
      continue;
    }

    merged.push({ ...event });
  }

  return { events: merged, mergedCount };
}

function templatePattern(template: MeasureTemplateId, eventCount: number): number[] {
  const clampCount = Math.max(1, eventCount);
  if (template === 'CADENCE_W') {
    return clampCount === 1 ? [8] : [4, 4];
  }
  if (template === 'CADENCE_HH' || template === 'CLIMAX_SIMPLE') {
    return clampCount === 1 ? [8] : [4, 4];
  }
  if (template === 'SMOOTH_BEAT2') {
    return clampCount >= 4 ? [2, 1, 1, 4] : [2, 2, 4];
  }
  if (template === 'SMOOTH_BEAT3') {
    return clampCount >= 4 ? [2, 2, 1, 1, 2] : [2, 2, 2, 2];
  }
  if (template === 'RUN_HEEEE') {
    return clampCount >= 5 ? [4, 1, 1, 1, 1] : [4, 2, 2];
  }
  return [2, 2, 2, 2];
}

export function applyRhythmTemplates(
  events: MelodyEvent[],
  templates: Map<number, MeasureTemplateId>
): { events: MelodyEvent[]; templatesApplied: number } {
  const grouped = new Map<number, MelodyEvent[]>();
  for (const event of events) {
    if (!grouped.has(event.measure)) {
      grouped.set(event.measure, []);
    }
    grouped.get(event.measure)!.push({ ...event });
  }

  const result: MelodyEvent[] = [];
  for (const [measure, inMeasureUnsorted] of grouped.entries()) {
    const inMeasure = [...inMeasureUnsorted].sort((a, b) => a.beat - b.beat);
    const template = templates.get(measure) ?? 'STABLE';
    const pattern = templatePattern(template, inMeasure.length);

    for (let i = 0; i < inMeasure.length; i += 1) {
      const divs = pattern[Math.min(i, pattern.length - 1)] ?? 2;
      inMeasure[i].duration = divisionsToDuration(divs);
      inMeasure[i].reason = `${inMeasure[i].reason}|rhythm:${template}`;
    }

    result.push(...inMeasure);
  }

  return {
    events: result.sort((a, b) => a.measure - b.measure || a.beat - b.beat),
    templatesApplied: templates.size
  };
}

type LabelKey = PhraseSpec['label'];

interface CachedLabelPhrase {
  eventsRelative: MelodyEvent[];
}

function toRelativePhraseEvents(events: MelodyEvent[], phraseStartMeasure: number): MelodyEvent[] {
  return events.map((event) => ({
    ...event,
    measure: event.measure - phraseStartMeasure + 1
  }));
}

function toAbsolutePhraseEvents(
  eventsRelative: MelodyEvent[],
  phraseStartMeasure: number,
  phraseIndexOneBased: number
): MelodyEvent[] {
  return eventsRelative.map((event) => ({
    ...event,
    measure: event.measure + phraseStartMeasure - 1,
    phraseIndex: phraseIndexOneBased
  }));
}

function localBeatPosition(event: MelodyEvent, beatsPerMeasure: number): number {
  const onset = event.onsetBeat ?? event.beat;
  return (event.measure - 1) * beatsPerMeasure + (onset - 1);
}

function mergePrimeWithBaseFirstHalf(
  generatedRelative: MelodyEvent[],
  baseRelative: MelodyEvent[],
  phraseLengthMeasures: number,
  beatsPerMeasure: number
): MelodyEvent[] {
  const halfBoundary = (phraseLengthMeasures * beatsPerMeasure) / 2;
  const baseFirstHalf = baseRelative.filter((event) => localBeatPosition(event, beatsPerMeasure) < halfBoundary);
  const generatedSecondHalf = generatedRelative.filter((event) => localBeatPosition(event, beatsPerMeasure) >= halfBoundary);
  return [...baseFirstHalf, ...generatedSecondHalf].sort(
    (a, b) => a.measure - b.measure || (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat)
  );
}

export function createMelodyCandidates(
  spec: ExerciseSpec,
  harmony: HarmonyEvent[],
  _tonnetz: TonnetzGraph,
  seed: number
): MelodyGenerationOutput {
  const normalizedSpec = normalizeAndValidatePass0(spec);
  const [rangeMin, rangeMax] = parseRangeByScaleDegree(normalizedSpec);
  const beatsPerMeasure = Math.max(1, Number(normalizedSpec.timeSig.split('/')[0]) || 4);
  const phraseLengthMeasures = normalizedSpec.phraseLengthMeasures;
  const phrases: PhraseSpec[] =
    normalizedSpec.phrases.length > 0 ? normalizedSpec.phrases : [{ label: 'A', prime: false, cadence: 'authentic' }];

  const tonicPc = KEY_TO_PC[normalizedSpec.key] ?? 0;
  const scale = modeScale(normalizedSpec.mode);
  const keyScale = scale.map((step) => (tonicPc + step) % 12);
  const keyId = `${normalizedSpec.key}-${normalizedSpec.mode}`;

  const variants = 3;
  const results: MelodyCandidateResult[] = [];
  const startDegreeUserSpecified = normalizedSpec.userConstraints?.startDegreeLocked === true;
  const rhythmWeights: RhythmWeights = {
    ...defaultRhythmWeights,
    ...(normalizedSpec.rhythmWeights ?? {})
  };
  const configuredMaxLeapSemitones = Math.max(1, normalizedSpec.userConstraints?.maxLeapSemitones ?? MAX_MELODIC_LEAP_SEMIS);
  const configuredMaxLargeLeapsPerPhrase = Math.max(0, normalizedSpec.userConstraints?.maxLargeLeapsPerPhrase ?? 1);
  const rhythmWeightTotal = rhythmWeights.whole + rhythmWeights.half + rhythmWeights.quarter + rhythmWeights.eighth;
  const normalizedEeShare = rhythmWeightTotal > 0 ? rhythmWeights.eighth / rhythmWeightTotal : 0;
  const eePairsFromWeight = Math.max(0, Math.round(normalizedEeShare * Math.max(0, phraseLengthMeasures - 1)));
  const effectiveMinEePairsPerPhrase = Math.max(rhythmWeights.minEighthPairsPerPhrase ?? 0, eePairsFromWeight);

  for (let variant = 0; variant < variants; variant += 1) {
    const melody: MelodyEvent[] = [];
    const trace: MelodySelectionTrace[] = [];
    const labelPhraseCache = new Map<LabelKey, CachedLabelPhrase>();
    let prevMidi = Math.max(rangeMin, Math.min(rangeMax, 60 + variant));

    for (let phraseIndex = 0; phraseIndex < phrases.length; phraseIndex += 1) {
      const phraseSpec = phrases[phraseIndex];
      const phraseStartMeasure = phraseIndex * phraseLengthMeasures + 1;
      const cachedLabelPhrase = labelPhraseCache.get(phraseSpec.label);

      if (!phraseSpec.prime && cachedLabelPhrase) {
        const copied = toAbsolutePhraseEvents(cachedLabelPhrase.eventsRelative, phraseStartMeasure, phraseIndex + 1);
        melody.push(...copied);
        prevMidi = copied[copied.length - 1]?.midi ?? prevMidi;
        trace.push({
          measure: phraseStartMeasure,
          beat: 1,
          steps: [
            {
              step: 'phraseReuse',
              remainingCandidateCount: copied.length,
              reason: `reused_label=${phraseSpec.label}`
            }
          ]
        });
        continue;
      }

      const phrasePlan = generatePhrasePlan({
        measures: phraseLengthMeasures,
        timeSignature: normalizedSpec.timeSig,
        key: normalizedSpec.key,
        mode: normalizedSpec.mode,
        range: normalizedSpec.range,
        difficulty: 2,
        cadence: phraseSpec.cadence,
        startDegree: normalizedSpec.startingDegree,
        startDegreeLocked: startDegreeUserSpecified,
        seed: seed + variant * 131 + phraseIndex * 977
      });
      console.debug(
        `[pass2] phrase=${phraseIndex + 1} direction=${phrasePlan.direction} start=${phrasePlan.startDegree} peakM=${phrasePlan.peakMeasure} peakDeg=${phrasePlan.peakDegree} cadence=[${phrasePlan.cadenceDegrees.join(
          ','
        )}] targets=${phrasePlan.targets
          .map((target) => `${target.measure}.${target.beat}:${target.targetDegree}:${target.priority}`)
          .join('|')}`
      );
      const rhythmWeightsForPhrase: RhythmWeights = {
        ...rhythmWeights,
        minEighthPairsPerPhrase: effectiveMinEePairsPerPhrase
      };
      const phraseGrid = generatePhraseGrid({
        phrasePlan,
        phraseSpec,
        phraseStartMeasure,
        phraseLengthMeasures,
        beatsPerMeasure,
        seed: seed + variant * 577 + phraseIndex * 43,
        rhythmWeights: rhythmWeightsForPhrase,
        rhythmDist: normalizedSpec.userConstraints?.rhythmDist,
        minEighthPairsPerPhrase: normalizedSpec.userConstraints?.minEighthPairsPerPhrase ?? effectiveMinEePairsPerPhrase,
        lockRhythmConstraints: true,
        allowedNoteValues: normalizedSpec.userConstraints?.allowedNoteValues
      });
      const pass2Target = normalizedSpec.userConstraints?.rhythmDist ?? {
        W: rhythmWeights.whole,
        H: rhythmWeights.half,
        Q: rhythmWeights.quarter,
        EE: rhythmWeights.eighth
      };
      console.debug(
        `[pass2-grid] phrase=${phraseIndex + 1} plan=${phraseGrid.measures
          .map((m) => `m${m.measure}:${m.templateId}[${m.onsets.join(',')}]`)
          .join(' ')}`
      );
      console.debug(
        `[pass2-grid] phrase=${phraseIndex + 1} lock=true countsTarget(W/H/Q/EE)=${pass2Target.W}/${pass2Target.H}/${pass2Target.Q}/${pass2Target.EE} countsGrid(W/H/Q/EE)=${phraseGrid.noteValueCounts.W}/${phraseGrid.noteValueCounts.H}/${phraseGrid.noteValueCounts.Q}/${phraseGrid.noteValueCounts.EE}`
      );

      const skeleton = generateStructuralSkeleton({
        spec: normalizedSpec,
        phraseSpec,
        phrasePlan,
        phraseIndex,
        phraseLengthMeasures,
        beatsPerMeasure,
        harmony,
        keyId,
        keyScale,
        rangeMin,
        rangeMax,
        maxLeapSemitones: configuredMaxLeapSemitones,
        tonicPc,
        seed: seed + variant * 193 + phraseIndex * 17,
        startPrevMidi: prevMidi,
        startDegreePreference: normalizedSpec.startingDegree,
        startDegreeUserSpecified,
        phraseGrid
      });

      const realized = realizePhraseGridPitches({
        spec: normalizedSpec,
        phraseSpec,
        phraseIndex,
        phraseLengthMeasures,
        beatsPerMeasure,
        phraseGrid,
        harmony,
        skeleton,
        keyId,
        keyScale,
        rangeMin,
        rangeMax,
        maxLeapSemitones: configuredMaxLeapSemitones,
        seed: seed + variant * 811 + phraseIndex * 31
      });
      let phraseEventsForOutput = realized.melody;
      if (phraseSpec.prime && cachedLabelPhrase) {
        const generatedRelative = toRelativePhraseEvents(phraseEventsForOutput, phraseStartMeasure);
        const mergedRelative = mergePrimeWithBaseFirstHalf(
          generatedRelative,
          cachedLabelPhrase.eventsRelative,
          phraseLengthMeasures,
          beatsPerMeasure
        );
        phraseEventsForOutput = toAbsolutePhraseEvents(mergedRelative, phraseStartMeasure, phraseIndex + 1);
      }
      const phrasePasses = runPhraseConstraintPasses({
        events: phraseEventsForOutput,
        applyIllegalRulesAdjacencyPass,
        applyDominantTendencyVoiceLeadingPass,
        enforceLeapBudgetPerPhrasePass,
        enforceEePairMelodicRules,
        passContext: {
          spec: normalizedSpec,
          keyScale,
          rangeMin,
          rangeMax,
          maxLeapSemitones: configuredMaxLeapSemitones,
          maxLargeLeapsPerPhrase: configuredMaxLargeLeapsPerPhrase,
          beatsPerMeasure,
          keyId,
          tonicPc
        }
      });
      phraseEventsForOutput = phrasePasses.events;
      if (phrasePasses.leapBudgetRepairs > 0) {
        console.debug(`[pass5-leapBudget] phrase=${phraseIndex + 1} repairs=${phrasePasses.leapBudgetRepairs}`);
      }
      const eighthEvents = phraseEventsForOutput.filter((event) => (event.durationBeats ?? 0) === 0.5).length;
      console.debug(
        `[rhythm] phrase=${phraseIndex + 1} eighthEvents=${eighthEvents} eeMeasures=[${phraseGrid.eeMeasures.join(',')}]`
      );

      melody.push(...phraseEventsForOutput);
      trace.push(...realized.trace);
      prevMidi = phraseEventsForOutput[phraseEventsForOutput.length - 1]?.midi ?? prevMidi;
      if (!labelPhraseCache.has(phraseSpec.label)) {
        labelPhraseCache.set(phraseSpec.label, {
          eventsRelative: toRelativePhraseEvents(phraseEventsForOutput, phraseStartMeasure)
        });
      }
    }

    const computedCadenceType = phrases[phrases.length - 1]?.cadence === 'half' ? 'half' : 'authentic';
    const userCadenceType = normalizedSpec.userConstraints?.cadenceType ?? computedCadenceType;
    const userMinEePairs = normalizedSpec.userConstraints?.minEighthPairsPerPhrase ?? effectiveMinEePairsPerPhrase;

    const { pass5ConstraintSweep, pass5FinalMelody: initialPass5FinalMelody } = runFinalizationPipeline({
      melody,
      beatsPerMeasure,
      buildPlaybackArrayPass5,
      filterRenderableAttackEvents,
      applyUserConstraintsPass10,
      pass10Ctx: {
        keyId,
        mode: normalizedSpec.mode,
        tessitura: { minMidi: rangeMin, maxMidi: rangeMax },
        illegalDegrees: normalizedSpec.illegalDegrees,
        illegalIntervalsSemis: normalizedSpec.illegalIntervalsSemis,
        illegalTransitions: normalizedSpec.illegalTransitions,
        allowedNoteValues: normalizedSpec.userConstraints?.allowedNoteValues,
        lockFinalRhythmFromPass2: true,
        user: {
          hardStartDo: normalizedSpec.userConstraints?.hardStartDo === true,
          cadenceType: userCadenceType,
          endOnDoHard: normalizedSpec.userConstraints?.endOnDoHard ?? (userCadenceType !== 'half'),
          rhythmDist: undefined,
          minEighthPairsPerPhrase: userMinEePairs,
          maxLeapSemitones: configuredMaxLeapSemitones
        },
        beatsPerMeasure
      }
    });
    let pass5FinalMelody = initialPass5FinalMelody;
    pass5FinalMelody = removeStrayPhraseStartTrailingEighths(pass5FinalMelody, phraseLengthMeasures, beatsPerMeasure);
    const pass6Playback = renderPlaybackPass11(pass5FinalMelody, {
      beatsPerMeasure
    });
    const finalCounts = noteValueCounts(pass5FinalMelody);
    const finalAttacks = filterRenderableAttackEvents(pass5FinalMelody);
    const firstDegree = finalAttacks[0] ? midiToDegree(finalAttacks[0].midi, keyScale) : null;
    const lastDegree = finalAttacks.length > 0 ? midiToDegree(finalAttacks[finalAttacks.length - 1].midi, keyScale) : null;
    const pass5Validation = validateAllMustPass10(pass5FinalMelody, {
      keyId,
      mode: normalizedSpec.mode,
      tessitura: { minMidi: rangeMin, maxMidi: rangeMax },
      illegalDegrees: normalizedSpec.illegalDegrees,
      illegalIntervalsSemis: normalizedSpec.illegalIntervalsSemis,
      illegalTransitions: normalizedSpec.illegalTransitions,
      allowedNoteValues: normalizedSpec.userConstraints?.allowedNoteValues,
      user: {
        hardStartDo: normalizedSpec.userConstraints?.hardStartDo === true,
        cadenceType: userCadenceType,
        minEighthPairsPerPhrase: userMinEePairs,
        maxLeapSemitones: configuredMaxLeapSemitones
      },
      beatsPerMeasure
    });
    console.debug(
      `[pass5] startDeg=${String(firstDegree)} endDeg=${String(lastDegree)} eePairs=${countEePairs(pass5FinalMelody)} W=${finalCounts.W} H=${finalCounts.H} Q=${finalCounts.Q} EE=${finalCounts.EE} mustViolations=${pass5Validation.violations.length}`
    );
    console.debug(`[pass6-playback] events=${pass6Playback.length}`);
    if (pass5ConstraintSweep.constraintLog.length > 0) {
      console.debug(`[pass5] constraints=${pass5ConstraintSweep.constraintLog.length}`);
    }

    results.push({
      melody: pass5FinalMelody,
      trace,
      relaxationTier: 0,
      relaxedRules: []
    });
  }

  if (results.length === 0) {
    return {
      status: 'no_solution',
      reasonCode: 'constraints_too_strict',
      details: {
        illegalDegrees: [...spec.illegalDegrees],
        illegalIntervalsSemis: [...spec.illegalIntervalsSemis],
        illegalTransitions: [...spec.illegalTransitions]
      }
    };
  }

  return {
    status: 'ok',
    candidates: results
  };
}

import type { ExerciseSpec, HarmonyEvent, MelodyEvent } from '../../tat/models/schema';
import type { TonnetzGraph } from '../tonnetz/buildTonnetz';
import { selectNextPitch, type SelectionDebug } from './selectNextPitch';
import { generatePhrasePlan } from './phrasePlanner';

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

function modeScale(mode: ExerciseSpec['mode']): number[] {
  return mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
}

function cadenceTail(cadence: ExerciseSpec['cadence']): [number, number] {
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

function parseRangeByScaleDegree(spec: ExerciseSpec): [number, number] {
  const tonicPc = KEY_TO_PC[spec.key] ?? 0;
  const scale = modeScale(spec.mode);
  const lowPc = (tonicPc + scale[(spec.range.lowDegree - 1 + 700) % 7]) % 12;
  const highPc = (tonicPc + scale[(spec.range.highDegree - 1 + 700) % 7]) % 12;
  const lowMidi = (spec.range.lowOctave + 1) * 12 + lowPc;
  const highMidi = (spec.range.highOctave + 1) * 12 + highPc;
  return lowMidi <= highMidi ? [lowMidi, highMidi] : [highMidi, lowMidi];
}

export interface MelodySelectionTrace {
  measure: number;
  beat: number;
  steps: SelectionDebug[];
}

export interface MelodyCandidateResult {
  melody: MelodyEvent[];
  trace: MelodySelectionTrace[];
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

export function createMelodyCandidates(
  spec: ExerciseSpec,
  harmony: HarmonyEvent[],
  tonnetz: TonnetzGraph,
  seed: number
): MelodyCandidateResult[] {
  const [rangeMin, rangeMax] = parseRangeByScaleDegree(spec);
  const beatsPerMeasure = Math.max(1, Number(spec.timeSig.split('/')[0]) || 4);
  const totalNotes = spec.measures * beatsPerMeasure;

  const tonicPc = KEY_TO_PC[spec.key] ?? 0;
  const scale = modeScale(spec.mode);
  const keyScale = scale.map((step) => (tonicPc + step) % 12);
  const keyPitchSet = new Set<number>(keyScale);
  const keyId = `${spec.key}-${spec.mode}`;
  const [cadencePenultDegree, cadenceFinalDegree] = cadenceTail(spec.cadence);

  const variants = spec.difficulty === 'hard' ? 4 : spec.difficulty === 'medium' ? 3 : 2;
  const results: MelodyCandidateResult[] = [];

  for (let variant = 0; variant < variants; variant += 1) {
    const melody: MelodyEvent[] = [];
    const trace: MelodySelectionTrace[] = [];
    const phrasePlan = generatePhrasePlan({
      measures: spec.measures,
      timeSignature: spec.timeSig,
      key: spec.key,
      mode: spec.mode,
      range: spec.range,
      difficulty: spec.difficulty,
      cadence: spec.cadence,
      seed: seed + variant * 131
    });

    let prevPitch = {
      pc: tonicPc,
      midi: Math.max(rangeMin, Math.min(rangeMax, 60 + variant))
    };
    const recentHistory: number[] = [];

    for (let noteIndex = 0; noteIndex < totalNotes; noteIndex += 1) {
      const measure = Math.floor(noteIndex / beatsPerMeasure) + 1;
      const beat = (noteIndex % beatsPerMeasure) + 1;
      const isLastMeasure = measure === spec.measures;
      const isPenultimateCadenceBeat = isLastMeasure && beatsPerMeasure >= 2 && beat === beatsPerMeasure - 1;
      const isFinalCadenceBeat = isLastMeasure && beatsPerMeasure >= 2 && beat === beatsPerMeasure;
      const isCadenceBeat = isPenultimateCadenceBeat || isFinalCadenceBeat;

      const harmonyEvent = isCadenceBeat
        ? (() => {
          const degree = isFinalCadenceBeat ? cadenceFinalDegree : cadencePenultDegree;
          const chord = chordForDegree(tonicPc, spec.mode, degree);
          const qualityByDegree = (d: number): HarmonyEvent['quality'] => {
            if (spec.mode === 'major') {
              const map: HarmonyEvent['quality'][] = ['major', 'minor', 'minor', 'major', 'major', 'minor', 'diminished'];
              return map[(d - 1) % 7];
            }
            const map: HarmonyEvent['quality'][] = ['minor', 'diminished', 'major', 'minor', 'minor', 'major', 'major'];
            return map[(d - 1) % 7];
          };
          return {
            measure,
            beat,
            degree,
            rootPc: chord[0],
            chordPcs: chord,
            quality: qualityByDegree(degree)
          };
        })()
        : activeHarmonyForBeat(harmony, measure, beat);
      const currentPhraseTarget = phrasePlan.targets.find((target) => target.measure === measure && target.beat === beat);

      const chordId = `m${harmonyEvent.measure}-b${harmonyEvent.beat}-d${harmonyEvent.degree}`;
      const harmonyPitchSet = new Set<number>(harmonyEvent.chordPcs);

      const selection = selectNextPitch({
        tonnetz,
        key: {
          keyId,
          keyPitchSet,
          tonicPc,
          keyScale
        },
        harmony: {
          chordId,
          harmonyPitchSet
        },
        prevPitch,
        range: {
          minMidi: rangeMin,
          maxMidi: rangeMax
        },
        seed: seed + variant * 193 + noteIndex,
        forceNonHarmonic: !isCadenceBeat && (beat === 2 || beat === 4),
        forceChordTone: isCadenceBeat,
        cadenceApproach: isCadenceBeat,
        phrase: {
          currentPhraseTarget,
          direction: phrasePlan.direction,
          peakMeasure: phrasePlan.peakMeasure,
          currentMeasure: measure,
          recentHistory
        }
      });

      const note = selection.noteEvent;
      melody.push({
        pitch: `${note.pitch}${note.octave}`,
        octave: note.octave,
        midi: note.midi,
        duration: 'quarter',
        measure,
        beat,
        role: note.role,
        reason: note.reason,
        chordId: note.chordId,
        keyId: note.keyId,
        nonHarmonicTone: note.role === 'NonHarmonicTone'
      });

      trace.push({
        measure,
        beat,
        steps: selection.debug
      });

      prevPitch = {
        pc: ((note.midi % 12) + 12) % 12,
        midi: note.midi
      };
      recentHistory.push(prevPitch.midi);
      if (recentHistory.length > 4) {
        recentHistory.shift();
      }
    }

    results.push({ melody, trace });
  }

  return results;
}

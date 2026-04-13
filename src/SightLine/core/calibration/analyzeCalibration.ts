import { KEY_TO_PC, midiToPc, midiToPitch, pitchOctaveForMidi, prefersFlatsForKey } from '@/SightLine/core/midi';
import { detectPitchFrames } from '@/SightLine/core/audio/detectPitchFrames';
import { segmentPerformedMelody } from '@/SightLine/core/audio/segmentPerformedMelody';
import type { MelodyEvent } from '@/SightLine/domain/music';
import type { CalibrationProfile, CalibrationRunResult, CalibrationSignalQuality } from './types';

interface AnalyzeCalibrationInput {
  audioBlob: Blob;
  targetMelody: MelodyEvent[];
}

const CALIBRATION_LABELS = ['do', 're', 'mi', 'fa', 'sol'];

function weightedMedian(entries: Array<{ value: number; weight: number }>): number | null {
  if (entries.length === 0) {
    return null;
  }
  const sorted = [...entries].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  let running = 0;
  for (const entry of sorted) {
    running += entry.weight;
    if (running >= totalWeight / 2) {
      return entry.value;
    }
  }
  return sorted[sorted.length - 1].value;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildCalibrationTarget(targetMelody: MelodyEvent[]): MelodyEvent[] {
  const active = targetMelody.filter((event) => event.isAttack !== false);
  const anchor = active[0];
  if (!anchor) {
    throw new Error('Generate a melody before calibrating.');
  }

  const [keyRaw = 'C', modeRaw = 'major'] = String(anchor.keyId ?? 'C-major').split('-');
  const mode = modeRaw === 'minor' ? 'minor' : 'major';
  const tonicPc = KEY_TO_PC[keyRaw] ?? midiToPc(anchor.midi);
  const degreeOffsets = mode === 'minor' ? [0, 2, 3, 5, 7] : [0, 2, 4, 5, 7];
  const meanOffset = degreeOffsets.reduce((sum, value) => sum + value, 0) / degreeOffsets.length;
  const medianTargetMidi =
    [...active.map((event) => event.midi)].sort((a, b) => a - b)[Math.floor(active.length / 2)] ?? anchor.midi;
  const desiredTonicCenter = medianTargetMidi - meanOffset;

  let tonicMidi = 60;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let octave = 2; octave <= 6; octave += 1) {
    const candidate = (octave + 1) * 12 + tonicPc;
    const distance = Math.abs(candidate - desiredTonicCenter);
    if (distance < bestDistance) {
      bestDistance = distance;
      tonicMidi = candidate;
    }
  }

  const preferFlats = prefersFlatsForKey(keyRaw, mode);

  return degreeOffsets.map((offset, index) => {
    const midi = tonicMidi + offset;
    return {
      pitch: midiToPitch(midi, { preferFlats, key: keyRaw, mode }),
      octave: pitchOctaveForMidi(midi, { preferFlats, key: keyRaw, mode }),
      midi,
      duration: 'quarter',
      durationBeats: 1,
      measure: 1,
      beat: index + 1,
      onsetBeat: index + 1,
      phraseIndex: 0,
      role: 'ChordTone',
      reason: 'Calibration anchor',
      chordId: `calibration-${index + 1}`,
      keyId: `${keyRaw}-${mode}`,
      isAttack: true,
    };
  });
}

function classifySignalQuality(
  usableCount: number,
  avgConfidence: number | null,
  avgStability: number | null,
): CalibrationSignalQuality {
  const score =
    (avgConfidence ?? 0) * 0.5 +
    (avgStability ?? 0) * 0.35 +
    Math.min(1, usableCount / 5) * 0.15;
  if (score >= 0.75) {
    return 'good';
  }
  if (score >= 0.5) {
    return 'fair';
  }
  return 'poor';
}

function buildProfile(
  calibrationTarget: MelodyEvent[],
  segmentedNotes: CalibrationRunResult['segmentedNotes'],
): CalibrationProfile {
  const usableNotes = segmentedNotes.filter((note) => note.pitchCenter !== null && note.status !== 'missing');
  const offsetEntries = usableNotes
    .filter((note) => typeof note.expectedMidi === 'number' && typeof note.pitchCenter === 'number')
    .map((note) => ({
      value: (note.pitchCenter as number) - (note.expectedMidi as number),
      weight: Math.max(0.1, note.confidence),
    }));
  const phraseOffset = weightedMedian(offsetEntries);
  const averageConfidence = average(usableNotes.map((note) => note.confidence));
  const averagePitchStability = average(
    usableNotes.map((note) => {
      const spread = note.stablePitchSpread ?? note.pitchSpread ?? 2.5;
      return Math.max(0, Math.min(1, 1 - spread / 2.5));
    }),
  );
  const signalQuality = classifySignalQuality(
    usableNotes.length,
    averageConfidence,
    averagePitchStability,
  );
  const tonicMidi =
    phraseOffset !== null && typeof calibrationTarget[0]?.midi === 'number'
      ? calibrationTarget[0].midi + phraseOffset
      : null;
  const successful =
    usableNotes.length >= 4 &&
    (averageConfidence ?? 0) >= 0.5 &&
    signalQuality !== 'poor';

  return {
    successful,
    keyId: calibrationTarget[0]?.keyId ?? null,
    tonicMidi,
    tonicOffsetSemitones: phraseOffset,
    registerOffset:
      phraseOffset !== null ? Math.round(phraseOffset / 12) * 12 : null,
    averageConfidence,
    averagePitchStability,
    signalQuality,
    summary: successful
      ? 'Calibration complete.'
      : 'Calibration was only partly clear. Try again for a stronger listening guide.',
    expectedPatternLabels: CALIBRATION_LABELS,
    expectedMidis: calibrationTarget.map((note) => note.midi),
    detectedCenters: segmentedNotes.map((note) => note.pitchCenter),
  };
}

export async function analyzeCalibration(
  input: AnalyzeCalibrationInput,
): Promise<CalibrationRunResult> {
  if (input.targetMelody.length === 0) {
    throw new Error('Generate a melody before calibrating.');
  }

  const calibrationTarget = buildCalibrationTarget(input.targetMelody);
  const frames = await detectPitchFrames(input.audioBlob);
  const voicedFrames = frames.filter((frame) => frame.midi !== null && frame.confidence >= 0.45);

  if (voicedFrames.length < 6) {
    throw new Error("I couldn't hear enough stable pitch for calibration. Try again in a quieter space.");
  }

  const { cleanedFrames, segmentedNotes } = segmentPerformedMelody(frames, calibrationTarget);
  const usableCount = segmentedNotes.filter((note) => note.pitchCenter !== null && note.status !== 'missing').length;

  if (usableCount < 3) {
    throw new Error("I couldn't hear the calibration pattern clearly enough. Sing do re mi fa sol a little more clearly and try again.");
  }

  const profile = buildProfile(calibrationTarget, segmentedNotes);
  const warnings: string[] = [];

  if (!profile.successful) {
    warnings.push('Calibration was usable, but the pitch center was not fully stable yet.');
  }
  if (profile.signalQuality === 'poor') {
    warnings.push('The calibration signal was noisy, so it will only be used very lightly.');
  }

  return {
    profile,
    frames,
    cleanedFrames,
    segmentedNotes,
    warnings,
  };
}

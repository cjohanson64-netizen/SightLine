import type { HarmonyEvent } from '../../../tat/models/schema';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function toPitchName(pc: number): string {
  return NOTE_NAMES[((pc % 12) + 12) % 12];
}

export function toOctave(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

export function toPitchString(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  return `${toPitchName(pc)}${toOctave(midi)}`;
}

export function midiToDegree(midi: number, keyScale: number[]): number {
  const pc = ((midi % 12) + 12) % 12;
  const idx = keyScale.indexOf(pc);
  return idx === -1 ? 1 : idx + 1;
}

export function chordToneCandidatesInRange(chordPcs: number[], rangeMin: number, rangeMax: number): number[] {
  const pitchSet = new Set(chordPcs);
  const candidates: number[] = [];
  for (let midi = rangeMin; midi <= rangeMax; midi += 1) {
    const pc = ((midi % 12) + 12) % 12;
    if (pitchSet.has(pc)) {
      candidates.push(midi);
    }
  }
  return candidates;
}

export function degreeCandidatesInRange(targetDegree: number, keyScale: number[], rangeMin: number, rangeMax: number): number[] {
  const targetPc = keyScale[(targetDegree - 1 + 700) % 7];
  const result: number[] = [];
  for (let midi = rangeMin; midi <= rangeMax; midi += 1) {
    const pc = ((midi % 12) + 12) % 12;
    if (pc === targetPc) {
      result.push(midi);
    }
  }
  return result;
}

export function nearestPcWithinLeapCap(
  targetMidi: number,
  prevMidi: number,
  rangeMin: number,
  rangeMax: number,
  maxLeapSemitones: number
): number | null {
  const targetPc = ((targetMidi % 12) + 12) % 12;
  let best: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let midi = rangeMin; midi <= rangeMax; midi += 1) {
    const pc = ((midi % 12) + 12) % 12;
    if (pc !== targetPc) {
      continue;
    }
    const leap = Math.abs(midi - prevMidi);
    if (leap > maxLeapSemitones) {
      continue;
    }
    const score = Math.abs(midi - targetMidi) * 10 + leap;
    if (score < bestScore) {
      bestScore = score;
      best = midi;
    }
  }
  return best;
}

export function nearestAllowedPcWithinLeapCap(
  allowedPcs: number[],
  targetMidi: number,
  prevMidi: number,
  rangeMin: number,
  rangeMax: number,
  maxLeapSemitones: number
): number | null {
  const allowed = new Set(allowedPcs.map((pc) => ((pc % 12) + 12) % 12));
  let best: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let midi = rangeMin; midi <= rangeMax; midi += 1) {
    const pc = ((midi % 12) + 12) % 12;
    if (!allowed.has(pc)) {
      continue;
    }
    const leap = Math.abs(midi - prevMidi);
    if (leap > maxLeapSemitones) {
      continue;
    }
    const score = Math.abs(midi - targetMidi) * 10 + leap;
    if (score < bestScore) {
      bestScore = score;
      best = midi;
    }
  }
  return best;
}

export function nextScaleStepMidi(currentMidi: number, direction: 1 | -1, keyScale: number[], rangeMin: number, rangeMax: number): number | null {
  for (let midi = currentMidi + direction; midi >= rangeMin && midi <= rangeMax; midi += direction) {
    const pc = ((midi % 12) + 12) % 12;
    if (keyScale.includes(pc)) {
      return midi;
    }
  }
  return null;
}

export function collectCandidateMidisFromPcs(pcs: number[], rangeMin: number, rangeMax: number): number[] {
  const allowed = new Set(pcs.map((pc) => ((pc % 12) + 12) % 12));
  const result: number[] = [];
  for (let midi = rangeMin; midi <= rangeMax; midi += 1) {
    const pc = ((midi % 12) + 12) % 12;
    if (allowed.has(pc)) {
      result.push(midi);
    }
  }
  return result;
}

export function nearestMidiWithPcInRange(pc: number, targetMidi: number, minMidi: number, maxMidi: number): number | null {
  const candidates: number[] = [];
  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    if (((midi % 12) + 12) % 12 === pc) {
      candidates.push(midi);
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((best, midi) => (Math.abs(midi - targetMidi) < Math.abs(best - targetMidi) ? midi : best));
}

export function nearestChordToneMidi(harmonyEvent: HarmonyEvent, referenceMidi: number, rangeMin: number, rangeMax: number): number {
  const candidates = chordToneCandidatesInRange(harmonyEvent.chordPcs, rangeMin, rangeMax);
  if (candidates.length === 0) {
    return Math.max(rangeMin, Math.min(rangeMax, referenceMidi));
  }
  return candidates.reduce((best, midi) => (Math.abs(midi - referenceMidi) < Math.abs(best - referenceMidi) ? midi : best));
}

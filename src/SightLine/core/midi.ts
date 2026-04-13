import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";

export const KEY_TO_PC: Record<string, number> = {
  C: 0,
  Cb: 11,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

export const SHARP_NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export const FLAT_NOTE_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];

const MAJOR_KEY_SPELLINGS: Record<string, Partial<Record<number, string>>> = {
  C: { 0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 11: "B" },
  G: { 0: "C", 2: "D", 4: "E", 6: "F#", 7: "G", 9: "A", 11: "B" },
  D: { 1: "C#", 2: "D", 4: "E", 6: "F#", 7: "G", 9: "A", 11: "B" },
  A: { 1: "C#", 2: "D", 4: "E", 6: "F#", 8: "G#", 9: "A", 11: "B" },
  E: { 1: "C#", 3: "D#", 4: "E", 6: "F#", 8: "G#", 9: "A", 11: "B" },
  B: { 1: "C#", 3: "D#", 6: "F#", 8: "G#", 10: "A#", 11: "B", 4: "E" },
  "F#": { 1: "C#", 3: "D#", 5: "E#", 6: "F#", 8: "G#", 10: "A#", 11: "B" },
  "C#": { 0: "B#", 1: "C#", 3: "D#", 5: "E#", 6: "F#", 8: "G#", 10: "A#" },
  F: { 0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 10: "Bb" },
  Bb: { 0: "C", 2: "D", 3: "Eb", 5: "F", 7: "G", 9: "A", 10: "Bb" },
  Eb: { 0: "C", 2: "D", 3: "Eb", 5: "F", 7: "G", 8: "Ab", 10: "Bb" },
  Ab: { 0: "C", 1: "Db", 3: "Eb", 5: "F", 7: "G", 8: "Ab", 10: "Bb" },
  Db: { 0: "C", 1: "Db", 3: "Eb", 5: "F", 6: "Gb", 8: "Ab", 10: "Bb" },
  Gb: { 1: "Db", 3: "Eb", 5: "F", 6: "Gb", 8: "Ab", 10: "Bb", 11: "Cb" },
  Cb: { 1: "Db", 3: "Eb", 4: "Fb", 6: "Gb", 8: "Ab", 10: "Bb", 11: "Cb" },
};

const NATURAL_NOTE_PCS: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export function midiToPc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function toOctave(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

function octaveForSpelledNote(midi: number, noteName: string): number {
  const match = /^([A-G])([#b]?)$/.exec(noteName);
  if (!match) {
    return toOctave(midi);
  }
  const [, step, accidental] = match;
  const naturalPc = NATURAL_NOTE_PCS[step] ?? 0;
  const accidentalOffset = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  return Math.floor((midi - naturalPc - accidentalOffset) / 12) - 1;
}

function spelledNoteNameForMidi(
  midi: number,
  options?: { preferFlats?: boolean; key?: ExerciseSpec["key"]; mode?: ExerciseSpec["mode"] },
): string {
  const pc = midiToPc(midi);
  const keySpelling =
    options?.key && (options.mode ?? "major") === "major"
      ? MAJOR_KEY_SPELLINGS[options.key]?.[pc]
      : null;
  if (keySpelling) {
    return keySpelling;
  }
  const names = options?.preferFlats ? FLAT_NOTE_NAMES : SHARP_NOTE_NAMES;
  return names[pc];
}

export function pitchOctaveForMidi(
  midi: number,
  options?: { preferFlats?: boolean; key?: ExerciseSpec["key"]; mode?: ExerciseSpec["mode"] },
): number {
  const noteName = spelledNoteNameForMidi(midi, options);
  return octaveForSpelledNote(midi, noteName);
}

export function midiToPitch(
  midi: number,
  options?: { preferFlats?: boolean; key?: ExerciseSpec["key"]; mode?: ExerciseSpec["mode"] },
): string {
  const noteName = spelledNoteNameForMidi(midi, options);
  return `${noteName}${octaveForSpelledNote(midi, noteName)}`;
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function prefersFlatsForKey(
  key: ExerciseSpec["key"],
  mode: ExerciseSpec["mode"],
): boolean {
  const majorFifths: Record<string, number> = {
    C: 0,
    G: 1,
    D: 2,
    A: 3,
    E: 4,
    B: 5,
    "F#": 6,
    "C#": 7,
    F: -1,
    Bb: -2,
    Eb: -3,
    Ab: -4,
    Db: -5,
    Gb: -6,
    Cb: -7,
  };
  const minorFifths: Record<string, number> = {
    A: 0,
    E: 1,
    B: 2,
    "F#": 3,
    "C#": 4,
    "G#": 5,
    "D#": 6,
    D: -1,
    G: -2,
    C: -3,
    F: -4,
    Bb: -5,
    Eb: -6,
    Ab: -7,
  };
  const fifths = mode === "major" ? majorFifths[key] : minorFifths[key];
  return typeof fifths === "number" ? fifths < 0 : false;
}

export function noteKey(event: MelodyEvent, index: number): string {
  const onset = Number((event.onsetBeat ?? event.beat).toFixed(3));
  return `${event.measure}:${onset}:${event.chordId}:${index}`;
}

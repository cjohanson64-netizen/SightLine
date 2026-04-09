import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";

export const KEY_TO_PC: Record<string, number> = {
  C: 0,
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

export function midiToPc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function toOctave(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

export function midiToPitch(
  midi: number,
  options?: { preferFlats?: boolean },
): string {
  const names = options?.preferFlats ? FLAT_NOTE_NAMES : SHARP_NOTE_NAMES;
  return `${names[midiToPc(midi)]}${toOctave(midi)}`;
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

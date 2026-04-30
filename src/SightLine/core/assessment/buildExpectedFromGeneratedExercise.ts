import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";
import { KEY_TO_PC, midiToFrequency, midiToPitch } from "../midi";
import type { DetectedTonic, ExpectedMelody, ExpectedRhythm } from "./types";

const DURATION_UNITS_BY_NAME: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
};

function getRenderableAttacks(melody: MelodyEvent[]): MelodyEvent[] {
  return melody.filter((note) => note.isAttack !== false);
}

function expectedNoteId(note: MelodyEvent, index: number): string {
  const onset = Number((note.onsetBeat ?? note.beat).toFixed(3));
  return `${note.measure}:${onset}:${index}`;
}

function noteName(note: MelodyEvent): string {
  return `${note.pitch}${note.octave}`;
}

function rhythmUnits(note: MelodyEvent): number {
  if (typeof note.durationBeats === "number" && note.durationBeats > 0) {
    return note.durationBeats;
  }
  return DURATION_UNITS_BY_NAME[note.duration] ?? 1;
}

export function buildExpectedMelodyFromGeneratedExercise(
  melody: MelodyEvent[],
  exerciseId: string,
): ExpectedMelody {
  return {
    exerciseId,
    notes: getRenderableAttacks(melody).map((note, index) => ({
      id: expectedNoteId(note, index),
      index,
      writtenMidi: note.midi,
      writtenNoteName: noteName(note),
    })),
  };
}

export function buildExpectedRhythmFromGeneratedExercise(
  melody: MelodyEvent[],
): ExpectedRhythm {
  return {
    units: getRenderableAttacks(melody).map(rhythmUnits),
  };
}

export function buildDetectedTonicFromGeneratedExercise(
  spec: ExerciseSpec,
  melody: MelodyEvent[],
): DetectedTonic {
  const tonicPitchClass = KEY_TO_PC[spec.key] ?? 0;
  const firstMidi = getRenderableAttacks(melody)[0]?.midi ?? 60;
  const tonicMidi =
    firstMidi - ((((firstMidi % 12) + 12) % 12) - tonicPitchClass + 12) % 12;

  return {
    tonicHz: midiToFrequency(tonicMidi),
    tonicMidi,
    tonicPitchClass,
    tonicNoteName: midiToPitch(tonicMidi, {
      key: spec.key,
      mode: spec.mode,
    }),
    confidence: 1,
  };
}

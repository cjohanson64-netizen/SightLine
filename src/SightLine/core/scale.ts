import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";
import { KEY_TO_PC, midiToPc, noteKey, pitchOctaveForMidi } from "./midi";

export interface PitchPatchEntry {
  midi: number;
  pitch: string;
  octave?: number;
}

export function modeScale(mode: ExerciseSpec["mode"]): number[] {
  return mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
}

export function midiToDegree(midi: number, keyScale: number[]): number {
  const idx = keyScale.indexOf(midiToPc(midi));
  return idx === -1 ? 1 : idx + 1;
}

export function tessituraRange(specInput: ExerciseSpec): {
  minMidi: number;
  maxMidi: number;
} {
  const tonicPc = KEY_TO_PC[specInput.key] ?? 0;
  const scale = modeScale(specInput.mode).map((step) => (tonicPc + step) % 12);
  const lowPc = scale[(specInput.range.lowDegree - 1 + 700) % 7] ?? tonicPc;
  const highPc = scale[(specInput.range.highDegree - 1 + 700) % 7] ?? tonicPc;
  const lowMidi = (specInput.range.lowOctave + 1) * 12 + lowPc;
  const highMidi = (specInput.range.highOctave + 1) * 12 + highPc;
  return {
    minMidi: Math.min(lowMidi, highMidi),
    maxMidi: Math.max(lowMidi, highMidi),
  };
}

export function nextScaleStepMidi(
  currentMidi: number,
  direction: 1 | -1,
  keyScale: number[],
  rangeMin = 0,
  rangeMax = 127,
): number | null {
  for (
    let midi = currentMidi + direction;
    midi >= rangeMin && midi <= rangeMax;
    midi += direction
  ) {
    if (keyScale.includes(midiToPc(midi))) {
      return midi;
    }
  }
  return null;
}

export function allPcCandidatesInRange(
  pc: number,
  minMidi: number,
  maxMidi: number,
): number[] {
  const result: number[] = [];
  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    if (midiToPc(midi) === pc) {
      result.push(midi);
    }
  }
  return result;
}

export function applyPitchPatch(
  melody: MelodyEvent[],
  patch: Record<string, PitchPatchEntry>,
  options?: {
    noteKeyFn?: (event: MelodyEvent, index: number) => string;
    octaveForMidi?: (midi: number) => number;
    includeEditMetadata?: boolean;
  },
): MelodyEvent[] {
  const noteKeyFn = options?.noteKeyFn ?? noteKey;
  const octaveForMidi = options?.octaveForMidi ?? pitchOctaveForMidi;

  return melody.map((event, index) => {
    if (event.isAttack === false) {
      return event;
    }

    const override = patch[noteKeyFn(event, index)];
    if (!override) {
      return event;
    }

    return {
      ...event,
      midi: override.midi,
      pitch: override.pitch,
      octave: override.octave ?? octaveForMidi(override.midi),
      isEdited: true,
      ...(options?.includeEditMetadata
        ? {
            editedMidi: override.midi,
            editedPitch: override.pitch,
            originalMidi: event.midi,
          }
        : {}),
    };
  });
}

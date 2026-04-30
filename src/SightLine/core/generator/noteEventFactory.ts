import { toOctave } from '../midi';
import type { CandidatePitch, NoteRole, SelectedNoteEvent } from './selectNextPitchCore';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

interface CreateSelectedNoteEventInput {
  candidate: CandidatePitch;
  role: NoteRole;
  reason: string;
  chordId: string;
  keyId: string;
  requiresResolution?: boolean;
}

export function createSelectedNoteEvent({
  candidate,
  role,
  reason,
  chordId,
  keyId,
  requiresResolution
}: CreateSelectedNoteEventInput): SelectedNoteEvent {
  return {
    pitch: toPitchName(candidate.pc),
    octave: toOctave(candidate.midi),
    midi: candidate.midi,
    role,
    reason,
    chordId,
    keyId,
    nht: requiresResolution
      ? {
          requiresResolution: true
        }
      : undefined
  };
}

function toPitchName(pc: number): string {
  return NOTE_NAMES[((pc % 12) + 12) % 12];
}

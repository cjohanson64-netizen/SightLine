import { buildCandidates } from "./pitchCandidates";
import { applyFilters } from "./pitchFilters";
import { pickBest } from "./pitchSelector";
import type {
  PrevPitch,
  PitchRange,
  SelectNextPitchInput,
  SelectNextPitchNoSolution,
  SelectNextPitchOutput,
  SelectedNoteEvent,
  SelectionDebug,
  NoteRole,
} from "./selectNextPitchCore";

export type {
  NoteRole,
  PitchRange,
  PrevPitch,
  SelectNextPitchInput,
  SelectNextPitchNoSolution,
  SelectNextPitchOutput,
  SelectedNoteEvent,
  SelectionDebug,
} from "./selectNextPitchCore";

export function selectNextPitch(
  input: SelectNextPitchInput,
): SelectNextPitchOutput | SelectNextPitchNoSolution {
  const debug: SelectionDebug[] = [];
  const { allCandidates, keyCandidates, tonnetzDistances } = buildCandidates(input);

  debug.push({
    step: "start",
    remainingCandidateCount: allCandidates.length,
    reason: "allTonnetzPitchesInRange",
  });
  debug.push({
    step: "pruneKey",
    remainingCandidateCount: keyCandidates.length,
    reason: "candidates∩keyPitchSet",
  });

  const filtered = applyFilters(keyCandidates, input, debug);
  return pickBest(filtered, input, tonnetzDistances, debug);
}

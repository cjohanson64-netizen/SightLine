import { toOctave } from "../midi";
import type { FilteredPitchCandidates } from "./pitchFilters";
import {
  candidateToPitchString,
  nearestTonicInRange,
  toPitchName,
  type CandidatePitch,
  type NoteRole,
  type SelectNextPitchInput,
  type SelectNextPitchNoSolution,
  type SelectNextPitchOutput,
  type SelectionDebug,
} from "./selectNextPitchCore";

export function buildNoSolutionResult(
  filtered: FilteredPitchCandidates,
  debug: SelectionDebug[],
): SelectNextPitchNoSolution {
  return {
    status: "no_solution",
    debug,
    relaxationTier: 3,
    relaxedRules: ["constraints_too_strict"],
    noSolutionDetails: {
      illegalDegrees: [...filtered.constraints.illegalDegrees],
      illegalIntervalsSemis: [...filtered.constraints.illegalIntervalsSemis],
      illegalTransitions: [...filtered.constraints.illegalTransitions],
    },
  };
}

export function buildSelectedNoteResult(
  candidate: CandidatePitch,
  input: SelectNextPitchInput,
  noteRole: NoteRole,
  reason: string,
  relaxationTier: number,
  relaxedRules: string[],
  debug: SelectionDebug[],
): SelectNextPitchOutput {
  return {
    status: "ok",
    noteEvent: {
      pitch: toPitchName(candidate.pc),
      octave: toOctave(candidate.midi),
      midi: candidate.midi,
      role: noteRole,
      reason,
      chordId: input.harmony.chordId,
      keyId: input.key.keyId,
      nht:
        noteRole === "NonHarmonicTone"
          ? {
              requiresResolution: true,
            }
          : undefined,
    },
    debug,
    relaxationTier,
    relaxedRules,
  };
}

export function buildFallbackTonicResult(
  input: SelectNextPitchInput,
  reason: string,
  relaxationTier: number,
  relaxedRules: string[],
  debug: SelectionDebug[],
): SelectNextPitchOutput {
  const tonic = nearestTonicInRange(
    input.key.tonicPc,
    input.prevPitch,
    input.range,
  );
  const fallback = tonic ?? { pc: input.key.tonicPc, midi: input.prevPitch.midi };

  debug.push({
    step: "fallback",
    remainingCandidateCount: 0,
    chosenPitch: candidateToPitchString(fallback),
    reason,
  });

  return buildSelectedNoteResult(
    fallback,
    input,
    "FallbackTonic",
    reason,
    relaxationTier,
    relaxedRules,
    debug,
  );
}

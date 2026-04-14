import type { FilteredPitchCandidates } from "./pitchFilters";
import {
  type SelectNextPitchInput,
  type SelectNextPitchNoSolution,
  type SelectNextPitchOutput,
  type SelectionDebug,
} from "./selectNextPitchCore";
import { buildNoSolutionResult } from "./pitchResultBuilders";
import {
  getChordCandidates,
  tryChordToneSelection,
  tryFirstNoteSelection,
  tryForcedChordToneSelection,
  tryForcedNonHarmonicSelection,
  tryKeyOnlyFallbackSelection,
} from "./pitchSelectionPolicies";

export function pickBest(
  filtered: FilteredPitchCandidates,
  input: SelectNextPitchInput,
  tonnetzDistances: Map<string, number>,
  debug: SelectionDebug[],
): SelectNextPitchOutput | SelectNextPitchNoSolution {
  if (filtered.candidates.length === 0) {
    debug.push({
      step: "noSolution",
      remainingCandidateCount: 0,
      reason: "constraints_too_strict",
    });
    return buildNoSolutionResult(filtered, debug);
  }

  const ctx = {
    debug,
    filtered,
    input,
    tonnetzDistances,
  };
  const state = {
    activeRelaxationTier: filtered.activeRelaxationTier,
    relaxedRules: [...filtered.relaxedRules],
  };
  const chordCandidates = getChordCandidates(ctx);

  return (
    tryForcedChordToneSelection(ctx, state, chordCandidates) ??
    tryForcedNonHarmonicSelection(ctx, state) ??
    tryFirstNoteSelection(ctx, state) ??
    tryChordToneSelection(ctx, state, chordCandidates) ??
    tryKeyOnlyFallbackSelection(ctx, state)
  );
}

import { scoreCandidates } from "./pitchScoring";
import {
  candidateToPitchString,
  type BestResult,
  type CandidatePitch,
  type SelectNextPitchInput,
  type SelectNextPitchOutput,
  type SelectionDebug,
  withCadenceDebug,
  withLeapDebug,
  withStartDebug,
} from "./selectNextPitchCore";
import type { FilteredPitchCandidates } from "./pitchFilters";
import {
  buildFallbackTonicResult,
  buildSelectedNoteResult,
} from "./pitchResultBuilders";

export interface PitchSelectionPolicyContext {
  debug: SelectionDebug[];
  filtered: FilteredPitchCandidates;
  input: SelectNextPitchInput;
  tonnetzDistances: Map<string, number>;
}

export interface PitchSelectionPolicyState {
  activeRelaxationTier: number;
  relaxedRules: string[];
}

function degreeForPc(keyScale: number[], pc: number): number {
  const idx = keyScale.indexOf(((pc % 12) + 12) % 12);
  return idx === -1 ? 1 : idx + 1;
}

function applySelectionDebug(
  best: BestResult,
  ctx: PitchSelectionPolicyContext,
  options?: { includeStartDebug?: boolean },
) {
  best.cadenceFromDegree = ctx.filtered.cadenceFromDegree;
  best.startDegree = degreeForPc(ctx.input.key.keyScale, best.candidate.pc);
  withLeapDebug(ctx.debug, best);
  withCadenceDebug(ctx.debug, ctx.input, best, ctx.filtered.appliedHard);
  if (options?.includeStartDebug) {
    withStartDebug(ctx.debug, ctx.input, best);
  }
}

function scorePool(
  candidates: CandidatePitch[],
  ctx: PitchSelectionPolicyContext,
): BestResult | null {
  return scoreCandidates(
    candidates,
    ctx.input,
    ctx.tonnetzDistances,
    ctx.filtered.cadenceBonusByMidi,
  ).best;
}

export function getChordCandidates(
  ctx: PitchSelectionPolicyContext,
): CandidatePitch[] {
  const chordCandidates = ctx.filtered.candidates.filter((candidate) =>
    ctx.input.harmony.chordNowPitchSet.has(candidate.pc),
  );
  ctx.debug.push({
    step: "pruneHarmony",
    remainingCandidateCount: chordCandidates.length,
    reason: "candidates∩harmonyPitchSet",
  });
  return chordCandidates;
}

export function tryForcedChordToneSelection(
  ctx: PitchSelectionPolicyContext,
  state: PitchSelectionPolicyState,
  chordCandidates: CandidatePitch[],
): SelectNextPitchOutput | null {
  if (!ctx.input.forceChordTone) {
    return null;
  }

  const forcedChord = scorePool(chordCandidates, ctx);
  if (forcedChord) {
    applySelectionDebug(forcedChord, ctx);
    ctx.debug.push({
      step: "selectForcedChordTone",
      remainingCandidateCount: chordCandidates.length,
      chosenPitch: candidateToPitchString(forcedChord.candidate),
      reason: "forcedCadenceChordTone",
    });

    return buildSelectedNoteResult(
      forcedChord.candidate,
      ctx.input,
      "ChordTone",
      "forcedCadenceChordTone",
      state.activeRelaxationTier,
      state.relaxedRules,
      ctx.debug,
    );
  }

  const forcedKeyFallback = scorePool(ctx.filtered.candidates, ctx);
  if (forcedKeyFallback) {
    applySelectionDebug(forcedKeyFallback, ctx);
    ctx.debug.push({
      step: "cadenceFallbackPath",
      remainingCandidateCount: ctx.filtered.candidates.length,
      chosenPitch: candidateToPitchString(forcedKeyFallback.candidate),
      reason: "harmonyPrunedEmpty_orRejected_then_keyOnlyWithCadencePolicy",
    });

    const isChordTone = ctx.input.harmony.chordNowPitchSet.has(
      forcedKeyFallback.candidate.pc,
    );
    return buildSelectedNoteResult(
      forcedKeyFallback.candidate,
      ctx.input,
      isChordTone ? "ChordTone" : "NonHarmonicTone",
      "forcedCadence_keyOnlyFallback",
      state.activeRelaxationTier < 2 ? 2 : state.activeRelaxationTier,
      state.activeRelaxationTier < 2 &&
        !state.relaxedRules.includes("harmonyPreference")
        ? [...state.relaxedRules, "harmonyPreference"]
        : state.relaxedRules,
      ctx.debug,
    );
  }

  return buildFallbackTonicResult(
    ctx.input,
    "forcedCadence_noChordTone_returnToTonic",
    state.activeRelaxationTier,
    state.relaxedRules,
    ctx.debug,
  );
}

export function tryForcedNonHarmonicSelection(
  ctx: PitchSelectionPolicyContext,
  state: PitchSelectionPolicyState,
): SelectNextPitchOutput | null {
  if (!ctx.input.forceNonHarmonic) {
    return null;
  }

  const forcedNhtCandidates = ctx.filtered.candidates.filter(
    (candidate) => !ctx.input.harmony.chordNowPitchSet.has(candidate.pc),
  );
  ctx.debug.push({
    step: "forceNonHarmonic",
    remainingCandidateCount: forcedNhtCandidates.length,
    reason: "beat2or4_requireNHT",
  });

  const forcedBest = scorePool(forcedNhtCandidates, ctx);
  if (forcedBest) {
    withLeapDebug(ctx.debug, forcedBest);
    withCadenceDebug(
      ctx.debug,
      ctx.input,
      forcedBest,
      ctx.filtered.appliedHard,
    );
    ctx.debug.push({
      step: "selectForcedNonHarmonic",
      remainingCandidateCount: forcedNhtCandidates.length,
      chosenPitch: candidateToPitchString(forcedBest.candidate),
      reason: "forcedBeat24_keyOnly_NHT",
    });

    return buildSelectedNoteResult(
      forcedBest.candidate,
      ctx.input,
      "NonHarmonicTone",
      "forcedBeat24_keyOnly_NHT",
      state.activeRelaxationTier,
      state.relaxedRules,
      ctx.debug,
    );
  }

  return buildFallbackTonicResult(
    ctx.input,
    "forcedBeat24_noNHT_returnToTonic",
    state.activeRelaxationTier,
    state.relaxedRules,
    ctx.debug,
  );
}

export function tryFirstNoteSelection(
  ctx: PitchSelectionPolicyContext,
  state: PitchSelectionPolicyState,
): SelectNextPitchOutput | null {
  if (!ctx.input.isFirstNote) {
    return null;
  }

  const preferredStartCandidates = ctx.filtered.candidates.filter(
    (candidate) =>
      degreeForPc(ctx.input.key.keyScale, candidate.pc) ===
      (ctx.input.startingDegree ?? 1),
  );
  const startPool =
    preferredStartCandidates.length > 0
      ? preferredStartCandidates
      : ctx.filtered.candidates;
  ctx.debug.push({
    step: "startDegreeFilter",
    remainingCandidateCount: startPool.length,
    reason:
      preferredStartCandidates.length > 0
        ? `preferredStartDegree=${String(ctx.input.startingDegree ?? 1)}`
        : `preferredStartDegreeUnavailable_fallbackWeighted=${String(
            ctx.input.startingDegree ?? 1,
          )}`,
  });

  const startBest = scorePool(startPool, ctx);
  if (!startBest) {
    return null;
  }

  applySelectionDebug(startBest, ctx, { includeStartDebug: true });
  ctx.debug.push({
    step: "selectStartNote",
    remainingCandidateCount: ctx.filtered.candidates.length,
    chosenPitch: candidateToPitchString(startBest.candidate),
    reason: "firstNote_weightedScaleDegree",
  });

  return buildSelectedNoteResult(
    startBest.candidate,
    ctx.input,
    ctx.input.harmony.chordNowPitchSet.has(startBest.candidate.pc)
      ? "ChordTone"
      : "NonHarmonicTone",
    "firstNote_weightedScaleDegree",
    state.activeRelaxationTier,
    state.relaxedRules,
    ctx.debug,
  );
}

export function tryChordToneSelection(
  ctx: PitchSelectionPolicyContext,
  state: PitchSelectionPolicyState,
  chordCandidates: CandidatePitch[],
): SelectNextPitchOutput | null {
  const chordBest = scorePool(chordCandidates, ctx);
  if (!chordBest) {
    return null;
  }

  applySelectionDebug(chordBest, ctx, { includeStartDebug: true });
  ctx.debug.push({
    step: "selectChordTone",
    remainingCandidateCount: chordCandidates.length,
    chosenPitch: candidateToPitchString(chordBest.candidate),
    reason: "key+harmony+closest",
  });

  return buildSelectedNoteResult(
    chordBest.candidate,
    ctx.input,
    "ChordTone",
    "key+harmony+closest",
    state.activeRelaxationTier,
    state.relaxedRules,
    ctx.debug,
  );
}

export function tryKeyOnlyFallbackSelection(
  ctx: PitchSelectionPolicyContext,
  state: PitchSelectionPolicyState,
): SelectNextPitchOutput {
  const nhtBest = scorePool(ctx.filtered.candidates, ctx);
  if (nhtBest) {
    applySelectionDebug(nhtBest, ctx, { includeStartDebug: true });
    ctx.debug.push({
      step: "graftBackHarmonyPrune",
      remainingCandidateCount: ctx.filtered.candidates.length,
      reason: ctx.input.cadenceContext
        ? "restoreKeyPrunedCandidates_withCadencePolicyFallback"
        : "restoreKeyPrunedCandidates",
    });
    ctx.debug.push({
      step: "selectNonHarmonic",
      remainingCandidateCount: ctx.filtered.candidates.length,
      chosenPitch: candidateToPitchString(nhtBest.candidate),
      reason: "keyOnly+closest_NHT",
    });

    const nextRelaxationTier =
      state.activeRelaxationTier < 2 ? 2 : state.activeRelaxationTier;
    const nextRelaxedRules = state.relaxedRules.includes("harmonyPreference")
      ? state.relaxedRules
      : [...state.relaxedRules, "harmonyPreference"];

    return buildSelectedNoteResult(
      nhtBest.candidate,
      ctx.input,
      "NonHarmonicTone",
      "keyOnly+closest_NHT",
      nextRelaxationTier,
      nextRelaxedRules,
      ctx.debug,
    );
  }

  return buildFallbackTonicResult(
    ctx.input,
    "noCandidates_returnToTonic",
    state.activeRelaxationTier,
    state.relaxedRules,
    ctx.debug,
  );
}

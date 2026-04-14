import { applyCadencePolicy, type CadenceOption } from "./cadenceVoiceLeading";
import type {
  CandidatePitch,
  SelectNextPitchInput,
  SelectionDebug,
} from "./selectNextPitchCore";

export interface FilteredPitchCandidates {
  activeRelaxationTier: number;
  appliedHard: boolean;
  cadenceBonusByMidi: Map<number, { bonus: number; matchingOption?: CadenceOption }>;
  cadenceFromDegree?: number;
  candidates: CandidatePitch[];
  constraints: NonNullable<SelectNextPitchInput["constraints"]>;
  relaxedRules: string[];
}

function degreeForPc(keyScale: number[], pc: number): number {
  const idx = keyScale.indexOf(((pc % 12) + 12) % 12);
  return idx === -1 ? 1 : idx + 1;
}

function applyConstraintTier(
  candidates: CandidatePitch[],
  input: SelectNextPitchInput,
  constraints: NonNullable<SelectNextPitchInput["constraints"]>,
  options: { allowTransitions: boolean; allowIntervals: boolean },
): CandidatePitch[] {
  const illegalDegreeSet = new Set(constraints.illegalDegrees);
  const illegalIntervalSet = new Set(constraints.illegalIntervalsSemis);
  const prevDegree = degreeForPc(input.key.keyScale, input.prevPitch.pc);

  return candidates.filter((candidate) => {
    const candDegree = degreeForPc(input.key.keyScale, candidate.pc);
    if (illegalDegreeSet.has(candDegree)) {
      return false;
    }

    if (options.allowIntervals) {
      const semis = Math.abs(candidate.midi - input.prevPitch.midi);
      if (illegalIntervalSet.has(semis)) {
        return false;
      }
    }

    if (options.allowTransitions && constraints.illegalTransitions.length > 0) {
      const blocked = constraints.illegalTransitions.some((rule) => {
        if (rule.mode !== "adjacent") {
          return false;
        }
        return (
          (rule.a === prevDegree && rule.b === candDegree) ||
          (rule.b === prevDegree && rule.a === candDegree)
        );
      });
      if (blocked) {
        return false;
      }
    }

    return true;
  });
}

function applyCadenceToCandidates(
  candidates: CandidatePitch[],
  input: SelectNextPitchInput,
  debug: SelectionDebug[],
): {
  appliedHard: boolean;
  bonusByMidi: Map<number, { bonus: number; matchingOption?: CadenceOption }>;
  candidates: CandidatePitch[];
  fromDegree?: number;
} {
  if (!input.cadenceContext) {
    return {
      candidates,
      bonusByMidi: new Map<number, { bonus: number; matchingOption?: CadenceOption }>(),
      appliedHard: false,
      fromDegree: undefined,
    };
  }

  const fromDegree = degreeForPc(input.key.keyScale, input.prevPitch.pc);
  const policy = applyCadencePolicy({
    cadenceType: input.cadenceContext.type,
    fromDegree,
    candidates: candidates.map((candidate) => ({
      midi: candidate.midi,
      degree: degreeForPc(input.key.keyScale, candidate.pc),
    })),
    tonicDegree: 1,
    slotTag: input.cadenceContext.slotTag,
  });

  debug.push({
    step: "cadencePolicy",
    remainingCandidateCount: policy.candidatesOut.length,
    reason: policy.debug,
  });

  const allowedMidi = new Set(policy.candidatesOut.map((entry) => entry.midi));
  const bonusByMidi = new Map<number, { bonus: number; matchingOption?: CadenceOption }>();
  for (const entry of policy.candidatesOut) {
    bonusByMidi.set(entry.midi, {
      bonus: entry.cadenceWeightBonus,
      matchingOption: entry.matchingOption,
    });
  }

  return {
    candidates: candidates.filter((candidate) => allowedMidi.has(candidate.midi)),
    bonusByMidi,
    appliedHard: policy.appliedHard,
    fromDegree,
  };
}

export function applyFilters(
  keyCandidates: CandidatePitch[],
  input: SelectNextPitchInput,
  debug: SelectionDebug[],
): FilteredPitchCandidates {
  const constraints = input.constraints ?? {
    illegalDegrees: [],
    illegalIntervalsSemis: [],
    illegalTransitions: [],
  };
  const relaxedRules: string[] = [];
  let activeRelaxationTier = 0;

  let constrainedKeyCandidates = applyConstraintTier(
    keyCandidates,
    input,
    constraints,
    {
      allowTransitions: true,
      allowIntervals: true,
    },
  );
  debug.push({
    step: "pruneIllegalTier0",
    remainingCandidateCount: constrainedKeyCandidates.length,
    reason: "illegalDegrees+illegalIntervals+illegalTransitions",
  });

  if (constrainedKeyCandidates.length === 0) {
    activeRelaxationTier = 1;
    relaxedRules.push("illegalTransitions");
    constrainedKeyCandidates = applyConstraintTier(
      keyCandidates,
      input,
      constraints,
      {
        allowTransitions: false,
        allowIntervals: true,
      },
    );
    debug.push({
      step: "relaxTier1",
      remainingCandidateCount: constrainedKeyCandidates.length,
      reason: "ignored illegalTransitions",
    });
  }

  if (constrainedKeyCandidates.length === 0) {
    const degreesOnlyCandidates = applyConstraintTier(
      keyCandidates,
      input,
      constraints,
      {
        allowTransitions: false,
        allowIntervals: false,
      },
    );
    const hadStepwiseIfIntervalsRelaxed = degreesOnlyCandidates.some(
      (candidate) => Math.abs(candidate.midi - input.prevPitch.midi) <= 2,
    );

    if (hadStepwiseIfIntervalsRelaxed) {
      activeRelaxationTier = 3;
      if (!relaxedRules.includes("illegalIntervalsSemis")) {
        relaxedRules.push("illegalIntervalsSemis");
      }
      constrainedKeyCandidates = degreesOnlyCandidates;
      debug.push({
        step: "relaxTier3",
        remainingCandidateCount: constrainedKeyCandidates.length,
        reason: "ignored illegalIntervalsSemis; kept illegalDegrees only",
      });
    }
  }

  const cadenceFiltered = applyCadenceToCandidates(
    constrainedKeyCandidates,
    input,
    debug,
  );

  return {
    activeRelaxationTier,
    appliedHard: cadenceFiltered.appliedHard,
    cadenceBonusByMidi: cadenceFiltered.bonusByMidi,
    cadenceFromDegree: cadenceFiltered.fromDegree,
    candidates: cadenceFiltered.candidates,
    constraints,
    relaxedRules,
  };
}

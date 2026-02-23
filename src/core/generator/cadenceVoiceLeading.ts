export type CadenceType = 'authentic' | 'plagal' | 'half';

export type CadenceOption = {
  degree: number;
  weight: number;
  hard?: boolean;
  avoid?: boolean;
};

export type CadencePolicyCandidate = {
  midi: number;
  degree: number;
};

export interface CadencePolicyInput {
  cadenceType: CadenceType;
  fromDegree: number;
  candidates: CadencePolicyCandidate[];
  tonicDegree?: number;
  slotTag: 'penultimate' | 'final';
}

export interface CadencePolicyOutput {
  candidatesOut: Array<CadencePolicyCandidate & { cadenceWeightBonus: number; matchingOption?: CadenceOption }>;
  debug: string;
  appliedHard: boolean;
}

const W_CADENCE = 9;

export function getCadenceTransitionSpec(cadenceType: CadenceType): Record<number, CadenceOption[]> {
  if (cadenceType === 'plagal') {
    return {
      6: [{ degree: 5, weight: 1, hard: true }],
      4: [{ degree: 3, weight: 1, hard: true }],
      1: [{ degree: 1, weight: 1, hard: true }]
    };
  }

  if (cadenceType === 'half') {
    return {
      1: [
        { degree: 7, weight: 0.4 },
        { degree: 2, weight: 0.35 },
        { degree: 5, weight: 0.25 },
        { degree: 4, weight: 0.05, avoid: true }
      ],
      3: [
        { degree: 2, weight: 0.6 },
        { degree: 4, weight: 0.3 },
        { degree: 5, weight: 0.1 }
      ],
      5: [
        { degree: 5, weight: 0.6 },
        { degree: 7, weight: 0.2 },
        { degree: 2, weight: 0.2 }
      ]
    };
  }

  return {
    7: [{ degree: 1, weight: 1, hard: true }],
    2: [
      { degree: 1, weight: 0.65 },
      { degree: 3, weight: 0.35 }
    ],
    4: [{ degree: 3, weight: 1, hard: true }],
    5: [
      { degree: 1, weight: 0.6 },
      { degree: 5, weight: 0.4 }
    ]
  };
}

function baseBonus(weight: number): number {
  return Math.log(Math.max(weight, 0.0001)) * W_CADENCE;
}

function degreeStepDistance(a: number, b: number): number {
  const aNorm = ((a - 1) % 7 + 7) % 7;
  const bNorm = ((b - 1) % 7 + 7) % 7;
  const forward = (bNorm - aNorm + 7) % 7;
  const backward = (aNorm - bNorm + 7) % 7;
  return Math.min(forward, backward);
}

export function applyCadencePolicy(input: CadencePolicyInput): CadencePolicyOutput {
  const spec = getCadenceTransitionSpec(input.cadenceType);
  const options = spec[input.fromDegree] ?? [];
  let workingCandidates = [...input.candidates];
  let denyTriggered = false;
  let denyOnlyOptionFallback = false;
  let stepRuleTriggered = false;
  let stepRuleFallback = false;

  // Authentic deny rule: MI->FA (3->4) is illegal in cadence window.
  // Prefer pruning, but if every candidate is illegal we keep it and log fallback.
  if (input.cadenceType === 'authentic' && input.fromDegree === 3) {
    const hasIllegal = workingCandidates.some((candidate) => candidate.degree === 4);
    if (hasIllegal) {
      denyTriggered = true;
      const legal = workingCandidates.filter((candidate) => candidate.degree !== 4);
      if (legal.length > 0) {
        workingCandidates = legal;
      } else {
        denyOnlyOptionFallback = true;
      }
    }
  }

  // Cadence resolution must be stepwise on the final cadence slot.
  // Exception: allow dominant-function Sol(5) -> Do(1) for strong final closure.
  if (input.slotTag === 'final') {
    stepRuleTriggered = true;
    const stepwise = workingCandidates.filter((candidate) => {
      const byStep = degreeStepDistance(input.fromDegree, candidate.degree) === 1;
      const dominantSolToDo =
        input.cadenceType !== 'half' && input.fromDegree === 5 && candidate.degree === (input.tonicDegree ?? 1);
      return byStep || dominantSolToDo;
    });
    if (stepwise.length > 0) {
      workingCandidates = stepwise;
    } else {
      stepRuleFallback = true;
    }
  }

  const hardOptions = options.filter((option) => option.hard);

  const enrich = (
    candidates: CadencePolicyCandidate[],
    disableHardAvoidPenalty: boolean
  ): Array<CadencePolicyCandidate & { cadenceWeightBonus: number; matchingOption?: CadenceOption }> => {
    const hasNonAvoidMatch = candidates.some((candidate) => {
      const match = options.find((option) => option.degree === candidate.degree);
      return Boolean(match && !match.avoid);
    });

    return candidates.map((candidate) => {
      const matchingOption = options.find((option) => option.degree === candidate.degree);
      if (!matchingOption) {
        return { ...candidate, cadenceWeightBonus: 0 };
      }

      let bonus = baseBonus(matchingOption.weight);
      if (matchingOption.avoid && hasNonAvoidMatch && !disableHardAvoidPenalty) {
        bonus -= 12;
      }

      return {
        ...candidate,
        cadenceWeightBonus: bonus,
        matchingOption
      };
    });
  };

  if (hardOptions.length > 0) {
    const hardDegrees = new Set(hardOptions.map((option) => option.degree));
    const hardMatched = workingCandidates.filter((candidate) => hardDegrees.has(candidate.degree));

    if (hardMatched.length > 0) {
      return {
        candidatesOut: enrich(hardMatched, true),
        debug: `cadence_policy hard slot=${input.slotTag} from=${input.fromDegree} denyTriggered=${String(
          denyTriggered
        )} denyOnlyOptionFallback=${String(denyOnlyOptionFallback)} stepRuleTriggered=${String(
          stepRuleTriggered
        )} stepRuleFallback=${String(stepRuleFallback)}`,
        appliedHard: true
      };
    }

    return {
      candidatesOut: enrich(workingCandidates, false),
      debug: `cadence_hard_failed_fallback_weighted slot=${input.slotTag} from=${input.fromDegree} denyTriggered=${String(
        denyTriggered
      )} denyOnlyOptionFallback=${String(denyOnlyOptionFallback)} stepRuleTriggered=${String(
        stepRuleTriggered
      )} stepRuleFallback=${String(stepRuleFallback)}`,
      appliedHard: false
    };
  }

  const denySuffix = denyTriggered
    ? denyOnlyOptionFallback
      ? ' denyRule=cadence_illegal_only_option'
      : ' denyRule=mi_to_fa_pruned'
    : '';
  const stepSuffix = stepRuleTriggered ? (stepRuleFallback ? ' stepRule=final_step_fallback' : ' stepRule=final_step_enforced') : '';

  return {
    candidatesOut: enrich(workingCandidates, false),
    debug: `cadence_policy weighted slot=${input.slotTag} from=${input.fromDegree}${denySuffix}${stepSuffix}`,
    appliedHard: false
  };
}

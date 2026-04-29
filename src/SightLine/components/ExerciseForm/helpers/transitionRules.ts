import type { ExerciseSpec } from '@/SightLine/domain/music';

export interface TransitionDraft {
  a: number;
  b: number;
}

export function addTransitionRuleToSpec(
  spec: ExerciseSpec,
  transitionDraft: TransitionDraft
): ExerciseSpec {
  const nextRule = {
    a: transitionDraft.a,
    b: transitionDraft.b,
    mode: 'adjacent' as const
  };

  const exists = spec.illegalTransitions.some(
    (rule) =>
      rule.a === nextRule.a &&
      rule.b === nextRule.b &&
      rule.mode === nextRule.mode
  );

  if (exists) {
    return spec;
  }

  return {
    ...spec,
    illegalTransitions: [...spec.illegalTransitions, nextRule]
  };
}

export function removeTransitionRuleFromSpec(
  spec: ExerciseSpec,
  index: number
): ExerciseSpec {
  return {
    ...spec,
    illegalTransitions: spec.illegalTransitions.filter((_, i) => i !== index)
  };
}
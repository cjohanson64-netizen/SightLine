import type {
  DebugProjectedAssessmentExplanation,
  DebugProjectedTargetNote,
  PracticeRecommendation,
  SemanticInsight,
} from '@/SightLine/domain/artifact';

interface ProjectPracticeRecommendationInput {
  targetNotes: DebugProjectedTargetNote[];
  assessmentExplanations: DebugProjectedAssessmentExplanation[];
  strengths: SemanticInsight[];
  weaknesses: SemanticInsight[];
}

function strongestWeaknessByCategory(
  weaknesses: SemanticInsight[],
  category: SemanticInsight['category'],
): SemanticInsight | null {
  return (
    weaknesses
      .filter((insight) => insight.category === category)
      .sort((a, b) => b.priority - a.priority)[0] ?? null
  );
}

function hasStrongPerformance(
  strengths: SemanticInsight[],
  weaknesses: SemanticInsight[],
): boolean {
  return weaknesses.length === 0 && strengths.length > 0;
}

export function projectPracticeRecommendation(
  input: ProjectPracticeRecommendationInput,
): PracticeRecommendation | null {
  if (
    input.targetNotes.length === 0 ||
    (input.assessmentExplanations.length === 0 &&
      input.weaknesses.length === 0 &&
      input.strengths.length === 0)
  ) {
    return null;
  }

  const cadenceWeakness = strongestWeaknessByCategory(input.weaknesses, 'cadence');
  if (cadenceWeakness) {
    return {
      focus: 'cadence_resolution',
      title: 'Practice phrase endings',
      message: 'Let’s practice stronger phrase endings.',
    };
  }

  const releaseWeakness = strongestWeaknessByCategory(input.weaknesses, 'release');
  if (releaseWeakness) {
    return {
      focus: 'climax_release',
      title: 'Practice the release after the peak',
      message: 'Let’s practice smoother motion after the climax.',
    };
  }

  const connectiveWeakness = strongestWeaknessByCategory(
    input.weaknesses,
    'connective_motion',
  );
  if (connectiveWeakness) {
    return {
      focus: 'connective_motion',
      title: 'Practice passing motion',
      message: 'Let’s simplify the passing tones and focus on the main notes.',
    };
  }

  const structuralWeakness = strongestWeaknessByCategory(
    input.weaknesses,
    'structural_shape',
  );
  if (structuralWeakness) {
    return {
      focus: 'structural_accuracy',
      title: 'Practice the main phrase shape',
      message: 'Let’s reinforce the main phrase shape first.',
    };
  }

  if (hasStrongPerformance(input.strengths, input.weaknesses)) {
    return {
      focus: 'range_confidence',
      title: 'Ready for more expression',
      message: 'You’re ready for a slightly more expressive melody.',
    };
  }

  return null;
}

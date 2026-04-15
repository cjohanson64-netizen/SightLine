import type {
  DebugPhraseSemanticsSummary,
  DebugProjectedAssessmentExplanation,
  DebugProjectedTargetNote,
  SemanticInsight,
} from '@/SightLine/domain/artifact';

type InsightOutcome = 'correct' | 'near_pitch' | 'incorrect_pitch' | 'ambiguous';

export interface SemanticInsightsProjection {
  strengths: SemanticInsight[];
  weaknesses: SemanticInsight[];
}

interface ProjectSemanticInsightsInput {
  targetNotes: DebugProjectedTargetNote[];
  assessmentExplanations: DebugProjectedAssessmentExplanation[];
  phraseSummaries: DebugPhraseSemanticsSummary[];
  noteOutcomes?: Array<InsightOutcome | null>;
}

function outcomePriority(outcome: InsightOutcome | null | undefined): number {
  switch (outcome) {
    case 'incorrect_pitch':
      return 3;
    case 'near_pitch':
      return 2;
    case 'ambiguous':
      return 1;
    case 'correct':
      return 0;
    default:
      return -1;
  }
}

function buildOutcomeMap(
  input: ProjectSemanticInsightsInput,
): Map<string, InsightOutcome> {
  const byNoteId = new Map<string, InsightOutcome>();

  for (const explanation of input.assessmentExplanations) {
    if (explanation.targetNoteId) {
      byNoteId.set(explanation.targetNoteId, explanation.outcome);
    }
  }

  if (byNoteId.size > 0) {
    return byNoteId;
  }

  input.targetNotes.forEach((note, index) => {
    const outcome = input.noteOutcomes?.[index];
    if (outcome) {
      byNoteId.set(note.noteId, outcome);
    }
  });

  return byNoteId;
}

function noteOutcomesForFunction(
  notes: DebugProjectedTargetNote[],
  outcomeByNoteId: Map<string, InsightOutcome>,
  fn: DebugProjectedTargetNote['functions'][number],
): InsightOutcome[] {
  return notes
    .filter((note) => note.functions.includes(fn))
    .map((note) => outcomeByNoteId.get(note.noteId) ?? 'ambiguous');
}

function mostlyCorrect(outcomes: InsightOutcome[]): boolean {
  if (outcomes.length === 0) {
    return false;
  }

  const correctCount = outcomes.filter((outcome) => outcome === 'correct').length;
  const nearCount = outcomes.filter((outcome) => outcome === 'near_pitch').length;
  return correctCount + nearCount >= Math.ceil(outcomes.length / 2);
}

function weakAccuracy(outcomes: InsightOutcome[]): boolean {
  if (outcomes.length === 0) {
    return false;
  }

  const weakCount = outcomes.filter(
    (outcome) => outcome === 'incorrect_pitch' || outcome === 'near_pitch' || outcome === 'ambiguous',
  ).length;
  return weakCount >= Math.ceil(outcomes.length / 2);
}

function structuralMostlyCorrect(outcomes: InsightOutcome[]): boolean {
  if (outcomes.length === 0) {
    return false;
  }

  const correctCount = outcomes.filter((outcome) => outcome === 'correct').length;
  return correctCount / outcomes.length >= 0.7;
}

function dedupeByCategory(candidates: RankedInsight[]): RankedInsight[] {
  const bestByCategory = new Map<SemanticInsight['category'], RankedInsight>();

  for (const candidate of candidates) {
    const existing = bestByCategory.get(candidate.category);
    if (!existing || candidate.priority > existing.priority) {
      bestByCategory.set(candidate.category, candidate);
    }
  }

  return Array.from(bestByCategory.values()).sort((a, b) => b.priority - a.priority);
}

type RankedInsight = SemanticInsight;

function selectInsights(candidates: RankedInsight[]): RankedInsight[] {
  const deduped = dedupeByCategory(candidates);
  return deduped.slice(0, 2);
}

export function projectSemanticInsights(
  input: ProjectSemanticInsightsInput,
): SemanticInsightsProjection {
  if (
    input.targetNotes.length === 0 ||
    (input.assessmentExplanations.length === 0 && (input.noteOutcomes?.length ?? 0) === 0)
  ) {
    return { strengths: [], weaknesses: [] };
  }

  const outcomeByNoteId = buildOutcomeMap(input);
  const strengths: RankedInsight[] = [];
  const weaknesses: RankedInsight[] = [];

  const climaxNotes = input.targetNotes.filter((note) => note.functions.includes('climax'));
  const climaxOutcome = climaxNotes
    .map((note) => outcomeByNoteId.get(note.noteId) ?? null)
    .sort((a, b) => outcomePriority(b) - outcomePriority(a))[0];

  if (climaxOutcome === 'correct') {
    strengths.push({
      category: 'climax',
      polarity: 'strength',
      message: 'You hit the climax accurately.',
      priority: 10,
    });
  } else if (climaxOutcome === 'near_pitch' || climaxOutcome === 'incorrect_pitch') {
    weaknesses.push({
      category: 'climax',
      polarity: 'weakness',
      message: 'Watch the peak note — that is the hardest moment in the phrase.',
      priority: 55,
    });
  }

  const cadenceOutcomes = noteOutcomesForFunction(input.targetNotes, outcomeByNoteId, 'cadence');
  if (mostlyCorrect(cadenceOutcomes)) {
    strengths.push({
      category: 'cadence',
      polarity: 'strength',
      message: 'Strong ending — nice cadence.',
      priority: 45,
    });
  } else if (cadenceOutcomes.some((outcome) => outcome === 'near_pitch' || outcome === 'incorrect_pitch')) {
    weaknesses.push({
      category: 'cadence',
      polarity: 'weakness',
      message: 'Focus on how the phrase finishes.',
      priority: 90,
    });
  }

  const releaseOutcomes = noteOutcomesForFunction(input.targetNotes, outcomeByNoteId, 'release');
  if (weakAccuracy(releaseOutcomes)) {
    weaknesses.push({
      category: 'release',
      polarity: 'weakness',
      message: 'After the peak, aim for a smoother descent.',
      priority: 80,
    });
  }

  const connectiveOutcomes = noteOutcomesForFunction(
    input.targetNotes,
    outcomeByNoteId,
    'connective_nht',
  );
  if (weakAccuracy(connectiveOutcomes)) {
    weaknesses.push({
      category: 'connective_motion',
      polarity: 'weakness',
      message: 'Watch the passing tones between the main notes.',
      priority: 70,
    });
  }

  const structuralOutcomes = noteOutcomesForFunction(
    input.targetNotes,
    outcomeByNoteId,
    'structural',
  );
  if (structuralMostlyCorrect(structuralOutcomes)) {
    strengths.push({
      category: 'structural_shape',
      polarity: 'strength',
      message: 'Your main phrase shape stayed solid.',
      priority: 35,
    });
  }

  return {
    strengths: selectInsights(strengths),
    weaknesses: selectInsights(weaknesses),
  };
}

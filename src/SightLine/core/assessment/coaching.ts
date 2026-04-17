import type { MicAssessmentRunResult } from '@/SightLine/core/audio/types';
import { buildWeightedAssessmentSummary } from '@/SightLine/core/assessmentLogs/scoring';
import { classifyMastery } from '@/SightLine/core/assessment/mastery';

export type CoachingFeedback = {
  whatWentWell: string;
  whatToImprove: string;
  tryNext: string;
};

function contourRecognizable(result: MicAssessmentRunResult): boolean {
  const { contourCorrectCount, contourIncorrectCount, contourFullyCorrect } = result.assessment.summary;
  if (contourFullyCorrect) {
    return true;
  }
  const total = contourCorrectCount + contourIncorrectCount;
  return total > 0 ? contourCorrectCount / total >= 0.6 : false;
}

function getPrimaryStrength(
  result: MicAssessmentRunResult,
  weightedSummary: ReturnType<typeof buildWeightedAssessmentSummary>
): string {
  if (result.assessment.recovery.kind && result.assessment.recovery.kind !== 'no_recovery') {
    return 'You recovered well after a tricky spot.';
  }
  if (
    result.assessment.tonalState.kind === 'recentered_new_tonic' &&
    result.assessment.tonalState.structuralConsistency.stronglyConsistent
  ) {
    return 'You stayed musically consistent through most of the phrase.';
  }
  if (result.assessment.scores.pitchScore >= 82) {
    return 'Most of your pitches were correct.';
  }
  if (result.assessment.scores.rhythmScore >= 75) {
    return 'Your rhythm pattern was mostly preserved.';
  }
  if (contourRecognizable(result)) {
    return 'You kept the melody shape clear.';
  }
  if (result.assessment.rhythm.flow.score >= 0.7) {
    return 'You kept the phrase moving steadily.';
  }
  if (
    weightedSummary.counts.same_note_off_center >=
    Math.max(2, Math.ceil(result.assessment.summary.targetNoteCount / 4))
  ) {
    return 'Many of your notes were close to the target pitch.';
  }
  return 'You kept parts of the phrase together.';
}

function getPrimaryImprovement(
  result: MicAssessmentRunResult,
  weightedSummary: ReturnType<typeof buildWeightedAssessmentSummary>
): string {
  if (
    result.assessment.tonalState.kind === 'recentered_new_tonic' &&
    result.assessment.tonalState.structuralConsistency.stronglyConsistent
  ) {
    return 'You changed key center partway through the phrase.';
  }
  if (result.assessment.rhythm.flow.kind === 'interrupted' || result.assessment.rhythm.flow.kind === 'fragmented') {
    return 'Several pauses interrupted the flow.';
  }
  const offCenterSharp = result.assessment.notes.filter(
    (note) =>
      note.displayState === 'same_note_off_center' &&
      (note.centerDeviationCents ?? 0) > 0,
  ).length;
  const offCenterFlat = result.assessment.notes.filter(
    (note) =>
      note.displayState === 'same_note_off_center' &&
      (note.centerDeviationCents ?? 0) < 0,
  ).length;
  if (
    offCenterSharp >= Math.max(2, weightedSummary.counts.same_note_off_center / 2) ||
    offCenterFlat >= Math.max(2, weightedSummary.counts.same_note_off_center / 2)
  ) {
    return offCenterSharp >= offCenterFlat
      ? 'A few notes were slightly high within the right note.'
      : 'A few notes were slightly low within the right note.';
  }
  if (result.assessment.scores.rhythmScore + 6 < result.assessment.scores.pitchScore) {
    return 'The rhythm pattern became uneven in places.';
  }
  if (result.assessment.scores.pitchScore + 6 < result.assessment.scores.rhythmScore) {
    return 'Several notes were not centered on the target pitch yet.';
  }
  if (result.assessment.firstDivergence) {
    return `The phrase started to drift around note ${result.assessment.firstDivergence.noteIndex + 1}.`;
  }
  return 'A few notes and rhythms still need more consistency.';
}

function getPracticeSuggestion(
  result: MicAssessmentRunResult,
  weightedSummary: ReturnType<typeof buildWeightedAssessmentSummary>
): string {
  if (
    result.assessment.tonalState.kind === 'recentered_new_tonic' &&
    result.assessment.tonalState.structuralConsistency.stronglyConsistent
  ) {
    return 'Sing the starting tonic before you begin, then try the whole phrase again.';
  }
  if (result.assessment.rhythm.flow.kind === 'interrupted' || result.assessment.scores.rhythmScore + 6 < result.assessment.scores.pitchScore) {
    return 'Clap the rhythm first, then sing it again.';
  }
  if (
    weightedSummary.counts.same_note_off_center >=
    Math.max(2, Math.ceil(result.assessment.summary.targetNoteCount / 4))
  ) {
    return 'Sing the phrase more slowly and center each note before moving on.';
  }
  if (result.assessment.firstDivergence && result.assessment.recovery.kind && result.assessment.recovery.kind !== 'no_recovery') {
    return 'Practice the trouble spot by itself, then put it back into the whole phrase.';
  }
  if (!contourRecognizable(result)) {
    return 'Echo the melody slowly on solfege, one note at a time.';
  }
  return 'Try it once more with a steady breath and careful note centers.';
}

export function buildCoachingFeedback(result: MicAssessmentRunResult): CoachingFeedback {
  const weightedSummary = buildWeightedAssessmentSummary(result);
  const mastery = classifyMastery(result.assessment);

  if (mastery.level === 0) {
    return {
      whatWentWell: 'You were ready to give it a try.',
      whatToImprove: 'There was not enough clear singing to score this attempt yet.',
      tryNext: 'Take a breath, sing confidently, and try the phrase again.',
    };
  }

  return {
    whatWentWell: getPrimaryStrength(result, weightedSummary),
    whatToImprove: getPrimaryImprovement(result, weightedSummary),
    tryNext: getPracticeSuggestion(result, weightedSummary),
  };
}

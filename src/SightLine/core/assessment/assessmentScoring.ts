export type PitchAssessmentStatus =
  | "correct"
  | "close"
  | "lowConfidence"
  | "incorrect"
  | "missing";

export type RhythmAssessmentStatus =
  | "match"
  | "close"
  | "mismatch"
  | "missing";

export interface AssessmentScore {
  mastery: 0 | 1 | 2 | 3 | 4;
  pitchAccuracy: number;
  rhythmAccuracy: number | null;
  melodyScore: number;
  rhythmIncluded: boolean;
}

export interface BuildAssessmentScoreInput {
  pitchStatusesByIndex: Record<number, PitchAssessmentStatus | undefined>;
  rhythmMarkersByIndex: Record<number, RhythmAssessmentStatus | undefined>;
  expectedNoteCount: number;
  rhythmIsProvisional: boolean;
}

function pitchCredit(status: PitchAssessmentStatus | undefined): number {
  if (status === "correct") {
    return 1;
  }

  if (status === "close") {
    return 0.75;
  }

  if (status === "lowConfidence") {
    return 0.5;
  }

  return 0;
}

function rhythmCredit(status: RhythmAssessmentStatus | undefined): number {
  if (status === "match") {
    return 1;
  }

  if (status === "close") {
    return 0.75;
  }

  return 0;
}

function percentFromCredits(totalCredit: number, count: number): number {
  if (count <= 0) {
    return 0;
  }

  return (totalCredit / count) * 100;
}

function masteryFromScore(score: number): AssessmentScore["mastery"] {
  if (score < 25) {
    return 0;
  }

  if (score < 50) {
    return 1;
  }

  if (score < 75) {
    return 2;
  }

  if (score < 85) {
    return 3;
  }

  return 4;
}

export function buildAssessmentScore(
  input: BuildAssessmentScoreInput,
): AssessmentScore {
  const {
    pitchStatusesByIndex,
    rhythmMarkersByIndex,
    expectedNoteCount,
    rhythmIsProvisional,
  } = input;

  if (expectedNoteCount <= 0) {
    return {
      mastery: 0,
      pitchAccuracy: 0,
      rhythmAccuracy: null,
      melodyScore: 0,
      rhythmIncluded: false,
    };
  }

  let pitchCreditTotal = 0;
  let rhythmCreditTotal = 0;

  for (let index = 0; index < expectedNoteCount; index += 1) {
    pitchCreditTotal += pitchCredit(pitchStatusesByIndex[index]);
    rhythmCreditTotal += rhythmCredit(rhythmMarkersByIndex[index]);
  }

  const pitchAccuracy = percentFromCredits(
    pitchCreditTotal,
    expectedNoteCount,
  );
  const rhythmIncluded = !rhythmIsProvisional;
  const rhythmAccuracy = rhythmIncluded
    ? percentFromCredits(rhythmCreditTotal, expectedNoteCount)
    : null;
  const melodyScore =
    rhythmAccuracy === null
      ? pitchAccuracy
      : (2 / 3) * pitchAccuracy + (1 / 3) * rhythmAccuracy;

  return {
    mastery: masteryFromScore(melodyScore),
    pitchAccuracy,
    rhythmAccuracy,
    melodyScore,
    rhythmIncluded,
  };
}

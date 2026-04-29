import type {
  ScoringFeedbackInput,
  ScoringFeedbackOutput,
  ScoringFeedbackService,
} from "../types";

export const scoringFeedbackService: ScoringFeedbackService = {
  run(_input: ScoringFeedbackInput): ScoringFeedbackOutput {
    return {
      overallScore: 0,
      categoryScores: {
        pitchAccuracy: 0,
        intervalAccuracy: 0,
        tonalStability: 0,
      },
      studentFeedback: [],
      teacherFeedback: [],
    };
  },
};

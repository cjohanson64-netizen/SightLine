import type { Confidence } from "./primitives";
import type { RelationalFinding } from "./analysis";

export interface ScoringFeedbackInput {
  exerciseId: string;
  findings: RelationalFinding[];
  analysisConfidence: Confidence;
}

export interface AssessmentCategoryScores {
  pitchAccuracy: number;
  intervalAccuracy: number;
  tonalStability: number;
}

export interface ScoringFeedbackOutput {
  overallScore: number;
  categoryScores: AssessmentCategoryScores;
  studentFeedback: string[];
  teacherFeedback: string[];
}

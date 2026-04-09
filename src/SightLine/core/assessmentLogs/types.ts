import type { AssessmentComparisonMode, PitchMatchKind, RecoveryKind, TonalStateKind } from '@/SightLine/domain/assessment';
import type { WeightedAssessmentNoteState } from './scoring';

export interface AssessmentLogNoteDetail {
  index: number;
  expectedPitch: string | null;
  detectedPitch: string | null;
  matchKind: PitchMatchKind | 'missing';
  semitoneDelta: number | null;
  weightedState: WeightedAssessmentNoteState;
  weightedScore: number;
  confidence: number | null;
  noteStatus: string | null;
  targetConsistentAmbiguity: boolean;
}

export interface AssessmentLogRecord {
  id: string;
  owner_id: string;
  teacher_id: string | null;
  class_id: string | null;
  folder_id: string | null;
  student_id: string | null;
  assignment_id: string | null;
  exercise_id: string | null;
  exercise_title: string;
  seed: number | null;
  assessment_mode: AssessmentComparisonMode;
  weighted_score: number;
  total_possible: number;
  percent: number;
  correct_count: number;
  ambiguous_count: number;
  low_confidence_count: number;
  incorrect_count: number;
  recovery_kind: RecoveryKind | null;
  tonal_state_kind: TonalStateKind | null;
  signal_quality_level: 'high' | 'medium' | 'low' | null;
  signal_quality_score: number | null;
  summary_text: string | null;
  note_details: AssessmentLogNoteDetail[];
  summary_json: Record<string, unknown> | null;
  created_at: string;
}

import { supabase } from '@/SightLine/lib/supabaseClient';
import type { MicAssessmentRunResult } from '@/SightLine/core/audio/types';
import { buildWeightedAssessmentSummary, classifyWeightedAssessmentNoteState, getWeightedAssessmentNoteScore } from './scoring';

const LOCAL_GUEST_LOGS_KEY = 'sightline_guest_assessment_logs_v1';

interface SaveAssessmentLogInput {
  authUserId: string | null;
  teacherId?: string | null;
  classId?: string | null;
  studentToken?: string | null;
  studentId?: string | null;
  folderId?: string | null;
  assignmentId?: string | null;
  exerciseId?: string | null;
  exerciseTitle: string;
  seed?: number | null;
  result: MicAssessmentRunResult;
}

function buildSummaryText(result: MicAssessmentRunResult): string {
  const { summary, firstDivergence, recovery, tonalState } = result.assessment;
  if (summary.targetNoteCount > 0 && summary.pitchCorrectCount === summary.targetNoteCount) {
    return 'Matched the full melody pattern correctly.';
  }
  if (
    tonalState.kind === 'recentered_new_tonic' &&
    tonalState.structuralConsistency.stronglyConsistent
  ) {
    return 'Shifted into a new key center but stayed structurally consistent.';
  }
  if (firstDivergence) {
    const start = `Started correctly, then diverged on note ${firstDivergence.noteIndex + 1}.`;
    if (recovery.kind && recovery.kind !== 'no_recovery') {
      return `${start} Recovered later in the phrase.`;
    }
    return start;
  }
  return 'Assessment completed with a mix of correct and incorrect notes.';
}

function buildLogPayload(input: SaveAssessmentLogInput) {
  const weighted = buildWeightedAssessmentSummary(input.result);
  const noteDetails = input.result.assessment.notes.map((note, index) => {
    const segmented = input.result.segmentedNotes[index];
    return {
      index,
      expectedPitch: note.target?.pitch ?? segmented?.expectedPitch ?? null,
      detectedPitch: note.performed?.pitch ?? (typeof segmented?.midi === 'number' ? `MIDI ${segmented.midi}` : null),
      matchKind: note.matchKind,
      semitoneDelta: note.semitoneDelta,
      weightedState: classifyWeightedAssessmentNoteState(note, segmented),
      weightedScore: getWeightedAssessmentNoteScore(note, segmented),
      confidence: segmented?.confidence ?? null,
      noteStatus: segmented?.status ?? null,
      targetConsistentAmbiguity: segmented?.targetConsistentAmbiguity === true,
    };
  });

  return {
    teacher_id: input.teacherId ?? input.authUserId ?? null,
    class_id: input.classId ?? null,
    folder_id: input.folderId ?? null,
    student_id: input.studentId ?? null,
    assignment_id: input.assignmentId ?? null,
    exercise_id: input.exerciseId ?? null,
    exercise_title: input.exerciseTitle,
    seed: input.seed ?? null,
    assessment_mode: input.result.comparisonMode,
    weighted_score: Number(weighted.totalScore.toFixed(2)),
    total_possible: weighted.totalPossible,
    percent: weighted.percentage,
    correct_count: weighted.counts.correct,
    ambiguous_count: weighted.counts.ambiguous,
    low_confidence_count: weighted.counts.low_confidence,
    incorrect_count: weighted.counts.incorrect,
    recovery_kind: input.result.assessment.recovery.kind,
    tonal_state_kind: input.result.assessment.tonalState.kind,
    signal_quality_level: input.result.signalQuality.level,
    signal_quality_score: Number(input.result.signalQuality.score.toFixed(3)),
    summary_text: buildSummaryText(input.result),
    note_details: noteDetails,
    summary_json: {
      scores: input.result.assessment.scores,
      rhythm: input.result.assessment.rhythm,
      validity: input.result.assessment.validity,
      warnings: input.result.warnings,
      firstDivergence: input.result.assessment.firstDivergence,
      signalQuality: input.result.signalQuality,
    },
  };
}

function saveGuestAssessmentLogLocally(payload: Record<string, unknown>): string {
  if (typeof window === 'undefined') {
    return 'guest-local';
  }
  const existing = window.localStorage.getItem(LOCAL_GUEST_LOGS_KEY);
  const logs = existing ? (JSON.parse(existing) as Array<Record<string, unknown>>) : [];
  const id = `guest-${Date.now()}`;
  logs.unshift({
    id,
    created_at: new Date().toISOString(),
    ...payload,
  });
  window.localStorage.setItem(LOCAL_GUEST_LOGS_KEY, JSON.stringify(logs.slice(0, 25)));
  return id;
}

export async function saveAssessmentLog(input: SaveAssessmentLogInput): Promise<string | null> {
  const payload = buildLogPayload(input);

  if (!input.studentToken && !input.authUserId) {
    return saveGuestAssessmentLogLocally(payload);
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) {
    return saveGuestAssessmentLogLocally(payload);
  }

  let authorization = `Bearer ${anonKey}`;
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (accessToken) {
    authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/save_assessment_log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: authorization,
    },
    body: JSON.stringify({
      token: input.studentToken ?? null,
      ...payload,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    id?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(body.error || 'Unable to save assessment log.');
  }

  return typeof body.id === 'string' ? body.id : null;
}

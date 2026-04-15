import type { AssessmentComparisonMode } from '@/SightLine/domain/assessment';
import type { MelodyEvent } from '@/SightLine/domain/music';
import type { CalibrationProfile } from '@/SightLine/core/calibration/types';
import { alignPerformedToTarget } from '../audio/alignPerformedToTarget';
import { detectPitchFrames } from '../audio/detectPitchFrames';
import { segmentPerformedMelody } from '../audio/segmentPerformedMelody';
import type { MicAssessmentRunResult } from '../audio/types';
import { evaluateMelodyAssessment } from './evaluateMelodyAssessment';
import { buildAssessmentScoreSummary } from '../assessmentLogs/scoring';

interface RunMicAssessmentInput {
  audioBlob: Blob;
  targetMelody: MelodyEvent[];
  mode: AssessmentComparisonMode;
  calibrationProfile?: CalibrationProfile | null;
}

function buildSignalQualitySummary(
  frames: MicAssessmentRunResult['frames'],
  cleanedFrames: MicAssessmentRunResult['cleanedFrames'],
  segmentedNotes: MicAssessmentRunResult['segmentedNotes']
): MicAssessmentRunResult['signalQuality'] {
  const rejectedFrames = cleanedFrames.filter((frame) => frame.rejectedReason !== null);
  const rejectedForNoiseCount = cleanedFrames.filter((frame) => frame.rejectedReason === 'noise_floor').length;
  const ambiguousWindowCount = segmentedNotes.filter((note) => note.status === 'ambiguous').length;
  const targetConsistentAmbiguousCount = segmentedNotes.filter(
    (note) => note.status === 'ambiguous' && note.targetConsistentAmbiguity
  ).length;
  const onsetAdjustedWindowCount = segmentedNotes.filter(
    (note) => note.phraseInitialAdjusted || note.onsetAdjusted
  ).length;
  const voicedFrames = frames.filter((frame) => frame.midi !== null);
  const cleanedVoicedFrames = cleanedFrames.filter((frame) => frame.cleanedMidi !== null);
  const voicedRetention =
    voicedFrames.length > 0 ? cleanedVoicedFrames.length / voicedFrames.length : 0;
  const ambiguityPenalty = ambiguousWindowCount / Math.max(1, segmentedNotes.length);
  const score = Math.max(
    0,
    Math.min(1, voicedRetention * 0.55 + (1 - ambiguityPenalty) * 0.3 + (1 - rejectedForNoiseCount / Math.max(1, frames.length)) * 0.15)
  );

  const level = score >= 0.78 ? 'high' : score >= 0.55 ? 'medium' : 'low';
  const summary =
    level === 'high'
      ? 'Input quality looked stable overall.'
      : level === 'medium'
        ? 'Input quality was usable, but some noise or unstable onsets may have affected the result. Try singing with more breath energy.'
        : 'Input quality was limited by noise or unstable pitch support, so assessment confidence is lower. Try singing with more breath energy.';

  return {
    level,
    score,
    rejectedFrameCount: rejectedFrames.length,
    rejectedForNoiseCount,
    ambiguousWindowCount,
    targetConsistentAmbiguousCount,
    onsetAdjustedWindowCount,
    summary,
  };
}

function isWeakWindowCandidate(note: MicAssessmentRunResult['segmentedNotes'][number] | undefined): boolean {
  if (!note || note.midi === null) {
    return false;
  }

  const spread = note.stablePitchSpread ?? note.pitchSpread ?? 0;
  return (
    note.status === 'weak' ||
    note.status === 'ambiguous' ||
    note.targetConsistentAmbiguity ||
    note.usedFrameCount <= 1 ||
    note.confidence < 0.5 ||
    (note.usedFrameCount <= 2 && note.confidence < 0.64) ||
    (note.usedFrameCount <= 2 && spread > 1.1)
  );
}

function applyWeakWindowInterpretation(
  assessment: MicAssessmentRunResult['assessment'],
  segmentedNotes: MicAssessmentRunResult['segmentedNotes'],
): MicAssessmentRunResult['assessment'] {
  const notes = assessment.notes.map((note) => ({ ...note }));

  notes.forEach((note, index) => {
    if (note.correctnessLocked || note.absDelta === 0) {
      note.displayState = 'correct';
      note.weakWindowProtectionApplied = false;
      note.isolatedErrorSoftened = false;
      note.interpretationReason = null;
      return;
    }

    if (note.matchKind === 'near') {
      note.displayState = 'near';
      return;
    }

    if (note.displayState === 'transposed_consistent') {
      note.weakWindowProtectionApplied = false;
      note.isolatedErrorSoftened = false;
      return;
    }

    const segmented = segmentedNotes[index];
    const weakWindow =
      (note.absDelta ?? Number.POSITIVE_INFINITY) >= 1 &&
      isWeakWindowCandidate(segmented);
    const previousCorrect = notes[index - 1]?.isCorrect === true;
    const nextCorrect = notes[index + 1]?.isCorrect === true;
    const isolatedWeakMiss =
      weakWindow &&
      previousCorrect &&
      nextCorrect &&
      (assessment.summary.globalRelationship === 'exact_match' ||
        assessment.summary.globalRelationship === 'octave_shifted' ||
        assessment.summary.globalRelationship === 'globally_transposed');

    if (weakWindow) {
      note.displayState =
        segmented?.status === 'weak' ||
        segmented?.usedFrameCount <= 1 ||
        (segmented?.confidence ?? 1) < 0.5
          ? 'low_confidence'
          : 'ambiguous';
      note.weakWindowProtectionApplied = true;
      note.interpretationReason =
        segmented?.status === 'weak'
          ? 'Window had too little stable evidence to score as a hard pitch miss.'
          : 'Window evidence was unstable, so the miss was softened instead of treated as fully incorrect.';
    }

    if (isolatedWeakMiss) {
      note.displayState =
        (segmented?.confidence ?? 1) < 0.58 || (segmented?.usedFrameCount ?? 99) <= 1
          ? 'low_confidence'
          : 'ambiguous';
      note.weakWindowProtectionApplied = true;
      note.isolatedErrorSoftened = true;
      note.interpretationReason =
        'This isolated miss sat inside an otherwise consistent phrase, and the note window was too weak to treat as a definite error.';
    }
  });

  return {
    ...assessment,
    notes,
  };
}

function contourRecognizable(
  assessment: MicAssessmentRunResult['assessment']
): boolean {
  const contourTotal =
    assessment.summary.contourCorrectCount + assessment.summary.contourIncorrectCount;
  if (assessment.summary.contourFullyCorrect) {
    return true;
  }
  return contourTotal > 0
    ? assessment.summary.contourCorrectCount / contourTotal >= 0.6
    : false;
}

function buildPerformanceValidity(
  assessment: MicAssessmentRunResult['assessment'],
  segmentedNotes: MicAssessmentRunResult['segmentedNotes']
): MicAssessmentRunResult['assessment']['validity'] {
  const targetNotes = Math.max(1, assessment.summary.targetNoteCount);
  const usableDetectedNotes = segmentedNotes.filter(
    (note) => note.midi !== null && note.status !== 'missing'
  ).length;
  const unstableWindowCount = segmentedNotes.filter(
    (note) =>
      note.status === 'missing' ||
      note.status === 'weak' ||
      note.status === 'ambiguous' ||
      note.confidence < 0.5
  ).length;
  const coverage = usableDetectedNotes / targetNotes;
  const weakRatio = unstableWindowCount / targetNotes;
  const contourIsRecognizable = contourRecognizable(assessment);
  const flowScore = assessment.rhythm.flow.score;
  const comparableRhythmSpanCount = assessment.rhythm.accuracy.comparableSpanCount;

  const flags = {
    lowCoverage: coverage < 0.6,
    unstableInput: weakRatio > 0.5,
    unrecognizableContour: !contourIsRecognizable,
    brokenFlow: flowScore < 0.4,
    sparseRhythmEvidence:
      comparableRhythmSpanCount < Math.max(2, Math.ceil(Math.max(0, targetNotes - 1) * 0.4)),
  };

  const triggered = Object.entries(flags)
    .filter(([, value]) => value)
    .map(([key]) => key);

  const isValid = triggered.length < 2;

  let reason = 'The recording contained enough stable musical information to assess normally.';
  if (!isValid) {
    if (flags.unrecognizableContour && flags.lowCoverage) {
      reason = 'We could not clearly detect a full, recognizable melody in this recording.';
    } else if (flags.unrecognizableContour && flags.unstableInput) {
      reason = 'The recording did not contain enough stable notes to hear a clear melody shape.';
    } else if (flags.brokenFlow && flags.sparseRhythmEvidence) {
      reason = 'The phrase was too broken up to assess as a clear musical attempt.';
    } else {
      reason = 'We could not clearly detect a consistent melody from this recording.';
    }
  }

  return {
    isValid,
    coverage: Number(coverage.toFixed(3)),
    weakRatio: Number(weakRatio.toFixed(3)),
    contourRecognizable: contourIsRecognizable,
    flowScore: Number(flowScore.toFixed(3)),
    comparableRhythmSpanCount,
    reason,
  };
}

function applyValidityGate(
  assessment: MicAssessmentRunResult['assessment'],
  validity: MicAssessmentRunResult['assessment']['validity']
): MicAssessmentRunResult['assessment'] {
  if (validity.isValid) {
    return {
      ...assessment,
      validity,
    };
  }

  const cappedScores = {
    pitchScore: Math.min(assessment.scores.pitchScore, 45),
    rhythmScore: Math.min(assessment.scores.rhythmScore, 45),
    melodicScore: Math.min(assessment.scores.melodicScore, 40),
  };

  return {
    ...assessment,
    scores: cappedScores,
    validity,
  };
}

export async function runMicAssessment(
  input: RunMicAssessmentInput
): Promise<MicAssessmentRunResult> {
  if (input.targetMelody.length === 0) {
    throw new Error('Generate a melody before running an assessment.');
  }

  const frames = await detectPitchFrames(input.audioBlob);
  const voicedFrames = frames.filter((frame) => frame.midi !== null && frame.confidence >= 0.45);

  if (voicedFrames.length < 6) {
    throw new Error("I couldn't detect enough stable pitch information. Try again in a quieter space.");
  }

  const effectiveCalibrationOffset =
    input.calibrationProfile?.successful &&
    input.calibrationProfile.signalQuality !== 'poor' &&
    typeof input.calibrationProfile.tonicOffsetSemitones === 'number'
      ? input.calibrationProfile.tonicOffsetSemitones
      : null;
  const usableCalibrationProfile =
    input.calibrationProfile?.successful &&
    input.calibrationProfile.signalQuality !== 'poor'
      ? input.calibrationProfile
      : null;
  const { cleanedFrames, segmentedNotes } = segmentPerformedMelody(frames, input.targetMelody, {
    expectedMidiOffset: effectiveCalibrationOffset,
    calibrationProfile: usableCalibrationProfile,
  });

  if (segmentedNotes.length === 0) {
    throw new Error("I couldn't segment any stable sung notes from that recording.");
  }

  const { alignedMelody, targetIndices } = alignPerformedToTarget(segmentedNotes, input.targetMelody);

  if (alignedMelody.length === 0) {
    throw new Error('No performed melody could be aligned to the target phrase.');
  }

  const warnings: string[] = [];
  const detectedNoteCount = segmentedNotes.filter((note) => note.midi !== null).length;
  const missingWindowCount = segmentedNotes.filter((note) => note.status === 'missing').length;

  if (detectedNoteCount < Math.max(2, Math.ceil(input.targetMelody.length / 2))) {
    warnings.push('Only a partial melody was detected, so this assessment may be incomplete.');
  }
  if (missingWindowCount > 0) {
    warnings.push(`${missingWindowCount} target note window${missingWindowCount === 1 ? '' : 's'} had weak or missing pitch evidence.`);
  }
  if (Math.abs(detectedNoteCount - input.targetMelody.length) >= 2) {
    warnings.push('Detected note count still differs noticeably from the target phrase.');
  }
  const signalQuality = buildSignalQualitySummary(frames, cleanedFrames, segmentedNotes);
  if (signalQuality.level !== 'high') {
    warnings.push(signalQuality.summary);
  }
  if (usableCalibrationProfile) {
    warnings.push('Full-scale calibration was used as a soft listening guide for this assessment.');
  }

  const rawAssessment = evaluateMelodyAssessment({
    targetMelody: input.targetMelody,
    performedMelody: alignedMelody,
    performedDurationsMs: segmentedNotes.map((note) =>
      note.midi !== null && note.durationMs > 0 ? note.durationMs : null
    ),
    performedStartsMs: segmentedNotes.map((note) =>
      note.midi !== null ? note.startMs : null
    ),
    performedEndsMs: segmentedNotes.map((note) =>
      note.midi !== null ? note.endMs : null
    ),
    performedWindowStatuses: segmentedNotes.map((note) => note.status),
    mode: input.mode,
    calibrationOffsetHint: effectiveCalibrationOffset,
    calibrationSignalQuality: input.calibrationProfile?.signalQuality ?? null,
  });
  const interpretedAssessment = applyWeakWindowInterpretation(
    rawAssessment,
    segmentedNotes,
  );
  const scoredAssessment = {
    ...interpretedAssessment,
    scores: buildAssessmentScoreSummary({
      assessment: interpretedAssessment,
      segmentedNotes,
    }),
  };
  const validity = buildPerformanceValidity(scoredAssessment, segmentedNotes);
  const finalizedAssessment = applyValidityGate(scoredAssessment, validity);
  if (
    finalizedAssessment.globalOffsetCorrection.applied &&
    finalizedAssessment.globalOffsetCorrection.candidateOffset !== null
  ) {
    warnings.push(
      `A phrase-level pitch offset of ${finalizedAssessment.globalOffsetCorrection.candidateOffset > 0 ? '+' : ''}${finalizedAssessment.globalOffsetCorrection.candidateOffset} semitone${Math.abs(finalizedAssessment.globalOffsetCorrection.candidateOffset) === 1 ? '' : 's'} was applied as a soft correction.`
    );
  }
  if (!finalizedAssessment.validity.isValid) {
    warnings.push(finalizedAssessment.validity.reason);
    warnings.push('Try singing the full phrase clearly and steadily for a more accurate assessment.');
  }

  return {
    frames,
    cleanedFrames,
    segmentedNotes,
    alignedTargetIndices: targetIndices,
    performedMelody: alignedMelody,
    assessment: finalizedAssessment,
    warnings,
    signalQuality,
    comparisonMode: input.mode,
    calibrationProfileUsed: usableCalibrationProfile,
  };
}

import type { ExpectedMelody, IntakeRequest } from "./types";
import {
  intakeService,
  keyDetectionService,
  pitchExtractionService,
  signalCleaningService,
  noteSegmentationService,
  normalizationAlignmentService,
  relationalAnalysisService,
  scoringFeedbackService,
} from "./services";

export interface RunAssessmentInput extends IntakeRequest {
  expectedMelody: ExpectedMelody;
}

export async function runAssessment(input: RunAssessmentInput) {
  const intake = await intakeService.run({
    exerciseId: input.exerciseId,
  });

  const key = await keyDetectionService.run({
    scaleAudio: intake.scaleAudio,
  });

  const pitch = await pitchExtractionService.run({
    melodyAudio: intake.melodyAudio,
    frameSize: 2048,
    hopSize: 256,
  });

  const cleaned = signalCleaningService.run({
    frames: pitch.frames,
    clarityThreshold: 0.8,
    smoothingWindowSize: 5,
  });

  const notes = noteSegmentationService.run({
    frames: cleaned.frames,
    minNoteDurationMs: 40,
  });

  const normalized = normalizationAlignmentService.run({
    tonic: key.tonic,
    expectedMelody: input.expectedMelody,
    actualNotes: notes.noteEvents,
  });

  const analysis = relationalAnalysisService.run({
    tonic: key.tonic,
    expectedNotes: normalized.expectedNotes,
    actualNotes: normalized.actualNotes,
    alignedPairs: normalized.alignedPairs,
    expectedIntervals: normalized.expectedIntervals,
    actualIntervals: normalized.actualIntervals,
    windows: [],
  });

  const scoring = scoringFeedbackService.run({
    exerciseId: input.exerciseId,
    findings: analysis.findings,
    analysisConfidence: analysis.analysisConfidence,
  });

  return {
    intake,
    key,
    pitch,
    cleaned,
    notes,
    normalized,
    analysis,
    scoring,
  };
}

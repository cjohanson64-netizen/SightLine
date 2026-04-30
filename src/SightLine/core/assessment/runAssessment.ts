import type {
  CleanPitchFrame,
  DetectedTonic,
  ExpectedMelody,
  ExpectedRhythm,
  IntakeRequest,
  PcmAudioBuffer,
  RawPitchFrame,
} from "./types";
import {
  noteSegmentationService,
  normalizationAlignmentService,
  pitchExtractionService,
  relationalAnalysisService,
  rhythmGuidedSegmentationService,
  rhythmAnalysisService,
  scoringFeedbackService,
  signalCleaningService,
} from "./services";

export interface RunAssessmentInput extends IntakeRequest {
  expectedMelody: ExpectedMelody;
  expectedRhythm?: ExpectedRhythm;
  tonic?: DetectedTonic;
  melodyAudio?: PcmAudioBuffer;
  pitchFrames?: RawPitchFrame[];
  cleanFrames?: CleanPitchFrame[];
  enableRhythmAnalysis?: boolean;
}

function fallbackTonicFromExpectedMelody(
  expectedMelody: ExpectedMelody,
): DetectedTonic {
  const tonicMidi = expectedMelody.notes[0]?.writtenMidi ?? 60;
  const tonicPitchClass = ((tonicMidi % 12) + 12) % 12;

  return {
    tonicHz: 0,
    tonicMidi,
    tonicPitchClass,
    tonicNoteName: expectedMelody.notes[0]?.writtenNoteName ?? "C4",
    confidence: 0,
  };
}

async function getPitchFrames(
  input: RunAssessmentInput,
): Promise<RawPitchFrame[]> {
  if (input.pitchFrames) {
    return input.pitchFrames;
  }

  if (!input.melodyAudio) {
    return [];
  }

  const pitch = await pitchExtractionService.run({
    melodyAudio: input.melodyAudio,
    frameSize: 2048,
    hopSize: 256,
    clarityThreshold: 0.8,
  });

  return pitch.frames;
}

function getCleanFrames(
  input: RunAssessmentInput,
  pitchFrames: RawPitchFrame[],
): CleanPitchFrame[] {
  if (input.cleanFrames) {
    return input.cleanFrames;
  }

  return signalCleaningService.run({
    frames: pitchFrames,
    clarityThreshold: 0.8,
    smoothingWindowSize: 5,
  }).frames;
}

export async function runAssessment(input: RunAssessmentInput) {
  const tonic =
    input.tonic ?? fallbackTonicFromExpectedMelody(input.expectedMelody);
  const pitchFrames = await getPitchFrames(input);
  const cleanFrames = getCleanFrames(input, pitchFrames);

  const pitchNotes = input.expectedRhythm
    ? rhythmGuidedSegmentationService.run({
        frames: cleanFrames,
        expectedRhythm: input.expectedRhythm,
        minFrameClarity: 0.75,
      })
    : noteSegmentationService.run({
        frames: cleanFrames,
        minNoteDurationMs: 40,
      });
  const rhythmNotes = noteSegmentationService.run({
    frames: cleanFrames,
    minNoteDurationMs: 40,
    tonicPitchClass: tonic.tonicPitchClass,
  });

  const normalized = normalizationAlignmentService.run({
    tonic,
    expectedMelody: input.expectedMelody,
    actualNotes: pitchNotes.noteEvents,
  });

  const analysis = relationalAnalysisService.run({
    tonic,
    expectedNotes: normalized.expectedNotes,
    actualNotes: normalized.actualNotes,
    alignedPairs: normalized.alignedPairs,
    expectedIntervals: normalized.expectedIntervals,
    actualIntervals: normalized.actualIntervals,
    windows: [],
  });

  const rhythmAnalysis =
    input.enableRhythmAnalysis && input.expectedRhythm
      ? (() => {
          const rhythmStructureReliable =
            rhythmNotes.noteEvents.length === input.expectedMelody.notes.length;
          const rhythmStructureReason = rhythmStructureReliable
            ? undefined
            : "Rhythm could not be reliably assessed because detected note events did not match expected note count.";

          return rhythmAnalysisService.run({
            expectedRhythm: input.expectedRhythm,
            actualEvents: rhythmNotes.noteEvents,
            melodicConfidence: analysis.analysisConfidence,
            melodicIsReliable: rhythmStructureReliable,
            melodicStructureReliable: rhythmStructureReliable,
            melodicStructureReason: rhythmStructureReason,
          });
        })()
      : null;

  const scoring = scoringFeedbackService.run({
    exerciseId: input.exerciseId,
    findings: analysis.findings,
    analysisConfidence: analysis.analysisConfidence,
  });

  return {
    key: { tonic },
    pitch: { frames: pitchFrames },
    cleaned: { frames: cleanFrames },
    notes: pitchNotes,
    pitchNotes,
    rhythmNotes,
    normalized,
    analysis,
    rhythmAnalysis,
    scoring,
  };
}

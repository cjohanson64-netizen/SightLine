import type {
  CleanPitchFrame,
  DetectedTonic,
  ExpectedMelody,
  ExpectedRhythm,
  IntakeRequest,
  PcmAudioBuffer,
  RawPitchFrame,
  SungNoteEvent,
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

function getRhythmDurationsMs(events: SungNoteEvent[]): number[] {
  return events.map((event, index) => {
    const next = events[index + 1];

    return next
      ? Math.max(0, next.startMs - event.startMs)
      : Math.max(0, event.endMs - event.startMs);
  });
}

function mergeRhythmEventGroup(
  events: SungNoteEvent[],
  groupIndex: number,
): SungNoteEvent {
  const first = events[0];
  const last = events[events.length - 1];
  const durationMs = Math.max(0, last.endMs - first.startMs);
  const confidence =
    events.reduce((total, event) => total + event.confidence, 0) /
    events.length;

  return {
    id: `rhythm-${groupIndex}`,
    startMs: first.startMs,
    endMs: last.endMs,
    durationMs,
    pitchHz: first.pitchHz,
    midiFloat: first.midiFloat,
    confidence,
  };
}

function findBestRhythmPartition(params: {
  durationsMs: number[];
  expectedUnits: number[];
}): number[] | null {
  const { durationsMs, expectedUnits } = params;
  const actualCount = durationsMs.length;
  const expectedCount = expectedUnits.length;

  if (actualCount < expectedCount) {
    return null;
  }

  const totalDurationMs = durationsMs.reduce((total, value) => total + value, 0);
  const totalExpectedUnits = expectedUnits.reduce(
    (total, value) => total + value,
    0,
  );
  const tempoMsPerUnit =
    totalExpectedUnits > 0 ? totalDurationMs / totalExpectedUnits : 0;

  if (tempoMsPerUnit <= 0) {
    return null;
  }

  const prefixSums = [0];

  for (const durationMs of durationsMs) {
    prefixSums.push(prefixSums[prefixSums.length - 1] + durationMs);
  }

  const memo = new Map<string, { cost: number; ends: number[] } | null>();

  function solve(
    expectedIndex: number,
    actualStartIndex: number,
  ): { cost: number; ends: number[] } | null {
    const key = `${expectedIndex}:${actualStartIndex}`;
    const cached = memo.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const remainingExpected = expectedCount - expectedIndex;
    const remainingActual = actualCount - actualStartIndex;

    if (remainingExpected === 0) {
      const result =
        remainingActual === 0 ? { cost: 0, ends: [] } : null;
      memo.set(key, result);
      return result;
    }

    if (remainingActual < remainingExpected) {
      memo.set(key, null);
      return null;
    }

    const maxEndIndex = actualCount - (remainingExpected - 1);
    const expectedMs = expectedUnits[expectedIndex] * tempoMsPerUnit;
    let best: { cost: number; ends: number[] } | null = null;

    for (
      let actualEndIndex = actualStartIndex + 1;
      actualEndIndex <= maxEndIndex;
      actualEndIndex += 1
    ) {
      const actualMs =
        prefixSums[actualEndIndex] - prefixSums[actualStartIndex];
      const deviationCost =
        expectedMs > 0 ? Math.abs(actualMs - expectedMs) / expectedMs : 1;
      const splitPenalty =
        actualEndIndex - actualStartIndex > 1 ? 0.04 : 0;
      const rest = solve(expectedIndex + 1, actualEndIndex);

      if (!rest) {
        continue;
      }

      const cost = deviationCost + splitPenalty + rest.cost;

      if (!best || cost < best.cost) {
        best = {
          cost,
          ends: [actualEndIndex, ...rest.ends],
        };
      }
    }

    memo.set(key, best);
    return best;
  }

  return solve(0, 0)?.ends ?? null;
}

function coalesceRhythmEventsToExpectedCount(params: {
  events: SungNoteEvent[];
  expectedRhythm: ExpectedRhythm;
}): SungNoteEvent[] {
  const { events, expectedRhythm } = params;
  const expectedCount = expectedRhythm.units.length;

  if (events.length <= expectedCount || expectedCount === 0) {
    return events;
  }

  const partition = findBestRhythmPartition({
    durationsMs: getRhythmDurationsMs(events),
    expectedUnits: expectedRhythm.units,
  });

  if (!partition) {
    return events;
  }

  const mergedEvents: SungNoteEvent[] = [];
  let startIndex = 0;

  partition.forEach((endIndex, groupIndex) => {
    mergedEvents.push(
      mergeRhythmEventGroup(events.slice(startIndex, endIndex), groupIndex),
    );
    startIndex = endIndex;
  });

  return mergedEvents;
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
  const rhythmAnalysisNotes = input.expectedRhythm
    ? {
        noteEvents: coalesceRhythmEventsToExpectedCount({
          events: rhythmNotes.noteEvents,
          expectedRhythm: input.expectedRhythm,
        }),
      }
    : rhythmNotes;

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
          const expectedNoteCount = input.expectedMelody.notes.length;
          const rhythmNoteCount = rhythmAnalysisNotes.noteEvents.length;
          const rhythmStructureReliable = rhythmNoteCount >= expectedNoteCount;
          const rhythmStructureReason = rhythmStructureReliable
            ? undefined
            : "Rhythm could not be reliably assessed because detected note events did not match expected note count.";

          return rhythmAnalysisService.run({
            expectedRhythm: input.expectedRhythm,
            actualEvents: rhythmAnalysisNotes.noteEvents,
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
    rhythmAnalysisNotes,
    normalized,
    analysis,
    rhythmAnalysis,
    scoring,
  };
}

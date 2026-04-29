import type { CleanPitchFrame, SungNoteEvent } from "../../types";
import { frequencyToMidiFloat } from "../pitchMath";
import { average, median } from "./mathUtils";
import { getRepresentativeFrames, isStableFrame } from "./frameUtils";

export type NoteEventCandidate = {
  noteEvent: SungNoteEvent;
  spanFrames: CleanPitchFrame[];
  stableFrameCount: number;
  stableCoverageRatio: number;
  averageStableClarity: number;
};

export function getSpanFrames(
  frames: CleanPitchFrame[],
  onsetIndices: number[],
  onsetIndexPosition: number,
): CleanPitchFrame[] {
  const start = onsetIndices[onsetIndexPosition];
  const end =
    onsetIndexPosition + 1 < onsetIndices.length
      ? onsetIndices[onsetIndexPosition + 1]
      : frames.length;

  return frames.slice(start, end);
}

function buildNoteEvent(
  spanFrames: CleanPitchFrame[],
  explicitEndMs: number,
  index: number,
): SungNoteEvent | null {
  if (spanFrames.length === 0) {
    return null;
  }

  const representativeFrames = getRepresentativeFrames(spanFrames);
  const pitchHz = median(
    representativeFrames.map((frame) => frame.stablePitchHz),
  );

  if (!Number.isFinite(pitchHz) || pitchHz <= 0) {
    return null;
  }

  const startMs = spanFrames[0].timeMs;
  const endMs = explicitEndMs;
  const durationMs = Math.max(0, endMs - startMs);

  return {
    id: `o${index + 1}`,
    startMs,
    endMs,
    durationMs,
    pitchHz,
    midiFloat: frequencyToMidiFloat(pitchHz),
    confidence: average(representativeFrames.map((frame) => frame.clarity)),
  };
}

export function buildNoteEventCandidate(
  spanFrames: CleanPitchFrame[],
  explicitEndMs: number,
  index: number,
): NoteEventCandidate | null {
  const noteEvent = buildNoteEvent(spanFrames, explicitEndMs, index);

  if (!noteEvent) {
    return null;
  }

  const stableFrames = spanFrames.filter(isStableFrame);

  return {
    noteEvent,
    spanFrames,
    stableFrameCount: stableFrames.length,
    stableCoverageRatio:
      spanFrames.length > 0 ? stableFrames.length / spanFrames.length : 0,
    averageStableClarity:
      stableFrames.length > 0
        ? average(stableFrames.map((frame) => frame.clarity))
        : 0,
  };
}

export function buildNoteEventCandidatesFromSpans(
  spans: CleanPitchFrame[][],
  finalEndMs: number,
  indexOffset: number,
): NoteEventCandidate[] {
  if (spans.length === 0) {
    return [];
  }

  const candidates: NoteEventCandidate[] = [];

  for (let index = 0; index < spans.length; index += 1) {
    const spanFrames = spans[index];
    const explicitEndMs =
      index + 1 < spans.length ? spans[index + 1][0].timeMs : finalEndMs;
    const candidate = buildNoteEventCandidate(
      spanFrames,
      explicitEndMs,
      indexOffset + index,
    );

    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

export function buildNoteEventCandidatesFromOnsets({
  frames,
  onsetIndices,
  finalEndMs,
}: {
  frames: CleanPitchFrame[];
  onsetIndices: number[];
  finalEndMs: number;
}): NoteEventCandidate[] {
  return onsetIndices
    .map((_, onsetIndexPosition) => {
      const spanFrames = getSpanFrames(
        frames,
        onsetIndices,
        onsetIndexPosition,
      );

      const explicitEndMs =
        onsetIndexPosition + 1 < onsetIndices.length
          ? frames[onsetIndices[onsetIndexPosition + 1]].timeMs
          : finalEndMs;

      return buildNoteEventCandidate(
        spanFrames,
        explicitEndMs,
        onsetIndexPosition,
      );
    })
    .filter(
      (candidate): candidate is NoteEventCandidate => candidate !== null,
    );
}
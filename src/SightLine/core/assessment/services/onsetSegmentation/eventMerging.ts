import type { SungNoteEvent } from "../../types";
import { average } from "./mathUtils";
import { frequencyToMidiFloat } from "../pitchMath";

export function reattachTrailingShortEvent(noteEvents: SungNoteEvent[]) {
  if (noteEvents.length < 2) {
    return { noteEvents, trailingReattachmentCount: 0 };
  }

  const trailing = noteEvents[noteEvents.length - 1];
  const previous = noteEvents[noteEvents.length - 2];

  if (trailing.durationMs > 180 || previous.durationMs < 320) {
    return { noteEvents, trailingReattachmentCount: 0 };
  }

  const merged: SungNoteEvent = {
    ...previous,
    endMs: trailing.endMs,
    durationMs: trailing.endMs - previous.startMs,
    pitchHz: weightedPitch(previous, trailing),
    midiFloat: frequencyToMidiFloat(weightedPitch(previous, trailing)),
    confidence: weightedConfidence(previous, trailing),
  };

  return {
    noteEvents: [...noteEvents.slice(0, -2), merged],
    trailingReattachmentCount: 1,
  };
}

function weightedPitch(a: SungNoteEvent, b: SungNoteEvent) {
  const total = a.durationMs + b.durationMs;
  return total > 0
    ? (a.pitchHz * a.durationMs + b.pitchHz * b.durationMs) / total
    : average([a.pitchHz, b.pitchHz]);
}

function weightedConfidence(a: SungNoteEvent, b: SungNoteEvent) {
  const total = a.durationMs + b.durationMs;
  return total > 0
    ? (a.confidence * a.durationMs + b.confidence * b.durationMs) / total
    : average([a.confidence, b.confidence]);
}

export function mergeAdjacentSamePitchEvents(
  noteEvents: SungNoteEvent[]
): SungNoteEvent[] {
  if (noteEvents.length < 2) return noteEvents;

  const result: SungNoteEvent[] = [];

  for (const current of noteEvents) {
    const prev = result[result.length - 1];

    if (prev && Math.abs(prev.midiFloat - current.midiFloat) < 0.5) {
      const mergedDuration = current.endMs - prev.startMs;

      result[result.length - 1] = {
        ...prev,
        endMs: current.endMs,
        durationMs: mergedDuration,
        pitchHz: weightedPitch(prev, current),
        midiFloat: frequencyToMidiFloat(weightedPitch(prev, current)),
        confidence: Math.max(prev.confidence, current.confidence),
      };
    } else {
      result.push(current);
    }
  }

  return result.map((e, i) => ({ ...e, id: `o${i + 1}` }));
}

export function softlyMergeTowardExpectedCount(
  noteEvents: SungNoteEvent[],
  expected?: number
): SungNoteEvent[] {
  if (!expected || noteEvents.length <= expected) return noteEvents;

  const result = [...noteEvents];

  while (result.length > expected) {
    let bestIndex = -1;
    let bestScore = Infinity;

    for (let i = 0; i < result.length - 1; i++) {
      const a = result[i];
      const b = result[i + 1];

      const pitchDistance = Math.abs(a.midiFloat - b.midiFloat);
      const score = pitchDistance * 100 + a.durationMs + b.durationMs;

      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) break;

    const a = result[bestIndex];
    const b = result[bestIndex + 1];

    result.splice(bestIndex, 2, {
      ...a,
      endMs: b.endMs,
      durationMs: b.endMs - a.startMs,
      pitchHz: weightedPitch(a, b),
      midiFloat: frequencyToMidiFloat(weightedPitch(a, b)),
      confidence: weightedConfidence(a, b),
    });
  }

  return result.map((e, i) => ({ ...e, id: `o${i + 1}` }));
}
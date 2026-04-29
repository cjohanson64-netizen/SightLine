import type { NoteEventCandidate } from "./candidateBuilder";
import { median } from "./mathUtils";

export function resplitLongCandidates(candidates: NoteEventCandidate[]) {
  if (candidates.length === 0) {
    return { candidates: [], resplitCount: 0, rejectedResplitCount: 0 };
  }

  const medianDuration = median(
    candidates.map((c) => c.noteEvent.durationMs)
  );

  const result: NoteEventCandidate[] = [];
  let resplitCount = 0;
  let rejectedResplitCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    if (!isSuspiciouslyLong(candidate, medianDuration)) {
      result.push(candidate);
      continue;
    }

    const split = attemptSplit(candidate);

    if (!split) {
      result.push(candidate);
      continue;
    }

    if (!isValidSplit(split)) {
      result.push(candidate);
      rejectedResplitCount++;
      continue;
    }

    result.push(...split);
    resplitCount++;
  }

  return { candidates: result, resplitCount, rejectedResplitCount };
}

function isSuspiciouslyLong(
  candidate: NoteEventCandidate,
  medianDuration: number
) {
  return candidate.noteEvent.durationMs > medianDuration * 1.8;
}

function attemptSplit(candidate: NoteEventCandidate) {
  const frames = candidate.spanFrames;

  if (frames.length < 6) return null;

  const mid = Math.floor(frames.length / 2);

  return [
    buildSplitCandidate(candidate, frames.slice(0, mid), 0),
    buildSplitCandidate(candidate, frames.slice(mid), 1),
  ].filter(Boolean) as NoteEventCandidate[];
}

function buildSplitCandidate(
  original: NoteEventCandidate,
  frames: any[],
  offset: number
): NoteEventCandidate | null {
  if (!frames.length) return null;

  return {
    ...original,
    spanFrames: frames,
    noteEvent: {
      ...original.noteEvent,
      id: `${original.noteEvent.id}_${offset}`,
    },
  };
}

function isValidSplit(split: NoteEventCandidate[]) {
  return split.length === 2;
}

export function recoverLongSpanSplits(candidates: NoteEventCandidate[]) {
  // Behavior preserved: currently mirrors original "attempt but fallback" logic
  return {
    candidates,
    resplitCount: 0,
    rejectedResplitCount: 0,
  };
}
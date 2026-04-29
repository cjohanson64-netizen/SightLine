import type { NoteEventCandidate } from "./candidateBuilder";
import {
  HARD_MIN_NOTE_DURATION_MS,
  HARMONIC_SPIKE_NEIGHBOR_DISTANCE_SEMITONES,
  HARMONIC_SPIKE_NEIGHBOR_MATCH_SEMITONES,
  MIN_STABLE_COVERAGE_RATIO,
  MIN_STABLE_FRAMES_PER_EVENT,
  MIN_VALID_NOTE_DURATION_MS,
  MUCH_LONGER_NEIGHBOR_DURATION_MS,
  SPIKE_EVENT_MAX_DURATION_MS,
  SPIKE_NEIGHBOR_DISTANCE_SEMITONES,
  STRONG_SHORT_EVENT_CLARITY,
  TAIL_HIGH_SPIKE_SEMITONES,
  TAIL_OUTLIER_SEMITONES,
  TAIL_REATTACH_MAX_DURATION_MS,
  TAIL_SHORT_EVENT_DURATION_MS,
} from "./constants";
import { median } from "./mathUtils";

export function hasStrongStableSupport(
  candidate: NoteEventCandidate,
): boolean {
  return (
    candidate.stableFrameCount >= 3 &&
    candidate.averageStableClarity >= STRONG_SHORT_EVENT_CLARITY &&
    candidate.stableCoverageRatio >= 0.7
  );
}

function isShortWeakEvent(candidate: NoteEventCandidate): boolean {
  return (
    candidate.noteEvent.durationMs < MIN_VALID_NOTE_DURATION_MS &&
    !hasStrongStableSupport(candidate)
  );
}

function shouldHardSuppressShortEvent(
  previous: NoteEventCandidate | null,
  candidate: NoteEventCandidate,
  next: NoteEventCandidate | null,
): boolean {
  if (candidate.noteEvent.durationMs >= HARD_MIN_NOTE_DURATION_MS) {
    return false;
  }

  if (!hasStrongStableSupport(candidate)) {
    return true;
  }

  const previousIsFar =
    previous !== null &&
    Math.abs(candidate.noteEvent.midiFloat - previous.noteEvent.midiFloat) >=
      HARMONIC_SPIKE_NEIGHBOR_DISTANCE_SEMITONES;

  const nextIsFar =
    next !== null &&
    Math.abs(candidate.noteEvent.midiFloat - next.noteEvent.midiFloat) >=
      HARMONIC_SPIKE_NEIGHBOR_DISTANCE_SEMITONES;

  return previousIsFar && nextIsFar;
}

function lacksStableSupport(candidate: NoteEventCandidate): boolean {
  return (
    candidate.stableFrameCount < MIN_STABLE_FRAMES_PER_EVENT ||
    candidate.stableCoverageRatio < MIN_STABLE_COVERAGE_RATIO
  );
}

function looksLikeHarmonicSpike(
  previous: NoteEventCandidate | null,
  current: NoteEventCandidate,
  next: NoteEventCandidate | null,
): boolean {
  if (!previous || !next || !isShortWeakEvent(current)) {
    return false;
  }

  const distanceToPrevious = Math.abs(
    current.noteEvent.midiFloat - previous.noteEvent.midiFloat,
  );
  const distanceToNext = Math.abs(
    current.noteEvent.midiFloat - next.noteEvent.midiFloat,
  );
  const neighborDistance = Math.abs(
    previous.noteEvent.midiFloat - next.noteEvent.midiFloat,
  );

  return (
    distanceToPrevious >= HARMONIC_SPIKE_NEIGHBOR_DISTANCE_SEMITONES &&
    distanceToNext >= HARMONIC_SPIKE_NEIGHBOR_DISTANCE_SEMITONES &&
    neighborDistance <= HARMONIC_SPIKE_NEIGHBOR_MATCH_SEMITONES
  );
}

export function suppressTinyArtifacts(
  candidates: NoteEventCandidate[],
): NoteEventCandidate[] {
  if (candidates.length === 0) {
    return [];
  }

  return candidates.filter((candidate, index, allCandidates) => {
    const previous = index > 0 ? allCandidates[index - 1] : null;
    const next =
      index < allCandidates.length - 1 ? allCandidates[index + 1] : null;

    if (shouldHardSuppressShortEvent(previous, candidate, next)) {
      return false;
    }

    if (looksLikeHarmonicSpike(previous, candidate, next)) {
      return false;
    }

    if (isShortWeakEvent(candidate) && lacksStableSupport(candidate)) {
      return false;
    }

    if (
      previous &&
      next &&
      candidate.noteEvent.durationMs < MIN_VALID_NOTE_DURATION_MS &&
      previous.noteEvent.durationMs >= MUCH_LONGER_NEIGHBOR_DURATION_MS &&
      next.noteEvent.durationMs >= MUCH_LONGER_NEIGHBOR_DURATION_MS
    ) {
      if (
        lacksStableSupport(candidate) ||
        Math.abs(previous.noteEvent.midiFloat - next.noteEvent.midiFloat) <=
          HARMONIC_SPIKE_NEIGHBOR_MATCH_SEMITONES
      ) {
        return false;
      }
    }

    return true;
  });
}

export function stabilizeTailCandidates(candidates: NoteEventCandidate[]): {
  candidates: NoteEventCandidate[];
  suppressedTailCount: number;
} {
  if (candidates.length <= 3) {
    return { candidates, suppressedTailCount: 0 };
  }

  const stableCandidates = [...candidates];
  let suppressedTailCount = 0;

  for (
    let index = stableCandidates.length - 1;
    index >= Math.max(1, stableCandidates.length - 3);
    index -= 1
  ) {
    const candidate = stableCandidates[index];
    const previous = stableCandidates[index - 1] ?? null;
    const next =
      index < stableCandidates.length - 1
        ? stableCandidates[index + 1]
        : null;

    if (!previous) {
      continue;
    }

    const durationMs = candidate.noteEvent.durationMs;
    const previousDistance = Math.abs(
      candidate.noteEvent.midiFloat - previous.noteEvent.midiFloat,
    );
    const nextDistance =
      next !== null
        ? Math.abs(candidate.noteEvent.midiFloat - next.noteEvent.midiFloat)
        : null;
    const farFromNeighborhood =
      previousDistance > TAIL_OUTLIER_SEMITONES &&
      (nextDistance === null || nextDistance > TAIL_OUTLIER_SEMITONES);
    const isHighTailSpike =
      candidate.noteEvent.midiFloat >=
      previous.noteEvent.midiFloat + TAIL_HIGH_SPIKE_SEMITONES;
    const isShortWeakTail =
      durationMs < TAIL_SHORT_EVENT_DURATION_MS &&
      !hasStrongStableSupport(candidate);

    if (
      isShortWeakTail ||
      (durationMs < TAIL_REATTACH_MAX_DURATION_MS && farFromNeighborhood) ||
      (durationMs < 320 && isHighTailSpike)
    ) {
      stableCandidates.splice(index, 1);
      suppressedTailCount += 1;
    }
  }

  return { candidates: stableCandidates, suppressedTailCount };
}

export function suppressPhrasePitchSpikes(candidates: NoteEventCandidate[]): {
  candidates: NoteEventCandidate[];
  suppressedSpikeCount: number;
} {
  if (candidates.length < 3) {
    return { candidates, suppressedSpikeCount: 0 };
  }

  const stableCandidates = [...candidates];
  let suppressedSpikeCount = 0;

  for (let index = stableCandidates.length - 2; index >= 1; index -= 1) {
    const candidate = stableCandidates[index];
    const previous = stableCandidates[index - 1] ?? null;
    const next = stableCandidates[index + 1] ?? null;

    if (!previous || !next) {
      continue;
    }

    if (candidate.noteEvent.durationMs >= SPIKE_EVENT_MAX_DURATION_MS) {
      continue;
    }

    const neighborMedianMidi = median([
      previous.noteEvent.midiFloat,
      next.noteEvent.midiFloat,
    ]);
    const distanceFromNeighborhood = Math.abs(
      candidate.noteEvent.midiFloat - neighborMedianMidi,
    );

    if (distanceFromNeighborhood <= SPIKE_NEIGHBOR_DISTANCE_SEMITONES) {
      continue;
    }

    if (
      hasStrongStableSupport(candidate) &&
      candidate.noteEvent.durationMs >= HARD_MIN_NOTE_DURATION_MS
    ) {
      continue;
    }

    stableCandidates.splice(index, 1);
    suppressedSpikeCount += 1;
  }

  return { candidates: stableCandidates, suppressedSpikeCount };
}
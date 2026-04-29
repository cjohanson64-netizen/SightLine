import type {
  CleanPitchFrame,
  GuidedSegmentationInput,
  GuidedSegmentationOutput,
  SungNoteEvent,
} from "../types";
import type { GuidedSegmentationService } from "../types/services";
import { frequencyToMidiFloat } from "./pitchMath";

function emptyGuidedSegmentationOutput(): GuidedSegmentationOutput {
  return { noteEvents: [] };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middleIndex = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;
  }

  return sorted[middleIndex];
}

function getCoreRegionFrames(region: CleanPitchFrame[]): CleanPitchFrame[] {
  if (region.length <= 4) {
    return region;
  }

  const trimCount = Math.floor(region.length * 0.2);
  const start = Math.min(trimCount, region.length - 1);
  const end = Math.max(start + 1, region.length - trimCount);

  const core = region.slice(start, end);
  return core.length > 0 ? core : region;
}

function getRegionRepresentativePitch(region: CleanPitchFrame[]): number {
  const coreRegion = getCoreRegionFrames(region);
  return median(coreRegion.map((frame) => frame.stablePitchHz));
}

function snapPitchToNeighborOctave(
  pitchHz: number,
  previousPitchHz: number | null,
  nextPitchHz: number | null,
): number {
  const neighborValues = [previousPitchHz, nextPitchHz].filter(
    (value): value is number =>
      value !== null && Number.isFinite(value) && value > 0,
  );

  if (
    neighborValues.length === 0 ||
    !Number.isFinite(pitchHz) ||
    pitchHz <= 0
  ) {
    return pitchHz;
  }

  const neighborMedian = median(neighborValues);

  const candidates = [pitchHz / 4, pitchHz / 2, pitchHz, pitchHz * 2].filter(
    (value) => Number.isFinite(value) && value > 0,
  );

  let best = candidates[0];
  let bestDistance = Math.abs(candidates[0] - neighborMedian);

  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const distance = Math.abs(candidate - neighborMedian);

    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

function smoothMidiFloats(frames: CleanPitchFrame[]): number[] {
  const midiFloats = frames.map((frame) =>
    frequencyToMidiFloat(frame.stablePitchHz),
  );

  return midiFloats.map((_, index) => {
    const start = Math.max(0, index - 2);
    const end = Math.min(midiFloats.length, index + 3);
    return median(midiFloats.slice(start, end));
  });
}

type BoundaryCandidate = {
  index: number;
  strength: number;
};

function getBoundaryCandidates(frames: CleanPitchFrame[]): BoundaryCandidate[] {
  if (frames.length < 3) {
    return [];
  }

  const smoothed = smoothMidiFloats(frames);
  const candidates: BoundaryCandidate[] = [];

  for (let index = 1; index < smoothed.length - 1; index += 1) {
    const left = smoothed[index - 1];
    const current = smoothed[index];
    const right = smoothed[index + 1];

    const leftJump = Math.abs(current - left);
    const rightJump = Math.abs(right - current);
    const strength = leftJump + rightJump;

    if (strength >= 0.75) {
      candidates.push({
        index,
        strength,
      });
    }
  }

  return candidates.sort((a, b) => b.strength - a.strength);
}

function splitRegion(
  region: CleanPitchFrame[],
  parts: number,
): CleanPitchFrame[][] {
  if (parts <= 1 || region.length <= 1) {
    return [region];
  }

  const regions: CleanPitchFrame[][] = [];

  for (let partIndex = 0; partIndex < parts; partIndex += 1) {
    const start = Math.floor((partIndex * region.length) / parts);
    const end = Math.floor(((partIndex + 1) * region.length) / parts);
    const slice = region.slice(start, end);

    if (slice.length > 0) {
      regions.push(slice);
    }
  }

  return regions;
}

function rebalanceRegions(
  regions: CleanPitchFrame[][],
  expectedNoteCount: number,
): CleanPitchFrame[][] {
  if (regions.length === 0) {
    return [];
  }

  const totalFrames = regions.reduce((sum, region) => sum + region.length, 0);
  const targetRegionSize = totalFrames / expectedNoteCount;
  const minRegionSize = Math.max(2, Math.floor(targetRegionSize * 0.5));
  const maxRegionSize = Math.max(
    minRegionSize + 1,
    Math.ceil(targetRegionSize * 1.7),
  );

  let working = [...regions];

  const splitRegions: CleanPitchFrame[][] = [];

  for (const region of working) {
    if (
      region.length > maxRegionSize &&
      splitRegions.length < expectedNoteCount
    ) {
      const parts = Math.max(2, Math.round(region.length / targetRegionSize));
      splitRegions.push(...splitRegion(region, parts));
    } else {
      splitRegions.push(region);
    }
  }

  working = splitRegions;

  let changed = true;

  while (changed) {
    changed = false;

    for (let index = 0; index < working.length; index += 1) {
      const region = working[index];

      if (region.length >= minRegionSize || working.length <= 1) {
        continue;
      }

      const previous = index > 0 ? working[index - 1] : null;
      const next = index < working.length - 1 ? working[index + 1] : null;

      if (!previous && next) {
        working[index + 1] = [...region, ...next];
        working.splice(index, 1);
        changed = true;
        break;
      }

      if (previous && !next) {
        working[index - 1] = [...previous, ...region];
        working.splice(index, 1);
        changed = true;
        break;
      }

      if (previous && next) {
        const prevCombinedSize = previous.length + region.length;
        const nextCombinedSize = next.length + region.length;

        const prevPenalty = Math.abs(prevCombinedSize - targetRegionSize);
        const nextPenalty = Math.abs(nextCombinedSize - targetRegionSize);

        if (prevPenalty <= nextPenalty) {
          working[index - 1] = [...previous, ...region];
          working.splice(index, 1);
        } else {
          working[index + 1] = [...region, ...next];
          working.splice(index, 1);
        }

        changed = true;
        break;
      }
    }
  }

  while (working.length > expectedNoteCount) {
    let bestIndex = 0;
    let bestPenalty = Number.POSITIVE_INFINITY;

    for (let index = 0; index < working.length - 1; index += 1) {
      const mergedSize = working[index].length + working[index + 1].length;
      const penalty = Math.abs(mergedSize - targetRegionSize);

      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestIndex = index;
      }
    }

    working[bestIndex] = [...working[bestIndex], ...working[bestIndex + 1]];
    working.splice(bestIndex + 1, 1);
  }

  while (working.length < expectedNoteCount) {
    let largestIndex = 0;

    for (let index = 1; index < working.length; index += 1) {
      if (working[index].length > working[largestIndex].length) {
        largestIndex = index;
      }
    }

    const largest = working[largestIndex];

    if (largest.length <= 1) {
      break;
    }

    const split = splitRegion(largest, 2);
    working.splice(largestIndex, 1, ...split);
  }

  return working;
}

function buildRegionsFromBoundaries(
  frames: CleanPitchFrame[],
  boundaries: number[],
): CleanPitchFrame[][] {
  const sortedBoundaries = [...boundaries]
    .filter((boundary) => boundary > 0 && boundary < frames.length)
    .sort((a, b) => a - b);

  const regions: CleanPitchFrame[][] = [];
  let start = 0;

  for (const boundary of sortedBoundaries) {
    const region = frames.slice(start, boundary);
    if (region.length > 0) {
      regions.push(region);
    }
    start = boundary;
  }

  const finalRegion = frames.slice(start);
  if (finalRegion.length > 0) {
    regions.push(finalRegion);
  }

  return regions;
}

function getExpectedContour(
  expectedMidiFloats: number[],
): Array<"up" | "down" | "same"> {
  const contour: Array<"up" | "down" | "same"> = [];

  for (let index = 1; index < expectedMidiFloats.length; index += 1) {
    const delta = expectedMidiFloats[index] - expectedMidiFloats[index - 1];
    contour.push(delta > 0 ? "up" : delta < 0 ? "down" : "same");
  }

  return contour;
}

function getObservedContour(
  regionPitches: number[],
): Array<"up" | "down" | "same"> {
  const contour: Array<"up" | "down" | "same"> = [];

  for (let index = 1; index < regionPitches.length; index += 1) {
    const delta =
      frequencyToMidiFloat(regionPitches[index]) -
      frequencyToMidiFloat(regionPitches[index - 1]);

    if (delta > 0.35) {
      contour.push("up");
    } else if (delta < -0.35) {
      contour.push("down");
    } else {
      contour.push("same");
    }
  }

  return contour;
}

function getLateOnsetPenalty(region: CleanPitchFrame[]): number {
  const firstStableIndex = region.findIndex(
    (frame) =>
      Number.isFinite(frame.stablePitchHz) &&
      frame.stablePitchHz > 0 &&
      frame.clarity >= 0.75,
  );

  if (firstStableIndex === -1 || region.length === 0) {
    return 2;
  }

  const lateOnsetRatio = firstStableIndex / region.length;

  if (lateOnsetRatio > 0.6) {
    return 3;
  }

  if (lateOnsetRatio > 0.4) {
    return 1.5;
  }

  return 0;
}

function scoreRegionsAgainstExpectedContour(
  regions: CleanPitchFrame[][],
  expectedMidiFloats: number[] | undefined,
): number {
  const sizePenalty = (() => {
    if (regions.length === 0) {
      return Number.POSITIVE_INFINITY;
    }

    const totalFrames = regions.reduce((sum, region) => sum + region.length, 0);
    const target = totalFrames / regions.length;

    return (
      regions.reduce(
        (sum, region) => sum + Math.abs(region.length - target),
        0,
      ) / totalFrames
    );
  })();

  const lateOnsetPenalty = regions.reduce(
    (sum, region) => sum + getLateOnsetPenalty(region),
    0,
  );

  const rawRegionPitches = regions.map((region) =>
    getRegionRepresentativePitch(region),
  );
  const correctedRegionPitches = rawRegionPitches.map((pitchHz, index) => {
    const previousPitchHz = index > 0 ? rawRegionPitches[index - 1] : null;
    const nextPitchHz =
      index < rawRegionPitches.length - 1 ? rawRegionPitches[index + 1] : null;

    return snapPitchToNeighborOctave(pitchHz, previousPitchHz, nextPitchHz);
  });

  if (
    !expectedMidiFloats ||
    expectedMidiFloats.length !== correctedRegionPitches.length
  ) {
    return sizePenalty + lateOnsetPenalty;
  }

  const expectedContour = getExpectedContour(expectedMidiFloats);
  const observedContour = getObservedContour(correctedRegionPitches);

  let contourPenalty = 0;

  for (
    let index = 0;
    index < Math.min(expectedContour.length, observedContour.length);
    index += 1
  ) {
    if (expectedContour[index] !== observedContour[index]) {
      contourPenalty += 1;
    }
  }

  return contourPenalty * 10 + sizePenalty + lateOnsetPenalty;
}

function chooseBestBoundaries(
  frames: CleanPitchFrame[],
  expectedNoteCount: number,
  expectedMidiFloats: number[] | undefined,
): CleanPitchFrame[][] {
  if (frames.length === 0 || expectedNoteCount <= 0) {
    return [];
  }

  if (expectedNoteCount === 1) {
    return [frames];
  }

  const targetBoundaryCount = expectedNoteCount - 1;
  const candidates = getBoundaryCandidates(frames);
  const minBoundarySpacing = Math.max(
    3,
    Math.floor(frames.length / (expectedNoteCount * 2)),
  );

  const topCandidates = candidates.slice(
    0,
    Math.max(targetBoundaryCount * 3, 12),
  );

  const fallbackBoundaries: number[] = [];
  for (let regionIndex = 1; regionIndex < expectedNoteCount; regionIndex += 1) {
    fallbackBoundaries.push(
      Math.floor((regionIndex * frames.length) / expectedNoteCount),
    );
  }

  let bestRegions = rebalanceRegions(
    buildRegionsFromBoundaries(frames, fallbackBoundaries),
    expectedNoteCount,
  );
  let bestScore = scoreRegionsAgainstExpectedContour(
    bestRegions,
    expectedMidiFloats,
  );

  const maxMasks = Math.min(1 << topCandidates.length, 256);

  for (let mask = 0; mask < maxMasks; mask += 1) {
    const selected: number[] = [];

    for (
      let candidateIndex = 0;
      candidateIndex < topCandidates.length;
      candidateIndex += 1
    ) {
      if ((mask & (1 << candidateIndex)) === 0) {
        continue;
      }

      const candidate = topCandidates[candidateIndex];
      const tooClose = selected.some(
        (boundary) => Math.abs(boundary - candidate.index) < minBoundarySpacing,
      );

      if (!tooClose) {
        selected.push(candidate.index);
      }

      if (selected.length === targetBoundaryCount) {
        break;
      }
    }

    if (selected.length < targetBoundaryCount) {
      for (const fallbackBoundary of fallbackBoundaries) {
        const tooClose = selected.some(
          (boundary) =>
            Math.abs(boundary - fallbackBoundary) < minBoundarySpacing,
        );

        if (!tooClose) {
          selected.push(fallbackBoundary);
        }

        if (selected.length === targetBoundaryCount) {
          break;
        }
      }
    }

    const regions = rebalanceRegions(
      buildRegionsFromBoundaries(frames, selected),
      expectedNoteCount,
    );

    if (regions.length !== expectedNoteCount) {
      continue;
    }

    const score = scoreRegionsAgainstExpectedContour(
      regions,
      expectedMidiFloats,
    );

    if (score < bestScore) {
      bestScore = score;
      bestRegions = regions;
    }
  }

  return bestRegions;
}

function buildGuidedNoteEvent(params: {
  region: CleanPitchFrame[];
  index: number;
}): SungNoteEvent | null {
  const { region, index } = params;

  if (region.length === 0) {
    return null;
  }

  const stableFrames = region.filter(
    (frame) =>
      Number.isFinite(frame.stablePitchHz) &&
      frame.stablePitchHz > 0 &&
      frame.clarity >= 0.75,
  );

  if (stableFrames.length === 0) {
    return null;
  }

  // Detect if pitch only appears late in the region (likely rest + late onset)
  const firstStableIndex = region.findIndex(
    (frame) =>
      Number.isFinite(frame.stablePitchHz) &&
      frame.stablePitchHz > 0 &&
      frame.clarity >= 0.75,
  );

  if (firstStableIndex !== -1) {
    const lateOnsetRatio = firstStableIndex / region.length;

    // If pitch only starts after 50% of the region, treat as rest
    if (lateOnsetRatio > 0.5) {
      return null;
    }
  }

  const minimumStableFrames = Math.max(3, Math.floor(region.length * 0.2));

  if (stableFrames.length < minimumStableFrames) {
    return null;
  }

  const coreRegion = getCoreRegionFrames(stableFrames);
  const representativePitchHz = median(
    coreRegion.map((frame) => frame.stablePitchHz),
  );

  if (!Number.isFinite(representativePitchHz) || representativePitchHz <= 0) {
    return null;
  }

  const startMs = region[0].timeMs;
  const endMs = region[region.length - 1].timeMs;
  const frameStepMs =
    region.length > 1 ? region[1].timeMs - region[0].timeMs : 0;
  const durationMs = Math.max(0, endMs - startMs + frameStepMs);

  const confidence = average(
    coreRegion.map((frame: CleanPitchFrame) => frame.clarity),
  );
  const midiFloat = frequencyToMidiFloat(representativePitchHz);

  return {
    id: `g${index + 1}`,
    startMs,
    endMs,
    durationMs,
    pitchHz: representativePitchHz,
    midiFloat,
    confidence,
  };
}

export const guidedSegmentationService: GuidedSegmentationService = {
  run(input: GuidedSegmentationInput): GuidedSegmentationOutput {
    if (!input.frames || input.frames.length === 0) {
      return emptyGuidedSegmentationOutput();
    }

    if (
      !Number.isInteger(input.expectedNoteCount) ||
      input.expectedNoteCount <= 0
    ) {
      return emptyGuidedSegmentationOutput();
    }

    const regions = chooseBestBoundaries(
      input.frames,
      input.expectedNoteCount,
      input.expectedMidiFloats,
    );

    if (regions.length === 0) {
      return emptyGuidedSegmentationOutput();
    }

    const noteEvents: SungNoteEvent[] = [];
    let previousAcceptedMidiFloat: number | null = null;

    for (let index = 0; index < regions.length; index += 1) {
      const region = regions[index];
      const noteEvent = buildGuidedNoteEvent({ region, index });

      if (!noteEvent) {
        continue;
      }

      const stableFrames = region.filter(
        (frame) =>
          Number.isFinite(frame.stablePitchHz) &&
          frame.stablePitchHz > 0 &&
          frame.clarity >= 0.75,
      );

      const firstStableIndex = region.findIndex(
        (frame) =>
          Number.isFinite(frame.stablePitchHz) &&
          frame.stablePitchHz > 0 &&
          frame.clarity >= 0.75,
      );

      const lateOnsetRatio =
        firstStableIndex === -1 ? 1 : firstStableIndex / region.length;

      const stableCoverageRatio =
        region.length === 0 ? 0 : stableFrames.length / region.length;

      const isNearPrevious =
        previousAcceptedMidiFloat !== null &&
        Math.abs(noteEvent.midiFloat - previousAcceptedMidiFloat) < 0.5;

      const hasWeakSupport =
        stableFrames.length <
          Math.max(4, Math.floor(region.length * 0.35)) ||
        lateOnsetRatio > 0.35;

      // New rest-like rejection:
      // if pitch starts late and does not occupy enough of the region,
      // treat the region as silence / delayed onset rather than a note
      const isRestLike =
        lateOnsetRatio > 0.35 && stableCoverageRatio < 0.6;

      if (isRestLike) {
        continue;
      }

      if (isNearPrevious && hasWeakSupport) {
        continue;
      }

      noteEvents.push(noteEvent);
      previousAcceptedMidiFloat = noteEvent.midiFloat;
    }

    return { noteEvents };
  },
};
import { midiToPitch, prefersFlatsForKey } from '@/SightLine/core/midi';
import type { CalibrationProfile } from '@/SightLine/core/calibration/types';
import type { MelodyEvent } from '@/SightLine/domain/music';
import type { CleanedPitchFrame, DetectedPitchFrame, SegmentedPerformedNote } from './types';

interface SegmentOptions {
  minConfidence?: number;
  minWindowVoicedFrames?: number;
  slackMs?: number;
  boundarySearchMs?: number;
  expectedMidiOffset?: number | null;
  calibrationProfile?: CalibrationProfile | null;
  disableContourSanity?: boolean;
  disablePhraseLevelSmoothing?: boolean;
}

interface DominantClusterAnalysis {
  usedFrames: CleanedPitchFrame[];
  representativeMidi: number | null;
  dominantPitchBucket: number | null;
  dominantBucketStrength: number | null;
  dominantBucketSnapped: boolean;
  confidence: number;
  stablePitchSpread: number | null;
  alternateCandidateCenters: number[];
  expectedPriorAdjusted: boolean;
  phraseInitialAdjusted: boolean;
  onsetAdjusted: boolean;
  octaveAlternativesTested: boolean;
  edgeTrimApplied: boolean;
  clusterRescued: boolean;
  targetConsistentAmbiguity: boolean;
  debugReason: string;
}

interface PitchCandidate {
  bucket: number;
  center: number;
  score: number;
  rawScore: number;
  frames: CleanedPitchFrame[];
  octaveAlternativesTested: boolean;
}

interface EstimatedPhraseBounds {
  startMs: number;
  endMs: number;
}

interface ExpectedWindow {
  targetIndex: number;
  startMs: number;
  endMs: number;
  target: MelodyEvent;
}

interface CalibrationSupportMatch {
  supported: boolean;
  level: 'strong' | 'weak' | 'rejected' | null;
  reason: string | null;
}

function durationBeats(event: MelodyEvent): number {
  if (typeof event.durationBeats === 'number' && Number.isFinite(event.durationBeats)) {
    return Math.max(0.25, event.durationBeats);
  }

  switch (event.duration) {
    case 'whole':
      return 4;
    case 'half':
      return 2;
    case 'eighth':
      return 0.5;
    case 'quarter':
    default:
      return 1;
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function weightedMedian(entries: Array<{ value: number; weight: number }>): number | null {
  if (entries.length === 0) {
    return null;
  }

  const sorted = [...entries].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  let runningWeight = 0;

  for (const entry of sorted) {
    runningWeight += entry.weight;
    if (runningWeight >= totalWeight / 2) {
      return entry.value;
    }
  }

  return sorted[sorted.length - 1].value;
}

function estimatePhraseBounds(
  frames: CleanedPitchFrame[],
  minConfidence: number
): EstimatedPhraseBounds | null {
  const voicedFrames = frames.filter(
    (frame) => frame.voiced && frame.cleanedMidi !== null && frame.confidence >= minConfidence
  );

  if (voicedFrames.length === 0) {
    return null;
  }

  return {
    startMs: voicedFrames[0].timeMs,
    endMs: voicedFrames[voicedFrames.length - 1].timeMs,
  };
}

function refineBoundaries(
  boundaries: number[],
  frames: CleanedPitchFrame[],
  boundarySearchMs: number
): number[] {
  if (boundaries.length <= 2) {
    return boundaries;
  }

  const refined = [...boundaries];

  for (let index = 1; index < boundaries.length - 1; index += 1) {
    const nominal = boundaries[index];
    let bestBoundary = nominal;
    let bestScore = Number.NEGATIVE_INFINITY;

    const candidates = frames.filter(
      (frame) => Math.abs(frame.timeMs - nominal) <= boundarySearchMs
    );

    if (candidates.length === 0) {
      continue;
    }

    for (const candidate of candidates) {
      const boundaryTime = candidate.timeMs;
      const before = frames.filter(
        (frame) => frame.timeMs < boundaryTime && boundaryTime - frame.timeMs <= boundarySearchMs
      );
      const after = frames.filter(
        (frame) => frame.timeMs >= boundaryTime && frame.timeMs - boundaryTime <= boundarySearchMs
      );

      const voicedBefore = before.filter((frame) => frame.voiced && frame.cleanedMidi !== null);
      const voicedAfter = after.filter((frame) => frame.voiced && frame.cleanedMidi !== null);
      const beforeMedian = median(voicedBefore.map((frame) => frame.cleanedMidi as number));
      const afterMedian = median(voicedAfter.map((frame) => frame.cleanedMidi as number));
      const averageRms =
        [...before, ...after].reduce((sum, frame) => sum + frame.rms, 0) /
        Math.max(1, before.length + after.length);
      const gapBonus = candidate.voiced ? 0 : 1.25;
      const pitchChangeBonus =
        beforeMedian !== null && afterMedian !== null ? Math.min(2, Math.abs(afterMedian - beforeMedian) / 2) : 0;
      const rmsDipBonus = Math.max(0, 0.04 - averageRms) * 8;
      const score = gapBonus + pitchChangeBonus + rmsDipBonus;

      if (score > bestScore) {
        bestScore = score;
        bestBoundary = boundaryTime;
      }
    }

    refined[index] = bestBoundary;
  }

  return refined;
}

function buildExpectedWindows(
  targetMelody: MelodyEvent[],
  phraseBounds: EstimatedPhraseBounds,
  frames: CleanedPitchFrame[],
  boundarySearchMs: number
): ExpectedWindow[] {
  const activeTarget = targetMelody.filter((event) => event.isAttack !== false);
  const totalDurationBeats = activeTarget.reduce((sum, event) => sum + durationBeats(event), 0);
  const phraseDurationMs = Math.max(120, phraseBounds.endMs - phraseBounds.startMs);
  const boundaries = [phraseBounds.startMs];
  let elapsedBeats = 0;

  for (let index = 0; index < activeTarget.length - 1; index += 1) {
    elapsedBeats += durationBeats(activeTarget[index]);
    const ratio = totalDurationBeats > 0 ? elapsedBeats / totalDurationBeats : (index + 1) / activeTarget.length;
    boundaries.push(phraseBounds.startMs + phraseDurationMs * ratio);
  }
  boundaries.push(phraseBounds.endMs);

  const refinedBoundaries = refineBoundaries(boundaries, frames, boundarySearchMs);

  return activeTarget.map((target, index) => ({
    targetIndex: index,
    startMs: refinedBoundaries[index],
    endMs: refinedBoundaries[index + 1],
    target,
  }));
}

function cleanPitchFrames(
  frames: DetectedPitchFrame[],
  minConfidence: number
): CleanedPitchFrame[] {
  const rmsValues = frames.map((frame) => frame.rms).filter((value) => Number.isFinite(value));
  const sortedRms = [...rmsValues].sort((a, b) => a - b);
  const noiseFloor =
    sortedRms.length > 0
      ? sortedRms[Math.max(0, Math.floor(sortedRms.length * 0.2) - 1)]
      : 0.01;

  return frames.map((frame, index) => {
    const prev = frames[index - 1] ?? null;
    const next = frames[index + 1] ?? null;
    let cleanedMidi = frame.midi;
    let rejectedReason: CleanedPitchFrame['rejectedReason'] = null;
    // Breathier voices often produce usable pitch with slightly weaker confidence.
    // Keep the floor conservative near the noise floor, but relax it a little when
    // the signal has enough energy to still carry clear musical intent.
    const dynamicConfidenceFloor =
      frame.rms <= noiseFloor * 1.75
        ? minConfidence + 0.15
        : Math.max(0.41, minConfidence - 0.04);

    if (frame.rms <= noiseFloor * 1.2) {
      cleanedMidi = null;
      rejectedReason = 'noise_floor';
    } else if (frame.midi === null || frame.confidence < dynamicConfidenceFloor) {
      cleanedMidi = null;
      rejectedReason = frame.midi === null ? null : 'low_confidence';
    } else if (
      prev?.midi !== null &&
      next?.midi !== null &&
      prev.confidence >= dynamicConfidenceFloor &&
      next.confidence >= dynamicConfidenceFloor
    ) {
      const previousMidi = prev.midi;
      const nextMidi = next.midi;
      const localMedian = median([previousMidi, nextMidi]);
      const isolatedSpike =
        localMedian !== null &&
        Math.abs(frame.midi - localMedian) >= 3 &&
        Math.abs(previousMidi - nextMidi) <= 1;
      const octaveLikeJump =
        Math.abs(frame.midi - previousMidi) >= 10 &&
        Math.abs(frame.midi - nextMidi) >= 10 &&
        Math.abs(previousMidi - nextMidi) <= 2;

      if (isolatedSpike || octaveLikeJump) {
        cleanedMidi = localMedian ?? frame.midi;
        rejectedReason = 'isolated_spike';
      }
    }

    const localPitchSupport =
      prev?.midi !== null && next?.midi !== null && Math.abs(prev.midi - next.midi) <= 1
        ? median([prev.midi, next.midi])
        : null;

    if (
      cleanedMidi !== null &&
      ((prev?.midi === null && next?.midi === null) ||
        (prev?.confidence ?? 0) < minConfidence * 0.8 && (next?.confidence ?? 0) < minConfidence * 0.8) &&
      frame.confidence < 0.64
    ) {
      const pitchStillLocallyCoherent =
        localPitchSupport !== null &&
        Math.abs((frame.midi ?? cleanedMidi) - localPitchSupport) <= 0.85 &&
        frame.rms > noiseFloor * 1.35;

      if (!pitchStillLocallyCoherent) {
        cleanedMidi = null;
        rejectedReason = 'unstable_support';
      }
    }

    return {
      ...frame,
      rawMidi: frame.midi,
      cleanedMidi,
      midi: cleanedMidi,
      voiced: cleanedMidi !== null,
      rejectedReason,
    };
  });
}

function selectAnalysisVoicedFrames(
  relevantFrames: CleanedPitchFrame[],
  minConfidence: number,
): { frames: CleanedPitchFrame[]; breathyFallbackApplied: boolean } {
  const primaryFrames = relevantFrames.filter(
    (frame) => frame.voiced && frame.cleanedMidi !== null && frame.confidence >= minConfidence,
  );

  if (primaryFrames.length >= 2) {
    return { frames: primaryFrames, breathyFallbackApplied: false };
  }

  const fallbackFloor = Math.max(0.41, minConfidence - 0.04);
  const relaxedFrames = relevantFrames.filter(
    (frame) => frame.voiced && frame.cleanedMidi !== null && frame.confidence >= fallbackFloor,
  );

  if (relaxedFrames.length >= 2) {
    return { frames: relaxedFrames, breathyFallbackApplied: true };
  }

  return { frames: primaryFrames, breathyFallbackApplied: false };
}

function hasBreathyUsableStableCore(
  stableCore: DominantClusterAnalysis,
  spread: number | null,
): boolean {
  return (
    stableCore.usedFrames.length >= 2 &&
    stableCore.confidence >= 0.46 &&
    (stableCore.stablePitchSpread ?? spread ?? Number.POSITIVE_INFINITY) <= 1.05 &&
    (stableCore.dominantBucketStrength ?? 0) >= 0.46
  );
}

function pitchSpread(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Math.max(...values) - Math.min(...values);
}

function frameWeight(frame: CleanedPitchFrame): number {
  return Math.max(0.05, frame.confidence * Math.max(0.25, frame.rms));
}

function trimStableCoreFrames(frames: CleanedPitchFrame[]): {
  frames: CleanedPitchFrame[];
  edgeTrimApplied: boolean;
} {
  if (frames.length < 5) {
    return { frames, edgeTrimApplied: false };
  }

  const trimCount = Math.min(2, Math.floor(frames.length * 0.2));
  if (trimCount <= 0 || trimCount * 2 >= frames.length) {
    return { frames, edgeTrimApplied: false };
  }

  return {
    frames: frames.slice(trimCount, frames.length - trimCount),
    edgeTrimApplied: true,
  };
}

function choosePhraseInitialFrames(frames: CleanedPitchFrame[]): {
  frames: CleanedPitchFrame[];
  phraseInitialAdjusted: boolean;
} {
  if (frames.length < 4) {
    return { frames, phraseInitialAdjusted: false };
  }

  const searchFrames = frames.slice(0, Math.min(frames.length, 7));
  let bestStart = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let index = 0; index <= searchFrames.length - 3; index += 1) {
    const window = searchFrames.slice(index, index + 3);
    const spread = pitchSpread(window.map((frame) => frame.cleanedMidi as number)) ?? 99;
    const avgConfidence =
      window.reduce((sum, frame) => sum + frame.confidence, 0) / Math.max(1, window.length);
    const score = spread - avgConfidence * 0.35 + index * 0.08;
    if (score < bestScore) {
      bestScore = score;
      bestStart = index;
    }
  }

  if (bestStart <= 0) {
    return { frames, phraseInitialAdjusted: false };
  }

  return {
    frames: frames.slice(bestStart),
    phraseInitialAdjusted: true,
  };
}

function stabilizeWindowOnset(frames: CleanedPitchFrame[], phraseInitial: boolean): {
  frames: CleanedPitchFrame[];
  onsetAdjusted: boolean;
} {
  if (frames.length < 4) {
    return { frames, onsetAdjusted: false };
  }

  const searchLimit = phraseInitial ? Math.min(frames.length, 8) : Math.min(frames.length, 5);
  let bestStart = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let index = 0; index <= searchLimit - 3; index += 1) {
    const slice = frames.slice(index, index + 3);
    const spread = pitchSpread(slice.map((frame) => frame.cleanedMidi as number)) ?? 99;
    const confidence =
      slice.reduce((sum, frame) => sum + frame.confidence, 0) / Math.max(1, slice.length);
    const score = spread - confidence * 0.4 + index * (phraseInitial ? 0.04 : 0.08);
    if (score < bestScore) {
      bestScore = score;
      bestStart = index;
    }
  }

  if (bestStart === 0) {
    return { frames, onsetAdjusted: false };
  }

  return {
    frames: frames.slice(bestStart),
    onsetAdjusted: true,
  };
}

function buildPitchCandidates(
  analysisFrames: CleanedPitchFrame[],
  expectedMidi: number | null
): PitchCandidate[] {
  const bucketWeights = new Map<number, number>();

  for (const frame of analysisFrames) {
    const bucket = Math.round(frame.cleanedMidi as number);
    bucketWeights.set(bucket, (bucketWeights.get(bucket) ?? 0) + frameWeight(frame));
  }

  const rankedBuckets = [...bucketWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([bucket]) => bucket);

  return rankedBuckets.map((bucket) => {
    const baseFrames = analysisFrames.filter(
      (frame) => Math.abs((frame.cleanedMidi as number) - bucket) <= 0.9
    );
    const baseCenter =
      weightedMedian(baseFrames.map((frame) => ({ value: frame.cleanedMidi as number, weight: frameWeight(frame) }))) ??
      bucket;
    const alternatives =
      expectedMidi !== null
        ? [baseCenter, baseCenter + 12, baseCenter - 12].sort(
            (a, b) => Math.abs(a - expectedMidi) - Math.abs(b - expectedMidi)
          )
        : [baseCenter];

    let bestCenter = baseCenter;
    let bestFrames = baseFrames;
    let bestPriorDistance = expectedMidi !== null ? Math.abs(baseCenter - expectedMidi) : 0;
    let octaveAlternativesTested = alternatives.length > 1;

    for (const alternative of alternatives) {
      const candidateFrames = analysisFrames.filter(
        (frame) => Math.abs((frame.cleanedMidi as number) - alternative) <= 0.9
      );
      if (candidateFrames.length === 0) {
        continue;
      }
      const center =
        weightedMedian(
          candidateFrames.map((frame) => ({ value: frame.cleanedMidi as number, weight: frameWeight(frame) }))
        ) ?? alternative;
      const priorDistance = expectedMidi !== null ? Math.abs(center - expectedMidi) : 0;
      const candidateWeight = candidateFrames.reduce((sum, frame) => sum + frameWeight(frame), 0);
      const bestWeight = bestFrames.reduce((sum, frame) => sum + frameWeight(frame), 0);

      if (priorDistance + 0.25 < bestPriorDistance && candidateWeight >= bestWeight * 0.75) {
        bestCenter = center;
        bestFrames = candidateFrames;
        bestPriorDistance = priorDistance;
      }
    }

    const rawScore = bestFrames.reduce((sum, frame) => sum + frameWeight(frame), 0);
    const priorPenalty =
      expectedMidi !== null ? Math.min(2.5, Math.abs(bestCenter - expectedMidi) * 0.2) : 0;

    return {
      bucket,
      center: bestCenter,
      score: rawScore - priorPenalty,
      rawScore,
      frames: bestFrames,
      octaveAlternativesTested,
    };
  });
}

function analyzeDominantCluster(
  voicedFrames: CleanedPitchFrame[],
  expectedMidi: number | null,
  options?: { phraseInitial?: boolean }
): DominantClusterAnalysis {
  if (voicedFrames.length === 0) {
    return {
      usedFrames: [],
      representativeMidi: null,
      dominantPitchBucket: null,
      dominantBucketStrength: null,
      dominantBucketSnapped: false,
      confidence: 0,
      stablePitchSpread: null,
      alternateCandidateCenters: [],
      expectedPriorAdjusted: false,
      phraseInitialAdjusted: false,
      onsetAdjusted: false,
      octaveAlternativesTested: false,
      edgeTrimApplied: false,
      clusterRescued: false,
      targetConsistentAmbiguity: false,
      debugReason: 'No voiced frames survived confidence filtering.',
    };
  }

  const phraseInitialSelection =
    options?.phraseInitial ? choosePhraseInitialFrames(voicedFrames) : { frames: voicedFrames, phraseInitialAdjusted: false };
  const initialFrames = phraseInitialSelection.frames.length >= 3 ? phraseInitialSelection.frames : voicedFrames;
  const onsetStabilized = stabilizeWindowOnset(initialFrames, Boolean(options?.phraseInitial));
  const stabilizedFrames = onsetStabilized.frames.length >= 3 ? onsetStabilized.frames : initialFrames;
  const { frames: trimmedFrames, edgeTrimApplied } = trimStableCoreFrames(stabilizedFrames);
  const analysisFrames = trimmedFrames.length >= 3 ? trimmedFrames : stabilizedFrames;
  const candidates = buildPitchCandidates(analysisFrames, expectedMidi).sort((a, b) => b.score - a.score);
  const winner = candidates[0];
  const runnerUp = candidates[1];
  const clusterFrames = winner?.frames ?? [];
  const rawRepresentativeMidi =
    winner
      ? weightedMedian(
          clusterFrames.map((frame) => ({
            value: frame.cleanedMidi as number,
            weight: frameWeight(frame),
          }))
        )
      : null;
  const totalCandidateScore = candidates.reduce((sum, candidate) => sum + Math.max(0, candidate.rawScore), 0);
  const dominantBucketStrength =
    winner && totalCandidateScore > 0 ? winner.rawScore / totalCandidateScore : null;
  const shouldSnapToDominantBucket =
    winner !== undefined &&
    rawRepresentativeMidi !== null &&
    dominantBucketStrength !== null &&
    dominantBucketStrength >= 0.56 &&
    Math.abs(rawRepresentativeMidi - winner.bucket) <= 0.34 &&
    (expectedMidi === null || Math.abs(winner.bucket - expectedMidi) <= Math.abs(rawRepresentativeMidi - expectedMidi) + 0.2);
  const representativeMidi = shouldSnapToDominantBucket ? winner!.bucket : rawRepresentativeMidi;
  const confidence =
    clusterFrames.reduce((sum, frame) => sum + frame.confidence, 0) /
    Math.max(1, clusterFrames.length);
  const stablePitchSpread = pitchSpread(
    clusterFrames.map((frame) => frame.cleanedMidi as number)
  );
  const clusterRescued =
    edgeTrimApplied &&
    clusterFrames.length >= 3 &&
    clusterFrames.length < voicedFrames.length &&
    (stablePitchSpread ?? 0) <= 1.5;
  const competingCenters = Boolean(winner && runnerUp && runnerUp.score >= winner.score - 0.2);
  const targetConsistentAmbiguity =
    expectedMidi !== null &&
    rawRepresentativeMidi !== null &&
    Math.abs(rawRepresentativeMidi - expectedMidi) <= 0.65;
  const expectedPriorAdjusted =
    expectedMidi !== null &&
    Boolean(winner && Math.abs(winner.center - expectedMidi) + 0.15 < Math.abs(winner.bucket - expectedMidi));

  let debugReason = 'Stable central cluster selected from the note window.';
  if (shouldSnapToDominantBucket) {
    debugReason = 'Strong dominant bucket was close to the continuous center, so the center snapped to that bucket.';
  }
  if (clusterRescued) {
    debugReason = 'Edge trimming and vibrato-tolerant clustering isolated a stable core.';
  } else if (competingCenters) {
    debugReason = 'Window contains competing pitch centers after stable-core analysis.';
  } else if (edgeTrimApplied) {
    debugReason = 'Edge trimming reduced attack/release contamination before pitch estimation.';
  }
  if (phraseInitialSelection.phraseInitialAdjusted) {
    debugReason = `${debugReason} Phrase-initial stabilization skipped the earliest unstable onset frames.`;
  } else if (onsetStabilized.onsetAdjusted) {
    debugReason = `${debugReason} Onset stabilization skipped an unstable start inside the note window.`;
  }

  return {
    usedFrames: clusterFrames.length > 0 ? clusterFrames : analysisFrames,
    representativeMidi,
    dominantPitchBucket: winner?.bucket ?? null,
    dominantBucketStrength,
    dominantBucketSnapped: shouldSnapToDominantBucket,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    stablePitchSpread,
    alternateCandidateCenters: candidates.slice(1).map((candidate) => candidate.center),
    expectedPriorAdjusted,
    phraseInitialAdjusted: phraseInitialSelection.phraseInitialAdjusted,
    onsetAdjusted: onsetStabilized.onsetAdjusted,
    octaveAlternativesTested: candidates.some((candidate) => candidate.octaveAlternativesTested),
    edgeTrimApplied,
    clusterRescued,
    targetConsistentAmbiguity,
    debugReason,
  };
}

function targetDirection(
  previous: SegmentedPerformedNote | null,
  current: SegmentedPerformedNote,
  next: SegmentedPerformedNote | null
): 'up' | 'down' | 'same' | null {
  if (typeof previous?.expectedMidi === 'number' && typeof current.expectedMidi === 'number') {
    if (current.expectedMidi > previous.expectedMidi) return 'up';
    if (current.expectedMidi < previous.expectedMidi) return 'down';
  }
  if (typeof current.expectedMidi === 'number' && typeof next?.expectedMidi === 'number') {
    if (next.expectedMidi > current.expectedMidi) return 'up';
    if (next.expectedMidi < current.expectedMidi) return 'down';
    return 'same';
  }
  return null;
}

function octaveAlignedCalibrationCenter(
  center: number,
  sourceExpectedMidi: number,
  targetExpectedMidi: number,
): number {
  const octaveShift = Math.round((targetExpectedMidi - sourceExpectedMidi) / 12);
  return center + octaveShift * 12;
}

function findCalibrationSupport(
  note: SegmentedPerformedNote,
  calibrationProfile: CalibrationProfile | null,
): CalibrationSupportMatch {
  if (
    !calibrationProfile?.successful ||
    calibrationProfile.signalQuality === 'poor' ||
    note.pitchCenter === null ||
    typeof note.expectedMidi !== 'number'
  ) {
    return { supported: false, level: null, reason: null };
  }

  const expectedMidi = note.expectedMidi;
  const candidates = calibrationProfile.degrees.filter(
    (degree) => degree.center !== null,
  );

  if (candidates.length === 0) {
    return { supported: false, level: 'rejected', reason: 'Calibration profile had no stable stored centers.' };
  }

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestSourceDistance = Number.POSITIVE_INFINITY;
  let matchedDegree: CalibrationProfile['degrees'][number] | null = null;
  let matchedAlignedCenter: number | null = null;

  for (const candidate of candidates) {
    const alignedCenter = octaveAlignedCalibrationCenter(
      candidate.center as number,
      candidate.expectedMidi,
      expectedMidi,
    );
    const alignedExpectedMidi = octaveAlignedCalibrationCenter(
      candidate.expectedMidi,
      candidate.expectedMidi,
      expectedMidi,
    );
    const expectedAlignmentError = Math.abs(alignedExpectedMidi - expectedMidi);
    if (expectedAlignmentError > 0.01) {
      continue;
    }
    const distance = Math.abs(note.pitchCenter - alignedCenter);
    const sourceDistance = Math.abs(candidate.expectedMidi - expectedMidi);
    if (
      distance < bestDistance - 0.001 ||
      (Math.abs(distance - bestDistance) <= 0.001 && sourceDistance < bestSourceDistance)
    ) {
      bestDistance = distance;
      bestSourceDistance = sourceDistance;
      matchedDegree = candidate;
      matchedAlignedCenter = alignedCenter;
    }
  }

  if (!matchedDegree || matchedAlignedCenter === null) {
    return {
      supported: false,
      level: 'rejected',
      reason: 'Calibration degrees could not be octave-aligned cleanly to this target note.',
    };
  }

  if (matchedDegree.confidence < 0.5 || matchedDegree.stability < 0.35) {
    return {
      supported: false,
      level: 'rejected',
      reason: `Calibration matched degree ${matchedDegree.degree}, but that stored point was too weak or unstable to trust.`,
    };
  }

  if (bestDistance <= 0.45 && matchedDegree.confidence >= 0.62 && matchedDegree.stability >= 0.45) {
    return {
      supported: true,
      level: 'strong',
      reason: `Strong calibration support from degree ${matchedDegree.degree} (${matchedDegree.label}) at ${matchedAlignedCenter.toFixed(2)} semitones, ${bestDistance.toFixed(2)} away from the local center.`,
    };
  }

  if (bestDistance <= 0.75) {
    return {
      supported: false,
      level: 'weak',
      reason: `Calibration matched degree ${matchedDegree.degree} (${matchedDegree.label}), but support was only weak at ${bestDistance.toFixed(2)} semitones away.`,
    };
  }

  return {
    supported: false,
    level: 'rejected',
    reason: `Calibration matched degree ${matchedDegree.degree} (${matchedDegree.label}), but the stored center sat ${bestDistance.toFixed(2)} semitones away from this local pitch.`,
  };
}

function hasStrongLocalPitchEvidence(note: SegmentedPerformedNote): boolean {
  const spread = note.stablePitchSpread ?? note.pitchSpread ?? Number.POSITIVE_INFINITY;
  const dominantStrength = note.dominantBucketStrength ?? 0;
  const calibrationSupportIsStrong = note.calibrationSupportLevel === 'strong';
  const confidenceFloor = calibrationSupportIsStrong ? 0.62 : 0.68;
  const spreadLimit = calibrationSupportIsStrong ? 1.05 : 0.9;
  const dominantStrengthFloor = calibrationSupportIsStrong ? 0.52 : 0.58;

  return (
    note.pitchCenter !== null &&
    note.status === 'clear' &&
    note.confidence >= confidenceFloor &&
    note.usedFrameCount >= 3 &&
    spread <= spreadLimit &&
    !note.targetConsistentAmbiguity &&
    dominantStrength >= dominantStrengthFloor
  );
}

function applyContourSanity(segmentedNotes: SegmentedPerformedNote[]): SegmentedPerformedNote[] {
  return segmentedNotes.map((note, index, notes) => {
    if (note.pitchCenter === null) {
      return note;
    }

    const previous = notes[index - 1] ?? null;
    const next = notes[index + 1] ?? null;
    const expectedDirection = targetDirection(previous, note, next);
    if (!expectedDirection || note.alternateCandidateCenters.length === 0) {
      return note;
    }

    const previousCenter = previous?.pitchCenter ?? null;
    const chosenCenter = note.pitchCenter;
    const flattensRise =
      expectedDirection === 'up' &&
      previousCenter !== null &&
      chosenCenter <= previousCenter + 0.2;
    const flattensFall =
      expectedDirection === 'down' &&
      previousCenter !== null &&
      chosenCenter >= previousCenter - 0.2;

    if (!flattensRise && !flattensFall) {
      return note;
    }

    const strongLocalEvidence = hasStrongLocalPitchEvidence(note);
    const alternate = note.alternateCandidateCenters.find((candidate) =>
      expectedDirection === 'up'
        ? previousCenter === null || candidate > previousCenter + 0.35
        : expectedDirection === 'down'
          ? previousCenter === null || candidate < previousCenter - 0.35
          : Math.abs(candidate - chosenCenter) <= 0.5
    );

    if (strongLocalEvidence) {
      return {
        ...note,
        debugReason: `${note.debugReason} Local pitch evidence was stable, so contour sanity preserved the detected note despite phrase-motion disagreement.`,
      };
    }

    if (alternate === undefined) {
      return {
        ...note,
        confidence: note.confidence * 0.8,
        contourAdjusted: true,
        debugReason: `${note.debugReason} Contour sanity check lowered confidence because the selected center flattened expected motion.`,
      };
    }

    return {
      ...note,
      pitchCenter: alternate,
      midi: Math.round(alternate),
      contourAdjusted: true,
      roundedFromCenter: Math.abs(Math.round(alternate) - alternate) >= 0.15,
      confidence: note.confidence * 0.9,
      debugReason: `${note.debugReason} Contour sanity check preferred an alternate candidate to preserve expected phrase motion.`,
    };
  });
}

function applyPhraseLevelSmoothing(segmentedNotes: SegmentedPerformedNote[]): SegmentedPerformedNote[] {
  return segmentedNotes.map((note, index, notes) => {
    if (note.pitchCenter === null || note.alternateCandidateCenters.length === 0) {
      return note;
    }

    const previousCenter = notes[index - 1]?.pitchCenter ?? null;
    const nextCenter = notes[index + 1]?.pitchCenter ?? null;
    if (previousCenter === null || nextCenter === null) {
      return note;
    }

    const localMidpoint = (previousCenter + nextCenter) / 2;
    const chosenCenter = note.pitchCenter;
    const chosenOutlierScore = Math.abs(chosenCenter - localMidpoint);
    const betterAlternate = note.alternateCandidateCenters.find((candidate) => {
      const alternateOutlierScore = Math.abs(candidate - localMidpoint);
      const targetDistance = note.expectedMidi !== null ? Math.abs(candidate - note.expectedMidi) : 0;
      return (
        alternateOutlierScore + 0.2 < chosenOutlierScore &&
        targetDistance <= (note.expectedMidi !== null ? Math.abs(chosenCenter - note.expectedMidi) + 0.25 : 99)
      );
    });

    if (betterAlternate === undefined) {
      return note;
    }

    if (hasStrongLocalPitchEvidence(note)) {
      return {
        ...note,
        debugReason: `${note.debugReason} Local pitch evidence was stable, so phrase-level smoothing kept the detected note instead of replacing it.`,
      };
    }

    return {
      ...note,
      pitchCenter: betterAlternate,
      midi: Math.round(betterAlternate),
      phraseLevelSmoothed: true,
      roundedFromCenter: Math.abs(Math.round(betterAlternate) - betterAlternate) >= 0.15,
      confidence: note.confidence * 0.92,
      debugReason: `${note.debugReason} Phrase-level smoothing preferred an alternate that fit the local phrase path better.`,
    };
  });
}

function buildSegmentedNote(
  window: ExpectedWindow,
  frames: CleanedPitchFrame[],
  minConfidence: number,
  slackMs: number,
  expectedMidiOffset: number | null,
  calibrationProfile: CalibrationProfile | null
): SegmentedPerformedNote {
  const relevantFrames = frames.filter(
    (frame) =>
      frame.timeMs >= window.startMs - slackMs &&
      frame.timeMs <= window.endMs + slackMs
  );
  const voicedFrameSelection = selectAnalysisVoicedFrames(relevantFrames, minConfidence);
  const voicedFrames = voicedFrameSelection.frames;
  const analysisExpectedMidi =
    typeof window.target.midi === 'number' && typeof expectedMidiOffset === 'number'
      ? window.target.midi + expectedMidiOffset
      : window.target.midi ?? null;
  const stableCore = analyzeDominantCluster(voicedFrames, analysisExpectedMidi, {
    phraseInitial: window.targetIndex === 0,
  });
  const estimatedMidi = stableCore.representativeMidi;
  const spread = pitchSpread(voicedFrames.map((frame) => frame.cleanedMidi as number));
  const firstVoiced = stableCore.usedFrames[0] ?? voicedFrames[0] ?? null;
  const lastVoiced =
    stableCore.usedFrames[stableCore.usedFrames.length - 1] ??
    voicedFrames[voicedFrames.length - 1] ??
    null;
  const expectedPitch = window.target.pitch ?? null;
  const breathyUsableStableCore = hasBreathyUsableStableCore(stableCore, spread);

  let status: SegmentedPerformedNote['status'] = 'clear';
  let debugReason = stableCore.debugReason;

  if (!estimatedMidi || voicedFrames.length === 0) {
    status = 'missing';
    debugReason = 'No stable voiced frames landed inside this target window.';
  } else if (
    (stableCore.usedFrames.length < 2 || stableCore.confidence < 0.55) &&
    !breathyUsableStableCore
  ) {
    status = 'weak';
    debugReason = `${stableCore.debugReason} Stable evidence is still limited or low-confidence.`;
  } else if (
    (stableCore.stablePitchSpread ?? 0) >= 2 ||
    ((spread ?? 0) >= 3 && !stableCore.clusterRescued && (stableCore.stablePitchSpread ?? 99) > 1.5)
  ) {
    status = 'ambiguous';
    debugReason = stableCore.targetConsistentAmbiguity
      ? 'Stable-core analysis remained ambiguous, but the winning center still stayed target-consistent.'
      : 'Stable-core analysis still found competing or widely spread pitch centers.';
  } else if (voicedFrameSelection.breathyFallbackApplied) {
    debugReason = `${stableCore.debugReason} A breathy-signal fallback kept moderately confident frames so musically usable pitch would not be discarded too early.`;
  }

  const provisionalNote: SegmentedPerformedNote = {
    index: window.targetIndex,
    targetIndex: window.targetIndex,
    expectedMidi: window.target.midi ?? null,
    expectedPitch,
    windowStartMs: window.startMs,
    windowEndMs: window.endMs,
    startMs: firstVoiced?.timeMs ?? window.startMs,
    endMs: lastVoiced?.timeMs ?? window.endMs,
    durationMs: (lastVoiced?.timeMs ?? window.endMs) - (firstVoiced?.timeMs ?? window.startMs),
    pitchCenter: estimatedMidi,
    midi: estimatedMidi !== null ? Math.round(estimatedMidi) : null,
    confidence: stableCore.confidence,
    frameCount: relevantFrames.length,
    voicedFrameCount: voicedFrames.length,
    usedFrameCount: stableCore.usedFrames.length,
    pitchSpread: spread,
    dominantPitchBucket: stableCore.dominantPitchBucket,
    dominantBucketStrength: stableCore.dominantBucketStrength,
    dominantBucketSnapped: stableCore.dominantBucketSnapped,
    stablePitchSpread: stableCore.stablePitchSpread,
    alternateCandidateCenters: stableCore.alternateCandidateCenters,
    expectedPriorAdjusted: stableCore.expectedPriorAdjusted,
    contourAdjusted: false,
    phraseInitialAdjusted: stableCore.phraseInitialAdjusted,
    onsetAdjusted: stableCore.onsetAdjusted,
    phraseLevelSmoothed: false,
    octaveAlternativesTested: stableCore.octaveAlternativesTested,
    roundedFromCenter:
      estimatedMidi !== null ? Math.abs(Math.round(estimatedMidi) - estimatedMidi) >= 0.15 : false,
    edgeTrimApplied: stableCore.edgeTrimApplied,
    clusterRescued: stableCore.clusterRescued,
    targetConsistentAmbiguity: stableCore.targetConsistentAmbiguity,
    calibrationSupportedLocalEvidence: false,
    calibrationSupportLevel: null,
    calibrationSupportReason: null,
    status,
    debugReason,
  };

  const calibrationSupport = findCalibrationSupport(provisionalNote, calibrationProfile);
  const confidence = calibrationSupport.supported
    ? Math.min(1, provisionalNote.confidence + 0.04)
    : provisionalNote.confidence;
  const supportedDebugReason = calibrationSupport.supported && calibrationSupport.reason
    ? `${provisionalNote.debugReason} ${calibrationSupport.reason}`
    : provisionalNote.debugReason;

  return {
    ...provisionalNote,
    confidence,
    calibrationSupportedLocalEvidence: calibrationSupport.supported,
    calibrationSupportLevel: calibrationSupport.level,
    calibrationSupportReason: calibrationSupport.reason,
    debugReason: supportedDebugReason,
  };
}

export function segmentPerformedMelody(
  frames: DetectedPitchFrame[],
  targetMelody: MelodyEvent[],
  options?: SegmentOptions
): { cleanedFrames: CleanedPitchFrame[]; segmentedNotes: SegmentedPerformedNote[] } {
  const minConfidence = options?.minConfidence ?? 0.45;
  const minWindowVoicedFrames = options?.minWindowVoicedFrames ?? 2;
  const slackMs = options?.slackMs ?? 60;
  const boundarySearchMs = options?.boundarySearchMs ?? 90;
  const expectedMidiOffset = options?.expectedMidiOffset ?? null;
  const calibrationProfile = options?.calibrationProfile ?? null;
  const disableContourSanity = options?.disableContourSanity ?? false;
  const disablePhraseLevelSmoothing = options?.disablePhraseLevelSmoothing ?? false;
  const cleanedFrames = cleanPitchFrames(frames, minConfidence);
  const phraseBounds = estimatePhraseBounds(cleanedFrames, minConfidence);

  if (!phraseBounds) {
    return { cleanedFrames, segmentedNotes: [] };
  }

  const windows = buildExpectedWindows(targetMelody, phraseBounds, cleanedFrames, boundarySearchMs);
  const [referenceKey = 'C', referenceModeRaw = 'major'] = String(
    windows[0]?.target.keyId ?? 'C-major'
  ).split('-');
  const preferFlats = prefersFlatsForKey(
    referenceKey,
    referenceModeRaw === 'minor' ? 'minor' : 'major'
  );

  const provisionalNotes = windows.map((window) => {
    const note = buildSegmentedNote(
      window,
      cleanedFrames,
      minConfidence,
      slackMs,
      expectedMidiOffset,
      calibrationProfile,
    );

    if (
      note.status === 'missing' &&
      note.voicedFrameCount < minWindowVoicedFrames &&
      note.expectedMidi !== null
    ) {
      return {
        ...note,
        expectedPitch: midiToPitch(note.expectedMidi, {
          preferFlats,
          key: referenceKey,
          mode: referenceModeRaw === 'minor' ? 'minor' : 'major',
        }),
        debugReason: `${note.debugReason} Expected note retained for debug, but not forced into performance.`,
      };
    }

    return {
      ...note,
      expectedPitch:
        note.expectedMidi !== null
          ? midiToPitch(note.expectedMidi, {
              preferFlats,
              key: referenceKey,
              mode: referenceModeRaw === 'minor' ? 'minor' : 'major',
            })
          : note.expectedPitch,
    };
  });

  const contourAdjustedNotes = disableContourSanity
    ? provisionalNotes
    : applyContourSanity(provisionalNotes);
  const segmentedNotes = disablePhraseLevelSmoothing
    ? contourAdjustedNotes
    : applyPhraseLevelSmoothing(contourAdjustedNotes);

  return {
    cleanedFrames,
    segmentedNotes,
  };
}

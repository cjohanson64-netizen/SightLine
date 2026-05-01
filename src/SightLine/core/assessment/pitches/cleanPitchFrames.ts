import type {
  CleanPitchFrame,
  PitchCleaningOptions,
  RawPitchFrame,
} from "./pitchTypes";

const DEFAULT_MIN_PITCH_HZ = 60;
const DEFAULT_MAX_PITCH_HZ = 1200;
const DEFAULT_MIN_VOICED_RUN_FRAMES = 3;
const DEFAULT_SMOOTHING_WINDOW_SIZE = 5;
const MAX_RUN_PITCH_JUMP_HZ = 25;

type CleanPitchFramesInput = {
  frames: RawPitchFrame[];
  options?: PitchCleaningOptions;
};

/**
 * Cleans raw pitch frames into stable pitch frames.
 *
 * This file owns:
 * - removing unvoiced frames
 * - removing out-of-range pitch
 * - suppressing obvious octave-halving artifacts
 * - removing tiny voiced runs
 * - smoothing stable pitch
 *
 * It does not segment notes.
 * It does not compare to expected notes.
 * It does not score correctness.
 */
export function cleanPitchFrames(
  input: CleanPitchFramesInput,
): CleanPitchFrame[] {
  const minPitchHz = input.options?.minPitchHz ?? DEFAULT_MIN_PITCH_HZ;
  const maxPitchHz = input.options?.maxPitchHz ?? DEFAULT_MAX_PITCH_HZ;
  const minVoicedRunFrames =
    input.options?.minVoicedRunFrames ?? DEFAULT_MIN_VOICED_RUN_FRAMES;
  const smoothingWindowSize =
    input.options?.smoothingWindowSize ?? DEFAULT_SMOOTHING_WINDOW_SIZE;

  const usableFrames = input.frames.filter((frame) =>
    isUsableRawPitchFrame(frame, minPitchHz, maxPitchHz),
  );

  const artifactSuppressedFrames = suppressSingleFrameOctaveArtifacts(
    usableFrames,
  );

  const runs = groupContiguousPitchRuns(artifactSuppressedFrames);
  const survivingRuns = runs.filter((run) => run.length >= minVoicedRunFrames);

  return survivingRuns.flatMap((run) =>
    smoothRun(run, smoothingWindowSize).map((frame) => ({
      frameIndex: frame.frameIndex,
      timeMs: frame.timeMs,
      rawPitchHz: frame.pitchHz,
      stablePitchHz: frame.stablePitchHz,
      clarity: frame.clarity,
    })),
  );
}

type UsablePitchFrame = RawPitchFrame & {
  pitchHz: number;
};

type SmoothedPitchFrame = UsablePitchFrame & {
  stablePitchHz: number;
};

function isUsableRawPitchFrame(
  frame: RawPitchFrame,
  minPitchHz: number,
  maxPitchHz: number,
): frame is UsablePitchFrame {
  return (
    frame.isVoiced &&
    typeof frame.pitchHz === "number" &&
    Number.isFinite(frame.pitchHz) &&
    frame.pitchHz >= minPitchHz &&
    frame.pitchHz <= maxPitchHz
  );
}

function suppressSingleFrameOctaveArtifacts(
  frames: UsablePitchFrame[],
): UsablePitchFrame[] {
  if (frames.length < 3) {
    return frames;
  }

  return frames.filter((frame, index) => {
    if (index === 0 || index === frames.length - 1) {
      return true;
    }

    const previous = frames[index - 1];
    const next = frames[index + 1];

    const isContiguousWithNeighbors =
      previous.frameIndex + 1 === frame.frameIndex &&
      frame.frameIndex + 1 === next.frameIndex;

    if (!isContiguousWithNeighbors) {
      return true;
    }

    const neighborAverage = (previous.pitchHz + next.pitchHz) / 2;
    const looksLikeHalfPitch =
      Math.abs(frame.pitchHz * 2 - neighborAverage) <= 15;

    return !looksLikeHalfPitch;
  });
}

function groupContiguousPitchRuns(
  frames: UsablePitchFrame[],
): UsablePitchFrame[][] {
  const runs: UsablePitchFrame[][] = [];

  for (const frame of frames) {
    const currentRun = runs[runs.length - 1];

    if (!currentRun) {
      runs.push([frame]);
      continue;
    }

    const previousFrame = currentRun[currentRun.length - 1];
    const isConsecutive = previousFrame.frameIndex + 1 === frame.frameIndex;
    const isPitchClose =
      Math.abs(previousFrame.pitchHz - frame.pitchHz) <= MAX_RUN_PITCH_JUMP_HZ;

    if (isConsecutive && isPitchClose) {
      currentRun.push(frame);
    } else {
      runs.push([frame]);
    }
  }

  return runs;
}

function smoothRun(
  run: UsablePitchFrame[],
  windowSize: number,
): SmoothedPitchFrame[] {
  const safeWindowSize = Math.max(1, Math.floor(windowSize));
  const halfWindow = Math.floor(safeWindowSize / 2);

  return run.map((frame, index) => {
    const startIndex = Math.max(0, index - halfWindow);
    const endIndex = Math.min(run.length, index + halfWindow + 1);
    const window = run.slice(startIndex, endIndex);

    const stablePitchHz =
      window.reduce((sum, currentFrame) => sum + currentFrame.pitchHz, 0) /
      window.length;

    return {
      ...frame,
      stablePitchHz,
    };
  });
}
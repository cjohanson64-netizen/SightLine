import type {
  CleanPitchFrame,
  RawPitchFrame,
  SignalCleaningInput,
  SignalCleaningOutput,
} from "../types";
import type { SignalCleaningService } from "../types/services";

const MIN_VALID_PITCH_HZ = 60;
const MAX_VALID_PITCH_HZ = 1200;
const MAX_INTRA_RUN_JUMP_HZ = 25;
const MIN_VOICED_RUN_FRAMES = 3;
const SMOOTHING_WINDOW_SIZE = 5;

type UsableVoicedFrame = RawPitchFrame & { pitchHz: number };
type VoicedRun = UsableVoicedFrame[];

function emptySignalCleaningOutput(): SignalCleaningOutput {
  return { frames: [] };
}

function isUsableVoicedFrame(frame: RawPitchFrame): frame is UsableVoicedFrame {
  return (
    frame.isVoiced === true &&
    frame.pitchHz !== null &&
    Number.isFinite(frame.pitchHz) &&
    frame.pitchHz >= MIN_VALID_PITCH_HZ &&
    frame.pitchHz <= MAX_VALID_PITCH_HZ
  );
}

function areConsecutiveFrames(
  previous: UsableVoicedFrame,
  current: UsableVoicedFrame,
): boolean {
  return current.frameIndex === previous.frameIndex + 1;
}

function areNeighborFramesStable(
  previous: UsableVoicedFrame,
  next: UsableVoicedFrame,
): boolean {
  return Math.abs(previous.pitchHz - next.pitchHz) <= 8;
}

function getOctaveHalvedRatio(
  current: UsableVoicedFrame,
  previous: UsableVoicedFrame,
  next: UsableVoicedFrame,
): number {
  if (current.pitchHz <= 0) {
    return 0;
  }

  const neighborAverage = (previous.pitchHz + next.pitchHz) / 2;
  return neighborAverage / current.pitchHz;
}

function isOctaveHalvingArtifact(
  previous: UsableVoicedFrame,
  current: UsableVoicedFrame,
  next: UsableVoicedFrame,
): boolean {
  const previousIsConsecutive = areConsecutiveFrames(previous, current);
  const nextIsConsecutive = areConsecutiveFrames(current, next);

  if (!previousIsConsecutive || !nextIsConsecutive) {
    return false;
  }

  const octaveHalvedRatio = getOctaveHalvedRatio(current, previous, next);
  const looksLikeOctaveHalved =
    octaveHalvedRatio >= 1.85 && octaveHalvedRatio <= 2.15;

  return areNeighborFramesStable(previous, next) && looksLikeOctaveHalved;
}

function suppressOctaveHalvingArtifacts(
  frames: UsableVoicedFrame[],
): UsableVoicedFrame[] {
  if (frames.length < 3) {
    return frames;
  }

  const cleaned: UsableVoicedFrame[] = [frames[0]];

  for (let index = 1; index < frames.length - 1; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    const next = frames[index + 1];

    if (!isOctaveHalvingArtifact(previous, current, next)) {
      cleaned.push(current);
    }
  }

  cleaned.push(frames[frames.length - 1]);
  return cleaned;
}

function isSameStableRun(
  previous: UsableVoicedFrame,
  current: UsableVoicedFrame,
): boolean {
  const isConsecutive = areConsecutiveFrames(previous, current);
  const pitchJumpHz = Math.abs(current.pitchHz - previous.pitchHz);
  const isStableEnough = pitchJumpHz <= MAX_INTRA_RUN_JUMP_HZ;

  return isConsecutive && isStableEnough;
}

function groupConsecutiveRuns(frames: UsableVoicedFrame[]): VoicedRun[] {
  if (frames.length === 0) {
    return [];
  }

  const runs: VoicedRun[] = [];
  let currentRun: VoicedRun = [frames[0]];

  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];

    if (isSameStableRun(previous, current)) {
      currentRun.push(current);
    } else {
      runs.push(currentRun);
      currentRun = [current];
    }
  }

  runs.push(currentRun);
  return runs;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function getSmoothingWindowValues(
  run: VoicedRun,
  index: number,
  halfWindow: number,
): number[] {
  const start = Math.max(0, index - halfWindow);
  const end = Math.min(run.length - 1, index + halfWindow);

  const values: number[] = [];

  for (let cursor = start; cursor <= end; cursor += 1) {
    values.push(run[cursor].pitchHz);
  }

  return values;
}

function smoothRun(run: VoicedRun, windowSize: number): CleanPitchFrame[] {
  const safeWindowSize = Math.max(1, windowSize);
  const halfWindow = Math.floor(safeWindowSize / 2);

  return run.map((frame, index) => {
    const windowValues = getSmoothingWindowValues(run, index, halfWindow);

    return {
      frameIndex: frame.frameIndex,
      timeMs: frame.timeMs,
      rawPitchHz: frame.pitchHz,
      stablePitchHz: average(windowValues),
      clarity: frame.clarity,
    };
  });
}

function discardShortRuns(runs: VoicedRun[]): VoicedRun[] {
  return runs.filter((run) => run.length >= MIN_VOICED_RUN_FRAMES);
}

function smoothRuns(runs: VoicedRun[]): CleanPitchFrame[] {
  return runs.flatMap((run) => smoothRun(run, SMOOTHING_WINDOW_SIZE));
}

function cleanFrames(frames: RawPitchFrame[]): CleanPitchFrame[] {
  const voicedFrames = frames.filter(isUsableVoicedFrame);

  if (voicedFrames.length === 0) {
    return [];
  }

  const octaveSuppressedFrames = suppressOctaveHalvingArtifacts(voicedFrames);

  if (octaveSuppressedFrames.length === 0) {
    return [];
  }

  const runs = groupConsecutiveRuns(octaveSuppressedFrames);
  const stableRuns = discardShortRuns(runs);

  return smoothRuns(stableRuns);
}

export const signalCleaningService: SignalCleaningService = {
  run(input: SignalCleaningInput): SignalCleaningOutput {
    if (!input.frames || input.frames.length === 0) {
      return emptySignalCleaningOutput();
    }

    return {
      frames: cleanFrames(input.frames),
    };
  },
};
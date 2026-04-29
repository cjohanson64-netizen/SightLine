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

function emptySignalCleaningOutput(): SignalCleaningOutput {
  return { frames: [] };
}

function isUsableVoicedFrame(
  frame: RawPitchFrame,
): frame is RawPitchFrame & { pitchHz: number } {
  return (
    frame.isVoiced === true &&
    frame.pitchHz !== null &&
    Number.isFinite(frame.pitchHz) &&
    frame.pitchHz >= MIN_VALID_PITCH_HZ &&
    frame.pitchHz <= MAX_VALID_PITCH_HZ
  );
}

function suppressOctaveHalvingArtifacts(
  frames: Array<RawPitchFrame & { pitchHz: number }>,
): Array<RawPitchFrame & { pitchHz: number }> {
  if (frames.length < 3) {
    return frames;
  }

  const cleaned: Array<RawPitchFrame & { pitchHz: number }> = [frames[0]];

  for (let index = 1; index < frames.length - 1; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    const next = frames[index + 1];

    const previousIsConsecutive = current.frameIndex === previous.frameIndex + 1;
    const nextIsConsecutive = next.frameIndex === current.frameIndex + 1;

    if (!previousIsConsecutive || !nextIsConsecutive) {
      cleaned.push(current);
      continue;
    }

    const neighborsStable = Math.abs(previous.pitchHz - next.pitchHz) <= 8;
    const neighborAverage = (previous.pitchHz + next.pitchHz) / 2;

    const octaveHalvedRatio =
      current.pitchHz > 0 ? neighborAverage / current.pitchHz : 0;

    const looksLikeOctaveHalved =
      octaveHalvedRatio >= 1.85 && octaveHalvedRatio <= 2.15;

    if (neighborsStable && looksLikeOctaveHalved) {
      continue;
    }

    cleaned.push(current);
  }

  cleaned.push(frames[frames.length - 1]);
  return cleaned;
}

function groupConsecutiveRuns(
  frames: Array<RawPitchFrame & { pitchHz: number }>,
): Array<Array<RawPitchFrame & { pitchHz: number }>> {
  if (frames.length === 0) {
    return [];
  }

  const runs: Array<Array<RawPitchFrame & { pitchHz: number }>> = [];
  let currentRun: Array<RawPitchFrame & { pitchHz: number }> = [frames[0]];

  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];

    const isConsecutive = current.frameIndex === previous.frameIndex + 1;
    const pitchJumpHz = Math.abs(current.pitchHz - previous.pitchHz);
    const isStableEnough = pitchJumpHz <= MAX_INTRA_RUN_JUMP_HZ;

    if (isConsecutive && isStableEnough) {
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

function smoothRun(
  run: Array<RawPitchFrame & { pitchHz: number }>,
  windowSize: number,
): CleanPitchFrame[] {
  const safeWindowSize = Math.max(1, windowSize);
  const halfWindow = Math.floor(safeWindowSize / 2);

  return run.map((frame, index) => {
    const start = Math.max(0, index - halfWindow);
    const end = Math.min(run.length - 1, index + halfWindow);

    const windowValues: number[] = [];
    for (let cursor = start; cursor <= end; cursor += 1) {
      windowValues.push(run[cursor].pitchHz);
    }

    return {
      frameIndex: frame.frameIndex,
      timeMs: frame.timeMs,
      rawPitchHz: frame.pitchHz,
      stablePitchHz: average(windowValues),
      clarity: frame.clarity,
    };
  });
}

export const signalCleaningService: SignalCleaningService = {
  run(input: SignalCleaningInput): SignalCleaningOutput {
    if (!input.frames || input.frames.length === 0) {
      return emptySignalCleaningOutput();
    }

    const voicedFrames = input.frames.filter(isUsableVoicedFrame);

    if (voicedFrames.length === 0) {
      return emptySignalCleaningOutput();
    }

    const octaveSuppressedFrames = suppressOctaveHalvingArtifacts(voicedFrames);

    if (octaveSuppressedFrames.length === 0) {
      return emptySignalCleaningOutput();
    }

    const runs = groupConsecutiveRuns(octaveSuppressedFrames);
    const cleanedFrames: CleanPitchFrame[] = [];

    for (const run of runs) {
      if (run.length < MIN_VOICED_RUN_FRAMES) {
        continue;
      }

      cleanedFrames.push(...smoothRun(run, SMOOTHING_WINDOW_SIZE));
    }

    return {
      frames: cleanedFrames,
    };
  },
};
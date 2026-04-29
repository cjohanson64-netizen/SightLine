import type { CleanPitchFrame } from "../../types";
import { frequencyToMidiFloat } from "../pitchMath";
import { STABLE_CLARITY_THRESHOLD } from "./constants";
import { median } from "./mathUtils";

export function smoothMidiFloats(frames: CleanPitchFrame[]): number[] {
  const midiFloats = frames.map((frame) =>
    frequencyToMidiFloat(frame.stablePitchHz),
  );

  return midiFloats.map((_, index) => {
    const start = Math.max(0, index - 2);
    const end = Math.min(midiFloats.length, index + 3);
    return median(midiFloats.slice(start, end));
  });
}

export function isStableFrame(frame: CleanPitchFrame): boolean {
  return (
    Number.isFinite(frame.stablePitchHz) &&
    frame.stablePitchHz > 0 &&
    frame.clarity >= STABLE_CLARITY_THRESHOLD
  );
}

export function getFrameStepMs(frames: CleanPitchFrame[]): number {
  if (frames.length < 2) {
    return 0;
  }

  const steps: number[] = [];

  for (let index = 1; index < frames.length; index += 1) {
    const gap = frames[index].timeMs - frames[index - 1].timeMs;

    if (gap > 0) {
      steps.push(gap);
    }
  }

  return steps.length > 0 ? median(steps) : 0;
}

export function getRepresentativeFrames(
  spanFrames: CleanPitchFrame[],
): CleanPitchFrame[] {
  const stableFrames = spanFrames.filter(isStableFrame);

  if (stableFrames.length > 0) {
    return stableFrames;
  }

  return spanFrames;
}
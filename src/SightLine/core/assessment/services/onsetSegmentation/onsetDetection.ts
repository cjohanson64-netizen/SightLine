import type { CleanPitchFrame } from "../../types";
import {
  MIN_ONSET_SPACING_MS,
  PERSISTENCE_REQUIRED_FRAMES,
  PERSISTENCE_WINDOW_FRAMES,
  PITCH_SHIFT_THRESHOLD_SEMITONES,
} from "./constants";
import { isStableFrame } from "./frameUtils";
import { median } from "./mathUtils";

function supportsPitchShiftOnset(
  frames: CleanPitchFrame[],
  smoothedMidiFloats: number[],
  onsetIndex: number,
): boolean {
  if (onsetIndex <= 0 || onsetIndex >= frames.length) {
    return false;
  }

  const previousStart = Math.max(0, onsetIndex - 3);
  const previousStableMidiFloats = smoothedMidiFloats
    .slice(previousStart, onsetIndex)
    .filter((_, index) => isStableFrame(frames[previousStart + index]));

  if (previousStableMidiFloats.length === 0) {
    return false;
  }

  const previousCenter = median(previousStableMidiFloats);
  let supportCount = 0;
  const nextWindowEnd = Math.min(
    frames.length,
    onsetIndex + PERSISTENCE_WINDOW_FRAMES,
  );
  const supportedValues: number[] = [];

  for (let index = onsetIndex; index < nextWindowEnd; index += 1) {
    if (!isStableFrame(frames[index])) {
      continue;
    }

    const candidateMidiFloat = smoothedMidiFloats[index];
    const shiftSize = Math.abs(candidateMidiFloat - previousCenter);

    if (shiftSize >= PITCH_SHIFT_THRESHOLD_SEMITONES) {
      supportCount += 1;
      supportedValues.push(candidateMidiFloat);
    }
  }

  if (supportCount < PERSISTENCE_REQUIRED_FRAMES) {
    return false;
  }

  const newCenter = median(supportedValues);
  return (
    Math.abs(newCenter - previousCenter) >= PITCH_SHIFT_THRESHOLD_SEMITONES
  );
}

export function collectOnsetIndices(
  frames: CleanPitchFrame[],
  smoothedMidiFloats: number[],
): number[] {
  if (frames.length === 0) {
    return [];
  }

  const onsetIndices = [0];
  let lastOnsetTimeMs = frames[0].timeMs;

  for (let index = 1; index < frames.length; index += 1) {
    const current = frames[index];
    const previous = frames[index - 1];

    if (current.timeMs - lastOnsetTimeMs < MIN_ONSET_SPACING_MS) {
      continue;
    }

    const hasVoicedEntryGap = current.frameIndex > previous.frameIndex + 1;

    if (hasVoicedEntryGap) {
      onsetIndices.push(index);
      lastOnsetTimeMs = current.timeMs;
      continue;
    }

    if (supportsPitchShiftOnset(frames, smoothedMidiFloats, index)) {
      onsetIndices.push(index);
      lastOnsetTimeMs = current.timeMs;
    }
  }

  return onsetIndices;
}
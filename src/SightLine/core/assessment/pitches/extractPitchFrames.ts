import { PitchDetector } from "pitchy";
import type { PcmAudioBuffer } from "../intake/assessmentInput";
import type { PitchExtractionOptions, RawPitchFrame } from "./pitchTypes";

const DEFAULT_FRAME_SIZE = 2048;
const DEFAULT_HOP_SIZE = 256;
const DEFAULT_CLARITY_THRESHOLD = 0.8;

type ExtractPitchFramesInput = {
  audio: PcmAudioBuffer;
  options?: PitchExtractionOptions;
};

/**
 * Converts raw PCM audio into pitch frames.
 *
 * This file owns only:
 * - audio windowing
 * - pitch detection
 * - voiced/unvoiced frame labeling
 *
 * It does not clean the signal.
 * It does not segment notes.
 * It does not score correctness.
 */
export function extractPitchFrames(
  input: ExtractPitchFramesInput,
): RawPitchFrame[] {
  const frameSize = input.options?.frameSize ?? DEFAULT_FRAME_SIZE;
  const hopSize = input.options?.hopSize ?? DEFAULT_HOP_SIZE;
  const clarityThreshold =
    input.options?.clarityThreshold ?? DEFAULT_CLARITY_THRESHOLD;

  validateExtractionInput(input.audio, frameSize, hopSize);

  const detector = PitchDetector.forFloat32Array(frameSize);
  const frames: RawPitchFrame[] = [];

  for (
    let frameStart = 0, frameIndex = 0;
    frameStart + frameSize <= input.audio.samples.length;
    frameStart += hopSize, frameIndex += 1
  ) {
    const frame = input.audio.samples.subarray(frameStart, frameStart + frameSize);
    const [pitchHz, clarity] = detector.findPitch(frame, input.audio.sampleRate);

    const isValidPitch =
      typeof pitchHz === "number" && Number.isFinite(pitchHz) && pitchHz > 0;

    const isVoiced = isValidPitch && clarity >= clarityThreshold;

    frames.push({
      frameIndex,
      timeMs: (frameStart / input.audio.sampleRate) * 1000,
      pitchHz: isVoiced ? pitchHz : null,
      clarity,
      isVoiced,
    });
  }

  return frames;
}

function validateExtractionInput(
  audio: PcmAudioBuffer,
  frameSize: number,
  hopSize: number,
): void {
  if (!(audio.samples instanceof Float32Array)) {
    throw new Error("extractPitchFrames requires Float32Array audio samples.");
  }

  if (audio.samples.length === 0) {
    throw new Error("extractPitchFrames received an empty audio buffer.");
  }

  if (
    typeof audio.sampleRate !== "number" ||
    !Number.isFinite(audio.sampleRate) ||
    audio.sampleRate <= 0
  ) {
    throw new Error("extractPitchFrames requires a valid audio sampleRate.");
  }

  if (!Number.isInteger(frameSize) || frameSize <= 0) {
    throw new Error("extractPitchFrames requires a positive integer frameSize.");
  }

  if (!Number.isInteger(hopSize) || hopSize <= 0) {
    throw new Error("extractPitchFrames requires a positive integer hopSize.");
  }

  if (audio.samples.length < frameSize) {
    throw new Error(
      "extractPitchFrames received audio shorter than the analysis frame size.",
    );
  }
}
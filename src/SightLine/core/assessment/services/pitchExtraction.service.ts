import { PitchDetector } from "pitchy";
import type {
  PitchExtractionInput,
  PitchExtractionOutput,
  RawPitchFrame,
} from "../types";
import type { PitchExtractionService } from "../types/services";

function isValidAnalysisInput(input: PitchExtractionInput): boolean {
  if (
    !Number.isFinite(input.melodyAudio.sampleRate) ||
    input.melodyAudio.sampleRate <= 0
  ) {
    return false;
  }

  if (!Number.isInteger(input.frameSize) || input.frameSize <= 0) {
    return false;
  }

  if (!Number.isInteger(input.hopSize) || input.hopSize <= 0) {
    return false;
  }

  return true;
}

function emptyPitchExtractionOutput(): PitchExtractionOutput {
  return { frames: [] };
}

export const pitchExtractionService: PitchExtractionService = {
  async run(input: PitchExtractionInput): Promise<PitchExtractionOutput> {
    if (!isValidAnalysisInput(input)) {
      return emptyPitchExtractionOutput();
    }

    const channel = input.melodyAudio.channels[0];
    const { sampleRate } = input.melodyAudio;

    if (!channel || channel.length === 0) {
      return emptyPitchExtractionOutput();
    }

    if (input.frameSize > channel.length) {
      return emptyPitchExtractionOutput();
    }

    const clarityThreshold = Math.max(
      0,
      Math.min(1, input.clarityThreshold ?? 0.8),
    );

    const detector = PitchDetector.forFloat32Array(input.frameSize);
    const frames: RawPitchFrame[] = [];

    let frameIndex = 0;

    for (
      let startSample = 0;
      startSample + input.frameSize <= channel.length;
      startSample += input.hopSize
    ) {
      const frame = channel.subarray(startSample, startSample + input.frameSize);
      const [pitchHz, clarity] = detector.findPitch(frame, sampleRate);

      const isVoiced =
        clarity >= clarityThreshold &&
        Number.isFinite(pitchHz) &&
        pitchHz > 0;

      frames.push({
        frameIndex,
        timeMs: (startSample / sampleRate) * 1000,
        pitchHz: isVoiced ? pitchHz : null,
        clarity,
        isVoiced,
      });

      frameIndex += 1;
    }

    return { frames };
  },
};
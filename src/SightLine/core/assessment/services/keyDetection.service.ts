import type {
  KeyDetectionInput,
  KeyDetectionOutput,
  KeyDetectionService,
} from "../types";

export const keyDetectionService: KeyDetectionService = {
  async run(_input: KeyDetectionInput): Promise<KeyDetectionOutput> {
    return {
      tonic: {
        tonicHz: 261.63,
        tonicMidi: 60,
        tonicPitchClass: 0,
        tonicNoteName: "C4",
        confidence: 0,
      },
    };
  },
};

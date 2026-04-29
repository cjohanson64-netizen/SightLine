import type {
  IntakeRequest,
  IntakeOutput,
  IntakeService,
} from "../types";

export const intakeService: IntakeService = {
  async run(_input: IntakeRequest): Promise<IntakeOutput> {
    return {
      exerciseId: _input.exerciseId,
      scaleAudio: {
        sampleRate: 44100,
        channelCount: 1,
        frameCount: 0,
        channels: [new Float32Array()],
        durationMs: 0,
      },
      melodyAudio: {
        sampleRate: 44100,
        channelCount: 1,
        frameCount: 0,
        channels: [new Float32Array()],
        durationMs: 0,
      },
    };
  },
};

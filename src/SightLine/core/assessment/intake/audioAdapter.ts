import type { PcmAudioBuffer } from "./assessmentInput";

export type RecordedAudioBuffer = {
  sampleRate: number;
  samples?: Float32Array;
  channels?: Float32Array[];
  channelCount?: number;
  frameCount?: number;
  durationMs?: number;
};

export function toPcmAudioBuffer(recordedAudio: RecordedAudioBuffer): PcmAudioBuffer {
  if (recordedAudio.samples instanceof Float32Array) {
    return {
      samples: recordedAudio.samples,
      sampleRate: recordedAudio.sampleRate,
    };
  }

  if (!recordedAudio.channels || recordedAudio.channels.length === 0) {
    throw new Error("Recorded audio did not include PCM samples.");
  }

  return {
    samples: mixChannelsToMono(recordedAudio.channels),
    sampleRate: recordedAudio.sampleRate,
  };
}

function mixChannelsToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) {
    return channels[0];
  }

  const frameCount = Math.min(...channels.map((channel) => channel.length));
  const samples = new Float32Array(frameCount);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    let sum = 0;

    for (const channel of channels) {
      sum += channel[frameIndex] ?? 0;
    }

    samples[frameIndex] = sum / channels.length;
  }

  return samples;
}

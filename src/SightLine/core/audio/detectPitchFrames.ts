import type { DetectedPitchFrame } from './types';

interface PitchDetectionOptions {
  minFrequencyHz?: number;
  maxFrequencyHz?: number;
  frameSize?: number;
  hopSize?: number;
  minRms?: number;
  minCorrelation?: number;
}

type AudioContextLike = typeof AudioContext;

function getAudioContextCtor(): AudioContextLike | null {
  const scopedWindow = window as typeof window & {
    webkitAudioContext?: typeof AudioContext;
  };
  return scopedWindow.AudioContext ?? scopedWindow.webkitAudioContext ?? null;
}

function toMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  const channelCount = buffer.numberOfChannels;

  for (let channel = 0; channel < channelCount; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < buffer.length; index += 1) {
      mono[index] += data[index] / channelCount;
    }
  }

  return mono;
}

function rootMeanSquare(frame: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < frame.length; index += 1) {
    sum += frame[index] * frame[index];
  }
  return Math.sqrt(sum / frame.length);
}

function detectFrequencyFromAutocorrelation(
  frame: Float32Array,
  sampleRate: number,
  minFrequencyHz: number,
  maxFrequencyHz: number
): { frequencyHz: number | null; correlation: number } {
  let mean = 0;
  for (let index = 0; index < frame.length; index += 1) {
    mean += frame[index];
  }
  mean /= frame.length;

  const centered = new Float32Array(frame.length);
  let energy = 0;
  for (let index = 0; index < frame.length; index += 1) {
    const value = frame[index] - mean;
    centered[index] = value;
    energy += value * value;
  }

  if (energy <= 1e-9) {
    return { frequencyHz: null, correlation: 0 };
  }

  const minLag = Math.max(2, Math.floor(sampleRate / maxFrequencyHz));
  const maxLag = Math.min(frame.length - 1, Math.floor(sampleRate / minFrequencyHz));

  let bestLag = -1;
  let bestCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    for (let index = 0; index < centered.length - lag; index += 1) {
      correlation += centered[index] * centered[index + lag];
    }
    correlation /= energy;

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag <= 0) {
    return { frequencyHz: null, correlation: bestCorrelation };
  }

  return {
    frequencyHz: sampleRate / bestLag,
    correlation: bestCorrelation,
  };
}

function frequencyToMidi(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

export async function detectPitchFrames(
  audioBlob: Blob,
  options?: PitchDetectionOptions
): Promise<DetectedPitchFrame[]> {
  const AudioContextCtor = getAudioContextCtor();
  if (!AudioContextCtor) {
    throw new Error('Audio analysis is not supported in this browser.');
  }

  const context = new AudioContextCtor();
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
    const mono = toMono(audioBuffer);
    const frameSize = options?.frameSize ?? 2048;
    const hopSize = options?.hopSize ?? 512;
    const minFrequencyHz = options?.minFrequencyHz ?? 80;
    const maxFrequencyHz = options?.maxFrequencyHz ?? 1000;
    const minRms = options?.minRms ?? 0.01;
    const minCorrelation = options?.minCorrelation ?? 0.6;
    const frames: DetectedPitchFrame[] = [];

    for (let offset = 0; offset + frameSize <= mono.length; offset += hopSize) {
      const frame = mono.slice(offset, offset + frameSize);
      const timeMs = (offset / audioBuffer.sampleRate) * 1000;
      const rms = rootMeanSquare(frame);

      if (rms < minRms) {
        frames.push({
          timeMs,
          frequencyHz: null,
          midi: null,
          confidence: 0,
          rms,
        });
        continue;
      }

      const { frequencyHz, correlation } = detectFrequencyFromAutocorrelation(
        frame,
        audioBuffer.sampleRate,
        minFrequencyHz,
        maxFrequencyHz
      );
      const confidence = Math.max(0, Math.min(1, (correlation - minCorrelation) / 0.3));

      if (!frequencyHz || correlation < minCorrelation) {
        frames.push({
          timeMs,
          frequencyHz: null,
          midi: null,
          confidence,
          rms,
        });
        continue;
      }

      frames.push({
        timeMs,
        frequencyHz,
        midi: frequencyToMidi(frequencyHz),
        confidence,
        rms,
      });
    }

    return frames;
  } finally {
    await context.close();
  }
}

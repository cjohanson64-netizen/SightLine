import type {
  Confidence,
  DurationMs,
  FrequencyHz,
  TimestampMs,
} from "./primitives";

export interface PcmAudioBuffer {
  sampleRate: number;
  channelCount: number;
  frameCount: number;
  channels: Float32Array[];
  durationMs: DurationMs;
}

export interface IntakeRequest {
  exerciseId: string;
}

export interface IntakeOutput {
  exerciseId: string;
  scaleAudio: PcmAudioBuffer;
  melodyAudio: PcmAudioBuffer;
}

export interface RawPitchFrame {
  frameIndex: number;
  timeMs: TimestampMs;
  pitchHz: FrequencyHz | null;
  clarity: Confidence;
  isVoiced: boolean;
}

export interface PitchExtractionInput {
  melodyAudio: PcmAudioBuffer;
  frameSize: number;
  hopSize: number;
  clarityThreshold?: number;
}

export interface PitchExtractionOutput {
  frames: RawPitchFrame[];
}

export interface CleanPitchFrame {
  frameIndex: number;
  timeMs: TimestampMs;
  rawPitchHz?: FrequencyHz;
  stablePitchHz: FrequencyHz;
  clarity: Confidence;
}

export interface SignalCleaningInput {
  frames: RawPitchFrame[];
  clarityThreshold: number;
  smoothingWindowSize: number;
}

export interface SignalCleaningOutput {
  frames: CleanPitchFrame[];
}

import type { Confidence, FrequencyHz, MidiNumber, PitchClass } from "./primitives";
import type { PcmAudioBuffer } from "./audio";

export interface KeyDetectionInput {
  scaleAudio: PcmAudioBuffer;
}

export interface DetectedTonic {
  tonicHz: FrequencyHz;
  tonicMidi: MidiNumber;
  tonicPitchClass: PitchClass;
  tonicNoteName: string;
  confidence: Confidence;
}

export interface KeyDetectionOutput {
  tonic: DetectedTonic;
}

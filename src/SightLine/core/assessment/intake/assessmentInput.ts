import type { MelodyEvent } from "@/SightLine/domain/music";

export type PcmAudioBuffer = {
  samples: Float32Array;
  sampleRate: number;
};

export type AssessmentInput = {
  /**
   * Stable identifier for the exercise being assessed.
   *
   * This is useful for logs, debugging, saved attempts, and future analytics.
   */
  exerciseId: string;

  /**
   * The generated melody the student was asked to sing.
   *
   * intake/buildExpectedAssessment.ts converts this into:
   * - expected notes
   * - expected intervals
   * - expected rhythm units
   */
  melody: MelodyEvent[];

  /**
   * The student's recorded melody audio.
   *
   * This is the normal input path for live assessment.
   */
  audio: PcmAudioBuffer;

  /**
   * Optional identifier for the student attempt.
   *
   * Useful later if attempts are saved, reviewed, or compared.
   */
  attemptId?: string;

  /**
   * Optional timestamp for when the attempt was created.
   *
   * The assessment pipeline should not depend on this for scoring.
   */
  recordedAt?: string;

  /**
   * Optional debug flag.
   *
   * The orchestrator may use this to include extra intermediate data in the
   * returned result, but individual domain folders should not depend on it for
   * scoring behavior.
   */
  includeDebugData?: boolean;
};

export function validateAssessmentInput(input: AssessmentInput): void {
  validateExerciseId(input.exerciseId);
  validateMelody(input.melody);
  validateAudio(input.audio);
}

function validateExerciseId(exerciseId: string): void {
  if (typeof exerciseId !== "string" || exerciseId.trim().length === 0) {
    throw new Error("Assessment input requires a valid exerciseId.");
  }
}

function validateMelody(melody: MelodyEvent[]): void {
  if (!Array.isArray(melody) || melody.length === 0) {
    throw new Error("Assessment input requires a non-empty melody.");
  }
}

function validateAudio(audio: PcmAudioBuffer): void {
  if (!audio) {
    throw new Error("Assessment input requires an audio buffer.");
  }

  if (!(audio.samples instanceof Float32Array)) {
    throw new Error("Assessment audio samples must be a Float32Array.");
  }

  if (audio.samples.length === 0) {
    throw new Error("Assessment audio samples cannot be empty.");
  }

  if (
    typeof audio.sampleRate !== "number" ||
    !Number.isFinite(audio.sampleRate) ||
    audio.sampleRate <= 0
  ) {
    throw new Error("Assessment audio requires a valid sampleRate.");
  }
}
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMelodyAssessment } from "../../src/SightLine/core/assessment/evaluateMelodyAssessment";
import { buildAssessmentScoreSummary } from "../../src/SightLine/core/assessmentLogs/scoring";
import type { MelodyEvent } from "../../src/SightLine/domain/music/types";

const PITCH_CLASSES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

function midiToPitchParts(midi: number): { pitch: string; octave: number } {
  return {
    pitch: PITCH_CLASSES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
  };
}

function makeMelody(midis: number[]): MelodyEvent[] {
  return midis.map((midi, index) => {
    const { pitch, octave } = midiToPitchParts(midi);
    return {
      pitch,
      octave,
      midi,
      duration: "quarter",
      durationBeats: 1,
      measure: 1,
      beat: index + 1,
      onsetBeat: index + 1,
      phraseIndex: 0,
      role: "ChordTone",
      reason: "test fixture",
      chordId: `test-${index + 1}`,
      keyId: "C-major",
      isAttack: true,
    };
  });
}

function scoreAttempt(targetMidis: number[], performedMidis: number[]) {
  const assessment = evaluateMelodyAssessment({
    targetMelody: makeMelody(targetMidis),
    performedMelody: makeMelody(performedMidis),
    mode: "literal",
  });

  const scores = buildAssessmentScoreSummary({
    assessment,
    segmentedNotes: assessment.notes.map(() => ({ status: "clear" })) as never[],
  });

  return { assessment, scores };
}

test("local mistake with recovery earns bounded interval rescue credit", () => {
  const { assessment, scores } = scoreAttempt(
    [60, 62, 64, 65, 67],
    [60, 64, 64, 65, 67],
  );

  assert.equal(assessment.notes[1]?.intervalRecoveryApplied, true);
  assert.ok((assessment.notes[1]?.intervalRecoveryCredit ?? 0) > 0);
  assert.equal(assessment.recovery.intervalRescue.applicable, true);
  assert.deepEqual(assessment.recovery.intervalRescue.rescuedNoteIndices, [1]);
  assert.ok(scores.pitchScore > 80);
  assert.ok(scores.pitchScore < 100);
});

test("short shifted phrase with preserved interval logic gets rescue across the drift span", () => {
  const rescued = scoreAttempt(
    [60, 62, 64, 65, 67],
    [60, 64, 66, 67, 67],
  );
  const drifted = scoreAttempt(
    [60, 62, 64, 65, 67],
    [60, 66, 61, 68, 62],
  );

  assert.equal(rescued.assessment.recovery.intervalRescue.applicable, true);
  assert.ok(rescued.assessment.recovery.intervalRescue.rescuedNoteIndices.length >= 2);
  assert.ok(rescued.scores.pitchScore > drifted.scores.pitchScore);
});

test("unrecoverable drift does not receive interval rescue credit", () => {
  const { assessment, scores } = scoreAttempt(
    [60, 62, 64, 65, 67],
    [60, 66, 61, 68, 62],
  );

  assert.equal(assessment.recovery.intervalRescue.applicable, false);
  assert.equal(
    assessment.notes.some((note) => note.intervalRecoveryApplied),
    false,
  );
  assert.ok(scores.pitchScore <= 20);
});

test("advanced accurate singing still scores as fully correct", () => {
  const { assessment, scores } = scoreAttempt(
    [60, 62, 64, 65, 67],
    [60, 62, 64, 65, 67],
  );

  assert.equal(scores.pitchScore, 100);
  assert.equal(assessment.summary.pitchIncorrectCount, 0);
  assert.equal(assessment.recovery.intervalRescue.applicable, false);
});

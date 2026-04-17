import {
  KEY_TO_PC,
  midiToPc,
  midiToPitch,
  pitchOctaveForMidi,
  prefersFlatsForKey,
} from "@/SightLine/core/midi";
import { detectPitchFrames } from "@/SightLine/core/audio/detectPitchFrames";
import { segmentPerformedMelody } from "@/SightLine/core/audio/segmentPerformedMelody";
import type { MelodyEvent } from "@/SightLine/domain/music";
import type {
  CalibratedDegreeProfile,
  CalibrationProfile,
  CalibrationRunResult,
  CalibrationSignalQuality,
} from "./types";

interface AnalyzeCalibrationInput {
  audioBlob: Blob;
  targetMelody: MelodyEvent[];
}

const CALIBRATION_LABELS = ["do", "re", "mi", "fa", "sol", "la", "ti", "do"];

function weightedMedian(
  entries: Array<{ value: number; weight: number }>,
): number | null {
  if (entries.length === 0) {
    return null;
  }
  const sorted = [...entries].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  let running = 0;
  for (const entry of sorted) {
    running += entry.weight;
    if (running >= totalWeight / 2) {
      return entry.value;
    }
  }
  return sorted[sorted.length - 1].value;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function medianAbsoluteDeviation(
  values: number[],
  center: number,
): number | null {
  if (values.length === 0) {
    return null;
  }
  const deviations = values.map((value) => Math.abs(value - center));
  return median(deviations);
}

function buildCalibrationTarget(targetMelody: MelodyEvent[]): MelodyEvent[] {
  const active = targetMelody.filter((event) => event.isAttack !== false);
  const anchor = active[0];
  if (!anchor) {
    throw new Error("Generate a melody before calibrating.");
  }

  const [keyRaw = "C", modeRaw = "major"] = String(
    anchor.keyId ?? "C-major",
  ).split("-");
  const mode = modeRaw === "minor" ? "minor" : "major";
  const tonicPc = KEY_TO_PC[keyRaw] ?? midiToPc(anchor.midi);
  const degreeOffsets =
    mode === "minor" ? [0, 2, 3, 5, 7, 8, 10, 12] : [0, 2, 4, 5, 7, 9, 11, 12];
  const meanOffset =
    degreeOffsets.reduce((sum, value) => sum + value, 0) / degreeOffsets.length;
  const medianTargetMidi =
    [...active.map((event) => event.midi)].sort((a, b) => a - b)[
      Math.floor(active.length / 2)
    ] ?? anchor.midi;
  const desiredTonicCenter = medianTargetMidi - meanOffset;

  let tonicMidi = 60;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let octave = 2; octave <= 6; octave += 1) {
    const candidate = (octave + 1) * 12 + tonicPc;
    const distance = Math.abs(candidate - desiredTonicCenter);
    if (distance < bestDistance) {
      bestDistance = distance;
      tonicMidi = candidate;
    }
  }

  const preferFlats = prefersFlatsForKey(keyRaw, mode);

  return degreeOffsets.map((offset, index) => {
    const midi = tonicMidi + offset;
    return {
      pitch: midiToPitch(midi, { preferFlats, key: keyRaw, mode }),
      octave: pitchOctaveForMidi(midi, { preferFlats, key: keyRaw, mode }),
      midi,
      duration: "quarter",
      durationBeats: 1,
      measure: 1,
      beat: index + 1,
      onsetBeat: index + 1,
      phraseIndex: 0,
      role: "ChordTone",
      reason: "Calibration anchor",
      chordId: `calibration-${index + 1}`,
      keyId: `${keyRaw}-${mode}`,
      isAttack: true,
    };
  });
}

function classifySignalQuality(
  usableCount: number,
  avgConfidence: number | null,
  avgStability: number | null,
): CalibrationSignalQuality {
  const score =
    (avgConfidence ?? 0) * 0.5 +
    (avgStability ?? 0) * 0.35 +
    Math.min(1, usableCount / 8) * 0.15;
  if (score >= 0.75) {
    return "good";
  }
  if (score >= 0.5) {
    return "fair";
  }
  return "poor";
}

function degreeStability(
  note: CalibrationRunResult["segmentedNotes"][number],
): number {
  const spread = note.stablePitchSpread ?? note.pitchSpread ?? 2.5;
  return Math.max(0, Math.min(1, 1 - spread / 2.5));
}

function buildDegreeProfiles(
  calibrationTarget: MelodyEvent[],
  segmentedNotes: CalibrationRunResult["segmentedNotes"],
): CalibratedDegreeProfile[] {
  return calibrationTarget.map((targetNote, index) => {
    const detected = segmentedNotes[index];
    return {
      degree: (index + 1) as CalibratedDegreeProfile["degree"],
      label: CALIBRATION_LABELS[index] ?? `degree-${index + 1}`,
      expectedPitch: targetNote.pitch,
      expectedMidi: targetNote.midi,
      detectedMidi: detected?.midi ?? null,
      center: detected?.pitchCenter ?? null,
      offsetFromExpected:
        detected?.pitchCenter !== null
          ? detected.pitchCenter - targetNote.midi
          : null,
      confidence: detected?.confidence ?? 0,
      stability: detected ? degreeStability(detected) : 0,
      status: detected?.status ?? "missing",
    };
  });
}

function buildProfile(
  calibrationTarget: MelodyEvent[],
  segmentedNotes: CalibrationRunResult["segmentedNotes"],
): CalibrationProfile {
  const usableNotes = segmentedNotes.filter(
    (note) => note.pitchCenter !== null && note.status !== "missing",
  );
  const degrees = buildDegreeProfiles(calibrationTarget, segmentedNotes);
  const offsetEntries = usableNotes
    .filter(
      (note) =>
        typeof note.expectedMidi === "number" &&
        typeof note.pitchCenter === "number",
    )
    .map((note) => ({
      value: (note.pitchCenter as number) - (note.expectedMidi as number),
      weight: Math.max(0.1, note.confidence),
    }));

  const rawOffsets = offsetEntries.map((entry) => entry.value);
  const rawMedianOffset = median(rawOffsets);

  const coherentEntries =
    rawMedianOffset === null
      ? offsetEntries
      : offsetEntries.filter(
          (entry) => Math.abs(entry.value - rawMedianOffset) <= 0.6,
        );

  const phraseOffset = weightedMedian(coherentEntries);
  const offsetSpread =
    phraseOffset === null
      ? null
      : medianAbsoluteDeviation(
          coherentEntries.map((entry) => entry.value),
          phraseOffset,
        );
  const averageConfidence = average(usableNotes.map((note) => note.confidence));
  const averagePitchStability = average(
    usableNotes.map((note) => degreeStability(note)),
  );
  const signalQuality = classifySignalQuality(
    usableNotes.length,
    averageConfidence,
    averagePitchStability,
  );
  const tonicMidi =
    phraseOffset !== null && typeof calibrationTarget[0]?.midi === "number"
      ? calibrationTarget[0].midi + phraseOffset
      : null;
  const coherentDegreeCount = coherentEntries.length;
  const coherence: "high" | "medium" | "low" =
    offsetSpread === null
      ? "low"
      : offsetSpread <= 0.2
        ? "high"
        : offsetSpread <= 0.45
          ? "medium"
          : "low";

  const successful =
    usableNotes.length >= 6 &&
    coherentDegreeCount >= 5 &&
    (averageConfidence ?? 0) >= 0.5 &&
    signalQuality !== "poor" &&
    coherence !== "low";

  return {
    successful,
    keyId: calibrationTarget[0]?.keyId ?? null,
    tonicMidi,
    tonicOffsetSemitones: phraseOffset,
    registerOffset:
      phraseOffset !== null ? Math.round(phraseOffset / 12) * 12 : null,
    averageConfidence,
    averagePitchStability,
    overallConfidence: averageConfidence,
    signalQuality,
    summary: successful
      ? "Full-scale calibration complete."
      : coherence === "low"
        ? "Calibration heard the scale, but the tonal center was not consistent enough. Try again in a more comfortable key."
        : "Calibration was only partly clear. Try the full scale again for a stronger listening guide.",
    expectedPatternLabels: CALIBRATION_LABELS,
    expectedMidis: calibrationTarget.map((note) => note.midi),
    detectedCenters: segmentedNotes.map((note) => note.pitchCenter),
    degrees,
    offsetSpreadSemitones: offsetSpread,
    coherentDegreeCount,
    coherence,
  };
}

export async function analyzeCalibration(
  input: AnalyzeCalibrationInput,
): Promise<CalibrationRunResult> {
  if (input.targetMelody.length === 0) {
    throw new Error("Generate a melody before calibrating.");
  }

  const calibrationTarget = buildCalibrationTarget(input.targetMelody);
  const frames = await detectPitchFrames(input.audioBlob);
  const voicedFrames = frames.filter(
    (frame) => frame.midi !== null && frame.confidence >= 0.45,
  );

  if (voicedFrames.length < 6) {
    throw new Error(
      "I couldn't hear enough stable pitch for calibration. Try again in a quieter space.",
    );
  }

  const { cleanedFrames, segmentedNotes } = segmentPerformedMelody(
    frames,
    calibrationTarget,
    {
      disableContourSanity: true,
      disablePhraseLevelSmoothing: true,
    },
  );
  const usableCount = segmentedNotes.filter(
    (note) => note.pitchCenter !== null && note.status !== "missing",
  ).length;

  if (usableCount < 4) {
    throw new Error(
      "I couldn't hear the calibration pattern clearly enough. Sing do re mi fa sol la ti do a little more clearly and try again.",
    );
  }

  const profile = buildProfile(calibrationTarget, segmentedNotes);
  const warnings: string[] = [];

  if (!profile.successful) {
    warnings.push(
      "Calibration was usable, but the pitch center was not fully stable yet.",
    );
  }
  if (profile.signalQuality === "poor") {
    warnings.push(
      "The calibration signal was noisy, so it will only be used very lightly.",
    );
  }
  if (profile.coherence === "low") {
    warnings.push(
      "Calibration tonal center varied too much across the scale, so it should not be trusted strongly yet.",
    );
  }

  return {
    profile,
    frames,
    cleanedFrames,
    segmentedNotes,
    warnings,
  };
}

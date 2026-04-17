import {
  KEY_TO_PC,
  midiToPc,
  midiToPitch,
  pitchOctaveForMidi,
  prefersFlatsForKey,
} from "@/SightLine/core/midi";
import { alignPerformedToTarget } from "@/SightLine/core/audio/alignPerformedToTarget";
import type { SegmentedPerformedNote } from "@/SightLine/core/audio/types";
import type { CalibrationProfile } from "@/SightLine/core/calibration/types";
import type {
  AssessmentComparisonMode,
  MelodyAssessmentResult,
  TonalFrameCandidateAnalysis,
  TonalFrameKind,
  TonalFrameSelectionAnalysis,
} from "@/SightLine/domain/assessment";
import type { MelodyEvent } from "@/SightLine/domain/music";
import { buildAssessmentScoreSummary } from "../assessmentLogs/scoring";
import { evaluateMelodyAssessment } from "./evaluateMelodyAssessment";

interface TonalFrameCandidate {
  kind: TonalFrameKind;
  label: string;
  semitoneOffset: number;
  source: "written" | "calibration";
  targetMelody: MelodyEvent[];
}

interface SelectAssessmentTonalFrameInput {
  writtenTargetMelody: MelodyEvent[];
  segmentedNotes: SegmentedPerformedNote[];
  mode: AssessmentComparisonMode;
  calibrationProfile?: CalibrationProfile | null;
}

interface SelectAssessmentTonalFrameResult {
  selectedTargetMelody: MelodyEvent[];
  selectedAlignedMelody: MelodyEvent[];
  selectedTargetIndices: number[];
  analysis: TonalFrameSelectionAnalysis;
}

const SHARP_KEYS = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];
const FLAT_KEYS = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeSignedPitchClassOffset(value: number): number {
  const normalized = ((value % 12) + 12) % 12;
  return normalized > 6 ? normalized - 12 : normalized;
}

function weightedAverage(
  entries: Array<{ value: number; weight: number }>,
): number | null {
  if (entries.length === 0) {
    return null;
  }
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }
  return (
    entries.reduce((sum, entry) => sum + entry.value * entry.weight, 0) /
    totalWeight
  );
}

function deriveCalibrationOffset(
  profile: CalibrationProfile | null | undefined,
): number | null {
  if (
    !profile?.successful ||
    profile.signalQuality === "poor" ||
    profile.coherence === "low"
  ) {
    return null;
  }

  const coherentDegrees = profile.degrees.filter(
    (degree) =>
      typeof degree.offsetFromExpected === "number" &&
      degree.status !== "missing" &&
      degree.confidence >= 0.45 &&
      degree.stability >= 0.35,
  );

  if (coherentDegrees.length < 5) {
    return null;
  }

  const weightedDegreeOffset = weightedAverage(
    coherentDegrees.map((degree) => ({
      value: degree.offsetFromExpected as number,
      weight: Math.max(
        0.15,
        degree.confidence * Math.max(0.2, degree.stability),
      ),
    })),
  );

  const rawOffset =
    weightedDegreeOffset ??
    (typeof profile.tonicOffsetSemitones === "number"
      ? profile.tonicOffsetSemitones
      : null);

  if (rawOffset === null || Number.isNaN(rawOffset)) {
    return null;
  }

  const rounded = Math.round(rawOffset);
  const normalized = normalizeSignedPitchClassOffset(rounded);
  return normalized === 0 ? null : normalized;
}

function transposeKeyName(
  key: string | null | undefined,
  mode: "major" | "minor",
  semitoneOffset: number,
): string | null {
  if (!key || !(key in KEY_TO_PC)) {
    return null;
  }
  const nextPc = midiToPc((KEY_TO_PC[key] ?? 0) + semitoneOffset);
  const preferFlats = prefersFlatsForKey(key as never, mode);
  const names = preferFlats ? FLAT_KEYS : SHARP_KEYS;
  return names[nextPc] ?? null;
}

function transposeTargetMelody(
  targetMelody: MelodyEvent[],
  semitoneOffset: number,
): MelodyEvent[] {
  if (semitoneOffset === 0) {
    return targetMelody;
  }

  return targetMelody.map((event) => {
    const [keyRaw = "C", modeRaw = "major"] = String(
      event.keyId ?? "C-major",
    ).split("-");
    const mode = modeRaw === "minor" ? "minor" : "major";
    const nextKey = transposeKeyName(keyRaw, mode, semitoneOffset) ?? keyRaw;
    const shiftedMidi = event.midi + semitoneOffset;
    const preferFlats = prefersFlatsForKey(nextKey as never, mode);

    return {
      ...event,
      midi: shiftedMidi,
      pitch: midiToPitch(shiftedMidi, {
        preferFlats,
        key: nextKey as never,
        mode,
      }),
      octave: pitchOctaveForMidi(shiftedMidi, {
        preferFlats,
        key: nextKey as never,
        mode,
      }),
      keyId: `${nextKey}-${mode}`,
      originalMidi: event.originalMidi ?? event.midi,
    };
  });
}

function isStructuralNote(event: MelodyEvent | null | undefined): boolean {
  if (!event || event.isAttack === false) {
    return false;
  }
  if (event.nonHarmonicTone) {
    return false;
  }
  return (
    event.role !== "NonHarmonicTone" ||
    event.functionTags?.includes("structural") === true ||
    event.functionTags?.includes("climax") === true ||
    event.functionTags?.includes("cadence") === true
  );
}

function buildCandidateAnalysis(
  candidate: TonalFrameCandidate,
  assessment: MelodyAssessmentResult,
  segmentedNotes: SegmentedPerformedNote[],
  calibrationOffset: number | null,
  calibrationProfile: CalibrationProfile | null | undefined,
): TonalFrameCandidateAnalysis {
  const scoreSummary = buildAssessmentScoreSummary({
    assessment,
    segmentedNotes,
  });
  const noteCount = Math.max(1, assessment.summary.targetNoteCount);
  const exactCount = assessment.notes.filter(
    (note) => note.absDelta === 0,
  ).length;
  const adjacentCount = assessment.notes.filter(
    (note) => note.absDelta === 1,
  ).length;
  const structuralIndices = assessment.notes
    .map((note, index) =>
      isStructuralNote(note.target?.sourceEvent ?? null) ? index : -1,
    )
    .filter((index) => index >= 0);
  const structuralExactCount = structuralIndices.filter(
    (index) => assessment.notes[index]?.absDelta === 0,
  ).length;
  const cadenceIndices = assessment.notes
    .map((note, index) =>
      note.target?.sourceEvent.functionTags?.includes("cadence") ? index : -1,
    )
    .filter((index) => index >= 0);
  const cadenceExactCount = cadenceIndices.filter(
    (index) => assessment.notes[index]?.absDelta === 0,
  ).length;
  const contourComparable =
    assessment.summary.contourCorrectCount +
    assessment.summary.contourIncorrectCount;
  const intervalComparable =
    assessment.summary.intervalCorrectCount +
    assessment.summary.intervalIncorrectCount;
  const contourFit =
    contourComparable > 0
      ? assessment.summary.contourCorrectCount / contourComparable
      : 0;
  const intervalFit =
    intervalComparable > 0
      ? assessment.summary.intervalCorrectCount / intervalComparable
      : 0;
  const structuralFit =
    structuralIndices.length > 0
      ? structuralExactCount / structuralIndices.length
      : exactCount / noteCount;
  const localPitchFit = clamp01(
    (exactCount + adjacentCount * 0.35) / noteCount,
  );
  const cadenceFit =
    cadenceIndices.length > 0
      ? cadenceExactCount / cadenceIndices.length
      : localPitchFit;
  const rescuePressure =
    assessment.notes.filter((note, index) => {
      const segmented = segmentedNotes[index];
      if ((note.absDelta ?? 0) < 1) {
        return false;
      }
      return (
        segmented?.status === "weak" ||
        segmented?.status === "ambiguous" ||
        segmented?.targetConsistentAmbiguity === true
      );
    }).length / noteCount;
  const calibrationOverallConfidence =
    calibrationProfile?.overallConfidence ?? null;
  const calibrationSignalQuality = calibrationProfile?.signalQuality ?? null;
  const calibrationSupport =
    candidate.kind === "calibration_transposed" &&
    calibrationOffset !== null &&
    candidate.semitoneOffset === calibrationOffset &&
    calibrationOverallConfidence !== null
      ? clamp01(
          calibrationOverallConfidence *
            (calibrationSignalQuality === "good" ? 1 : 0.7),
        )
      : 0;
  const pitchScore = scoreSummary.pitchScore / 100;
  const totalScore = clamp01(
    pitchScore * 0.34 +
      structuralFit * 0.22 +
      localPitchFit * 0.14 +
      intervalFit * 0.12 +
      contourFit * 0.08 +
      cadenceFit * 0.06 +
      calibrationSupport * 0.09 -
      rescuePressure * 0.1,
  );

  const rationale = [
    `pitch ${(pitchScore * 100).toFixed(0)}%`,
    `structural ${(structuralFit * 100).toFixed(0)}%`,
    `interval ${(intervalFit * 100).toFixed(0)}%`,
    `contour ${(contourFit * 100).toFixed(0)}%`,
    `cadence ${(cadenceFit * 100).toFixed(0)}%`,
  ];
  if (calibrationSupport > 0) {
    rationale.push(
      `calibration support ${(calibrationSupport * 100).toFixed(0)}%`,
    );
  }
  if (rescuePressure > 0) {
    rationale.push(`rescue pressure ${(rescuePressure * 100).toFixed(0)}%`);
  }

  return {
    kind: candidate.kind,
    label: candidate.label,
    semitoneOffset: candidate.semitoneOffset,
    source: candidate.source,
    targetKeyId: candidate.targetMelody[0]?.keyId ?? null,
    pitchScore: Number((pitchScore * 100).toFixed(0)),
    localPitchFit: Number(localPitchFit.toFixed(3)),
    structuralFit: Number(structuralFit.toFixed(3)),
    intervalFit: Number(intervalFit.toFixed(3)),
    contourFit: Number(contourFit.toFixed(3)),
    cadenceFit: Number(cadenceFit.toFixed(3)),
    rescuePressure: Number(rescuePressure.toFixed(3)),
    calibrationSupport: Number(calibrationSupport.toFixed(3)),
    totalScore: Number(totalScore.toFixed(3)),
    accepted: false,
    rationale,
  };
}

function buildDefaultSelectionAnalysis(): TonalFrameSelectionAnalysis {
  return {
    selectedKind: "written",
    selectedLabel: "Written target",
    selectedSemitoneOffset: 0,
    comparedAgainstWritten: false,
    calibrationProposedOffset: null,
    usedCalibrationProfile: false,
    rationale: ["Only the written target frame was available."],
    candidates: [],
  };
}

export function selectAssessmentTonalFrame(
  input: SelectAssessmentTonalFrameInput,
): SelectAssessmentTonalFrameResult {
  const calibrationOffset = deriveCalibrationOffset(
    input.calibrationProfile ?? null,
  );
  const candidates: TonalFrameCandidate[] = [
    {
      kind: "written",
      label: "Written target",
      semitoneOffset: 0,
      source: "written",
      targetMelody: input.writtenTargetMelody,
    },
  ];

  if (calibrationOffset !== null) {
    candidates.push({
      kind: "calibration_transposed",
      label: `Calibration transposed (${calibrationOffset > 0 ? "+" : ""}${calibrationOffset})`,
      semitoneOffset: calibrationOffset,
      source: "calibration",
      targetMelody: transposeTargetMelody(
        input.writtenTargetMelody,
        calibrationOffset,
      ),
    });
  }

  if (candidates.length === 1) {
    const selected = candidates[0];
    const aligned = alignPerformedToTarget(
      input.segmentedNotes,
      selected.targetMelody,
    );
    return {
      selectedTargetMelody: selected.targetMelody,
      selectedAlignedMelody: aligned.alignedMelody,
      selectedTargetIndices: aligned.targetIndices,
      analysis: buildDefaultSelectionAnalysis(),
    };
  }

  const candidateAnalyses = candidates.map((candidate) => {
    const aligned = alignPerformedToTarget(
      input.segmentedNotes,
      candidate.targetMelody,
    );
    const assessment = evaluateMelodyAssessment({
      targetMelody: candidate.targetMelody,
      performedMelody: aligned.alignedMelody,
      performedDurationsMs: input.segmentedNotes.map((note) =>
        note.midi !== null && note.durationMs > 0 ? note.durationMs : null,
      ),
      performedStartsMs: input.segmentedNotes.map((note) =>
        note.midi !== null ? note.startMs : null,
      ),
      performedEndsMs: input.segmentedNotes.map((note) =>
        note.midi !== null ? note.endMs : null,
      ),
      performedWindowStatuses: input.segmentedNotes.map((note) => note.status),
      mode: input.mode,
      calibrationOffsetHint: null,
      calibrationSignalQuality: input.calibrationProfile?.signalQuality ?? null,
    });

    return {
      candidate,
      aligned,
      analysis: buildCandidateAnalysis(
        candidate,
        assessment,
        input.segmentedNotes,
        calibrationOffset,
        input.calibrationProfile,
      ),
    };
  });

  const written = candidateAnalyses.find(
    (entry) => entry.candidate.kind === "written",
  )!;
  const transposed = candidateAnalyses.find(
    (entry) => entry.candidate.kind === "calibration_transposed",
  )!;

  // Determine raw advantage
  const scoreDiff =
    transposed.analysis.totalScore - written.analysis.totalScore;

  // Strong win threshold
  const STRONG_WIN = 0.08; // clear improvement
  const SOFT_WIN = 0.03; // slight improvement

  // Check if transposed is clearly better
  const isStrongWin = scoreDiff >= STRONG_WIN;

  // Check if transposed is slightly better but not risky
  const isSoftWin =
    scoreDiff >= SOFT_WIN &&
    transposed.analysis.structuralFit >= written.analysis.structuralFit - 0.1;

  // Check if written frame is clearly superior structurally
  const writtenClearlyBetterStructurally =
    written.analysis.structuralFit >= transposed.analysis.structuralFit + 0.15;

  // Final decision
  let useTransposedFrame = false;

  if (isStrongWin) {
    useTransposedFrame = true;
  } else if (isSoftWin && !writtenClearlyBetterStructurally) {
    useTransposedFrame = true;
  } else {
    useTransposedFrame = false;
  }

  const selected = useTransposedFrame ? transposed : written;
  const analyses = candidateAnalyses
    .map((entry) => ({
      ...entry.analysis,
      accepted: entry.candidate.kind === selected.candidate.kind,
    }))
    .sort((a, b) => b.totalScore - a.totalScore);

  let decisionReason = "";

  if (useTransposedFrame) {
    decisionReason =
      scoreDiff >= STRONG_WIN
        ? "Calibration-transposed frame selected due to strong score advantage."
        : "Calibration-transposed frame selected due to moderate score advantage with acceptable structural fit.";
  } else {
    decisionReason = writtenClearlyBetterStructurally
      ? "Written frame retained due to significantly stronger structural alignment."
      : "Written frame retained due to insufficient advantage from calibration-transposed frame.";
  }

  const rationale = useTransposedFrame
    ? [
        `Selected calibration-transposed frame because it explained the performance better than the written frame (${(transposed.analysis.totalScore * 100).toFixed(0)} vs ${(written.analysis.totalScore * 100).toFixed(0)}).`,
        `Pitch fit improved from ${written.analysis.pitchScore}% to ${transposed.analysis.pitchScore}%.`,
        `Structural fit improved from ${(written.analysis.structuralFit * 100).toFixed(0)}% to ${(transposed.analysis.structuralFit * 100).toFixed(0)}%.`,
        `Frame decision: ${decisionReason}`,
        `Score diff: ${(scoreDiff * 100).toFixed(0)} points.`,
      ]
    : [
        `Kept the written frame because it remained the best explanation (${(written.analysis.totalScore * 100).toFixed(0)} vs ${(transposed.analysis.totalScore * 100).toFixed(0)}).`,
        `The calibration-transposed candidate did not improve pitch and structure enough to replace the written target.`,
        `Frame decision: ${decisionReason}`,
        `Score diff: ${(scoreDiff * 100).toFixed(0)} points.`,
      ];

  return {
    selectedTargetMelody: selected.candidate.targetMelody,
    selectedAlignedMelody: selected.aligned.alignedMelody,
    selectedTargetIndices: selected.aligned.targetIndices,
    analysis: {
      selectedKind: selected.candidate.kind,
      selectedLabel: selected.candidate.label,
      selectedSemitoneOffset: selected.candidate.semitoneOffset,
      comparedAgainstWritten: true,
      calibrationProposedOffset: calibrationOffset,
      usedCalibrationProfile: input.calibrationProfile?.successful === true,
      rationale,
      candidates: analyses,
    },
  };
}

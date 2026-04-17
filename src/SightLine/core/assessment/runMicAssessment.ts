import type {
  AssessmentComparisonMode,
  PitchAssessmentDisplayState,
  PitchIntonationBand,
  PitchAssessmentNote,
  PitchMatchKind,
} from "@/SightLine/domain/assessment";
import type { MelodyEvent } from "@/SightLine/domain/music";
import type { CalibrationProfile } from "@/SightLine/core/calibration/types";
import { alignPerformedToTarget } from "../audio/alignPerformedToTarget";
import { detectPitchFrames } from "../audio/detectPitchFrames";
import { segmentPerformedMelody } from "../audio/segmentPerformedMelody";
import type { MicAssessmentRunResult } from "../audio/types";
import { evaluateMelodyAssessment } from "./evaluateMelodyAssessment";
import { selectAssessmentTonalFrame } from "./selectAssessmentTonalFrame";
import { buildAssessmentScoreSummary } from "../assessmentLogs/scoring";

interface RunMicAssessmentInput {
  audioBlob: Blob;
  targetMelody: MelodyEvent[];
  mode: AssessmentComparisonMode;
  calibrationProfile?: CalibrationProfile | null;
}

function buildSignalQualitySummary(
  frames: MicAssessmentRunResult["frames"],
  cleanedFrames: MicAssessmentRunResult["cleanedFrames"],
  segmentedNotes: MicAssessmentRunResult["segmentedNotes"],
): MicAssessmentRunResult["signalQuality"] {
  const rejectedFrames = cleanedFrames.filter(
    (frame) => frame.rejectedReason !== null,
  );
  const rejectedForNoiseCount = cleanedFrames.filter(
    (frame) => frame.rejectedReason === "noise_floor",
  ).length;
  const ambiguousWindowCount = segmentedNotes.filter(
    (note) => note.status === "ambiguous",
  ).length;
  const targetConsistentAmbiguousCount = segmentedNotes.filter(
    (note) => note.status === "ambiguous" && note.targetConsistentAmbiguity,
  ).length;
  const onsetAdjustedWindowCount = segmentedNotes.filter(
    (note) => note.phraseInitialAdjusted || note.onsetAdjusted,
  ).length;
  const voicedFrames = frames.filter((frame) => frame.midi !== null);
  const cleanedVoicedFrames = cleanedFrames.filter(
    (frame) => frame.cleanedMidi !== null,
  );
  const voicedRetention =
    voicedFrames.length > 0
      ? cleanedVoicedFrames.length / voicedFrames.length
      : 0;
  const ambiguityPenalty =
    ambiguousWindowCount / Math.max(1, segmentedNotes.length);
  const score = Math.max(
    0,
    Math.min(
      1,
      voicedRetention * 0.55 +
        (1 - ambiguityPenalty) * 0.3 +
        (1 - rejectedForNoiseCount / Math.max(1, frames.length)) * 0.15,
    ),
  );

  const level = score >= 0.78 ? "high" : score >= 0.55 ? "medium" : "low";
  const summary =
    level === "high"
      ? "Input quality looked stable overall."
      : level === "medium"
        ? "Input quality was usable, but some noise or unstable onsets may have affected the result. Try singing with more breath energy."
        : "Input quality was limited by noise or unstable pitch support, so assessment confidence is lower. Try singing with more breath energy.";

  return {
    level,
    score,
    rejectedFrameCount: rejectedFrames.length,
    rejectedForNoiseCount,
    ambiguousWindowCount,
    targetConsistentAmbiguousCount,
    onsetAdjustedWindowCount,
    summary,
  };
}

function isWeakWindowCandidate(
  note: MicAssessmentRunResult["segmentedNotes"][number] | undefined,
): boolean {
  if (!note || note.midi === null) {
    return false;
  }

  const spread = note.stablePitchSpread ?? note.pitchSpread ?? 0;
  return (
    note.status === "weak" ||
    note.status === "ambiguous" ||
    note.targetConsistentAmbiguity ||
    note.usedFrameCount <= 1 ||
    note.confidence < 0.58 ||
    (note.usedFrameCount <= 2 && note.confidence < 0.68) ||
    (note.usedFrameCount <= 3 && spread > 1.25)
  );
}

function hasMusicallyUsableWeakEvidence(
  note: MicAssessmentRunResult["segmentedNotes"][number] | undefined,
): boolean {
  if (!note || note.midi === null || note.pitchCenter === null) {
    return false;
  }

  const spread =
    note.stablePitchSpread ?? note.pitchSpread ?? Number.POSITIVE_INFINITY;
  return (
    note.confidence >= 0.43 &&
    (note.usedFrameCount >= 2 || note.voicedFrameCount >= 3) &&
    spread <= 1.3 &&
    (note.targetConsistentAmbiguity ||
      (note.dominantBucketStrength ?? 0) >= 0.4)
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function contourAccuracy(
  assessment: MicAssessmentRunResult["assessment"],
): number {
  const comparable =
    assessment.summary.contourCorrectCount +
    assessment.summary.contourIncorrectCount;

  if (comparable === 0) {
    return assessment.summary.contourFullyCorrect ? 1 : 0;
  }

  return assessment.summary.contourCorrectCount / comparable;
}

const IN_TUNE_CENTS_MAX = 20;
const TUNED_CENTS_MAX = 40;
const LOOSE_CENTER_CENTS_MAX = 50;
const POOR_CENTER_CENTS_MAX = 75;
const BOUNDARY_CROSS_CENTS_MAX = 50;

function classifyCorrectNoteIntonationBand(
  centerDeviationCents: number | null,
): Exclude<PitchIntonationBand, "boundary_cross" | "adjacent_close" | null> {
  if (centerDeviationCents === null) {
    return "tuned";
  }

  const absCents = Math.abs(centerDeviationCents);
  if (absCents <= IN_TUNE_CENTS_MAX) {
    return "in_tune";
  }
  if (absCents <= TUNED_CENTS_MAX) {
    return "tuned";
  }
  if (absCents <= LOOSE_CENTER_CENTS_MAX) {
    return "loose_center";
  }
  return "poor_center";
}

function classifyAdjacentIntonationBand(
  centerDeviationCents: number | null,
): PitchIntonationBand {
  if (centerDeviationCents === null) {
    return "adjacent_close";
  }

  const absCents = Math.abs(centerDeviationCents);

  // Treat only true near-midpoint cases as boundary crossings.
  // Once the center clearly leans toward the neighboring semitone,
  // classify it as an actual adjacent-note hit.
  return absCents <= BOUNDARY_CROSS_CENTS_MAX
    ? "boundary_cross"
    : "adjacent_close";
}

function describeCorrectNoteBand(
  band: Exclude<
    PitchIntonationBand,
    "boundary_cross" | "adjacent_close" | null
  >,
  centerDeviationCents: number | null,
): string | null {
  const cents = Math.abs(centerDeviationCents ?? 0);
  const direction =
    centerDeviationCents === null || centerDeviationCents === 0
      ? null
      : centerDeviationCents < 0
        ? "low"
        : "high";

  switch (band) {
    case "in_tune":
      return "You centered this note very accurately.";
    case "tuned":
      return direction
        ? `You sang the right note with a solid center, about ${cents} cents ${direction}.`
        : "You sang the right note with a solid center.";
    case "loose_center":
      return direction
        ? `You sang the right note, but the center drifted about ${cents} cents ${direction}.`
        : "You sang the right note, but the center drifted a bit.";
    case "poor_center":
      return direction
        ? `You stayed on the right note class, but the center was about ${cents} cents ${direction}, so the pitch felt loose.`
        : "You stayed on the right note class, but the center was loose.";
  }
}

function applyConsistentPhraseBiasCorrection(
  assessment: MicAssessmentRunResult["assessment"],
  segmentedNotes: MicAssessmentRunResult["segmentedNotes"],
): MicAssessmentRunResult["assessment"] {
  const bias = assessment.globalOffsetCorrection.sessionPitchBias;
  const biasOffset = bias.offset;

  if (
    assessment.globalOffsetCorrection.applied ||
    !bias.strongConsistentBiasDetected ||
    typeof biasOffset !== "number" ||
    Math.abs(biasOffset) !== 1
  ) {
    return assessment;
  }

  const phraseIsMusicallyStable =
    contourAccuracy(assessment) >= 0.7 &&
    assessment.rhythm.accuracy.score >= 0.68 &&
    assessment.rhythm.flow.score >= 0.52;

  if (!phraseIsMusicallyStable) {
    return {
      ...assessment,
      globalOffsetCorrection: {
        ...assessment.globalOffsetCorrection,
        sessionPitchBias: {
          ...bias,
          reason:
            bias.reason ??
            "Consistent semitone drift was detected, but contour or rhythm support was too weak to promote it to phrase-level correction.",
        },
      },
    };
  }

  const comparableNoteCount = assessment.notes.filter(
    (note) =>
      note.target && note.performed && typeof note.scoringDelta === "number",
  ).length;

  const eligibleIndices = assessment.notes.flatMap((note, index) => {
    const segmented = segmentedNotes[index];
    if (
      !note.target ||
      !note.performed ||
      typeof note.scoringDelta !== "number" ||
      note.scoringDelta !== biasOffset ||
      note.matchKind !== "adjacent_semitone" ||
      typeof note.comparisonTargetMidi !== "number" ||
      typeof segmented?.pitchCenter !== "number"
    ) {
      return [];
    }

    const rawCenterDeviationCents = Math.round(
      (segmented.pitchCenter - note.comparisonTargetMidi) * 100,
    );
    const residualAfterBiasCents = rawCenterDeviationCents - biasOffset * 100;
    const stableSignal =
      segmented.status !== "missing" &&
      segmented.confidence >= 0.52 &&
      (segmented.usedFrameCount >= 2 || segmented.voicedFrameCount >= 3);
    const moderatePhraseDrift = Math.abs(rawCenterDeviationCents) <= 145;
    const biasResidualIsTight = Math.abs(residualAfterBiasCents) <= 45;

    return stableSignal && moderatePhraseDrift && biasResidualIsTight
      ? [index]
      : [];
  });

  const appliedSupportRatio =
    comparableNoteCount > 0 ? eligibleIndices.length / comparableNoteCount : 0;

  if (
    eligibleIndices.length <
      Math.max(3, Math.ceil(comparableNoteCount * 0.45)) ||
    appliedSupportRatio < Math.max(0.55, bias.supportRatio - 0.08)
  ) {
    return {
      ...assessment,
      globalOffsetCorrection: {
        ...assessment.globalOffsetCorrection,
        sessionPitchBias: {
          ...bias,
          reason: `Detected consistent ${biasOffset > 0 ? "+" : ""}${biasOffset} semitone phrase bias, but only ${Math.round(appliedSupportRatio * 100)}% of comparable notes stayed tight enough after correction to promote it.`,
        },
      },
    };
  }

  const eligibleIndexSet = new Set(eligibleIndices);
  const adjustedNotes: PitchAssessmentNote[] = assessment.notes.map(
    (note, index) => {
      if (!eligibleIndexSet.has(index)) {
        return { ...note };
      }

      const normalizedExpectedMidi =
        typeof note.normalizedExpectedMidi === "number"
          ? note.normalizedExpectedMidi + biasOffset
          : note.normalizedExpectedMidi;
      const comparisonTargetMidi =
        typeof note.comparisonTargetMidi === "number"
          ? note.comparisonTargetMidi + biasOffset
          : note.comparisonTargetMidi;
      const comparisonSemitoneDelta =
        comparisonTargetMidi !== null && note.performed
          ? note.performed.midi - comparisonTargetMidi
          : note.comparisonSemitoneDelta;
      const scoringDelta = (note.scoringDelta ?? 0) - biasOffset;
      const absDelta = Math.abs(scoringDelta);
      const matchKind: PitchMatchKind =
        absDelta === 0
          ? "exact"
          : absDelta === 1
            ? "adjacent_semitone"
            : "incorrect";
      const displayState: PitchAssessmentDisplayState =
        absDelta === 0
          ? "correct"
          : absDelta === 1
            ? "adjacent_semitone"
            : "incorrect";

      return {
        ...note,
        normalizedExpectedMidi,
        scoringDelta,
        absDelta,
        correctnessLocked: absDelta === 0,
        normalizedScoringUsed: true,
        comparisonTargetMidi,
        comparisonSemitoneDelta,
        matchKind,
        isCorrect: absDelta === 0,
        displayState,
        intonationBand: null,
        globalOffsetCorrectionApplied: true,
        appliedGlobalOffset: biasOffset,
        interpretationReason: null,
      };
    },
  );

  const correctedScore = adjustedNotes.reduce((sum, note) => {
    if (note.scoringDelta === null) {
      return sum;
    }
    const absDelta = Math.abs(note.scoringDelta);
    if (absDelta === 0) {
      return sum + 1;
    }
    if (absDelta === 1) {
      return sum + 0.85;
    }
    if (absDelta === 2) {
      return sum + 0.55;
    }
    return sum + 0.15;
  }, 0);
  const correctedAverageScore =
    comparableNoteCount > 0 ? correctedScore / comparableNoteCount : 0;
  const residualCents = eligibleIndices.flatMap((index) => {
    const segmented = segmentedNotes[index];
    const note = assessment.notes[index];
    if (
      typeof segmented?.pitchCenter !== "number" ||
      typeof note?.comparisonTargetMidi !== "number"
    ) {
      return [];
    }
    return [
      Math.round(
        (segmented.pitchCenter - (note.comparisonTargetMidi + biasOffset)) *
          100,
      ),
    ];
  });
  const medianResidualCents = median(residualCents);
  const improvement = Number(
    (correctedScore - assessment.globalOffsetCorrection.rawScore).toFixed(3),
  );
  const updatedCandidates =
    assessment.globalOffsetCorrection.consideredCandidates.length > 0
      ? assessment.globalOffsetCorrection.consideredCandidates.map(
          (candidate) =>
            candidate.offset === biasOffset
              ? {
                  ...candidate,
                  supportCount: eligibleIndices.length,
                  supportRatio: Number(appliedSupportRatio.toFixed(3)),
                  correctedAverageScore: Number(
                    correctedAverageScore.toFixed(3),
                  ),
                  improvement,
                  accepted: true,
                  rejectedReason: null,
                }
              : candidate,
        )
      : [
          {
            offset: biasOffset,
            exactSupportCount: eligibleIndices.length,
            supportCount: eligibleIndices.length,
            supportRatio: Number(appliedSupportRatio.toFixed(3)),
            correctedAverageScore: Number(correctedAverageScore.toFixed(3)),
            improvement,
            calibrationSupportedCandidate: false,
            accepted: true,
            rejectedReason: null,
          },
        ];

  return {
    ...assessment,
    notes: adjustedNotes,
    globalOffsetCorrection: {
      ...assessment.globalOffsetCorrection,
      candidateOffset: biasOffset,
      supportCount: eligibleIndices.length,
      supportRatio: Number(appliedSupportRatio.toFixed(3)),
      applied: true,
      calibrationContributed: false,
      calibrationSupportedCandidate: false,
      correctedScore: Number(correctedScore.toFixed(3)),
      correctedAverageScore: Number(correctedAverageScore.toFixed(3)),
      improvement,
      acceptedReason: `Detected consistent ${biasOffset > 0 ? "+" : ""}${biasOffset} semitone phrase bias across ${Math.round(appliedSupportRatio * 100)}% of comparable notes and promoted it to phrase-level correction.`,
      rejectedReason: null,
      consideredCandidates: updatedCandidates,
      sessionPitchBias: {
        ...bias,
        appliedAsPhraseCorrection: true,
        appliedNoteCount: eligibleIndices.length,
        appliedSupportRatio: Number(appliedSupportRatio.toFixed(3)),
        medianResidualCents,
        scoringImpact: `Phrase-bias correction adjusted ${eligibleIndices.length} note${eligibleIndices.length === 1 ? "" : "s"} before note-state classification and raised average pitch fit to ${Math.round(correctedAverageScore * 100)}%.`,
        reason: `Detected consistent ${biasOffset > 0 ? "+" : ""}${biasOffset} semitone phrase bias | support ${Math.round(bias.supportRatio * 100)}% | phrase-level adjustment applied.`,
      },
    },
  };
}

function applyWeakWindowInterpretation(
  assessment: MicAssessmentRunResult["assessment"],
  segmentedNotes: MicAssessmentRunResult["segmentedNotes"],
): MicAssessmentRunResult["assessment"] {
  const notes = assessment.notes.map((note) => ({ ...note }));

  notes.forEach((note, index) => {
    const segmented = segmentedNotes[index];
    const centerDeviationCents =
      typeof segmented?.pitchCenter === "number" &&
      typeof note.comparisonTargetMidi === "number"
        ? Math.round((segmented.pitchCenter - note.comparisonTargetMidi) * 100)
        : null;
    note.centerDeviationCents = centerDeviationCents;

    if (
      typeof segmented?.pitchCenter === "number" &&
      typeof note.comparisonTargetMidi === "number"
    ) {
      const pitchCenter = segmented.pitchCenter;
      const comparisonTargetMidi = note.comparisonTargetMidi;
      const centerBasedDelta = pitchCenter - comparisonTargetMidi;

      // Start with the literal rounded center delta.
      let centerBasedRoundedDelta = Math.round(centerBasedDelta);

      // If the note currently looks like an adjacent semitone, but the segmented
      // window has strong local calibration support, trust the calibration anchor.
      // This is especially important for TI, which often gets pulled upward toward DO.
      const calibrationStrongExactOverride =
        note.matchKind === "adjacent_semitone" &&
        segmented.calibrationSupportedLocalEvidence === true &&
        segmented.calibrationSupportLevel === "strong";

      if (calibrationStrongExactOverride) {
        centerBasedRoundedDelta = 0;
      }

      const centerBasedAbsDelta = Math.abs(centerBasedRoundedDelta);

      const exactContradictedByCenter =
        note.matchKind === "exact" &&
        typeof centerDeviationCents === "number" &&
        Math.abs(centerDeviationCents) >= 85 &&
        centerBasedAbsDelta >= 1;

      const adjacentContradictedByCenter =
        note.matchKind === "adjacent_semitone" &&
        !calibrationStrongExactOverride &&
        typeof centerDeviationCents === "number" &&
        Math.abs(centerDeviationCents) >= 115 &&
        centerBasedAbsDelta >= 2;

      if (
        exactContradictedByCenter ||
        adjacentContradictedByCenter ||
        calibrationStrongExactOverride
      ) {
        const correctedScoringDelta = centerBasedRoundedDelta;
        const correctedAbsDelta = Math.abs(correctedScoringDelta);

        note.scoringDelta = correctedScoringDelta;
        note.absDelta = correctedAbsDelta;
        note.comparisonSemitoneDelta = correctedScoringDelta;
        note.correctnessLocked = correctedAbsDelta === 0;
        note.isCorrect = correctedAbsDelta === 0;

        note.matchKind =
          correctedAbsDelta === 0
            ? "exact"
            : correctedAbsDelta === 1
              ? "adjacent_semitone"
              : "incorrect";

        note.displayState =
          correctedAbsDelta === 0
            ? "correct"
            : correctedAbsDelta === 1
              ? "adjacent_semitone"
              : "incorrect";

        note.interpretationReason =
          calibrationStrongExactOverride
            ? "Strong local calibration support confirmed this note belonged to the expected degree, so it was kept in the correct note class before final note-state interpretation."
            : correctedAbsDelta === 1
              ? "Continuous pitch center showed this note living across the semitone boundary, so it was reclassified before final note-state interpretation."
              : correctedAbsDelta >= 2
                ? "Continuous pitch center showed this note was too far from the expected pitch center to keep its earlier exact/semitone classification."
                : note.interpretationReason;
      }
    }

    if (note.displayState === "transposed_consistent") {
      note.intonationBand =
        classifyCorrectNoteIntonationBand(centerDeviationCents);
      note.weakWindowProtectionApplied = false;
      note.isolatedErrorSoftened = false;
      note.interpretationReason =
        note.interpretationReason ??
        "This note was accepted because the phrase stayed consistent in a shifted key center.";
      return;
    }

    if (note.correctnessLocked || note.absDelta === 0) {
      const intonationBand =
        classifyCorrectNoteIntonationBand(centerDeviationCents);
      note.displayState = "correct";
      note.intonationBand = intonationBand;
      note.weakWindowProtectionApplied = false;
      note.isolatedErrorSoftened = false;
      note.interpretationReason = describeCorrectNoteBand(
        intonationBand,
        centerDeviationCents,
      );
      return;
    }

    if (note.matchKind === "adjacent_semitone") {
      const adjacentBand = classifyAdjacentIntonationBand(centerDeviationCents);
      note.intonationBand = adjacentBand;
      note.displayState = "adjacent_semitone";

      if (adjacentBand === "boundary_cross") {
        note.interpretationReason =
          (centerDeviationCents ?? 0) < 0
            ? "You crossed the note boundary slightly low, so this landed between the target and the neighboring semitone."
            : "You crossed the note boundary slightly high, so this landed between the target and the neighboring semitone.";
      } else {
        note.interpretationReason =
          note.scoringDelta === -1
            ? "You landed on the neighboring lower semitone instead of the target note."
            : note.scoringDelta === 1
              ? "You landed on the neighboring higher semitone instead of the target note."
              : "You landed on a neighboring semitone instead of the target note.";
      }
      return;
    }

    const weakWindow =
      (note.absDelta ?? Number.POSITIVE_INFINITY) >= 1 &&
      isWeakWindowCandidate(segmented);
    const previousCorrect = notes[index - 1]?.isCorrect === true;
    const nextCorrect = notes[index + 1]?.isCorrect === true;
    const isolatedWeakMiss =
      weakWindow &&
      previousCorrect &&
      nextCorrect &&
      (assessment.summary.globalRelationship === "exact_match" ||
        assessment.summary.globalRelationship === "octave_shifted" ||
        assessment.summary.globalRelationship === "globally_transposed");

    if (weakWindow) {
      note.intonationBand = null;
      note.displayState =
        segmented?.status === "weak" ||
        segmented?.usedFrameCount <= 1 ||
        (segmented?.confidence ?? 1) < 0.46
          ? "low_confidence"
          : "ambiguous";
      note.weakWindowProtectionApplied = true;
      note.interpretationReason =
        segmented?.status === "weak"
          ? "Window had too little stable evidence to score as a hard pitch miss."
          : "Window evidence was unstable, so the miss was softened instead of treated as fully incorrect.";
    }

    if (
      !weakWindow &&
      (note.absDelta ?? Number.POSITIVE_INFINITY) >= 1 &&
      hasMusicallyUsableWeakEvidence(segmented)
    ) {
      note.intonationBand = null;
      note.displayState = "ambiguous";
      note.weakWindowProtectionApplied = true;
      note.interpretationReason =
        "Pitch evidence was breathy or lightly focused, but still musically usable enough that this note was softened instead of treated as a hard miss.";
    }

    if (isolatedWeakMiss) {
      note.intonationBand = null;
      note.displayState =
        (segmented?.confidence ?? 1) < 0.5 ||
        (segmented?.usedFrameCount ?? 99) <= 1
          ? "low_confidence"
          : "ambiguous";
      note.weakWindowProtectionApplied = true;
      note.isolatedErrorSoftened = true;
      note.interpretationReason =
        "This isolated miss sat inside an otherwise consistent phrase, and the note window was too weak to treat as a definite error.";
    }
  });

  return {
    ...assessment,
    notes,
  };
}

function contourRecognizable(
  assessment: MicAssessmentRunResult["assessment"],
): boolean {
  const contourTotal =
    assessment.summary.contourCorrectCount +
    assessment.summary.contourIncorrectCount;
  if (assessment.summary.contourFullyCorrect) {
    return true;
  }
  return contourTotal > 0
    ? assessment.summary.contourCorrectCount / contourTotal >= 0.6
    : false;
}

function buildPerformanceValidity(
  assessment: MicAssessmentRunResult["assessment"],
  segmentedNotes: MicAssessmentRunResult["segmentedNotes"],
): MicAssessmentRunResult["assessment"]["validity"] {
  const targetNotes = Math.max(1, assessment.summary.targetNoteCount);
  const usableDetectedNotes = segmentedNotes.filter(
    (note) => note.midi !== null && note.status !== "missing",
  ).length;
  const unstableWindowCount = segmentedNotes.filter(
    (note) =>
      note.status === "missing" ||
      (note.status === "weak" && !hasMusicallyUsableWeakEvidence(note)) ||
      (note.status === "ambiguous" && !note.targetConsistentAmbiguity) ||
      note.confidence < 0.42,
  ).length;
  const coverage = usableDetectedNotes / targetNotes;
  const weakRatio = unstableWindowCount / targetNotes;
  const contourIsRecognizable = contourRecognizable(assessment);
  const flowScore = assessment.rhythm.flow.score;
  const comparableRhythmSpanCount =
    assessment.rhythm.accuracy.comparableSpanCount;

  const flags = {
    lowCoverage: coverage < 0.6,
    unstableInput: weakRatio > 0.5,
    unrecognizableContour: !contourIsRecognizable,
    brokenFlow: flowScore < 0.4,
    sparseRhythmEvidence:
      comparableRhythmSpanCount <
      Math.max(2, Math.ceil(Math.max(0, targetNotes - 1) * 0.4)),
  };

  const triggered = Object.entries(flags)
    .filter(([, value]) => value)
    .map(([key]) => key);

  const isValid = triggered.length < 2;

  let reason =
    "The recording contained enough stable musical information to assess normally.";
  if (!isValid) {
    if (flags.unrecognizableContour && flags.lowCoverage) {
      reason =
        "We could not clearly detect a full, recognizable melody in this recording.";
    } else if (flags.unrecognizableContour && flags.unstableInput) {
      reason =
        "The recording did not contain enough stable notes to hear a clear melody shape.";
    } else if (flags.brokenFlow && flags.sparseRhythmEvidence) {
      reason =
        "The phrase was too broken up to assess as a clear musical attempt.";
    } else {
      reason =
        "We could not clearly detect a consistent melody from this recording.";
    }
  }

  return {
    isValid,
    coverage: Number(coverage.toFixed(3)),
    weakRatio: Number(weakRatio.toFixed(3)),
    contourRecognizable: contourIsRecognizable,
    flowScore: Number(flowScore.toFixed(3)),
    comparableRhythmSpanCount,
    reason,
  };
}

function applyValidityGate(
  assessment: MicAssessmentRunResult["assessment"],
  validity: MicAssessmentRunResult["assessment"]["validity"],
): MicAssessmentRunResult["assessment"] {
  if (validity.isValid) {
    return {
      ...assessment,
      validity,
    };
  }

  const cappedScores = {
    pitchScore: Math.min(assessment.scores.pitchScore, 45),
    rhythmScore: Math.min(assessment.scores.rhythmScore, 45),
    melodicScore: Math.min(assessment.scores.melodicScore, 40),
  };

  return {
    ...assessment,
    scores: cappedScores,
    validity,
  };
}

export async function runMicAssessment(
  input: RunMicAssessmentInput,
): Promise<MicAssessmentRunResult> {
  if (input.targetMelody.length === 0) {
    throw new Error("Generate a melody before running an assessment.");
  }

  const frames = await detectPitchFrames(input.audioBlob);
  const voicedFrames = frames.filter(
    (frame) => frame.midi !== null && frame.confidence >= 0.45,
  );

  if (voicedFrames.length < 6) {
    throw new Error(
      "I couldn't detect enough stable pitch information. Try again in a quieter space.",
    );
  }

  const effectiveCalibrationOffset =
    input.calibrationProfile?.successful &&
    input.calibrationProfile.signalQuality !== "poor" &&
    typeof input.calibrationProfile.tonicOffsetSemitones === "number"
      ? input.calibrationProfile.tonicOffsetSemitones
      : null;
  const usableCalibrationProfile =
    input.calibrationProfile?.successful &&
    input.calibrationProfile.signalQuality !== "poor"
      ? input.calibrationProfile
      : null;
  const { cleanedFrames, segmentedNotes } = segmentPerformedMelody(
    frames,
    input.targetMelody,
    {
      expectedMidiOffset: effectiveCalibrationOffset,
      calibrationProfile: usableCalibrationProfile,
    },
  );

  if (segmentedNotes.length === 0) {
    throw new Error(
      "I couldn't segment any stable sung notes from that recording.",
    );
  }

  const tonalFrameSelection = selectAssessmentTonalFrame({
    writtenTargetMelody: input.targetMelody,
    segmentedNotes,
    mode: input.mode,
    calibrationProfile: usableCalibrationProfile,
  });
  const {
    selectedAlignedMelody: alignedMelody,
    selectedTargetIndices: targetIndices,
    selectedTargetMelody,
    analysis: tonalFrameAnalysis,
  } = tonalFrameSelection;

  if (alignedMelody.length === 0) {
    throw new Error(
      "No performed melody could be aligned to the target phrase.",
    );
  }

  const warnings: string[] = [];
  const detectedNoteCount = segmentedNotes.filter(
    (note) => note.midi !== null,
  ).length;
  const missingWindowCount = segmentedNotes.filter(
    (note) => note.status === "missing",
  ).length;

  if (
    detectedNoteCount < Math.max(2, Math.ceil(input.targetMelody.length / 2))
  ) {
    warnings.push(
      "Only a partial melody was detected, so this assessment may be incomplete.",
    );
  }
  if (missingWindowCount > 0) {
    warnings.push(
      `${missingWindowCount} target note window${missingWindowCount === 1 ? "" : "s"} had weak or missing pitch evidence.`,
    );
  }
  if (Math.abs(detectedNoteCount - input.targetMelody.length) >= 2) {
    warnings.push(
      "Detected note count still differs noticeably from the target phrase.",
    );
  }
  const signalQuality = buildSignalQualitySummary(
    frames,
    cleanedFrames,
    segmentedNotes,
  );
  if (signalQuality.level !== "high") {
    warnings.push(signalQuality.summary);
  }
  if (usableCalibrationProfile) {
    warnings.push(
      "Full-scale calibration was used as a soft listening guide for this assessment.",
    );
  }
  if (tonalFrameAnalysis.selectedKind === "calibration_transposed") {
    warnings.push(
      `Assessment matched a calibration-informed target shifted by ${tonalFrameAnalysis.selectedSemitoneOffset > 0 ? "+" : ""}${tonalFrameAnalysis.selectedSemitoneOffset} semitone${Math.abs(tonalFrameAnalysis.selectedSemitoneOffset) === 1 ? "" : "s"}.`,
    );
  }

  const rawAssessment = evaluateMelodyAssessment({
    targetMelody: selectedTargetMelody,
    performedMelody: alignedMelody,
    performedDurationsMs: segmentedNotes.map((note) =>
      note.midi !== null && note.durationMs > 0 ? note.durationMs : null,
    ),
    performedStartsMs: segmentedNotes.map((note) =>
      note.midi !== null ? note.startMs : null,
    ),
    performedEndsMs: segmentedNotes.map((note) =>
      note.midi !== null ? note.endMs : null,
    ),
    performedWindowStatuses: segmentedNotes.map((note) => note.status),
    mode: input.mode,
    calibrationOffsetHint: null,
    calibrationSignalQuality: input.calibrationProfile?.signalQuality ?? null,
  });
  const biasAdjustedAssessment = applyConsistentPhraseBiasCorrection(
    {
      ...rawAssessment,
      tonalFrame: tonalFrameAnalysis,
    },
    segmentedNotes,
  );
  const interpretedAssessment = applyWeakWindowInterpretation(
    {
      ...biasAdjustedAssessment,
    },
    segmentedNotes,
  );
  const scoredAssessment = {
    ...interpretedAssessment,
    scores: buildAssessmentScoreSummary({
      assessment: interpretedAssessment,
      segmentedNotes,
    }),
  };
  const validity = buildPerformanceValidity(scoredAssessment, segmentedNotes);
  const finalizedAssessment = applyValidityGate(scoredAssessment, validity);
  if (
    finalizedAssessment.globalOffsetCorrection.applied &&
    finalizedAssessment.globalOffsetCorrection.candidateOffset !== null
  ) {
    warnings.push(
      `A phrase-level pitch offset of ${finalizedAssessment.globalOffsetCorrection.candidateOffset > 0 ? "+" : ""}${finalizedAssessment.globalOffsetCorrection.candidateOffset} semitone${Math.abs(finalizedAssessment.globalOffsetCorrection.candidateOffset) === 1 ? "" : "s"} was applied as a soft correction.`,
    );
  }
  if (
    finalizedAssessment.globalOffsetCorrection.sessionPitchBias
      .appliedAsPhraseCorrection &&
    finalizedAssessment.globalOffsetCorrection.sessionPitchBias.offset !== null
  ) {
    warnings.push(
      `Detected consistent ${finalizedAssessment.globalOffsetCorrection.sessionPitchBias.offset > 0 ? "+" : ""}${finalizedAssessment.globalOffsetCorrection.sessionPitchBias.offset} semitone phrase bias (${Math.round(finalizedAssessment.globalOffsetCorrection.sessionPitchBias.appliedSupportRatio * 100)}% support) and applied phrase-level correction before note scoring.`,
    );
  }
  if (!finalizedAssessment.validity.isValid) {
    warnings.push(finalizedAssessment.validity.reason);
    warnings.push(
      "Try singing the full phrase clearly and steadily for a more accurate assessment.",
    );
  }

  return {
    frames,
    cleanedFrames,
    segmentedNotes,
    alignedTargetIndices: targetIndices,
    performedMelody: alignedMelody,
    assessment: finalizedAssessment,
    warnings,
    signalQuality,
    comparisonMode: input.mode,
    calibrationProfileUsed: usableCalibrationProfile,
  };
}

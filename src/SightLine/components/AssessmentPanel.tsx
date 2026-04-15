import type { DebugSemanticsProjection } from "@/SightLine/domain/artifact";
import type { PitchAssessmentNote } from "@/SightLine/domain/assessment";
import type { MicAssessmentStatus } from "@/SightLine/hooks/useMicAssessment";
import type {
  MicAssessmentRunResult,
  SegmentedPerformedNote,
} from "@/SightLine/core/audio/types";
import { classifyMastery } from "@/SightLine/core/assessment/mastery";
import {
  buildWeightedAssessmentSummary,
  classifyWeightedAssessmentNoteState,
} from "@/SightLine/core/assessmentLogs/scoring";
import DebugSemanticsPanel from "./DebugSemanticsPanel";

interface AssessmentPanelProps {
  status: MicAssessmentStatus;
  result: MicAssessmentRunResult | null;
  debugSemantics: DebugSemanticsProjection;
  errorMessage: string | null;
  selectedNoteIndex: number | null;
  showDeveloperDebug: boolean;
  onSelectNote: (index: number | null) => void;
  onClear: () => void;
}

function classifyWeightedNoteState(
  note: PitchAssessmentNote | undefined,
  segmented: SegmentedPerformedNote | undefined,
): ReturnType<typeof classifyWeightedAssessmentNoteState> {
  return classifyWeightedAssessmentNoteState(note, segmented);
}

function statusLabel(status: MicAssessmentStatus): string {
  switch (status) {
    case "requesting_permission":
      return "Requesting microphone permission...";
    case "recording":
      return "Recording your attempt. Sing the phrase, then press Stop Assessment.";
    case "processing":
      return "Processing the recording and running the melody assessment...";
    case "complete":
      return "Assessment complete.";
    case "error":
      return "Assessment could not be completed.";
    default:
      return "Record one monophonic attempt to compare your singing against the current melody.";
  }
}

function noteOutcome(
  note: PitchAssessmentNote | undefined,
  segmented: SegmentedPerformedNote | undefined,
): "correct" | "near" | "incorrect" | "ambiguous" {
  const weightedState = classifyWeightedNoteState(note, segmented);
  if (weightedState === "correct") {
    return "correct";
  }
  if (weightedState === "near") {
    return "near";
  }
  if (
    weightedState === "low_confidence" ||
    weightedState === "ambiguous" ||
    weightedState === "transposed_consistent"
  ) {
    return "ambiguous";
  }
  return "incorrect";
}

function formatDetectedPitch(
  note: PitchAssessmentNote | undefined,
  segmented: SegmentedPerformedNote | undefined,
): string {
  if (note?.performed?.pitch) {
    return note.performed.pitch;
  }
  if (typeof segmented?.midi === "number") {
    return `MIDI ${segmented.midi}`;
  }
  return "Not clearly detected";
}

function noteStatusLabel(
  note: PitchAssessmentNote | undefined,
  segmented: SegmentedPerformedNote | undefined,
): string {
  const outcome = noteOutcome(note, segmented);
  if (outcome === "correct") {
    return "Correct";
  }
  if (outcome === "near") {
    return "Slightly off";
  }
  if (note?.displayState === "transposed_consistent") {
    return "Consistent key shift";
  }
  if (outcome === "ambiguous") {
    return "Unclear";
  }
  return "Incorrect";
}

function describeNote(
  note: PitchAssessmentNote | undefined,
  segmented: SegmentedPerformedNote | undefined,
): string {
  if (note?.isCorrect) {
    return "Correct note.";
  }
  if (note?.matchKind === "near") {
    if (note.scoringDelta === -1) {
      return "You sang this slightly too low.";
    }
    if (note.scoringDelta === 1) {
      return "You sang this slightly too high.";
    }
    return "This note was slightly off.";
  }
  if (
    segmented?.status === "ambiguous" &&
    segmented.targetConsistentAmbiguity
  ) {
    return "This note was a little unclear, but it stayed close to the expected pitch.";
  }
  if (segmented?.status === "ambiguous") {
    return "This note was unclear because the pitch center was unstable.";
  }
  if (segmented?.status === "weak") {
    return "This note was affected by noisy or unstable pitch evidence.";
  }
  if (!note?.performed || note.matchKind === "missing") {
    return "This note was unclear because a strong pitch was not detected.";
  }
  if (note.interpretationReason) {
    return note.interpretationReason;
  }
  if (note.scoringDelta === -1) {
    return "You sang this slightly too low.";
  }
  if (note.scoringDelta === 1) {
    return "You sang this slightly too high.";
  }
  if (typeof note.scoringDelta === "number" && note.scoringDelta < 0) {
    return "You sang this note too low.";
  }
  if (typeof note.scoringDelta === "number" && note.scoringDelta > 0) {
    return "You sang this note too high.";
  }
  return "You sang the wrong pitch on this note.";
}

export default function AssessmentPanel({
  status,
  result,
  debugSemantics,
  errorMessage,
  selectedNoteIndex,
  showDeveloperDebug,
  onSelectNote,
  onClear,
}: AssessmentPanelProps): JSX.Element | null {
  if (status === "idle" && !result && !errorMessage) {
    return null;
  }

  const selectedNote =
    result && selectedNoteIndex !== null
      ? result.assessment.notes[selectedNoteIndex]
      : undefined;
  const selectedSegmentedNote =
    result && selectedNoteIndex !== null
      ? result.segmentedNotes[selectedNoteIndex]
      : undefined;
  const selectedOutcome =
    selectedNoteIndex !== null
      ? noteOutcome(selectedNote, selectedSegmentedNote)
      : null;
  const weightedSummary = result
    ? buildWeightedAssessmentSummary(result)
    : null;
  const mastery = result ? classifyMastery(result.assessment) : null;

  return (
    <section className="AppAssessmentPanel">
      <div className="AppAssessmentPanelHeader">
        <div>
          <h3>Assessment Results</h3>
          <p className="AppAssessmentStatus">{statusLabel(status)}</p>
          {errorMessage ? (
            <p className="AppAssessmentError">{errorMessage}</p>
          ) : null}
        </div>
        {(result || errorMessage) && status !== "recording" ? (
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={onClear}
          >
            Clear
          </button>
        ) : null}
      </div>

      {result ? (
        <div className="AppAssessmentGrid">
          <div className="AppAssessmentCard">
            <h4>Summary</h4>
            {mastery ? (
              <div className="AppAssessmentMastery">
                <p className="AppAssessmentMasteryLevel">
                  Mastery: {mastery.level}
                </p>
                <p className="AppAssessmentMasteryLabel">{mastery.label}</p>
              </div>
            ) : null}
            {mastery ? (
              <p className="AppHistoryLabel">{mastery.explanation}</p>
            ) : null}
            <p className="AppHistoryLabel">
              <strong>Melodic: {result.assessment.scores.melodicScore}%</strong>
            </p>
            <p className="AppHistoryLabel">
              <strong>Pitch: {result.assessment.scores.pitchScore}%</strong>
            </p>
            <p className="AppHistoryLabel">
              <strong>Rhythm: {result.assessment.scores.rhythmScore}%</strong>
            </p>
            {result.warnings.map((warning) => (
              <p key={warning} className="AppAssessmentWarning">
                {warning}
              </p>
            ))}
          </div>

          {debugSemantics.strengths.length > 0 ? (
            <div className="AppAssessmentCard">
              <h4>Strengths</h4>
              {debugSemantics.strengths.map((insight, index) => (
                <p
                  key={`${insight.category}-strength-${index}`}
                  className="AppHistoryLabel"
                >
                  {insight.message}
                </p>
              ))}
            </div>
          ) : null}

          {debugSemantics.weaknesses.length > 0 ? (
            <div className="AppAssessmentCard">
              <h4>Weaknesses</h4>
              {debugSemantics.weaknesses.map((insight, index) => (
                <p
                  key={`${insight.category}-weakness-${index}`}
                  className="AppHistoryLabel"
                >
                  {insight.message}
                </p>
              ))}
            </div>
          ) : null}

          {debugSemantics.recommendation ? (
            <div className="AppAssessmentCard">
              <h4>Next practice focus</h4>
              <p className="AppHistoryLabel">
                <strong>{debugSemantics.recommendation.title}</strong>
              </p>
              <p className="AppHistoryLabel">
                {debugSemantics.recommendation.message}
              </p>
            </div>
          ) : null}

          <div className="AppAssessmentCard">
            <h4>Selected Note</h4>
            {selectedNoteIndex === null ? (
              <p className="AppHistoryLabel">
                Click a colored note on the staff to inspect that note.
              </p>
            ) : (
              <>
                <p
                  className={`AppAssessmentNoteBadge AppAssessmentNoteBadge--${selectedOutcome ?? "ambiguous"}`}
                >
                  Note {selectedNoteIndex + 1}
                </p>
                <p className="AppHistoryLabel">
                  Assessment: {noteStatusLabel(selectedNote, selectedSegmentedNote)}
                </p>
                <p className="AppHistoryLabel">
                  Expected:{" "}
                  {selectedNote?.target?.pitch ??
                    selectedSegmentedNote?.expectedPitch ??
                    "n/a"}
                </p>
                <p className="AppHistoryLabel">
                  You sang:{" "}
                  {formatDetectedPitch(selectedNote, selectedSegmentedNote)}
                </p>
                <p className="AppHistoryLabel">
                  Confidence:{" "}
                  {selectedSegmentedNote
                    ? `${Math.round(selectedSegmentedNote.confidence * 100)}%`
                    : "n/a"}
                </p>
                {selectedNote?.globalOffsetCorrectionApplied &&
                selectedNote.appliedGlobalOffset !== null ? (
                  <p className="AppHistoryLabel">
                    Phrase correction:{" "}
                    {selectedNote.appliedGlobalOffset > 0 ? "+" : ""}
                    {selectedNote.appliedGlobalOffset} semitone
                    {Math.abs(selectedNote.appliedGlobalOffset) === 1
                      ? ""
                      : "s"}
                  </p>
                ) : null}
                <p className="AppAssessmentNoteExplanation">
                  <strong>
                    {describeNote(selectedNote, selectedSegmentedNote)}
                  </strong>
                </p>
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionToggleButton"
                  onClick={() => onSelectNote(null)}
                >
                  Clear Note Selection
                </button>
              </>
            )}
          </div>

          <div className="AppAssessmentCard">
            <h4>Legend</h4>
            <p className="AppHistoryLabel">
              <span className="AppAssessmentLegendSwatch AppAssessmentLegendSwatch--correct" />{" "}
              Correct or slightly off note
            </p>
            <p className="AppHistoryLabel">
              <span className="AppAssessmentLegendSwatch AppAssessmentLegendSwatch--ambiguous" />{" "}
              Ambiguous or low-confidence note
            </p>
            <p className="AppHistoryLabel">
              <span className="AppAssessmentLegendSwatch AppAssessmentLegendSwatch--incorrect" />{" "}
              Incorrect note
            </p>
            <p className="AppHistoryLabel">
              Click any colored note on the staff to inspect it.
            </p>
          </div>

          {showDeveloperDebug ? (
            <details className="AppAssessmentDebug">
              <summary>Developer Debug</summary>
              <div className="AppAssessmentGrid">
                <div className="AppAssessmentCard">
                  <h4>Target Windows</h4>
                  <ul className="AppAssessmentList">
                    {result.segmentedNotes.map((note, index) => (
                      <li
                        key={`${note.targetIndex}-${note.windowStartMs}-${index}`}
                      >
                        <button
                          type="button"
                          className="AppAssessmentInlineButton"
                          onClick={() => onSelectNote(index)}
                        >
                          Note {index + 1}
                        </button>
                        : expected{" "}
                        {note.expectedPitch ?? note.expectedMidi ?? "n/a"},
                        detected {note.midi ?? "missing"}, center{" "}
                        {note.pitchCenter !== null
                          ? note.pitchCenter.toFixed(2)
                          : "n/a"}
                        , status {note.status}
                        <br />
                        Confidence {note.confidence.toFixed(2)} | Voiced{" "}
                        {note.voicedFrameCount} | Used {note.usedFrameCount}
                        <br />
                        Calibration support:{" "}
                        {note.calibrationSupportLevel ?? "none"}
                        {" | trusted: "}
                        {note.calibrationSupportedLocalEvidence ? "yes" : "no"}
                        {note.calibrationSupportReason
                          ? ` | ${note.calibrationSupportReason}`
                          : ""}
                        <br />
                        {note.debugReason}
                      </li>
                    ))}
                  </ul>
                </div>

                {result.calibrationProfileUsed ? (
                  <div className="AppAssessmentCard">
                    <h4>Calibration Profile</h4>
                    <p className="AppHistoryLabel">
                      Quality: {result.calibrationProfileUsed.signalQuality ?? "n/a"} | Overall confidence:{" "}
                      {result.calibrationProfileUsed.overallConfidence !== null
                        ? Math.round(result.calibrationProfileUsed.overallConfidence * 100)
                        : "n/a"}
                      %
                    </p>
                    <ul className="AppAssessmentList">
                      {result.calibrationProfileUsed.degrees.map((degree) => (
                        <li key={`calibration-degree-${degree.degree}`}>
                          Degree {degree.degree} ({degree.label}): expected {degree.expectedPitch} / {degree.expectedMidi}, detected{" "}
                          {degree.detectedMidi ?? "missing"}, center{" "}
                          {degree.center !== null ? degree.center.toFixed(2) : "n/a"}
                          <br />
                          Offset from expected:{" "}
                          {degree.offsetFromExpected !== null
                            ? `${degree.offsetFromExpected > 0 ? "+" : ""}${degree.offsetFromExpected.toFixed(2)}`
                            : "n/a"}{" "}
                          | Status {degree.status}
                          <br />
                          Confidence {Math.round(degree.confidence * 100)}% | Stability{" "}
                          {Math.round(degree.stability * 100)}%
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="AppAssessmentCard">
                  <h4>Phrase Offset</h4>
                  <p className="AppHistoryLabel">
                    Candidate offset:{" "}
                    {result.assessment.globalOffsetCorrection.candidateOffset ??
                      "none"}
                  </p>
                  <p className="AppHistoryLabel">
                    Support:{" "}
                    {result.assessment.globalOffsetCorrection.supportCount}{" "}
                    note(s) (
                    {Math.round(
                      result.assessment.globalOffsetCorrection.supportRatio *
                        100,
                    )}
                    %)
                  </p>
                  <p className="AppHistoryLabel">
                    Applied:{" "}
                    {result.assessment.globalOffsetCorrection.applied
                      ? "yes"
                      : "no"}{" "}
                    | Calibration supported candidate:{" "}
                    {result.assessment.globalOffsetCorrection
                      .calibrationSupportedCandidate
                      ? "yes"
                      : "no"}
                  </p>
                  <p className="AppHistoryLabel">
                    Calibration hint:{" "}
                    {result.assessment.globalOffsetCorrection
                      .calibrationOffsetHint ?? "none"}
                  </p>
                  <p className="AppHistoryLabel">
                    Raw fit:{" "}
                    {result.assessment.globalOffsetCorrection.rawScore.toFixed(
                      2,
                    )}{" "}
                    (
                    {Math.round(
                      result.assessment.globalOffsetCorrection.rawAverageScore *
                        100,
                    )}
                    %) | Corrected fit:{" "}
                    {result.assessment.globalOffsetCorrection.correctedScore !==
                    null
                      ? `${result.assessment.globalOffsetCorrection.correctedScore.toFixed(2)} (${Math.round((result.assessment.globalOffsetCorrection.correctedAverageScore ?? 0) * 100)}%)`
                      : "n/a"}
                  </p>
                  <p className="AppHistoryLabel">
                    Improvement:{" "}
                    {result.assessment.globalOffsetCorrection.improvement.toFixed(
                      2,
                    )}{" "}
                    | Already mostly acceptable:{" "}
                    {result.assessment.globalOffsetCorrection
                      .phraseAlreadyMostlyAcceptable
                      ? "yes"
                      : "no"}
                  </p>
                  <p className="AppHistoryLabel">
                    Session bias:{" "}
                    {result.assessment.globalOffsetCorrection.sessionPitchBias
                      .offset ?? "none"}{" "}
                    | Support:{" "}
                    {Math.round(
                      result.assessment.globalOffsetCorrection.sessionPitchBias
                        .supportRatio * 100,
                    )}
                    % | Confidence:{" "}
                    {Math.round(
                      result.assessment.globalOffsetCorrection.sessionPitchBias
                        .confidence * 100,
                    )}
                    %
                  </p>
                  <p className="AppHistoryLabel">
                    Bias treated softly:{" "}
                    {result.assessment.globalOffsetCorrection.sessionPitchBias
                      .treatedAsBias
                      ? "yes"
                      : "no"}
                  </p>
                  {result.assessment.globalOffsetCorrection.acceptedReason ? (
                    <p className="AppHistoryLabel">
                      Accepted because:{" "}
                      {result.assessment.globalOffsetCorrection.acceptedReason}
                    </p>
                  ) : null}
                  {result.assessment.globalOffsetCorrection.rejectedReason ? (
                    <p className="AppHistoryLabel">
                      Rejected because:{" "}
                      {result.assessment.globalOffsetCorrection.rejectedReason}
                    </p>
                  ) : null}
                </div>

                <div className="AppAssessmentCard">
                  <h4>Pitch Generosity</h4>
                  <p className="AppHistoryLabel">
                    Base pitch: {weightedSummary?.basePercentage ?? 0}% |
                    Adjusted pitch: {weightedSummary?.percentage ?? 0}%
                  </p>
                  <p className="AppHistoryLabel">
                    Near-match boost:{" "}
                    {weightedSummary?.generosityAdjustments.nearMatchPhraseBoost.toFixed(
                      2,
                    ) ?? "0.00"}{" "}
                    | Session-bias boost:{" "}
                    {weightedSummary?.generosityAdjustments.sessionBiasBoost.toFixed(
                      2,
                    ) ?? "0.00"}
                  </p>
                  <p className="AppHistoryLabel">
                    Generosity applied:{" "}
                    {weightedSummary?.generosityAdjustments.adjustedByGenerosity
                      ? "yes"
                      : "no"}
                  </p>
                </div>

                <div className="AppAssessmentCard">
                  <h4>Alignment</h4>
                  {result.performedMelody.length === 0 ? (
                    <p className="AppHistoryLabel">
                      No aligned melody available.
                    </p>
                  ) : (
                    <ul className="AppAssessmentList">
                      {result.performedMelody.map((event, index) => {
                        const assessedNote = result.assessment.notes[index];

                        return (
                          <li key={`${event.measure}-${event.beat}-${index}`}>
                            Performed note {index + 1}: {event.pitch} (MIDI{" "}
                            {event.midi}) {"->"} target note{" "}
                            {result.alignedTargetIndices[index] + 1}
                            {typeof assessedNote?.normalizedExpectedMidi ===
                            "number"
                              ? ` | raw expected ${assessedNote.rawNormalizedExpectedMidi ?? "n/a"} | raw delta ${assessedNote.rawScoringDelta ?? "n/a"} | corrected expected ${assessedNote.normalizedExpectedMidi} | corrected delta ${assessedNote.scoringDelta ?? "n/a"} | abs delta ${assessedNote.absDelta ?? "n/a"} | normalized ${assessedNote.normalizedScoringUsed ? "yes" : "no"} | tolerance ${assessedNote.toleranceApplied ? "yes" : "no"} | correctness locked ${assessedNote.correctnessLocked ? "yes" : "no"}`
                              : ""}
                            {assessedNote?.globalOffsetCorrectionApplied
                              ? ` | phrase offset ${assessedNote.appliedGlobalOffset ?? "n/a"}`
                              : ""}
                            {assessedNote?.weakWindowProtectionApplied
                              ? ` | weak-window protection yes`
                              : ""}
                            {assessedNote?.isolatedErrorSoftened
                              ? ` | isolated-error softening yes`
                              : ""}
                            {assessedNote?.interpretationReason
                              ? ` | ${assessedNote.interpretationReason}`
                              : ""}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="AppAssessmentCard">
                  <h4>Signal Quality</h4>
                  <p className="AppHistoryLabel">
                    Pitch frames: {result.frames.length} | Voiced frames:{" "}
                    {
                      result.frames.filter((frame) => frame.midi !== null)
                        .length
                    }
                  </p>
                  <p className="AppHistoryLabel">
                    Cleaned voiced frames:{" "}
                    {
                      result.cleanedFrames.filter(
                        (frame) => frame.cleanedMidi !== null,
                      ).length
                    }
                  </p>
                  <p className="AppHistoryLabel">
                    Rejected frames: {result.signalQuality.rejectedFrameCount} |
                    Noise-floor rejects:{" "}
                    {result.signalQuality.rejectedForNoiseCount}
                  </p>
                  <p className="AppHistoryLabel">
                    Ambiguous windows:{" "}
                    {result.signalQuality.ambiguousWindowCount} |
                    Target-consistent ambiguous:{" "}
                    {result.signalQuality.targetConsistentAmbiguousCount}
                  </p>
                  <p className="AppHistoryLabel">
                    Onset-adjusted windows:{" "}
                    {result.signalQuality.onsetAdjustedWindowCount}
                  </p>
                  <p className="AppHistoryLabel">
                    {result.signalQuality.summary}
                  </p>
                </div>

                <div className="AppAssessmentCard">
                  <h4>Rhythm Debug</h4>
                  <p className="AppHistoryLabel">
                    Accuracy:{" "}
                    {Math.round(result.assessment.rhythm.accuracy.score * 100)}%
                    | Comparable spans:{" "}
                    {result.assessment.rhythm.accuracy.comparableSpanCount} |
                    Preserved:{" "}
                    {result.assessment.rhythm.accuracy.preservedSpanCount}
                  </p>
                  <p className="AppHistoryLabel">
                    Base:{" "}
                    {Math.round(
                      result.assessment.rhythm.accuracy.baseScore * 100,
                    )}
                    % | Pattern bonus:{" "}
                    {Math.round(
                      result.assessment.rhythm.accuracy.patternPreservedBonus *
                        100,
                    )}
                    % | Preserved-structure bonus:{" "}
                    {Math.round(
                      result.assessment.rhythm.accuracy
                        .preservedStructureBonus * 100,
                    )}
                    % | Flow-only relief:{" "}
                    {Math.round(
                      result.assessment.rhythm.accuracy.flowOnlyRelief * 100,
                    )}
                    % | Safeguard:{" "}
                    {Math.round(
                      result.assessment.rhythm.accuracy
                        .recognizablePatternSafeguard * 100,
                    )}
                    %
                  </p>
                  {result.assessment.rhythm.accuracy.spans
                    .slice(0, 4)
                    .map((span) => (
                      <p
                        key={`rhythm-span-${span.fromIndex}-${span.toIndex}`}
                        className="AppHistoryLabel"
                      >
                        Span {span.fromIndex + 1}-{span.toIndex + 1}: signal{" "}
                        {span.rhythmSignalUsed} | IOI{" "}
                        {span.performedIoiMs !== null
                          ? `${Math.round(span.performedIoiMs)} ms`
                          : "n/a"}{" "}
                        →{" "}
                        {span.performedNextIoiMs !== null
                          ? `${Math.round(span.performedNextIoiMs)} ms`
                          : "n/a"}{" "}
                        | IOI error{" "}
                        {span.ioiRatioError !== null
                          ? span.ioiRatioError.toFixed(2)
                          : "n/a"}{" "}
                        | duration error{" "}
                        {span.durationRatioError !== null
                          ? span.durationRatioError.toFixed(2)
                          : "n/a"}{" "}
                        | weights I:{span.ioiWeightApplied.toFixed(2)} D:
                        {span.durationWeightApplied.toFixed(2)} | duration
                        trusted {span.durationTrustedOverIoi ? "yes" : "no"} |
                        IOI reduced {span.ioiReducedForBreath ? "yes" : "no"} |
                        score{" "}
                        {span.assignedScore !== null
                          ? span.assignedScore.toFixed(2)
                          : "n/a"}{" "}
                        | preserved {span.relationshipPreserved ? "yes" : "no"}{" "}
                        | gap{" "}
                        {span.pauseAfterMs !== null
                          ? `${Math.round(span.pauseAfterMs)} ms`
                          : "n/a"}{" "}
                        | flow only {span.gapAffectedFlowOnly ? "yes" : "no"}
                      </p>
                    ))}
                  <p className="AppHistoryLabel">
                    Flow:{" "}
                    {Math.round(result.assessment.rhythm.flow.score * 100)}% |
                    Pauses: {result.assessment.rhythm.flow.pauseCount} | Long
                    pauses: {result.assessment.rhythm.flow.longPauseCount}
                  </p>
                  <p className="AppHistoryLabel">
                    Avg pause:{" "}
                    {result.assessment.rhythm.flow.averagePauseMs !== null
                      ? `${Math.round(result.assessment.rhythm.flow.averagePauseMs)} ms`
                      : "n/a"}{" "}
                    | Tempo drift:{" "}
                    {result.assessment.rhythm.flow.tempoDrift !== null
                      ? result.assessment.rhythm.flow.tempoDrift.toFixed(2)
                      : "n/a"}
                  </p>
                </div>

                <div className="AppAssessmentCard">
                  <h4>Mastery Debug</h4>
                  <p className="AppHistoryLabel">
                    Melodic % used: {result.assessment.scores.melodicScore} |
                    Mapped mastery: {mastery?.level ?? "n/a"} (
                    {mastery?.label ?? "n/a"})
                  </p>
                  <p className="AppHistoryLabel">
                    Pitch mostly correct:{" "}
                    {mastery?.explanationSignals.pitchMostlyCorrect
                      ? "yes"
                      : "no"}{" "}
                    | Rhythm mostly correct:{" "}
                    {mastery?.explanationSignals.rhythmMostlyCorrect
                      ? "yes"
                      : "no"}{" "}
                    | Flow mostly steady:{" "}
                    {mastery?.explanationSignals.flowMostlySteady
                      ? "yes"
                      : "no"}
                  </p>
                  <p className="AppHistoryLabel">
                    Contour recognizable:{" "}
                    {mastery?.explanationSignals.contourRecognizable
                      ? "yes"
                      : "no"}{" "}
                    | Tonal drift but consistent:{" "}
                    {mastery?.explanationSignals.tonalDriftButConsistent
                      ? "yes"
                      : "no"}{" "}
                    | Explanation only:{" "}
                    {mastery?.explanationUsesRubricTextOnly ? "yes" : "no"}
                  </p>
                </div>

                <div className="AppAssessmentCard">
                  <h4>Validity Debug</h4>
                  <p className="AppHistoryLabel">
                    Valid: {result.assessment.validity.isValid ? "yes" : "no"} |
                    Coverage:{" "}
                    {Math.round(result.assessment.validity.coverage * 100)}% |
                    Weak ratio:{" "}
                    {Math.round(result.assessment.validity.weakRatio * 100)}%
                  </p>
                  <p className="AppHistoryLabel">
                    Contour recognizable:{" "}
                    {result.assessment.validity.contourRecognizable
                      ? "yes"
                      : "no"}{" "}
                    | Flow:{" "}
                    {Math.round(result.assessment.validity.flowScore * 100)}% |
                    Comparable rhythm spans:{" "}
                    {result.assessment.validity.comparableRhythmSpanCount}
                  </p>
                  <p className="AppHistoryLabel">
                    Reason: {result.assessment.validity.reason}
                  </p>
                </div>
                <DebugSemanticsPanel debugSemantics={debugSemantics} />
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

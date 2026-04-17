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
  if (weightedState === "same_note_off_center") {
    return "correct";
  }
  if (weightedState === "adjacent_semitone") {
    return "incorrect";
  }
  // transposed_consistent means the system explicitly accepted the note as musically
  // coherent (e.g. consistent interval pattern in a shifted tonal frame). That is a
  // positive outcome — show it in the same green tier as other accepted notes.
  if (weightedState === "transposed_consistent") {
    return "correct";
  }
  // targetConsistentAmbiguity means the signal was ambiguous but the ambiguous pitch
  // matched what was expected — the system accepted it. Show it green alongside other
  // accepted notes, not amber alongside genuinely unclear ones.
  if (segmented?.targetConsistentAmbiguity) {
    return "correct";
  }
  if (weightedState === "low_confidence" || weightedState === "ambiguous") {
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
  // Check displayState and signal fields before the outcome so that accepted-context
  // notes get their own label even when their outcome tier is shared with other states.
  if (note?.displayState === "transposed_consistent") {
    return "Consistent key shift";
  }
  if (note?.displayState === "same_note_off_center") {
    return "Right note, off-center";
  }
  if (note?.displayState === "adjacent_semitone") {
    return "Neighboring semitone";
  }
  const outcome = noteOutcome(note, segmented);
  if (outcome === "correct") {
    return "Correct";
  }
  // Distinguish the two reasons a note can land in the amber tier:
  // - targetConsistentAmbiguity: signal was ambiguous but the pitch matched — accepted, not failed
  // - low_confidence / weak signal: pitch evidence was too soft to be certain
  // - plain ambiguous: genuinely unclear pitch center
  if (segmented?.targetConsistentAmbiguity) {
    return "Accepted";
  }
  if (classifyWeightedNoteState(note, segmented) === "low_confidence") {
    return "Weak signal";
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
  if (note?.displayState === "same_note_off_center") {
    const cents = Math.abs(note.centerDeviationCents ?? 0);
    if ((note.centerDeviationCents ?? 0) < 0) {
      return `You sang the right note, but it sat about ${cents} cents low.`;
    }
    return `You sang the right note, but it sat about ${cents} cents high.`;
  }
  if (note?.displayState === "adjacent_semitone") {
    return "You landed on the neighboring semitone instead of the target note.";
  }
  if (note?.isCorrect) {
    return "Correct note.";
  }
  if (
    segmented?.status === "ambiguous" &&
    segmented.targetConsistentAmbiguity
  ) {
    return "The pitch wasn't perfectly defined, but it matched what was expected here.";
  }
  if (segmented?.status === "ambiguous") {
    return "This note was unclear because the pitch center was unstable.";
  }
  if (segmented?.status === "weak") {
    return "This note had a weak signal — the pitch was hard to detect clearly.";
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
  const selectedCenterDeviationCents = selectedNote?.centerDeviationCents ?? null;
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
                {typeof selectedCenterDeviationCents === "number" ? (
                  <p className="AppHistoryLabel">
                    Note center offset:{" "}
                    {selectedCenterDeviationCents > 0 ? "+" : ""}
                    {selectedCenterDeviationCents} cents
                  </p>
                ) : null}
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
              Correct note, same-note intonation drift, or consistent key shift
            </p>
            <p className="AppHistoryLabel">
              <span className="AppAssessmentLegendSwatch AppAssessmentLegendSwatch--ambiguous" />{" "}
              Accepted despite unclear signal, or weak signal
            </p>
            <p className="AppHistoryLabel">
              <span className="AppAssessmentLegendSwatch AppAssessmentLegendSwatch--incorrect" />{" "}
              Neighboring semitone miss or incorrect note
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
                  <h4>Tonal Frame</h4>
                  <p className="AppHistoryLabel">
                    Selected frame: {result.assessment.tonalFrame.selectedLabel} |
                    Offset:{" "}
                    {result.assessment.tonalFrame.selectedSemitoneOffset > 0
                      ? "+"
                      : ""}
                    {result.assessment.tonalFrame.selectedSemitoneOffset}
                  </p>
                  <p className="AppHistoryLabel">
                    Calibration proposed:{" "}
                    {result.assessment.tonalFrame.calibrationProposedOffset ===
                    null
                      ? "none"
                      : `${result.assessment.tonalFrame.calibrationProposedOffset > 0 ? "+" : ""}${result.assessment.tonalFrame.calibrationProposedOffset}`}{" "}
                    | Used calibration profile:{" "}
                    {result.assessment.tonalFrame.usedCalibrationProfile
                      ? "yes"
                      : "no"}
                  </p>
                  {result.assessment.tonalFrame.rationale.map((reason, index) => (
                    <p
                      key={`tonal-frame-rationale-${index}`}
                      className="AppHistoryLabel"
                    >
                      {reason}
                    </p>
                  ))}
                  {result.assessment.tonalFrame.candidates.length > 0 ? (
                    <ul className="AppAssessmentList">
                      {result.assessment.tonalFrame.candidates.map((candidate) => (
                        <li key={`tonal-frame-candidate-${candidate.kind}`}>
                          {candidate.label}: pitch {candidate.pitchScore}% |
                          local {(candidate.localPitchFit * 100).toFixed(0)}% |
                          structural {(candidate.structuralFit * 100).toFixed(0)}% |
                          interval {(candidate.intervalFit * 100).toFixed(0)}% |
                          contour {(candidate.contourFit * 100).toFixed(0)}% |
                          cadence {(candidate.cadenceFit * 100).toFixed(0)}% |
                          rescue {(candidate.rescuePressure * 100).toFixed(0)}% |
                          total {(candidate.totalScore * 100).toFixed(0)}% |
                          accepted {candidate.accepted ? "yes" : "no"}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="AppAssessmentCard">
                  <h4>Phrase Offset</h4>
                  <p className="AppHistoryLabel">
                    Global relationship: {result.assessment.summary.globalRelationship}
                    {result.assessment.summary.transpositionSemitoneOffset !== null
                      ? ` | Semitone offset: ${result.assessment.summary.transpositionSemitoneOffset > 0 ? "+" : ""}${result.assessment.summary.transpositionSemitoneOffset}`
                      : ""}
                    {result.assessment.summary.transpositionPitchClassOffset !== null
                      ? ` | Pitch-class offset: ${result.assessment.summary.transpositionPitchClassOffset}`
                      : ""}
                  </p>
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
                  {result.assessment.globalOffsetCorrection.consideredCandidates
                    .length > 0 ? (
                    <ul className="AppAssessmentList">
                      {result.assessment.globalOffsetCorrection.consideredCandidates.map(
                        (candidate) => (
                          <li key={`offset-candidate-${candidate.offset}`}>
                            Offset {candidate.offset > 0 ? "+" : ""}
                            {candidate.offset}: exact {candidate.exactSupportCount} | support{" "}
                            {candidate.supportCount} (
                            {Math.round(candidate.supportRatio * 100)}%) | corrected avg{" "}
                            {Math.round(candidate.correctedAverageScore * 100)}% | improvement{" "}
                            {candidate.improvement.toFixed(2)} | accepted{" "}
                            {candidate.accepted ? "yes" : "no"}
                            {candidate.rejectedReason
                              ? ` | ${candidate.rejectedReason}`
                              : ""}
                          </li>
                        ),
                      )}
                    </ul>
                  ) : null}
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
                    Interval-recovery credit:{" "}
                    {weightedSummary?.generosityAdjustments.intervalRecoveryCredit.toFixed(
                      2,
                    ) ?? "0.00"}{" "}
                    | Near-match boost:{" "}
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
                              ? ` | match ${assessedNote.matchKind} | display ${assessedNote.displayState} | raw expected ${assessedNote.rawNormalizedExpectedMidi ?? "n/a"} | raw delta ${assessedNote.rawScoringDelta ?? "n/a"} | corrected expected ${assessedNote.normalizedExpectedMidi} | corrected delta ${assessedNote.scoringDelta ?? "n/a"} | abs delta ${assessedNote.absDelta ?? "n/a"} | center deviation ${assessedNote.centerDeviationCents ?? "n/a"} cents | normalized ${assessedNote.normalizedScoringUsed ? "yes" : "no"} | tolerance ${assessedNote.toleranceApplied ? "yes" : "no"} | correctness locked ${assessedNote.correctnessLocked ? "yes" : "no"}`
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
                            {assessedNote?.intervalRecoveryApplied
                              ? ` | interval-recovery credit ${assessedNote.intervalRecoveryCredit.toFixed(2)}`
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
                    Strong pitch ratio:{" "}
                    {Math.round(
                      (mastery?.explanationSignals.strongPitchRatio ?? 0) * 100,
                    )}
                    % | Softened acceptance ratio:{" "}
                    {Math.round(
                      (mastery?.explanationSignals.softenedAcceptanceRatio ?? 0) *
                        100,
                    )}
                    % | Contour without pitch:{" "}
                    {mastery?.explanationSignals.contourSupportWithoutPitch
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
                    | Capped by pitch floor:{" "}
                    {mastery?.cappedByPitchFloor ? "yes" : "no"}{" "}
                    | Explanation only:{" "}
                    {mastery?.explanationUsesRubricTextOnly ? "yes" : "no"}
                  </p>
                  {mastery?.capReason ? (
                    <p className="AppHistoryLabel">
                      Cap reason: {mastery.capReason}
                    </p>
                  ) : null}
                  <p className="AppHistoryLabel">
                    Final mastery band: {mastery?.level ?? "n/a"} (
                    {mastery?.label ?? "n/a"}) | Final mastery %
                    {" "}
                    {mastery?.percentage ?? "n/a"}
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

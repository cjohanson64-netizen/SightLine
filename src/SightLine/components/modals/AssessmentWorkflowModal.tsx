import { useEffect, useMemo, useRef, useState } from "react";
import type { MicAssessmentRunResult } from "@/SightLine/core/audio/types";
import {
  midiToFrequency,
  midiToPitch,
  pitchOctaveForMidi,
  prefersFlatsForKey,
} from "@/SightLine/core/midi";
import type { CalibrationRunResult } from "@/SightLine/core/calibration/types";
import type { DebugSemanticsProjection } from "@/SightLine/domain/artifact";
import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";
import type { CalibrationStatus } from "@/SightLine/hooks/useAssessmentCalibration";
import type { MicAssessmentStatus } from "@/SightLine/hooks/useMicAssessment";
import AssessmentPanel from "../AssessmentPanel";
import NotationViewer from "../NotationViewer/NotationViewer";

export type AssessmentModalStep =
  | "calibration_intro"
  | "calibration_recording"
  | "calibration_failed"
  | "calibration_ready"
  | "assessment_cue"
  | "assessment_recording"
  | "results";

interface AssessmentWorkflowModalProps {
  isOpen: boolean;
  spec: ExerciseSpec;
  targetMelody: MelodyEvent[];
  displayNotationMusicXml: string;
  calibrationStatus: CalibrationStatus;
  calibrationResult: CalibrationRunResult | null;
  calibrationError: string | null;
  assessmentStatus: MicAssessmentStatus;
  assessmentResult: MicAssessmentRunResult | null;
  assessmentError: string | null;
  assessmentAccessMessage: string | null;
  assessmentAccessBlocked: boolean;
  debugSemantics: DebugSemanticsProjection;
  selectedNoteIndex: number | null;
  noteOutcomeByIndex: Array<"correct" | "near" | "incorrect" | "ambiguous" | null>;
  climaxNoteIndices: number[];
  showDeveloperDebug: boolean;
  onClose: () => void;
  onSelectNote: (index: number | null) => void;
  onStartCalibration: () => Promise<void>;
  onFinishCalibration: () => Promise<void>;
  onClearCalibration: () => void;
  onStartAssessment: () => Promise<void>;
  onFinishAssessment: () => Promise<void>;
  onResetWorkflow: () => void;
}

function getStartingPitchLabel(
  spec: ExerciseSpec,
  targetMelody: MelodyEvent[],
  calibrationResult: CalibrationRunResult | null,
): string | null {
  const firstAttack = targetMelody.find((event) => event.isAttack !== false);
  if (!firstAttack) {
    return null;
  }

  const calibrationOffset = calibrationResult?.profile.tonicOffsetSemitones ?? 0;
  const promptMidi = Math.round(firstAttack.midi + calibrationOffset);
  const preferFlats = prefersFlatsForKey(spec.key, spec.mode);
  const pitch = midiToPitch(promptMidi, {
    preferFlats,
    key: spec.key,
    mode: spec.mode,
  });
  const octave = pitchOctaveForMidi(promptMidi, {
    preferFlats,
    key: spec.key,
    mode: spec.mode,
  });

  return `${pitch}${octave}`;
}

function getStartingPitchMidi(
  targetMelody: MelodyEvent[],
  calibrationResult: CalibrationRunResult | null,
): number | null {
  const firstAttack = targetMelody.find((event) => event.isAttack !== false);
  if (!firstAttack) {
    return null;
  }

  const calibrationOffset = calibrationResult?.profile.tonicOffsetSemitones ?? 0;
  return Math.round(firstAttack.midi + calibrationOffset);
}

function scheduleCuePitch(
  audioContext: AudioContext,
  midi: number,
  startTime: number,
  durationSeconds: number,
  gainValue: number,
): void {
  const endTime = startTime + Math.max(0.08, durationSeconds);
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(midiToFrequency(midi), startTime);
  gainNode.gain.setValueAtTime(0.0001, startTime);
  gainNode.gain.linearRampToValueAtTime(
    gainValue,
    Math.min(endTime, startTime + 0.03),
  );
  gainNode.gain.setValueAtTime(gainValue, Math.max(startTime + 0.03, endTime - 0.04));
  gainNode.gain.linearRampToValueAtTime(0.0001, endTime);
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start(startTime);
  oscillator.stop(endTime);
}

export default function AssessmentWorkflowModal({
  isOpen,
  spec,
  targetMelody,
  displayNotationMusicXml,
  calibrationStatus,
  calibrationResult,
  calibrationError,
  assessmentStatus,
  assessmentResult,
  assessmentError,
  assessmentAccessMessage,
  assessmentAccessBlocked,
  debugSemantics,
  selectedNoteIndex,
  noteOutcomeByIndex,
  climaxNoteIndices,
  showDeveloperDebug,
  onClose,
  onSelectNote,
  onStartCalibration,
  onFinishCalibration,
  onClearCalibration,
  onStartAssessment,
  onFinishAssessment,
  onResetWorkflow,
}: AssessmentWorkflowModalProps): JSX.Element | null {
  const [step, setStep] = useState<AssessmentModalStep>("calibration_intro");
  const [countdownValue, setCountdownValue] = useState<number>(3);
  const [assessmentStartTriggered, setAssessmentStartTriggered] =
    useState<boolean>(false);
  const cueTimeoutIdsRef = useRef<number[]>([]);
  const cueAudioContextRef = useRef<AudioContext | null>(null);

  const startingPitchLabel = useMemo(
    () => getStartingPitchLabel(spec, targetMelody, calibrationResult),
    [spec, targetMelody, calibrationResult],
  );
  const startingPitchMidi = useMemo(
    () => getStartingPitchMidi(targetMelody, calibrationResult),
    [targetMelody, calibrationResult],
  );

  const clearCueSequence = () => {
    cueTimeoutIdsRef.current.forEach((timerId) => window.clearTimeout(timerId));
    cueTimeoutIdsRef.current = [];
    if (cueAudioContextRef.current) {
      void cueAudioContextRef.current.close();
      cueAudioContextRef.current = null;
    }
  };

  useEffect(() => {
    if (!isOpen) {
      clearCueSequence();
      setStep("calibration_intro");
      setCountdownValue(3);
      setAssessmentStartTriggered(false);
      return;
    }
    clearCueSequence();
    setStep("calibration_intro");
    setCountdownValue(3);
    setAssessmentStartTriggered(false);
    onSelectNote(null);
  }, [isOpen, onSelectNote]);

  useEffect(() => () => clearCueSequence(), []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (assessmentResult && assessmentStatus === "complete") {
      setStep("results");
      return;
    }

    if (assessmentStatus === "recording" || assessmentStatus === "processing") {
      setStep("assessment_recording");
      return;
    }

    if (assessmentStatus === "error") {
      setStep("calibration_ready");
      clearCueSequence();
      setAssessmentStartTriggered(false);
      setCountdownValue(3);
      return;
    }

    if (calibrationResult && calibrationStatus === "complete") {
      setStep(
        calibrationResult.profile.successful
          ? "calibration_ready"
          : "calibration_failed",
      );
      return;
    }

    if (
      calibrationStatus === "recording" ||
      calibrationStatus === "processing" ||
      calibrationStatus === "requesting_permission"
    ) {
      setStep("calibration_recording");
      return;
    }

    if (calibrationStatus === "error") {
      setStep("calibration_failed");
    }
  }, [
    isOpen,
    calibrationStatus,
    calibrationResult,
    assessmentStatus,
    assessmentResult,
  ]);

  useEffect(() => {
    if (!isOpen || step !== "assessment_cue") {
      return;
    }

    clearCueSequence();
    setCountdownValue(3);

    const cueMidi = startingPitchMidi;
    const cueBeatTotal = 3;
    const cueBeatSpacingMs = 1000;

    if (cueMidi !== null) {
      const audioContext = new AudioContext();
      cueAudioContextRef.current = audioContext;
      const audioStartTime = audioContext.currentTime + 0.05;

      for (let beatIndex = 0; beatIndex < cueBeatTotal; beatIndex += 1) {
        const pulseStartTime = audioStartTime + beatIndex;
        scheduleCuePitch(audioContext, cueMidi, pulseStartTime, 0.34, 0.2);
      }
    }

    for (let tickIndex = 0; tickIndex < cueBeatTotal; tickIndex += 1) {
      const tickTimerId = window.setTimeout(() => {
        setCountdownValue(3 - tickIndex);
      }, tickIndex * cueBeatSpacingMs);
      cueTimeoutIdsRef.current.push(tickTimerId);
    }

    const startAssessmentTimerId = window.setTimeout(() => {
      if (!assessmentStartTriggered) {
        setAssessmentStartTriggered(true);
        void onStartAssessment();
      }
    }, cueBeatTotal * cueBeatSpacingMs);
    cueTimeoutIdsRef.current.push(startAssessmentTimerId);

    return () => {
      clearCueSequence();
    };
  }, [
    isOpen,
    step,
    assessmentStartTriggered,
    startingPitchMidi,
    onStartAssessment,
  ]);

  if (!isOpen) {
    return null;
  }

  const handleModalClose = () => {
    clearCueSequence();
    onClose();
  };

  const handleTryAgain = () => {
    clearCueSequence();
    onResetWorkflow();
    setStep("calibration_intro");
    setCountdownValue(3);
    setAssessmentStartTriggered(false);
  };

  const renderMelodyPreview = (showAssessmentStyling: boolean) => (
    <div className="AssessmentWorkflowNotation">
      <NotationViewer
        musicXml={displayNotationMusicXml}
        timeSig={spec.timeSig}
        phraseLengthMeasures={spec.phraseLengthMeasures}
        selectableNoteCount={showAssessmentStyling ? assessmentResult?.segmentedNotes.length ?? 0 : 0}
        selectedNoteIndex={selectedNoteIndex}
        noteOutcomeByIndex={showAssessmentStyling ? noteOutcomeByIndex : []}
        climaxNoteIndices={showAssessmentStyling ? climaxNoteIndices : []}
        showClimaxMarkers={showAssessmentStyling && Boolean(assessmentResult)}
        onNoteSelect={showAssessmentStyling ? onSelectNote : undefined}
        focusTitle={
          showAssessmentStyling
            ? "Click a colored note to inspect it."
            : "Melody preview"
        }
      />
    </div>
  );

  return (
    <div className="AppModalBackdrop" onClick={handleModalClose} role="presentation">
      <div
        className="AppModal AssessmentWorkflowModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assessment-workflow-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="AppModalClose" onClick={handleModalClose}>
          ×
        </button>

        <div className="AssessmentWorkflowHeader">
          <p className="AssessmentWorkflowEyebrow">Guided Assessment</p>
          <h3 id="assessment-workflow-title">Begin Assessment</h3>
        </div>

        {step === "calibration_intro" ? (
          <div className="AssessmentWorkflowSection">
            <p className="AppHistoryLabel">
              Sing the full scale comfortably in a key that fits your voice so
              SightLine can tune the listening window before the melody check.
            </p>
            <p className="AppHistoryLabel">
              Use a steady <strong>do re mi fa sol la ti do</strong> and keep the
              phrase legato.
            </p>
            {assessmentAccessMessage ? (
              <p className="AppHistoryLabel">{assessmentAccessMessage}</p>
            ) : null}
            <div className="AppBatchActions">
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={handleModalClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={() => void onStartCalibration()}
                disabled={
                  assessmentAccessBlocked ||
                  calibrationStatus === "requesting_permission" ||
                  calibrationStatus === "processing"
                }
              >
                Start Calibration
              </button>
            </div>
          </div>
        ) : null}

        {step === "calibration_recording" ? (
          <div className="AssessmentWorkflowSection">
            <p className="AppHistoryLabel">
              Sing the scale now. Stay relaxed, and keep each pitch steady long
              enough for SightLine to lock in.
            </p>
            {calibrationStatus === "processing" ? (
              <p className="AppHistoryLabel">Analyzing your calibration...</p>
            ) : (
              <p className="AppHistoryLabel">Recording calibration...</p>
            )}
            {calibrationError ? (
              <p className="AppAssessmentError">{calibrationError}</p>
            ) : null}
            <div className="AppBatchActions">
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={handleModalClose}
                disabled={calibrationStatus === "processing"}
              >
                Close
              </button>
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={() => void onFinishCalibration()}
                disabled={
                  calibrationStatus === "requesting_permission" ||
                  calibrationStatus === "processing"
                }
              >
                {calibrationStatus === "processing"
                  ? "Analyzing Calibration..."
                  : "Finish Calibration"}
              </button>
            </div>
          </div>
        ) : null}

        {step === "calibration_failed" ? (
          <div className="AssessmentWorkflowSection">
            <p className="AppHistoryLabel">
              SightLine did not capture enough stable pitch information for a
              strong calibration pass.
            </p>
            <p className="AppHistoryLabel">
              Try again with a steady full scale in a comfortable key.
            </p>
            {calibrationError ? (
              <p className="AppAssessmentError">{calibrationError}</p>
            ) : null}
            {calibrationResult?.warnings.map((warning) => (
              <p key={warning} className="AppAssessmentWarning">
                {warning}
              </p>
            ))}
            <div className="AppBatchActions">
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={handleModalClose}
              >
                Close
              </button>
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={() => {
                  onClearCalibration();
                  void onStartCalibration();
                }}
              >
                Try Calibration Again
              </button>
            </div>
          </div>
        ) : null}

        {step === "calibration_ready" ? (
          <div className="AssessmentWorkflowSection AssessmentWorkflowSection--results">
            <div className="AssessmentWorkflowCallout">
              <p className="AssessmentWorkflowCalloutTitle">
                Calibration complete
              </p>
              <p className="AppHistoryLabel">
                {calibrationResult?.profile.summary ??
                  "SightLine has a stable pitch reference for your voice."}
              </p>
              {startingPitchLabel ? (
                <p className="AppHistoryLabel">
                  Starting pitch: <strong>{startingPitchLabel}</strong>
                </p>
              ) : null}
              <p className="AppHistoryLabel">
                Sing the melody after the short countdown.
              </p>
            </div>
            {renderMelodyPreview(false)}
            {assessmentError ? (
              <p className="AppAssessmentError">{assessmentError}</p>
            ) : null}
            <div className="AppBatchActions">
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={() => {
                  onClearCalibration();
                  void onStartCalibration();
                }}
              >
                Try Calibration Again
              </button>
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={() => {
                  clearCueSequence();
                  onSelectNote(null);
                  setCountdownValue(3);
                  setAssessmentStartTriggered(false);
                  setStep("assessment_cue");
                }}
                disabled={assessmentAccessBlocked}
              >
                Start Assessment
              </button>
            </div>
          </div>
        ) : null}

        {step === "assessment_cue" ? (
          <div className="AssessmentWorkflowSection AssessmentWorkflowSection--centered">
            <p className="AppHistoryLabel">
              Each count gives your starting pitch. Sing as recording begins.
            </p>
            <div className="AssessmentWorkflowCountdown" aria-live="polite">
              {countdownValue}
            </div>
            {startingPitchLabel ? (
              <p className="AppHistoryLabel">
                Start on <strong>{startingPitchLabel}</strong>
              </p>
            ) : null}
          </div>
        ) : null}

        {step === "assessment_recording" ? (
          <div className="AssessmentWorkflowSection AssessmentWorkflowSection--results">
            <div className="AssessmentWorkflowCallout">
              <p className="AssessmentWorkflowCalloutTitle">Sing the melody</p>
              <p className="AppHistoryLabel">
                Follow the notation and finish when you reach the end of the
                phrase.
              </p>
              {startingPitchLabel ? (
                <p className="AppHistoryLabel">
                  Starting pitch: <strong>{startingPitchLabel}</strong>
                </p>
              ) : null}
            </div>
            {renderMelodyPreview(false)}
            {assessmentError ? (
              <p className="AppAssessmentError">{assessmentError}</p>
            ) : null}
            <div className="AppBatchActions">
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={handleModalClose}
                disabled={assessmentStatus === "processing"}
              >
                Close
              </button>
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={() => void onFinishAssessment()}
                disabled={
                  assessmentStatus === "requesting_permission" ||
                  assessmentStatus === "processing"
                }
              >
                {assessmentStatus === "processing"
                  ? "Processing..."
                  : "Finish Assessment"}
              </button>
            </div>
          </div>
        ) : null}

        {step === "results" && assessmentResult ? (
          <div className="AssessmentWorkflowSection AssessmentWorkflowSection--results">
            <div className="AssessmentWorkflowResultsLayout">
              <div className="AssessmentWorkflowResultsNotation">
                {renderMelodyPreview(true)}
              </div>
              <div className="AssessmentWorkflowResultsContent">
                <AssessmentPanel
                  status={assessmentStatus}
                  result={assessmentResult}
                  debugSemantics={debugSemantics}
                  errorMessage={assessmentError}
                  selectedNoteIndex={selectedNoteIndex}
                  showDeveloperDebug={showDeveloperDebug}
                  onSelectNote={onSelectNote}
                  showClearButton={false}
                  className="AssessmentWorkflowResultsPanel"
                />
                <div className="AppBatchActions AssessmentWorkflowResultsActions">
                  <button
                    type="button"
                    className="AppHistoryButton AppProjectionToggleButton"
                    onClick={handleTryAgain}
                  >
                    Try Again
                  </button>
                  <button
                    type="button"
                    className="AppHistoryButton AppProjectionToggleButton"
                    onClick={handleModalClose}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

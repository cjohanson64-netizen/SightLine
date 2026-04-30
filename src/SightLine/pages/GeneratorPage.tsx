//GeneratorPage.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";
import GeneratorNotationControls from "../components/GeneratorNotationControls";
import GeneratorStudentSidebar from "../components/GeneratorStudentSidebar";
import GeneratorTeacherSidebar from "../components/GeneratorTeacherSidebar";
import GeneratorToolbar from "../components/GeneratorToolbar";
import NotationViewer from "../components/NotationViewer/NotationViewer";
import ErrorBanner from "../components/ErrorBanner/ErrorBanner";
import { usePlayback } from "../hooks/usePlayback";
import { useProjection } from "../hooks/useProjection";
import { useAssessmentRecorder } from "../hooks/useAssessmentRecorder";
import { useSolfege } from "../hooks/useSolfege";
import { useStudentSession } from "../hooks/useStudentSession";
import { useTeacherLibrary } from "../hooks/useTeacherLibrary";
import { normalizeUserConstraintsInSpec } from "../core/spec";
import { runAssessment } from "../core/assessment/runAssessment";
import {
  buildAssessmentScore,
  type AssessmentScore,
  type PitchAssessmentStatus,
} from "../core/assessment/assessmentScoring";
import { midiToFrequency } from "../core/midi";
import type {
  DetectedTonic,
  NormalizedActualNote,
  NormalizedExpectedNote,
  PcmAudioBuffer,
} from "../core/assessment/types";
import {
  buildDetectedTonicFromGeneratedExercise,
  buildExpectedMelodyFromGeneratedExercise,
  buildExpectedRhythmFromGeneratedExercise,
} from "../core/assessment/buildExpectedFromGeneratedExercise";
type PlaybackState = ReturnType<typeof usePlayback>;
type ProjectionState = ReturnType<typeof useProjection>;
type SolfegeState = ReturnType<typeof useSolfege>;
type StudentState = ReturnType<typeof useStudentSession>;
type TeacherState = ReturnType<typeof useTeacherLibrary>;
type AssessmentResult = Awaited<ReturnType<typeof runAssessment>>;
type AssessmentStatus =
  | "idle"
  | "recording"
  | "processing"
  | "complete"
  | "error";
type RhythmMarker = "match" | "close" | "mismatch" | "missing";

const NOTE_FEEDBACK_COLORS = {
  correct: "#1ecf87",
  close: "#ffd54a",
  lowConfidence: "#ff9f43",
  incorrect: "#e25555",
  missing: "#8a98aa",
} satisfies Record<PitchAssessmentStatus, string>;

const LOW_CONFIDENCE_THRESHOLD = 0.65;
const ASSESSMENT_SCALE_OFFSETS = [0, 2, 4, 5, 7, 5, 4, 2, 0];

function findExpectedNote(
  notes: NormalizedExpectedNote[],
  id: string | null,
): NormalizedExpectedNote | null {
  return id ? notes.find((note) => note.id === id) ?? null : null;
}

function findActualNote(
  notes: NormalizedActualNote[],
  id: string | null,
): NormalizedActualNote | null {
  return id ? notes.find((note) => note.id === id) ?? null : null;
}

function getRenderableAttackEventIndices(melody: MelodyEvent[]): number[] {
  const indices: number[] = [];

  for (let index = 0; index < melody.length; index += 1) {
    if (melody[index].isAttack !== false) {
      indices.push(index);
    }
  }

  return indices;
}

function getAssessmentReferenceOffset(params: {
  alignedPairs: AssessmentResult["normalized"]["alignedPairs"];
  expectedNotes: NormalizedExpectedNote[];
  actualNotes: NormalizedActualNote[];
}): number {
  const { alignedPairs, expectedNotes, actualNotes } = params;

  for (const pair of alignedPairs) {
    if (pair.kind !== "matched") {
      continue;
    }

    const expected = findExpectedNote(expectedNotes, pair.expectedNoteId);
    const actual = findActualNote(actualNotes, pair.actualNoteId);

    if (expected && actual) {
      return actual.midiFloat - expected.midiFloat;
    }
  }

  return 0;
}

function buildPitchStatusMapFromAssessment(params: {
  result: AssessmentResult;
}): Record<number, PitchAssessmentStatus | undefined> {
  const {
    result: {
      normalized: {
        alignedPairs,
        expectedNotes,
        actualNotes,
      },
    },
  } = params;
  const statusesByIndex: Record<number, PitchAssessmentStatus | undefined> = {};
  const referenceOffset = getAssessmentReferenceOffset({
    alignedPairs,
    expectedNotes,
    actualNotes,
  });

  for (const pair of alignedPairs) {
    const expected = findExpectedNote(expectedNotes, pair.expectedNoteId);

    if (!expected) {
      continue;
    }

    if (pair.kind === "omission") {
      statusesByIndex[expected.index] = "missing";
      continue;
    }

    const actual = findActualNote(actualNotes, pair.actualNoteId);

    if (!actual) {
      statusesByIndex[expected.index] = "missing";
      continue;
    }

    if (actual.confidence < LOW_CONFIDENCE_THRESHOLD) {
      statusesByIndex[expected.index] = "lowConfidence";
      continue;
    }

    const pitchDelta = Math.abs(
      actual.midiFloat - referenceOffset - expected.midiFloat,
    );

    if (pitchDelta <= 0.5) {
      statusesByIndex[expected.index] = "correct";
    } else if (pitchDelta <= 2) {
      statusesByIndex[expected.index] = "close";
    } else {
      statusesByIndex[expected.index] = "incorrect";
    }
  }

  return statusesByIndex;
}

function buildNoteColorMapFromPitchStatuses(params: {
  pitchStatusesByIndex: Record<number, PitchAssessmentStatus | undefined>;
  melody: MelodyEvent[];
}): Record<number, string | undefined> {
  const { pitchStatusesByIndex, melody } = params;
  const colorsByIndex: Record<number, string | undefined> = {};
  const attackEventIndices = getRenderableAttackEventIndices(melody);

  for (const [rawExpectedIndex, status] of Object.entries(
    pitchStatusesByIndex,
  )) {
    const expectedIndex = Number(rawExpectedIndex);
    const eventIndex = attackEventIndices[expectedIndex];

    if (!status || eventIndex === undefined) {
      continue;
    }

    colorsByIndex[eventIndex] = NOTE_FEEDBACK_COLORS[status];
  }

  return colorsByIndex;
}

function buildRhythmMarkerMapFromAssessment(
  result: AssessmentResult | null,
): Record<number, RhythmMarker | undefined> {
  if (!result?.rhythmAnalysis) {
    return {};
  }

  const markersByIndex: Record<number, RhythmMarker | undefined> = {};

  for (const expectedNote of result.normalized.expectedNotes) {
    markersByIndex[expectedNote.index] = "missing";
  }

  if (result.rhythmAnalysis.isProvisional) {
    return markersByIndex;
  }

  for (const window of result.rhythmAnalysis.windows) {
    markersByIndex[window.index] = window.classification;
  }

  return markersByIndex;
}

function rounded(value: number, fractionDigits = 2): number {
  return Number(value.toFixed(fractionDigits));
}

function formatScorePercent(value: number): string {
  return `${Math.round(value)}%`;
}

function buildRhythmDurationsMs(
  events: AssessmentResult["rhythmNotes"]["noteEvents"],
): number[] {
  return events.map((event, index) => {
    const next = events[index + 1];
    const durationMs = next
      ? next.startMs - event.startMs
      : event.endMs - event.startMs;

    return rounded(Math.max(0, durationMs), 1);
  });
}

function logAssessmentRhythmDebug(params: {
  result: AssessmentResult;
  expectedRhythmUnits: number[];
  expectedNoteCount: number;
}): void {
  const { result, expectedRhythmUnits, expectedNoteCount } = params;
  const rhythmAnalysis = result.rhythmAnalysis;

  console.log("SightLine rhythm assessment", {
    expectedRhythmUnits,
    rawDetectedRhythmMs: buildRhythmDurationsMs(result.rhythmNotes.noteEvents),
    analyzedRhythmMs: buildRhythmDurationsMs(
      result.rhythmAnalysisNotes.noteEvents,
    ),
    actualSungRhythmUnits:
      rhythmAnalysis?.windows.map((window) =>
        window.expectedMs > 0
          ? rounded((window.actualMs / window.expectedMs) * window.expectedUnits)
          : null,
      ) ?? [],
    rhythmWindows:
      rhythmAnalysis?.windows.map((window) => ({
        index: window.index,
        expectedUnits: window.expectedUnits,
        actualMs: rounded(window.actualMs, 1),
        expectedMs: rounded(window.expectedMs, 1),
        classification: window.classification,
        isFinal: window.isFinal,
    })) ?? [],
    expectedNoteCount,
    pitchNoteCount: result.pitchNotes.noteEvents.length,
    rawRhythmNoteCount: result.rhythmNotes.noteEvents.length,
    analyzedRhythmNoteCount: result.rhythmAnalysisNotes.noteEvents.length,
    rhythmIsProvisional: rhythmAnalysis?.isProvisional ?? false,
    rhythmProvisionalReason: rhythmAnalysis?.provisionalReason ?? null,
    rhythmConfidence: rhythmAnalysis
      ? rounded(rhythmAnalysis.rhythmConfidence)
      : null,
  });
}

function getAssessButtonLabel(params: {
  status: AssessmentStatus;
  isRecording: boolean;
  isRequestingPermission: boolean;
}): string {
  if (params.isRequestingPermission) {
    return "Requesting Mic...";
  }

  if (params.status === "processing") {
    return "Assessing...";
  }

  if (params.isRecording || params.status === "recording") {
    return "Stop + Assess";
  }

  return "Assess";
}

function scheduleAssessmentScaleTone(params: {
  audioContext: AudioContext;
  midi: number;
  startTime: number;
  durationSeconds: number;
  oscillatorType: OscillatorType;
}): void {
  const { audioContext, midi, startTime, durationSeconds, oscillatorType } =
    params;
  const endTime = startTime + Math.max(0.08, durationSeconds);
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = oscillatorType;
  oscillator.frequency.setValueAtTime(midiToFrequency(midi), startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(0.18, startTime + 0.02);
  gain.gain.setValueAtTime(0.15, Math.max(startTime + 0.03, endTime - 0.04));
  gain.gain.linearRampToValueAtTime(0.0001, endTime);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startTime);
  oscillator.stop(endTime);
}

interface GeneratorPageProps {
  currentMelody: MelodyEvent[];
  currentPatchedMelody: MelodyEvent[];
  currentSpecSnapshot: ExerciseSpec | null;
  climaxNoteIndices: number[];
  displayNotationMusicXml: string;
  error: { title: string; message: string; suggestions: string[] } | null;
  exportMusicXml: string;
  formatSavedDate: (value: string | null | undefined) => string;
  handleJoinClassroom: () => Promise<void>;
  handleLeaveClassroom: () => void;
  handleLoadClassroomExercise: (exerciseId: string) => Promise<void>;
  handleLoadSavedExercise: (id: string) => Promise<void>;
  handleNotationKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  handleSaveToSupabase: (forceInsert?: boolean) => Promise<void>;
  handleSubmitToTeacher: () => Promise<void>;
  isGuestMode: boolean;
  mode: "teacher" | "student" | "guest";
  notationContainerRef: React.RefObject<HTMLDivElement | null>;
  onExport: () => void;
  onOpenMelodyPreferences: () => void;
  pitchEditMode: boolean;
  playback: PlaybackState;
  projection: ProjectionState;
  relaxationNotice: string;
  runWithNewSeed: () => void;
  rerunWithCurrentSeed: () => void;
  saveMessage: string;
  saveStatus: "idle" | "saving" | "saved" | "error";
  setEditMessage: (value: string) => void;
  setPitchEditMode: React.Dispatch<React.SetStateAction<boolean>>;
  setSpec: React.Dispatch<React.SetStateAction<ExerciseSpec>>;
  solfege: SolfegeState;
  spec: ExerciseSpec;
  student: StudentState;
  teacher: TeacherState;
  teacherFeaturesDisabled: boolean;
  updateExerciseTitle: (value: string) => void;
  interactionDisabled: boolean;
  onAssessmentNoteColorsChange: (
    value: Record<number, string | undefined>,
  ) => void;
}

export default function GeneratorPage({
  currentMelody,
  currentPatchedMelody,
  currentSpecSnapshot,
  climaxNoteIndices,
  displayNotationMusicXml,
  error,
  exportMusicXml,
  formatSavedDate,
  handleJoinClassroom,
  handleLeaveClassroom,
  handleLoadClassroomExercise,
  handleLoadSavedExercise,
  handleNotationKeyDown,
  handleSaveToSupabase,
  handleSubmitToTeacher,
  isGuestMode,
  mode,
  notationContainerRef,
  onExport,
  onOpenMelodyPreferences,
  pitchEditMode,
  playback,
  projection,
  relaxationNotice,
  runWithNewSeed,
  rerunWithCurrentSeed,
  saveMessage,
  saveStatus,
  setEditMessage,
  setPitchEditMode,
  setSpec,
  solfege,
  spec,
  student,
  teacher,
  teacherFeaturesDisabled,
  updateExerciseTitle,
  interactionDisabled,
  onAssessmentNoteColorsChange,
}: GeneratorPageProps): JSX.Element {
  const notationSpec = currentSpecSnapshot ?? spec;
  const assessmentSourceMelody =
    currentPatchedMelody.length > 0 ? currentPatchedMelody : currentMelody;
  const assessmentTargetMelody = assessmentSourceMelody.filter(
    (note) => note.isAttack !== false,
  );
  const currentExerciseId =
    currentSpecSnapshot?.title?.trim() ||
    spec.title.trim() ||
    "generated-exercise";
  const {
    isRecording: isAssessmentRecording,
    isRequestingPermission: isAssessmentRequestingPermission,
    startRecording,
    stopRecording,
  } = useAssessmentRecorder();
  const assessmentScalePlaybackRef = useRef<{
    context: AudioContext;
    timerId: number;
  } | null>(null);
  const [assessmentResult, setAssessmentResult] =
    useState<AssessmentResult | null>(null);
  const [assessmentStatus, setAssessmentStatus] =
    useState<AssessmentStatus>("idle");
  const [isAssessmentModalOpen, setIsAssessmentModalOpen] = useState(false);

  function getWrittenTonic(): DetectedTonic {
    return buildDetectedTonicFromGeneratedExercise(
      notationSpec,
      assessmentSourceMelody,
    );
  }

  function clearAssessmentResult() {
    setAssessmentResult(null);
    setAssessmentStatus("idle");
    onAssessmentNoteColorsChange({});
  }

  function stopAssessmentScale() {
    const playbackState = assessmentScalePlaybackRef.current;

    if (!playbackState) {
      return;
    }

    window.clearTimeout(playbackState.timerId);
    void playbackState.context.close();
    assessmentScalePlaybackRef.current = null;
  }

  function handlePlayAssessmentScale() {
    stopAssessmentScale();

    const tonic = getWrittenTonic();
    const audioContext = new AudioContext();
    const beatSeconds = 60 / Math.max(30, Math.min(240, playback.tempoBpm));
    const startTime = audioContext.currentTime + 0.05;
    let maxEndTime = startTime;

    ASSESSMENT_SCALE_OFFSETS.forEach((offset, index) => {
      const noteStart = startTime + index * beatSeconds;
      const noteDuration = beatSeconds * 0.92;

      scheduleAssessmentScaleTone({
        audioContext,
        midi: tonic.tonicMidi + offset,
        startTime: noteStart,
        durationSeconds: noteDuration,
        oscillatorType: playback.instrument,
      });

      maxEndTime = Math.max(maxEndTime, noteStart + noteDuration);
    });

    assessmentScalePlaybackRef.current = {
      context: audioContext,
      timerId: window.setTimeout(() => {
        void audioContext.close();

        if (assessmentScalePlaybackRef.current?.context === audioContext) {
          assessmentScalePlaybackRef.current = null;
        }
      }, Math.ceil((maxEndTime - audioContext.currentTime) * 1000) + 100),
    };
  }

  async function runAssessmentForAudio(pcmAudio: PcmAudioBuffer) {
    setAssessmentStatus("processing");
    const tonic = getWrittenTonic();
    const expectedMelody = buildExpectedMelodyFromGeneratedExercise(
      assessmentSourceMelody,
      currentExerciseId,
    );
    const expectedRhythm = buildExpectedRhythmFromGeneratedExercise(
      assessmentSourceMelody,
    );

    try {
      const result = await runAssessment({
        exerciseId: currentExerciseId,
        expectedMelody,
        expectedRhythm,
        tonic,
        melodyAudio: pcmAudio,
        enableRhythmAnalysis: true,
      });

      const pitchStatusesByIndex = buildPitchStatusMapFromAssessment({
        result,
      });

      logAssessmentRhythmDebug({
        result,
        expectedRhythmUnits: expectedRhythm.units,
        expectedNoteCount: expectedMelody.notes.length,
      });

      setAssessmentResult(result);
      setAssessmentStatus("complete");
      onAssessmentNoteColorsChange(
        buildNoteColorMapFromPitchStatuses({
          pitchStatusesByIndex,
          melody: assessmentSourceMelody,
        }),
      );

    } catch (err) {
      setAssessmentResult(null);
      setAssessmentStatus("error");
      onAssessmentNoteColorsChange({});
      console.error("Assessment failed:", err);
    }
  }

  async function handleBeginAssessment() {
    setIsAssessmentModalOpen(false);
    stopAssessmentScale();

    if (isAssessmentRecording) {
      const pcmAudio = await stopRecording();

      if (!pcmAudio) {
        setAssessmentStatus("error");
        return;
      }

      await runAssessmentForAudio(pcmAudio);
      return;
    }

    clearAssessmentResult();
    setAssessmentStatus("recording");
    await startRecording();
  }

  function handleAssess() {
    if (isAssessmentRecording) {
      void handleBeginAssessment();
      return;
    }

    setIsAssessmentModalOpen(true);
  }

  function handleCloseAssessmentModal() {
    setIsAssessmentModalOpen(false);
    stopAssessmentScale();
  }

  const rhythmMarkersByIndex = useMemo(
    () => buildRhythmMarkerMapFromAssessment(assessmentResult),
    [assessmentResult],
  );
  const pitchStatusesByIndex = useMemo(
    () =>
      assessmentResult
        ? buildPitchStatusMapFromAssessment({ result: assessmentResult })
        : {},
    [assessmentResult],
  );
  const assessmentScore: AssessmentScore | null = useMemo(
    () =>
      assessmentResult
        ? buildAssessmentScore({
            pitchStatusesByIndex,
            rhythmMarkersByIndex,
            expectedNoteCount: assessmentResult.normalized.expectedNotes.length,
            rhythmIsProvisional:
              assessmentResult.rhythmAnalysis?.isProvisional ?? true,
          })
        : null,
    [assessmentResult, pitchStatusesByIndex, rhythmMarkersByIndex],
  );
  const assessLabel = getAssessButtonLabel({
    status: assessmentStatus,
    isRecording: isAssessmentRecording,
    isRequestingPermission: isAssessmentRequestingPermission,
  });

  useEffect(() => {
    if (!isAssessmentModalOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleCloseAssessmentModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAssessmentModalOpen]);

  useEffect(() => () => stopAssessmentScale(), []);

  return (
    <div
      className={`AppMain ${projection.isProjectionMode ? "AppMainProjection" : ""}`}
    >
      {!projection.isProjectionMode ? (
        <>
          <div className="AppNotationToolbar">
            <GeneratorToolbar
              mode={mode}
              interactionDisabled={interactionDisabled}
              teacherFeaturesDisabled={teacherFeaturesDisabled}
              upgradeRequiredTitle="Upgrade required"
              folders={teacher.folders}
              selectedFolderId={teacher.selectedFolderId}
              onSelectFolderId={teacher.setSelectedFolderId}
              creatingFolder={teacher.creatingFolder}
              studentClassName={student.studentSession?.classroom.name ?? null}
              titleValue={spec.title}
              titlePlaceholder={
                currentMelody.length > 0 ? "Exercise title" : "SightLine Melody"
              }
              onTitleChange={updateExerciseTitle}
              onGenerate={() => {
                clearAssessmentResult();
                runWithNewSeed();
              }}
              onAssess={() => void handleAssess()}
              assessLabel={assessLabel}
              assessDisabled={
                assessmentStatus === "processing" ||
                isAssessmentRequestingPermission ||
                assessmentTargetMelody.length === 0
              }
              showUpdateSave={Boolean(teacher.activeExerciseId)}
              saveDisabled={
                mode !== "teacher" || !exportMusicXml || saveStatus === "saving"
              }
              onSaveNew={() => void handleSaveToSupabase(true)}
              onSaveUpdate={() => void handleSaveToSupabase()}
              onOpenPreferences={onOpenMelodyPreferences}
              onExportMusicXml={() => {
                if (!isGuestMode && !teacherFeaturesDisabled) {
                  onExport();
                }
              }}
              onTogglePitchEdit={() => {
                setPitchEditMode((prev) => !prev);
                setEditMessage("");
              }}
              pitchEditEnabled={pitchEditMode}
              studentSubmitLabel={
                student.studentSubmitStatus === "saving"
                  ? "Submitting..."
                  : "Submit to Teacher"
              }
              onStudentSubmit={() => void handleSubmitToTeacher()}
              studentSubmitDisabled={
                student.studentSubmitStatus === "saving" || !exportMusicXml
              }
            />
          </div>

          {isAssessmentModalOpen ? (
            <div
              className="AppModalBackdrop"
              onClick={handleCloseAssessmentModal}
              role="presentation"
            >
              <div
                className="AppModal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="assessment-start-title"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="AppModalClose"
                  onClick={handleCloseAssessmentModal}
                >
                  ×
                </button>
                <h3 id="assessment-start-title">Ready to Assess?</h3>
                <p className="AppHistoryLabel">
                  Listen to the scale, then begin when you are ready.
                </p>
                <div className="AppBatchActions">
                  <button
                    type="button"
                    className="AppHistoryButton AppProjectionToggleButton"
                    onClick={handleCloseAssessmentModal}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="AppHistoryButton AppProjectionToggleButton"
                    onClick={handlePlayAssessmentScale}
                  >
                    Play Scale
                  </button>
                  <button
                    type="button"
                    className="AppHistoryButton AppProjectionToggleButton"
                    onClick={() => void handleBeginAssessment()}
                  >
                    Begin
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {teacher.foldersError ? (
            <p
              className="AppHistoryLabel"
              style={{ margin: "0.2rem 0 0.5rem" }}
            >
              {teacher.foldersError}
            </p>
          ) : null}
          {mode === "teacher" && teacher.classroomDefaultsMessage ? (
            <p
              className="AppHistoryLabel"
              style={{ margin: "0.2rem 0 0.5rem" }}
            >
              {teacher.classroomDefaultsStatus === "loading"
                ? "Updating class defaults..."
                : teacher.classroomDefaultsMessage}
            </p>
          ) : null}
          {saveStatus !== "idle" ? (
            <p
              className="AppHistoryLabel"
              style={{ margin: "0.2rem 0 0.5rem" }}
            >
              {saveStatus === "saving" ? "Saving..." : saveMessage}
            </p>
          ) : null}
          {assessmentScore ? (
            <section
              className="AppAssessmentScoreStrip"
              aria-label="Assessment scores"
            >
              <div className="AppAssessmentScoreItem AppAssessmentScoreMastery">
                <span className="AppAssessmentScoreLabel">Mastery</span>
                <strong>{assessmentScore.mastery}</strong>
              </div>
              <div className="AppAssessmentScoreItem">
                <span className="AppAssessmentScoreLabel">
                  Pitch Accuracy
                </span>
                <strong>
                  {formatScorePercent(assessmentScore.pitchAccuracy)}
                </strong>
              </div>
              <div className="AppAssessmentScoreItem">
                <span className="AppAssessmentScoreLabel">
                  Rhythm Accuracy
                </span>
                <strong>
                  {assessmentScore.rhythmIncluded &&
                  assessmentScore.rhythmAccuracy !== null
                    ? formatScorePercent(assessmentScore.rhythmAccuracy)
                    : "Not reliable"}
                </strong>
              </div>
              <div className="AppAssessmentScoreItem">
                <span className="AppAssessmentScoreLabel">Melody Score</span>
                <strong>
                  {formatScorePercent(assessmentScore.melodyScore)}
                </strong>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      <div
        className={`AppTopRow ${projection.isProjectionMode ? "AppTopRowProjection" : ""}`}
      >
        <div
          className={`AppPrimaryColumn ${projection.isProjectionMode ? "AppPrimaryColumnProjection" : ""}`}
        >
          <div
            ref={notationContainerRef as React.RefObject<HTMLDivElement>}
            className={`AppNotationPane ${projection.isProjectionMode ? "AppNotationPaneProjection" : ""}`}
            onMouseMove={
              projection.isProjectionMode
                ? projection.handleMouseMove
                : undefined
            }
          >
            {!projection.isProjectionMode && error ? (
              <ErrorBanner
                title={error.title}
                message={error.message}
                suggestions={error.suggestions}
              />
            ) : null}
            {!projection.isProjectionMode && relaxationNotice ? (
              <p className="AppRelaxationNotice">{relaxationNotice}</p>
            ) : null}

            <NotationViewer
              musicXml={displayNotationMusicXml}
              timeSig={notationSpec.timeSig}
              phraseLengthMeasures={notationSpec.phraseLengthMeasures}
              climaxNoteIndices={climaxNoteIndices}
              showClimaxMarkers={false}
              zoom={projection.isProjectionMode ? 2.5 : 1}
              projectionMode={projection.isProjectionMode}
              solfegeActive={solfege.solfegeMode !== "off"}
              solfegeColorizeLyrics={solfege.solfegeColorizeMode !== "off"}
              rhythmMarkersByIndex={rhythmMarkersByIndex}
              solfegeOverlayNoteheads={
                solfege.solfegeMode !== "off" && solfege.solfegeOverlayMode
              }
              enableGlowEffects={
                playback.playbackHighlightIndex !== null || pitchEditMode
              }
              onKeyDown={handleNotationKeyDown}
              focusTitle={
                pitchEditMode
                  ? "Pitch edit is on. Click to focus and use arrows."
                  : "Pitch edit is off."
              }
              headerControls={
                <div className="AppHistoryControls">
                  <div className="AppHistoryNav">
                    {!projection.isProjectionMode ? (
                      <div />
                    ) : (
                      <div
                        className={`AppProjectionHeaderRow ${projection.showProjectionControls ? "" : "AppProjectionControlsHidden"}`}
                      >
                        <span className="AppProjectionTitle">{spec.title}</span>
                        <button
                          type="button"
                          className="AppHistoryButton AppProjectionToggleButton AppProjectionExitButton"
                          onClick={() => void projection.toggle()}
                          title="Exit projection mode"
                          disabled={interactionDisabled}
                        >
                          Exit Projection
                        </button>
                      </div>
                    )}
                  </div>
                  {!projection.isProjectionMode ? (
                    <GeneratorNotationControls
                      currentMelodyCount={currentMelody.length}
                      exportMusicXml={exportMusicXml}
                      interactionDisabled={interactionDisabled}
                      isGuestMode={isGuestMode}
                      onExport={onExport}
                      pitchEditMode={pitchEditMode}
                      playback={playback}
                      projection={projection}
                      setEditMessage={setEditMessage}
                      setPitchEditMode={setPitchEditMode}
                      solfege={solfege}
                      teacherFeaturesDisabled={teacherFeaturesDisabled}
                    />
                  ) : null}
                </div>
              }
            />

            {projection.isProjectionMode ? (
              <div
                className={`AppProjectionFloatingControls ${projection.showProjectionControls ? "" : "AppProjectionControlsHidden"}`}
              >
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionActionButton"
                  onClick={runWithNewSeed}
                  disabled={interactionDisabled}
                >
                  Generate Melody
                </button>
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionActionButton"
                  onClick={() => playback.play()}
                  disabled={currentMelody.length === 0}
                  data-allow-while-playing="true"
                >
                  {playback.isPlaying ? "Stop" : "Play"}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {!projection.isProjectionMode ? (
          <aside className="AppMelodyPanel">
            {mode !== "teacher" ? (
              <GeneratorStudentSidebar
                formatSavedDate={formatSavedDate}
                handleJoinClassroom={handleJoinClassroom}
                handleLeaveClassroom={handleLeaveClassroom}
                handleLoadClassroomExercise={handleLoadClassroomExercise}
                interactionDisabled={interactionDisabled}
                normalizeSpec={normalizeUserConstraintsInSpec}
                setSpec={setSpec}
                spec={spec}
                student={student}
              />
            ) : null}

            {mode === "teacher" ? (
              <GeneratorTeacherSidebar
                formatSavedDate={formatSavedDate}
                handleLoadSavedExercise={handleLoadSavedExercise}
                interactionDisabled={interactionDisabled}
                teacher={teacher}
                teacherFeaturesDisabled={teacherFeaturesDisabled}
              />
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

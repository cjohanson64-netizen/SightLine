//GeneratorPage.tsx

import { useState } from "react";
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
import type {
  DetectedTonic,
  ExpectedMelody,
  ExpectedRhythm,
} from "../core/assessment/types";
import {
  noteSegmentationService,
  normalizationAlignmentService,
  pitchExtractionService,
  relationalAnalysisService,
  rhythmAnalysisService,
  signalCleaningService,
} from "../core/assessment/services";
import { normalize } from "zod";

type PlaybackState = ReturnType<typeof usePlayback>;
type ProjectionState = ReturnType<typeof useProjection>;
type SolfegeState = ReturnType<typeof useSolfege>;
type StudentState = ReturnType<typeof useStudentSession>;
type TeacherState = ReturnType<typeof useTeacherLibrary>;

function logJSON(label: string, value: unknown): void {
  console.log(`${label}:\n`, JSON.stringify(value, null, 2));
}

interface GeneratorPageProps {
  currentMelody: MelodyEvent[];
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
}

export default function GeneratorPage({
  currentMelody,
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
}: GeneratorPageProps): JSX.Element {
  const notationSpec = currentSpecSnapshot ?? spec;
  const assessmentTargetMelody = currentMelody.filter(
    (note) => note.isAttack !== false,
  );
  const currentExerciseId =
    currentSpecSnapshot?.title?.trim() ||
    spec.title.trim() ||
    "generated-exercise";
  const {
    isRecording: isDebugRecording,
    isRequestingPermission: isDebugRequestingPermission,
    error: debugRecorderError,
    startRecording,
    stopRecording,
    resetRecording,
  } = useAssessmentRecorder();
  const [debugFrameCount, setDebugFrameCount] = useState(0);
  const [debugVoicedCount, setDebugVoicedCount] = useState(0);
  const [debugStableNoteCount, setDebugStableNoteCount] = useState(0);
  const [debugRhythmEnabled, setDebugRhythmEnabled] = useState(true);
  const [debugExpectedDegrees, setDebugExpectedDegrees] = useState<number[]>(
    [],
  );
  const [debugActualDegrees, setDebugActualDegrees] = useState<number[]>([]);

  async function handleAssess() {
    try {
      const expectedMelody: ExpectedMelody = {
        exerciseId: currentExerciseId,
        notes: assessmentTargetMelody.map((note, index) => ({
          id: note.keyId || `e${index}`,
          index,
          writtenMidi: note.midi,
          writtenNoteName: `${note.pitch}${note.octave}`,
        })),
      };

      const result = await runAssessment({
        exerciseId: currentExerciseId,
        expectedMelody,
      });

      console.log("Assessment result:", result);
    } catch (err) {
      console.error("Assessment failed:", err);
    }
  }

  async function handleStartDebugRecord() {
    setDebugFrameCount(0);
    setDebugVoicedCount(0);
    setDebugStableNoteCount(0);
    await startRecording();
  }

  async function handleStopAndExtractPitch() {
    const pcmAudio = await stopRecording();

    if (!pcmAudio) {
      return;
    }

    const pitch = await pitchExtractionService.run({
      melodyAudio: pcmAudio,
      frameSize: 2048,
      hopSize: 256,
      clarityThreshold: 0.8,
    });

    const cleaned = signalCleaningService.run({
      frames: pitch.frames,
      clarityThreshold: 0.8,
      smoothingWindowSize: 5,
    });

    const detectedTonic: DetectedTonic = {
      tonicHz: 130.81,
      tonicMidi: 48,
      tonicPitchClass: 0,
      tonicNoteName: "C3",
      confidence: 1,
    };

    const expectedMelody: ExpectedMelody = {
      exerciseId: "arch-1",
      notes: [
        { id: "e1", index: 0, writtenMidi: 48, writtenNoteName: "C3" }, // DO
        { id: "e2", index: 1, writtenMidi: 50, writtenNoteName: "D3" }, // RE
        { id: "e3", index: 2, writtenMidi: 52, writtenNoteName: "E3" }, // MI
        { id: "e4", index: 3, writtenMidi: 55, writtenNoteName: "G3" }, // SOL
        { id: "e5", index: 4, writtenMidi: 52, writtenNoteName: "E3" }, // MI
        { id: "e6", index: 5, writtenMidi: 50, writtenNoteName: "D3" }, // RE
        { id: "e7", index: 6, writtenMidi: 48, writtenNoteName: "C3" }, // DO
      ],
    };

    const expectedRhythm: ExpectedRhythm = {
      units: [2, 1, 1, 2, 2, 2, 2],
    };

    const stableNotes = noteSegmentationService.run({
      frames: cleaned.frames,
      minNoteDurationMs: 40,
    });

    const normalized = normalizationAlignmentService.run({
      tonic: detectedTonic,
      expectedMelody,
      actualNotes: stableNotes.noteEvents,
    });

    const analysis = relationalAnalysisService.run({
      tonic: detectedTonic,
      expectedNotes: normalized.expectedNotes,
      actualNotes: normalized.actualNotes,
      alignedPairs: normalized.alignedPairs,
      expectedIntervals: normalized.expectedIntervals,
      actualIntervals: normalized.actualIntervals,
      windows: [],
    });

    const rhythmAnalysis = debugRhythmEnabled
      ? rhythmAnalysisService.run({
          expectedRhythm,
          actualEvents: stableNotes.noteEvents,
          melodicConfidence: analysis.analysisConfidence,
          melodicIsReliable:
            stableNotes.noteEvents.length === expectedMelody.notes.length,
          melodicStructureReliable:
            stableNotes.noteEvents.length === expectedMelody.notes.length,
          melodicStructureReason:
            stableNotes.noteEvents.length === expectedMelody.notes.length
              ? undefined
              : "Stable note-event structure did not match expected note count.",
        })
      : null;

    const voicedRaw = pitch.frames.filter((frame) => frame.isVoiced);

    setDebugFrameCount(cleaned.frames.length);
    setDebugVoicedCount(voicedRaw.length);
    setDebugStableNoteCount(stableNotes.noteEvents.length);
    setDebugExpectedDegrees(normalized.expectedDegrees);
    setDebugActualDegrees(normalized.actualDegrees);

    logJSON("Expected degrees", normalized.expectedDegrees);
    logJSON("Actual degrees", normalized.actualDegrees);
    logJSON("Relational analysis", analysis);
    if (rhythmAnalysis) {
      logJSON("Rhythm windows", rhythmAnalysis.windows);
      logJSON("Rhythm findings", rhythmAnalysis.findings);
      logJSON("Rhythm confidence", {
        rhythmConfidence: rhythmAnalysis.rhythmConfidence,
        bodyRhythmConfidence: rhythmAnalysis.bodyRhythmConfidence,
        finalRhythmConfidence: rhythmAnalysis.finalRhythmConfidence,
        tailAnomalyIndices: rhythmAnalysis.tailAnomalyIndices ?? [],
        windowWeights: rhythmAnalysis.windowWeights ?? [],
      });
      logJSON("Rhythm provisional", {
        isProvisional: rhythmAnalysis.isProvisional,
        provisionalReason: rhythmAnalysis.provisionalReason ?? null,
      });
      logJSON("Rhythm debug payload", rhythmAnalysis);
    }
  }

  function handleResetDebug() {
    resetRecording();
    setDebugFrameCount(0);
    setDebugVoicedCount(0);
    setDebugStableNoteCount(0);
  }

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
              onGenerate={runWithNewSeed}
              onAssess={() => void handleAssess()}
              assessDisabled={
                interactionDisabled || assessmentTargetMelody.length === 0
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
          <div
            style={{
              margin: "0.2rem 0 0.5rem",
              padding: "0.65rem 0.8rem",
              border: "1px dashed rgba(142, 164, 190, 0.45)",
              borderRadius: "10px",
              background: "rgba(14, 20, 30, 0.45)",
            }}
          >
            <p className="AppHistoryLabel" style={{ margin: "0 0 0.45rem" }}>
              Temporary Debug: Recorder + Blind/Guided Segmentation
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={() => void handleStartDebugRecord()}
                disabled={
                  interactionDisabled ||
                  isDebugRecording ||
                  isDebugRequestingPermission
                }
              >
                {isDebugRequestingPermission
                  ? "Requesting Mic..."
                  : "Start Debug Record"}
              </button>
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={() => void handleStopAndExtractPitch()}
                disabled={interactionDisabled || !isDebugRecording}
              >
                Stop + Extract Pitch
              </button>
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={handleResetDebug}
                disabled={interactionDisabled}
              >
                Reset Debug
              </button>
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={() => setDebugRhythmEnabled((value) => !value)}
                disabled={interactionDisabled}
              >
                Rhythm {debugRhythmEnabled ? "On" : "Off"}
              </button>
            </div>
            <div style={{ marginTop: "0.45rem" }}>
              <p className="AppHistoryLabel" style={{ margin: 0 }}>
                Recording: {isDebugRecording ? "yes" : "no"}
              </p>
              <p className="AppHistoryLabel" style={{ margin: 0 }}>
                Cleaned Frames: {debugFrameCount}
              </p>
              <p className="AppHistoryLabel" style={{ margin: 0 }}>
                Raw Voiced Frames: {debugVoicedCount}
              </p>
              <p className="AppHistoryLabel" style={{ margin: 0 }}>
                Stable Notes: {debugStableNoteCount}
              </p>
              <p className="AppHistoryLabel" style={{ margin: 0 }}>
                Expected Degrees: [{debugExpectedDegrees.join(", ")}]
              </p>
              <p className="AppHistoryLabel" style={{ margin: 0 }}>
                Actual Degrees: [{debugActualDegrees.join(", ")}]
              </p>
              <p className="AppHistoryLabel" style={{ margin: 0 }}>
                Rhythm Analysis: {debugRhythmEnabled ? "enabled" : "disabled"}
              </p>
              <p className="AppHistoryLabel" style={{ margin: 0 }}>
                Error: {debugRecorderError ?? "none"}
              </p>
            </div>
          </div>
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

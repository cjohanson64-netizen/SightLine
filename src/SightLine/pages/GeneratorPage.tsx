//GeneratorPage.tsx

import type React from "react";
import type { MicAssessmentRunResult } from "@/SightLine/core/audio/types";
import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";
import AssessmentPanel from "../components/AssessmentPanel";
import GeneratorNotationControls from "../components/GeneratorNotationControls";
import GeneratorStudentSidebar from "../components/GeneratorStudentSidebar";
import GeneratorTeacherSidebar from "../components/GeneratorTeacherSidebar";
import GeneratorToolbar from "../components/GeneratorToolbar";
import NotationViewer from "../components/NotationViewer/NotationViewer";
import ErrorBanner from "../components/ErrorBanner/ErrorBanner";
import { usePlayback } from "../hooks/usePlayback";
import { useProjection } from "../hooks/useProjection";
import { useSolfege } from "../hooks/useSolfege";
import { useStudentSession } from "../hooks/useStudentSession";
import { useTeacherLibrary } from "../hooks/useTeacherLibrary";
import { normalizeUserConstraintsInSpec } from "../core/spec";

type PlaybackState = ReturnType<typeof usePlayback>;
type ProjectionState = ReturnType<typeof useProjection>;
type SolfegeState = ReturnType<typeof useSolfege>;
type StudentState = ReturnType<typeof useStudentSession>;
type TeacherState = ReturnType<typeof useTeacherLibrary>;

interface GeneratorPageProps {
  currentMelody: MelodyEvent[];
  calibrationStatus: "idle" | "requesting_permission" | "recording" | "processing" | "complete" | "error";
  calibrationReady: boolean;
  assessmentError: string | null;
  assessmentAccessMessage: string | null;
  assessmentAccessBlocked: boolean;
  assessmentPlaybackDisabled: boolean;
  assessmentNoteOutcomeByIndex: Array<"correct" | "near" | "incorrect" | "ambiguous" | null>;
  assessmentResult: MicAssessmentRunResult | null;
  selectedAssessmentNoteIndex: number | null;
  assessmentStatus: "idle" | "requesting_permission" | "recording" | "processing" | "complete" | "error";
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
  onAssessmentNoteSelect: (index: number | null) => void;
  onAssessmentUpgrade: () => void;
  onRunAssessment: () => void;
  onClearAssessment: () => void;
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
  calibrationStatus,
  calibrationReady,
  assessmentError,
  assessmentAccessMessage,
  assessmentAccessBlocked,
  assessmentPlaybackDisabled,
  assessmentNoteOutcomeByIndex,
  assessmentResult,
  selectedAssessmentNoteIndex,
  assessmentStatus,
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
  onAssessmentNoteSelect,
  onAssessmentUpgrade,
  onRunAssessment,
  onClearAssessment,
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
              onRunAssessment={onRunAssessment}
              calibrationStatus={calibrationStatus}
              calibrationReady={calibrationReady}
              assessmentAccessMessage={assessmentAccessMessage}
              assessmentAccessBlocked={assessmentAccessBlocked}
              onAssessmentUpgrade={onAssessmentUpgrade}
              onFix={rerunWithCurrentSeed}
              assessmentStatus={assessmentStatus}
              assessmentDisabled={
                interactionDisabled ||
                currentMelody.length === 0 ||
                calibrationStatus === "requesting_permission" ||
                calibrationStatus === "processing" ||
                assessmentStatus === "requesting_permission" ||
                assessmentStatus === "processing" ||
                (assessmentAccessBlocked &&
                  calibrationStatus !== "recording" &&
                  assessmentStatus !== "recording")
              }
              fixDisabled={isGuestMode}
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
            <p className="AppHistoryLabel" style={{ margin: "0.2rem 0 0.5rem" }}>
              {teacher.foldersError}
            </p>
          ) : null}
          {mode === "teacher" && teacher.classroomDefaultsMessage ? (
            <p className="AppHistoryLabel" style={{ margin: "0.2rem 0 0.5rem" }}>
              {teacher.classroomDefaultsStatus === "loading"
                ? "Updating class defaults..."
                : teacher.classroomDefaultsMessage}
            </p>
          ) : null}
          {saveStatus !== "idle" ? (
            <p className="AppHistoryLabel" style={{ margin: "0.2rem 0 0.5rem" }}>
              {saveStatus === "saving" ? "Saving..." : saveMessage}
            </p>
          ) : null}
          <AssessmentPanel
            status={assessmentStatus}
            result={assessmentResult}
            errorMessage={assessmentError}
            selectedNoteIndex={selectedAssessmentNoteIndex}
            showDeveloperDebug={teacher.subscriptionIsAdmin}
            onSelectNote={onAssessmentNoteSelect}
            onClear={onClearAssessment}
          />
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
              projection.isProjectionMode ? projection.handleMouseMove : undefined
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
              selectableNoteCount={assessmentResult?.segmentedNotes.length ?? 0}
              selectedNoteIndex={selectedAssessmentNoteIndex}
              noteOutcomeByIndex={assessmentNoteOutcomeByIndex}
              onNoteSelect={(index) => onAssessmentNoteSelect(index)}
              zoom={projection.isProjectionMode ? 2.5 : 1}
              projectionMode={projection.isProjectionMode}
              solfegeActive={solfege.solfegeMode !== "off"}
              solfegeColorizeLyrics={solfege.solfegeColorizeMode !== "off"}
              solfegeOverlayNoteheads={
                solfege.solfegeMode !== "off" && solfege.solfegeOverlayMode
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
                      assessmentPlaybackDisabled={assessmentPlaybackDisabled}
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
                  disabled={currentMelody.length === 0 || assessmentPlaybackDisabled}
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

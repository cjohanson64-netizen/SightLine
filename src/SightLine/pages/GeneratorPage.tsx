//GeneratorPage.tsx

import type React from "react";
import type { ReactNode } from "react";
import type { MicAssessmentRunResult } from "@/SightLine/core/audio/types";
import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";
import AssessmentPanel from "../components/AssessmentPanel";
import GeneratorToolbar from "../components/GeneratorToolbar";
import NotationViewer from "../components/NotationViewer/NotationViewer";
import StudentJoinForm from "../components/StudentJoinForm/StudentJoinForm";
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
  calibrationMessage: ReactNode;
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
  onOpenInstructions: () => void;
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
  calibrationMessage,
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
  onOpenInstructions,
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
              calibrationMessage={calibrationMessage}
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
              onToggleProjection={() => void projection.toggle()}
              onOpenHelp={onOpenInstructions}
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
                    <div className="AppPlaybackControls">
                      {(() => {
                        const overlayValue =
                          solfege.solfegeMode === "off"
                            ? "off"
                            : solfege.solfegeColorizeMode;

                        return (
                          <>
                      <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField AppPlaybackControlsField">
                        Tempo
                        <input
                          type="number"
                          min={30}
                          max={240}
                          step={1}
                          value={playback.tempoBpm}
                          onChange={(event) =>
                            playback.setTempoBpm(
                              Math.max(30, Math.min(240, Number(event.target.value) || 80)),
                            )
                          }
                          disabled={interactionDisabled || assessmentPlaybackDisabled}
                        />
                      </label>
                      <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField AppPlaybackControlsField">
                        Instrument
                        <select
                          value={playback.instrument}
                          onChange={(event) =>
                            playback.setInstrument(event.target.value as OscillatorType)
                          }
                          disabled={interactionDisabled || assessmentPlaybackDisabled}
                        >
                          <option value="sine">SINE</option>
                          <option value="triangle">TRIANGLE</option>
                          <option value="square">SQUARE</option>
                          <option value="sawtooth">SAWTOOTH</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        className="AppHistoryButton AppProjectionToggleButton"
                        onClick={() => playback.play()}
                        disabled={currentMelody.length === 0 || assessmentPlaybackDisabled}
                        data-allow-while-playing="true"
                      >
                        {playback.isPlaying ? "Stop" : "Play"}
                      </button>
                      <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField AppCountInField AppPlaybackControlsField">
                        Count-in
                        <input
                          type="checkbox"
                          className="AppLibraryCheckbox AppCountInCheckbox"
                          checked={playback.countInEnabled}
                          onChange={(event) => playback.setCountInEnabled(event.target.checked)}
                          disabled={interactionDisabled || assessmentPlaybackDisabled}
                        />
                      </label>
                      <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField AppCountInField AppPlaybackControlsField">
                        Show Solfege
                        <input
                          type="checkbox"
                          className="AppLibraryCheckbox AppCountInCheckbox"
                          checked={solfege.solfegeMode !== "off"}
                          onChange={(event) =>
                            solfege.setSolfegeMode(event.target.checked ? "movable" : "off")
                          }
                          disabled={interactionDisabled}
                        />
                      </label>
                      <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField AppPlaybackControlsField">
                        Colorize
                        <select
                          value={overlayValue}
                          onChange={(event) => {
                            const next = event.target.value;
                            if (solfege.solfegeMode === "off") {
                              solfege.setSolfegeMode("movable");
                            }
                            solfege.setSolfegeColorizeMode(
                              next as "off" | "lyrics" | "full"
                            );
                          }}
                          disabled={interactionDisabled}
                        >
                          <option value="off">Off</option>
                          <option value="lyrics">Lyrics only</option>
                          <option value="full">Full</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        className="AppHistoryButton AppProjectionToggleButton"
                        onClick={() => {
                          setPitchEditMode((prev) => !prev);
                          setEditMessage("");
                        }}
                        disabled={interactionDisabled}
                      >
                        {pitchEditMode ? "Disable Pitch Edit" : "Enable Pitch Edit"}
                      </button>
                      <button
                        type="button"
                        className="AppHistoryButton AppProjectionToggleButton"
                        onClick={() => {
                          if (!isGuestMode && !teacherFeaturesDisabled) {
                            onExport();
                          }
                        }}
                        disabled={
                          interactionDisabled ||
                          isGuestMode || teacherFeaturesDisabled || !exportMusicXml
                        }
                        title={
                          teacherFeaturesDisabled ? "Upgrade required" : undefined
                        }
                      >
                        Export MusicXML
                        {teacherFeaturesDisabled ? (
                          <span
                            className="UpgradeFeatureMarker"
                            aria-label="Upgrade To Enable Feature"
                            title="Upgrade To Enable Feature"
                          />
                        ) : null}
                      </button>
                      {assessmentPlaybackDisabled ? (
                        <span className="AppHistoryLabel AppPlaybackDisabledNotice">
                          Playback is disabled while SightLine is listening.
                        </span>
                      ) : null}
                          </>
                        );
                      })()}
                    </div>
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
            <fieldset className="AppInteractionFieldset" disabled={interactionDisabled}>
            {mode !== "teacher" ? (
              <>
                <h3>Student Mode</h3>
                <div className="AppPanelButtons">
                  <StudentJoinForm
                    studentSession={student.studentSession}
                    studentJoinCode={student.studentJoinCode}
                    onJoinCodeChange={student.setStudentJoinCode}
                    studentPasscode={student.studentPasscode}
                    onPasscodeChange={student.setStudentPasscode}
                    studentId={student.studentId}
                    onStudentIdChange={student.setStudentId}
                    studentPin={student.studentPin}
                    onPinChange={student.setStudentPin}
                    studentDisplayName={student.studentDisplayName}
                    onDisplayNameChange={student.setStudentDisplayName}
                    studentJoinStatus={student.studentJoinStatus}
                    studentJoinMessage={student.studentJoinMessage}
                    studentProgress={student.studentProgress}
                    studentProgressStatus={student.studentProgressStatus}
                    studentProgressError={student.studentProgressError}
                    classroomDefaultsStatus={student.classroomDefaultsStatus}
                    classroomDefaultsMessage={student.classroomDefaultsMessage}
                    studentSpecBeforeDefaults={student.studentSpecBeforeDefaults}
                    onJoin={() => void handleJoinClassroom()}
                    onLeave={handleLeaveClassroom}
                    onUseTeacherSettings={() => {
                      const next = student.applyTeacherSettings(
                        spec,
                        normalizeUserConstraintsInSpec(spec),
                      );
                      if (next) setSpec(normalizeUserConstraintsInSpec(next));
                    }}
                    onResetToMySettings={() => {
                      const prev = student.resetToMySettings();
                      if (prev) setSpec(normalizeUserConstraintsInSpec(prev));
                    }}
                  />
                </div>
                <div className="AppPanelSpacer" aria-hidden="true" />
                <h3>Classroom Library</h3>
                <div className="AppPanelButtons AppPanelScrollableSection">
                  {!student.studentSession ? (
                    <p className="AppHistoryLabel">
                      Join a classroom to view assigned exercises.
                    </p>
                  ) : student.classroomExercisesStatus === "loading" ? (
                    <p className="AppHistoryLabel">
                      Loading classroom exercises...
                    </p>
                  ) : student.classroomExercisesStatus === "error" ? (
                    <p className="AppHistoryLabel">
                      {student.classroomExercisesError}
                    </p>
                  ) : student.classroomExercises.length === 0 ? (
                    <p className="AppHistoryLabel">No classroom exercises yet.</p>
                  ) : (
                    student.classroomExercises.map((exercise) => (
                      <div key={exercise.id}>
                        <p className="AppHistoryLabel">{exercise.title}</p>
                        <p className="AppHistoryLabel">
                          Seed: {exercise.seed} | Created:{" "}
                          {formatSavedDate(exercise.created_at)}
                        </p>
                        <button
                          type="button"
                          className="AppHistoryButton AppProjectionToggleButton"
                          onClick={() => void handleLoadClassroomExercise(exercise.id)}
                          disabled={student.loadingClassroomExerciseId !== null}
                        >
                          {student.loadingClassroomExerciseId === exercise.id
                            ? "Loading..."
                            : "Load"}
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="AppPanelSpacer" aria-hidden="true" />
              </>
            ) : null}

            {mode === "teacher" ? (
              <>
                <h3>Saved Exercises</h3>
                <div className="AppPanelButtons AppPanelScrollableSection">
                  {teacher.savedExercisesStatus === "loading" ? (
                    <p className="AppHistoryLabel">Loading saved exercises...</p>
                  ) : teacher.savedExercises.length === 0 ? (
                    <p className="AppHistoryLabel">No saved exercises yet.</p>
                  ) : (
                    <>
                      <label className="AppHistoryLabel AppPlaybackField">
                        Filter
                        <select
                          value={teacher.folderFilterId}
                          onChange={(e) => teacher.setFolderFilterId(e.target.value)}
                        >
                          <option value="__ALL__">All classes</option>
                          {teacher.folders.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {teacher.filteredSavedExercises.length === 0 ? (
                        <p className="AppHistoryLabel">
                          No saved exercises in this class.
                        </p>
                      ) : (
                        teacher.filteredSavedExercises.map((exercise) => (
                          <div key={exercise.id}>
                            <p className="AppHistoryLabel">{exercise.title}</p>
                            <p className="AppHistoryLabel">
                              Seed: {exercise.seed} | Class:{" "}
                              {exercise.folder_id
                                ? (teacher.folderNameById.get(exercise.folder_id) ??
                                  "Unknown class")
                                : "No class"}{" "}
                              | Created: {formatSavedDate(exercise.created_at)}
                            </p>
                            <div style={{ display: "flex", gap: "0.45rem" }}>
                              <button
                                type="button"
                                className="AppHistoryButton AppPanelButtonWide AppSymbolButton"
                                onClick={() => void handleLoadSavedExercise(exercise.id)}
                                title={
                                  teacherFeaturesDisabled
                                    ? "Upgrade To Enable Feature"
                                    : undefined
                                }
                                disabled={
                                  teacherFeaturesDisabled ||
                                  teacher.loadingSavedExerciseId !== null ||
                                  teacher.deletingSavedExerciseId !== null
                                }
                              >
                                {teacher.loadingSavedExerciseId === exercise.id ? (
                                  "Loading..."
                                ) : teacherFeaturesDisabled ? (
                                  <>
                                    ↥
                                    <span
                                      className="UpgradeFeatureMarker"
                                      aria-label="Upgrade To Enable Feature"
                                      title="Upgrade To Enable Feature"
                                    />
                                  </>
                                ) : (
                                  "↥"
                                )}
                              </button>
                              <button
                                type="button"
                                className="AppHistoryButton AppPanelButtonWide AppSymbolButton"
                                onClick={() =>
                                  void teacher.deleteSavedExercise(exercise.id)
                                }
                                title={
                                  teacherFeaturesDisabled
                                    ? "Upgrade To Enable Feature"
                                    : undefined
                                }
                                disabled={
                                  teacherFeaturesDisabled ||
                                  teacher.loadingSavedExerciseId !== null ||
                                  teacher.deletingSavedExerciseId !== null
                                }
                              >
                                {teacher.deletingSavedExerciseId === exercise.id ? (
                                  "Deleting..."
                                ) : teacherFeaturesDisabled ? (
                                  <>
                                    ✕
                                    <span
                                      className="UpgradeFeatureMarker"
                                      aria-label="Upgrade To Enable Feature"
                                      title="Upgrade To Enable Feature"
                                    />
                                  </>
                                ) : (
                                  "✕"
                                )}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </>
                  )}
                  {teacher.savedExercisesNotice ? (
                    <p className="AppHistoryLabel" style={{ opacity: 0.9 }}>
                      {teacher.savedExercisesNotice}
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}
            </fieldset>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

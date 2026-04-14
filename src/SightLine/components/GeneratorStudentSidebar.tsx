import StudentJoinForm from "./StudentJoinForm/StudentJoinForm";
import { useStudentSession } from "../hooks/useStudentSession";
import type { ExerciseSpec } from "@/SightLine/domain/music";

type StudentState = ReturnType<typeof useStudentSession>;

interface GeneratorStudentSidebarProps {
  formatSavedDate: (value: string | null | undefined) => string;
  handleJoinClassroom: () => Promise<void>;
  handleLeaveClassroom: () => void;
  handleLoadClassroomExercise: (exerciseId: string) => Promise<void>;
  interactionDisabled: boolean;
  setSpec: React.Dispatch<React.SetStateAction<ExerciseSpec>>;
  spec: ExerciseSpec;
  student: StudentState;
  normalizeSpec: (spec: ExerciseSpec) => ExerciseSpec;
}

export default function GeneratorStudentSidebar({
  formatSavedDate,
  handleJoinClassroom,
  handleLeaveClassroom,
  handleLoadClassroomExercise,
  interactionDisabled,
  normalizeSpec,
  setSpec,
  spec,
  student,
}: GeneratorStudentSidebarProps): JSX.Element {
  return (
    <fieldset className="AppInteractionFieldset" disabled={interactionDisabled}>
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
            const next = student.applyTeacherSettings(spec, normalizeSpec(spec));
            if (next) {
              setSpec(normalizeSpec(next));
            }
          }}
          onResetToMySettings={() => {
            const prev = student.resetToMySettings();
            if (prev) {
              setSpec(normalizeSpec(prev));
            }
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
          <p className="AppHistoryLabel">Loading classroom exercises...</p>
        ) : student.classroomExercisesStatus === "error" ? (
          <p className="AppHistoryLabel">{student.classroomExercisesError}</p>
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
    </fieldset>
  );
}

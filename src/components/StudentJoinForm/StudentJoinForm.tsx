import type { StudentSession, StudentProgressSummary } from "../../hooks/useStudentSession";

interface StudentJoinFormProps {
  studentSession: StudentSession | null;
  studentJoinCode: string;
  studentPasscode: string;
  studentId: string;
  studentPin: string;
  studentDisplayName: string;
  studentJoinStatus: "idle" | "joining" | "success" | "error";
  studentJoinMessage: string;
  studentProgress: StudentProgressSummary;
  studentProgressStatus: "idle" | "loading" | "loaded" | "error";
  studentProgressError: string;
  classroomDefaultsStatus: "idle" | "loading" | "loaded" | "error";
  classroomDefaultsMessage: string;
  studentSpecBeforeDefaults: unknown | null;
  onJoinCodeChange: (value: string) => void;
  onPasscodeChange: (value: string) => void;
  onStudentIdChange: (value: string) => void;
  onPinChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onJoin: () => void;
  onLeave: () => void;
  onUseTeacherSettings: () => void;
  onResetToMySettings: () => void;
}

export default function StudentJoinForm({
  studentSession,
  studentJoinCode,
  studentPasscode,
  studentId,
  studentPin,
  studentDisplayName,
  studentJoinStatus,
  studentJoinMessage,
  studentProgress,
  studentProgressStatus,
  studentProgressError,
  classroomDefaultsStatus,
  classroomDefaultsMessage,
  studentSpecBeforeDefaults,
  onJoinCodeChange,
  onPasscodeChange,
  onStudentIdChange,
  onPinChange,
  onDisplayNameChange,
  onJoin,
  onLeave,
  onUseTeacherSettings,
  onResetToMySettings,
}: StudentJoinFormProps): JSX.Element {
  if (studentSession) {
    return (
      <>
        <p className="AppHistoryLabel">Joined: {studentSession.classroom.name}</p>
        <p className="AppHistoryLabel">Code: {studentSession.classroom.join_code}</p>
        {studentSession.classroom.student_id ? (
          <p className="AppHistoryLabel">Student ID: {studentSession.classroom.student_id}</p>
        ) : null}
        {studentProgressStatus === "loading" ? (
          <p className="AppHistoryLabel">Loading progress...</p>
        ) : (
          <p className="AppHistoryLabel">
            This week: {studentProgress.total_minutes} minutes,{" "}
            {studentProgress.total_attempts} attempts
          </p>
        )}
        {studentProgressError ? (
          <p className="AppHistoryLabel">{studentProgressError}</p>
        ) : null}
        <button
          type="button"
          className="AppHistoryButton AppProjectionToggleButton"
          onClick={onLeave}
        >
          Leave classroom
        </button>
        <button
          type="button"
          className="AppHistoryButton AppProjectionToggleButton"
          onClick={onUseTeacherSettings}
          disabled={classroomDefaultsStatus === "loading"}
        >
          Use Teacher Settings
        </button>
        <button
          type="button"
          className="AppHistoryButton AppProjectionToggleButton"
          onClick={onResetToMySettings}
          disabled={!studentSpecBeforeDefaults}
        >
          Reset to My Settings
        </button>
        {classroomDefaultsMessage ? (
          <p className="AppHistoryLabel">{classroomDefaultsMessage}</p>
        ) : null}
      </>
    );
  }

  return (
    <div className="AppStudentForm">
      <label className="AppHistoryLabel">
        Classroom Code
        <input
          type="text"
          value={studentJoinCode}
          onChange={event => onJoinCodeChange(event.target.value.toUpperCase().replace(/\s+/g, ""))}
          placeholder="ABC123"
        />
      </label>
      <label className="AppHistoryLabel">
        Passcode
        <input
          type="password"
          value={studentPasscode}
          onChange={event => onPasscodeChange(event.target.value)}
          placeholder="Passcode"
        />
      </label>
      <label className="AppHistoryLabel">
        Student ID
        <input
          type="text"
          value={studentId}
          onChange={event => onStudentIdChange(event.target.value.toUpperCase().replace(/\s+/g, ""))}
          placeholder="Student ID"
        />
      </label>
      <label className="AppHistoryLabel">
        PIN (if assigned)
        <input
          type="password"
          value={studentPin}
          onChange={event => onPinChange(event.target.value)}
          placeholder="PIN (optional)"
        />
      </label>
      <label className="AppHistoryLabel">
        Display Name (optional)
        <input
          type="text"
          value={studentDisplayName}
          onChange={event => onDisplayNameChange(event.target.value)}
          placeholder="Student name"
        />
      </label>
      <button
        type="button"
        className="AppHistoryButton AppProjectionToggleButton"
        onClick={onJoin}
        disabled={studentJoinStatus === "joining"}
      >
        {studentJoinStatus === "joining" ? "Joining..." : "Join"}
      </button>
      {studentJoinMessage ? (
        <p className="AppHistoryLabel">{studentJoinMessage}</p>
      ) : null}
    </div>
  );
}
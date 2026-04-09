import { useTeacherLibrary } from "../../hooks/useTeacherLibrary";

type TeacherLibraryState = ReturnType<typeof useTeacherLibrary>;

interface ClassroomAccessModalProps {
  isOpen: boolean;
  mode: "teacher" | "student" | "guest";
  onClose: () => void;
  teacher: TeacherLibraryState;
}

export default function ClassroomAccessModal({
  isOpen,
  mode,
  onClose,
  teacher,
}: ClassroomAccessModalProps): JSX.Element | null {
  if (!isOpen || mode !== "teacher" || !teacher.selectedFolder) {
    return null;
  }

  return (
    <div className="AppModalBackdrop" onClick={onClose} role="presentation">
      <div
        className="AppModal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="AppModalClose"
          onClick={onClose}
          disabled={teacher.classroomAccessStatus === "saving"}
        >
          ×
        </button>
        <h3>Classroom Access: {teacher.selectedFolder.name}</h3>
        <div className="AppBatchForm">
          <p className="AppHistoryLabel">
            Current class code: {teacher.selectedFolder.join_code ?? "Not enabled"}
          </p>
          <label className="AppHistoryLabel AppBatchCheckbox">
            <input
              type="checkbox"
              checked={teacher.classroomPublish}
              onChange={(e) => teacher.setClassroomPublish(e.target.checked)}
              disabled={teacher.classroomAccessStatus === "saving"}
            />
            Publish to students
          </label>
          <label className="AppHistoryLabel">
            Class code
            <input
              type="text"
              value={teacher.classroomJoinCode}
              onChange={(e) =>
                teacher.setClassroomJoinCode(
                  e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                )
              }
              placeholder="Optional custom code (4-10 chars)"
              maxLength={10}
              disabled={teacher.classroomAccessStatus === "saving"}
            />
          </label>
          <label className="AppHistoryLabel">
            Passcode
            <input
              type="password"
              value={teacher.classroomPasscode}
              onChange={(e) => teacher.setClassroomPasscode(e.target.value)}
              placeholder="Set/Reset passcode"
              disabled={teacher.classroomAccessStatus === "saving"}
            />
          </label>
          <div className="AppBatchActions">
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton"
              onClick={() => void teacher.setClassroomAccess(false)}
              disabled={
                teacher.classroomAccessStatus === "saving" ||
                !teacher.classroomPasscode.trim()
              }
            >
              {teacher.classroomAccessStatus === "saving"
                ? "Updating..."
                : "Enable / Update Classroom"}
            </button>
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton"
              onClick={() => void teacher.setClassroomAccess(true)}
              disabled={
                teacher.classroomAccessStatus === "saving" ||
                !teacher.classroomPasscode.trim()
              }
            >
              Rotate Code
            </button>
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton"
              onClick={async () => {
                void (await teacher.copyClassroomAccess(
                  teacher.selectedFolder?.join_code ?? "",
                  teacher.classroomPasscode || teacher.classroomLastPasscode,
                ));
              }}
              disabled={!teacher.selectedFolder?.join_code}
            >
              Copy
            </button>
          </div>
          {teacher.classroomAccessMessage ? (
            <p className="AppHistoryLabel">{teacher.classroomAccessMessage}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

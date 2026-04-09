import { useTeacherLibrary } from "../../hooks/useTeacherLibrary";

type TeacherLibraryState = ReturnType<typeof useTeacherLibrary>;

interface AddStudentsModalProps {
  isOpen: boolean;
  mode: "teacher" | "student" | "guest";
  onClose: () => void;
  teacher: TeacherLibraryState;
}

export default function AddStudentsModal({
  isOpen,
  mode,
  onClose,
  teacher,
}: AddStudentsModalProps): JSX.Element | null {
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
          disabled={teacher.rosterBusyId !== null}
        >
          ×
        </button>
        <h3>Add Student(s): {teacher.selectedFolder.name}</h3>
        <div className="AppBatchForm">
          <label className="AppHistoryLabel">
            Add Student ID
            <input
              type="text"
              value={teacher.newRosterStudentId}
              onChange={(e) =>
                teacher.setNewRosterStudentId(
                  e.target.value.toUpperCase().replace(/\s+/g, ""),
                )
              }
              placeholder="Student ID"
              disabled={teacher.rosterBusyId !== null}
            />
          </label>
          <div className="AppBatchActions">
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton"
              onClick={() => void teacher.addRosterStudent()}
              disabled={
                teacher.rosterBusyId !== null ||
                !teacher.newRosterStudentId.trim()
              }
            >
              {teacher.rosterBusyId === "__add__" ? "Adding..." : "Add"}
            </button>
          </div>
          <label className="AppHistoryLabel">
            Bulk Add (one ID per line)
            <textarea
              value={teacher.bulkRosterStudentIds}
              onChange={(e) => teacher.setBulkRosterStudentIds(e.target.value)}
              placeholder={"S001\nS002\nS003"}
              rows={6}
              disabled={teacher.rosterBusyId !== null}
            />
          </label>
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={() => void teacher.bulkAddRosterStudents()}
            disabled={
              teacher.rosterBusyId !== null ||
              !teacher.bulkRosterStudentIds.trim()
            }
          >
            {teacher.rosterBusyId === "__bulk__" ? "Adding..." : "Add many"}
          </button>
          {teacher.classroomRosterError ? (
            <p className="AppHistoryLabel">{teacher.classroomRosterError}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

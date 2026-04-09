import { useTeacherLibrary } from "../../hooks/useTeacherLibrary";

type TeacherState = ReturnType<typeof useTeacherLibrary>;

interface CreatePacketFromSelectedModalProps {
  isOpen: boolean;
  mode: "teacher" | "student" | "guest";
  onClose: () => void;
  onExportSavedPacketZip: () => Promise<void>;
  onOpenSavedPacket: () => Promise<void>;
  teacher: TeacherState;
}

export default function CreatePacketFromSelectedModal({
  isOpen,
  mode,
  onClose,
  onExportSavedPacketZip,
  onOpenSavedPacket,
  teacher,
}: CreatePacketFromSelectedModalProps): JSX.Element | null {
  if (!isOpen || mode !== "teacher") {
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
          disabled={teacher.createPacketStatus === "saving"}
        >
          ×
        </button>
        <h3>Create Packet from Selected</h3>
        <div className="AppBatchForm">
          <label className="AppHistoryLabel">
            Packet Title
            <input
              type="text"
              value={teacher.createPacketTitle}
              onChange={(e) => teacher.setCreatePacketTitle(e.target.value)}
              disabled={teacher.createPacketStatus === "saving"}
            />
          </label>
          <label className="AppHistoryLabel">
            Notes / Instructions (optional)
            <textarea
              value={teacher.createPacketNotes}
              onChange={(e) => teacher.setCreatePacketNotes(e.target.value)}
              rows={3}
              disabled={teacher.createPacketStatus === "saving"}
            />
          </label>
          <div className="AppPanelScrollableSection" style={{ maxHeight: "180px" }}>
            {teacher.classLibraryExercises
              .filter((e) => teacher.selectedLibraryExerciseIds.has(e.id))
              .map((e, i) => (
                <p key={e.id} className="AppHistoryLabel">
                  {i + 1}. {e.title} (Seed {e.seed})
                </p>
              ))}
          </div>
          {teacher.createPacketMessage ? (
            <p className="AppHistoryLabel">{teacher.createPacketMessage}</p>
          ) : null}
          <div className="AppBatchActions">
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton"
              onClick={() => void teacher.createPacketFromSelected()}
              disabled={teacher.createPacketStatus === "saving"}
            >
              {teacher.createPacketStatus === "saving"
                ? "Creating..."
                : "Create Packet"}
            </button>
            {teacher.lastCreatedPacket ? (
              <>
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionToggleButton"
                  onClick={() => void onOpenSavedPacket()}
                  disabled={teacher.loadingPacketId !== null}
                >
                  Open Packet
                </button>
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionToggleButton"
                  onClick={() => void onExportSavedPacketZip()}
                  disabled={teacher.exportingPacketId !== null}
                >
                  Export MusicXML ZIP
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton"
              onClick={onClose}
              disabled={teacher.createPacketStatus === "saving"}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

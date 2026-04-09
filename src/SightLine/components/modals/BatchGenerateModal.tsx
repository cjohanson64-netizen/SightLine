import { useTeacherLibrary } from "../../hooks/useTeacherLibrary";

type TeacherLibraryState = ReturnType<typeof useTeacherLibrary>;

interface BatchGenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: () => Promise<void>;
  teacher: TeacherLibraryState;
}

export default function BatchGenerateModal({
  isOpen,
  onClose,
  onGenerate,
  teacher,
}: BatchGenerateModalProps): JSX.Element | null {
  if (!isOpen) {
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
          disabled={teacher.batchStatus === "running"}
        >
          ×
        </button>
        <h3>Batch Generate</h3>
        <div className="AppBatchForm">
          <label className="AppHistoryLabel">
            Count
            <input
              type="number"
              min={1}
              max={100}
              value={teacher.batchCount}
              onChange={(e) =>
                teacher.setBatchCount(
                  Math.max(1, Math.min(100, Number(e.target.value) || 10)),
                )
              }
              disabled={teacher.batchStatus === "running"}
            />
          </label>
          <label className="AppHistoryLabel">
            Title Prefix
            <input
              type="text"
              value={teacher.batchTitlePrefix}
              onChange={(e) => teacher.setBatchTitlePrefix(e.target.value)}
              placeholder="Period 1 - Exercise"
              disabled={teacher.batchStatus === "running"}
            />
          </label>
          <label className="AppHistoryLabel">
            Packet Title
            <input
              type="text"
              value={teacher.batchPacketTitle}
              onChange={(e) => teacher.setBatchPacketTitle(e.target.value)}
              placeholder="Period 1 Packet"
              disabled={teacher.batchStatus === "running"}
            />
          </label>
          <label className="AppHistoryLabel">
            Notes / Instructions (optional)
            <textarea
              value={teacher.batchPacketNotes}
              onChange={(e) => teacher.setBatchPacketNotes(e.target.value)}
              rows={3}
              placeholder="Warm-up, dynamics focus, or rubric notes."
              disabled={teacher.batchStatus === "running"}
            />
          </label>
          <label className="AppHistoryLabel">
            Class
            <select
              value={teacher.batchFolderId}
              onChange={(e) => teacher.setBatchFolderId(e.target.value)}
              disabled={teacher.batchStatus === "running"}
            >
              {teacher.folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <p className="AppHistoryLabel">
            Generated exercises and packet metadata will be saved to Supabase.
          </p>
          {teacher.batchStatus === "running" ? (
            <p className="AppHistoryLabel">
              Generating {teacher.batchProgress.current}/{teacher.batchProgress.total}
              ...
            </p>
          ) : null}
          {teacher.batchMessage ? (
            <p className="AppHistoryLabel">{teacher.batchMessage}</p>
          ) : null}
          <div className="AppBatchActions">
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton"
              onClick={() => void onGenerate()}
              disabled={teacher.batchStatus === "running"}
            >
              Generate Packet
            </button>
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton"
              onClick={onClose}
              disabled={teacher.batchStatus === "running"}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

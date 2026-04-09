import { Link } from "react-router-dom";
import { useTeacherLibrary } from "../hooks/useTeacherLibrary";
import type {
  PacketItem,
  StudentSubmissionItem,
} from "../hooks/useTeacherLibrary";

type TeacherLibraryState = ReturnType<typeof useTeacherLibrary>;

interface ClassAccessPageProps {
  formatSavedDate: (value: string | null | undefined) => string;
  mode: "teacher" | "student" | "guest";
  onExportSavedPacketZip: (packet: PacketItem) => Promise<void>;
  onOpenAddStudents: () => void;
  onOpenBatchGenerate: () => void;
  onOpenClassroomAccess: () => void;
  onOpenSavedPacket: (packet: PacketItem) => Promise<void>;
  onPreviewSubmission: (submission: StudentSubmissionItem) => void;
  teacher: TeacherLibraryState;
  teacherFeaturesDisabled: boolean;
}

export default function ClassAccessPage({
  formatSavedDate,
  mode,
  onExportSavedPacketZip,
  onOpenAddStudents,
  onOpenBatchGenerate,
  onOpenClassroomAccess,
  onOpenSavedPacket,
  onPreviewSubmission,
  teacher,
  teacherFeaturesDisabled,
}: ClassAccessPageProps): JSX.Element {
  return (
    <section className="AppRoutePage">
      <h2>Class Access</h2>
      {mode === "teacher" && !teacherFeaturesDisabled ? (
        <>
          <div className="AppClassControls">
            <label className="AppHistoryLabel AppPlaybackField AppToolbarField">
              Class
              <select
                value={teacher.selectedFolderId}
                onChange={(e) => teacher.setSelectedFolderId(e.target.value)}
                disabled={teacher.creatingFolder}
              >
                {teacher.folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton AppClassAddStudentsButton"
              onClick={onOpenAddStudents}
              disabled={!teacher.selectedFolderId}
            >
              Add Student(s)
            </button>
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton AppClassEditButton"
              onClick={onOpenClassroomAccess}
              disabled={!teacher.selectedFolderId}
            >
              Edit Class
            </button>
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton"
              onClick={() => {
                if (teacher.lastCreatedPacket) {
                  void onOpenSavedPacket(teacher.lastCreatedPacket);
                }
              }}
              disabled={!teacher.lastCreatedPacket}
            >
              Export Packet PDF
            </button>
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton"
              onClick={() => {
                if (teacher.lastCreatedPacket) {
                  void onExportSavedPacketZip(teacher.lastCreatedPacket);
                }
              }}
              disabled={!teacher.lastCreatedPacket}
            >
              Export MusicXML ZIP
            </button>
            <div className="AppToolbarNewFolder">
              <input
                className="AppExerciseTitleInput"
                type="text"
                value={teacher.newFolderName}
                onChange={(e) => teacher.setNewFolderName(e.target.value)}
                placeholder="New class name"
                disabled={teacher.creatingFolder}
              />
              <button
                type="button"
                className="AppHistoryButton AppSymbolButton"
                onClick={() => void teacher.createFolder()}
                disabled={teacher.creatingFolder || !teacher.newFolderName.trim()}
              >
                {teacher.creatingFolder ? "..." : "+"}
              </button>
            </div>
          </div>

          <div className="AppDashboardGrid">
            <div className="AppDashboardCard AppRosterCard">
              <h3>Roster</h3>
              {teacher.classroomRosterStatus === "loading" ? (
                <p className="AppHistoryLabel">Loading roster...</p>
              ) : teacher.classroomRosterStatus === "error" ? (
                <p className="AppHistoryLabel">{teacher.classroomRosterError}</p>
              ) : teacher.sortedClassroomRoster.length === 0 ? (
                <p className="AppHistoryLabel">
                  No student IDs in this class yet.
                </p>
              ) : (
                <div className="AppRosterTableWrap">
                  <table className="AppRosterTable">
                    <thead>
                      <tr>
                        {(
                          [
                            "student_id",
                            "status",
                            "playtime",
                            "attempts",
                            "created",
                          ] as const
                        ).map((key) => (
                          <th key={key}>
                            <button
                              type="button"
                              className="AppRosterSortButton"
                              onClick={() => teacher.onRosterSort(key)}
                            >
                              {key === "student_id"
                                ? "Student ID"
                                : key === "playtime"
                                  ? "Play Time (7d)"
                                  : key === "attempts"
                                    ? "Attempts (7d)"
                                    : key.charAt(0).toUpperCase() + key.slice(1)}
                              {teacher.rosterSort.key === key
                                ? teacher.rosterSort.direction === "asc"
                                  ? " ↑"
                                  : " ↓"
                                : ""}
                            </button>
                          </th>
                        ))}
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teacher.sortedClassroomRoster.map((item) => (
                        <tr key={item.id}>
                          <td>{item.student_id}</td>
                          <td>{item.is_active ? "Active" : "Inactive"}</td>
                          <td>
                            {teacher.teacherProgressByStudentId.get(item.student_id)
                              ?.total_minutes ?? 0}{" "}
                            min
                          </td>
                          <td>
                            {teacher.teacherProgressByStudentId.get(item.student_id)
                              ?.total_attempts ?? 0}
                          </td>
                          <td>{formatSavedDate(item.created_at)}</td>
                          <td>
                            <div className="AppRosterRowActions">
                              <button
                                type="button"
                                className="AppHistoryButton AppProjectionToggleButton"
                                onClick={() => void teacher.toggleRosterStudent(item)}
                                disabled={teacher.rosterBusyId !== null}
                              >
                                {item.is_active ? "Deactivate" : "Activate"}
                              </button>
                              <button
                                type="button"
                                className="AppHistoryButton AppProjectionToggleButton"
                                onClick={() => void teacher.deleteRosterStudent(item)}
                                disabled={teacher.rosterBusyId !== null}
                              >
                                Remove
                              </button>
                              <button
                                type="button"
                                className="AppHistoryButton AppProjectionToggleButton"
                                onClick={() =>
                                  void teacher.copyStudentInstructions(
                                    teacher.selectedFolder?.join_code ?? "",
                                    teacher.classroomPasscode ||
                                      teacher.classroomLastPasscode,
                                    item.student_id,
                                  )
                                }
                                disabled={!teacher.selectedFolder?.join_code}
                              >
                                Copy login
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="AppClassAccessColumns AppRosterCard">
              <div className="AppClassAccessColumn AppClassAccessColumn--library">
                <div className="AppDashboardCard">
                  <h3>Library</h3>
                  {teacher.classLibraryExercises.length === 0 ? (
                    <p className="AppHistoryLabel">
                      No saved exercises in this class yet.
                    </p>
                  ) : (
                    <>
                      <div
                        className="AppRosterRowActions"
                        style={{ marginBottom: "0.45rem" }}
                      >
                        <button
                          type="button"
                          className="AppHistoryButton AppProjectionToggleButton"
                          onClick={teacher.handleSelectAllLibraryExercises}
                          disabled={teacher.deletingSelectedLibrary}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          className="AppHistoryButton AppProjectionToggleButton"
                          onClick={teacher.handleClearLibraryExerciseSelection}
                          disabled={teacher.deletingSelectedLibrary}
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          className="AppHistoryButton AppProjectionToggleButton"
                          onClick={() =>
                            void teacher.handleDeleteSelectedLibraryExercises()
                          }
                          disabled={
                            teacher.deletingSelectedLibrary ||
                            teacher.selectedLibraryExerciseIds.size === 0
                          }
                        >
                          {teacher.deletingSelectedLibrary
                            ? "Deleting..."
                            : "Delete Selected"}
                        </button>
                        <button
                          type="button"
                          className="AppHistoryButton AppProjectionToggleButton"
                          onClick={() =>
                            teacher.setShowCreatePacketFromSelectedModal(true)
                          }
                          disabled={
                            teacher.deletingSelectedLibrary ||
                            teacher.selectedLibraryExerciseIds.size === 0
                          }
                        >
                          Create Packet from Selected
                        </button>
                      </div>
                      <div className="AppRosterTableWrap">
                        <table className="AppRosterTable">
                          <thead>
                            <tr>
                              <th style={{ width: "3rem" }}>Pick</th>
                              <th>Title</th>
                              <th>Seed</th>
                              <th>Created</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {teacher.classLibraryExercises.map((exercise) => (
                              <tr key={exercise.id}>
                                <td>
                                  <input
                                    type="checkbox"
                                    className="AppLibraryCheckbox"
                                    checked={teacher.selectedLibraryExerciseIds.has(
                                      exercise.id,
                                    )}
                                    onChange={() =>
                                      teacher.toggleLibraryExerciseSelection(
                                        exercise.id,
                                      )
                                    }
                                  />
                                </td>
                                <td>
                                  {teacher.editingLibraryExerciseId ===
                                  exercise.id ? (
                                    <div className="AppLibraryTitleEditRow">
                                      <input
                                        className="AppLibraryTitleInput"
                                        type="text"
                                        value={teacher.editingLibraryTitle}
                                        onChange={(e) =>
                                          teacher.setEditingLibraryTitle(
                                            e.target.value,
                                          )
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            e.preventDefault();
                                            void teacher.saveLibraryTitleEdit(
                                              exercise.id,
                                            );
                                          }
                                        }}
                                      />
                                      <button
                                        type="button"
                                        className="AppHistoryButton AppSymbolButton AppSquareButton AppLibraryTitleAction"
                                        onClick={() =>
                                          void teacher.saveLibraryTitleEdit(
                                            exercise.id,
                                          )
                                        }
                                        disabled={
                                          teacher.savingLibraryTitleId ===
                                          exercise.id
                                        }
                                      >
                                        {teacher.savingLibraryTitleId ===
                                        exercise.id
                                          ? "…"
                                          : "✓"}
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="AppLibraryTitleRow">
                                      <button
                                        type="button"
                                        className="AppLibraryTitleButton"
                                        onClick={() =>
                                          void teacher.openLibraryPreview(
                                            exercise.id,
                                            exercise.title,
                                          )
                                        }
                                      >
                                        {exercise.title}
                                      </button>
                                      <button
                                        type="button"
                                        className="AppHistoryButton AppSymbolButton AppSquareButton AppLibraryTitleAction"
                                        onClick={() =>
                                          teacher.startLibraryTitleEdit(exercise)
                                        }
                                        disabled={
                                          teacher.savingLibraryTitleId !== null
                                        }
                                      >
                                        ✎
                                      </button>
                                    </div>
                                  )}
                                </td>
                                <td>{exercise.seed}</td>
                                <td>{formatSavedDate(exercise.created_at)}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="AppHistoryButton AppProjectionToggleButton"
                                    onClick={() =>
                                      void teacher.deleteSavedExercise(
                                        exercise.id,
                                      )
                                    }
                                    disabled={
                                      teacher.deletingSavedExerciseId !== null ||
                                      teacher.loadingSavedExerciseId !== null
                                    }
                                  >
                                    {teacher.deletingSavedExerciseId ===
                                    exercise.id
                                      ? "Deleting..."
                                      : "Delete"}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  {teacher.savedExercisesError ? (
                    <p className="AppHistoryLabel">{teacher.savedExercisesError}</p>
                  ) : null}
                </div>
              </div>

              <div className="AppClassAccessColumn AppClassAccessColumn--stack">
                <div className="AppDashboardCard">
                  <h3>Packets</h3>
                  <div
                    className="AppRosterRowActions"
                    style={{ marginBottom: "0.45rem" }}
                  >
                    <button
                      type="button"
                      className="AppHistoryButton AppProjectionToggleButton"
                      onClick={onOpenBatchGenerate}
                      disabled={teacher.batchStatus === "running"}
                    >
                      Batch Generate
                    </button>
                  </div>
                  {teacher.classPacketsStatus === "loading" ? (
                    <p className="AppHistoryLabel">Loading packets...</p>
                  ) : teacher.classPackets.length === 0 ? (
                    <p className="AppHistoryLabel">
                      No packets created for this class yet.
                    </p>
                  ) : (
                    <div className="AppPanelButtons">
                      {teacher.classPackets.map((packet) => (
                        <div key={packet.id}>
                          <p className="AppHistoryLabel">
                            {packet.title} | {formatSavedDate(packet.created_at)}
                          </p>
                          {packet.notes ? (
                            <p className="AppHistoryLabel">{packet.notes}</p>
                          ) : null}
                          <div className="AppRosterRowActions">
                            <button
                              type="button"
                              className="AppHistoryButton AppProjectionToggleButton"
                              onClick={() => void onOpenSavedPacket(packet)}
                              disabled={
                                teacher.loadingPacketId !== null ||
                                teacher.deletingPacketId !== null
                              }
                            >
                              {teacher.loadingPacketId === packet.id
                                ? "Opening..."
                                : "Reprint"}
                            </button>
                            <button
                              type="button"
                              className="AppHistoryButton AppProjectionToggleButton"
                              onClick={() => void onExportSavedPacketZip(packet)}
                              disabled={teacher.exportingPacketId !== null}
                            >
                              {teacher.exportingPacketId === packet.id
                                ? "Exporting..."
                                : "Export MusicXML ZIP"}
                            </button>
                            <button
                              type="button"
                              className="AppHistoryButton AppProjectionToggleButton"
                              onClick={() => void teacher.deletePacket(packet.id)}
                              disabled={teacher.deletingPacketId !== null}
                            >
                              {teacher.deletingPacketId === packet.id
                                ? "Deleting..."
                                : "Delete"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="AppDashboardCard">
                  <h3>Student Submissions</h3>
                  {teacher.studentSubmissionsStatus === "loading" ? (
                    <p className="AppHistoryLabel">Loading submissions...</p>
                  ) : teacher.studentSubmissions.length === 0 ? (
                    <p className="AppHistoryLabel">No pending submissions.</p>
                  ) : (
                    <div className="AppPanelButtons">
                      {teacher.studentSubmissions.map((sub) => (
                        <div key={sub.id}>
                          <p className="AppHistoryLabel">
                            {sub.title} | {formatSavedDate(sub.created_at)}
                          </p>
                          <p className="AppHistoryLabel">
                            Student ID: {sub.student_id} | Seed: {sub.seed}
                          </p>
                          <div className="AppRosterRowActions">
                            <button
                              type="button"
                              className="AppHistoryButton AppProjectionToggleButton"
                              onClick={() => onPreviewSubmission(sub)}
                              disabled={teacher.processingSubmissionId !== null}
                            >
                              Preview
                            </button>
                            <button
                              type="button"
                              className="AppHistoryButton AppProjectionToggleButton"
                              onClick={() => void teacher.approveSubmission(sub.id)}
                              disabled={teacher.processingSubmissionId !== null}
                            >
                              {teacher.processingSubmissionId === sub.id
                                ? "Adding..."
                                : "Add to Library"}
                            </button>
                            <button
                              type="button"
                              className="AppHistoryButton AppProjectionToggleButton"
                              onClick={() => void teacher.rejectSubmission(sub.id)}
                              disabled={teacher.processingSubmissionId !== null}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {teacher.studentSubmissionsError ? (
                    <p className="AppHistoryLabel">
                      {teacher.studentSubmissionsError}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : mode === "teacher" ? (
        <div className="AppDashboardCard">
          <p className="AppHistoryLabel">
            Subscription required to access class tools.
          </p>
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={() => void teacher.startCheckout()}
            disabled={
              teacher.checkoutStatus === "starting" ||
              teacher.checkoutStatus === "redirecting"
            }
          >
            {teacher.checkoutStatus === "starting" ? "Starting..." : "Upgrade"}
          </button>
        </div>
      ) : (
        <div className="AppDashboardCard">
          <p className="AppHistoryLabel">
            Students and guests use the Melody Generator to join classes and load
            assigned exercises.
          </p>
          <Link className="AppHistoryButton" to="/generator">
            Go to Melody Generator
          </Link>
        </div>
      )}
    </section>
  );
}

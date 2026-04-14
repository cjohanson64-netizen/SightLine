import { useTeacherLibrary } from "../hooks/useTeacherLibrary";

type TeacherState = ReturnType<typeof useTeacherLibrary>;

interface GeneratorTeacherSidebarProps {
  formatSavedDate: (value: string | null | undefined) => string;
  handleLoadSavedExercise: (id: string) => Promise<void>;
  interactionDisabled: boolean;
  teacher: TeacherState;
  teacherFeaturesDisabled: boolean;
}

export default function GeneratorTeacherSidebar({
  formatSavedDate,
  handleLoadSavedExercise,
  interactionDisabled,
  teacher,
  teacherFeaturesDisabled,
}: GeneratorTeacherSidebarProps): JSX.Element {
  return (
    <fieldset className="AppInteractionFieldset" disabled={interactionDisabled}>
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
                {teacher.folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            {teacher.filteredSavedExercises.length === 0 ? (
              <p className="AppHistoryLabel">No saved exercises in this class.</p>
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
                      onClick={() => void teacher.deleteSavedExercise(exercise.id)}
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
    </fieldset>
  );
}

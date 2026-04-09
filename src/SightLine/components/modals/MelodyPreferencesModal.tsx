import type { Dispatch, SetStateAction } from "react";
import ExerciseForm from "../ExerciseForm/ExerciseForm";
import { useProjection } from "../../hooks/useProjection";
import { useTeacherLibrary } from "../../hooks/useTeacherLibrary";
import type { ExerciseSpec } from "@/SightLine/domain/music";

type TeacherLibraryState = ReturnType<typeof useTeacherLibrary>;
type ProjectionState = ReturnType<typeof useProjection>;

interface MelodyPreferencesModalProps {
  isGuestMode: boolean;
  isOpen: boolean;
  mode: "teacher" | "student" | "guest";
  normalizeSpec: (spec: ExerciseSpec) => ExerciseSpec;
  onClose: () => void;
  onExport: () => void;
  onRandomizeSeed: () => void;
  projection: ProjectionState;
  setSpec: Dispatch<SetStateAction<ExerciseSpec>>;
  spec: ExerciseSpec;
  teacher: TeacherLibraryState;
  interactionDisabled: boolean;
}

export default function MelodyPreferencesModal({
  isGuestMode,
  isOpen,
  mode,
  normalizeSpec,
  onClose,
  onExport,
  onRandomizeSeed,
  projection,
  setSpec,
  spec,
  teacher,
  interactionDisabled,
}: MelodyPreferencesModalProps): JSX.Element | null {
  if (!isOpen || projection.isProjectionMode) {
    return null;
  }

  return (
    <div className="AppModalBackdrop" onClick={onClose} role="presentation">
      <div
        className="AppModal AppModalWide"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <ExerciseForm
          spec={spec}
          onSpecChange={(next) => setSpec(normalizeSpec(next))}
          onRandomizeSeed={onRandomizeSeed}
          onExport={onExport}
          showActions={false}
          disableAdvancedPanels={isGuestMode}
          interactionDisabled={interactionDisabled}
          bare
          headerActions={
            <div className="AppPrefsHeaderActions">
              {mode === "teacher" ? (
                <>
                  <button
                    type="button"
                    className="AppHistoryButton AppProjectionToggleButton"
                    onClick={() => void teacher.saveClassDefaults(spec)}
                    disabled={
                      interactionDisabled ||
                      !teacher.selectedFolderId ||
                      teacher.classroomDefaultsStatus === "loading"
                    }
                  >
                    Class Default
                  </button>
                  <button
                    type="button"
                    className="AppHistoryButton AppProjectionToggleButton"
                    onClick={() => void teacher.clearClassDefaults()}
                    disabled={
                      interactionDisabled ||
                      !teacher.selectedFolderId ||
                      teacher.classroomDefaultsStatus === "loading"
                    }
                  >
                    Clear Default
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="AppHistoryButton AppSymbolButton AppSquareButton AppPrefsCloseButton"
                onClick={onClose}
                disabled={interactionDisabled}
              >
                x
              </button>
            </div>
          }
        />
      </div>
    </div>
  );
}

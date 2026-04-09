import NotationViewer from "../NotationViewer/NotationViewer";
import { useSolfege } from "../../hooks/useSolfege";
import { useTeacherLibrary } from "../../hooks/useTeacherLibrary";
import type { ExerciseSpec } from "@/SightLine/domain/music";

type SolfegeState = ReturnType<typeof useSolfege>;
type TeacherState = ReturnType<typeof useTeacherLibrary>;

interface LibraryPreviewModalProps {
  currentSpecSnapshot: ExerciseSpec | null;
  isOpen: boolean;
  mode: "teacher" | "student" | "guest";
  onClose: () => void;
  solfege: SolfegeState;
  spec: ExerciseSpec;
  teacher: TeacherState;
  interactionDisabled: boolean;
}

export default function LibraryPreviewModal({
  currentSpecSnapshot,
  isOpen,
  mode,
  onClose,
  solfege,
  spec,
  teacher,
  interactionDisabled,
}: LibraryPreviewModalProps): JSX.Element | null {
  if (!isOpen || mode !== "teacher") {
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
        <button
          type="button"
          className="AppModalClose"
          onClick={onClose}
          disabled={interactionDisabled}
        >
          ×
        </button>
        <h3>Preview: {teacher.libraryPreviewTitle}</h3>
        {teacher.libraryPreviewStatus === "loading" ? (
          <p className="AppHistoryLabel">Loading preview...</p>
        ) : teacher.libraryPreviewStatus === "error" ? (
          <p className="AppHistoryLabel">{teacher.libraryPreviewMessage}</p>
        ) : (
          <NotationViewer
            musicXml={solfege.addSolfegeLyricsToMusicXml(
              teacher.libraryPreviewMusicXml,
              {
                solfegeMode: solfege.solfegeMode,
                accidentalMode: solfege.solfegeAccidentalMode,
                colorizeLyrics: solfege.solfegeColorizeMode !== "off",
                fallback: {
                  key: currentSpecSnapshot?.key ?? spec.key,
                  mode: currentSpecSnapshot?.mode ?? spec.mode,
                },
              },
            )}
            zoom={1}
            projectionMode={false}
            solfegeActive={solfege.solfegeMode !== "off"}
            solfegeColorizeLyrics={solfege.solfegeColorizeMode !== "off"}
            solfegeOverlayNoteheads={
              solfege.solfegeMode !== "off" && solfege.solfegeOverlayMode
            }
            headerControls={
              <span className="AppHistoryLabel">{teacher.libraryPreviewTitle}</span>
            }
          />
        )}
      </div>
    </div>
  );
}

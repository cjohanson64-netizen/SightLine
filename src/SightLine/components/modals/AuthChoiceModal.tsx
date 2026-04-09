import type { AuthUserView } from "../../hooks/useAuth";

interface AuthChoiceModalProps {
  authUser: AuthUserView | null;
  isOpen: boolean;
  onClose: () => void;
  onStudentSignIn: () => void;
  onTeacherSignIn: () => Promise<void>;
}

export default function AuthChoiceModal({
  authUser,
  isOpen,
  onClose,
  onStudentSignIn,
  onTeacherSignIn,
}: AuthChoiceModalProps): JSX.Element | null {
  if (!isOpen || authUser) {
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
        <button type="button" className="AppModalClose" onClick={onClose}>
          ×
        </button>
        <h3>Sign In</h3>
        <p className="AppHistoryLabel">
          Choose how you want to access SightLine.
        </p>
        <div className="AppBatchActions">
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={() => void onTeacherSignIn()}
          >
            Teacher Sign In
          </button>
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={onStudentSignIn}
          >
            Student Sign In
          </button>
        </div>
      </div>
    </div>
  );
}

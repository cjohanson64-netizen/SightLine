import StudentJoinForm from "../StudentJoinForm/StudentJoinForm";
import { useStudentSession } from "../../hooks/useStudentSession";
import type { AuthUserView } from "../../hooks/useAuth";

type StudentSessionState = ReturnType<typeof useStudentSession>;

interface StudentSignInModalProps {
  authUser: AuthUserView | null;
  isOpen: boolean;
  onClose: () => void;
  onJoin: () => Promise<void>;
  onLeave: () => void;
  onResetToMySettings: () => void;
  onUseTeacherSettings: () => void;
  student: StudentSessionState;
}

export default function StudentSignInModal({
  authUser,
  isOpen,
  onClose,
  onJoin,
  onLeave,
  onResetToMySettings,
  onUseTeacherSettings,
  student,
}: StudentSignInModalProps): JSX.Element | null {
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
        <h3>Student Sign In</h3>
        <div className="AppPanelButtons">
          <StudentJoinForm
            studentSession={student.studentSession}
            studentJoinCode={student.studentJoinCode}
            onJoinCodeChange={student.setStudentJoinCode}
            studentPasscode={student.studentPasscode}
            onPasscodeChange={student.setStudentPasscode}
            studentId={student.studentId}
            onStudentIdChange={student.setStudentId}
            studentPin={student.studentPin}
            onPinChange={student.setStudentPin}
            studentDisplayName={student.studentDisplayName}
            onDisplayNameChange={student.setStudentDisplayName}
            studentJoinStatus={student.studentJoinStatus}
            studentJoinMessage={student.studentJoinMessage}
            studentProgress={student.studentProgress}
            studentProgressStatus={student.studentProgressStatus}
            studentProgressError={student.studentProgressError}
            classroomDefaultsStatus={student.classroomDefaultsStatus}
            classroomDefaultsMessage={student.classroomDefaultsMessage}
            studentSpecBeforeDefaults={student.studentSpecBeforeDefaults}
            onJoin={() => void onJoin()}
            onLeave={onLeave}
            onUseTeacherSettings={onUseTeacherSettings}
            onResetToMySettings={onResetToMySettings}
          />
        </div>
      </div>
    </div>
  );
}

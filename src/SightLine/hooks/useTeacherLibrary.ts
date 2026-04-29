import { useTeacherBilling } from "./useTeacherBilling";
import { useTeacherClassroom } from "./useTeacherClassroom";
import { useTeacherExercises } from "./useTeacherExercises";
import type { UseTeacherLibraryOptions } from "./teacherLibraryTypes";

export type {
  SavedExerciseItem,
  FolderItem,
  PacketItem,
  StudentSubmissionItem,
  ClassroomStudentItem,
  TeacherProgressRow,
  BatchPacketItem,
  RosterSortKey,
  UseTeacherLibraryOptions,
} from "./teacherLibraryTypes";

export function useTeacherLibrary({
  authUserId,
  mode,
  normalizeSpec,
  extractMelodyEvents,
}: UseTeacherLibraryOptions) {
  const billing = useTeacherBilling({ authUserId, mode });

  const classroom = useTeacherClassroom({
    authUserId,
    mode,
    normalizeSpec,
  });

  const exercises = useTeacherExercises({
    authUserId,
    mode,
    normalizeSpec,
    extractMelodyEvents,
    selectedFolderId: classroom.selectedFolderId,
    folderFilterId: classroom.folderFilterId,
  });

  const approveSubmission = async (submissionId: string) => {
    const approved = await classroom.approveSubmission(submissionId);
    if (approved) {
      await exercises.refreshSavedExercises();
    }
  };

  return {
    ...exercises,
    ...classroom,
    ...billing,
    approveSubmission,
    copyClassroomAccess: async (joinCode: string, passcode: string) => {
      if (!joinCode) return;
      const text = `Class Code: ${joinCode}  Passcode: ${passcode}`;
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    },
    copyStudentInstructions: async (
      joinCode: string,
      passcode: string,
      studentIdValue?: string,
    ) => {
      const instruction = [
        `Class Code: ${joinCode}`,
        `Passcode: ${passcode || "ask teacher"}`,
        studentIdValue
          ? `Student ID: ${studentIdValue}`
          : "Student ID: <assigned by teacher>",
      ].join("\n");
      try {
        await navigator.clipboard.writeText(instruction);
        return true;
      } catch {
        return false;
      }
    },
  };
}

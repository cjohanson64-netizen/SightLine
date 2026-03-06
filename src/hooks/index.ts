export { useAuth } from "./useAuth";
export type { AuthUserView } from "./useAuth";

export { usePlayback } from "./usePlayback";

export { useProjection } from "./useProjection";

export { useSolfege, addSolfegeLyricsToMusicXml, colorForSolfegeSyllable } from "./useSolfege";
export type { SolfegeMode, SolfegeAccidentalMode } from "./useSolfege";

export { useStudentSession } from "./useStudentSession";
export type {
  StudentSession,
  StudentProgressSummary,
  ClassroomExerciseItem,
} from "./useStudentSession";

export { useTeacherLibrary } from "./useTeacherLibrary";
export type {
  SavedExerciseItem,
  FolderItem,
  PacketItem,
  StudentSubmissionItem,
  ClassroomStudentItem,
  TeacherProgressRow,
  BatchPacketItem,
  RosterSortKey,
} from "./useTeacherLibrary";
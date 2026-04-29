import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";

export type SavedExerciseItem = {
  id: string;
  seed: number;
  title: string;
  created_at: string;
  folder_id: string | null;
};

export type FolderItem = {
  id: string;
  name: string;
  join_code: string | null;
  is_published: boolean | null;
  default_spec_json: ExerciseSpec | null;
};

export type PacketItem = {
  id: string;
  folder_id: string;
  title: string;
  notes: string | null;
  created_at: string;
};

export type StudentSubmissionItem = {
  id: string;
  folder_id: string;
  student_id: string;
  title: string;
  seed: number;
  music_xml: string;
  spec_json: ExerciseSpec | null;
  melody_json: MelodyEvent[] | null;
  beats_per_measure: number | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

export type ClassroomStudentItem = {
  id: string;
  folder_id: string;
  student_id: string;
  is_active: boolean;
  created_at: string;
};

export type TeacherProgressRow = {
  student_id: string;
  total_minutes: number;
  total_attempts: number;
  last_practiced_at: string | null;
};

export type BatchPacketItem = {
  exerciseId: string;
  seed: number;
  title: string;
  musicXml: string;
  position: number;
};

export type RosterSortKey =
  | "student_id"
  | "status"
  | "playtime"
  | "attempts"
  | "created";

export interface UseTeacherLibraryOptions {
  authUserId: string | null;
  mode: "teacher" | "student" | "guest";
  normalizeSpec: (spec: ExerciseSpec) => ExerciseSpec;
  extractMelodyEvents: (artifact: {
    nodes: Array<{ kind: string; data: unknown }>;
  }) => MelodyEvent[];
}

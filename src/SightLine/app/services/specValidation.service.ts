import type { ExerciseSpec } from "@/SightLine/domain/music";

export function validateAllowedNoteValues(
  nextSpec: ExerciseSpec,
): { title: string; message: string; suggestions: string[] } | null {
  const allowed = nextSpec.userConstraints?.allowedNoteValues ?? [];

  if (allowed.length > 0) return null;

  if (allowed.length === 0) {
    return {
      title: "Invalid Note Values",
      message: "Choose at least one allowed note value.",
      suggestions: ["Select at least one note value from EE, Q, H, W."],
    };
  }

  return null;
}
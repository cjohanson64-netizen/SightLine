import { z } from "zod";

export const exerciseLoadResponseSchema = z.object({
  id: z.string(),
  seed: z.number(),
  title: z.string(),
  music_xml: z.string(),
  spec_json: z.record(z.string(), z.unknown()).nullable(),
  melody_json: z.array(z.record(z.string(), z.unknown())).nullable(),
  beats_per_measure: z.number().nullable(),
  folder_id: z.string().nullable(),
});

export const classroomJoinResponseSchema = z.object({
  token: z.string(),
  classroom: z.object({
    id: z.string(),
    name: z.string(),
    join_code: z.string(),
    student_id: z.string().optional(),
  }),
});

export const submissionApproveResponseSchema = z.object({
  ok: z.boolean(),
});

export const classroomExerciseLoadResponseSchema = z.object({
  exercise: exerciseLoadResponseSchema,
});

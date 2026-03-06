import { supabase } from "../lib/supabaseClient";
import type { ExerciseSpec, MelodyEvent } from "../tat";

export type SaveExerciseParams = {
  seed: number;
  title: string;
  musicXml: string;
  folderId?: string | null;
  specJson?: ExerciseSpec | null;
  melodyJson?: MelodyEvent[] | null;
  beatsPerMeasure?: number | null;
};

export type ExerciseRow = {
  id: string;
  owner_id: string;
  seed: number;
  title: string;
  music_xml: string;
  spec_json?: ExerciseSpec | null;
  melody_json?: MelodyEvent[] | null;
  beats_per_measure?: number | null;
  created_at: string;
};

export type SavedExerciseSummary = Pick<
  ExerciseRow,
  "id" | "seed" | "title" | "created_at"
>;

export type LoadedExercise = Pick<
  ExerciseRow,
  "music_xml" | "seed" | "title" | "spec_json" | "melody_json" | "beats_per_measure"
>;

async function requireSignedInUserId(): Promise<string> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(`Unable to verify user: ${userError.message}`);
  }

  if (!user) {
    throw new Error("You must be signed in to access saved exercises.");
  }

  return user.id;
}

export async function saveExercise(
  params: SaveExerciseParams,
): Promise<ExerciseRow> {
  const ownerId = await requireSignedInUserId();

  const { data, error } = await supabase
    .from("exercises")
    .insert({
      owner_id: ownerId,
      seed: params.seed,
      title: params.title,
      music_xml: params.musicXml,
      folder_id: params.folderId ?? null,
      spec_json: params.specJson ?? null,
      melody_json: params.melodyJson ?? null,
      beats_per_measure: params.beatsPerMeasure ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Save failed: ${error.message}`);
  }

  if (!data) {
    throw new Error("Save failed: no row returned from database.");
  }

  return data as ExerciseRow;
}

export async function listSavedExercises(): Promise<SavedExerciseSummary[]> {
  const ownerId = await requireSignedInUserId();
  const { data, error } = await supabase
    .from("exercises")
    .select("id, seed, title, created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Unable to load saved exercises: ${error.message}`);
  }

  return (data ?? []) as SavedExerciseSummary[];
}

export async function loadSavedExercise(id: string): Promise<LoadedExercise> {
  const ownerId = await requireSignedInUserId();
  const { data, error } = await supabase
    .from("exercises")
    .select("music_xml, seed, title, spec_json, melody_json, beats_per_measure")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .single();

  if (error) {
    throw new Error(`Unable to load exercise: ${error.message}`);
  }

  if (!data) {
    throw new Error("Unable to load exercise: no row found.");
  }

  return data as LoadedExercise;
}

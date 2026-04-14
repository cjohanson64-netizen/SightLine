import { normalizeUserConstraintsInSpec } from "../core/spec";
import { usePitchEdit } from "./usePitchEdit";
import { useTeacherLibrary } from "./useTeacherLibrary";
import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";
import type {
  GeneratorError,
  GeneratorViewerStateControllers,
} from "./generatorViewerState";
import { loadExerciseIntoViewer } from "./generatorViewerState";

type PitchEditState = ReturnType<typeof usePitchEdit>;
type TeacherState = ReturnType<typeof useTeacherLibrary>;

interface UseExercisePersistenceOptions {
  applyPitchPatch: (
    melody: MelodyEvent[],
    patch: PitchEditState["pitchPatch"],
  ) => MelodyEvent[];
  currentBeatsPerMeasure: number;
  currentMelody: MelodyEvent[];
  currentSpecSnapshot: ExerciseSpec | null;
  exportMusicXml: string;
  mode: "teacher" | "student" | "guest";
  pitchEdit: Pick<
    PitchEditState,
    | "pitchPatch"
    | "setPitchPatch"
    | "setSelectionIndex"
    | "setSelectedNoteId"
    | "setEditMessage"
  >;
  seed: number;
  setCurrentMelody: (value: MelodyEvent[]) => void;
  setCurrentSpecSnapshot: (value: ExerciseSpec | null) => void;
  setSaveMessage: (value: string) => void;
  setSaveStatus: (value: "idle" | "saving" | "saved" | "error") => void;
  spec: ExerciseSpec;
  teacher: Pick<TeacherState, "loadSavedExercise" | "saveToSupabase">;
  viewerState: GeneratorViewerStateControllers;
}

export function useExercisePersistence({
  applyPitchPatch,
  currentBeatsPerMeasure,
  currentMelody,
  currentSpecSnapshot,
  exportMusicXml,
  mode,
  pitchEdit,
  seed,
  setCurrentMelody,
  setCurrentSpecSnapshot,
  setSaveMessage,
  setSaveStatus,
  spec,
  teacher,
  viewerState,
}: UseExercisePersistenceOptions) {
  const handleSaveToSupabase = async (forceInsert = false) => {
    if (mode !== "teacher") {
      setSaveStatus("error");
      setSaveMessage("Saving is available in teacher mode only.");
      return;
    }

    setSaveMessage("");
    if (!exportMusicXml) {
      setSaveStatus("error");
      setSaveMessage("Generate a melody before saving.");
      return;
    }

    setSaveStatus("saving");
    try {
      const patchedMelody =
        currentMelody.length > 0
          ? applyPitchPatch(currentMelody, pitchEdit.pitchPatch)
          : [];
      const specToSave =
        currentSpecSnapshot ?? normalizeUserConstraintsInSpec(spec);
      const result = await teacher.saveToSupabase({
        forceInsert,
        seed,
        title: spec.title,
        musicXml: exportMusicXml,
        currentMelody: patchedMelody,
        pitchPatch: pitchEdit.pitchPatch as unknown as Record<string, unknown>,
        specSnapshot: specToSave,
        beatsPerMeasure: currentBeatsPerMeasure,
      });
      setSaveStatus(result.status);
      setSaveMessage(result.message);
    } catch (err) {
      setSaveStatus("error");
      setSaveMessage(
        `Save failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  };

  const handleLoadSavedExercise = async (id: string) => {
    const saved = await teacher.loadSavedExercise(id);
    if (!saved) {
      return;
    }

    loadExerciseIntoViewer(saved, viewerState);
    const hasInteractiveData =
      saved.spec_json !== null &&
      Array.isArray(saved.melody_json) &&
      saved.melody_json.length > 0;
    if (!hasInteractiveData) {
      setCurrentSpecSnapshot(null);
      setCurrentMelody([]);
    }
  };

  return {
    handleLoadSavedExercise,
    handleSaveToSupabase,
  };
}

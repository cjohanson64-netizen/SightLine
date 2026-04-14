import type { Dispatch, SetStateAction } from "react";
import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";
import { usePitchEdit } from "./usePitchEdit";
import { usePlayback } from "./usePlayback";

type PlaybackState = ReturnType<typeof usePlayback>;
type PitchEditState = ReturnType<typeof usePitchEdit>;

export interface GeneratorError {
  title: string;
  message: string;
  suggestions: string[];
}

export interface ViewerExercisePayload {
  id?: string | null;
  seed: number;
  title: string;
  music_xml: string;
  spec_json?: ExerciseSpec | null;
  melody_json?: MelodyEvent[] | null;
  beats_per_measure?: number | null;
  folder_id?: string | null;
}

export interface GeneratorViewerStateControllers {
  playback: Pick<PlaybackState, "stop" | "setPlaybackHighlightIndex">;
  pitchEdit: Pick<
    PitchEditState,
    | "setPitchPatch"
    | "setSelectionIndex"
    | "setSelectedNoteId"
    | "setEditMessage"
  >;
  setCurrentBeatsPerMeasure: (value: number) => void;
  setCurrentMelody: (value: MelodyEvent[]) => void;
  setCurrentSpecSnapshot: (value: ExerciseSpec | null) => void;
  setError: (value: GeneratorError | null) => void;
  setLogs: (value: string[]) => void;
  setMusicXml: (value: string) => void;
  setRelaxationNotice: (value: string) => void;
  setSeed: (value: number) => void;
  setSpec: Dispatch<SetStateAction<ExerciseSpec>>;
}

export function loadExerciseIntoViewer(
  saved: ViewerExercisePayload,
  controls: GeneratorViewerStateControllers,
  editMessageText?: string,
): void {
  controls.playback.stop();
  controls.setMusicXml(saved.music_xml);
  controls.setSeed(saved.seed);
  controls.setSpec((prev) => ({ ...prev, title: saved.title }));
  controls.setCurrentSpecSnapshot(saved.spec_json ?? null);
  controls.setCurrentMelody(saved.melody_json ?? []);
  controls.setCurrentBeatsPerMeasure(
    typeof saved.beats_per_measure === "number" &&
      Number.isFinite(saved.beats_per_measure)
      ? Math.max(1, saved.beats_per_measure)
      : 4,
  );
  controls.pitchEdit.setPitchPatch({});
  controls.setLogs([]);
  controls.setRelaxationNotice("");
  controls.setError(null);
  controls.pitchEdit.setSelectionIndex(0);
  controls.pitchEdit.setSelectedNoteId(null);
  controls.pitchEdit.setEditMessage(editMessageText ?? "");
  controls.playback.setPlaybackHighlightIndex(null);
}

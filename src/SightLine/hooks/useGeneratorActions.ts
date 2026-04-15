import type { Dispatch, SetStateAction } from "react";
import type { DebugSemanticsProjection } from "@/SightLine/domain/artifact";
import { usePlayback } from "./usePlayback";
import { useSolfege } from "./useSolfege";
import { useStudentSession } from "./useStudentSession";
import { useTeacherLibrary } from "./useTeacherLibrary";
import { usePitchEdit } from "./usePitchEdit";
import { useClassroomActions } from "./useClassroomActions";
import type {
  GeneratorError,
  GeneratorViewerStateControllers,
} from "./generatorViewerState";
import { useExercisePersistence } from "./useExercisePersistence";
import { useGeneratorEngine } from "./useGeneratorEngine";
import { usePacketActions } from "./usePacketActions";
import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";

type PlaybackState = ReturnType<typeof usePlayback>;
type PitchEditState = ReturnType<typeof usePitchEdit>;
type SolfegeState = ReturnType<typeof useSolfege>;
type StudentState = ReturnType<typeof useStudentSession>;
type TeacherState = ReturnType<typeof useTeacherLibrary>;

interface UseGeneratorActionsOptions {
  applyPitchPatch: (
    melody: MelodyEvent[],
    patch: PitchEditState["pitchPatch"],
  ) => MelodyEvent[];
  currentBeatsPerMeasure: number;
  currentMelody: MelodyEvent[];
  currentPatchedMelody: MelodyEvent[];
  currentSpecSnapshot: ExerciseSpec | null;
  exportMusicXml: string;
  extractMelodyEvents: (artifact: {
    nodes: Array<{ kind: string; data: unknown }>;
  }) => MelodyEvent[];
  formatSavedDate: (value: string | null | undefined) => string;
  isGuestMode: boolean;
  mode: "teacher" | "student" | "guest";
  navigate: (to: string) => void;
  pitchEdit: Pick<
    PitchEditState,
    | "pitchPatch"
    | "setPitchPatch"
    | "setSelectionIndex"
    | "setSelectedNoteId"
    | "setEditMessage"
    | "setPitchEditMode"
  >;
  playback: Pick<
    PlaybackState,
    "stop" | "setPlaybackHighlightIndex"
  >;
  seed: number;
  setCurrentBeatsPerMeasure: (value: number) => void;
  setCurrentMelody: (value: MelodyEvent[]) => void;
  setCurrentSpecSnapshot: (value: ExerciseSpec | null) => void;
  setError: (value: GeneratorError | null) => void;
  setLogs: (value: string[]) => void;
  setMusicXml: (value: string) => void;
  setRelaxationNotice: (value: string) => void;
  setSaveMessage: (value: string) => void;
  setSaveStatus: (value: "idle" | "saving" | "saved" | "error") => void;
  setSeed: (value: number) => void;
  setSpec: Dispatch<SetStateAction<ExerciseSpec>>;
  setDebugSemantics: (value: DebugSemanticsProjection) => void;
  solfege: Pick<
    SolfegeState,
    | "addSolfegeLyricsToMusicXml"
    | "solfegeMode"
    | "solfegeAccidentalMode"
    | "solfegeColorizeMode"
  >;
  spec: ExerciseSpec;
  student: StudentState;
  teacher: TeacherState;
  validateAllowedNoteValues: (
    nextSpec: ExerciseSpec,
  ) => GeneratorError | null;
}

export function useGeneratorActions({
  applyPitchPatch,
  currentBeatsPerMeasure,
  currentMelody,
  currentPatchedMelody,
  currentSpecSnapshot,
  exportMusicXml,
  extractMelodyEvents,
  formatSavedDate,
  isGuestMode,
  mode,
  navigate,
  pitchEdit,
  playback,
  seed,
  setCurrentBeatsPerMeasure,
  setCurrentMelody,
  setCurrentSpecSnapshot,
  setError,
  setLogs,
  setMusicXml,
  setRelaxationNotice,
  setSaveMessage,
  setSaveStatus,
  setSeed,
  setSpec,
  setDebugSemantics,
  solfege,
  spec,
  student,
  teacher,
  validateAllowedNoteValues,
}: UseGeneratorActionsOptions) {
  const viewerState: GeneratorViewerStateControllers = {
    playback,
    pitchEdit: {
      setPitchPatch: pitchEdit.setPitchPatch,
      setSelectionIndex: pitchEdit.setSelectionIndex,
      setSelectedNoteId: pitchEdit.setSelectedNoteId,
      setEditMessage: pitchEdit.setEditMessage,
    },
    setCurrentBeatsPerMeasure,
    setCurrentMelody,
    setCurrentSpecSnapshot,
    setError,
    setLogs,
    setMusicXml,
    setRelaxationNotice,
    setSeed,
    setSpec,
    setDebugSemantics,
  };

  const { runWithNewSeed, rerunWithCurrentSeed } = useGeneratorEngine({
    extractMelodyEvents,
    isGuestMode,
    mode,
    pitchEdit,
    seed,
    setCurrentBeatsPerMeasure,
    setCurrentMelody,
    setCurrentSpecSnapshot,
    setError,
    setLogs,
    setMusicXml,
    setRelaxationNotice,
    setSeed,
    setSpec,
    setDebugSemantics,
    spec,
    student,
    teacher,
    validateAllowedNoteValues,
  });

  const { handleSaveToSupabase, handleLoadSavedExercise } =
    useExercisePersistence({
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
    });

  const {
    handleSubmitToTeacher,
    handlePreviewSubmission,
    handleLoadClassroomExercise,
  } = useClassroomActions({
    currentBeatsPerMeasure,
    currentPatchedMelody,
    currentSpecSnapshot,
    exportMusicXml,
    mode,
    navigate,
    pitchEdit: {
      setPitchEditMode: pitchEdit.setPitchEditMode,
    },
    seed,
    spec,
    student,
    viewerState,
  });

  const {
    handleBatchGenerate,
    handleExport,
    handleExportSavedPacketZip,
    handleOpenSavedPacket,
  } = usePacketActions({
    currentSpecSnapshot,
    exportMusicXml,
    formatSavedDate,
    seed,
    solfege,
    spec,
    teacher,
  });

  return {
    handleBatchGenerate,
    handleExport,
    handleExportSavedPacketZip,
    handleLoadClassroomExercise,
    handleLoadSavedExercise,
    handleOpenSavedPacket,
    handlePreviewSubmission,
    handleSaveToSupabase,
    handleSubmitToTeacher,
    rerunWithCurrentSeed,
    runWithNewSeed,
  };
}

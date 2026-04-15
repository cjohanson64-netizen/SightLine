import type { Dispatch, SetStateAction } from "react";
import { generateExercise } from "../core/engine";
import { toGuestSpec, normalizeUserConstraintsInSpec } from "../core/spec";
import type { DebugSemanticsProjection } from "@/SightLine/domain/artifact";
import { usePitchEdit } from "./usePitchEdit";
import { useStudentSession } from "./useStudentSession";
import { useTeacherLibrary } from "./useTeacherLibrary";
import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";
import type { GeneratorError } from "./generatorViewerState";

type PitchEditState = ReturnType<typeof usePitchEdit>;
type StudentState = ReturnType<typeof useStudentSession>;
type TeacherState = ReturnType<typeof useTeacherLibrary>;

interface UseGeneratorEngineOptions {
  extractMelodyEvents: (artifact: {
    nodes: Array<{ kind: string; data: unknown }>;
  }) => MelodyEvent[];
  isGuestMode: boolean;
  mode: "teacher" | "student" | "guest";
  pitchEdit: Pick<
    PitchEditState,
    | "setPitchPatch"
    | "setSelectionIndex"
    | "setSelectedNoteId"
    | "setEditMessage"
  >;
  seed: number;
  setCurrentBeatsPerMeasure: (value: number) => void;
  setCurrentMelody: (value: MelodyEvent[]) => void;
  setCurrentSpecSnapshot: (value: ExerciseSpec | null) => void;
  setError: (value: GeneratorError | null) => void;
  setLogs: (value: string[]) => void;
  setMusicXml: (value: string) => void;
  setRelaxationNotice: (value: string) => void;
  setSeed: (value: number) => void;
  setSpec: Dispatch<SetStateAction<ExerciseSpec>>;
  setDebugSemantics: (value: DebugSemanticsProjection) => void;
  spec: ExerciseSpec;
  student: Pick<StudentState, "studentSession" | "markActivity" | "trackProgress">;
  teacher: Pick<TeacherState, "setActiveExerciseId">;
  validateAllowedNoteValues: (
    nextSpec: ExerciseSpec,
  ) => GeneratorError | null;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

export function useGeneratorEngine({
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
}: UseGeneratorEngineOptions) {
  const relaxationMessage = (tier?: number): string => {
    const msg =
      "A few settings were a bit too tight to finish the phrase. We loosened one so the melody could resolve smoothly. You can refine your settings and try again.";
    return typeof tier === "number" && tier > 0 ? msg : "";
  };

  const applyGenerationOutput = (
    output: ReturnType<typeof generateExercise>,
    specForRun: ExerciseSpec,
  ) => {
    if (output.status === "no_solution") {
      setMusicXml("");
      setCurrentMelody([]);
      setCurrentSpecSnapshot(null);
      setDebugSemantics({
        targetNotes: [],
        assessmentExplanations: [],
        phraseSummaries: [],
        strengths: [],
        weaknesses: [],
        recommendation: null,
      });
      pitchEdit.setPitchPatch({});
      setError(output.error);
      setRelaxationNotice("");
      setLogs(output.logs);
      return false;
    }

    const nextSpecSnapshot = normalizeUserConstraintsInSpec(specForRun);
    setMusicXml(output.musicXml);
    setCurrentMelody(extractMelodyEvents(output.artifact));
    setDebugSemantics(
      output.artifact.debugSemantics ?? {
        targetNotes: [],
        assessmentExplanations: [],
        phraseSummaries: [],
        strengths: [],
        weaknesses: [],
        recommendation: null,
      },
    );
    setCurrentSpecSnapshot(nextSpecSnapshot);
    setCurrentBeatsPerMeasure(
      Math.max(1, Number(specForRun.timeSig.split("/")[0]) || 4),
    );
    if (isGuestMode) {
      setSpec(specForRun);
    }
    pitchEdit.setPitchPatch({});
    setLogs(output.logs);
    setError(null);
    setRelaxationNotice(relaxationMessage(output.relaxationTier));
    pitchEdit.setSelectionIndex(0);
    pitchEdit.setSelectedNoteId(null);
    pitchEdit.setEditMessage("");
    return true;
  };

  const prepareAndValidateSpecForGeneration = (): ExerciseSpec | null => {
    const specForRun = isGuestMode ? toGuestSpec(spec) : spec;
    const noteValuesError = validateAllowedNoteValues(specForRun);
    if (noteValuesError) {
      setError(noteValuesError);
      setMusicXml("");
      return null;
    }
    return specForRun;
  };

  const runWithNewSeed = () => {
    if (mode === "student" && student.studentSession?.token) {
      student.markActivity("generate");
      void student.trackProgress({ event_type: "attempt", exercise_id: null });
    }

    const specForRun = prepareAndValidateSpecForGeneration();
    if (!specForRun) {
      return;
    }

    const nextSeed = randomSeed();
    setSeed(nextSeed);
    teacher.setActiveExerciseId?.(null);
    applyGenerationOutput(
      generateExercise({ spec: specForRun, seed: nextSeed }),
      specForRun,
    );
  };

  const rerunWithCurrentSeed = () => {
    const specForRun = prepareAndValidateSpecForGeneration();
    if (!specForRun) {
      return;
    }

    teacher.setActiveExerciseId?.(null);
    applyGenerationOutput(
      generateExercise({ spec: specForRun, seed }),
      specForRun,
    );
  };

  return {
    rerunWithCurrentSeed,
    runWithNewSeed,
  };
}

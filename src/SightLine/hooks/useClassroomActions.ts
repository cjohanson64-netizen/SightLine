import { normalizeUserConstraintsInSpec } from "../core/spec";
import { usePitchEdit } from "./usePitchEdit";
import { useStudentSession } from "./useStudentSession";
import { StudentSubmissionItem } from "./useTeacherLibrary";
import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";
import type {
  GeneratorError,
  GeneratorViewerStateControllers,
} from "./generatorViewerState";
import { loadExerciseIntoViewer } from "./generatorViewerState";

type PitchEditState = ReturnType<typeof usePitchEdit>;
type StudentState = ReturnType<typeof useStudentSession>;

interface UseClassroomActionsOptions {
  currentBeatsPerMeasure: number;
  currentPatchedMelody: MelodyEvent[];
  currentSpecSnapshot: ExerciseSpec | null;
  exportMusicXml: string;
  mode: "teacher" | "student" | "guest";
  navigate: (to: string) => void;
  pitchEdit: Pick<
    PitchEditState,
    | "setPitchEditMode"
  >;
  seed: number;
  spec: ExerciseSpec;
  student: Pick<
    StudentState,
    | "loadClassroomExercise"
    | "setStudentJoinMessage"
    | "submitToTeacher"
  >;
  viewerState: GeneratorViewerStateControllers;
}

export function useClassroomActions({
  currentBeatsPerMeasure,
  currentPatchedMelody,
  currentSpecSnapshot,
  exportMusicXml,
  mode,
  navigate,
  pitchEdit,
  seed,
  spec,
  student,
  viewerState,
}: UseClassroomActionsOptions) {
  const handleSubmitToTeacher = async () => {
    if (!exportMusicXml) {
      return;
    }

    await student.submitToTeacher({
      title: spec.title,
      seed,
      music_xml: exportMusicXml,
      spec_json: currentSpecSnapshot ?? normalizeUserConstraintsInSpec(spec),
      melody_json: currentPatchedMelody,
      beats_per_measure: currentBeatsPerMeasure,
    });
  };

  const handlePreviewSubmission = (submission: StudentSubmissionItem) => {
    if (mode !== "teacher") {
      return;
    }

    loadExerciseIntoViewer(
      {
        seed: submission.seed,
        title: submission.title,
        music_xml: submission.music_xml,
        spec_json: submission.spec_json,
        melody_json: submission.melody_json,
        beats_per_measure: submission.beats_per_measure,
      },
      viewerState,
      `Previewing submission from ${submission.student_id}.`,
    );
    pitchEdit.setPitchEditMode(false);
    navigate("/generator");
  };

  const handleLoadClassroomExercise = async (exerciseId: string) => {
    const exercise = await student.loadClassroomExercise(exerciseId);
    if (!exercise) {
      return;
    }

    loadExerciseIntoViewer(
      {
        seed: exercise.seed,
        title: exercise.title,
        music_xml: exercise.music_xml,
        spec_json: exercise.spec_json,
        melody_json: exercise.melody_json,
        beats_per_measure: exercise.beats_per_measure,
      },
      viewerState,
    );
    student.setStudentJoinMessage(`Loaded ${exercise.title}`);
  };

  return {
    handleLoadClassroomExercise,
    handlePreviewSubmission,
    handleSubmitToTeacher,
  };
}

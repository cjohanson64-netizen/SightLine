//useGeneratorActions.ts

import type { Dispatch, SetStateAction } from "react";
import { generateExercise } from "../core/engine";
import { buildPacketHtml } from "../core/packet/renderPacketHtml";
import { toMusicXmlFromMelody } from "../core/projection/toMusicXml";
import { toGuestSpec, normalizeUserConstraintsInSpec } from "../core/spec";
import { usePlayback } from "./usePlayback";
import { useSolfege } from "./useSolfege";
import { useStudentSession } from "./useStudentSession";
import {
  BatchPacketItem,
  PacketItem,
  StudentSubmissionItem,
  useTeacherLibrary,
} from "./useTeacherLibrary";
import { usePitchEdit } from "./usePitchEdit";
import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";

type PlaybackState = ReturnType<typeof usePlayback>;
type PitchEditState = ReturnType<typeof usePitchEdit>;
type SolfegeState = ReturnType<typeof useSolfege>;
type StudentState = ReturnType<typeof useStudentSession>;
type TeacherState = ReturnType<typeof useTeacherLibrary>;

interface GeneratorError {
  title: string;
  message: string;
  suggestions: string[];
}

interface UseGeneratorActionsOptions {
  applyPitchPatch: (
    melody: MelodyEvent[],
    patch: Record<string, { midi: number; pitch: string }>,
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

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
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
  solfege,
  spec,
  student,
  teacher,
  validateAllowedNoteValues,
}: UseGeneratorActionsOptions) {
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
      pitchEdit.setPitchPatch({});
      setError(output.error);
      setRelaxationNotice("");
      setLogs(output.logs);
      return false;
    }
    const nextSpecSnapshot = normalizeUserConstraintsInSpec(specForRun);
    setMusicXml(output.musicXml);
    setCurrentMelody(extractMelodyEvents(output.artifact));
    setCurrentSpecSnapshot(nextSpecSnapshot);
    setCurrentBeatsPerMeasure(
      Math.max(1, Number(specForRun.timeSig.split("/")[0]) || 4),
    );
    if (isGuestMode) setSpec(specForRun);
    pitchEdit.setPitchPatch({});
    setLogs(output.logs);
    setError(null);
    setRelaxationNotice(relaxationMessage(output.relaxationTier));
    pitchEdit.setSelectionIndex(0);
    pitchEdit.setSelectedNoteId(null);
    pitchEdit.setEditMessage("");
    return true;
  };

  const runWithNewSeed = () => {
    if (mode === "student" && student.studentSession?.token) {
      student.markActivity("generate");
      void student.trackProgress({ event_type: "attempt", exercise_id: null });
    }
    const specForRun = isGuestMode ? toGuestSpec(spec) : spec;
    const noteValuesError = validateAllowedNoteValues(specForRun);
    if (noteValuesError) {
      setError(noteValuesError);
      setMusicXml("");
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
    const specForRun = isGuestMode ? toGuestSpec(spec) : spec;
    const noteValuesError = validateAllowedNoteValues(specForRun);
    if (noteValuesError) {
      setError(noteValuesError);
      setMusicXml("");
      return;
    }
    teacher.setActiveExerciseId?.(null);
    applyGenerationOutput(generateExercise({ spec: specForRun, seed }), specForRun);
  };

  const loadExerciseIntoViewer = (
    saved: {
      id?: string | null;
      seed: number;
      title: string;
      music_xml: string;
      spec_json?: ExerciseSpec | null;
      melody_json?: MelodyEvent[] | null;
      beats_per_measure?: number | null;
      folder_id?: string | null;
    },
    editMessageText?: string,
  ) => {
    playback.stop();
    setMusicXml(saved.music_xml);
    setSeed(saved.seed);
    setSpec((prev) => ({ ...prev, title: saved.title }));
    setCurrentSpecSnapshot(saved.spec_json ?? null);
    setCurrentMelody(saved.melody_json ?? []);
    setCurrentBeatsPerMeasure(
      typeof saved.beats_per_measure === "number" &&
        Number.isFinite(saved.beats_per_measure)
        ? Math.max(1, saved.beats_per_measure)
        : 4,
    );
    pitchEdit.setPitchPatch({});
    setLogs([]);
    setRelaxationNotice("");
    setError(null);
    pitchEdit.setSelectionIndex(0);
    pitchEdit.setSelectedNoteId(null);
    pitchEdit.setEditMessage(editMessageText ?? "");
    playback.setPlaybackHighlightIndex(null);
  };

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

  const handleExport = () => {
    if (!exportMusicXml) return;
    const blob = new Blob([exportMusicXml], {
      type: "application/vnd.recordare.musicxml+xml",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `exercise-${seed}.musicxml`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

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
    if (mode !== "teacher") return;
    loadExerciseIntoViewer(
      {
        seed: submission.seed,
        title: submission.title,
        music_xml: submission.music_xml,
        spec_json: submission.spec_json,
        melody_json: submission.melody_json,
        beats_per_measure: submission.beats_per_measure,
      },
      `Previewing submission from ${submission.student_id}.`,
    );
    pitchEdit.setPitchEditMode(false);
    navigate("/generator");
  };

  const handleLoadSavedExercise = async (id: string) => {
    const saved = await teacher.loadSavedExercise(id);
    if (!saved) return;
    loadExerciseIntoViewer(saved);
    const hasInteractiveData =
      saved.spec_json !== null &&
      Array.isArray(saved.melody_json) &&
      saved.melody_json.length > 0;
    if (!hasInteractiveData) {
      setCurrentSpecSnapshot(null);
      setCurrentMelody([]);
    }
  };

  const handleLoadClassroomExercise = async (exerciseId: string) => {
    const exercise = await student.loadClassroomExercise(exerciseId);
    if (!exercise) return;
    loadExerciseIntoViewer({
      seed: exercise.seed,
      title: exercise.title,
      music_xml: exercise.music_xml,
      spec_json: exercise.spec_json,
      melody_json: exercise.melody_json,
      beats_per_measure: exercise.beats_per_measure,
    });
    student.setStudentJoinMessage(`Loaded ${exercise.title}`);
  };

  const openBatchPacketWindow = (
    items: BatchPacketItem[],
    packetMeta: {
      packetId: string | null;
      title: string;
      className: string;
      notes: string;
      generatedAt: string;
      generatedAtIso: string;
    },
    options?: { autoExportZip?: boolean },
  ) => {
    if (items.length === 0) return;
    const html = buildPacketHtml(items, packetMeta, options, {
      transformMusicXml: (musicXml) =>
        solfege.addSolfegeLyricsToMusicXml(musicXml, {
          solfegeMode: solfege.solfegeMode,
          accidentalMode: solfege.solfegeAccidentalMode,
          colorizeLyrics: solfege.solfegeColorizeMode !== "off",
          fallback: {
            key: currentSpecSnapshot?.key ?? spec.key,
            mode: currentSpecSnapshot?.mode ?? spec.mode,
          },
        }),
    });
    const packetWindow = window.open("", "_blank");
    packetWindow?.document.open();
    packetWindow?.document.write(html);
    packetWindow?.document.close();
  };

  const handleBatchGenerate = async () => {
    const result = await teacher.batchGenerate(spec);
    if (!result) return;
    const generatedAtIso = new Date().toISOString();
    openBatchPacketWindow(result.items, {
      packetId: result.packetId,
      title: result.packetTitle,
      className: teacher.folderNameById.get(teacher.batchFolderId) ?? "Class",
      notes: result.packetNotes,
      generatedAt: formatSavedDate(generatedAtIso),
      generatedAtIso,
    });
  };

  const handleOpenSavedPacket = async (packet: PacketItem) => {
    const items = await teacher.fetchPacketRenderItems(packet.id);
    if (!items || items.length === 0) return;
    openBatchPacketWindow(items, {
      packetId: packet.id,
      title: packet.title,
      className: teacher.folderNameById.get(packet.folder_id) ?? "Class",
      notes: packet.notes ?? "",
      generatedAt: formatSavedDate(packet.created_at),
      generatedAtIso: packet.created_at,
    });
  };

  const handleExportSavedPacketZip = async (packet: PacketItem) => {
    const items = await teacher.fetchPacketRenderItems(packet.id);
    if (!items || items.length === 0) return;
    openBatchPacketWindow(
      items,
      {
        packetId: packet.id,
        title: packet.title,
        className: teacher.folderNameById.get(packet.folder_id) ?? "Class",
        notes: packet.notes ?? "",
        generatedAt: formatSavedDate(packet.created_at),
        generatedAtIso: packet.created_at,
      },
      { autoExportZip: true },
    );
  };

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

//GeneratorPage.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";
import GeneratorNotationControls from "../components/GeneratorNotationControls";
import GeneratorStudentSidebar from "../components/GeneratorStudentSidebar";
import GeneratorTeacherSidebar from "../components/GeneratorTeacherSidebar";
import GeneratorToolbar from "../components/GeneratorToolbar";
import NotationViewer from "../components/NotationViewer/NotationViewer";
import ErrorBanner from "../components/ErrorBanner/ErrorBanner";
import { usePlayback } from "../hooks/usePlayback";
import { useProjection } from "../hooks/useProjection";
import { useAssessmentRecorder } from "../hooks/useAssessmentRecorder";
import { useSolfege } from "../hooks/useSolfege";
import { useStudentSession } from "../hooks/useStudentSession";
import { useTeacherLibrary } from "../hooks/useTeacherLibrary";
import { normalizeUserConstraintsInSpec } from "../core/spec";
import {
  runAssessment,
  type AssessmentPitchStatus,
  type AssessmentResult,
  type AssessmentScore,
} from "../core/assessment";
import {
  toPcmAudioBuffer,
  type RecordedAudioBuffer,
} from "../core/assessment/intake/audioAdapter";
import { KEY_TO_PC, midiToFrequency } from "../core/midi";

type PlaybackState = ReturnType<typeof usePlayback>;
type ProjectionState = ReturnType<typeof useProjection>;
type SolfegeState = ReturnType<typeof useSolfege>;
type StudentState = ReturnType<typeof useStudentSession>;
type TeacherState = ReturnType<typeof useTeacherLibrary>;
type AssessmentStatus =
  | "idle"
  | "recording"
  | "processing"
  | "complete"
  | "error";
type RhythmMarker = "match" | "close" | "mismatch" | "missing";

const NOTE_FEEDBACK_COLORS = {
  correct: "#1ecf87",
  close: "#ffd54a",
  partial: "#ff9f43",
  incorrect: "#e25555",
  missing: "#8a98aa",
  unassessable: "#8a98aa",
} satisfies Record<AssessmentPitchStatus, string>;

const ASSESSMENT_SCALE_OFFSETS = [0, 2, 4, 5, 7, 5, 4, 2, 0];

function getRenderableAttackEventIndices(melody: MelodyEvent[]): number[] {
  const indices: number[] = [];

  for (let index = 0; index < melody.length; index += 1) {
    if (melody[index].isAttack !== false) {
      indices.push(index);
    }
  }

  return indices;
}

function mapAssessmentNoteResultsToNoteColors(params: {
  noteResults: AssessmentResult["ui"]["noteResults"];
  melody: MelodyEvent[];
}): Record<number, string | undefined> {
  const { noteResults, melody } = params;
  const colorsByIndex: Record<number, string | undefined> = {};
  const attackEventIndices = getRenderableAttackEventIndices(melody);

  for (const noteResult of noteResults) {
    const eventIndex = attackEventIndices[noteResult.noteIndex];

    if (eventIndex === undefined) {
      continue;
    }

    colorsByIndex[eventIndex] = NOTE_FEEDBACK_COLORS[noteResult.pitchStatus];
  }

  return colorsByIndex;
}

function buildRhythmMarkerMapFromAssessment(
  result: AssessmentResult | null,
): Record<number, RhythmMarker | undefined> {
  if (!result) {
    return {};
  }

  const markersByIndex: Record<number, RhythmMarker | undefined> = {};

  for (const noteResult of result.ui.noteResults) {
    markersByIndex[noteResult.noteIndex] = noteResult.rhythmStatus;
  }

  return markersByIndex;
}

function formatScorePercent(value: number): string {
  return `${Math.round(value)}%`;
}

function formatScoreValue(value: number): string {
  return `${Math.round(value)}%`;
}

function getWrittenTonicMidi(params: {
  spec: ExerciseSpec;
  melody: MelodyEvent[];
}): number {
  const keyPitchClass = KEY_TO_PC[params.spec.key] ?? 0;
  const firstAttack = params.melody.find((event) => event.isAttack !== false);
  const referenceMidi = firstAttack?.midi ?? 60;
  const referenceOctaveBase = Math.floor(referenceMidi / 12) * 12;
  const candidates = [
    referenceOctaveBase + keyPitchClass - 12,
    referenceOctaveBase + keyPitchClass,
    referenceOctaveBase + keyPitchClass + 12,
  ];

  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - referenceMidi) < Math.abs(best - referenceMidi)
      ? candidate
      : best,
  );
}

function AssessmentAlignmentDebugPanel({
  result,
}: {
  result: AssessmentResult | null;
}): JSX.Element | null {
  if (!result) {
    return null;
  }

  const missingExpectedSlots = result.sung.alignment.alignedNotes
    .filter((note) => note.alignmentStatus === "missing")
    .map((note) => note.expectedNoteIndex);
  const alignedNoteCount = result.sung.alignment.alignedNotes.filter((note) => {
    return note.alignmentStatus === "matched";
  }).length;
  const extraAfterAlignment = result.sung.alignment.extraNotes.length;

  return (
    <section
      className="AppAssessmentDebugPanel"
      aria-label="Assessment alignment debug"
    >
      <div className="AppAssessmentDebugHeader">
        <div>
          <span className="AppAssessmentDebugEyebrow">Assessment Debug</span>
          <h3>Structural Note Alignment</h3>
        </div>
        <div className="AppAssessmentDebugCounts">
          <span>Expected: {result.sung.noteCount.expectedCount}</span>
          <span>Detected fragments: {result.sung.noteCount.sungCount}</span>
          <span>Aligned notes: {alignedNoteCount}</span>
          <span>
            Extra after alignment:{" "}
            {extraAfterAlignment > 0 ? extraAfterAlignment : "none"}
          </span>
        </div>
      </div>

      <div className="AppAssessmentDebugScoreGrid">
        <div>
          <span>Pitch</span>
          <strong>{formatScoreValue(result.score.pitchAccuracy)}</strong>
        </div>
        <div>
          <span>Rhythm</span>
          <strong>{formatScoreValue(result.score.rhythmAccuracy)}</strong>
        </div>
        <div>
          <span>Melody</span>
          <strong>{formatScoreValue(result.score.melodyScore)}</strong>
        </div>
        <div>
          <span>Mastery</span>
          <strong>{result.score.mastery}</strong>
        </div>
        <div>
          <span>Note Count</span>
          <strong>{formatScoreValue(result.score.noteCountAccuracy)}</strong>
        </div>
        <div>
          <span>Stability</span>
          <strong>{formatScoreValue(result.score.stabilityAccuracy)}</strong>
        </div>
      </div>

      <div className="AppAssessmentDebugGrid">
        <div className="AppAssessmentDebugTableWrap">
          <h4>Note Alignment</h4>
          <table className="AppAssessmentDebugTable">
            <thead>
              <tr>
                <th>Expected Slot</th>
                <th>Sung Note</th>
                <th>Sung ID</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {result.sung.alignment.alignedNotes.map((note) => (
                <tr key={note.expectedNoteIndex}>
                  <td>{note.expectedNoteIndex}</td>
                  <td>{note.sungNote ? note.sungNote.index : "None"}</td>
                  <td>{note.sungNote ? note.sungNote.id : "None"}</td>
                  <td>{note.alignmentStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="AppAssessmentDebugSummary">
          <p>
            <strong>Missing expected slots</strong>
            <span>
              {missingExpectedSlots.length > 0
                ? missingExpectedSlots.join(", ")
                : "None"}
            </span>
          </p>
          <p>
            <strong>Extra sung notes</strong>
            <span>
              {result.sung.alignment.extraNotes.length > 0
                ? result.sung.alignment.extraNotes
                    .map((extra) => extra.sungNote.index)
                    .join(", ")
                : "None"}
            </span>
          </p>
        </div>
      </div>

      <div className="AppAssessmentDebugGrid AppAssessmentDebugGrid--wide">
        <div className="AppAssessmentDebugTableWrap">
          <h4>Intervals</h4>
          <table className="AppAssessmentDebugTable">
            <thead>
              <tr>
                <th>To Slot</th>
                <th>Expected</th>
                <th>Sung</th>
                <th>Diff</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {result.intervals.results.map((interval) => (
                <tr key={interval.index}>
                  <td>{interval.toNoteIndex}</td>
                  <td>{interval.expectedSemitones}</td>
                  <td>
                    {interval.normalizedSungSemitones !== null
                      ? interval.normalizedSungSemitones.toFixed(2)
                      : "None"}
                  </td>
                  <td>
                    {interval.intervalDifference !== null
                      ? interval.intervalDifference.toFixed(2)
                      : "None"}
                  </td>
                  <td>{interval.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="AppAssessmentDebugTableWrap">
          <h4>Rhythm</h4>
          <table className="AppAssessmentDebugTable">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Expected</th>
                <th>Sung</th>
                <th>Error</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {result.rhythm.results.map((rhythm) => (
                <tr key={rhythm.noteIndex}>
                  <td>{rhythm.noteIndex}</td>
                  <td>{rhythm.expectedBeats}</td>
                  <td>
                    {rhythm.sungBeats !== null
                      ? rhythm.sungBeats.toFixed(2)
                      : "None"}
                  </td>
                  <td>
                    {rhythm.proportionalError !== null
                      ? rhythm.proportionalError.toFixed(2)
                      : "None"}
                  </td>
                  <td>{rhythm.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function getAssessButtonLabel(params: {
  status: AssessmentStatus;
  isRecording: boolean;
  isRequestingPermission: boolean;
}): string {
  if (params.isRequestingPermission) {
    return "Requesting Mic...";
  }

  if (params.status === "processing") {
    return "Assessing...";
  }

  if (params.isRecording || params.status === "recording") {
    return "Stop + Assess";
  }

  return "Assess";
}

function scheduleAssessmentScaleTone(params: {
  audioContext: AudioContext;
  midi: number;
  startTime: number;
  durationSeconds: number;
  oscillatorType: OscillatorType;
}): void {
  const { audioContext, midi, startTime, durationSeconds, oscillatorType } =
    params;
  const endTime = startTime + Math.max(0.08, durationSeconds);
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = oscillatorType;
  oscillator.frequency.setValueAtTime(midiToFrequency(midi), startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(0.18, startTime + 0.02);
  gain.gain.setValueAtTime(0.15, Math.max(startTime + 0.03, endTime - 0.04));
  gain.gain.linearRampToValueAtTime(0.0001, endTime);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startTime);
  oscillator.stop(endTime);
}

interface GeneratorPageProps {
  currentMelody: MelodyEvent[];
  currentPatchedMelody: MelodyEvent[];
  currentSpecSnapshot: ExerciseSpec | null;
  climaxNoteIndices: number[];
  displayNotationMusicXml: string;
  error: { title: string; message: string; suggestions: string[] } | null;
  exportMusicXml: string;
  formatSavedDate: (value: string | null | undefined) => string;
  handleJoinClassroom: () => Promise<void>;
  handleLeaveClassroom: () => void;
  handleLoadClassroomExercise: (exerciseId: string) => Promise<void>;
  handleLoadSavedExercise: (id: string) => Promise<void>;
  handleNotationKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  handleSaveToSupabase: (forceInsert?: boolean) => Promise<void>;
  handleSubmitToTeacher: () => Promise<void>;
  isGuestMode: boolean;
  mode: "teacher" | "student" | "guest";
  notationContainerRef: React.RefObject<HTMLDivElement | null>;
  onExport: () => void;
  onOpenMelodyPreferences: () => void;
  pitchEditMode: boolean;
  playback: PlaybackState;
  projection: ProjectionState;
  relaxationNotice: string;
  runWithNewSeed: () => void;
  rerunWithCurrentSeed: () => void;
  saveMessage: string;
  saveStatus: "idle" | "saving" | "saved" | "error";
  setEditMessage: (value: string) => void;
  setPitchEditMode: React.Dispatch<React.SetStateAction<boolean>>;
  setSpec: React.Dispatch<React.SetStateAction<ExerciseSpec>>;
  solfege: SolfegeState;
  spec: ExerciseSpec;
  student: StudentState;
  teacher: TeacherState;
  teacherFeaturesDisabled: boolean;
  updateExerciseTitle: (value: string) => void;
  interactionDisabled: boolean;
  onAssessmentNoteColorsChange: (
    value: Record<number, string | undefined>,
  ) => void;
}

export default function GeneratorPage({
  currentMelody,
  currentPatchedMelody,
  currentSpecSnapshot,
  climaxNoteIndices,
  displayNotationMusicXml,
  error,
  exportMusicXml,
  formatSavedDate,
  handleJoinClassroom,
  handleLeaveClassroom,
  handleLoadClassroomExercise,
  handleLoadSavedExercise,
  handleNotationKeyDown,
  handleSaveToSupabase,
  handleSubmitToTeacher,
  isGuestMode,
  mode,
  notationContainerRef,
  onExport,
  onOpenMelodyPreferences,
  pitchEditMode,
  playback,
  projection,
  relaxationNotice,
  runWithNewSeed,
  rerunWithCurrentSeed,
  saveMessage,
  saveStatus,
  setEditMessage,
  setPitchEditMode,
  setSpec,
  solfege,
  spec,
  student,
  teacher,
  teacherFeaturesDisabled,
  updateExerciseTitle,
  interactionDisabled,
  onAssessmentNoteColorsChange,
}: GeneratorPageProps): JSX.Element {
  const notationSpec = currentSpecSnapshot ?? spec;
  const assessmentSourceMelody =
    currentPatchedMelody.length > 0 ? currentPatchedMelody : currentMelody;
  const assessmentTargetMelody = assessmentSourceMelody.filter(
    (note) => note.isAttack !== false,
  );
  const currentExerciseId =
    currentSpecSnapshot?.title?.trim() ||
    spec.title.trim() ||
    "generated-exercise";
  const {
    isRecording: isAssessmentRecording,
    isRequestingPermission: isAssessmentRequestingPermission,
    startRecording,
    stopRecording,
  } = useAssessmentRecorder();
  const assessmentScalePlaybackRef = useRef<{
    context: AudioContext;
    timerId: number;
  } | null>(null);
  const [assessmentResult, setAssessmentResult] =
    useState<AssessmentResult | null>(null);
  const [assessmentStatus, setAssessmentStatus] =
    useState<AssessmentStatus>("idle");
  const [isAssessmentModalOpen, setIsAssessmentModalOpen] = useState(false);
  const [isLegendOpen, setIsLegendOpen] = useState(false);

  function clearAssessmentResult() {
    setAssessmentResult(null);
    setAssessmentStatus("idle");
    onAssessmentNoteColorsChange({});
  }

  function stopAssessmentScale() {
    const playbackState = assessmentScalePlaybackRef.current;

    if (!playbackState) {
      return;
    }

    window.clearTimeout(playbackState.timerId);
    void playbackState.context.close();
    assessmentScalePlaybackRef.current = null;
  }

  function handlePlayAssessmentScale() {
    stopAssessmentScale();

    const tonicMidi = getWrittenTonicMidi({
      spec: notationSpec,
      melody: assessmentSourceMelody,
    });
    const audioContext = new AudioContext();
    const beatSeconds = 60 / Math.max(30, Math.min(240, playback.tempoBpm));
    const startTime = audioContext.currentTime + 0.05;
    let maxEndTime = startTime;

    ASSESSMENT_SCALE_OFFSETS.forEach((offset, index) => {
      const noteStart = startTime + index * beatSeconds;
      const noteDuration = beatSeconds * 0.92;

      scheduleAssessmentScaleTone({
        audioContext,
        midi: tonicMidi + offset,
        startTime: noteStart,
        durationSeconds: noteDuration,
        oscillatorType: playback.instrument,
      });

      maxEndTime = Math.max(maxEndTime, noteStart + noteDuration);
    });

    assessmentScalePlaybackRef.current = {
      context: audioContext,
      timerId: window.setTimeout(() => {
        void audioContext.close();

        if (assessmentScalePlaybackRef.current?.context === audioContext) {
          assessmentScalePlaybackRef.current = null;
        }
      }, Math.ceil((maxEndTime - audioContext.currentTime) * 1000) + 100),
    };
  }

  async function runAssessmentForAudio(recordedAudio: RecordedAudioBuffer) {
    setAssessmentStatus("processing");

    try {
      const audio = toPcmAudioBuffer(recordedAudio);
      const result = await runAssessment({
        exerciseId: currentExerciseId,
        melody: assessmentSourceMelody,
        audio,
        recordedAt: new Date().toISOString(),
      });

      setAssessmentResult(result);
      setAssessmentStatus("complete");
      onAssessmentNoteColorsChange(
        mapAssessmentNoteResultsToNoteColors({
          noteResults: result.ui.noteResults,
          melody: assessmentSourceMelody,
        }),
      );

    } catch (err) {
      setAssessmentResult(null);
      setAssessmentStatus("error");
      onAssessmentNoteColorsChange({});
      console.error("Assessment failed:", err);
    }
  }

  async function handleBeginAssessment() {
    setIsAssessmentModalOpen(false);
    stopAssessmentScale();

    if (isAssessmentRecording) {
      const pcmAudio = await stopRecording();

      if (!pcmAudio) {
        setAssessmentStatus("error");
        return;
      }

      await runAssessmentForAudio(pcmAudio);
      return;
    }

    clearAssessmentResult();
    setAssessmentStatus("recording");
    await startRecording();
  }

  function handleAssess() {
    if (isAssessmentRecording) {
      void handleBeginAssessment();
      return;
    }

    setIsAssessmentModalOpen(true);
  }

  function handleCloseAssessmentModal() {
    setIsAssessmentModalOpen(false);
    stopAssessmentScale();
  }

  function handleCloseLegend() {
    setIsLegendOpen(false);
  }

  const rhythmMarkersByIndex = useMemo(
    () => buildRhythmMarkerMapFromAssessment(assessmentResult),
    [assessmentResult],
  );
  const assessmentScore: AssessmentScore | null = useMemo(
    () => assessmentResult?.score ?? null,
    [assessmentResult],
  );
  const assessLabel = getAssessButtonLabel({
    status: assessmentStatus,
    isRecording: isAssessmentRecording,
    isRequestingPermission: isAssessmentRequestingPermission,
  });

  useEffect(() => {
    if (!isAssessmentModalOpen && !isLegendOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isAssessmentModalOpen) {
          handleCloseAssessmentModal();
        }

        if (isLegendOpen) {
          handleCloseLegend();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAssessmentModalOpen, isLegendOpen]);

  useEffect(() => () => stopAssessmentScale(), []);

  return (
    <div
      className={`AppMain ${projection.isProjectionMode ? "AppMainProjection" : ""}`}
    >
      {!projection.isProjectionMode ? (
        <>
          <div className="AppNotationToolbar">
            <GeneratorToolbar
              mode={mode}
              interactionDisabled={interactionDisabled}
              teacherFeaturesDisabled={teacherFeaturesDisabled}
              upgradeRequiredTitle="Upgrade required"
              folders={teacher.folders}
              selectedFolderId={teacher.selectedFolderId}
              onSelectFolderId={teacher.setSelectedFolderId}
              creatingFolder={teacher.creatingFolder}
              studentClassName={student.studentSession?.classroom.name ?? null}
              titleValue={spec.title}
              titlePlaceholder={
                currentMelody.length > 0 ? "Exercise title" : "SightLine Melody"
              }
              onTitleChange={updateExerciseTitle}
              onGenerate={() => {
                clearAssessmentResult();
                runWithNewSeed();
              }}
              onAssess={() => void handleAssess()}
              assessLabel={assessLabel}
              assessDisabled={
                assessmentStatus === "processing" ||
                isAssessmentRequestingPermission ||
                assessmentTargetMelody.length === 0
              }
              showUpdateSave={Boolean(teacher.activeExerciseId)}
              saveDisabled={
                mode !== "teacher" || !exportMusicXml || saveStatus === "saving"
              }
              onSaveNew={() => void handleSaveToSupabase(true)}
              onSaveUpdate={() => void handleSaveToSupabase()}
              onOpenPreferences={onOpenMelodyPreferences}
              onExportMusicXml={() => {
                if (!isGuestMode && !teacherFeaturesDisabled) {
                  onExport();
                }
              }}
              onTogglePitchEdit={() => {
                setPitchEditMode((prev) => !prev);
                setEditMessage("");
              }}
              pitchEditEnabled={pitchEditMode}
              studentSubmitLabel={
                student.studentSubmitStatus === "saving"
                  ? "Submitting..."
                  : "Submit to Teacher"
              }
              onStudentSubmit={() => void handleSubmitToTeacher()}
              studentSubmitDisabled={
                student.studentSubmitStatus === "saving" || !exportMusicXml
              }
            />
          </div>

          {isAssessmentModalOpen ? (
            <div
              className="AppModalBackdrop"
              onClick={handleCloseAssessmentModal}
              role="presentation"
            >
              <div
                className="AppModal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="assessment-start-title"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="AppModalClose"
                  onClick={handleCloseAssessmentModal}
                >
                  ×
                </button>
                <h3 id="assessment-start-title">Ready to Assess?</h3>
                <p className="AppHistoryLabel">
                  Listen to the scale, then begin when you are ready.
                </p>
                <div className="AppBatchActions">
                  <button
                    type="button"
                    className="AppHistoryButton AppProjectionToggleButton"
                    onClick={handleCloseAssessmentModal}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="AppHistoryButton AppProjectionToggleButton"
                    onClick={handlePlayAssessmentScale}
                  >
                    Play Scale
                  </button>
                  <button
                    type="button"
                    className="AppHistoryButton AppProjectionToggleButton"
                    onClick={() => void handleBeginAssessment()}
                  >
                    Begin
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {isLegendOpen ? (
            <div
              className="AppModalBackdrop"
              onClick={handleCloseLegend}
              role="presentation"
            >
              <div
                className="AppModal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="assessment-legend-title"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="AppModalClose"
                  onClick={handleCloseLegend}
                >
                  ×
                </button>
                <h3 id="assessment-legend-title">Assessment Legend</h3>
                <div className="AppAssessmentLegend">
                  <section>
                    <h4>Pitch Colors</h4>
                    <ul>
                      <li>
                        <span
                          className="AppAssessmentLegendSwatch"
                          style={{ background: NOTE_FEEDBACK_COLORS.correct }}
                        />
                        Green: Correct / nearly correct
                      </li>
                      <li>
                        <span
                          className="AppAssessmentLegendSwatch"
                          style={{ background: NOTE_FEEDBACK_COLORS.close }}
                        />
                        Yellow: Close
                      </li>
                      <li>
                        <span
                          className="AppAssessmentLegendSwatch"
                          style={{
                            background: NOTE_FEEDBACK_COLORS.partial,
                          }}
                        />
                        Orange: Partial interval
                      </li>
                      <li>
                        <span
                          className="AppAssessmentLegendSwatch"
                          style={{
                            background: NOTE_FEEDBACK_COLORS.incorrect,
                          }}
                        />
                        Red: Incorrect
                      </li>
                      <li>
                        <span
                          className="AppAssessmentLegendSwatch"
                          style={{ background: NOTE_FEEDBACK_COLORS.missing }}
                        />
                        Gray: Missing / not assessed
                      </li>
                    </ul>
                  </section>
                  <section>
                    <h4>Rhythm Markings</h4>
                    <ul>
                      <li>
                        <span className="AppAssessmentLegendMarker AppAssessmentLegendMarker--match">
                          ✓
                        </span>
                        Correct rhythm
                      </li>
                      <li>
                        <span className="AppAssessmentLegendMarker AppAssessmentLegendMarker--close">
                          ~
                        </span>
                        Close rhythm
                      </li>
                      <li>
                        <span className="AppAssessmentLegendMarker AppAssessmentLegendMarker--mismatch">
                          ×
                        </span>
                        Incorrect rhythm
                      </li>
                      <li>
                        <span className="AppAssessmentLegendMarker AppAssessmentLegendMarker--missing">
                          —
                        </span>
                        Not assessed / unreliable
                      </li>
                    </ul>
                  </section>
                </div>
                <div className="AppBatchActions">
                  <button
                    type="button"
                    className="AppHistoryButton AppProjectionToggleButton"
                    onClick={handleCloseLegend}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {teacher.foldersError ? (
            <p
              className="AppHistoryLabel"
              style={{ margin: "0.2rem 0 0.5rem" }}
            >
              {teacher.foldersError}
            </p>
          ) : null}
          {mode === "teacher" && teacher.classroomDefaultsMessage ? (
            <p
              className="AppHistoryLabel"
              style={{ margin: "0.2rem 0 0.5rem" }}
            >
              {teacher.classroomDefaultsStatus === "loading"
                ? "Updating class defaults..."
                : teacher.classroomDefaultsMessage}
            </p>
          ) : null}
          {saveStatus !== "idle" ? (
            <p
              className="AppHistoryLabel"
              style={{ margin: "0.2rem 0 0.5rem" }}
            >
              {saveStatus === "saving" ? "Saving..." : saveMessage}
            </p>
          ) : null}
          {assessmentScore ? (
            <section
              className="AppAssessmentScoreStrip"
              aria-label="Assessment scores"
            >
              <div className="AppAssessmentScoreItem AppAssessmentScoreMastery">
                <span className="AppAssessmentScoreLabel">Mastery</span>
                <strong>{assessmentScore.mastery}</strong>
              </div>
              <div className="AppAssessmentScoreItem">
                <span className="AppAssessmentScoreLabel">
                  Pitch Accuracy
                </span>
                <strong>
                  {formatScorePercent(assessmentScore.pitchAccuracy)}
                </strong>
              </div>
              <div className="AppAssessmentScoreItem">
                <span className="AppAssessmentScoreLabel">
                  Rhythm Accuracy
                </span>
                <strong>
                  {formatScorePercent(assessmentScore.rhythmAccuracy)}
                </strong>
              </div>
              <div className="AppAssessmentScoreItem">
                <span className="AppAssessmentScoreLabel">Melody Score</span>
                <strong>
                  {formatScorePercent(assessmentScore.melodyScore)}
                </strong>
              </div>
              <div className="AppAssessmentScoreItem">
                <span className="AppAssessmentScoreLabel">Note Count</span>
                <strong>
                  {formatScorePercent(assessmentScore.noteCountAccuracy)}
                </strong>
              </div>
              <div className="AppAssessmentScoreItem">
                <span className="AppAssessmentScoreLabel">Stability</span>
                <strong>
                  {formatScorePercent(assessmentScore.stabilityAccuracy)}
                </strong>
              </div>
              <div className="AppAssessmentScoreItem AppAssessmentLegendScoreItem">
                <span className="AppAssessmentScoreLabel">Guide</span>
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionToggleButton AppAssessmentLegendButton"
                  onClick={() => setIsLegendOpen(true)}
                >
                  Legend
                </button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      <div
        className={`AppTopRow ${projection.isProjectionMode ? "AppTopRowProjection" : ""}`}
      >
        <div
          className={`AppPrimaryColumn ${projection.isProjectionMode ? "AppPrimaryColumnProjection" : ""}`}
        >
          {!projection.isProjectionMode ? (
            <AssessmentAlignmentDebugPanel result={assessmentResult} />
          ) : null}

          <div
            ref={notationContainerRef as React.RefObject<HTMLDivElement>}
            className={`AppNotationPane ${projection.isProjectionMode ? "AppNotationPaneProjection" : ""}`}
            onMouseMove={
              projection.isProjectionMode
                ? projection.handleMouseMove
                : undefined
            }
          >
            {!projection.isProjectionMode && error ? (
              <ErrorBanner
                title={error.title}
                message={error.message}
                suggestions={error.suggestions}
              />
            ) : null}
            {!projection.isProjectionMode && relaxationNotice ? (
              <p className="AppRelaxationNotice">{relaxationNotice}</p>
            ) : null}

            <NotationViewer
              musicXml={displayNotationMusicXml}
              timeSig={notationSpec.timeSig}
              phraseLengthMeasures={notationSpec.phraseLengthMeasures}
              climaxNoteIndices={climaxNoteIndices}
              showClimaxMarkers={false}
              zoom={projection.isProjectionMode ? 2.5 : 1}
              projectionMode={projection.isProjectionMode}
              solfegeActive={solfege.solfegeMode !== "off"}
              solfegeColorizeLyrics={solfege.solfegeColorizeMode !== "off"}
              rhythmMarkersByIndex={rhythmMarkersByIndex}
              solfegeOverlayNoteheads={
                solfege.solfegeMode !== "off" && solfege.solfegeOverlayMode
              }
              enableGlowEffects={
                playback.playbackHighlightIndex !== null || pitchEditMode
              }
              onKeyDown={handleNotationKeyDown}
              focusTitle={
                pitchEditMode
                  ? "Pitch edit is on. Click to focus and use arrows."
                  : "Pitch edit is off."
              }
              headerControls={
                <div className="AppHistoryControls">
                  <div className="AppHistoryNav">
                    {!projection.isProjectionMode ? (
                      <div />
                    ) : (
                      <div
                        className={`AppProjectionHeaderRow ${projection.showProjectionControls ? "" : "AppProjectionControlsHidden"}`}
                      >
                        <span className="AppProjectionTitle">{spec.title}</span>
                        <button
                          type="button"
                          className="AppHistoryButton AppProjectionToggleButton AppProjectionExitButton"
                          onClick={() => void projection.toggle()}
                          title="Exit projection mode"
                          disabled={interactionDisabled}
                        >
                          Exit Projection
                        </button>
                      </div>
                    )}
                  </div>
                  {!projection.isProjectionMode ? (
                    <GeneratorNotationControls
                      currentMelodyCount={currentMelody.length}
                      exportMusicXml={exportMusicXml}
                      interactionDisabled={interactionDisabled}
                      isGuestMode={isGuestMode}
                      onExport={onExport}
                      pitchEditMode={pitchEditMode}
                      playback={playback}
                      projection={projection}
                      setEditMessage={setEditMessage}
                      setPitchEditMode={setPitchEditMode}
                      solfege={solfege}
                      teacherFeaturesDisabled={teacherFeaturesDisabled}
                    />
                  ) : null}
                </div>
              }
            />

            {projection.isProjectionMode ? (
              <div
                className={`AppProjectionFloatingControls ${projection.showProjectionControls ? "" : "AppProjectionControlsHidden"}`}
              >
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionActionButton"
                  onClick={runWithNewSeed}
                  disabled={interactionDisabled}
                >
                  Generate Melody
                </button>
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionActionButton"
                  onClick={() => playback.play()}
                  disabled={currentMelody.length === 0}
                  data-allow-while-playing="true"
                >
                  {playback.isPlaying ? "Stop" : "Play"}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {!projection.isProjectionMode ? (
          <aside className="AppMelodyPanel">
            {mode !== "teacher" ? (
              <GeneratorStudentSidebar
                formatSavedDate={formatSavedDate}
                handleJoinClassroom={handleJoinClassroom}
                handleLeaveClassroom={handleLeaveClassroom}
                handleLoadClassroomExercise={handleLoadClassroomExercise}
                interactionDisabled={interactionDisabled}
                normalizeSpec={normalizeUserConstraintsInSpec}
                setSpec={setSpec}
                spec={spec}
                student={student}
              />
            ) : null}

            {mode === "teacher" ? (
              <GeneratorTeacherSidebar
                formatSavedDate={formatSavedDate}
                handleLoadSavedExercise={handleLoadSavedExercise}
                interactionDisabled={interactionDisabled}
                teacher={teacher}
                teacherFeaturesDisabled={teacherFeaturesDisabled}
              />
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

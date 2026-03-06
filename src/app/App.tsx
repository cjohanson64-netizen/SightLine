import { useEffect, useMemo, useRef, useState } from "react";
import type {
  FormEvent as ReactFormEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import Logo from "../assets/TAT Logo.svg";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import ExerciseForm from "../components/ExerciseForm/ExerciseForm";
import NotationViewer from "../components/NotationViewer/NotationViewer";
import StudentJoinForm from "../components/StudentJoinForm/StudentJoinForm";
import ErrorBanner from "../components/ErrorBanner/ErrorBanner";
import AppNavbar from "../components/AppNavbar";

import { generateExercise } from "../core/engine";
import { buildPacketHtml } from "../core/packet/renderPacketHtml";
import { toMusicXmlFromMelody } from "../core/projection/toMusicXml";
import {
  defaultSpec,
  normalizeUserConstraintsInSpec,
  toGuestSpec,
} from "../core/spec";
import type { ExerciseSpec, MelodyEvent } from "../tat";
import "../styles/App.css";

import { useAuth } from "../hooks/useAuth";
import { usePlayback } from "../hooks/usePlayback";
import { useProjection } from "../hooks/useProjection";
import { useSolfege } from "../hooks/useSolfege";
import { useStudentSession } from "../hooks/useStudentSession";
import { useTeacherLibrary } from "../hooks/useTeacherLibrary";
import { usePitchEdit } from "../hooks/usePitchEdit";
import type {
  BatchPacketItem,
  PacketItem,
  SavedExerciseItem,
  StudentSubmissionItem,
} from "../hooks/useTeacherLibrary";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface PitchPatchEntry {
  midi: number;
  pitch: string;
}

interface AttackView {
  event: MelodyEvent;
  midi: number;
  noteId: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (kept local because they depend on domain types)
// ---------------------------------------------------------------------------

const KEY_TO_PC: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

const SHARP_NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
const FLAT_NOTE_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];

function modeScale(mode: ExerciseSpec["mode"]): number[] {
  return mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
}
function midiToPc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}
function toOctave(midi: number): number {
  return Math.floor(midi / 12) - 1;
}
function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
function midiToDegree(midi: number, keyScale: number[]): number {
  const idx = keyScale.indexOf(midiToPc(midi));
  return idx === -1 ? 1 : idx + 1;
}

function prefersFlatsForKey(
  key: ExerciseSpec["key"],
  mode: ExerciseSpec["mode"],
): boolean {
  const majorFifths: Record<string, number> = {
    C: 0,
    G: 1,
    D: 2,
    A: 3,
    E: 4,
    B: 5,
    "F#": 6,
    "C#": 7,
    F: -1,
    Bb: -2,
    Eb: -3,
    Ab: -4,
    Db: -5,
    Gb: -6,
  };
  const minorFifths: Record<string, number> = {
    A: 0,
    E: 1,
    B: 2,
    "F#": 3,
    "C#": 4,
    "G#": 5,
    "D#": 6,
    D: -1,
    G: -2,
    C: -3,
    F: -4,
    Bb: -5,
    Eb: -6,
    Ab: -7,
  };
  const fifths = mode === "major" ? majorFifths[key] : minorFifths[key];
  return typeof fifths === "number" ? fifths < 0 : false;
}

function midiToPitch(
  midi: number,
  options?: { preferFlats?: boolean },
): string {
  const names = options?.preferFlats ? FLAT_NOTE_NAMES : SHARP_NOTE_NAMES;
  return `${names[midiToPc(midi)]}${toOctave(midi)}`;
}

function noteKey(event: MelodyEvent, index: number): string {
  const onset = Number((event.onsetBeat ?? event.beat).toFixed(3));
  return `${event.measure}:${onset}:${event.chordId}:${index}`;
}

function applyPitchPatch(
  melody: MelodyEvent[],
  patch: Record<string, PitchPatchEntry>,
): MelodyEvent[] {
  return melody.map((event, index) => {
    if (event.isAttack === false) return event;
    const override = patch[noteKey(event, index)];
    if (!override) return event;
    return {
      ...event,
      midi: override.midi,
      pitch: override.pitch,
      octave: toOctave(override.midi),
      isEdited: true,
    };
  });
}

function nextScaleStepMidi(
  currentMidi: number,
  direction: 1 | -1,
  keyScale: number[],
): number | null {
  for (
    let midi = currentMidi + direction;
    midi >= 0 && midi <= 127;
    midi += direction
  ) {
    if (keyScale.includes(midiToPc(midi))) return midi;
  }
  return null;
}

function allPcCandidatesInRange(
  pc: number,
  minMidi: number,
  maxMidi: number,
): number[] {
  const result: number[] = [];
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    if (midiToPc(midi) === pc) result.push(midi);
  }
  return result;
}

function tessituraRange(specInput: ExerciseSpec): {
  minMidi: number;
  maxMidi: number;
} {
  const tonicPc = KEY_TO_PC[specInput.key] ?? 0;
  const scale = modeScale(specInput.mode).map((step) => (tonicPc + step) % 12);
  const lowPc = scale[(specInput.range.lowDegree - 1 + 700) % 7] ?? tonicPc;
  const highPc = scale[(specInput.range.highDegree - 1 + 700) % 7] ?? tonicPc;
  const lowMidi = (specInput.range.lowOctave + 1) * 12 + lowPc;
  const highMidi = (specInput.range.highOctave + 1) * 12 + highPc;
  return {
    minMidi: Math.min(lowMidi, highMidi),
    maxMidi: Math.max(lowMidi, highMidi),
  };
}

function isIllegalTransition(
  prevDegree: number,
  currDegree: number,
  transitions: ExerciseSpec["illegalTransitions"],
): boolean {
  return transitions.some(
    (r) => r.mode === "adjacent" && r.a === prevDegree && r.b === currDegree,
  );
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

function formatSavedDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

const extractMelodyEvents = (artifact: {
  nodes: Array<{ kind: string; data: unknown }>;
}): MelodyEvent[] =>
  artifact.nodes
    .filter((n) => n.kind === "leaf")
    .map((n) => n.data as Partial<MelodyEvent>)
    .filter(
      (d): d is MelodyEvent =>
        typeof d.midi === "number" &&
        typeof d.measure === "number" &&
        typeof d.duration === "string",
    )
    .sort(
      (a, b) =>
        a.measure - b.measure ||
        (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat),
    );

// ---------------------------------------------------------------------------
// AppContent
// ---------------------------------------------------------------------------

function AppContent(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();

  // ── Hooks ──────────────────────────────────────────────────────────────────
  const auth = useAuth();
  const solfege = useSolfege();
  const student = useStudentSession();

  const mode: "teacher" | "student" | "guest" = useMemo(() => {
    if (student.studentSession) return "student";
    if (auth.authUser) return "teacher";
    return "guest";
  }, [student.studentSession, auth.authUser]);

  const isGuestMode = mode === "guest";

  const teacher = useTeacherLibrary({
    authUserId: auth.authUser?.id ?? null,
    mode,
    normalizeSpec: normalizeUserConstraintsInSpec,
    extractMelodyEvents,
  });

  // ── Local UI state ────────────────────────────────────────────────────────
  const [spec, setSpec] = useState<ExerciseSpec>(defaultSpec);
  const [seed, setSeed] = useState<number>(20260219);
  const [musicXml, setMusicXml] = useState<string>("");
  const [currentMelody, setCurrentMelody] = useState<MelodyEvent[]>([]);
  const [currentBeatsPerMeasure, setCurrentBeatsPerMeasure] =
    useState<number>(4);
  const [currentSpecSnapshot, setCurrentSpecSnapshot] =
    useState<ExerciseSpec | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<{
    title: string;
    message: string;
    suggestions: string[];
  } | null>(null);
  const [relaxationNotice, setRelaxationNotice] = useState<string>("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [showInstructions, setShowInstructions] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveMessage, setSaveMessage] = useState<string>("");
  const [showAuthChoiceModal, setShowAuthChoiceModal] =
    useState<boolean>(false);
  const [showStudentSignInModal, setShowStudentSignInModal] =
    useState<boolean>(false);
  const [showMelodyPreferencesModal, setShowMelodyPreferencesModal] =
    useState<boolean>(false);
  const [showClassroomAccessModal, setShowClassroomAccessModal] =
    useState<boolean>(false);
  const [showAddStudentsModal, setShowAddStudentsModal] =
    useState<boolean>(false);
  const [showBatchModal, setShowBatchModal] = useState<boolean>(false);
  const [billingNotice, setBillingNotice] = useState<string>("");

  // ── Refs ──────────────────────────────────────────────────────────────────
  const notationContainerRef = useRef<HTMLDivElement | null>(null);

  // ── Sub-hooks (depend on local state) ─────────────────────────────────────
  const {
    pitchEditMode,
    setPitchEditMode,
    selectionIndex,
    setSelectionIndex,
    selectedNoteId,
    setSelectedNoteId,
    editMessage,
    setEditMessage,
    pitchPatch,
    setPitchPatch,
    renderableAttacks,
    handleNotationKeyDown,
  } = usePitchEdit({
    currentMelody,
    currentSpecSnapshot,
    mode,
    markActivity: student.markActivity,
  });
  const playback = usePlayback(
    currentMelody,
    pitchPatch,
    noteKey,
    currentBeatsPerMeasure,
  );
  const projection = useProjection(notationContainerRef);

  // ── Derived melody state ──────────────────────────────────────────────────
  const currentPatchedMelody = useMemo<MelodyEvent[]>(() => {
    if (currentMelody.length === 0) return [];
    const patched = applyPitchPatch(currentMelody, pitchPatch);
    const activeSpec = currentSpecSnapshot ?? spec;
    const preferFlats = prefersFlatsForKey(activeSpec.key, activeSpec.mode);
    return patched.map((event) =>
      event.isAttack === false
        ? event
        : { ...event, pitch: midiToPitch(event.midi, { preferFlats }) },
    );
  }, [currentMelody, pitchPatch, currentSpecSnapshot, spec]);

  const selectedAttack = renderableAttacks[selectionIndex] ?? null;

  const selectedMelodyIndex = useMemo(() => {
    if (!selectedAttack || currentMelody.length === 0) return -1;
    return currentMelody.findIndex(
      (event, i) => noteKey(event, i) === selectedAttack.noteId,
    );
  }, [currentMelody, selectedAttack]);

  const exportMusicXml = useMemo(() => {
    if (!currentSpecSnapshot || currentMelody.length === 0) return musicXml;
    return toMusicXmlFromMelody(
      currentSpecSnapshot as unknown as Record<string, unknown>,
      currentPatchedMelody,
    );
  }, [currentSpecSnapshot, currentMelody, currentPatchedMelody, musicXml]);

  const notationMusicXml = useMemo(() => {
    if (!currentSpecSnapshot || currentMelody.length === 0) return musicXml;
    return toMusicXmlFromMelody(
      currentSpecSnapshot as unknown as Record<string, unknown>,
      currentPatchedMelody,
      playback.playbackHighlightIndex !== null
        ? {
            highlightedMelodyIndex: playback.playbackHighlightIndex,
            highlightColor: "#1ecf87",
          }
        : pitchEditMode && selectedMelodyIndex >= 0
          ? {
              highlightedMelodyIndex: selectedMelodyIndex,
              highlightColor: "#ff2da6",
            }
          : undefined,
    );
  }, [
    currentSpecSnapshot,
    currentMelody,
    currentPatchedMelody,
    playback.playbackHighlightIndex,
    selectedMelodyIndex,
    pitchEditMode,
    musicXml,
  ]);

  const displayNotationMusicXml = useMemo(() => {
    return solfege.addSolfegeLyricsToMusicXml(notationMusicXml, {
      solfegeMode: solfege.solfegeMode,
      accidentalMode: solfege.solfegeAccidentalMode,
      fallback: {
        key: currentSpecSnapshot?.key ?? spec.key,
        mode: currentSpecSnapshot?.mode ?? spec.mode,
      },
    });
  }, [
    notationMusicXml,
    solfege.solfegeMode,
    solfege.solfegeAccidentalMode,
    currentSpecSnapshot,
    spec.key,
    spec.mode,
  ]);

  const selectedOriginalAttack =
    selectedMelodyIndex >= 0 && currentMelody.length > 0
      ? currentMelody[selectedMelodyIndex]
      : null;
  const selectedEditLabel =
    selectedAttack && selectedOriginalAttack
      ? selectedAttack.midi === selectedOriginalAttack.midi
        ? "Edited: no"
        : `Edited: MIDI ${selectedOriginalAttack.midi} -> ${selectedAttack.midi}`
      : "Edited: no";
  void selectedEditLabel; // used in pitch-edit UI if desired

  // ── Effects ───────────────────────────────────────────────────────────────

  // Save status auto-clear
  useEffect(() => {
    if (saveStatus !== "saved") return;
    const timerId = window.setTimeout(() => {
      setSaveStatus("idle");
      setSaveMessage("");
    }, 2500);
    return () => window.clearTimeout(timerId);
  }, [saveStatus]);

  // Instructions keyboard shortcut
  useEffect(() => {
    if (!showInstructions) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowInstructions(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showInstructions]);

  useEffect(() => {
    if (mode !== "teacher") {
      setBillingNotice("");
      return;
    }
    const params = new URLSearchParams(location.search);
    const billing = params.get("billing");
    if (billing === "success") {
      setBillingNotice("Checkout complete. Verifying subscription status...");
      void teacher.refreshSubscriptionStatus();
      return;
    }
    if (billing === "cancel") {
      setBillingNotice("Checkout canceled.");
      return;
    }
    setBillingNotice("");
  }, [mode, location.search, teacher.refreshSubscriptionStatus]);

  // Student interaction tracking
  const handleStudentInteractionClickCapture = (
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    if (mode !== "student" || !student.studentSession?.token) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) student.markActivity("button");
  };

  const handleStudentInteractionChangeCapture = (
    event: ReactFormEvent<HTMLDivElement>,
  ) => {
    if (mode !== "student" || !student.studentSession?.token) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.tagName === "INPUT" ||
      target?.tagName === "SELECT" ||
      target?.tagName === "TEXTAREA"
    ) {
      student.markActivity("change");
    }
  };

  // ── Validation ────────────────────────────────────────────────────────────
  const validateAllowedNoteValues = (
    nextSpec: ExerciseSpec,
  ): { title: string; message: string; suggestions: string[] } | null => {
    const allowed = nextSpec.userConstraints?.allowedNoteValues ?? [];
    if (allowed.length > 0 && allowed.length <= 3) return null;
    if (allowed.length === 0)
      return {
        title: "Invalid Note Values",
        message: "Choose at least one allowed note value.",
        suggestions: ["Select 1 to 3 note values from EE, Q, H, W."],
      };
    return {
      title: "Invalid Note Values",
      message: `You selected ${allowed.length} note values. Select at most 3.`,
      suggestions: ["Deselect one note value so only 1-3 remain."],
    };
  };

  // ── Generation helpers ────────────────────────────────────────────────────
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
      setPitchPatch({});
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
    setPitchPatch({});
    setLogs(output.logs);
    setError(null);
    setRelaxationNotice(relaxationMessage(output.relaxationTier));
    setSelectionIndex(0);
    setSelectedNoteId(null);
    setEditMessage("");
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
    applyGenerationOutput(
      generateExercise({ spec: specForRun, seed }),
      specForRun,
    );
  };

  // ── Load helpers (shared between teacher and student) ─────────────────────
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
    setPitchPatch({});
    setLogs([]);
    setRelaxationNotice("");
    setError(null);
    setSelectionIndex(0);
    setSelectedNoteId(null);
    setEditMessage(editMessageText ?? "");
    playback.setPlaybackHighlightIndex(null);
  };

  // ── Save handler ──────────────────────────────────────────────────────────
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
          ? applyPitchPatch(currentMelody, pitchPatch)
          : [];
      const specToSave =
        currentSpecSnapshot ?? normalizeUserConstraintsInSpec(spec);
      const result = await teacher.saveToSupabase({
        forceInsert,
        seed,
        title: spec.title,
        musicXml: exportMusicXml,
        currentMelody: patchedMelody,
        pitchPatch: pitchPatch as unknown as Record<string, unknown>,
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

  // ── Export ────────────────────────────────────────────────────────────────
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

  // ── Exercise title ────────────────────────────────────────────────────────
  const updateExerciseTitle = (nextTitleRaw: string) => {
    setSpec((prev) => ({ ...prev, title: nextTitleRaw }));
    setCurrentSpecSnapshot((prev) =>
      prev ? { ...prev, title: nextTitleRaw } : prev,
    );
  };

  // ── Auth handlers ─────────────────────────────────────────────────────────
  const handleAuthClick = async () => {
    auth.authMessage && void 0; // just reading
    if (auth.authUser) {
      await auth.signOut();
      return;
    }
    setShowAuthChoiceModal(true);
  };

  const handleTeacherSignIn = async () => {
    setShowAuthChoiceModal(false);
    await auth.signInWithGoogle();
  };

  const handleStudentSignIn = () => {
    setShowAuthChoiceModal(false);
    setShowStudentSignInModal(true);
    if (!student.studentSession)
      student.setStudentJoinMessage(
        "Enter your classroom code, passcode, and student ID.",
      );
  };

  const handleJoinClassroom = async () => {
    const result = await student.join();
    if (result) navigate("/generator");
  };

  const handleLeaveClassroom = () => {
    student.leave();
  };

  // ── Student submission ────────────────────────────────────────────────────
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

  // ── Teacher: preview submission ───────────────────────────────────────────
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
    setPitchEditMode(false);
    navigate("/");
  };

  // ── Teacher: load saved exercise ──────────────────────────────────────────
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

  // ── Student: load classroom exercise ─────────────────────────────────────
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

  // ── Batch packet window ───────────────────────────────────────────────────
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

  // ── Batch generate ────────────────────────────────────────────────────────
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

  // ── Open saved packet ─────────────────────────────────────────────────────
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

  // ── Mode label / nav helpers ──────────────────────────────────────────────
  const modeLabel: "Teacher" | "Student" | "Guest" =
    mode === "teacher" ? "Teacher" : mode === "student" ? "Student" : "Guest";
  const navAuthLabel =
    mode === "student" || auth.authUser ? "Sign out" : "Sign In";
  const handleNavAuthClick = () => {
    if (mode === "student") {
      handleLeaveClassroom();
      return;
    }
    void handleAuthClick();
  };

  // ── Dashboard view ────────────────────────────────────────────────────────
  const dashboardView = (
    <section className="AppRoutePage">
      <h2>Dashboard</h2>
      <div className="AppDashboardGrid">
        <div className="AppDashboardCard">
          <h3>Mode</h3>
          <p className="AppHistoryLabel">{modeLabel} mode active</p>
          <p className="AppHistoryLabel">
            {auth.authUser
              ? `Signed in${auth.authUser.email ? ` as ${auth.authUser.email}` : ""}`
              : "Not signed in"}
          </p>
        </div>
        <div className="AppDashboardCard">
          <h3>Subscription</h3>
          {mode === "teacher" ? (
            <>
              <p className="AppHistoryLabel">
                Status: {teacher.hasActiveSubscription ? "Active" : "Inactive"}
              </p>
              {teacher.subscriptionCurrentPeriodEnd ? (
                <p className="AppHistoryLabel">
                  Renews: {formatSavedDate(teacher.subscriptionCurrentPeriodEnd)}
                </p>
              ) : null}
              {!teacher.hasActiveSubscription ? (
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionToggleButton"
                  onClick={() => void teacher.startCheckout()}
                  disabled={teacher.checkoutStatus === "starting" || teacher.checkoutStatus === "redirecting"}
                >
                  {teacher.checkoutStatus === "starting" ? "Starting..." : "Upgrade"}
                </button>
              ) : null}
            </>
          ) : (
            <p className="AppHistoryLabel">
              Sign in as teacher to manage billing.
            </p>
          )}
        </div>
        <div className="AppDashboardCard">
          <h3>Student Progress</h3>
          {mode === "student" ? (
            <p className="AppHistoryLabel">
              This week: {student.studentProgress.total_minutes} min,{" "}
              {student.studentProgress.total_attempts} attempts
            </p>
          ) : (
            <p className="AppHistoryLabel">
              Join a class to see student progress.
            </p>
          )}
        </div>
        <div className="AppDashboardCard">
          <h3>Teacher Summary</h3>
          {mode === "teacher" ? (
            <p className="AppHistoryLabel">
              Saved exercises: {teacher.savedExercises.length} | Class rows:{" "}
              {teacher.teacherProgressRows.length}
            </p>
          ) : (
            <p className="AppHistoryLabel">
              Sign in as teacher for class analytics.
            </p>
          )}
        </div>
      </div>
      {billingNotice ? <p className="AppHistoryLabel">{billingNotice}</p> : null}
      {mode === "teacher" && teacher.subscriptionMessage ? (
        <p className="AppHistoryLabel">{teacher.subscriptionMessage}</p>
      ) : null}
      <div className="AppDashboardActions">
        <Link className="AppHistoryButton" to="/generator">
          Open Melody Generator
        </Link>
        <Link className="AppHistoryButton" to="/class">
          Open Class Access
        </Link>
      </div>
    </section>
  );
  // ── Class access view ─────────────────────────────────────────────────────
  const classAccessView = (
    <section className="AppRoutePage">
      <h2>Class Access</h2>
      {mode === "teacher" ? (
        <>
          <div className="AppClassControls">
            <label className="AppHistoryLabel AppPlaybackField AppToolbarField">
              Class
              <select
                value={teacher.selectedFolderId}
                onChange={(e) => teacher.setSelectedFolderId(e.target.value)}
                disabled={teacher.creatingFolder}
              >
                {teacher.folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton AppClassAddStudentsButton"
              onClick={() => setShowAddStudentsModal(true)}
              disabled={!teacher.selectedFolderId}
            >
              Add Student(s)
            </button>
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton AppClassEditButton"
              onClick={() => setShowClassroomAccessModal(true)}
              disabled={!teacher.selectedFolderId}
            >
              Edit Class
            </button>
            <div className="AppToolbarNewFolder">
              <input
                className="AppExerciseTitleInput"
                type="text"
                value={teacher.newFolderName}
                onChange={(e) => teacher.setNewFolderName(e.target.value)}
                placeholder="New class name"
                disabled={teacher.creatingFolder}
              />
              <button
                type="button"
                className="AppHistoryButton AppSymbolButton"
                onClick={() => void teacher.createFolder()}
                disabled={
                  teacher.creatingFolder || !teacher.newFolderName.trim()
                }
              >
                {teacher.creatingFolder ? "..." : "+"}
              </button>
            </div>
          </div>

          <div className="AppDashboardGrid">
            {/* Roster card */}
            <div className="AppDashboardCard AppRosterCard">
              <h3>Roster</h3>
              {teacher.classroomRosterStatus === "loading" ? (
                <p className="AppHistoryLabel">Loading roster...</p>
              ) : teacher.classroomRosterStatus === "error" ? (
                <p className="AppHistoryLabel">
                  {teacher.classroomRosterError}
                </p>
              ) : teacher.sortedClassroomRoster.length === 0 ? (
                <p className="AppHistoryLabel">
                  No student IDs in this class yet.
                </p>
              ) : (
                <div className="AppRosterTableWrap">
                  <table className="AppRosterTable">
                    <thead>
                      <tr>
                        {(
                          [
                            "student_id",
                            "status",
                            "playtime",
                            "attempts",
                            "created",
                          ] as const
                        ).map((key) => (
                          <th key={key}>
                            <button
                              type="button"
                              className="AppRosterSortButton"
                              onClick={() => teacher.onRosterSort(key)}
                            >
                              {key === "student_id"
                                ? "Student ID"
                                : key === "playtime"
                                  ? "Play Time (7d)"
                                  : key === "attempts"
                                    ? "Attempts (7d)"
                                    : key.charAt(0).toUpperCase() +
                                      key.slice(1)}
                              {teacher.rosterSort.key === key
                                ? teacher.rosterSort.direction === "asc"
                                  ? " ↑"
                                  : " ↓"
                                : ""}
                            </button>
                          </th>
                        ))}
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teacher.sortedClassroomRoster.map((item) => (
                        <tr key={item.id}>
                          <td>{item.student_id}</td>
                          <td>{item.is_active ? "Active" : "Inactive"}</td>
                          <td>
                            {teacher.teacherProgressByStudentId.get(
                              item.student_id,
                            )?.total_minutes ?? 0}{" "}
                            min
                          </td>
                          <td>
                            {teacher.teacherProgressByStudentId.get(
                              item.student_id,
                            )?.total_attempts ?? 0}
                          </td>
                          <td>{formatSavedDate(item.created_at)}</td>
                          <td>
                            <div className="AppRosterRowActions">
                              <button
                                type="button"
                                className="AppHistoryButton AppProjectionToggleButton"
                                onClick={() =>
                                  void teacher.toggleRosterStudent(item)
                                }
                                disabled={teacher.rosterBusyId !== null}
                              >
                                {item.is_active ? "Deactivate" : "Activate"}
                              </button>
                              <button
                                type="button"
                                className="AppHistoryButton AppProjectionToggleButton"
                                onClick={() =>
                                  void teacher.deleteRosterStudent(item)
                                }
                                disabled={teacher.rosterBusyId !== null}
                              >
                                Remove
                              </button>
                              <button
                                type="button"
                                className="AppHistoryButton AppProjectionToggleButton"
                                onClick={() =>
                                  void teacher.copyStudentInstructions(
                                    teacher.selectedFolder?.join_code ?? "",
                                    teacher.classroomPasscode ||
                                      teacher.classroomLastPasscode,
                                    item.student_id,
                                  )
                                }
                                disabled={!teacher.selectedFolder?.join_code}
                              >
                                Copy login
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Library + Packets + Submissions */}
            <div className="AppClassAccessColumns AppRosterCard">
              <div className="AppClassAccessColumn AppClassAccessColumn--library">
                <div className="AppDashboardCard">
                  <h3>Library</h3>
                  {teacher.classLibraryExercises.length === 0 ? (
                    <p className="AppHistoryLabel">
                      No saved exercises in this class yet.
                    </p>
                  ) : (
                    <>
                      <div
                        className="AppRosterRowActions"
                        style={{ marginBottom: "0.45rem" }}
                      >
                        <button
                          type="button"
                          className="AppHistoryButton AppProjectionToggleButton"
                          onClick={teacher.handleSelectAllLibraryExercises}
                          disabled={teacher.deletingSelectedLibrary}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          className="AppHistoryButton AppProjectionToggleButton"
                          onClick={teacher.handleClearLibraryExerciseSelection}
                          disabled={teacher.deletingSelectedLibrary}
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          className="AppHistoryButton AppProjectionToggleButton"
                          onClick={() =>
                            void teacher.handleDeleteSelectedLibraryExercises()
                          }
                          disabled={
                            teacher.deletingSelectedLibrary ||
                            teacher.selectedLibraryExerciseIds.size === 0
                          }
                        >
                          {teacher.deletingSelectedLibrary
                            ? "Deleting..."
                            : "Delete Selected"}
                        </button>
                        <button
                          type="button"
                          className="AppHistoryButton AppProjectionToggleButton"
                          onClick={() =>
                            teacher.setShowCreatePacketFromSelectedModal(true)
                          }
                          disabled={
                            teacher.deletingSelectedLibrary ||
                            teacher.selectedLibraryExerciseIds.size === 0
                          }
                        >
                          Create Packet from Selected
                        </button>
                      </div>
                      <div className="AppRosterTableWrap">
                        <table className="AppRosterTable">
                          <thead>
                            <tr>
                              <th style={{ width: "3rem" }}>Pick</th>
                              <th>Title</th>
                              <th>Seed</th>
                              <th>Created</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {teacher.classLibraryExercises.map((exercise) => (
                              <tr key={exercise.id}>
                                <td>
                                  <input
                                    type="checkbox"
                                    className="AppLibraryCheckbox"
                                    checked={teacher.selectedLibraryExerciseIds.has(
                                      exercise.id,
                                    )}
                                    onChange={() =>
                                      teacher.toggleLibraryExerciseSelection(
                                        exercise.id,
                                      )
                                    }
                                  />
                                </td>
                                <td>
                                  {teacher.editingLibraryExerciseId ===
                                  exercise.id ? (
                                    <div className="AppLibraryTitleEditRow">
                                      <input
                                        className="AppLibraryTitleInput"
                                        type="text"
                                        value={teacher.editingLibraryTitle}
                                        onChange={(e) =>
                                          teacher.setEditingLibraryTitle(
                                            e.target.value,
                                          )
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            e.preventDefault();
                                            void teacher.saveLibraryTitleEdit(
                                              exercise.id,
                                            );
                                          }
                                        }}
                                      />
                                      <button
                                        type="button"
                                        className="AppHistoryButton AppSymbolButton AppSquareButton AppLibraryTitleAction"
                                        onClick={() =>
                                          void teacher.saveLibraryTitleEdit(
                                            exercise.id,
                                          )
                                        }
                                        disabled={
                                          teacher.savingLibraryTitleId ===
                                          exercise.id
                                        }
                                      >
                                        {teacher.savingLibraryTitleId ===
                                        exercise.id
                                          ? "…"
                                          : "✓"}
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="AppLibraryTitleRow">
                                      <button
                                        type="button"
                                        className="AppLibraryTitleButton"
                                        onClick={() =>
                                          void teacher.openLibraryPreview(
                                            exercise.id,
                                            exercise.title,
                                          )
                                        }
                                      >
                                        {exercise.title}
                                      </button>
                                      <button
                                        type="button"
                                        className="AppHistoryButton AppSymbolButton AppSquareButton AppLibraryTitleAction"
                                        onClick={() =>
                                          teacher.startLibraryTitleEdit(
                                            exercise,
                                          )
                                        }
                                        disabled={
                                          teacher.savingLibraryTitleId !== null
                                        }
                                      >
                                        ✎
                                      </button>
                                    </div>
                                  )}
                                </td>
                                <td>{exercise.seed}</td>
                                <td>{formatSavedDate(exercise.created_at)}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="AppHistoryButton AppProjectionToggleButton"
                                    onClick={() =>
                                      void teacher.deleteSavedExercise(
                                        exercise.id,
                                      )
                                    }
                                    disabled={
                                      teacher.deletingSavedExerciseId !==
                                        null ||
                                      teacher.loadingSavedExerciseId !== null
                                    }
                                  >
                                    {teacher.deletingSavedExerciseId ===
                                    exercise.id
                                      ? "Deleting..."
                                      : "Delete"}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  {teacher.savedExercisesError ? (
                    <p className="AppHistoryLabel">
                      {teacher.savedExercisesError}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="AppClassAccessColumn AppClassAccessColumn--stack">
                <div className="AppDashboardCard">
                  <h3>Packets</h3>
                  {teacher.classPacketsStatus === "loading" ? (
                    <p className="AppHistoryLabel">Loading packets...</p>
                  ) : teacher.classPackets.length === 0 ? (
                    <p className="AppHistoryLabel">
                      No packets created for this class yet.
                    </p>
                  ) : (
                    <div className="AppPanelButtons">
                      {teacher.classPackets.map((packet) => (
                        <div key={packet.id}>
                          <p className="AppHistoryLabel">
                            {packet.title} |{" "}
                            {formatSavedDate(packet.created_at)}
                          </p>
                          {packet.notes ? (
                            <p className="AppHistoryLabel">{packet.notes}</p>
                          ) : null}
                          <div className="AppRosterRowActions">
                            <button
                              type="button"
                              className="AppHistoryButton AppProjectionToggleButton"
                              onClick={() => void handleOpenSavedPacket(packet)}
                              disabled={
                                teacher.loadingPacketId !== null ||
                                teacher.deletingPacketId !== null
                              }
                            >
                              {teacher.loadingPacketId === packet.id
                                ? "Opening..."
                                : "Reprint"}
                            </button>
                            <button
                              type="button"
                              className="AppHistoryButton AppProjectionToggleButton"
                              onClick={() =>
                                void handleExportSavedPacketZip(packet)
                              }
                              disabled={teacher.exportingPacketId !== null}
                            >
                              {teacher.exportingPacketId === packet.id
                                ? "Exporting..."
                                : "Export MusicXML ZIP"}
                            </button>
                            <button
                              type="button"
                              className="AppHistoryButton AppProjectionToggleButton"
                              onClick={() =>
                                void teacher.deletePacket(packet.id)
                              }
                              disabled={teacher.deletingPacketId !== null}
                            >
                              {teacher.deletingPacketId === packet.id
                                ? "Deleting..."
                                : "Delete"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="AppDashboardCard">
                  <h3>Student Submissions</h3>
                  {teacher.studentSubmissionsStatus === "loading" ? (
                    <p className="AppHistoryLabel">Loading submissions...</p>
                  ) : teacher.studentSubmissions.length === 0 ? (
                    <p className="AppHistoryLabel">No pending submissions.</p>
                  ) : (
                    <div className="AppPanelButtons">
                      {teacher.studentSubmissions.map((sub) => (
                        <div key={sub.id}>
                          <p className="AppHistoryLabel">
                            {sub.title} | {formatSavedDate(sub.created_at)}
                          </p>
                          <p className="AppHistoryLabel">
                            Student ID: {sub.student_id} | Seed: {sub.seed}
                          </p>
                          <div className="AppRosterRowActions">
                            <button
                              type="button"
                              className="AppHistoryButton AppProjectionToggleButton"
                              onClick={() => handlePreviewSubmission(sub)}
                              disabled={teacher.processingSubmissionId !== null}
                            >
                              Preview
                            </button>
                            <button
                              type="button"
                              className="AppHistoryButton AppProjectionToggleButton"
                              onClick={() =>
                                void teacher.approveSubmission(sub.id)
                              }
                              disabled={teacher.processingSubmissionId !== null}
                            >
                              {teacher.processingSubmissionId === sub.id
                                ? "Adding..."
                                : "Add to Library"}
                            </button>
                            <button
                              type="button"
                              className="AppHistoryButton AppProjectionToggleButton"
                              onClick={() =>
                                void teacher.rejectSubmission(sub.id)
                              }
                              disabled={teacher.processingSubmissionId !== null}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {teacher.studentSubmissionsError ? (
                    <p className="AppHistoryLabel">
                      {teacher.studentSubmissionsError}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="AppDashboardCard">
          <p className="AppHistoryLabel">
            Students and guests use the Melody Generator to join classes and
            load assigned exercises.
          </p>
          <Link className="AppHistoryButton" to="/generator">
            Go to Melody Generator
          </Link>
        </div>
      )}
    </section>
  );

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div
      className={`AppShell ${theme === "light" ? "AppThemeLight" : "AppThemeDark"} ${projection.isProjectionMode ? "AppProjectionMode" : ""}`}
      onClickCapture={handleStudentInteractionClickCapture}
      onChangeCapture={handleStudentInteractionChangeCapture}
    >
      <AppNavbar
        modeLabel={modeLabel}
        authLabel={navAuthLabel}
        onAuthClick={handleNavAuthClick}
        isProjectionMode={projection.isProjectionMode}
        canAccessClass={mode === "teacher"}
        theme={theme}
        onThemeChange={setTheme}
      />

      {!projection.isProjectionMode && location.pathname === "/dashboard" ? (
        <div className="AppIntro">
          <div className="AppBrand">
            <img src={Logo} alt="TAT Logo" className="logo" />
            <div>
              <h1 className="AppTitle">SightLine</h1>
              <p className="AppSubtitle">Create sightreading materials in seconds.</p>
              <p className="AppSubtitle">Powered by TryAngleTree</p>
            </div>
          </div>
        </div>
      ) : null}

      {auth.authMessage && !projection.isProjectionMode ? (
        <p
          className="AppSubtitle"
          style={{ opacity: 0.9, margin: "0 0 0.75rem" }}
        >
          Auth: {auth.authMessage}
        </p>
      ) : null}

      <Routes>
        <Route path="/generator" element={<Navigate to="/" replace />} />
        <Route path="/dashboard" element={dashboardView} />

        <Route
          path="/"
          element={
            <div
              className={`AppMain ${projection.isProjectionMode ? "AppMainProjection" : ""}`}
            >
              {!projection.isProjectionMode ? (
                <>
                  <div className="AppNotationToolbar">
                    <div className="AppNotationToolbarRow AppNotationToolbarRow--top">
                      {mode !== "student" ? (
                        <label className="AppHistoryLabel AppPlaybackField AppToolbarField">
                          Class
                          <select
                            value={teacher.selectedFolderId}
                            onChange={(e) =>
                              teacher.setSelectedFolderId(e.target.value)
                            }
                            disabled={
                              mode !== "teacher" || teacher.creatingFolder
                            }
                          >
                            {teacher.folders.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>

                    <div className="AppNotationToolbarRow AppNotationToolbarRow--bottom">
                      <div className="AppNotationToolbarActions">
                        <button
                          type="button"
                          className="AppHistoryButton AppProjectionToggleButton"
                          onClick={() => setShowMelodyPreferencesModal(true)}
                        >
                          Melody Preferences
                        </button>
                        {mode !== "student" ? (
                          <>
                            <button
                              type="button"
                              className="AppHistoryButton AppProjectionToggleButton"
                              onClick={() => void handleSaveToSupabase()}
                              disabled={
                                mode !== "teacher" ||
                                !exportMusicXml ||
                                saveStatus === "saving"
                              }
                            >
                              {saveStatus === "saving" ? "..." : "Update"}
                            </button>
                            <button
                              type="button"
                              className="AppHistoryButton AppProjectionToggleButton"
                              onClick={() => void handleSaveToSupabase(true)}
                              disabled={
                                mode !== "teacher" ||
                                !exportMusicXml ||
                                saveStatus === "saving"
                              }
                            >
                              Save New
                            </button>
                            <button
                              type="button"
                              className="AppHistoryButton AppProjectionToggleButton"
                              onClick={() => {
                                teacher.openBatchModal(
                                  teacher.selectedFolderId,
                                  teacher.selectedFolder?.name ?? "Class",
                                );
                                setShowBatchModal(true);
                              }}
                              disabled={
                                mode !== "teacher" ||
                                teacher.batchStatus === "running"
                              }
                            >
                              Batch Generate
                            </button>
                            <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField">
                              Title
                              <input
                                className="AppExerciseTitleInput"
                                type="text"
                                value={spec.title}
                                onChange={(e) =>
                                  updateExerciseTitle(e.target.value)
                                }
                                placeholder="Exercise title"
                              />
                            </label>
                          </>
                        ) : null}
                        {mode === "student" ? (
                          <button
                            type="button"
                            className="AppHistoryButton AppProjectionToggleButton"
                            onClick={() => void handleSubmitToTeacher()}
                            disabled={
                              student.studentSubmitStatus === "saving" ||
                              !exportMusicXml
                            }
                          >
                            {student.studentSubmitStatus === "saving"
                              ? "Submitting..."
                              : "Submit to Teacher"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="AppHistoryButton AppSymbolButton AppSquareButton"
                          onClick={handleExport}
                          disabled={isGuestMode || !exportMusicXml}
                          title="Export MusicXML"
                        >
                          ⤓
                        </button>
                        <button
                          type="button"
                          className="AppHistoryButton AppSymbolButton AppSquareButton"
                          onClick={runWithNewSeed}
                          title="Generate Melody"
                        >
                          ⟳
                        </button>
                        <button
                          type="button"
                          className="AppHistoryButton AppSymbolButton AppSquareButton"
                          onClick={rerunWithCurrentSeed}
                          disabled={isGuestMode}
                          title="Fix Melody"
                        >
                          ↺
                        </button>
                        <button
                          type="button"
                          className="AppHistoryButton AppSymbolButton AppSquareButton"
                          onClick={() => {
                            setPitchEditMode((prev) => !prev);
                            setEditMessage("");
                          }}
                          disabled={isGuestMode || currentMelody.length === 0}
                          title={
                            pitchEditMode
                              ? "Disable pitch edit"
                              : "Enable pitch edit"
                          }
                        >
                          {pitchEditMode ? "✎✓" : "✎"}
                        </button>
                        <button
                          type="button"
                          className="AppHistoryButton AppSymbolButton AppSquareButton"
                          onClick={() => playback.play()}
                          disabled={currentMelody.length === 0}
                          title={
                            playback.isPlaying ? "Stop melody" : "Play melody"
                          }
                        >
                          {playback.isPlaying ? "■" : "▶"}
                        </button>
                      </div>

                      <div className="AppToolbarPlaybackGroup">
                        <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField">
                          Tempo
                          <input
                            type="number"
                            min={30}
                            max={240}
                            step={1}
                            value={playback.tempoBpm}
                            onChange={(e) =>
                              playback.setTempoBpm(
                                Math.max(
                                  30,
                                  Math.min(240, Number(e.target.value) || 80),
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField">
                          Instrument
                          <select
                            value={playback.instrument}
                            onChange={(e) =>
                              playback.setInstrument(
                                e.target.value as OscillatorType,
                              )
                            }
                          >
                            <option value="sine">SINE</option>
                            <option value="triangle">TRIANGLE</option>
                            <option value="square">SQUARE</option>
                            <option value="sawtooth">SAWTOOTH</option>
                          </select>
                        </label>
                        <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField">
                          Count-in (1 measure)
                          <input
                            type="checkbox"
                            className="AppLibraryCheckbox AppCountInCheckbox"
                            checked={playback.countInEnabled}
                            onChange={(e) =>
                              playback.setCountInEnabled(e.target.checked)
                            }
                          />
                        </label>
                        <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField">
                          Solfege
                          <select
                            value={solfege.solfegeMode}
                            onChange={(e) =>
                              solfege.setSolfegeMode(
                                e.target.value as "off" | "movable" | "fixed",
                              )
                            }
                          >
                            <option value="off">Off</option>
                            <option value="movable">Movable Do</option>
                            <option value="fixed">Fixed Do</option>
                          </select>
                        </label>
                        {solfege.solfegeMode !== "off" ? (
                          <>
                            <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField">
                              Accidentals
                              <select
                                value={solfege.solfegeAccidentalMode}
                                onChange={(e) =>
                                  solfege.setSolfegeAccidentalMode(
                                    e.target.value as "diatonic" | "chromatic",
                                  )
                                }
                              >
                                <option value="diatonic">Diatonic only</option>
                                <option value="chromatic">
                                  Chromatic syllables
                                </option>
                              </select>
                            </label>
                            <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField">
                              Overlay
                              <select
                                value={
                                  solfege.solfegeOverlayMode ? "on" : "off"
                                }
                                onChange={(e) =>
                                  solfege.setSolfegeOverlayMode(
                                    e.target.value === "on",
                                  )
                                }
                              >
                                <option value="off">Lyrics only</option>
                                <option value="on">Color noteheads</option>
                              </select>
                            </label>
                          </>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        className="AppHistoryButton AppSymbolButton AppSquareButton"
                        onClick={() => setShowInstructions(true)}
                        title="Instructions"
                      >
                        ?
                      </button>
                      <div className="AppToolbarRight">
                        <button
                          type="button"
                          className="AppHistoryButton AppProjectionToggleButton"
                          onClick={() => void projection.toggle()}
                          title="Projection mode"
                        >
                          Projection Mode
                        </button>
                      </div>
                    </div>
                  </div>

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
                </>
              ) : null}

              <div
                className={`AppTopRow ${projection.isProjectionMode ? "AppTopRowProjection" : ""}`}
              >
                <div
                  className={`AppPrimaryColumn ${projection.isProjectionMode ? "AppPrimaryColumnProjection" : ""}`}
                >
                  <div
                    ref={notationContainerRef}
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
                      zoom={projection.isProjectionMode ? 2.5 : 1}
                      projectionMode={projection.isProjectionMode}
                      solfegeActive={solfege.solfegeMode !== "off"}
                      solfegeOverlayNoteheads={
                        solfege.solfegeMode !== "off" &&
                        solfege.solfegeOverlayMode
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
                              <span className="AppHistoryLabel">
                                {spec.title}
                              </span>
                            ) : (
                              <div
                                className={`AppProjectionHeaderRow ${projection.showProjectionControls ? "" : "AppProjectionControlsHidden"}`}
                              >
                                <span className="AppProjectionTitle">
                                  {spec.title}
                                </span>
                                <button
                                  type="button"
                                  className="AppHistoryButton AppProjectionToggleButton AppProjectionExitButton"
                                  onClick={() => void projection.toggle()}
                                  title="Exit projection mode"
                                >
                                  Exit Projection
                                </button>
                              </div>
                            )}
                          </div>
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
                        >
                          Generate Melody
                        </button>
                        <button
                          type="button"
                          className="AppHistoryButton AppProjectionActionButton"
                          onClick={() => playback.play()}
                          disabled={currentMelody.length === 0}
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
                      <>
                        <h3>Student Mode</h3>
                        <div className="AppPanelButtons">
                          <StudentJoinForm
                            studentSession={student.studentSession}
                            studentJoinCode={student.studentJoinCode}
                            onJoinCodeChange={student.setStudentJoinCode}
                            studentPasscode={student.studentPasscode}
                            onPasscodeChange={student.setStudentPasscode}
                            studentId={student.studentId}
                            onStudentIdChange={student.setStudentId}
                            studentPin={student.studentPin}
                            onPinChange={student.setStudentPin}
                            studentDisplayName={student.studentDisplayName}
                            onDisplayNameChange={student.setStudentDisplayName}
                            studentJoinStatus={student.studentJoinStatus}
                            studentJoinMessage={student.studentJoinMessage}
                            studentProgress={student.studentProgress}
                            studentProgressStatus={
                              student.studentProgressStatus
                            }
                            studentProgressError={student.studentProgressError}
                            classroomDefaultsStatus={
                              student.classroomDefaultsStatus
                            }
                            classroomDefaultsMessage={
                              student.classroomDefaultsMessage
                            }
                            studentSpecBeforeDefaults={
                              student.studentSpecBeforeDefaults
                            }
                            onJoin={() => void handleJoinClassroom()}
                            onLeave={handleLeaveClassroom}
                            onUseTeacherSettings={() => {
                              const next = student.applyTeacherSettings(
                                spec,
                                normalizeUserConstraintsInSpec(spec),
                              );
                              if (next)
                                setSpec(normalizeUserConstraintsInSpec(next));
                            }}
                            onResetToMySettings={() => {
                              const prev = student.resetToMySettings();
                              if (prev)
                                setSpec(normalizeUserConstraintsInSpec(prev));
                            }}
                          />
                        </div>
                        <div className="AppPanelSpacer" aria-hidden="true" />
                        <h3>Classroom Library</h3>
                        <div className="AppPanelButtons AppPanelScrollableSection">
                          {!student.studentSession ? (
                            <p className="AppHistoryLabel">
                              Join a classroom to view assigned exercises.
                            </p>
                          ) : student.classroomExercisesStatus === "loading" ? (
                            <p className="AppHistoryLabel">
                              Loading classroom exercises...
                            </p>
                          ) : student.classroomExercisesStatus === "error" ? (
                            <p className="AppHistoryLabel">
                              {student.classroomExercisesError}
                            </p>
                          ) : student.classroomExercises.length === 0 ? (
                            <p className="AppHistoryLabel">
                              No classroom exercises yet.
                            </p>
                          ) : (
                            student.classroomExercises.map((exercise) => (
                              <div key={exercise.id}>
                                <p className="AppHistoryLabel">
                                  {exercise.title}
                                </p>
                                <p className="AppHistoryLabel">
                                  Seed: {exercise.seed} | Created:{" "}
                                  {formatSavedDate(exercise.created_at)}
                                </p>
                                <button
                                  type="button"
                                  className="AppHistoryButton AppProjectionToggleButton"
                                  onClick={() =>
                                    void handleLoadClassroomExercise(
                                      exercise.id,
                                    )
                                  }
                                  disabled={
                                    student.loadingClassroomExerciseId !== null
                                  }
                                >
                                  {student.loadingClassroomExerciseId ===
                                  exercise.id
                                    ? "Loading..."
                                    : "Load"}
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                        <div className="AppPanelSpacer" aria-hidden="true" />
                      </>
                    ) : null}

                    {mode === "teacher" ? (
                      <>
                        <h3>Saved Exercises</h3>
                        <div className="AppPanelButtons AppPanelScrollableSection">
                          {teacher.savedExercisesStatus === "loading" ? (
                            <p className="AppHistoryLabel">
                              Loading saved exercises...
                            </p>
                          ) : teacher.savedExercises.length === 0 ? (
                            <p className="AppHistoryLabel">
                              No saved exercises yet.
                            </p>
                          ) : (
                            <>
                              <label className="AppHistoryLabel AppPlaybackField">
                                Filter
                                <select
                                  value={teacher.folderFilterId}
                                  onChange={(e) =>
                                    teacher.setFolderFilterId(e.target.value)
                                  }
                                >
                                  <option value="__ALL__">All classes</option>
                                  {teacher.folders.map((f) => (
                                    <option key={f.id} value={f.id}>
                                      {f.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {teacher.filteredSavedExercises.length === 0 ? (
                                <p className="AppHistoryLabel">
                                  No saved exercises in this class.
                                </p>
                              ) : (
                                teacher.filteredSavedExercises.map(
                                  (exercise) => (
                                    <div key={exercise.id}>
                                      <p className="AppHistoryLabel">
                                        {exercise.title}
                                      </p>
                                      <p className="AppHistoryLabel">
                                        Seed: {exercise.seed} | Class:{" "}
                                        {exercise.folder_id
                                          ? (teacher.folderNameById.get(
                                              exercise.folder_id,
                                            ) ?? "Unknown class")
                                          : "No class"}{" "}
                                        | Created:{" "}
                                        {formatSavedDate(exercise.created_at)}
                                      </p>
                                      <div
                                        style={{
                                          display: "flex",
                                          gap: "0.45rem",
                                        }}
                                      >
                                        <button
                                          type="button"
                                          className="AppHistoryButton AppPanelButtonWide AppSymbolButton"
                                          onClick={() =>
                                            void handleLoadSavedExercise(
                                              exercise.id,
                                            )
                                          }
                                          disabled={
                                            teacher.loadingSavedExerciseId !==
                                              null ||
                                            teacher.deletingSavedExerciseId !==
                                              null
                                          }
                                        >
                                          {teacher.loadingSavedExerciseId ===
                                          exercise.id
                                            ? "Loading..."
                                            : "↥"}
                                        </button>
                                        <button
                                          type="button"
                                          className="AppHistoryButton AppPanelButtonWide AppSymbolButton"
                                          onClick={() =>
                                            void teacher.deleteSavedExercise(
                                              exercise.id,
                                            )
                                          }
                                          disabled={
                                            teacher.loadingSavedExerciseId !==
                                              null ||
                                            teacher.deletingSavedExerciseId !==
                                              null
                                          }
                                        >
                                          {teacher.deletingSavedExerciseId ===
                                          exercise.id
                                            ? "Deleting..."
                                            : "✕"}
                                        </button>
                                      </div>
                                    </div>
                                  ),
                                )
                              )}
                            </>
                          )}
                          {teacher.savedExercisesNotice ? (
                            <p
                              className="AppHistoryLabel"
                              style={{ opacity: 0.9 }}
                            >
                              {teacher.savedExercisesNotice}
                            </p>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </aside>
                ) : null}
              </div>
            </div>
          }
        />

        <Route
          path="/class"
          element={
            mode === "teacher" ? classAccessView : <Navigate to="/" replace />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* ── Auth choice modal ── */}
      {showAuthChoiceModal && !auth.authUser ? (
        <div
          className="AppModalBackdrop"
          onClick={() => setShowAuthChoiceModal(false)}
          role="presentation"
        >
          <div
            className="AppModal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="AppModalClose"
              onClick={() => setShowAuthChoiceModal(false)}
            >
              ×
            </button>
            <h3>Sign In</h3>
            <p className="AppHistoryLabel">
              Choose how you want to access SightLine.
            </p>
            <div className="AppBatchActions">
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={() => void handleTeacherSignIn()}
              >
                Teacher Sign In
              </button>
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={handleStudentSignIn}
              >
                Student Sign In
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Student sign-in modal ── */}
      {showStudentSignInModal && !auth.authUser ? (
        <div
          className="AppModalBackdrop"
          onClick={() => setShowStudentSignInModal(false)}
          role="presentation"
        >
          <div
            className="AppModal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="AppModalClose"
              onClick={() => setShowStudentSignInModal(false)}
            >
              ×
            </button>
            <h3>Student Sign In</h3>
            <div className="AppPanelButtons">
              <StudentJoinForm
                studentSession={student.studentSession}
                studentJoinCode={student.studentJoinCode}
                onJoinCodeChange={student.setStudentJoinCode}
                studentPasscode={student.studentPasscode}
                onPasscodeChange={student.setStudentPasscode}
                studentId={student.studentId}
                onStudentIdChange={student.setStudentId}
                studentPin={student.studentPin}
                onPinChange={student.setStudentPin}
                studentDisplayName={student.studentDisplayName}
                onDisplayNameChange={student.setStudentDisplayName}
                studentJoinStatus={student.studentJoinStatus}
                studentJoinMessage={student.studentJoinMessage}
                studentProgress={student.studentProgress}
                studentProgressStatus={student.studentProgressStatus}
                studentProgressError={student.studentProgressError}
                classroomDefaultsStatus={student.classroomDefaultsStatus}
                classroomDefaultsMessage={student.classroomDefaultsMessage}
                studentSpecBeforeDefaults={student.studentSpecBeforeDefaults}
                onJoin={() => void handleJoinClassroom()}
                onLeave={handleLeaveClassroom}
                onUseTeacherSettings={() => {
                  const next = student.applyTeacherSettings(
                    spec,
                    normalizeUserConstraintsInSpec(spec),
                  );
                  if (next) setSpec(normalizeUserConstraintsInSpec(next));
                }}
                onResetToMySettings={() => {
                  const prev = student.resetToMySettings();
                  if (prev) setSpec(normalizeUserConstraintsInSpec(prev));
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Classroom access modal ── */}
      {showClassroomAccessModal &&
      mode === "teacher" &&
      teacher.selectedFolder ? (
        <div
          className="AppModalBackdrop"
          onClick={() => setShowClassroomAccessModal(false)}
          role="presentation"
        >
          <div
            className="AppModal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="AppModalClose"
              onClick={() => setShowClassroomAccessModal(false)}
              disabled={teacher.classroomAccessStatus === "saving"}
            >
              ×
            </button>
            <h3>Classroom Access: {teacher.selectedFolder.name}</h3>
            <div className="AppBatchForm">
              <p className="AppHistoryLabel">
                Current class code:{" "}
                {teacher.selectedFolder.join_code ?? "Not enabled"}
              </p>
              <label className="AppHistoryLabel AppBatchCheckbox">
                <input
                  type="checkbox"
                  checked={teacher.classroomPublish}
                  onChange={(e) =>
                    teacher.setClassroomPublish(e.target.checked)
                  }
                  disabled={teacher.classroomAccessStatus === "saving"}
                />
                Publish to students
              </label>
              <label className="AppHistoryLabel">
                Class code
                <input
                  type="text"
                  value={teacher.classroomJoinCode}
                  onChange={(e) =>
                    teacher.setClassroomJoinCode(
                      e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                    )
                  }
                  placeholder="Optional custom code (4-10 chars)"
                  maxLength={10}
                  disabled={teacher.classroomAccessStatus === "saving"}
                />
              </label>
              <label className="AppHistoryLabel">
                Passcode
                <input
                  type="password"
                  value={teacher.classroomPasscode}
                  onChange={(e) => teacher.setClassroomPasscode(e.target.value)}
                  placeholder="Set/Reset passcode"
                  disabled={teacher.classroomAccessStatus === "saving"}
                />
              </label>
              <div className="AppBatchActions">
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionToggleButton"
                  onClick={() => void teacher.setClassroomAccess(false)}
                  disabled={
                    teacher.classroomAccessStatus === "saving" ||
                    !teacher.classroomPasscode.trim()
                  }
                >
                  {teacher.classroomAccessStatus === "saving"
                    ? "Updating..."
                    : "Enable / Update Classroom"}
                </button>
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionToggleButton"
                  onClick={() => void teacher.setClassroomAccess(true)}
                  disabled={
                    teacher.classroomAccessStatus === "saving" ||
                    !teacher.classroomPasscode.trim()
                  }
                >
                  Rotate Code
                </button>
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionToggleButton"
                  onClick={async () => {
                    void (await teacher.copyClassroomAccess(
                      teacher.selectedFolder?.join_code ?? "",
                      teacher.classroomPasscode ||
                        teacher.classroomLastPasscode,
                    ));
                  }}
                  disabled={!teacher.selectedFolder?.join_code}
                >
                  Copy
                </button>
              </div>
              {teacher.classroomAccessMessage ? (
                <p className="AppHistoryLabel">
                  {teacher.classroomAccessMessage}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Add students modal ── */}
      {showAddStudentsModal && mode === "teacher" && teacher.selectedFolder ? (
        <div
          className="AppModalBackdrop"
          onClick={() => setShowAddStudentsModal(false)}
          role="presentation"
        >
          <div
            className="AppModal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="AppModalClose"
              onClick={() => setShowAddStudentsModal(false)}
              disabled={teacher.rosterBusyId !== null}
            >
              ×
            </button>
            <h3>Add Student(s): {teacher.selectedFolder.name}</h3>
            <div className="AppBatchForm">
              <label className="AppHistoryLabel">
                Add Student ID
                <input
                  type="text"
                  value={teacher.newRosterStudentId}
                  onChange={(e) =>
                    teacher.setNewRosterStudentId(
                      e.target.value.toUpperCase().replace(/\s+/g, ""),
                    )
                  }
                  placeholder="Student ID"
                  disabled={teacher.rosterBusyId !== null}
                />
              </label>
              <div className="AppBatchActions">
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionToggleButton"
                  onClick={() => void teacher.addRosterStudent()}
                  disabled={
                    teacher.rosterBusyId !== null ||
                    !teacher.newRosterStudentId.trim()
                  }
                >
                  {teacher.rosterBusyId === "__add__" ? "Adding..." : "Add"}
                </button>
              </div>
              <label className="AppHistoryLabel">
                Bulk Add (one ID per line)
                <textarea
                  value={teacher.bulkRosterStudentIds}
                  onChange={(e) =>
                    teacher.setBulkRosterStudentIds(e.target.value)
                  }
                  placeholder={"S001\nS002\nS003"}
                  rows={6}
                  disabled={teacher.rosterBusyId !== null}
                />
              </label>
              <button
                type="button"
                className="AppHistoryButton AppProjectionToggleButton"
                onClick={() => void teacher.bulkAddRosterStudents()}
                disabled={
                  teacher.rosterBusyId !== null ||
                  !teacher.bulkRosterStudentIds.trim()
                }
              >
                {teacher.rosterBusyId === "__bulk__" ? "Adding..." : "Add many"}
              </button>
              {teacher.classroomRosterError ? (
                <p className="AppHistoryLabel">
                  {teacher.classroomRosterError}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Create packet from selected modal ── */}
      {teacher.showCreatePacketFromSelectedModal && mode === "teacher" ? (
        <div
          className="AppModalBackdrop"
          onClick={() => teacher.setShowCreatePacketFromSelectedModal(false)}
          role="presentation"
        >
          <div
            className="AppModal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="AppModalClose"
              onClick={() =>
                teacher.setShowCreatePacketFromSelectedModal(false)
              }
              disabled={teacher.createPacketStatus === "saving"}
            >
              ×
            </button>
            <h3>Create Packet from Selected</h3>
            <div className="AppBatchForm">
              <label className="AppHistoryLabel">
                Packet Title
                <input
                  type="text"
                  value={teacher.createPacketTitle}
                  onChange={(e) => teacher.setCreatePacketTitle(e.target.value)}
                  disabled={teacher.createPacketStatus === "saving"}
                />
              </label>
              <label className="AppHistoryLabel">
                Notes / Instructions (optional)
                <textarea
                  value={teacher.createPacketNotes}
                  onChange={(e) => teacher.setCreatePacketNotes(e.target.value)}
                  rows={3}
                  disabled={teacher.createPacketStatus === "saving"}
                />
              </label>
              <div
                className="AppPanelScrollableSection"
                style={{ maxHeight: "180px" }}
              >
                {teacher.classLibraryExercises
                  .filter((e) => teacher.selectedLibraryExerciseIds.has(e.id))
                  .map((e, i) => (
                    <p key={e.id} className="AppHistoryLabel">
                      {i + 1}. {e.title} (Seed {e.seed})
                    </p>
                  ))}
              </div>
              {teacher.createPacketMessage ? (
                <p className="AppHistoryLabel">{teacher.createPacketMessage}</p>
              ) : null}
              <div className="AppBatchActions">
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionToggleButton"
                  onClick={() => void teacher.createPacketFromSelected()}
                  disabled={teacher.createPacketStatus === "saving"}
                >
                  {teacher.createPacketStatus === "saving"
                    ? "Creating..."
                    : "Create Packet"}
                </button>
                {teacher.lastCreatedPacket ? (
                  <>
                    <button
                      type="button"
                      className="AppHistoryButton AppProjectionToggleButton"
                      onClick={() =>
                        void handleOpenSavedPacket(teacher.lastCreatedPacket!)
                      }
                      disabled={teacher.loadingPacketId !== null}
                    >
                      Open Packet
                    </button>
                    <button
                      type="button"
                      className="AppHistoryButton AppProjectionToggleButton"
                      onClick={() =>
                        void handleExportSavedPacketZip(
                          teacher.lastCreatedPacket!,
                        )
                      }
                      disabled={teacher.exportingPacketId !== null}
                    >
                      Export MusicXML ZIP
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionToggleButton"
                  onClick={() =>
                    teacher.setShowCreatePacketFromSelectedModal(false)
                  }
                  disabled={teacher.createPacketStatus === "saving"}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Library preview modal ── */}
      {teacher.showLibraryPreviewModal && mode === "teacher" ? (
        <div
          className="AppModalBackdrop"
          onClick={() => teacher.closeLibraryPreview()}
          role="presentation"
        >
          <div
            className="AppModal AppModalWide"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="AppModalClose"
              onClick={() => teacher.closeLibraryPreview()}
            >
              ×
            </button>
            <h3>Preview: {teacher.libraryPreviewTitle}</h3>
            {teacher.libraryPreviewStatus === "loading" ? (
              <p className="AppHistoryLabel">Loading preview...</p>
            ) : teacher.libraryPreviewStatus === "error" ? (
              <p className="AppHistoryLabel">{teacher.libraryPreviewMessage}</p>
            ) : (
              <NotationViewer
                musicXml={solfege.addSolfegeLyricsToMusicXml(
                  teacher.libraryPreviewMusicXml,
                  {
                    solfegeMode: solfege.solfegeMode,
                    accidentalMode: solfege.solfegeAccidentalMode,
                    fallback: {
                      key: currentSpecSnapshot?.key ?? spec.key,
                      mode: currentSpecSnapshot?.mode ?? spec.mode,
                    },
                  },
                )}
                zoom={1}
                projectionMode={false}
                solfegeActive={solfege.solfegeMode !== "off"}
                solfegeOverlayNoteheads={
                  solfege.solfegeMode !== "off" && solfege.solfegeOverlayMode
                }
                headerControls={
                  <span className="AppHistoryLabel">
                    {teacher.libraryPreviewTitle}
                  </span>
                }
              />
            )}
          </div>
        </div>
      ) : null}

      {/* ── Batch generate modal ── */}
      {showBatchModal ? (
        <div
          className="AppModalBackdrop"
          onClick={() => setShowBatchModal(false)}
          role="presentation"
        >
          <div
            className="AppModal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="AppModalClose"
              onClick={() => setShowBatchModal(false)}
              disabled={teacher.batchStatus === "running"}
            >
              ×
            </button>
            <h3>Batch Generate</h3>
            <div className="AppBatchForm">
              <label className="AppHistoryLabel">
                Count
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={teacher.batchCount}
                  onChange={(e) =>
                    teacher.setBatchCount(
                      Math.max(1, Math.min(100, Number(e.target.value) || 10)),
                    )
                  }
                  disabled={teacher.batchStatus === "running"}
                />
              </label>
              <label className="AppHistoryLabel">
                Title Prefix
                <input
                  type="text"
                  value={teacher.batchTitlePrefix}
                  onChange={(e) => teacher.setBatchTitlePrefix(e.target.value)}
                  placeholder="Period 1 - Exercise"
                  disabled={teacher.batchStatus === "running"}
                />
              </label>
              <label className="AppHistoryLabel">
                Packet Title
                <input
                  type="text"
                  value={teacher.batchPacketTitle}
                  onChange={(e) => teacher.setBatchPacketTitle(e.target.value)}
                  placeholder="Period 1 Packet"
                  disabled={teacher.batchStatus === "running"}
                />
              </label>
              <label className="AppHistoryLabel">
                Notes / Instructions (optional)
                <textarea
                  value={teacher.batchPacketNotes}
                  onChange={(e) => teacher.setBatchPacketNotes(e.target.value)}
                  rows={3}
                  placeholder="Warm-up, dynamics focus, or rubric notes."
                  disabled={teacher.batchStatus === "running"}
                />
              </label>
              <label className="AppHistoryLabel">
                Class
                <select
                  value={teacher.batchFolderId}
                  onChange={(e) => teacher.setBatchFolderId(e.target.value)}
                  disabled={teacher.batchStatus === "running"}
                >
                  {teacher.folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="AppHistoryLabel">
                Generated exercises and packet metadata will be saved to
                Supabase.
              </p>
              {teacher.batchStatus === "running" ? (
                <p className="AppHistoryLabel">
                  Generating {teacher.batchProgress.current}/
                  {teacher.batchProgress.total}...
                </p>
              ) : null}
              {teacher.batchMessage ? (
                <p className="AppHistoryLabel">{teacher.batchMessage}</p>
              ) : null}
              <div className="AppBatchActions">
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionToggleButton"
                  onClick={() => void handleBatchGenerate()}
                  disabled={teacher.batchStatus === "running"}
                >
                  Generate Packet
                </button>
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionToggleButton"
                  onClick={() => setShowBatchModal(false)}
                  disabled={teacher.batchStatus === "running"}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Melody preferences modal ── */}
      {showMelodyPreferencesModal && !projection.isProjectionMode ? (
        <div
          className="AppModalBackdrop"
          onClick={() => setShowMelodyPreferencesModal(false)}
          role="presentation"
        >
          <div
            className="AppModal AppModalWide"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <ExerciseForm
              spec={spec}
              onSpecChange={(next) =>
                setSpec(normalizeUserConstraintsInSpec(next))
              }
              onRandomizeSeed={runWithNewSeed}
              onExport={handleExport}
              showActions={false}
              disableAdvancedPanels={isGuestMode}
              bare
              headerActions={
                <div className="AppPrefsHeaderActions">
                  {mode === "teacher" ? (
                    <>
                      <button
                        type="button"
                        className="AppHistoryButton AppProjectionToggleButton"
                        onClick={() => void teacher.saveClassDefaults(spec)}
                        disabled={
                          !teacher.selectedFolderId ||
                          teacher.classroomDefaultsStatus === "loading"
                        }
                      >
                        Class Default
                      </button>
                      <button
                        type="button"
                        className="AppHistoryButton AppProjectionToggleButton"
                        onClick={() => void teacher.clearClassDefaults()}
                        disabled={
                          !teacher.selectedFolderId ||
                          teacher.classroomDefaultsStatus === "loading"
                        }
                      >
                        Clear Default
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="AppHistoryButton AppSymbolButton AppSquareButton AppPrefsCloseButton"
                    onClick={() => setShowMelodyPreferencesModal(false)}
                  >
                    x
                  </button>
                </div>
              }
            />
          </div>
        </div>
      ) : null}

      {/* ── Instructions modal ── */}
      {showInstructions ? (
        <div
          className="AppModalBackdrop"
          onClick={() => setShowInstructions(false)}
          role="presentation"
        >
          <div
            className="AppModal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="AppModalClose"
              onClick={() => setShowInstructions(false)}
            >
              ×
            </button>
            <h3>How To Use SightLine</h3>
            <ol>
              <li>Set parameters in the bottom panel.</li>
              <li>
                Click <strong>Generate Melody</strong>.
              </li>
              <li>
                Use <strong>Fix Melody</strong> to regenerate with updated
                parameters.
              </li>
              <li>Review notation and refine with pitch edits if needed.</li>
              <li>
                Toggle <strong>Edit Pitches</strong>, click the score, then use
                arrow keys.
              </li>
              <li>Use Play, Tempo, and Instrument to hear your melody.</li>
              <li>Use Export MusicXML to download.</li>
            </ol>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// App root
// ---------------------------------------------------------------------------

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

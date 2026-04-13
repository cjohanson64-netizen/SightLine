import { useEffect, useMemo, useRef, useState } from "react";
import type {
  FormEvent as ReactFormEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import Logo from "../assets/SightLine Logo.svg";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import AppNavbar from "../components/AppNavbar";
import AddStudentsModal from "../components/modals/AddStudentsModal";
import AuthChoiceModal from "../components/modals/AuthChoiceModal";
import BatchGenerateModal from "../components/modals/BatchGenerateModal";
import CalibrationIntroModal from "../components/modals/CalibrationIntroModal";
import ClassroomAccessModal from "../components/modals/ClassroomAccessModal";
import CreatePacketFromSelectedModal from "../components/modals/CreatePacketFromSelectedModal";
import LibraryPreviewModal from "../components/modals/LibraryPreviewModal";
import MelodyPreferencesModal from "../components/modals/MelodyPreferencesModal";
import StudentSignInModal from "../components/modals/StudentSignInModal";

import {
  KEY_TO_PC,
  midiToPc,
  midiToPitch,
  noteKey,
  pitchOctaveForMidi,
  prefersFlatsForKey,
  toOctave,
} from "../core/midi";
import { toMusicXmlFromMelody } from "../core/projection/toMusicXml";
import { defaultSpec, normalizeUserConstraintsInSpec } from "../core/spec";
import { saveAssessmentLog } from "../core/assessmentLogs/saveAssessmentLog";
import type { MicAssessmentRunResult } from "@/SightLine/core/audio/types";
import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";
import "../styles/App.css";

import { useAuth } from "../hooks/useAuth";
import { usePlayback } from "../hooks/usePlayback";
import { useProjection } from "../hooks/useProjection";
import { useSolfege } from "../hooks/useSolfege";
import { useStudentSession } from "../hooks/useStudentSession";
import { useTeacherLibrary } from "../hooks/useTeacherLibrary";
import { useGeneratorActions } from "../hooks/useGeneratorActions";
import { usePitchEdit } from "../hooks/usePitchEdit";
import { useMicAssessment } from "../hooks/useMicAssessment";
import { useAssessmentAccess } from "../hooks/useAssessmentAccess";
import { useAssessmentCalibration } from "../hooks/useAssessmentCalibration";
import ClassAccessPage from "../pages/ClassAccessPage";
import GuidePage from "../pages/GuidePage";
import GeneratorPage from "../pages/GeneratorPage";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface PitchPatchEntry {
  midi: number;
  pitch: string;
  octave?: number;
}

type AssessmentNoteOutcome =
  | "correct"
  | "near"
  | "incorrect"
  | "ambiguous"
  | null;

// ---------------------------------------------------------------------------
// Pure helpers (kept local because they depend on domain types)
// ---------------------------------------------------------------------------

function modeScale(mode: ExerciseSpec["mode"]): number[] {
  return mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
}
function midiToDegree(midi: number, keyScale: number[]): number {
  const idx = keyScale.indexOf(midiToPc(midi));
  return idx === -1 ? 1 : idx + 1;
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
      octave: override.octave ?? pitchOctaveForMidi(override.midi),
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

function formatSavedDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
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
  const assessmentAccess = useAssessmentAccess({
    mode,
    authUserId: auth.authUser?.id ?? null,
    studentSession: student.studentSession,
    hasActiveSubscription: teacher.hasActiveSubscription,
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
  const [showCalibrationIntroModal, setShowCalibrationIntroModal] =
    useState<boolean>(false);
  const [, setBillingNotice] = useState<string>("");
  const [selectedAssessmentNoteIndex, setSelectedAssessmentNoteIndex] =
    useState<number | null>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const notationContainerRef = useRef<HTMLDivElement | null>(null);

  // ── Sub-hooks (depend on local state) ─────────────────────────────────────
  const {
    pitchEditMode,
    setPitchEditMode,
    selectionIndex,
    setSelectionIndex,
    setSelectedNoteId,
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

  // ── Derived melody state ──────────────────────────────────────────────────
  const currentPatchedMelody = useMemo<MelodyEvent[]>(() => {
    if (currentMelody.length === 0) return [];
    const patched = applyPitchPatch(currentMelody, pitchPatch);
    const activeSpec = currentSpecSnapshot ?? spec;
    const preferFlats = prefersFlatsForKey(activeSpec.key, activeSpec.mode);
    return patched.map((event) =>
      event.isAttack === false
        ? event
        : { ...event, pitch: midiToPitch(event.midi, { preferFlats, key: activeSpec.key, mode: activeSpec.mode }) },
    );
  }, [currentMelody, pitchPatch, currentSpecSnapshot, spec]);

  const handleAssessmentCompleted = async (
    nextResult: MicAssessmentRunResult,
  ) => {
    assessmentAccess.recordAssessmentUse();
    try {
      await saveAssessmentLog({
        authUserId: auth.authUser?.id ?? null,
        teacherId: auth.authUser?.id ?? null,
        classId:
          mode === "student"
            ? (student.studentSession?.classroom.id ?? null)
            : teacher.selectedFolderId || null,
        studentToken: student.studentSession?.token ?? null,
        studentId: student.studentSession?.classroom.student_id ?? null,
        folderId:
          mode === "student"
            ? (student.studentSession?.classroom.id ?? null)
            : teacher.selectedFolderId || null,
        assignmentId: null,
        exerciseId: mode === "teacher" ? teacher.activeExerciseId : null,
        exerciseTitle: currentSpecSnapshot?.title ?? spec.title,
        seed,
        result: nextResult,
      });
    } catch (logError) {
      console.error("Failed to save assessment log", logError);
    } finally {
      calibration.clearCalibration();
    }
  };

  const calibration = useAssessmentCalibration(currentPatchedMelody);

  const micAssessment = useMicAssessment({
    targetMelody: currentPatchedMelody,
    calibrationProfile: calibration.result?.profile ?? null,
    access: {
      canRun: assessmentAccess.access.canRun,
      blockedMessage: assessmentAccess.access.blockedMessage,
      onAssessmentCompleted: handleAssessmentCompleted,
    },
  });

  const assessmentPlaybackDisabled =
    calibration.status === "requesting_permission" ||
    calibration.status === "recording" ||
    calibration.status === "processing" ||
    micAssessment.status === "requesting_permission" ||
    micAssessment.status === "recording" ||
    micAssessment.status === "processing";

  const playback = usePlayback(
    currentMelody,
    pitchPatch,
    noteKey,
    currentBeatsPerMeasure,
    { blocked: assessmentPlaybackDisabled },
  );
  const projection = useProjection(notationContainerRef);
  const interactionDisabled = playback.isPlaying;

  const assessmentOutcomeByIndex = useMemo<AssessmentNoteOutcome[]>(() => {
    const result = micAssessment.result;
    if (!result) {
      return [];
    }

    return currentPatchedMelody.map((_, index) => {
      const note = result.assessment.notes[index];
      const segmented = result.segmentedNotes[index];
      if (note?.displayState === "correct") {
        return "correct";
      }
      if (note?.displayState === "near") {
        return "near";
      }
      if (
        note?.displayState === "transposed_consistent" ||
        note?.displayState === "ambiguous" ||
        note?.displayState === "low_confidence"
      ) {
        return "ambiguous";
      }
      if (note?.isCorrect) {
        return "correct";
      }
      if (
        segmented &&
        (segmented.status === "ambiguous" ||
          segmented.status === "weak" ||
          segmented.targetConsistentAmbiguity)
      ) {
        return "ambiguous";
      }
      if (note?.target || segmented) {
        return "incorrect";
      }
      return null;
    });
  }, [micAssessment.result, currentPatchedMelody]);

  const assessmentNoteColorsByIndex = useMemo<
    Record<number, string | undefined>
  >(
    () =>
      assessmentOutcomeByIndex.reduce<Record<number, string | undefined>>(
        (acc, outcome, index) => {
          acc[index] =
            outcome === "correct"
              ? "#1ecf87"
              : outcome === "near"
                ? "#f1d24f"
                : outcome === "incorrect"
                  ? "#e25555"
                  : outcome === "ambiguous"
                    ? "#e89a2b"
                    : undefined;
          return acc;
        },
        {},
      ),
    [assessmentOutcomeByIndex],
  );

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
    if (!currentSpecSnapshot || currentMelody.length === 0) return "";
    return toMusicXmlFromMelody(
      currentSpecSnapshot as unknown as Record<string, unknown>,
      currentPatchedMelody,
      {
        noteColorsByIndex: assessmentNoteColorsByIndex,
        ...(playback.playbackHighlightIndex !== null
          ? {
              highlightedMelodyIndex: playback.playbackHighlightIndex,
              highlightColor: "#1ecf87",
            }
          : pitchEditMode && selectedMelodyIndex >= 0
            ? {
                highlightedMelodyIndex: selectedMelodyIndex,
                highlightColor: "#ff2da6",
              }
            : {}),
      },
    );
  }, [
    currentSpecSnapshot,
    currentMelody,
    currentPatchedMelody,
    assessmentNoteColorsByIndex,
    playback.playbackHighlightIndex,
    selectedMelodyIndex,
    pitchEditMode,
    musicXml,
  ]);

  const displayNotationMusicXml = useMemo(() => {
    if (notationMusicXml.trim().length === 0) {
      return "";
    }
    return solfege.addSolfegeLyricsToMusicXml(notationMusicXml, {
      solfegeMode: solfege.solfegeMode,
      accidentalMode: solfege.solfegeAccidentalMode,
      colorizeLyrics: solfege.solfegeColorizeMode !== "off",
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

  useEffect(() => {
    const result = micAssessment.result;
    if (!result) {
      setSelectedAssessmentNoteIndex(null);
      return;
    }
    setSelectedAssessmentNoteIndex((current) =>
      current !== null && current < result.segmentedNotes.length
        ? current
        : null,
    );
  }, [micAssessment.result]);

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

  const {
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
  } = useGeneratorActions({
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
    pitchEdit: {
      pitchPatch,
      setPitchPatch,
      setSelectionIndex,
      setSelectedNoteId,
      setEditMessage,
      setPitchEditMode,
    },
    playback: {
      stop: playback.stop,
      setPlaybackHighlightIndex: playback.setPlaybackHighlightIndex,
    },
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
    solfege: {
      addSolfegeLyricsToMusicXml: solfege.addSolfegeLyricsToMusicXml,
      solfegeMode: solfege.solfegeMode,
      solfegeAccidentalMode: solfege.solfegeAccidentalMode,
      solfegeColorizeMode: solfege.solfegeColorizeMode,
    },
    spec,
    student,
    teacher,
    validateAllowedNoteValues,
  });

  const handleGenerateNewMelody = () => {
    micAssessment.clearAssessment();
    setSelectedAssessmentNoteIndex(null);
    runWithNewSeed();
  };

  const handleNotationKeyDownWhileStopped: React.KeyboardEventHandler<
    HTMLDivElement
  > = (event) => {
    if (playback.isPlaying) {
      event.preventDefault();
      return;
    }

    handleNotationKeyDown(event);
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
    const redirectPath = location.pathname;
    await auth.signInWithGoogle(redirectPath);
  };

  const handleAssessmentUpgrade = async () => {
    if (mode === "teacher" && auth.authUser) {
      await teacher.startCheckout();
      return;
    }
    setShowAuthChoiceModal(true);
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
    if (result) {
      navigate("/");
    }
  };

  const handleLeaveClassroom = () => {
    student.leave();
  };

  // ── Mode label / nav helpers ──────────────────────────────────────────────
  const modeLabel: "Teacher" | "Student" | "Guest" =
    mode === "teacher" ? "Teacher" : mode === "student" ? "Student" : "Guest";
  const teacherFeaturesDisabled =
    mode === "teacher" && !teacher.hasActiveSubscription;
  const subscriptionStatusNormalized = teacher.subscriptionStatus.toLowerCase();
  const hasStripeCustomer = Boolean(teacher.subscriptionStripeCustomerId);
  const hasActiveOrTrialingSubscription =
    subscriptionStatusNormalized === "active" ||
    subscriptionStatusNormalized === "trialing";
  const canManageSubscription =
    teacher.hasActiveSubscription &&
    (hasActiveOrTrialingSubscription || hasStripeCustomer);
  const manageDisabledMissingCustomer =
    teacher.hasActiveSubscription &&
    !canManageSubscription &&
    (teacher.subscriptionIsAdmin || teacher.subscriptionIsComped);
  const subscriptionActionLoading =
    teacher.checkoutStatus === "starting" ||
    teacher.checkoutStatus === "redirecting" ||
    teacher.portalStatus === "starting" ||
    teacher.portalStatus === "redirecting";
  const showBillingAction = mode === "teacher";
  const billingActionLabel = teacher.hasActiveSubscription
    ? teacher.portalStatus === "starting"
      ? "Opening..."
      : "Subscription"
    : teacher.checkoutStatus === "starting"
      ? "Starting..."
      : "Upgrade";
  const billingActionTitle = teacher.hasActiveSubscription
    ? manageDisabledMissingCustomer
      ? "No Stripe customer record for this account"
      : "Open Stripe billing portal"
    : "Start premium access";
  const billingActionDisabled = teacher.hasActiveSubscription
    ? subscriptionActionLoading || manageDisabledMissingCustomer
    : subscriptionActionLoading;
  const navAuthLabel =
    mode === "student" || auth.authUser ? "Sign out" : "Sign In";
  const handleNavAuthClick = () => {
    if (mode === "student") {
      handleLeaveClassroom();
      return;
    }
    void handleAuthClick();
  };
  const guideView = (
    <GuidePage
      auth={auth}
      mode={mode}
      modeLabel={modeLabel}
      student={student}
      teacher={teacher}
    />
  );

  const openBatchGenerateModal = () => {
    teacher.openBatchModal(
      teacher.selectedFolderId,
      teacher.selectedFolder?.name ?? "Class",
    );
    setShowBatchModal(true);
  };

  const classAccessView = (
    <ClassAccessPage
      formatSavedDate={formatSavedDate}
      mode={mode}
      onExportSavedPacketZip={handleExportSavedPacketZip}
      onOpenAddStudents={() => setShowAddStudentsModal(true)}
      onOpenBatchGenerate={openBatchGenerateModal}
      onOpenClassroomAccess={() => setShowClassroomAccessModal(true)}
      onOpenSavedPacket={handleOpenSavedPacket}
      onPreviewSubmission={handlePreviewSubmission}
      teacher={teacher}
      teacherFeaturesDisabled={teacherFeaturesDisabled}
    />
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
          onBillingAction={() =>
            void (
              teacher.hasActiveSubscription
                ? teacher.startPortalSession()
                : teacher.startCheckout()
            )
          }
          showBillingAction={showBillingAction}
          billingActionDisabled={billingActionDisabled}
          billingActionLabel={billingActionLabel}
          billingActionTitle={billingActionTitle}
          isProjectionMode={projection.isProjectionMode}
          canAccessClass={mode === "teacher"}
          theme={theme}
        onThemeChange={setTheme}
        interactionDisabled={interactionDisabled}
      />

      {!projection.isProjectionMode && location.pathname === "/guide" ? (
        <div className="AppIntro">
          <div className="AppBrand">
            <img src={Logo} alt="SightLine Logo" className="logo" />
            <div>
              <p className="AppSubtitle">
                SightLine Guide
              </p>
              <p className="AppSubtitle">
                Practical setup help for teachers and students.
              </p>
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
        <Route
          path="/"
          element={
            <GeneratorPage
              currentMelody={currentMelody}
              calibrationStatus={calibration.status}
              calibrationReady={calibration.isReady}
              assessmentError={micAssessment.errorMessage}
              assessmentNoteOutcomeByIndex={assessmentOutcomeByIndex}
              assessmentResult={micAssessment.result}
              selectedAssessmentNoteIndex={selectedAssessmentNoteIndex}
              assessmentStatus={micAssessment.status}
              assessmentAccessMessage={assessmentAccess.access.message}
              assessmentAccessBlocked={!assessmentAccess.access.canRun}
              assessmentPlaybackDisabled={assessmentPlaybackDisabled}
              displayNotationMusicXml={displayNotationMusicXml}
              error={error}
              exportMusicXml={exportMusicXml}
              formatSavedDate={formatSavedDate}
              handleJoinClassroom={handleJoinClassroom}
              handleLeaveClassroom={handleLeaveClassroom}
              handleLoadClassroomExercise={handleLoadClassroomExercise}
              handleLoadSavedExercise={handleLoadSavedExercise}
              handleNotationKeyDown={handleNotationKeyDownWhileStopped}
              handleSaveToSupabase={handleSaveToSupabase}
              handleSubmitToTeacher={handleSubmitToTeacher}
              isGuestMode={isGuestMode}
              mode={mode}
              notationContainerRef={notationContainerRef}
              onExport={handleExport}
              onOpenMelodyPreferences={() =>
                setShowMelodyPreferencesModal(true)
              }
              onAssessmentNoteSelect={setSelectedAssessmentNoteIndex}
              onAssessmentUpgrade={() => void handleAssessmentUpgrade()}
              onRunAssessment={() => {
                if (calibration.status === "recording") {
                  void calibration.stopCalibration();
                  return;
                }
                if (!calibration.isReady) {
                  setShowCalibrationIntroModal(true);
                  return;
                }
                if (micAssessment.status === "recording") {
                  void micAssessment.stopAssessment();
                  return;
                }
                void micAssessment.startAssessment();
              }}
              onClearAssessment={micAssessment.clearAssessment}
              pitchEditMode={pitchEditMode}
              playback={playback}
              projection={projection}
              relaxationNotice={relaxationNotice}
              runWithNewSeed={handleGenerateNewMelody}
              rerunWithCurrentSeed={rerunWithCurrentSeed}
              saveMessage={saveMessage}
              saveStatus={saveStatus}
              setEditMessage={setEditMessage}
              setPitchEditMode={setPitchEditMode}
              setSpec={setSpec}
              solfege={solfege}
              spec={spec}
              student={student}
              teacher={teacher}
              teacherFeaturesDisabled={teacherFeaturesDisabled}
              updateExerciseTitle={updateExerciseTitle}
              interactionDisabled={interactionDisabled}
            />
          }
        />
        <Route path="/guide" element={guideView} />
        <Route path="/dashboard" element={<Navigate to="/guide" replace />} />
        <Route path="/generator" element={<Navigate to="/" replace />} />

        <Route
          path="/class"
          element={
            mode === "teacher" ? (
              classAccessView
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <AuthChoiceModal
        authUser={auth.authUser}
        isOpen={showAuthChoiceModal}
        onClose={() => setShowAuthChoiceModal(false)}
        onStudentSignIn={handleStudentSignIn}
        onTeacherSignIn={handleTeacherSignIn}
      />

      <StudentSignInModal
        authUser={auth.authUser}
        isOpen={showStudentSignInModal}
        onClose={() => setShowStudentSignInModal(false)}
        onJoin={handleJoinClassroom}
        onLeave={handleLeaveClassroom}
        onResetToMySettings={() => {
          const prev = student.resetToMySettings();
          if (prev) setSpec(normalizeUserConstraintsInSpec(prev));
        }}
        onUseTeacherSettings={() => {
          const next = student.applyTeacherSettings(
            spec,
            normalizeUserConstraintsInSpec(spec),
          );
          if (next) setSpec(normalizeUserConstraintsInSpec(next));
        }}
        student={student}
      />

      <ClassroomAccessModal
        isOpen={showClassroomAccessModal}
        mode={mode}
        onClose={() => setShowClassroomAccessModal(false)}
        teacher={teacher}
      />

      <AddStudentsModal
        isOpen={showAddStudentsModal}
        mode={mode}
        onClose={() => setShowAddStudentsModal(false)}
        teacher={teacher}
      />

      <CreatePacketFromSelectedModal
        isOpen={teacher.showCreatePacketFromSelectedModal}
        mode={mode}
        onClose={() => teacher.setShowCreatePacketFromSelectedModal(false)}
        onExportSavedPacketZip={() =>
          teacher.lastCreatedPacket
            ? handleExportSavedPacketZip(teacher.lastCreatedPacket)
            : Promise.resolve()
        }
        onOpenSavedPacket={() =>
          teacher.lastCreatedPacket
            ? handleOpenSavedPacket(teacher.lastCreatedPacket)
            : Promise.resolve()
        }
        teacher={teacher}
      />

      <LibraryPreviewModal
        currentSpecSnapshot={currentSpecSnapshot}
        isOpen={teacher.showLibraryPreviewModal}
        mode={mode}
        onClose={() => teacher.closeLibraryPreview()}
        solfege={solfege}
        spec={spec}
        teacher={teacher}
        interactionDisabled={interactionDisabled}
      />

      <BatchGenerateModal
        isOpen={showBatchModal}
        onClose={() => setShowBatchModal(false)}
        onGenerate={handleBatchGenerate}
        teacher={teacher}
      />

      <CalibrationIntroModal
        isOpen={showCalibrationIntroModal}
        onClose={() => setShowCalibrationIntroModal(false)}
        onStartCalibration={() => {
          setShowCalibrationIntroModal(false);
          void calibration.startCalibration();
        }}
        disabled={calibration.status === "requesting_permission"}
      />

      <MelodyPreferencesModal
        isGuestMode={isGuestMode}
        isOpen={showMelodyPreferencesModal}
        mode={mode}
        normalizeSpec={normalizeUserConstraintsInSpec}
        onClose={() => setShowMelodyPreferencesModal(false)}
        onExport={handleExport}
        onRandomizeSeed={handleGenerateNewMelody}
        projection={projection}
        setSpec={setSpec}
        spec={spec}
        teacher={teacher}
        interactionDisabled={interactionDisabled}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// App root
// ---------------------------------------------------------------------------

export default function App(): JSX.Element {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <AppContent />
    </BrowserRouter>
  );
}

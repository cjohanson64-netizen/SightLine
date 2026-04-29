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
import ClassroomAccessModal from "../components/modals/ClassroomAccessModal";
import CreatePacketFromSelectedModal from "../components/modals/CreatePacketFromSelectedModal";
import LibraryPreviewModal from "../components/modals/LibraryPreviewModal";
import MelodyPreferencesModal from "../components/modals/MelodyPreferencesModal";
import StudentSignInModal from "../components/modals/StudentSignInModal";

import {
  midiToPitch,
  noteKey,
  pitchOctaveForMidi,
  prefersFlatsForKey,
  toOctave,
} from "../core/midi";
import { applyPitchPatch, type PitchPatchEntry } from "../core/scale";
import { toMusicXmlFromMelody } from "../core/projection/toMusicXml";
import { defaultSpec, normalizeUserConstraintsInSpec } from "../core/spec";
import type { DebugSemanticsProjection } from "@/SightLine/domain/artifact";
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
import { useModalState } from "../hooks/useModalState";
import ClassAccessPage from "../pages/ClassAccessPage";
import GuidePage from "../pages/GuidePage";
import GeneratorPage from "../pages/GeneratorPage";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

const EMPTY_DEBUG_SEMANTICS: DebugSemanticsProjection = {
  targetNotes: [],
  phraseSummaries: [],
  strengths: [],
  weaknesses: [],
  recommendation: null,
};

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
  const [debugSemantics, setDebugSemantics] =
    useState<DebugSemanticsProjection>(EMPTY_DEBUG_SEMANTICS);
  const [error, setError] = useState<{
    title: string;
    message: string;
    suggestions: string[];
  } | null>(null);
  const [relaxationNotice, setRelaxationNotice] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveMessage, setSaveMessage] = useState<string>("");
  const [, setBillingNotice] = useState<string>("");

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
  const modalState = useModalState();

  const playback = usePlayback(
    currentMelody,
    pitchPatch,
    noteKey,
    currentBeatsPerMeasure,
    { blocked: false },
  );
  const projection = useProjection(notationContainerRef);
  const interactionDisabled = playback.isPlaying;
  const projectedDebugSemantics = debugSemantics;

  const climaxNoteIndices = useMemo<number[]>(
    () =>
      projectedDebugSemantics.targetNotes.flatMap((note, index) =>
        note.functions.includes("climax") ? [index] : [],
      ),
    [projectedDebugSemantics.targetNotes],
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
    if (allowed.length > 0) return null;
    if (allowed.length === 0)
      return {
        title: "Invalid Note Values",
        message: "Choose at least one allowed note value.",
        suggestions: ["Select at least one note value from EE, Q, H, W."],
      };
    return null;
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
    setDebugSemantics,
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
    modalState.openAuthChoiceModal();
  };

  const handleTeacherSignIn = async () => {
    modalState.closeAuthChoiceModal();
    const redirectPath = location.pathname;
    await auth.signInWithGoogle(redirectPath);
  };

  const handleStudentSignIn = () => {
    modalState.closeAuthChoiceModal();
    modalState.openStudentSignInModal();
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
    modalState.openBatchModal();
  };

  const classAccessView = (
    <ClassAccessPage
      formatSavedDate={formatSavedDate}
      mode={mode}
      onExportSavedPacketZip={handleExportSavedPacketZip}
      onOpenAddStudents={modalState.openAddStudentsModal}
      onOpenBatchGenerate={openBatchGenerateModal}
      onOpenClassroomAccess={modalState.openClassroomAccessModal}
      onOpenSavedPacket={handleOpenSavedPacket}
      onPreviewSubmission={handlePreviewSubmission}
      teacher={teacher}
      teacherFeaturesDisabled={teacherFeaturesDisabled}
    />
  );

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div
      className={`AppShell AppThemeDark ${projection.isProjectionMode ? "AppProjectionMode" : ""}`}
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
              currentSpecSnapshot={currentSpecSnapshot}
              climaxNoteIndices={climaxNoteIndices}
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
              onOpenMelodyPreferences={modalState.openMelodyPreferencesModal}
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
        isOpen={modalState.showAuthChoiceModal}
        onClose={modalState.closeAuthChoiceModal}
        onStudentSignIn={handleStudentSignIn}
        onTeacherSignIn={handleTeacherSignIn}
      />

      <StudentSignInModal
        authUser={auth.authUser}
        isOpen={modalState.showStudentSignInModal}
        onClose={modalState.closeStudentSignInModal}
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
        isOpen={modalState.showClassroomAccessModal}
        mode={mode}
        onClose={modalState.closeClassroomAccessModal}
        teacher={teacher}
      />

      <AddStudentsModal
        isOpen={modalState.showAddStudentsModal}
        mode={mode}
        onClose={modalState.closeAddStudentsModal}
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
        isOpen={modalState.showBatchModal}
        onClose={modalState.closeBatchModal}
        onGenerate={handleBatchGenerate}
        teacher={teacher}
      />

      <MelodyPreferencesModal
        isGuestMode={isGuestMode}
        isOpen={modalState.showMelodyPreferencesModal}
        mode={mode}
        normalizeSpec={normalizeUserConstraintsInSpec}
        onClose={modalState.closeMelodyPreferencesModal}
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

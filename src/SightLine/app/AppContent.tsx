import { useEffect, useMemo, useRef, useState } from "react";
import type {
  FormEvent as ReactFormEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

import Logo from "../assets/SightLine-Logo.svg";

import {
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

import { midiToPitch, noteKey, prefersFlatsForKey } from "../core/midi";

import { applyPitchPatch } from "../core/scale";
import { defaultSpec, normalizeUserConstraintsInSpec } from "../core/spec";

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

import { EMPTY_DEBUG_SEMANTICS } from "./constants/debug";

import {
  extractMelodyEvents,
  formatSavedDate,
} from "./services/artifact.service";

import {
  getBillingActionState,
  getClimaxNoteIndices,
  getModeLabel,
  getNavAuthLabel,
  getSelectedEditLabel,
  getSelectedMelodyIndex,
  getTeacherFeaturesDisabled,
} from "./services/appDerivedState.service";

import {
  buildDisplayNotationMusicXml,
  buildExportMusicXml,
  buildNotationMusicXml,
} from "./services/musicXml.service";

import { validateAllowedNoteValues } from "./services/specValidation.service";

export default function AppContent(): JSX.Element {
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

  // ── Local UI State ────────────────────────────────────────────────────────

  const [spec, setSpec] = useState<ExerciseSpec>(defaultSpec);

  const [seed, setSeed] = useState<number>(20260219);

  const [musicXml, setMusicXml] = useState<string>("");

  const [currentMelody, setCurrentMelody] = useState<MelodyEvent[]>([]);

  const [currentBeatsPerMeasure, setCurrentBeatsPerMeasure] =
    useState<number>(4);

  const [currentSpecSnapshot, setCurrentSpecSnapshot] =
    useState<ExerciseSpec | null>(null);

  const [logs, setLogs] = useState<string[]>([]);

  const [debugSemantics, setDebugSemantics] = useState(EMPTY_DEBUG_SEMANTICS);

  const [assessmentNoteColorsByIndex, setAssessmentNoteColorsByIndex] =
    useState<Record<number, string | undefined>>({});

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

  // ── Sub Hooks ─────────────────────────────────────────────────────────────

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

  // ── Derived Melody State ──────────────────────────────────────────────────

  const currentPatchedMelody = useMemo<MelodyEvent[]>(() => {
    if (currentMelody.length === 0) return [];

    const patched = applyPitchPatch(currentMelody, pitchPatch);

    const activeSpec = currentSpecSnapshot ?? spec;

    const preferFlats = prefersFlatsForKey(activeSpec.key, activeSpec.mode);

    return patched.map((event) =>
      event.isAttack === false
        ? event
        : {
            ...event,
            pitch: midiToPitch(event.midi, {
              preferFlats,
              key: activeSpec.key,
              mode: activeSpec.mode,
            }),
          },
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
    () => getClimaxNoteIndices(projectedDebugSemantics),
    [projectedDebugSemantics],
  );

  const selectedAttack = renderableAttacks[selectionIndex] ?? null;

  const selectedMelodyIndex = useMemo(
    () =>
      getSelectedMelodyIndex({
        selectedAttack,
        currentMelody,
        noteKey,
      }),
    [selectedAttack, currentMelody],
  );

  const exportMusicXml = useMemo(
    () =>
      buildExportMusicXml({
        currentSpecSnapshot,
        currentMelody,
        currentPatchedMelody,
        fallbackMusicXml: musicXml,
      }),
    [currentSpecSnapshot, currentMelody, currentPatchedMelody, musicXml],
  );

  const notationMusicXml = useMemo(
    () =>
      buildNotationMusicXml({
        currentSpecSnapshot,
        currentMelody,
        currentPatchedMelody,
        playbackHighlightIndex: playback.playbackHighlightIndex,
        pitchEditMode,
        selectedMelodyIndex,
        noteColorsByIndex: assessmentNoteColorsByIndex,
      }),
    [
      currentSpecSnapshot,
      currentMelody,
      currentPatchedMelody,
      playback.playbackHighlightIndex,
      selectedMelodyIndex,
      pitchEditMode,
      assessmentNoteColorsByIndex,
    ],
  );

  const displayNotationMusicXml = useMemo(
    () =>
      buildDisplayNotationMusicXml({
        notationMusicXml,
        addSolfegeLyricsToMusicXml: solfege.addSolfegeLyricsToMusicXml,
        solfegeMode: solfege.solfegeMode,
        accidentalMode: solfege.solfegeAccidentalMode,
        colorizeLyrics: solfege.solfegeColorizeMode !== "off",
        fallback: {
          key: currentSpecSnapshot?.key ?? spec.key,
          mode: currentSpecSnapshot?.mode ?? spec.mode,
        },
      }),
    [
      notationMusicXml,
      solfege.addSolfegeLyricsToMusicXml,
      solfege.solfegeMode,
      solfege.solfegeAccidentalMode,
      solfege.solfegeColorizeMode,
      currentSpecSnapshot,
      spec.key,
      spec.mode,
    ],
  );

  const selectedOriginalAttack =
    selectedMelodyIndex >= 0 && currentMelody.length > 0
      ? currentMelody[selectedMelodyIndex]
      : null;

  const selectedEditLabel = getSelectedEditLabel({
    selectedAttack,
    selectedOriginalAttack,
  });

  void selectedEditLabel;

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    setAssessmentNoteColorsByIndex({});
  }, [currentMelody, currentPatchedMelody, currentSpecSnapshot]);

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

  // ── Student Interaction Tracking ─────────────────────────────────────────

  const handleStudentInteractionClickCapture = (
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    if (mode !== "student" || !student.studentSession?.token) {
      return;
    }

    const target = event.target as HTMLElement | null;

    if (target?.closest("button")) {
      student.markActivity("button");
    }
  };

  const handleStudentInteractionChangeCapture = (
    event: ReactFormEvent<HTMLDivElement>,
  ) => {
    if (mode !== "student" || !student.studentSession?.token) {
      return;
    }

    const target = event.target as HTMLElement | null;

    if (
      target?.tagName === "INPUT" ||
      target?.tagName === "SELECT" ||
      target?.tagName === "TEXTAREA"
    ) {
      student.markActivity("change");
    }
  };

  // ── Generator Actions ─────────────────────────────────────────────────────

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

  // ── Exercise Title ────────────────────────────────────────────────────────

  const updateExerciseTitle = (nextTitleRaw: string) => {
    setSpec((prev) => ({
      ...prev,
      title: nextTitleRaw,
    }));

    setCurrentSpecSnapshot((prev) =>
      prev
        ? {
            ...prev,
            title: nextTitleRaw,
          }
        : prev,
    );
  };

  // ── Auth Handlers ─────────────────────────────────────────────────────────

  const handleAuthClick = async () => {
    auth.authMessage && void 0;

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

    if (!student.studentSession) {
      student.setStudentJoinMessage(
        "Enter your classroom code, passcode, and student ID.",
      );
    }
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

  // ── Derived UI State ──────────────────────────────────────────────────────

  const modeLabel = getModeLabel(mode);

  const teacherFeaturesDisabled = getTeacherFeaturesDisabled(
    mode,
    teacher.hasActiveSubscription,
  );

  const {
    showBillingAction,
    billingActionLabel,
    billingActionTitle,
    billingActionDisabled,
  } = getBillingActionState({
    mode,
    teacher,
  });

  const navAuthLabel = getNavAuthLabel(mode, Boolean(auth.authUser));

  const handleNavAuthClick = () => {
    if (mode === "student") {
      handleLeaveClassroom();
      return;
    }

    void handleAuthClick();
  };

  // ── Route Views ───────────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={`AppShell AppThemeDark ${
        projection.isProjectionMode ? "AppProjectionMode" : ""
      }`}
      onClickCapture={handleStudentInteractionClickCapture}
      onChangeCapture={handleStudentInteractionChangeCapture}
    >
      <AppNavbar
        modeLabel={modeLabel}
        authLabel={navAuthLabel}
        onAuthClick={handleNavAuthClick}
        onBillingAction={() =>
          void (teacher.hasActiveSubscription
            ? teacher.startPortalSession()
            : teacher.startCheckout())
        }
        showBillingAction={showBillingAction}
        billingActionDisabled={billingActionDisabled}
        billingActionLabel={billingActionLabel}
        billingActionTitle={billingActionTitle}
        isProjectionMode={projection.isProjectionMode}
        canAccessClass={mode === "teacher"}
        interactionDisabled={interactionDisabled}
      />
      <img src={Logo} alt="SightLine Logo" className="logo" />

      {auth.authMessage && !projection.isProjectionMode ? (
        <p
          className="AppSubtitle"
          style={{
            opacity: 0.9,
            margin: "0 0 0.75rem",
          }}
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
              currentPatchedMelody={currentPatchedMelody}
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
              onAssessmentNoteColorsChange={setAssessmentNoteColorsByIndex}
            />
          }
        />

        <Route path="/guide" element={guideView} />

        <Route path="/dashboard" element={<Navigate to="/guide" replace />} />

        <Route path="/generator" element={<Navigate to="/" replace />} />

        <Route
          path="/class"
          element={
            mode === "teacher" ? classAccessView : <Navigate to="/" replace />
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

          if (prev) {
            setSpec(normalizeUserConstraintsInSpec(prev));
          }
        }}
        onUseTeacherSettings={() => {
          const next = student.applyTeacherSettings(
            spec,
            normalizeUserConstraintsInSpec(spec),
          );

          if (next) {
            setSpec(normalizeUserConstraintsInSpec(next));
          }
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

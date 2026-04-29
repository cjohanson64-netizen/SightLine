import { useCallback, useState } from "react";

export function useModalState() {
  const [showAuthChoiceModal, setShowAuthChoiceModal] = useState<boolean>(false);
  const [showStudentSignInModal, setShowStudentSignInModal] =
    useState<boolean>(false);
  const [showMelodyPreferencesModal, setShowMelodyPreferencesModal] =
    useState<boolean>(false);
  const [showClassroomAccessModal, setShowClassroomAccessModal] =
    useState<boolean>(false);
  const [showAddStudentsModal, setShowAddStudentsModal] =
    useState<boolean>(false);
  const [showBatchModal, setShowBatchModal] = useState<boolean>(false);

  const openAuthChoiceModal = useCallback(() => {
    setShowAuthChoiceModal(true);
  }, []);

  const closeAuthChoiceModal = useCallback(() => {
    setShowAuthChoiceModal(false);
  }, []);

  const openStudentSignInModal = useCallback(() => {
    setShowStudentSignInModal(true);
  }, []);

  const closeStudentSignInModal = useCallback(() => {
    setShowStudentSignInModal(false);
  }, []);

  const openMelodyPreferencesModal = useCallback(() => {
    setShowMelodyPreferencesModal(true);
  }, []);

  const closeMelodyPreferencesModal = useCallback(() => {
    setShowMelodyPreferencesModal(false);
  }, []);

  const openClassroomAccessModal = useCallback(() => {
    setShowClassroomAccessModal(true);
  }, []);

  const closeClassroomAccessModal = useCallback(() => {
    setShowClassroomAccessModal(false);
  }, []);

  const openAddStudentsModal = useCallback(() => {
    setShowAddStudentsModal(true);
  }, []);

  const closeAddStudentsModal = useCallback(() => {
    setShowAddStudentsModal(false);
  }, []);

  const openBatchModal = useCallback(() => {
    setShowBatchModal(true);
  }, []);

  const closeBatchModal = useCallback(() => {
    setShowBatchModal(false);
  }, []);

  return {
    showAuthChoiceModal,
    showStudentSignInModal,
    showMelodyPreferencesModal,
    showClassroomAccessModal,
    showAddStudentsModal,
    showBatchModal,
    openAuthChoiceModal,
    closeAuthChoiceModal,
    openStudentSignInModal,
    closeStudentSignInModal,
    openMelodyPreferencesModal,
    closeMelodyPreferencesModal,
    openClassroomAccessModal,
    closeClassroomAccessModal,
    openAddStudentsModal,
    closeAddStudentsModal,
    openBatchModal,
    closeBatchModal,
  };
}

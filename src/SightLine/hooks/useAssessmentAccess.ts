import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAssessmentAccess } from '@/SightLine/core/assessmentAccess/getAssessmentAccess';
import { incrementAssessmentUsageCount } from '@/SightLine/core/assessmentAccess/trackAssessmentUsage';
import type { AssessmentAccessState } from '@/SightLine/core/assessmentAccess/types';
import type { StudentSession } from './useStudentSession';

interface UseAssessmentAccessOptions {
  mode: 'teacher' | 'student' | 'guest';
  authUserId: string | null;
  studentSession: StudentSession | null;
  hasActiveSubscription: boolean;
}

interface UseAssessmentAccessResult {
  access: AssessmentAccessState;
  isPaid: boolean;
  refreshAccess: () => void;
  recordAssessmentUse: () => void;
}

function buildIdentityKey(
  mode: 'teacher' | 'student' | 'guest',
  authUserId: string | null,
  studentSession: StudentSession | null
): string {
  if (mode === 'teacher' && authUserId) {
    return `teacher:${authUserId}`;
  }
  if (mode === 'student' && studentSession) {
    const studentId = studentSession.classroom.student_id ?? studentSession.token;
    return `student:${studentSession.classroom.id}:${studentId}`;
  }
  return 'guest:local';
}

export function useAssessmentAccess({
  mode,
  authUserId,
  studentSession,
  hasActiveSubscription,
}: UseAssessmentAccessOptions): UseAssessmentAccessResult {
  const isPaid = mode === 'teacher' && hasActiveSubscription;
  const identityKey = useMemo(
    () => buildIdentityKey(mode, authUserId, studentSession),
    [mode, authUserId, studentSession]
  );

  const [access, setAccess] = useState<AssessmentAccessState>(() =>
    getAssessmentAccess({ identityKey, isPaid })
  );

  const refreshAccess = useCallback(() => {
    setAccess(getAssessmentAccess({ identityKey, isPaid }));
  }, [identityKey, isPaid]);

  const recordAssessmentUse = useCallback(() => {
    if (isPaid) {
      return;
    }
    incrementAssessmentUsageCount(identityKey);
    refreshAccess();
  }, [identityKey, isPaid, refreshAccess]);

  useEffect(() => {
    refreshAccess();
  }, [refreshAccess]);

  useEffect(() => {
    const handleStorage = () => {
      refreshAccess();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [refreshAccess]);

  return {
    access,
    isPaid,
    refreshAccess,
    recordAssessmentUse,
  };
}

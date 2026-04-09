import { useEffect, useRef, useState } from 'react';
import { beginRecordedAttempt, type RecordedAttemptController } from '@/SightLine/core/audio/recordAttempt';
import { requestMicrophone } from '@/SightLine/core/audio/requestMicrophone';
import type { MicAssessmentRunResult } from '@/SightLine/core/audio/types';
import { runMicAssessment } from '@/SightLine/core/assessment/runMicAssessment';
import type { CalibrationProfile } from '@/SightLine/core/calibration/types';
import type { AssessmentComparisonMode } from '@/SightLine/domain/assessment';
import type { MelodyEvent } from '@/SightLine/domain/music';

export type MicAssessmentStatus =
  | 'idle'
  | 'requesting_permission'
  | 'recording'
  | 'processing'
  | 'complete'
  | 'error';

interface UseMicAssessmentOptions {
  targetMelody: MelodyEvent[];
  calibrationProfile?: CalibrationProfile | null;
  access?: {
    canRun: boolean;
    blockedMessage: string | null;
    onAssessmentCompleted?: (result: MicAssessmentRunResult) => void | Promise<void>;
  };
}

interface UseMicAssessmentResult {
  status: MicAssessmentStatus;
  comparisonMode: AssessmentComparisonMode;
  result: MicAssessmentRunResult | null;
  errorMessage: string | null;
  isBusy: boolean;
  canStart: boolean;
  setComparisonMode: (mode: AssessmentComparisonMode) => void;
  startAssessment: () => Promise<void>;
  stopAssessment: () => Promise<void>;
  clearAssessment: () => void;
}

export function useMicAssessment({
  targetMelody,
  calibrationProfile,
  access,
}: UseMicAssessmentOptions): UseMicAssessmentResult {
  const [status, setStatus] = useState<MicAssessmentStatus>('idle');
  const [hasActiveRecording, setHasActiveRecording] = useState(false);
  const [comparisonMode, setComparisonMode] =
    useState<AssessmentComparisonMode>('transposition_aware');
  const [result, setResult] = useState<MicAssessmentRunResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const recorderRef = useRef<RecordedAttemptController | null>(null);

  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
      setHasActiveRecording(false);
    };
  }, []);

  const startAssessment = async () => {
    if (targetMelody.length === 0) {
      setStatus('error');
      setErrorMessage('Generate a melody before running an assessment.');
      return;
    }

    if (access && !access.canRun) {
      setStatus('error');
      setErrorMessage(
        access.blockedMessage ?? 'Assessment access is currently unavailable.'
      );
      return;
    }

    try {
      setErrorMessage(null);
      setResult(null);
      setStatus('requesting_permission');
      const stream = await requestMicrophone();
      recorderRef.current = beginRecordedAttempt(stream);
      setHasActiveRecording(true);
      setStatus('recording');
    } catch (error) {
      setHasActiveRecording(false);
      setStatus('error');
      setErrorMessage(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Microphone permission was denied.'
          : error instanceof Error
            ? error.message
            : 'Unable to start microphone recording.'
      );
    }
  };

  const stopAssessment = async () => {
    const recorder = recorderRef.current;
    if (!recorder) {
      setHasActiveRecording(false);
      setStatus((currentStatus) =>
        currentStatus === 'recording'
          ? result
            ? 'complete'
            : 'idle'
          : currentStatus
      );
      return;
    }

    try {
      setStatus('processing');
      setHasActiveRecording(false);
      const audioBlob = await recorder.stop();
      recorderRef.current = null;
      const nextResult = await runMicAssessment({
        audioBlob,
        targetMelody,
        mode: comparisonMode,
        calibrationProfile,
      });
      setResult(nextResult);
      setErrorMessage(null);
      setStatus('complete');
      void access?.onAssessmentCompleted?.(nextResult);
    } catch (error) {
      setHasActiveRecording(false);
      setStatus('error');
      setErrorMessage(
        error instanceof Error ? error.message : 'Assessment processing failed.'
      );
    }
  };

  const clearAssessment = () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setHasActiveRecording(false);
    setResult(null);
    setErrorMessage(null);
    setStatus('idle');
  };

  const effectiveStatus =
    status === 'recording' && !hasActiveRecording
      ? result
        ? 'complete'
        : 'idle'
      : status;

  return {
    status: effectiveStatus,
    comparisonMode,
    result,
    errorMessage,
    isBusy:
      effectiveStatus === 'requesting_permission' ||
      effectiveStatus === 'recording' ||
      effectiveStatus === 'processing',
    canStart:
      targetMelody.length > 0 &&
      effectiveStatus !== 'recording' &&
      effectiveStatus !== 'processing' &&
      (access?.canRun ?? true),
    setComparisonMode,
    startAssessment,
    stopAssessment,
    clearAssessment,
  };
}

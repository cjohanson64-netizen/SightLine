import { useEffect, useMemo, useRef, useState } from 'react';
import { beginRecordedAttempt, type RecordedAttemptController } from '@/SightLine/core/audio/recordAttempt';
import { requestMicrophone } from '@/SightLine/core/audio/requestMicrophone';
import { analyzeCalibration } from '@/SightLine/core/calibration/analyzeCalibration';
import type { CalibrationRunResult } from '@/SightLine/core/calibration/types';
import type { MelodyEvent } from '@/SightLine/domain/music';

export type CalibrationStatus =
  | 'idle'
  | 'requesting_permission'
  | 'recording'
  | 'processing'
  | 'complete'
  | 'error';

interface UseAssessmentCalibrationResult {
  status: CalibrationStatus;
  result: CalibrationRunResult | null;
  errorMessage: string | null;
  isReady: boolean;
  isBusy: boolean;
  startCalibration: () => Promise<void>;
  stopCalibration: () => Promise<void>;
  clearCalibration: () => void;
}

function melodySignature(targetMelody: MelodyEvent[]): string {
  return targetMelody
    .filter((event) => event.isAttack !== false)
    .map((event) => `${event.midi}:${event.keyId}:${event.measure}:${event.onsetBeat ?? event.beat}`)
    .join('|');
}

export function useAssessmentCalibration(
  targetMelody: MelodyEvent[],
): UseAssessmentCalibrationResult {
  const [status, setStatus] = useState<CalibrationStatus>('idle');
  const [hasActiveRecording, setHasActiveRecording] = useState(false);
  const [result, setResult] = useState<CalibrationRunResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const recorderRef = useRef<RecordedAttemptController | null>(null);
  const signature = useMemo(() => melodySignature(targetMelody), [targetMelody]);

  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
      setHasActiveRecording(false);
    };
  }, []);

  useEffect(() => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setHasActiveRecording(false);
    setStatus('idle');
    setResult(null);
    setErrorMessage(null);
  }, [signature]);

  const startCalibration = async () => {
    if (targetMelody.length === 0) {
      setStatus('error');
      setErrorMessage('Generate a melody before calibrating.');
      return;
    }

    try {
      setResult(null);
      setErrorMessage(null);
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
            : 'Unable to start calibration recording.',
      );
    }
  };

  const stopCalibration = async () => {
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
      const nextResult = await analyzeCalibration({
        audioBlob,
        targetMelody,
      });
      setResult(nextResult);
      setErrorMessage(
        nextResult.profile.successful
          ? null
          : 'Calibration was only partly clear. Try again for the best assessment accuracy.',
      );
      setStatus('complete');
    } catch (error) {
      setHasActiveRecording(false);
      setStatus('error');
      setErrorMessage(
        error instanceof Error ? error.message : 'Calibration processing failed.',
      );
    }
  };

  const clearCalibration = () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setHasActiveRecording(false);
    setStatus('idle');
    setResult(null);
    setErrorMessage(null);
  };

  const effectiveStatus =
    status === 'recording' && !hasActiveRecording
      ? result
        ? 'complete'
        : 'idle'
      : status;

  return {
    status: effectiveStatus,
    result,
    errorMessage,
    isReady: result?.profile.successful === true,
    isBusy:
      effectiveStatus === 'requesting_permission' ||
      effectiveStatus === 'recording' ||
      effectiveStatus === 'processing',
    startCalibration,
    stopCalibration,
    clearCalibration,
  };
}

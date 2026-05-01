import { useCallback, useRef, useState, useEffect } from "react";
import type { RecordedAudioBuffer } from "@/SightLine/core/assessment/intake/audioAdapter";

export interface UseAssessmentRecorderResult {
  isRecording: boolean;
  isRequestingPermission: boolean;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<RecordedAudioBuffer | null>;
  resetRecording: () => void;
}

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function audioBufferToPcm(audioBuffer: AudioBuffer): RecordedAudioBuffer {
  const channelCount = audioBuffer.numberOfChannels;
  const channels = Array.from(
    { length: channelCount },
    (_, index) => new Float32Array(audioBuffer.getChannelData(index)),
  );

  return {
    sampleRate: audioBuffer.sampleRate,
    channelCount,
    frameCount: audioBuffer.length,
    channels,
    durationMs: (audioBuffer.length / audioBuffer.sampleRate) * 1000,
  };
}

async function decodeBlobToPcm(blob: Blob): Promise<RecordedAudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();

  try {
    const audioBuffer = await audioContext.decodeAudioData(
      arrayBuffer.slice(0),
    );
    return audioBufferToPcm(audioBuffer);
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

export function useAssessmentRecorder(): UseAssessmentRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const resetInternal = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
    }

    mediaRecorderRef.current = null;
    chunksRef.current = [];
    stopTracks(mediaStreamRef.current);
    mediaStreamRef.current = null;
    setIsRecording(false);
    setIsRequestingPermission(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (typeof MediaRecorder === "undefined") {
      setError("Audio recording is not supported in this browser.");
      return;
    }

    resetInternal();
    setError(null);
    setIsRequestingPermission(true);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access is not supported in this browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const preferredMimeType = MediaRecorder.isTypeSupported(
        "audio/webm;codecs=opus",
      )
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";

      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        setError("Recording failed before completion.");
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      stopTracks(mediaStreamRef.current);
      mediaStreamRef.current = null;
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : err instanceof Error
            ? err.message
            : "Unable to start microphone recording.",
      );
    } finally {
      setIsRequestingPermission(false);
    }
  }, [resetInternal]);

  const stopRecording =
    useCallback(async (): Promise<RecordedAudioBuffer | null> => {
      const recorder = mediaRecorderRef.current;

      if (!recorder) {
        setError("No recording is currently in progress.");
        return null;
      }

      setIsRecording(false);

      const finalizeBlob = async (): Promise<Blob | null> =>
        new Promise((resolve) => {
          recorder.onstop = () => {
            const mimeType = recorder.mimeType || "audio/webm";
            const blob =
              chunksRef.current.length > 0
                ? new Blob(chunksRef.current, { type: mimeType })
                : null;
            resolve(blob);
          };

          recorder.onerror = () => resolve(null);

          if (recorder.state === "inactive") {
            const mimeType = recorder.mimeType || "audio/webm";
            resolve(
              chunksRef.current.length > 0
                ? new Blob(chunksRef.current, { type: mimeType })
                : null,
            );
            return;
          }

          recorder.stop();
        });

      try {
        const blob = await finalizeBlob();

        if (!blob) {
          setError("No audio was recorded.");
          return null;
        }

        try {
          setError(null);
          return await decodeBlobToPcm(blob);
        } catch {
          setError("Recorded audio could not be decoded.");
          return null;
        }
      } finally {
        resetInternal();
      }
    }, [resetInternal]);

  const resetRecording = useCallback(() => {
    setError(null);
    resetInternal();
  }, [resetInternal]);

  return {
    isRecording,
    isRequestingPermission,
    error,
    startRecording,
    stopRecording,
    resetRecording,
  };
}

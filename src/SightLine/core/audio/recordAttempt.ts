export interface RecordedAttemptController {
  stop: () => Promise<Blob>;
  cancel: () => void;
}

function stopTracks(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

export function beginRecordedAttempt(stream: MediaStream): RecordedAttemptController {
  if (typeof MediaRecorder === 'undefined') {
    stopTracks(stream);
    throw new Error('Audio recording is not supported in this browser.');
  }

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/mp4')
      ? 'audio/mp4'
      : '';
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  recorder.start(250);

  return {
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        recorder.addEventListener(
          'stop',
          () => {
            const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
            stopTracks(stream);
            resolve(blob);
          },
          { once: true }
        );
        recorder.addEventListener(
          'error',
          () => {
            stopTracks(stream);
            reject(new Error('Recording failed before completion.'));
          },
          { once: true }
        );

        if (recorder.state === 'inactive') {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          stopTracks(stream);
          resolve(blob);
          return;
        }

        recorder.stop();
      }),
    cancel: () => {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      stopTracks(stream);
    },
  };
}

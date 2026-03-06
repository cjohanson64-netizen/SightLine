import { useEffect, useRef, useState } from "react";
import type { MelodyEvent } from "../tat";

type PitchPatchEntry = { midi: number; pitch: string };

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function scheduleBeep(
  audioContext: AudioContext,
  midi: number,
  startTime: number,
  durationSeconds: number,
  gainValue: number,
): void {
  const endTime = startTime + Math.max(0.05, durationSeconds);
  const peakGain = Math.max(0.01, gainValue);
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(midiToFrequency(midi), startTime);
  gainNode.gain.setValueAtTime(0.0001, startTime);
  gainNode.gain.linearRampToValueAtTime(
    peakGain,
    Math.min(endTime, startTime + 0.02),
  );
  gainNode.gain.setValueAtTime(
    peakGain,
    Math.max(startTime + 0.02, endTime - 0.03),
  );
  gainNode.gain.linearRampToValueAtTime(0.0001, endTime);
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start(startTime);
  oscillator.stop(endTime);
}

function applyPitchPatch(
  melody: MelodyEvent[],
  patch: Record<string, PitchPatchEntry>,
  noteKey: (event: MelodyEvent, index: number) => string,
): MelodyEvent[] {
  return melody.map((event, index) => {
    if (event.isAttack === false) return event;
    const key = noteKey(event, index);
    const override = patch[key];
    if (!override) return event;
    const octave = Math.floor(override.midi / 12) - 1;
    return {
      ...event,
      midi: override.midi,
      pitch: override.pitch,
      octave,
      isEdited: true,
      editedMidi: override.midi,
      editedPitch: override.pitch,
      originalMidi: event.midi,
    };
  });
}

export function usePlayback(
  currentMelody: MelodyEvent[],
  pitchPatch: Record<string, PitchPatchEntry>,
  noteKey: (event: MelodyEvent, index: number) => string,
  beatsPerMeasure: number,
) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackHighlightIndex, setPlaybackHighlightIndex] = useState<number | null>(null);
  const [tempoBpm, setTempoBpm] = useState(80);
  const [countInEnabled, setCountInEnabled] = useState(true);
  const [instrument, setInstrument] = useState<OscillatorType>("triangle");

  const playbackRef = useRef<{
    context: AudioContext;
    timerId: number | null;
    highlightTimerIds: number[];
  } | null>(null);

  const stop = () => {
    const playback = playbackRef.current;
    if (!playback) return;
    if (playback.timerId !== null) window.clearTimeout(playback.timerId);
    for (const id of playback.highlightTimerIds) window.clearTimeout(id);
    void playback.context.close();
    playbackRef.current = null;
    setPlaybackHighlightIndex(null);
    setIsPlaying(false);
  };

  const play = () => {
    if (isPlaying) { stop(); return; }
    if (currentMelody.length === 0) return;

    const audioContext = new AudioContext();
    const beatSeconds = 60 / Math.max(30, Math.min(240, tempoBpm));
    const startTime = audioContext.currentTime + 0.05;
    const bpm = Math.max(1, beatsPerMeasure || 4);
    const patchedMelody = applyPitchPatch(currentMelody, pitchPatch, noteKey);

    const playableEvents = patchedMelody
      .map((event, melodyIndex) => ({ event, melodyIndex }))
      .filter(entry => entry.event.isAttack !== false)
      .sort(
        (a, b) =>
          a.event.measure - b.event.measure ||
          (a.event.onsetBeat ?? a.event.beat) - (b.event.onsetBeat ?? b.event.beat),
      );

    if (playableEvents.length === 0) { void audioContext.close(); return; }

    const startingPitchMidi =
      patchedMelody.find(event => event.isAttack !== false)?.midi ?? null;
    const shouldCountIn = countInEnabled && startingPitchMidi !== null;
    const countInDuration = shouldCountIn ? bpm * beatSeconds : 0;

    if (shouldCountIn && startingPitchMidi !== null) {
      const beepDuration = Math.max(0.08, Math.min(0.12, beatSeconds * 0.5));
      for (let beat = 1; beat <= bpm; beat++) {
        const beepStart = startTime + (beat - 1) * beatSeconds;
        scheduleBeep(audioContext, startingPitchMidi, beepStart, beepDuration, beat === 1 ? 0.22 : 0.15);
      }
    }

    const melodyStartTime = startTime + countInDuration;
    let maxEndTime = melodyStartTime;
    const highlightTimerIds: number[] = [];

    for (const { event, melodyIndex } of playableEvents) {
      const durationBeats =
        typeof event.durationBeats === "number"
          ? event.durationBeats
          : event.duration === "whole" ? 4
          : event.duration === "half" ? 2
          : event.duration === "eighth" ? 0.5
          : 1;
      const durationSeconds = Math.max(0.08, durationBeats * beatSeconds);
      const onsetBeat = event.onsetBeat ?? event.beat;
      const absoluteBeats = (event.measure - 1) * bpm + (onsetBeat - 1);
      const noteStart = melodyStartTime + absoluteBeats * beatSeconds;
      const noteEnd = noteStart + durationSeconds;
      const highlightDelayMs = Math.max(0, Math.round((noteStart - audioContext.currentTime) * 1000));

      highlightTimerIds.push(
        window.setTimeout(() => setPlaybackHighlightIndex(melodyIndex), highlightDelayMs),
      );

      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = instrument;
      osc.frequency.setValueAtTime(midiToFrequency(event.midi), noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.linearRampToValueAtTime(0.18, noteStart + 0.02);
      gain.gain.setValueAtTime(0.16, Math.max(noteStart + 0.03, noteEnd - 0.03));
      gain.gain.linearRampToValueAtTime(0.0001, noteEnd);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(noteStart);
      osc.stop(noteEnd);
      maxEndTime = Math.max(maxEndTime, noteEnd);
    }

    const totalMs = Math.ceil((maxEndTime - audioContext.currentTime) * 1000) + 100;
    playbackRef.current = {
      context: audioContext,
      timerId: window.setTimeout(() => stop(), totalMs),
      highlightTimerIds,
    };
    setIsPlaying(true);
  };

  // Cleanup on unmount
  useEffect(() => () => stop(), []);

  return {
    isPlaying,
    playbackHighlightIndex,
    setPlaybackHighlightIndex,
    tempoBpm,
    setTempoBpm,
    countInEnabled,
    setCountInEnabled,
    instrument,
    setInstrument,
    play,
    stop,
  };
}
import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ExerciseSpec, MelodyEvent } from "../tat";

type StepMode = "diatonic" | "octave" | "chromatic";

export interface PitchPatchEntry {
  midi: number;
  pitch: string;
}

interface RenderableAttack {
  midi: number;
  noteId: string;
}

const KEY_TO_PC: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

const SHARP_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

function modeScale(mode: ExerciseSpec["mode"]): number[] {
  return mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
}

function midiToPc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function toOctave(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

function midiToDegree(midi: number, keyScale: number[]): number {
  const idx = keyScale.indexOf(midiToPc(midi));
  return idx === -1 ? 1 : idx + 1;
}

function noteKey(event: MelodyEvent, index: number): string {
  const onset = Number((event.onsetBeat ?? event.beat).toFixed(3));
  return `${event.measure}:${onset}:${event.chordId}:${index}`;
}

function applyPitchPatch(melody: MelodyEvent[], patch: Record<string, PitchPatchEntry>): MelodyEvent[] {
  return melody.map((event, index) => {
    if (event.isAttack === false) return event;
    const override = patch[noteKey(event, index)];
    if (!override) return event;
    return { ...event, midi: override.midi, pitch: override.pitch, octave: toOctave(override.midi), isEdited: true };
  });
}

function prefersFlatsForKey(key: ExerciseSpec["key"], mode: ExerciseSpec["mode"]): boolean {
  const majorFifths: Record<string, number> = {
    C: 0,
    G: 1,
    D: 2,
    A: 3,
    E: 4,
    B: 5,
    "F#": 6,
    "C#": 7,
    F: -1,
    Bb: -2,
    Eb: -3,
    Ab: -4,
    Db: -5,
    Gb: -6,
  };
  const minorFifths: Record<string, number> = {
    A: 0,
    E: 1,
    B: 2,
    "F#": 3,
    "C#": 4,
    "G#": 5,
    "D#": 6,
    D: -1,
    G: -2,
    C: -3,
    F: -4,
    Bb: -5,
    Eb: -6,
    Ab: -7,
  };
  const fifths = mode === "major" ? majorFifths[key] : minorFifths[key];
  return typeof fifths === "number" ? fifths < 0 : false;
}

function midiToPitch(midi: number, options?: { preferFlats?: boolean }): string {
  const names = options?.preferFlats ? FLAT_NOTE_NAMES : SHARP_NOTE_NAMES;
  return `${names[midiToPc(midi)]}${toOctave(midi)}`;
}

function nextScaleStepMidi(currentMidi: number, direction: 1 | -1, keyScale: number[]): number | null {
  for (let midi = currentMidi + direction; midi >= 0 && midi <= 127; midi += direction) {
    if (keyScale.includes(midiToPc(midi))) return midi;
  }
  return null;
}

function allPcCandidatesInRange(pc: number, minMidi: number, maxMidi: number): number[] {
  const result: number[] = [];
  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    if (midiToPc(midi) === pc) result.push(midi);
  }
  return result;
}

function tessituraRange(specInput: ExerciseSpec): { minMidi: number; maxMidi: number } {
  const tonicPc = KEY_TO_PC[specInput.key] ?? 0;
  const scale = modeScale(specInput.mode).map((step) => (tonicPc + step) % 12);
  const lowPc = scale[(specInput.range.lowDegree - 1 + 700) % 7] ?? tonicPc;
  const highPc = scale[(specInput.range.highDegree - 1 + 700) % 7] ?? tonicPc;
  const lowMidi = (specInput.range.lowOctave + 1) * 12 + lowPc;
  const highMidi = (specInput.range.highOctave + 1) * 12 + highPc;
  return { minMidi: Math.min(lowMidi, highMidi), maxMidi: Math.max(lowMidi, highMidi) };
}

function isIllegalTransition(
  prevDegree: number,
  currDegree: number,
  transitions: ExerciseSpec["illegalTransitions"],
): boolean {
  return transitions.some((r) => r.mode === "adjacent" && r.a === prevDegree && r.b === currDegree);
}

export function usePitchEdit(params: {
  currentMelody: MelodyEvent[];
  currentSpecSnapshot: ExerciseSpec | null;
  renderableAttacks?: RenderableAttack[];
  mode: "teacher" | "student" | "guest";
  markActivity: (reason: string) => void;
}) {
  const {
    currentMelody,
    currentSpecSnapshot,
    renderableAttacks: externalRenderableAttacks,
    mode,
    markActivity,
  } = params;

  const [pitchEditMode, setPitchEditMode] = useState<boolean>(false);
  const [selectionIndex, setSelectionIndex] = useState<number>(0);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState<string>("");
  const [pitchPatch, setPitchPatch] = useState<Record<string, PitchPatchEntry>>({});

  const renderableAttacks = useMemo<RenderableAttack[]>(() => {
    if (externalRenderableAttacks) return externalRenderableAttacks;
    if (currentMelody.length === 0) return [];
    const patched = applyPitchPatch(currentMelody, pitchPatch);
    return patched
      .map((event, index) => ({ midi: event.midi, noteId: noteKey(currentMelody[index], index), event }))
      .filter((entry) => entry.event.isAttack !== false)
      .sort(
        (a, b) =>
          a.event.measure - b.event.measure ||
          (a.event.onsetBeat ?? a.event.beat) - (b.event.onsetBeat ?? b.event.beat),
      )
      .map((entry) => ({ midi: entry.midi, noteId: entry.noteId }));
  }, [externalRenderableAttacks, currentMelody, pitchPatch]);

  useEffect(() => {
    if (renderableAttacks.length === 0) {
      if (selectedNoteId !== null) setSelectedNoteId(null);
      if (selectionIndex !== 0) setSelectionIndex(0);
      return;
    }
    const selectedIndex = selectedNoteId === null ? 0 : renderableAttacks.findIndex((a) => a.noteId === selectedNoteId);
    const resolvedIndex = selectedIndex >= 0 ? selectedIndex : Math.max(0, Math.min(selectionIndex, renderableAttacks.length - 1));
    if (resolvedIndex !== selectionIndex) setSelectionIndex(resolvedIndex);
    const nextId = renderableAttacks[resolvedIndex]?.noteId ?? null;
    if (nextId !== selectedNoteId) setSelectedNoteId(nextId);
  }, [renderableAttacks, selectedNoteId, selectionIndex]);

  const updatePitchPatchForCurrent = (nId: string, patch: PitchPatchEntry | null) => {
    setPitchPatch((prev) => {
      const next = { ...prev };
      if (patch) next[nId] = patch;
      else delete next[nId];
      return next;
    });
  };

  const validatePitchCandidate = (
    midiInput: number,
    selectedIdx: number,
    stepMode: StepMode,
    direction: 1 | -1,
    specSnapshot: ExerciseSpec,
  ): number | null => {
    const { minMidi, maxMidi } = tessituraRange(specSnapshot);
    const tonicPc = KEY_TO_PC[specSnapshot.key] ?? 0;
    const keyScale = modeScale(specSnapshot.mode).map((step) => (tonicPc + step) % 12);
    const maxLeap = Math.max(1, specSnapshot.userConstraints?.maxLeapSemitones ?? 12);
    const illegalDegreeSet = new Set(specSnapshot.illegalDegrees ?? []);
    const illegalIntervalSet = new Set(specSnapshot.illegalIntervalsSemis ?? []);
    const illegalTransitions = specSnapshot.illegalTransitions ?? [];
    const prevMidi = selectedIdx > 0 ? renderableAttacks[selectedIdx - 1]?.midi : null;
    const nextMidi = selectedIdx + 1 < renderableAttacks.length ? renderableAttacks[selectedIdx + 1]?.midi : null;

    const maxLeapViolation = (midi: number): number => {
      const prevGap = prevMidi === null ? 0 : Math.max(0, Math.abs(midi - prevMidi) - maxLeap);
      const nextGap = nextMidi === null ? 0 : Math.max(0, Math.abs(nextMidi - midi) - maxLeap);
      return Math.max(prevGap, nextGap);
    };
    const anyIllegalInterval = (midi: number): boolean => {
      const prev = prevMidi === null ? null : Math.abs(midi - prevMidi);
      const next = nextMidi === null ? null : Math.abs(nextMidi - midi);
      return (prev !== null && illegalIntervalSet.has(prev)) || (next !== null && illegalIntervalSet.has(next));
    };
    const anyIllegalTransition = (midi: number): boolean => {
      const degree = midiToDegree(midi, keyScale);
      const prevDegree = prevMidi === null ? null : midiToDegree(prevMidi, keyScale);
      const nextDegree = nextMidi === null ? null : midiToDegree(nextMidi, keyScale);
      return (
        (prevDegree !== null && isIllegalTransition(prevDegree, degree, illegalTransitions)) ||
        (nextDegree !== null && isIllegalTransition(degree, nextDegree, illegalTransitions))
      );
    };
    const satisfiesAll = (midi: number): boolean => {
      if (midi < minMidi || midi > maxMidi) return false;
      if (maxLeapViolation(midi) > 0) return false;
      if (illegalDegreeSet.has(midiToDegree(midi, keyScale))) return false;
      if (anyIllegalInterval(midi)) return false;
      if (anyIllegalTransition(midi)) return false;
      return true;
    };

    let midi = midiInput;
    if (midi < minMidi || midi > maxMidi) {
      if (stepMode === "chromatic") {
        midi = Math.max(minMidi, Math.min(maxMidi, midi));
      } else {
        const samePc = allPcCandidatesInRange(midiToPc(midi), minMidi, maxMidi);
        if (samePc.length === 0) return null;
        midi = samePc.reduce((best, c) => (Math.abs(c - midiInput) < Math.abs(best - midiInput) ? c : best));
      }
    }
    const leapGap = maxLeapViolation(midi);
    if (leapGap > 0) {
      if (stepMode !== "diatonic") return null;
      const extra = nextScaleStepMidi(midi, direction, keyScale);
      if (extra === null || extra < minMidi || extra > maxMidi || maxLeapViolation(extra) >= leapGap) return null;
      midi = extra;
    }
    for (const check of [
      () => illegalDegreeSet.has(midiToDegree(midi, keyScale)),
      () => anyIllegalInterval(midi),
      () => anyIllegalTransition(midi),
    ]) {
      if (check()) {
        const repaired = allPcCandidatesInRange(midiToPc(midi), minMidi, maxMidi).find((c) => satisfiesAll(c));
        if (typeof repaired !== "number") return null;
        midi = repaired;
      }
    }
    return satisfiesAll(midi) ? midi : null;
  };

  const attemptPitchStep = (selectedIdx: number, direction: 1 | -1, stepMode: StepMode) => {
    const selected = renderableAttacks[selectedIdx];
    if (!selected || !currentSpecSnapshot || currentMelody.length === 0) return;
    const tonicPc = KEY_TO_PC[currentSpecSnapshot.key] ?? 0;
    const keyScale = modeScale(currentSpecSnapshot.mode).map((step) => (tonicPc + step) % 12);
    let candidate: number | null = null;
    if (stepMode === "diatonic") candidate = nextScaleStepMidi(selected.midi, direction, keyScale);
    else if (stepMode === "octave") candidate = selected.midi + 12 * direction;
    else candidate = selected.midi + direction;
    if (candidate === null) return;
    const validated = validatePitchCandidate(candidate, selectedIdx, stepMode, direction, currentSpecSnapshot);
    if (validated === null) {
      setEditMessage("Move blocked by constraints");
      return;
    }
    setEditMessage("");
    const originalIndex = currentMelody.findIndex((event, i) => noteKey(event, i) === selected.noteId);
    if (originalIndex < 0) return;
    const isUnchanged = validated === currentMelody[originalIndex].midi;
    updatePitchPatchForCurrent(
      selected.noteId,
      isUnchanged
        ? null
        : {
            midi: validated,
            pitch: midiToPitch(validated, {
              preferFlats: prefersFlatsForKey(currentSpecSnapshot.key, currentSpecSnapshot.mode),
            }),
          },
    );
  };

  const handleNotationKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    if (!pitchEditMode || renderableAttacks.length === 0) return;
    if (mode === "student") markActivity("pitch-edit-key");
    if (event.key === "ArrowLeft") {
      const next = Math.max(0, selectionIndex - 1);
      setSelectionIndex(next);
      setSelectedNoteId(renderableAttacks[next]?.noteId ?? null);
      return;
    }
    if (event.key === "ArrowRight") {
      const next = Math.min(renderableAttacks.length - 1, selectionIndex + 1);
      setSelectionIndex(next);
      setSelectedNoteId(renderableAttacks[next]?.noteId ?? null);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const direction: 1 | -1 = event.key === "ArrowUp" ? 1 : -1;
    if (event.altKey) {
      if (currentSpecSnapshot?.chromatic !== true) return;
      attemptPitchStep(selectionIndex, direction, "chromatic");
      return;
    }
    if (event.shiftKey) {
      attemptPitchStep(selectionIndex, direction, "octave");
      return;
    }
    attemptPitchStep(selectionIndex, direction, "diatonic");
  };

  return {
    pitchEditMode,
    setPitchEditMode,
    selectionIndex,
    setSelectionIndex,
    selectedNoteId,
    setSelectedNoteId,
    editMessage,
    setEditMessage,
    pitchPatch,
    setPitchPatch,
    renderableAttacks,
    handleNotationKeyDown,
  };
}

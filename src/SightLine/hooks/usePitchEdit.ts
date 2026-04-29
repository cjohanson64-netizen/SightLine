import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  KEY_TO_PC,
  midiToPc,
  midiToPitch,
  noteKey,
  pitchOctaveForMidi,
  prefersFlatsForKey,
} from "../core/midi";
import {
  allPcCandidatesInRange,
  applyPitchPatch,
  midiToDegree,
  modeScale,
  nextScaleStepMidi,
  tessituraRange,
  type PitchPatchEntry,
} from "../core/scale";
import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";

type StepMode = "diatonic" | "octave" | "chromatic";

interface RenderableAttack {
  midi: number;
  noteId: string;
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
        : (() => {
            const pitch = midiToPitch(validated, {
              preferFlats: prefersFlatsForKey(currentSpecSnapshot.key, currentSpecSnapshot.mode),
              key: currentSpecSnapshot.key,
              mode: currentSpecSnapshot.mode,
            });
            return {
            midi: validated,
            pitch,
            octave: pitchOctaveForMidi(validated, {
              preferFlats: prefersFlatsForKey(currentSpecSnapshot.key, currentSpecSnapshot.mode),
              key: currentSpecSnapshot.key,
              mode: currentSpecSnapshot.mode,
            }),
          };
        })(),
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

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import ExerciseForm from "../components/ExerciseForm/ExerciseForm";
import NotationViewer from "../components/NotationViewer/NotationViewer";
import { generateExercise } from "../core/engine";
import { toMusicXmlFromMelody } from "../core/projection/toMusicXml";
import ErrorBanner from "../components/ErrorBanner/ErrorBanner";
import type { ExerciseSpec, MelodyEvent } from "../tat";
import Logo from "../assets/TAT Logo.svg";
import "../styles/App.css";

interface PitchPatchEntry {
  midi: number;
  pitch: string;
}

interface MelodyHistoryEntry {
  seed: number;
  baseTitle: string;
  title: string;
  logs: string[];
  relaxationNotice: string;
  melody: MelodyEvent[];
  beatsPerMeasure: number;
  specSnapshot: ExerciseSpec;
  pitchPatch: Record<string, PitchPatchEntry>;
}

const defaultSpec: ExerciseSpec = {
  title: "SightLine Melody",
  startingDegree: 1,
  key: "C",
  mode: "major",
  clef: "treble",
  range: {
    lowDegree: 1,
    highDegree: 1,
    lowOctave: 4,
    highOctave: 5,
  },
  phraseLengthMeasures: 4,
  phrases: [
    {
      label: "A",
      prime: false,
      cadence: "authentic",
    },
  ],
  timeSig: "4/4",
  chromatic: false,
  illegalDegrees: [],
  illegalIntervalsSemis: [],
  illegalTransitions: [],
  rhythmWeights: {
    whole: 15,
    half: 25,
    quarter: 30,
    eighth: 30,
    minEighthPairsPerPhrase: 1,
    preferEighthInPreClimax: true,
  },
  userConstraints: {
    startDegreeLocked: false,
    hardStartDo: false,
    cadenceType: "authentic",
    endOnDoHard: true,
    maxLeapSemitones: 12,
    minEighthPairsPerPhrase: 1,
    rhythmDist: { EE: 30, Q: 30, H: 25, W: 15 },
    allowedNoteValues: ["EE", "Q", "H"],
  },
};

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

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

type StepMode = "diatonic" | "octave" | "chromatic";

interface AttackView {
  event: MelodyEvent;
  midi: number;
  noteId: string;
}

function modeScale(mode: ExerciseSpec["mode"]): number[] {
  return mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
}

function midiToPc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function toOctave(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

function midiToPitch(midi: number): string {
  return `${NOTE_NAMES[midiToPc(midi)]}${toOctave(midi)}`;
}

function midiToDegree(midi: number, keyScale: number[]): number {
  const idx = keyScale.indexOf(midiToPc(midi));
  return idx === -1 ? 1 : idx + 1;
}

function isIllegalTransition(
  prevDegree: number,
  currDegree: number,
  transitions: ExerciseSpec["illegalTransitions"]
): boolean {
  return transitions.some((rule) => rule.mode === "adjacent" && rule.a === prevDegree && rule.b === currDegree);
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

function noteKey(event: MelodyEvent, index: number): string {
  const onset = Number((event.onsetBeat ?? event.beat).toFixed(3));
  return `${event.measure}:${onset}:${event.chordId}:${index}`;
}

function applyPitchPatch(melody: MelodyEvent[], patch: Record<string, PitchPatchEntry>): MelodyEvent[] {
  return melody.map((event, index) => {
    if (event.isAttack === false) {
      return event;
    }
    const key = noteKey(event, index);
    const override = patch[key];
    if (!override) {
      return event;
    }
    return {
      ...event,
      midi: override.midi,
      pitch: override.pitch,
      octave: toOctave(override.midi),
      isEdited: true,
      editedMidi: override.midi,
      editedPitch: override.pitch,
      originalMidi: event.midi,
    };
  });
}

function nextScaleStepMidi(currentMidi: number, direction: 1 | -1, keyScale: number[]): number | null {
  for (let midi = currentMidi + direction; midi >= 0 && midi <= 127; midi += direction) {
    if (keyScale.includes(midiToPc(midi))) {
      return midi;
    }
  }
  return null;
}

function allPcCandidatesInRange(pc: number, minMidi: number, maxMidi: number): number[] {
  const result: number[] = [];
  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    if (midiToPc(midi) === pc) {
      result.push(midi);
    }
  }
  return result;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

export default function App(): JSX.Element {
  const [spec, setSpec] = useState<ExerciseSpec>(defaultSpec);
  const [seed, setSeed] = useState<number>(20260219);
  const [musicXml, setMusicXml] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);
  const [history, setHistory] = useState<MelodyHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [error, setError] = useState<{
    title: string;
    message: string;
    suggestions: string[];
  } | null>(null);
  const [relaxationNotice, setRelaxationNotice] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [tempoBpm, setTempoBpm] = useState<number>(120);
  const [instrument, setInstrument] = useState<OscillatorType>("triangle");
  const [pitchEditMode, setPitchEditMode] = useState<boolean>(false);
  const [selectionIndex, setSelectionIndex] = useState<number>(0);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState<string>("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [showInstructions, setShowInstructions] = useState<boolean>(false);
  const playbackRef = useRef<{
    context: AudioContext;
    timerId: number | null;
  } | null>(null);
  const activeHistorySeed =
    historyIndex >= 0 ? history[historyIndex]?.seed : null;
  const activeHistoryTitle =
    historyIndex >= 0 ? history[historyIndex]?.title : spec.title;
  const currentHistoryEntry = historyIndex >= 0 ? history[historyIndex] : null;

  const relaxationMessage = (tier?: number): string => {
    const humanMessage =
      "A few settings were a bit too tight to finish the phrase. We loosened one so the melody could resolve smoothly. You can refine your settings and try again.";
    if (tier === 2) {
      return humanMessage;
    }
    return typeof tier === "number" && tier > 0 ? humanMessage : "";
  };

  const validateAllowedNoteValues = (
    nextSpec: ExerciseSpec,
  ): {
    title: string;
    message: string;
    suggestions: string[];
  } | null => {
    const allowed = nextSpec.userConstraints?.allowedNoteValues ?? [];
    if (allowed.length <= 3 && allowed.length > 0) {
      return null;
    }
    if (allowed.length === 0) {
      return {
        title: "Invalid Note Values",
        message: "Choose at least one allowed note value.",
        suggestions: ["Select 1 to 3 note values from EE, Q, H, W."],
      };
    }
    return {
      title: "Invalid Note Values",
      message: `You selected ${allowed.length} note values. Select at most 3.`,
      suggestions: ["Deselect one note value so only 1-3 remain."],
    };
  };

  const extractMelodyEvents = (artifact: {
    nodes: Array<{ kind: string; data: unknown }>;
  }): MelodyEvent[] =>
    artifact.nodes
      .filter((node) => node.kind === "leaf")
      .map((node) => node.data as Partial<MelodyEvent>)
      .filter(
        (data): data is MelodyEvent =>
          typeof data.midi === "number" &&
          typeof data.measure === "number" &&
          typeof data.duration === "string",
      )
      .sort(
        (a, b) =>
          a.measure - b.measure ||
          (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat),
      );

  const stopPlayback = () => {
    const playback = playbackRef.current;
    if (!playback) {
      return;
    }
    if (playback.timerId !== null) {
      window.clearTimeout(playback.timerId);
    }
    void playback.context.close();
    playbackRef.current = null;
    setIsPlaying(false);
  };

  const playCurrentMelody = () => {
    if (isPlaying) {
      stopPlayback();
      return;
    }

    const current = history[historyIndex];
    if (!current || current.melody.length === 0) {
      return;
    }

    const audioContext = new AudioContext();
    const beatSeconds = 60 / Math.max(30, Math.min(240, tempoBpm));
    const startTime = audioContext.currentTime + 0.05;
    const beatsPerMeasure = Math.max(1, current.beatsPerMeasure || 4);
    const playableEvents = applyPitchPatch(current.melody, current.pitchPatch)
      .filter((event) => event.isAttack !== false)
      .sort(
        (a, b) =>
          a.measure - b.measure ||
          (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat),
      );
    let maxEndTime = startTime;

    for (const event of playableEvents) {
      const durationBeats =
        typeof event.durationBeats === "number"
          ? event.durationBeats
          : event.duration === "whole"
            ? 4
            : event.duration === "half"
              ? 2
              : event.duration === "eighth"
                ? 0.5
                : 1;
      const durationSeconds = Math.max(0.08, durationBeats * beatSeconds);
      const onsetBeat = event.onsetBeat ?? event.beat;
      const absoluteBeats =
        (event.measure - 1) * beatsPerMeasure + (onsetBeat - 1);
      const noteStart = startTime + absoluteBeats * beatSeconds;
      const noteEnd = noteStart + durationSeconds;

      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = instrument;
      osc.frequency.setValueAtTime(
        440 * Math.pow(2, (event.midi - 69) / 12),
        noteStart,
      );
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.linearRampToValueAtTime(0.18, noteStart + 0.02);
      gain.gain.setValueAtTime(
        0.16,
        Math.max(noteStart + 0.03, noteEnd - 0.03),
      );
      gain.gain.linearRampToValueAtTime(0.0001, noteEnd);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(noteStart);
      osc.stop(noteEnd);
      maxEndTime = Math.max(maxEndTime, noteEnd);
    }

    const totalMs =
      Math.ceil((maxEndTime - audioContext.currentTime) * 1000) + 100;
    playbackRef.current = {
      context: audioContext,
      timerId: window.setTimeout(() => {
        stopPlayback();
      }, totalMs),
    };
    setIsPlaying(true);
  };

  useEffect(() => () => stopPlayback(), []);

  useEffect(() => {
    if (!showInstructions) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowInstructions(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showInstructions]);

  const currentPatchedMelody = useMemo<MelodyEvent[]>(() => {
    if (!currentHistoryEntry) {
      return [];
    }
    return applyPitchPatch(currentHistoryEntry.melody, currentHistoryEntry.pitchPatch);
  }, [currentHistoryEntry]);

  const renderableAttacks = useMemo<AttackView[]>(() => {
    if (!currentHistoryEntry) {
      return [];
    }
    const patched = applyPitchPatch(currentHistoryEntry.melody, currentHistoryEntry.pitchPatch);
    return patched
      .map((event, index) => ({
        event,
        midi: event.midi,
        noteId: noteKey(currentHistoryEntry.melody[index], index),
      }))
      .filter((entry) => entry.event.isAttack !== false)
      .sort(
        (a, b) =>
          a.event.measure - b.event.measure ||
          (a.event.onsetBeat ?? a.event.beat) - (b.event.onsetBeat ?? b.event.beat),
      );
  }, [currentHistoryEntry]);

  const selectedAttack = renderableAttacks[selectionIndex] ?? null;

  const selectedMelodyIndex = useMemo(() => {
    if (!selectedAttack || !currentHistoryEntry) {
      return -1;
    }
    return currentHistoryEntry.melody.findIndex((event, i) => noteKey(event, i) === selectedAttack.noteId);
  }, [currentHistoryEntry, selectedAttack]);

  const exportMusicXml = useMemo(() => {
    if (!currentHistoryEntry) {
      return musicXml;
    }
    return toMusicXmlFromMelody(currentHistoryEntry.specSnapshot as unknown as Record<string, unknown>, currentPatchedMelody);
  }, [currentHistoryEntry, currentPatchedMelody, musicXml]);

  const notationMusicXml = useMemo(() => {
    if (!currentHistoryEntry) {
      return musicXml;
    }
    return toMusicXmlFromMelody(
      currentHistoryEntry.specSnapshot as unknown as Record<string, unknown>,
      currentPatchedMelody,
      pitchEditMode && selectedMelodyIndex >= 0
        ? { highlightedMelodyIndex: selectedMelodyIndex, highlightColor: "#ff2da6" }
        : undefined,
    );
  }, [currentHistoryEntry, currentPatchedMelody, selectedMelodyIndex, pitchEditMode, musicXml]);

  const selectedOriginalAttack =
    selectedMelodyIndex >= 0 && currentHistoryEntry
      ? currentHistoryEntry.melody[selectedMelodyIndex]
      : null;

  const selectedEditLabel =
    selectedAttack && selectedOriginalAttack
      ? selectedAttack.midi === selectedOriginalAttack.midi
        ? "Edited: no"
        : `Edited: MIDI ${selectedOriginalAttack.midi} -> ${selectedAttack.midi}`
      : "Edited: no";

  const addHistoryEntry = (entry: Omit<MelodyHistoryEntry, "title">) => {
    setHistory((prev) => {
      const baseTitle = (entry.baseTitle || "SightLine Exercise").trim() || "SightLine Exercise";
      const nextCount = prev.filter((item) => item.baseTitle === baseTitle).length + 1;
      const titledEntry: MelodyHistoryEntry = {
        ...entry,
        title: `${baseTitle} #${nextCount}`,
        specSnapshot: {
          ...entry.specSnapshot,
          title: `${baseTitle} #${nextCount}`,
        },
      };
      const next = [...prev, titledEntry];
      setHistoryIndex(next.length - 1);
      return next;
    });
  };

  const loadHistoryIndex = (index: number) => {
    const entry = history[index];
    if (!entry) {
      return;
    }
    stopPlayback();
    setHistoryIndex(index);
    setSeed(entry.seed);
    setLogs(entry.logs);
    setRelaxationNotice(entry.relaxationNotice);
    setSelectionIndex(0);
    setSelectedNoteId(null);
    setEditMessage("");
    setError(null);
  };

  const deleteCurrentMelody = () => {
    if (historyIndex < 0 || historyIndex >= history.length) {
      return;
    }
    stopPlayback();
    setHistory((prev) => {
      const next = prev.filter((_, idx) => idx !== historyIndex);
      if (next.length === 0) {
        setHistoryIndex(-1);
        setMusicXml("");
        setLogs([]);
        setRelaxationNotice("");
        setSelectionIndex(0);
        setSelectedNoteId(null);
        setEditMessage("");
        setError(null);
      } else {
        const nextIndex = Math.min(historyIndex, next.length - 1);
        const entry = next[nextIndex];
        setHistoryIndex(nextIndex);
        setSeed(entry.seed);
        setLogs(entry.logs);
        setRelaxationNotice(entry.relaxationNotice);
        setSelectionIndex(0);
        setSelectedNoteId(null);
        setEditMessage("");
        setError(null);
      }
      return next;
    });
  };

  useEffect(() => {
    if (renderableAttacks.length === 0) {
      if (selectedNoteId !== null) {
        setSelectedNoteId(null);
      }
      if (selectionIndex !== 0) {
        setSelectionIndex(0);
      }
      return;
    }
    const selectedIndex =
      selectedNoteId === null
        ? 0
        : renderableAttacks.findIndex((attack) => attack.noteId === selectedNoteId);
    const resolvedIndex =
      selectedIndex >= 0
        ? selectedIndex
        : Math.max(0, Math.min(selectionIndex, renderableAttacks.length - 1));
    if (resolvedIndex !== selectionIndex) {
      setSelectionIndex(resolvedIndex);
    }
    const nextId = renderableAttacks[resolvedIndex]?.noteId ?? null;
    if (nextId !== selectedNoteId) {
      setSelectedNoteId(nextId);
    }
  }, [renderableAttacks, selectedNoteId, selectionIndex]);

  const updatePitchPatchForCurrent = (noteId: string, patch: PitchPatchEntry | null) => {
    if (historyIndex < 0) {
      return;
    }
    setHistory((prev) =>
      prev.map((entry, idx) => {
        if (idx !== historyIndex) {
          return entry;
        }
        const nextPatch = { ...entry.pitchPatch };
        if (patch) {
          nextPatch[noteId] = patch;
        } else {
          delete nextPatch[noteId];
        }
        return { ...entry, pitchPatch: nextPatch };
      }),
    );
  };

  const validatePitchCandidate = (
    midiInput: number,
    selectedIdx: number,
    stepMode: StepMode,
    direction: 1 | -1,
    entry: MelodyHistoryEntry,
  ): number | null => {
    const { minMidi, maxMidi } = tessituraRange(entry.specSnapshot);
    const tonicPc = KEY_TO_PC[entry.specSnapshot.key] ?? 0;
    const keyScale = modeScale(entry.specSnapshot.mode).map((step) => (tonicPc + step) % 12);
    const maxLeap = Math.max(1, entry.specSnapshot.userConstraints?.maxLeapSemitones ?? 12);
    const illegalDegreeSet = new Set(entry.specSnapshot.illegalDegrees ?? []);
    const illegalIntervalSet = new Set(entry.specSnapshot.illegalIntervalsSemis ?? []);
    const illegalTransitions = entry.specSnapshot.illegalTransitions ?? [];
    const prevMidi = selectedIdx > 0 ? renderableAttacks[selectedIdx - 1]?.midi : null;
    const nextMidi = selectedIdx + 1 < renderableAttacks.length ? renderableAttacks[selectedIdx + 1]?.midi : null;

    const maxLeapViolation = (midi: number): number => {
      const prevGap = prevMidi === null ? 0 : Math.max(0, Math.abs(midi - prevMidi) - maxLeap);
      const nextGap = nextMidi === null ? 0 : Math.max(0, Math.abs(nextMidi - midi) - maxLeap);
      return Math.max(prevGap, nextGap);
    };

    const anyIllegalInterval = (midi: number): boolean => {
      const prevInterval = prevMidi === null ? null : Math.abs(midi - prevMidi);
      const nextInterval = nextMidi === null ? null : Math.abs(nextMidi - midi);
      return (
        (prevInterval !== null && illegalIntervalSet.has(prevInterval)) ||
        (nextInterval !== null && illegalIntervalSet.has(nextInterval))
      );
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
      if (midi < minMidi || midi > maxMidi) {
        return false;
      }
      if (maxLeapViolation(midi) > 0) {
        return false;
      }
      if (illegalDegreeSet.has(midiToDegree(midi, keyScale))) {
        return false;
      }
      if (anyIllegalInterval(midi)) {
        return false;
      }
      if (anyIllegalTransition(midi)) {
        return false;
      }
      return true;
    };

    let midi = midiInput;
    if (midi < minMidi || midi > maxMidi) {
      if (stepMode === "chromatic") {
        midi = Math.max(minMidi, Math.min(maxMidi, midi));
      } else {
        const samePc = allPcCandidatesInRange(midiToPc(midi), minMidi, maxMidi);
        if (samePc.length === 0) {
          return null;
        }
        midi = samePc.reduce((best, candidate) =>
          Math.abs(candidate - midiInput) < Math.abs(best - midiInput) ? candidate : best,
        );
      }
    }

    const leapGap = maxLeapViolation(midi);
    if (leapGap > 0) {
      if (stepMode !== "diatonic") {
        return null;
      }
      const extra = nextScaleStepMidi(midi, direction, keyScale);
      if (extra === null || extra < minMidi || extra > maxMidi || maxLeapViolation(extra) >= leapGap) {
        return null;
      }
      midi = extra;
    }

    if (illegalDegreeSet.has(midiToDegree(midi, keyScale))) {
      const alternatives = allPcCandidatesInRange(midiToPc(midi), minMidi, maxMidi);
      const repaired = alternatives.find((candidate) => !illegalDegreeSet.has(midiToDegree(candidate, keyScale)) && satisfiesAll(candidate));
      if (typeof repaired !== "number") {
        return null;
      }
      midi = repaired;
    }

    if (anyIllegalInterval(midi)) {
      const alternatives = allPcCandidatesInRange(midiToPc(midi), minMidi, maxMidi);
      const repaired = alternatives.find((candidate) => !anyIllegalInterval(candidate) && satisfiesAll(candidate));
      if (typeof repaired !== "number") {
        return null;
      }
      midi = repaired;
    }

    if (anyIllegalTransition(midi)) {
      const alternatives = allPcCandidatesInRange(midiToPc(midi), minMidi, maxMidi);
      const repaired = alternatives.find((candidate) => !anyIllegalTransition(candidate) && satisfiesAll(candidate));
      if (typeof repaired !== "number") {
        return null;
      }
      midi = repaired;
    }

    return satisfiesAll(midi) ? midi : null;
  };

  const attemptPitchStep = (
    selectedIdx: number,
    direction: 1 | -1,
    stepMode: StepMode,
  ) => {
    const selected = renderableAttacks[selectedIdx];
    if (!selected || !currentHistoryEntry) {
      return;
    }
    const tonicPc = KEY_TO_PC[currentHistoryEntry.specSnapshot.key] ?? 0;
    const keyScale = modeScale(currentHistoryEntry.specSnapshot.mode).map((step) => (tonicPc + step) % 12);
    let candidate: number | null = null;
    if (stepMode === "diatonic") {
      candidate = nextScaleStepMidi(selected.midi, direction, keyScale);
    } else if (stepMode === "octave") {
      candidate = selected.midi + 12 * direction;
    } else {
      candidate = selected.midi + direction;
    }
    if (candidate === null) {
      return;
    }
    const validated = validatePitchCandidate(candidate, selectedIdx, stepMode, direction, currentHistoryEntry);
    if (validated === null) {
      setEditMessage("Move blocked by constraints");
      return;
    }
    setEditMessage("");
    const originalIndex = currentHistoryEntry.melody.findIndex((event, i) => noteKey(event, i) === selected.noteId);
    if (originalIndex < 0) {
      return;
    }
    const originalEvent = currentHistoryEntry.melody[originalIndex];
    const isUnchanged = validated === originalEvent.midi;
    updatePitchPatchForCurrent(
      selected.noteId,
      isUnchanged
        ? null
        : {
            midi: validated,
            pitch: midiToPitch(validated),
          },
    );
  };

  const handleNotationKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!event.key.startsWith("Arrow")) {
      return;
    }
    event.preventDefault();
    if (!pitchEditMode || renderableAttacks.length === 0) {
      return;
    }

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
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }

    const direction: 1 | -1 = event.key === "ArrowUp" ? 1 : -1;
    if (event.altKey) {
      const chromaticEnabled = currentHistoryEntry?.specSnapshot.chromatic === true;
      if (!chromaticEnabled) {
        return;
      }
      attemptPitchStep(selectionIndex, direction, "chromatic");
      return;
    }
    if (event.shiftKey) {
      attemptPitchStep(selectionIndex, direction, "octave");
      return;
    }
    attemptPitchStep(selectionIndex, direction, "diatonic");
  };

  const runWithNewSeed = () => {
    const nextSeed = randomSeed();
    const noteValuesError = validateAllowedNoteValues(spec);
    if (noteValuesError) {
      setError(noteValuesError);
      setMusicXml("");
      return;
    }
    setSeed(nextSeed);
    const output = generateExercise({ spec, seed: nextSeed });
    if (output.status === "no_solution") {
      setMusicXml("");
      setError(output.error);
      setRelaxationNotice("");
      setLogs(output.logs);
      return;
    }

    setMusicXml(output.musicXml);
    setLogs(output.logs);
    setError(null);
    const notice = relaxationMessage(output.relaxationTier);
    setRelaxationNotice(notice);
    setSelectionIndex(0);
    setSelectedNoteId(null);
    setEditMessage("");
    addHistoryEntry({
      seed: nextSeed,
      baseTitle: spec.title,
      logs: output.logs,
      relaxationNotice: notice,
      melody: extractMelodyEvents(output.artifact),
      beatsPerMeasure: Math.max(1, Number(spec.timeSig.split("/")[0]) || 4),
      specSnapshot: normalizeUserConstraintsInSpec(spec),
      pitchPatch: {},
    });
  };

  const rerunWithCurrentSeed = () => {
    const noteValuesError = validateAllowedNoteValues(spec);
    if (noteValuesError) {
      setError(noteValuesError);
      setMusicXml("");
      return;
    }
    const fixedSeed = seed;
    const output = generateExercise({ spec, seed: fixedSeed });
    if (output.status === "no_solution") {
      setMusicXml("");
      setError(output.error);
      setRelaxationNotice("");
      setLogs(output.logs);
      return;
    }

    setMusicXml(output.musicXml);
    setLogs(output.logs);
    setError(null);
    const notice = relaxationMessage(output.relaxationTier);
    setRelaxationNotice(notice);
    setSelectionIndex(0);
    setSelectedNoteId(null);
    setEditMessage("");
    addHistoryEntry({
      seed: fixedSeed,
      baseTitle: spec.title,
      logs: output.logs,
      relaxationNotice: notice,
      melody: extractMelodyEvents(output.artifact),
      beatsPerMeasure: Math.max(1, Number(spec.timeSig.split("/")[0]) || 4),
      specSnapshot: normalizeUserConstraintsInSpec(spec),
      pitchPatch: {},
    });
  };

  const handleExport = () => {
    if (!exportMusicXml) {
      return;
    }

    const blob = new Blob([exportMusicXml], {
      type: "application/vnd.recordare.musicxml+xml",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `exercise-${seed}.musicxml`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`AppShell ${theme === "light" ? "AppThemeLight" : "AppThemeDark"}`}
    >
      <header className="AppHeader">
        <img src={Logo} alt="Tat Logo" />
        <div>
          <h1 className="AppTitle">SightLine</h1>
          <p className="AppSubtitle">Build Viable Sight Singing Exercises In Seconds</p>
          <p className="AppSubtitle">Powered by TryAngleTree</p>
        </div>
      </header>
      <div className="AppMain">
        <div className="AppTopRow">
          <div className="AppNotationPane">
            {error ? (
              <ErrorBanner
                title={error.title}
                message={error.message}
                suggestions={error.suggestions}
              />
            ) : null}
            {relaxationNotice ? (
              <p className="AppRelaxationNotice">{relaxationNotice}</p>
            ) : null}
            <NotationViewer
              musicXml={notationMusicXml}
              onKeyDown={handleNotationKeyDown}
              focusTitle={
                pitchEditMode
                  ? "Pitch edit is on. Click to focus and use arrows."
                  : "Pitch edit is off."
              }
              headerControls={
                <div className="AppHistoryControls">
                  <div className="AppHistoryNav">
                    <button
                      type="button"
                      className="AppHistoryButton"
                      onClick={() => loadHistoryIndex(historyIndex - 1)}
                      disabled={historyIndex <= 0}
                      aria-label="Previous seeded melody"
                      title="Previous seeded melody"
                    >
                      ←
                    </button>
                    <span className="AppHistoryLabel">
                      {historyIndex >= 0
                        ? `Melody ${historyIndex + 1}/${history.length}  |  ID# ${activeHistorySeed ?? seed}  |  ${activeHistoryTitle}`
                        : "No seeded history"}
                    </span>
                    <button
                      type="button"
                      className="AppHistoryButton"
                      onClick={() => loadHistoryIndex(historyIndex + 1)}
                      disabled={
                        historyIndex < 0 || historyIndex >= history.length - 1
                      }
                      aria-label="Next seeded melody"
                      title="Next seeded melody"
                    >
                      →
                    </button>
                  </div>
                </div>
              }
            />
          </div>
          <aside className="AppMelodyPanel">
            <h3>Settings</h3>
            <div className="AppPlaybackControls AppPlaybackControlsPanel">
              <label className="AppHistoryLabel AppPlaybackField">
                Theme
                <select
                  value={theme}
                  onChange={(event) =>
                    setTheme(event.target.value as "dark" | "light")
                  }
                  aria-label="Theme mode"
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </label>
              <button
                type="button"
                className="AppHistoryButton AppPanelButtonWide"
                onClick={() => setShowInstructions(true)}
              >
                <span className="AppButtonLabelWithIcon">
                  Instructions{" "}
                  <span className="AppButtonIconHelp" aria-hidden="true">
                    ?
                  </span>
                </span>
              </button>
            </div>
            <div className="AppPanelSpacer" aria-hidden="true" />
            <h3>Melody Controls</h3>
            <div className="AppPanelButtons">
              <button
                type="button"
                className="AppHistoryButton AppPanelButtonWide"
                onClick={runWithNewSeed}
              >
                Generate Melody
              </button>
              <button
                type="button"
                className="AppHistoryButton AppPanelButtonWide"
                onClick={rerunWithCurrentSeed}
              >
                Fix Melody
              </button>
              <button
                type="button"
                className="AppHistoryButton AppPanelButtonWide"
                onClick={deleteCurrentMelody}
                disabled={historyIndex < 0}
              >
                Delete Melody
              </button>
              <button
                type="button"
                className="AppHistoryButton AppPanelButtonWide"
                onClick={handleExport}
                disabled={!exportMusicXml}
              >
                Export MusicXML
              </button>
            </div>
            <div className="AppPanelSpacer" aria-hidden="true" />
            <h3>Pitch Edit</h3>
            <div className="AppPanelButtons">
              <button
                type="button"
                className="AppHistoryButton AppPanelButtonWide"
                onClick={() => {
                  setPitchEditMode((prev) => !prev);
                  setEditMessage("");
                }}
                disabled={historyIndex < 0}
              >
                {pitchEditMode ? "Edit Pitches: On" : "Edit Pitches: Off"}
              </button>
              <p className="AppHistoryLabel">
                Selected:{" "}
                {selectedAttack
                  ? `m${selectedAttack.event.measure} b${(selectedAttack.event.onsetBeat ?? selectedAttack.event.beat).toFixed(1)} (${selectedAttack.event.pitch})`
                  : "none"}
              </p>
              <p className="AppHistoryLabel">{selectedEditLabel}</p>
              {editMessage ? <p className="AppHistoryLabel">{editMessage}</p> : null}
            </div>
            <div className="AppPlaybackControls AppPlaybackControlsPanel">
              <button
                type="button"
                className="AppHistoryButton"
                onClick={playCurrentMelody}
                disabled={historyIndex < 0}
                aria-label={isPlaying ? "Stop melody playback" : "Play melody"}
                title={isPlaying ? "Stop melody" : "Play melody"}
              >
                {isPlaying ? "■" : "▶"}
              </button>
              <label className="AppHistoryLabel AppPlaybackField">
                Tempo
                <input
                  type="number"
                  min={30}
                  max={240}
                  step={1}
                  value={tempoBpm}
                  onChange={(event) =>
                    setTempoBpm(
                      Math.max(
                        30,
                        Math.min(240, Number(event.target.value) || 120),
                      ),
                    )
                  }
                  aria-label="Playback tempo in BPM"
                />
              </label>
              <label className="AppHistoryLabel AppPlaybackField">
                Instrument
                <select
                  value={instrument}
                  onChange={(event) =>
                    setInstrument(event.target.value as OscillatorType)
                  }
                  aria-label="Playback instrument waveform"
                >
                  <option value="sine">SINE</option>
                  <option value="triangle">TRIANGLE</option>
                  <option value="square">SQUARE</option>
                  <option value="sawtooth">SAWTOOTH</option>
                </select>
              </label>
            </div>
          </aside>
        </div>
        <ExerciseForm
          spec={spec}
          onSpecChange={(next) => setSpec(normalizeUserConstraintsInSpec(next))}
          onRandomizeSeed={runWithNewSeed}
          onExport={handleExport}
          showActions={false}
        />
      </div>
      {showInstructions ? (
        <div
          className="AppModalBackdrop"
          onClick={() => setShowInstructions(false)}
          role="presentation"
        >
          <div
            className="AppModal"
            role="dialog"
            aria-modal="true"
            aria-label="How to use SightLine"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="AppModalClose"
              onClick={() => setShowInstructions(false)}
              aria-label="Close instructions"
              title="Close"
            >
              ×
            </button>
            <h3>How To Use SightLine</h3>
            <ol>
              <li>Set parameters in the bottom panel.</li>
              <li>
                Click <strong>Generate Melody</strong>.
              </li>
              <li>
                Use <strong>Fix Melody</strong> to regenerate the current melody
                with your updated parameters.
              </li>
              <li>Review notation and use ← / → to browse melody history.</li>
              <li>
                Toggle <strong>Edit Pitches</strong>, click the score, then use arrow keys to edit pitch only.
              </li>
              <li>Use Play, Tempo, and Instrument to hear your melody.</li>
              <li>
                Use Export MusicXML to download, or Delete Melody to remove the
                current one.
              </li>
            </ol>
          </div>
        </div>
      ) : null}
    </div>
  );
}
const normalizeUserConstraintsInSpec = (
  nextSpec: ExerciseSpec,
): ExerciseSpec => {
  const rhythmWeights = nextSpec.rhythmWeights ?? defaultSpec.rhythmWeights!;
  const inferredCadenceType: "authentic" | "half" =
    nextSpec.userConstraints?.cadenceType ??
    ((nextSpec.phrases[nextSpec.phrases.length - 1]?.cadence ?? "authentic") ===
    "half"
      ? "half"
      : "authentic");
  return {
    ...nextSpec,
    userConstraints: {
      startDegreeLocked: nextSpec.userConstraints?.startDegreeLocked === true,
      hardStartDo: nextSpec.userConstraints?.hardStartDo === true,
      cadenceType: inferredCadenceType,
      endOnDoHard:
        nextSpec.userConstraints?.endOnDoHard ?? inferredCadenceType !== "half",
      maxLeapSemitones: Math.max(
        1,
        nextSpec.userConstraints?.maxLeapSemitones ?? 12,
      ),
      minEighthPairsPerPhrase: Math.max(
        0,
        nextSpec.userConstraints?.minEighthPairsPerPhrase ??
          rhythmWeights.minEighthPairsPerPhrase ??
          0,
      ),
      allowedNoteValues: Array.from(
        new Set(
          nextSpec.userConstraints?.allowedNoteValues ?? ["EE", "Q", "H"],
        ),
      ) as Array<"EE" | "Q" | "H" | "W">,
      rhythmDist: nextSpec.userConstraints?.rhythmDist ?? {
        EE: rhythmWeights.eighth,
        Q: rhythmWeights.quarter,
        H: rhythmWeights.half,
        W: rhythmWeights.whole,
      },
    },
  };
};

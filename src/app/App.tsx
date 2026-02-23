import { useEffect, useMemo, useRef, useState } from "react";
import ExerciseForm from "../components/ExerciseForm/ExerciseForm";
import NotationViewer from "../components/NotationViewer/NotationViewer";
import { generateExercise } from "../core/engine";
import ErrorBanner from "../components/ErrorBanner/ErrorBanner";
import type { ExerciseSpec, MelodyEvent } from "../tat";
import Logo from "../assets/TAT Logo.svg";
import "../styles/App.css";

interface MelodyHistoryEntry {
  seed: number;
  title: string;
  musicXml: string;
  logs: string[];
  relaxationNotice: string;
  melody: MelodyEvent[];
  beatsPerMeasure: number;
}

const defaultSpec: ExerciseSpec = {
  title: "SlightLine Sight Singing Exercise",
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
    const playableEvents = [...current.melody]
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

  const generated = useMemo(() => {
    if (!musicXml) {
      return null;
    }

    return { musicXml, logs };
  }, [musicXml, logs]);

  const addHistoryEntry = (entry: MelodyHistoryEntry) => {
    setHistory((prev) => {
      const next = [...prev, entry];
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
    setMusicXml(entry.musicXml);
    setLogs(entry.logs);
    setRelaxationNotice(entry.relaxationNotice);
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
        setError(null);
      } else {
        const nextIndex = Math.min(historyIndex, next.length - 1);
        const entry = next[nextIndex];
        setHistoryIndex(nextIndex);
        setSeed(entry.seed);
        setMusicXml(entry.musicXml);
        setLogs(entry.logs);
        setRelaxationNotice(entry.relaxationNotice);
        setError(null);
      }
      return next;
    });
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
    addHistoryEntry({
      seed: nextSeed,
      title: spec.title,
      musicXml: output.musicXml,
      logs: output.logs,
      relaxationNotice: notice,
      melody: extractMelodyEvents(output.artifact),
      beatsPerMeasure: Math.max(1, Number(spec.timeSig.split("/")[0]) || 4),
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
    addHistoryEntry({
      seed: fixedSeed,
      title: spec.title,
      musicXml: output.musicXml,
      logs: output.logs,
      relaxationNotice: notice,
      melody: extractMelodyEvents(output.artifact),
      beatsPerMeasure: Math.max(1, Number(spec.timeSig.split("/")[0]) || 4),
    });
  };

  const handleExport = () => {
    if (!musicXml) {
      return;
    }

    const blob = new Blob([musicXml], {
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
              musicXml={generated?.musicXml ?? ""}
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
                disabled={!musicXml}
              >
                Export MusicXML
              </button>
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

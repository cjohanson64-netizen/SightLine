import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { usePlayback } from "../hooks/usePlayback";
import { useProjection } from "../hooks/useProjection";
import { useSolfege } from "../hooks/useSolfege";

type PlaybackState = ReturnType<typeof usePlayback>;
type ProjectionState = ReturnType<typeof useProjection>;
type SolfegeState = ReturnType<typeof useSolfege>;

interface GeneratorNotationControlsProps {
  assessmentPlaybackDisabled: boolean;
  currentMelodyCount: number;
  exportMusicXml: string;
  interactionDisabled: boolean;
  isGuestMode: boolean;
  onExport: () => void;
  pitchEditMode: boolean;
  playback: Pick<
    PlaybackState,
    | "countInEnabled"
    | "instrument"
    | "isPlaying"
    | "play"
    | "setCountInEnabled"
    | "setInstrument"
    | "setTempoBpm"
    | "tempoBpm"
  >;
  projection: Pick<ProjectionState, "toggle">;
  setEditMessage: (value: string) => void;
  setPitchEditMode: Dispatch<SetStateAction<boolean>>;
  solfege: Pick<
    SolfegeState,
    | "setSolfegeColorizeMode"
    | "setSolfegeMode"
    | "solfegeColorizeMode"
    | "solfegeMode"
  >;
  teacherFeaturesDisabled: boolean;
}

export default function GeneratorNotationControls({
  assessmentPlaybackDisabled,
  currentMelodyCount,
  exportMusicXml,
  interactionDisabled,
  isGuestMode,
  onExport,
  pitchEditMode,
  playback,
  projection,
  setEditMessage,
  setPitchEditMode,
  solfege,
  teacherFeaturesDisabled,
}: GeneratorNotationControlsProps): JSX.Element {
  const overlayValue =
    solfege.solfegeMode === "off" ? "off" : solfege.solfegeColorizeMode;
  const [tempoInput, setTempoInput] = useState(String(playback.tempoBpm));

  useEffect(() => {
    setTempoInput(String(playback.tempoBpm));
  }, [playback.tempoBpm]);

  return (
    <div className="AppPlaybackControls">
      <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField AppPlaybackControlsField">
        Tempo
        <input
          type="number"
          min={30}
          max={240}
          step={1}
          value={tempoInput}
          onChange={(event) => {
            const nextValue = event.target.value;
            setTempoInput(nextValue);
            if (nextValue === "") {
              return;
            }
            const parsed = Number(nextValue);
            if (Number.isFinite(parsed)) {
              playback.setTempoBpm(parsed);
            }
          }}
          onBlur={() => {
            const parsed = Number(tempoInput);
            const normalized = Number.isFinite(parsed)
              ? Math.max(30, Math.min(240, parsed))
              : Math.max(30, Math.min(240, playback.tempoBpm || 80));
            playback.setTempoBpm(normalized);
            setTempoInput(String(normalized));
          }}
          disabled={interactionDisabled || assessmentPlaybackDisabled}
        />
      </label>
      <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField AppPlaybackControlsField">
        Instrument
        <select
          value={playback.instrument}
          onChange={(event) =>
            playback.setInstrument(event.target.value as OscillatorType)
          }
          disabled={interactionDisabled || assessmentPlaybackDisabled}
        >
          <option value="sine">SINE</option>
          <option value="triangle">TRIANGLE</option>
          <option value="square">SQUARE</option>
          <option value="sawtooth">SAWTOOTH</option>
        </select>
      </label>
      <button
        type="button"
        className="AppHistoryButton AppProjectionToggleButton"
        onClick={() => playback.play()}
        disabled={currentMelodyCount === 0 || assessmentPlaybackDisabled}
        data-allow-while-playing="true"
      >
        {playback.isPlaying ? "Stop" : "Play"}
      </button>
      <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField AppCountInField AppPlaybackControlsField">
        Count-in
        <input
          type="checkbox"
          className="AppLibraryCheckbox AppCountInCheckbox"
          checked={playback.countInEnabled}
          onChange={(event) => playback.setCountInEnabled(event.target.checked)}
          disabled={interactionDisabled || assessmentPlaybackDisabled}
        />
      </label>
      <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField AppCountInField AppPlaybackControlsField">
        Show Solfege
        <input
          type="checkbox"
          className="AppLibraryCheckbox AppCountInCheckbox"
          checked={solfege.solfegeMode !== "off"}
          onChange={(event) =>
            solfege.setSolfegeMode(event.target.checked ? "movable" : "off")
          }
          disabled={interactionDisabled}
        />
      </label>
      <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField AppPlaybackControlsField">
        Colorize
        <select
          value={overlayValue}
          onChange={(event) => {
            const next = event.target.value;
            if (solfege.solfegeMode === "off") {
              solfege.setSolfegeMode("movable");
            }
            solfege.setSolfegeColorizeMode(next as "off" | "lyrics" | "full");
          }}
          disabled={interactionDisabled}
        >
          <option value="off">Off</option>
          <option value="lyrics">Lyrics only</option>
          <option value="full">Full</option>
        </select>
      </label>
      <button
        type="button"
        className="AppHistoryButton AppProjectionToggleButton"
        onClick={() => {
          setPitchEditMode((prev) => !prev);
          setEditMessage("");
        }}
        disabled={interactionDisabled}
      >
        {pitchEditMode ? "Disable Pitch Edit" : "Enable Pitch Edit"}
      </button>
      <button
        type="button"
        className="AppHistoryButton AppProjectionToggleButton"
        onClick={() => {
          if (!isGuestMode && !teacherFeaturesDisabled) {
            onExport();
          }
        }}
        disabled={
          interactionDisabled ||
          isGuestMode ||
          teacherFeaturesDisabled ||
          !exportMusicXml
        }
        title={teacherFeaturesDisabled ? "Upgrade required" : undefined}
      >
        Export MusicXML
        {teacherFeaturesDisabled ? (
          <span
            className="UpgradeFeatureMarker"
            aria-label="Upgrade To Enable Feature"
            title="Upgrade To Enable Feature"
          />
        ) : null}
      </button>
      <button
        type="button"
        className="AppHistoryButton AppProjectionToggleButton"
        onClick={() => void projection.toggle()}
        disabled={interactionDisabled}
      >
        Projection
      </button>
      {assessmentPlaybackDisabled ? (
        <span className="AppHistoryLabel AppPlaybackDisabledNotice">
          Playback is disabled while SightLine is listening.
        </span>
      ) : null}
    </div>
  );
}

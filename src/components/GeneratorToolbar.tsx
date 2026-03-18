import { useState } from "react";
import type { FolderItem } from "../hooks/useTeacherLibrary";

type Mode = "teacher" | "student" | "guest";
type SolfegeMode = "off" | "movable" | "fixed";

type SaveMenuProps = {
  showUpdate: boolean;
  disabled: boolean;
  disabledTitle?: string;
  onSaveNew: () => void;
  onUpdate: () => void;
};

function UpgradeMarker(): JSX.Element {
  return (
    <span
      className="UpgradeFeatureMarker"
      aria-label="Upgrade To Enable Feature"
      title="Upgrade To Enable Feature"
    />
  );
}

function SaveMenu({
  showUpdate,
  disabled,
  disabledTitle,
  onSaveNew,
  onUpdate,
}: SaveMenuProps): JSX.Element {
  const [value, setValue] = useState("save");

  return (
    <label className="ToolbarMenuField" title={disabled ? disabledTitle : ""}>
      <span className="ToolbarMenuLabel">
        Save
        {disabled ? <UpgradeMarker /> : null}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          setValue("save");
          if (next === "save-new") onSaveNew();
          if (next === "update") onUpdate();
        }}
      >
        <option value="save">Save...</option>
        <option value="save-new">Save New</option>
        {showUpdate ? <option value="update">Update</option> : null}
      </select>
    </label>
  );
}

type GeneratorToolbarProps = {
  mode: Mode;
  teacherFeaturesDisabled: boolean;
  upgradeRequiredTitle: string;
  folders: FolderItem[];
  selectedFolderId: string;
  onSelectFolderId: (value: string) => void;
  creatingFolder: boolean;
  studentClassName: string | null;
  titleValue: string;
  titlePlaceholder: string;
  onTitleChange: (value: string) => void;
  onGenerate: () => void;
  onGenerateTetrachord: () => void;
  onFix: () => void;
  fixDisabled: boolean;
  showUpdateSave: boolean;
  saveDisabled: boolean;
  onSaveNew: () => void;
  onSaveUpdate: () => void;
  onToggleProjection: () => void;
  onOpenHelp: () => void;
  onOpenPreferences: () => void;
  onExportMusicXml: () => void;
  onTogglePitchEdit: () => void;
  pitchEditEnabled: boolean;
  studentSubmitLabel?: string;
  onStudentSubmit?: () => void;
  studentSubmitDisabled?: boolean;
  tempoBpm: number;
  onTempoBpmChange: (value: number) => void;
  instrument: OscillatorType;
  onInstrumentChange: (value: OscillatorType) => void;
  countInEnabled: boolean;
  onCountInEnabledChange: (value: boolean) => void;
  isPlaying: boolean;
  onPlayToggle: () => void;
  playDisabled: boolean;
  solfegeMode: SolfegeMode;
  onSolfegeModeChange: (value: SolfegeMode) => void;
  solfegeOverlayMode: boolean;
  onSolfegeOverlayModeChange: (value: boolean) => void;
};

export default function GeneratorToolbar({
  mode,
  teacherFeaturesDisabled,
  upgradeRequiredTitle,
  folders,
  selectedFolderId,
  onSelectFolderId,
  creatingFolder,
  studentClassName,
  titleValue,
  titlePlaceholder,
  onTitleChange,
  onGenerate,
  onGenerateTetrachord,
  onFix,
  fixDisabled,
  showUpdateSave,
  saveDisabled,
  onSaveNew,
  onSaveUpdate,
  onToggleProjection,
  onOpenHelp,
  onOpenPreferences,
  onExportMusicXml,
  onTogglePitchEdit,
  pitchEditEnabled,
  studentSubmitLabel,
  onStudentSubmit,
  studentSubmitDisabled = false,
  tempoBpm,
  onTempoBpmChange,
  instrument,
  onInstrumentChange,
  countInEnabled,
  onCountInEnabledChange,
  isPlaying,
  onPlayToggle,
  playDisabled,
  solfegeMode,
  onSolfegeModeChange,
  solfegeOverlayMode,
  onSolfegeOverlayModeChange,
}: GeneratorToolbarProps): JSX.Element {
  const overlayValue =
    solfegeMode === "off" ? "off" : solfegeOverlayMode ? "full" : "lyrics";

  return (
    <div className="GeneratorToolbar">
      <div className="ToolbarRow">
        <div className="ToolbarGroup ToolbarGroup--class">
          {mode === "teacher" ? (
            <label
              className="AppHistoryLabel AppPlaybackField ToolbarField ToolbarClassField"
              title={teacherFeaturesDisabled ? upgradeRequiredTitle : ""}
            >
              <span className="ToolbarInlineLabel">
                Class
                {teacherFeaturesDisabled ? <UpgradeMarker /> : null}
              </span>
              <select
                value={selectedFolderId}
                onChange={(event) => onSelectFolderId(event.target.value)}
                disabled={creatingFolder || teacherFeaturesDisabled}
              >
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {mode === "student" && studentClassName ? (
            <span className="AppHistoryLabel ToolbarStaticText">
              Class: {studentClassName}
            </span>
          ) : null}
        </div>
      </div>

      <div className="ToolbarRow">
        <div className="ToolbarGroup ToolbarGroup--context">
          <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField ToolbarTitleField">
            Title
            <input
              className="AppExerciseTitleInput"
              type="text"
              value={titleValue}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder={titlePlaceholder}
            />
          </label>
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton ToolbarWideButton"
            onClick={onOpenPreferences}
          >
            Melody Preferences
          </button>
        </div>

        <div className="ToolbarGroup ToolbarGroup--primary">
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={onGenerate}
          >
            Generate
          </button>
          {mode === "student" && onStudentSubmit ? (
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton"
              onClick={onStudentSubmit}
              disabled={studentSubmitDisabled}
            >
              {studentSubmitLabel ?? "Submit"}
            </button>
          ) : null}
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={onFix}
            disabled={fixDisabled}
          >
            Fix
          </button>
          {mode === "teacher" ? (
            <SaveMenu
              showUpdate={showUpdateSave}
              disabled={saveDisabled || teacherFeaturesDisabled}
              disabledTitle={teacherFeaturesDisabled ? upgradeRequiredTitle : ""}
              onSaveNew={onSaveNew}
              onUpdate={onSaveUpdate}
            />
          ) : null}
        </div>

        <div className="ToolbarSpacer" />

        <div className="ToolbarGroup ToolbarGroup--utilities">
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={onToggleProjection}
          >
            Projection
          </button>
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={onOpenHelp}
          >
            Help
          </button>
        </div>
      </div>

      <div className="ToolbarRow">
        <div className="ToolbarGroup ToolbarGroup--playback">
          <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField ToolbarField">
            Tempo
            <input
              type="number"
              min={30}
              max={240}
              step={1}
              value={tempoBpm}
              onChange={(event) =>
                onTempoBpmChange(
                  Math.max(30, Math.min(240, Number(event.target.value) || 80)),
                )
              }
            />
          </label>
          <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField ToolbarField">
            Instrument
            <select
              value={instrument}
              onChange={(event) => onInstrumentChange(event.target.value as OscillatorType)}
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
            onClick={onPlayToggle}
            disabled={playDisabled}
          >
            {isPlaying ? "Stop" : "Play"}
          </button>
          <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField AppCountInField ToolbarField">
            Count-in
            <input
              type="checkbox"
              className="AppLibraryCheckbox AppCountInCheckbox"
              checked={countInEnabled}
              onChange={(event) => onCountInEnabledChange(event.target.checked)}
            />
          </label>
        </div>

        <div className="ToolbarSpacer" />

        <div className="ToolbarGroup ToolbarGroup--notation">
          <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField AppCountInField ToolbarField">
            Movable Do
            <input
              type="checkbox"
              className="AppLibraryCheckbox AppCountInCheckbox"
              checked={solfegeMode !== "off"}
              onChange={(event) =>
                onSolfegeModeChange(event.target.checked ? "movable" : "off")
              }
            />
          </label>
          <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField ToolbarField">
            Colorize
            <select
              value={overlayValue}
              onChange={(event) => {
                const next = event.target.value;
                if (next === "off") {
                  onSolfegeModeChange("off");
                  onSolfegeOverlayModeChange(false);
                  return;
                }
                if (solfegeMode === "off") {
                  onSolfegeModeChange("movable");
                }
                onSolfegeOverlayModeChange(next === "full");
              }}
            >
              <option value="off">Off</option>
              <option value="lyrics">Lyrics only</option>
              <option value="full">Full</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

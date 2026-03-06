import { useState } from "react";
import type { FolderItem } from "../hooks/useTeacherLibrary";

type Mode = "teacher" | "student" | "guest";
type SolfegeMode = "off" | "movable" | "fixed";
type SolfegeAccidentalMode = "diatonic" | "chromatic";

type SaveMenuProps = {
  showUpdate: boolean;
  disabled: boolean;
  disabledTitle?: string;
  onSaveNew: () => void;
  onUpdate: () => void;
};

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
      <span className="ToolbarMenuLabel">Save</span>
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

type MoreMenuProps = {
  onOpenPreferences: () => void;
  onExportMusicXml: () => void;
  onExportPacketPdf: () => void;
  onExportMusicXmlZip: () => void;
  canExportPacket: boolean;
  onOpenDashboard: () => void;
  onOpenClassAccess: () => void;
  onTogglePitchEdit: () => void;
  pitchEditEnabled: boolean;
};

function MoreMenu({
  onOpenPreferences,
  onExportMusicXml,
  onExportPacketPdf,
  onExportMusicXmlZip,
  canExportPacket,
  onOpenDashboard,
  onOpenClassAccess,
  onTogglePitchEdit,
  pitchEditEnabled,
}: MoreMenuProps): JSX.Element {
  const [value, setValue] = useState("more");

  return (
    <label className="ToolbarMenuField">
      <span className="ToolbarMenuLabel">More</span>
      <select
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          setValue("more");
          if (next === "preferences") onOpenPreferences();
          if (next === "export-xml") onExportMusicXml();
          if (next === "export-packet-pdf") onExportPacketPdf();
          if (next === "export-packet-zip") onExportMusicXmlZip();
          if (next === "dashboard") onOpenDashboard();
          if (next === "class-access") onOpenClassAccess();
          if (next === "pitch-edit") onTogglePitchEdit();
        }}
      >
        <option value="more">...</option>
        <option value="preferences">Melody Preferences</option>
        <option value="pitch-edit">
          {pitchEditEnabled ? "Disable Pitch Edit" : "Enable Pitch Edit"}
        </option>
        <option value="export-xml">Export MusicXML</option>
        <option value="export-packet-pdf" disabled={!canExportPacket}>
          Export Packet PDF
        </option>
        <option value="export-packet-zip" disabled={!canExportPacket}>
          Export MusicXML ZIP
        </option>
        <option value="dashboard">Open Dashboard</option>
        <option value="class-access">Open Class Access</option>
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
  onFix: () => void;
  fixDisabled: boolean;
  showUpdateSave: boolean;
  saveDisabled: boolean;
  onSaveNew: () => void;
  onSaveUpdate: () => void;
  onBatchGenerate: () => void;
  batchDisabled: boolean;
  onToggleProjection: () => void;
  onOpenHelp: () => void;
  onOpenPreferences: () => void;
  onExportMusicXml: () => void;
  onExportPacketPdf: () => void;
  onExportMusicXmlZip: () => void;
  canExportPacket: boolean;
  onOpenDashboard: () => void;
  onOpenClassAccess: () => void;
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
  solfegeAccidentalMode: SolfegeAccidentalMode;
  onSolfegeAccidentalModeChange: (value: SolfegeAccidentalMode) => void;
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
  onFix,
  fixDisabled,
  showUpdateSave,
  saveDisabled,
  onSaveNew,
  onSaveUpdate,
  onBatchGenerate,
  batchDisabled,
  onToggleProjection,
  onOpenHelp,
  onOpenPreferences,
  onExportMusicXml,
  onExportPacketPdf,
  onExportMusicXmlZip,
  canExportPacket,
  onOpenDashboard,
  onOpenClassAccess,
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
  solfegeAccidentalMode,
  onSolfegeAccidentalModeChange,
  solfegeOverlayMode,
  onSolfegeOverlayModeChange,
}: GeneratorToolbarProps): JSX.Element {
  const overlayValue =
    solfegeMode === "off" ? "off" : solfegeOverlayMode ? "full" : "lyrics";

  return (
    <div className="GeneratorToolbar">
      <div className="ToolbarRow">
        <div className="ToolbarGroup ToolbarGroup--context">
          {mode === "teacher" ? (
            <label
              className="AppHistoryLabel AppPlaybackField ToolbarField ToolbarClassField"
              title={teacherFeaturesDisabled ? upgradeRequiredTitle : ""}
            >
              Class
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
          {mode === "teacher" ? (
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton"
              onClick={onBatchGenerate}
              disabled={batchDisabled || teacherFeaturesDisabled}
              title={teacherFeaturesDisabled ? upgradeRequiredTitle : ""}
            >
              Batch Generate
            </button>
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
          <MoreMenu
            onOpenPreferences={onOpenPreferences}
            onExportMusicXml={onExportMusicXml}
            onExportPacketPdf={onExportPacketPdf}
            onExportMusicXmlZip={onExportMusicXmlZip}
            canExportPacket={canExportPacket}
            onOpenDashboard={onOpenDashboard}
            onOpenClassAccess={onOpenClassAccess}
            onTogglePitchEdit={onTogglePitchEdit}
            pitchEditEnabled={pitchEditEnabled}
          />
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
          <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField AppCountInField ToolbarField">
            Count-in
            <input
              type="checkbox"
              className="AppLibraryCheckbox AppCountInCheckbox"
              checked={countInEnabled}
              onChange={(event) => onCountInEnabledChange(event.target.checked)}
            />
          </label>
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={onPlayToggle}
            disabled={playDisabled}
          >
            {isPlaying ? "Stop" : "Play"}
          </button>
        </div>

        <div className="ToolbarSpacer" />

        <div className="ToolbarGroup ToolbarGroup--notation">
          <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField ToolbarField">
            Solfege
            <select
              value={solfegeMode}
              onChange={(event) => onSolfegeModeChange(event.target.value as SolfegeMode)}
            >
              <option value="off">Off</option>
              <option value="movable">Movable Do</option>
              <option value="fixed">Fixed Do</option>
            </select>
          </label>
          <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField ToolbarField">
            Accidentals
            <select
              value={solfegeAccidentalMode}
              onChange={(event) =>
                onSolfegeAccidentalModeChange(
                  event.target.value as SolfegeAccidentalMode,
                )
              }
              disabled={solfegeMode === "off"}
            >
              <option value="diatonic">Diatonic only</option>
              <option value="chromatic">Chromatic</option>
            </select>
          </label>
          <label className="AppHistoryLabel AppPlaybackField AppToolbarCompactField ToolbarField">
            Overlay
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

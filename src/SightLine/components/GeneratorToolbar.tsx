import { useState } from "react";
import type { FolderItem } from "../hooks/useTeacherLibrary";

type Mode = "teacher" | "student" | "guest";

type SaveMenuProps = {
  showUpdate: boolean;
  disabled: boolean;
  upgradeLocked?: boolean;
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
  upgradeLocked = false,
  disabledTitle,
  onSaveNew,
  onUpdate,
}: SaveMenuProps): JSX.Element {
  const [value, setValue] = useState("save");

  return (
    <label className="ToolbarMenuField" title={disabled ? disabledTitle : ""}>
      <span className="ToolbarMenuLabel">
        Save
        {upgradeLocked ? <UpgradeMarker /> : null}
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
  interactionDisabled: boolean;
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
  showUpdateSave: boolean;
  saveDisabled: boolean;
  onSaveNew: () => void;
  onSaveUpdate: () => void;
  onOpenPreferences: () => void;
  onExportMusicXml: () => void;
  onTogglePitchEdit: () => void;
  pitchEditEnabled: boolean;
  studentSubmitLabel?: string;
  onStudentSubmit?: () => void;
  studentSubmitDisabled?: boolean;
  onAssess: () => void;
  assessDisabled?: boolean;
};

export default function GeneratorToolbar({
  mode,
  interactionDisabled,
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
  showUpdateSave,
  saveDisabled,
  onSaveNew,
  onSaveUpdate,
  onOpenPreferences,
  onExportMusicXml,
  onTogglePitchEdit,
  pitchEditEnabled,
  studentSubmitLabel,
  onStudentSubmit,
  studentSubmitDisabled = false,
  onAssess,
  assessDisabled = false,
}: GeneratorToolbarProps): JSX.Element {
  const controlsDisabled = interactionDisabled;
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
                disabled={
                  controlsDisabled || creatingFolder || teacherFeaturesDisabled
                }
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
              disabled={controlsDisabled}
            />
          </label>
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton ToolbarWideButton"
            onClick={onOpenPreferences}
            disabled={controlsDisabled}
          >
            Melody Preferences
          </button>
        </div>

        <div className="ToolbarGroup ToolbarGroup--primary">
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton ToolbarGenerateButton"
            onClick={onGenerate}
            disabled={controlsDisabled}
          >
            Generate
          </button>
          {mode === "student" && onStudentSubmit ? (
            <button
              type="button"
              className="AppHistoryButton AppProjectionToggleButton"
              onClick={onStudentSubmit}
              disabled={controlsDisabled || studentSubmitDisabled}
            >
              {studentSubmitLabel ?? "Submit"}
            </button>
          ) : null}
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={onAssess}
            disabled={controlsDisabled || assessDisabled}
          >
            Assess
          </button>
          {mode === "teacher" ? (
            <SaveMenu
              showUpdate={showUpdateSave}
              disabled={
                controlsDisabled || saveDisabled || teacherFeaturesDisabled
              }
              upgradeLocked={teacherFeaturesDisabled}
              disabledTitle={
                teacherFeaturesDisabled ? upgradeRequiredTitle : ""
              }
              onSaveNew={onSaveNew}
              onUpdate={onSaveUpdate}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

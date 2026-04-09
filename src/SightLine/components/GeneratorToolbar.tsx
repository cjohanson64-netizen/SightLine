import { useState } from "react";
import type { ReactNode } from "react";
import type { FolderItem } from "../hooks/useTeacherLibrary";

type Mode = "teacher" | "student" | "guest";
type SolfegeMode = "off" | "movable" | "fixed";
type AssessmentStatus =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "processing"
  | "complete"
  | "error";
type CalibrationStatus = AssessmentStatus;

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
  onRunAssessment: () => void;
  calibrationStatus: CalibrationStatus;
  calibrationReady: boolean;
  calibrationMessage: ReactNode;
  assessmentAccessMessage: string | null;
  assessmentAccessBlocked: boolean;
  onAssessmentUpgrade: () => void;
  onFix: () => void;
  assessmentStatus: AssessmentStatus;
  assessmentDisabled: boolean;
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
  onRunAssessment,
  calibrationStatus,
  calibrationReady,
  calibrationMessage,
  assessmentAccessMessage,
  assessmentAccessBlocked,
  onAssessmentUpgrade,
  onFix,
  assessmentStatus,
  assessmentDisabled,
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
}: GeneratorToolbarProps): JSX.Element {
  const controlsDisabled = interactionDisabled;
  const assessmentAccessTitle = assessmentAccessBlocked
    ? "Today's free assessments are used up"
    : "Free assessments";
  const assessmentAccessDetail = assessmentAccessBlocked
    ? "Upgrade for unlimited assessments."
    : null;
  const runAssessmentLabel =
    calibrationStatus === "requesting_permission"
      ? "Starting Calibration..."
      : calibrationStatus === "recording"
        ? "Stop Calibration"
        : calibrationStatus === "processing"
          ? "Analyzing Calibration..."
          : !calibrationReady
            ? "Start Calibration"
            : assessmentStatus === "requesting_permission"
              ? "Starting..."
              : assessmentStatus === "recording"
                ? "Stop Assessment"
                : assessmentStatus === "processing"
                  ? "Processing..."
                  : "Run Assessment";

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
                disabled={controlsDisabled || creatingFolder || teacherFeaturesDisabled}
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
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={onGenerate}
            disabled={controlsDisabled}
          >
            Generate
          </button>
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={onFix}
            disabled={controlsDisabled || fixDisabled}
          >
            Fix
          </button>
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={onRunAssessment}
            disabled={assessmentDisabled}
          >
            {runAssessmentLabel}
          </button>
          {calibrationMessage ? (
            <div className="ToolbarAssessmentAccess">
              <div className="ToolbarAssessmentAccessCopy">
                <span className="ToolbarAssessmentAccessTitle">
                  {calibrationReady ? "Calibration" : "Before You Begin"}
                </span>
                <span className="ToolbarAssessmentAccessText">
                  {calibrationMessage}
                </span>
              </div>
            </div>
          ) : null}
          {assessmentAccessMessage ? (
            <div
              className={`ToolbarAssessmentAccess ${assessmentAccessBlocked ? "ToolbarAssessmentAccess--blocked" : ""}`}
            >
              <div className="ToolbarAssessmentAccessCopy">
                <span className="ToolbarAssessmentAccessTitle">
                  {assessmentAccessTitle}
                </span>
                <span className="ToolbarAssessmentAccessText">
                  {assessmentAccessMessage}
                </span>
                {assessmentAccessDetail ? (
                  <span className="ToolbarAssessmentAccessDetail">
                    {assessmentAccessDetail}
                  </span>
                ) : null}
              </div>
              {assessmentAccessBlocked ? (
                <button
                  type="button"
                  className="AppHistoryButton AppProjectionToggleButton ToolbarAssessmentUpgradeButton"
                  onClick={onAssessmentUpgrade}
                  disabled={controlsDisabled}
                >
                  Upgrade for unlimited assessments
                </button>
              ) : null}
            </div>
          ) : null}
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
          {mode === "teacher" ? (
            <SaveMenu
              showUpdate={showUpdateSave}
              disabled={controlsDisabled || saveDisabled || teacherFeaturesDisabled}
              upgradeLocked={teacherFeaturesDisabled}
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
            disabled={controlsDisabled}
          >
            Projection
          </button>
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={onOpenHelp}
            disabled={controlsDisabled}
          >
            Help
          </button>
        </div>
      </div>

    </div>
  );
}

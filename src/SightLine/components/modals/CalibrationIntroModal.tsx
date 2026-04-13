interface CalibrationIntroModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartCalibration: () => void;
  disabled?: boolean;
}

export default function CalibrationIntroModal({
  isOpen,
  onClose,
  onStartCalibration,
  disabled = false,
}: CalibrationIntroModalProps): JSX.Element | null {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="AppModalBackdrop" onClick={onClose} role="presentation">
      <div
        className="AppModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calibration-intro-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="AppModalClose" onClick={onClose}>
          ×
        </button>
        <h3 id="calibration-intro-title">Before You Begin</h3>
        <p className="AppHistoryLabel">
          Sing <strong>DO RE MI FA SOL</strong>
          <br />
          in the key you will use.
          <br />
          Calibration helps SightLine listen more accurately.
        </p>
        <div className="AppBatchActions">
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={onClose}
            disabled={disabled}
          >
            Cancel
          </button>
          <button
            type="button"
            className="AppHistoryButton AppProjectionToggleButton"
            onClick={onStartCalibration}
            disabled={disabled}
          >
            Start Calibration
          </button>
        </div>
      </div>
    </div>
  );
}

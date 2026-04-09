interface InstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function InstructionsModal({
  isOpen,
  onClose,
}: InstructionsModalProps): JSX.Element | null {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="AppModalBackdrop" onClick={onClose} role="presentation">
      <div
        className="AppModal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="AppModalClose" onClick={onClose}>
          ×
        </button>
        <h3>How To Use SightLine</h3>
        <p className="AppHistoryLabel">
          SightLine supports teacher, student, and guest workflows. Use
          Dashboard for account and subscription status, Melody Generator to
          create/edit material, and Class Access to manage classes.
        </p>
        <h4>Melody Generator</h4>
        <ul>
          <li>
            Use <strong>Melody Preferences</strong> to set key, meter, range,
            note values, and constraints.
          </li>
          <li>
            <strong>Generate</strong> creates a new seed; <strong>Fix Melody</strong>{" "}
            reruns with the current seed.
          </li>
          <li>
            <strong>Pitch Edit</strong>: toggle edit mode, click notation, then
            use arrow keys to move selected notes.
          </li>
          <li>
            <strong>Playback</strong>: set tempo/instrument and optionally
            enable a 1-measure count-in on the starting pitch.
          </li>
          <li>
            <strong>Solfege</strong>: Off, Movable Do, or Fixed Do, with
            accidental mode and optional notehead color overlay.
          </li>
          <li>
            <strong>Projection Mode</strong> provides large-notation display
            controls for classroom use.
          </li>
          <li>
            Use <strong>Export</strong> to download MusicXML at any time.
          </li>
        </ul>
        <h4>Teacher Features</h4>
        <ul>
          <li>
            Save exercises to classes, update titles, and filter/load from the
            saved library.
          </li>
          <li>
            In <strong>Class Access</strong>, manage class code/passcode,
            publish status, roster, and student login instructions.
          </li>
          <li>
            Review student submissions and add approved work to your library.
          </li>
          <li>
            Build packets from selected exercises or use <strong>Batch Generate</strong>{" "}
            for full packet creation and ZIP export.
          </li>
          <li>
            Save/clear per-class default settings from Melody Preferences.
          </li>
        </ul>
        <h4>Student Features</h4>
        <ul>
          <li>
            Join with class code, passcode, student ID, and optional PIN.
          </li>
          <li>
            Load assigned exercises, track recent progress, and submit work back
            to teacher.
          </li>
          <li>
            Apply teacher defaults, then reset back to personal settings.
          </li>
        </ul>
        <h4>Access and Billing</h4>
        <ul>
          <li>
            Teacher class-management actions require allowed billing access
            (active/trialing, admin, or comped).
          </li>
          <li>
            If access is inactive, use <strong>Upgrade</strong> from Dashboard to
            start checkout.
          </li>
        </ul>
      </div>
    </div>
  );
}

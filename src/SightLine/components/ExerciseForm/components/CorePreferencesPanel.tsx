import type { ExerciseSpec } from '@/SightLine/domain/music';
import {
  MAJOR_KEY_OPTIONS,
  SOLFEGE_DEGREES
} from '../helpers/exerciseForm.constants';

interface CorePreferencesPanelProps {
  spec: ExerciseSpec;
  allowedNoteValues: Array<'EE' | 'Q' | 'H' | 'W'>;
  onUpdate: <K extends keyof ExerciseSpec>(
    field: K,
    value: ExerciseSpec[K]
  ) => void;
  onUpdateRange: <K extends keyof ExerciseSpec['range']>(
    field: K,
    value: ExerciseSpec['range'][K]
  ) => void;
  onUpdateAllowedNoteValue: (
    value: 'EE' | 'Q' | 'H' | 'W',
    enabled: boolean
  ) => void;
}

export function CorePreferencesPanel({
  spec,
  allowedNoteValues,
  onUpdate,
  onUpdateRange,
  onUpdateAllowedNoteValue
}: CorePreferencesPanelProps): JSX.Element {
  return (
    <div className="ExerciseForm-chunk ExerciseForm-chunk--core">
      <h3>Core Preferences</h3>

      <div className="ExerciseForm-row ExerciseForm-titleRow">
        <label>
          Title
          <input
            type="text"
            value={spec.title}
            onChange={(event) => onUpdate('title', event.target.value)}
            placeholder="Exercise title"
          />
        </label>
      </div>

      <div className="ExerciseForm-constraintSection">
        <h3>Allowed Note Values</h3>
        <div className="ExerciseForm-toggleGrid ExerciseForm-toggleGrid--intervals">
          {([
            { value: 'EE', label: 'EE' },
            { value: 'Q', label: 'Q' },
            { value: 'H', label: 'H' },
            { value: 'W', label: 'W' }
          ] as const).map((option) => (
            <label
              key={`allowed-${option.value}`}
              className="ExerciseForm-toggleItem"
            >
              <input
                type="checkbox"
                checked={allowedNoteValues.includes(option.value)}
                onChange={(event) =>
                  onUpdateAllowedNoteValue(option.value, event.target.checked)
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <small>Select up to 3.</small>
      </div>

      <div className="ExerciseForm-row ExerciseForm-row--three">
        <label>
          Key
          <select
            value={spec.key}
            onChange={(event) => onUpdate('key', event.target.value)}
          >
            {MAJOR_KEY_OPTIONS.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>

        <label>
          Clef
          <select
            value={spec.clef}
            onChange={(event) =>
              onUpdate('clef', event.target.value as ExerciseSpec['clef'])
            }
          >
            <option value="treble">Treble</option>
            <option value="bass">Bass</option>
          </select>
        </label>

        <label>
          Meter
          <select
            value={spec.timeSig}
            onChange={(event) => onUpdate('timeSig', event.target.value)}
          >
            <option value="4/4">4/4</option>
            <option value="3/4">3/4</option>
            <option value="2/4">2/4</option>
          </select>
        </label>
      </div>

      <div className="ExerciseForm-row ExerciseForm-row--two">
        <label>
          Lowest Pitch
          <select
            value={spec.range.lowDegree}
            onChange={(event) =>
              onUpdateRange('lowDegree', Number(event.target.value))
            }
          >
            {SOLFEGE_DEGREES.map((degree) => (
              <option key={degree.value} value={degree.value}>
                {degree.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Lowest Octave
          <input
            type="number"
            min={1}
            max={7}
            value={spec.range.lowOctave}
            onChange={(event) =>
              onUpdateRange(
                'lowOctave',
                Math.max(1, Math.min(7, Number(event.target.value)))
              )
            }
          />
        </label>
      </div>

      <div className="ExerciseForm-row ExerciseForm-row--two">
        <label>
          Highest Pitch
          <select
            value={spec.range.highDegree}
            onChange={(event) =>
              onUpdateRange('highDegree', Number(event.target.value))
            }
          >
            {SOLFEGE_DEGREES.map((degree) => (
              <option key={degree.value} value={degree.value}>
                {degree.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Highest Octave
          <input
            type="number"
            min={1}
            max={7}
            value={spec.range.highOctave}
            onChange={(event) =>
              onUpdateRange(
                'highOctave',
                Math.max(1, Math.min(7, Number(event.target.value)))
              )
            }
          />
        </label>
      </div>
    </div>
  );
}
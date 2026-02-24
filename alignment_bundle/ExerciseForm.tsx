import '../src/styles/ExerciseForm.css';
import type { ExerciseSpec } from './schema';

interface ExerciseFormProps {
  spec: ExerciseSpec;
  seed: number;
  onSpecChange: (next: ExerciseSpec) => void;
  onSeedChange: (seed: number) => void;
  onGenerate: () => void;
  onRegenerate: () => void;
  onRandomizeSeed: () => void;
  onExport: () => void;
}

export default function ExerciseForm({
  spec,
  seed,
  onSpecChange,
  onSeedChange,
  onGenerate,
  onRegenerate,
  onRandomizeSeed,
  onExport
}: ExerciseFormProps): JSX.Element {
  const update = <K extends keyof ExerciseSpec>(field: K, value: ExerciseSpec[K]) => {
    onSpecChange({ ...spec, [field]: value });
  };
  const updateRange = <K extends keyof ExerciseSpec['range']>(field: K, value: ExerciseSpec['range'][K]) => {
    onSpecChange({
      ...spec,
      range: {
        ...spec.range,
        [field]: value
      }
    });
  };

  return (
    <section className="ExerciseForm">
      <h2>Exercise Parameters</h2>
      <div className="ExerciseForm-grid">
        <label>
          Key
          <select value={spec.key} onChange={(event) => update('key', event.target.value)}>
            {['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb', 'Ab'].map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>

        <label>
          Mode
          <select value={spec.mode} onChange={(event) => update('mode', event.target.value as ExerciseSpec['mode'])}>
            <option value="major">Major</option>
            <option value="minor">Minor</option>
          </select>
        </label>

        <label>
          Clef
          <select value={spec.clef} onChange={(event) => update('clef', event.target.value as ExerciseSpec['clef'])}>
            <option value="treble">Treble</option>
            <option value="bass">Bass</option>
          </select>
        </label>

        <label>
          Low Degree
          <input
            type="number"
            min={1}
            max={7}
            value={spec.range.lowDegree}
            onChange={(event) => updateRange('lowDegree', Math.max(1, Math.min(7, Number(event.target.value))))}
          />
        </label>

        <label>
          Low Octave
          <input
            type="number"
            min={1}
            max={7}
            value={spec.range.lowOctave}
            onChange={(event) => updateRange('lowOctave', Math.max(1, Math.min(7, Number(event.target.value))))}
          />
        </label>

        <label>
          High Degree
          <input
            type="number"
            min={1}
            max={7}
            value={spec.range.highDegree}
            onChange={(event) => updateRange('highDegree', Math.max(1, Math.min(7, Number(event.target.value))))}
          />
        </label>

        <label>
          High Octave
          <input
            type="number"
            min={1}
            max={7}
            value={spec.range.highOctave}
            onChange={(event) => updateRange('highOctave', Math.max(1, Math.min(7, Number(event.target.value))))}
          />
        </label>

        <label>
          Measures
          <input
            type="number"
            min={2}
            max={16}
            value={spec.measures}
            onChange={(event) => update('measures', Number(event.target.value))}
          />
        </label>

        <label>
          Time Sig
          <select value={spec.timeSig} onChange={(event) => update('timeSig', event.target.value)}>
            <option value="4/4">4/4</option>
            <option value="3/4">3/4</option>
            <option value="2/4">2/4</option>
          </select>
        </label>

        <label>
          Difficulty
          <select
            value={spec.difficulty}
            onChange={(event) => update('difficulty', event.target.value as ExerciseSpec['difficulty'])}
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>

        <label>
          Cadence
          <select
            value={spec.cadence}
            onChange={(event) => update('cadence', event.target.value as ExerciseSpec['cadence'])}
          >
            <option value="authentic">Authentic</option>
            <option value="plagal">Plagal</option>
            <option value="half">Half</option>
          </select>
        </label>

        <label className="ExerciseForm-checkbox">
          <input
            type="checkbox"
            checked={spec.chromatic}
            onChange={(event) => update('chromatic', event.target.checked)}
          />
          Chromatic Motion
        </label>

        <label>
          Seed
          <input type="number" value={seed} onChange={(event) => onSeedChange(Number(event.target.value))} />
        </label>
      </div>

      <div className="ExerciseForm-actions">
        <button type="button" onClick={onGenerate}>
          Generate
        </button>
        <button type="button" onClick={onRegenerate}>
          Regenerate (same seed)
        </button>
        <button type="button" onClick={onRandomizeSeed}>
          Randomize Seed
        </button>
        <button type="button" onClick={onExport}>
          Export MusicXML
        </button>
      </div>
    </section>
  );
}

import { useState } from 'react';
import '../../styles/ExerciseForm.css';
import type { ExerciseSpec, PhraseSpec } from '../../tat';

interface ExerciseFormProps {
  spec: ExerciseSpec;
  onSpecChange: (next: ExerciseSpec) => void;
  onRandomizeSeed: () => void;
  onExport: () => void;
  showActions?: boolean;
}

const MAX_PHRASES = 4;
const LABEL_ORDER: PhraseSpec['label'][] = ['A', 'B', 'C', 'D'];

function clampLabelToAllowed(label: PhraseSpec['label'], maxAllowedIndex: number): PhraseSpec['label'] {
  const currentIndex = LABEL_ORDER.indexOf(label);
  const clampedIndex = Math.max(0, Math.min(maxAllowedIndex, currentIndex));
  return LABEL_ORDER[clampedIndex];
}

function normalizePhrases(phrases: PhraseSpec[]): PhraseSpec[] {
  const seed: PhraseSpec[] = phrases.length > 0 ? phrases : [{ label: 'A', prime: false, cadence: 'authentic' }];
  const normalized: PhraseSpec[] = [];

  let maxSeenIndex = 0;
  for (let index = 0; index < seed.length; index += 1) {
    const phrase = seed[index];
    if (index === 0) {
      normalized.push({
        ...phrase,
        label: 'A',
        prime: false
      });
      maxSeenIndex = 0;
      continue;
    }

    const maxAllowedIndex = Math.min(LABEL_ORDER.length - 1, maxSeenIndex + 1);
    const label = clampLabelToAllowed(phrase.label, maxAllowedIndex);
    const labelIndex = LABEL_ORDER.indexOf(label);
    maxSeenIndex = Math.max(maxSeenIndex, labelIndex);

    normalized.push({
      ...phrase,
      label
    });
  }

  return normalized.slice(0, MAX_PHRASES);
}

function allowedLabelsForIndex(phrases: PhraseSpec[], index: number): PhraseSpec['label'][] {
  if (index <= 0) {
    return ['A'];
  }

  let maxSeenIndex = 0;
  for (let i = 0; i < index; i += 1) {
    const phrase = phrases[i];
    const labelIndex = LABEL_ORDER.indexOf(phrase?.label ?? 'A');
    maxSeenIndex = Math.max(maxSeenIndex, Math.max(0, labelIndex));
  }

  const maxAllowedIndex = Math.min(LABEL_ORDER.length - 1, maxSeenIndex + 1);
  return LABEL_ORDER.slice(0, maxAllowedIndex + 1);
}

export default function ExerciseForm({
  spec,
  onSpecChange,
  onRandomizeSeed,
  onExport,
  showActions = true
}: ExerciseFormProps): JSX.Element {
  const [transitionDraft, setTransitionDraft] = useState<{ a: number; b: number }>({ a: 1, b: 2 });
  const solfegeDegrees: Array<{ value: number; label: string }> = [
    { value: 1, label: 'Do' },
    { value: 2, label: 'Re' },
    { value: 3, label: 'Mi' },
    { value: 4, label: 'Fa' },
    { value: 5, label: 'Sol' },
    { value: 6, label: 'La' },
    { value: 7, label: 'Ti' }
  ];

  const update = <K extends keyof ExerciseSpec>(field: K, value: ExerciseSpec[K]) => {
    onSpecChange({ ...spec, [field]: value, mode: 'major' });
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

  const updateAllowedNoteValue = (value: 'EE' | 'Q' | 'H' | 'W', enabled: boolean) => {
    const current = new Set(spec.userConstraints?.allowedNoteValues ?? ['EE', 'Q', 'H']);
    if (enabled) {
      current.add(value);
    } else {
      current.delete(value);
    }
    onSpecChange({
      ...spec,
      userConstraints: {
        ...(spec.userConstraints ?? {}),
        allowedNoteValues: [...current] as Array<'EE' | 'Q' | 'H' | 'W'>
      }
    });
  };

  const toggleIllegalDegree = (degree: number, enabled: boolean) => {
    const next = enabled
      ? [...spec.illegalDegrees, degree]
      : spec.illegalDegrees.filter((value) => value !== degree);
    update('illegalDegrees', Array.from(new Set(next)).sort((a, b) => a - b));
  };

  const toggleIllegalIntervals = (intervals: number[], enabled: boolean) => {
    const next = enabled
      ? [...spec.illegalIntervalsSemis, ...intervals]
      : spec.illegalIntervalsSemis.filter((value) => !intervals.includes(value));
    update('illegalIntervalsSemis', Array.from(new Set(next)).sort((a, b) => a - b));
  };

  const hasAllIntervals = (intervals: number[]): boolean => intervals.every((interval) => spec.illegalIntervalsSemis.includes(interval));

  const addTransitionRule = () => {
    const nextRule = { a: transitionDraft.a, b: transitionDraft.b, mode: 'adjacent' as const };
    const exists = spec.illegalTransitions.some((rule) => rule.a === nextRule.a && rule.b === nextRule.b && rule.mode === nextRule.mode);
    if (exists) {
      return;
    }

    update('illegalTransitions', [...spec.illegalTransitions, nextRule]);
  };

  const removeTransitionRule = (index: number) => {
    update(
      'illegalTransitions',
      spec.illegalTransitions.filter((_, i) => i !== index)
    );
  };

  const updatePhrase = <K extends keyof PhraseSpec>(index: number, field: K, value: PhraseSpec[K]) => {
    const next = normalizePhrases(spec.phrases).map((phrase, i) => {
      if (i !== index) {
        return phrase;
      }

      const updated = { ...phrase, [field]: value } as PhraseSpec;
      if (i === 0) {
        updated.label = 'A';
        updated.prime = false;
      }
      return updated;
    });

    onSpecChange({ ...spec, phrases: normalizePhrases(next) });
  };

  const addPhrase = () => {
    const current = normalizePhrases(spec.phrases);
    if (current.length >= MAX_PHRASES) {
      return;
    }

    const nextIndex = current.length;
    const allowed = allowedLabelsForIndex(current, nextIndex);
    const nextLabel = allowed[allowed.length - 1] ?? 'A';
    const nextPhrase: PhraseSpec = {
      label: nextLabel,
      prime: false,
      cadence: 'authentic'
    };

    onSpecChange({
      ...spec,
      phrases: normalizePhrases([...current, nextPhrase])
    });
  };

  const removePhrase = (index: number) => {
    const current = normalizePhrases(spec.phrases);
    if (current.length <= 1 || index === 0) {
      return;
    }

    const next = current.filter((_, i) => i !== index);
    onSpecChange({ ...spec, phrases: normalizePhrases(next) });
  };

  const phrases = normalizePhrases(spec.phrases);
  const allowedNoteValues = spec.userConstraints?.allowedNoteValues ?? ['EE', 'Q', 'H'];

  const structurePreview = phrases
    .map((phrase) => {
      if (phrase.prime) {
        return `${phrase.label}\u2032`;
      }
      return phrase.label;
    })
    .join('');

  return (
    <section className="ExerciseForm">
      <h2>Melody Preferences</h2>
      <div className="ExerciseForm-chunks">
        <div className="ExerciseForm-chunk ExerciseForm-chunk--core">
          <h3>Core Preferences</h3>
          <div className="ExerciseForm-row ExerciseForm-titleRow">
            <label>
              Title
              <input
                type="text"
                value={spec.title}
                onChange={(event) => update('title', event.target.value)}
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
                <label key={`allowed-${option.value}`} className="ExerciseForm-toggleItem">
                  <input
                    type="checkbox"
                    checked={allowedNoteValues.includes(option.value)}
                    onChange={(event) => updateAllowedNoteValue(option.value, event.target.checked)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            <small>Select up to 3.</small>
          </div>

          <div className="ExerciseForm-row ExerciseForm-row--four">
            <label>
              Key (Major)
              <select value={spec.key} onChange={(event) => update('key', event.target.value)}>
                {['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb', 'Ab'].map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
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
              Meter
              <select value={spec.timeSig} onChange={(event) => update('timeSig', event.target.value)}>
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
                onChange={(event) => updateRange('lowDegree', Number(event.target.value))}
              >
                {solfegeDegrees.map((degree) => (
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
                onChange={(event) => updateRange('lowOctave', Math.max(1, Math.min(7, Number(event.target.value))))}
              />
            </label>
          </div>

          <div className="ExerciseForm-row ExerciseForm-row--two">
            <label>
              Highest Pitch
              <select
                value={spec.range.highDegree}
                onChange={(event) => updateRange('highDegree', Number(event.target.value))}
              >
                {solfegeDegrees.map((degree) => (
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
                onChange={(event) => updateRange('highOctave', Math.max(1, Math.min(7, Number(event.target.value))))}
              />
            </label>
          </div>
        </div>

        <div className="ExerciseForm-chunk ExerciseForm-chunk--illegal">
          <h3>Illegal Rules</h3>
          <div className="ExerciseForm-constraintSection">
            <h3>Illegal Degrees</h3>
            <div className="ExerciseForm-toggleGrid ExerciseForm-toggleGrid--degrees">
              {solfegeDegrees.map((degree) => (
                <label key={`illegal-degree-${degree.value}`} className="ExerciseForm-toggleItem">
                  <input
                    type="checkbox"
                    checked={spec.illegalDegrees.includes(degree.value)}
                    onChange={(event) => toggleIllegalDegree(degree.value, event.target.checked)}
                  />
                  <span>{degree.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="ExerciseForm-constraintSection">
            <h3>Illegal Intervals</h3>
            <div className="ExerciseForm-toggleGrid ExerciseForm-toggleGrid--intervals">
              <label className="ExerciseForm-toggleItem">
                <input
                  type="checkbox"
                  checked={hasAllIntervals([0])}
                  onChange={(event) => toggleIllegalIntervals([0], event.target.checked)}
                />
                <span>Unison</span>
              </label>
              <label className="ExerciseForm-toggleItem">
                <input
                  type="checkbox"
                  checked={hasAllIntervals([3, 4])}
                  onChange={(event) => toggleIllegalIntervals([3, 4], event.target.checked)}
                />
                <span>
                  3<sup>rds</sup>
                </span>
              </label>
              <label className="ExerciseForm-toggleItem">
                <input
                  type="checkbox"
                  checked={hasAllIntervals([5])}
                  onChange={(event) => toggleIllegalIntervals([5], event.target.checked)}
                />
                <span>
                  4<sup>ths</sup>
                </span>
              </label>
              <label className="ExerciseForm-toggleItem">
                <input
                  type="checkbox"
                  checked={hasAllIntervals([7])}
                  onChange={(event) => toggleIllegalIntervals([7], event.target.checked)}
                />
                <span>
                  5<sup>ths</sup>
                </span>
              </label>
              <label className="ExerciseForm-toggleItem">
                <input
                  type="checkbox"
                  checked={hasAllIntervals(Array.from({ length: 32 }, (_, i) => i + 5))}
                  onChange={(event) =>
                    toggleIllegalIntervals(
                      Array.from({ length: 32 }, (_, i) => i + 5),
                      event.target.checked
                    )
                  }
                />
              <span>
                4<sup>ths</sup>+
              </span>
            </label>
              <label className="ExerciseForm-toggleItem">
                <input
                  type="checkbox"
                  checked={hasAllIntervals(Array.from({ length: 29 }, (_, i) => i + 8))}
                  onChange={(event) =>
                    toggleIllegalIntervals(
                      Array.from({ length: 29 }, (_, i) => i + 8),
                      event.target.checked
                    )
                  }
                />
                <span>
                  6<sup>ths</sup>+
                </span>
              </label>
            </div>
          </div>

          <div className="ExerciseForm-constraintSection">
            <h3>Illegal Transitions</h3>
            <div className="ExerciseForm-transitionRow">
              <label>
                Degree A
                <select
                  value={transitionDraft.a}
                  onChange={(event) => setTransitionDraft((prev) => ({ ...prev, a: Number(event.target.value) }))}
                >
                  {solfegeDegrees.map((degree) => (
                    <option key={`ta-${degree.value}`} value={degree.value}>
                      {degree.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Degree B
                <select
                  value={transitionDraft.b}
                  onChange={(event) => setTransitionDraft((prev) => ({ ...prev, b: Number(event.target.value) }))}
                >
                  {solfegeDegrees.map((degree) => (
                    <option key={`tb-${degree.value}`} value={degree.value}>
                      {degree.label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={addTransitionRule}>
                Add Rule
              </button>
            </div>
            <div className="ExerciseForm-transitionList">
              {spec.illegalTransitions.length === 0 ? (
                <p>No transition rules.</p>
              ) : (
                spec.illegalTransitions.map((rule, index) => (
                  <div key={`${rule.a}-${rule.b}-${index}`} className="ExerciseForm-transitionItem">
                    <span>
                      {solfegeDegrees.find((d) => d.value === rule.a)?.label} {'<->'}{' '}
                      {solfegeDegrees.find((d) => d.value === rule.b)?.label}
                    </span>
                    <button type="button" onClick={() => removeTransitionRule(index)}>
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="ExerciseForm-chunk ExerciseForm-chunk--phrase">
          <h3>Phrase Builder</h3>
          <div className="ExerciseForm-row ExerciseForm-row--two">
            <label>
              Phrase Length
              <select
                value={spec.phraseLengthMeasures}
                onChange={(event) => update('phraseLengthMeasures', Number(event.target.value) as 2 | 3 | 4)}
              >
                <option value={2}>2 measures</option>
                <option value={3}>3 measures</option>
                <option value={4}>4 measures</option>
              </select>
            </label>
          </div>

          <div className="ExerciseForm-phraseBuilder">
            <div className="ExerciseForm-phraseHeader">
              <span className="ExerciseForm-structurePreview">Structure: {structurePreview || 'A'}</span>
            </div>

            {phrases.map((phrase, index) => {
              const allowedLabels = allowedLabelsForIndex(phrases, index);
              const lockFirst = index === 0;
              return (
                <div key={`phrase-${index + 1}`} className="ExerciseForm-phraseCard">
                  <div className="ExerciseForm-phraseTitle">Phrase {index + 1}</div>
                  <div className="ExerciseForm-phraseCardRow">
                    <label>
                      Label
                      <select
                        value={phrase.label}
                        disabled={lockFirst}
                        onChange={(event) => updatePhrase(index, 'label', event.target.value as PhraseSpec['label'])}
                      >
                        {allowedLabels.map((label) => (
                          <option key={label} value={label}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="ExerciseForm-primeField">
                      Prime
                      <input
                        type="checkbox"
                        checked={phrase.prime}
                        disabled={lockFirst}
                        onChange={(event) => updatePhrase(index, 'prime', event.target.checked)}
                      />
                    </label>

                    <label>
                      Cadence
                      <select
                        value={phrase.cadence}
                        onChange={(event) => updatePhrase(index, 'cadence', event.target.value as PhraseSpec['cadence'])}
                      >
                        <option value="authentic">Authentic</option>
                        <option value="plagal">Plagal</option>
                        <option value="half">Half</option>
                      </select>
                    </label>

                    <button
                      type="button"
                      className="ExerciseForm-iconButton"
                      onClick={() => removePhrase(index)}
                      disabled={lockFirst || phrases.length <= 1}
                      title="Remove Phrase"
                      aria-label="Remove Phrase"
                    >
                      -
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="ExerciseForm-phraseActions">
              <button
                type="button"
                className="ExerciseForm-iconButton"
                onClick={addPhrase}
                disabled={phrases.length >= MAX_PHRASES}
                title="Add Phrase"
                aria-label="Add Phrase"
              >
                +
              </button>
            </div>
          </div>

          {showActions ? (
            <div className="ExerciseForm-actions">
              <button type="button" onClick={onRandomizeSeed}>
                Create New Melody
              </button>
              <button type="button" onClick={onExport}>
                Export MusicXML
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

import type { ExerciseSpec, PhraseSpec } from '@/SightLine/domain/music';
import { MAX_PHRASES } from '../helpers/exerciseForm.constants';
import { allowedLabelsForIndex } from '../helpers/phraseNormalization';

interface PhraseBuilderPanelProps {
  spec: ExerciseSpec;
  phrases: PhraseSpec[];
  structurePreview: string;
  showActions: boolean;
  disableAdvancedPanels: boolean;
  onUpdate: <K extends keyof ExerciseSpec>(
    field: K,
    value: ExerciseSpec[K]
  ) => void;
  onUpdatePhrase: <K extends keyof PhraseSpec>(
    index: number,
    field: K,
    value: PhraseSpec[K]
  ) => void;
  onAddPhrase: () => void;
  onRemovePhrase: (index: number) => void;
  onRandomizeSeed: () => void;
  onExport: () => void;
}

export function PhraseBuilderPanel({
  spec,
  phrases,
  structurePreview,
  showActions,
  disableAdvancedPanels,
  onUpdate,
  onUpdatePhrase,
  onAddPhrase,
  onRemovePhrase,
  onRandomizeSeed,
  onExport
}: PhraseBuilderPanelProps): JSX.Element {
  return (
    <fieldset
      className="ExerciseForm-chunk ExerciseForm-chunk--phrase"
      disabled={disableAdvancedPanels}
      aria-disabled={disableAdvancedPanels}
    >
      <h3>Phrase Builder</h3>

      {disableAdvancedPanels ? (
        <small>Sign in to use phrase builder.</small>
      ) : null}

      <div className="ExerciseForm-row ExerciseForm-row--two">
        <label>
          Phrase Length
          <select
            value={spec.phraseLengthMeasures}
            onChange={(event) =>
              onUpdate(
                'phraseLengthMeasures',
                Number(event.target.value) as 2 | 3 | 4
              )
            }
          >
            <option value={2}>2 measures</option>
            <option value={3}>3 measures</option>
            <option value={4}>4 measures</option>
          </select>
        </label>
      </div>

      <div className="ExerciseForm-phraseBuilder">
        <div className="ExerciseForm-phraseHeader">
          <span className="ExerciseForm-structurePreview">
            Structure: {structurePreview || 'A'}
          </span>
        </div>

        {phrases.map((phrase, index) => {
          const allowedLabels = allowedLabelsForIndex(phrases, index);
          const lockFirst = index === 0;

          return (
            <div
              key={`phrase-${index + 1}`}
              className="ExerciseForm-phraseCard"
            >
              <div className="ExerciseForm-phraseTitle">
                Phrase {index + 1}
              </div>

              <div className="ExerciseForm-phraseCardRow">
                <label>
                  Label
                  <select
                    value={phrase.label}
                    disabled={lockFirst}
                    onChange={(event) =>
                      onUpdatePhrase(
                        index,
                        'label',
                        event.target.value as PhraseSpec['label']
                      )
                    }
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
                    onChange={(event) =>
                      onUpdatePhrase(index, 'prime', event.target.checked)
                    }
                  />
                </label>

                <label>
                  Cadence
                  <select
                    value={phrase.cadence}
                    onChange={(event) =>
                      onUpdatePhrase(
                        index,
                        'cadence',
                        event.target.value as PhraseSpec['cadence']
                      )
                    }
                  >
                    <option value="authentic">Authentic</option>
                    <option value="plagal">Plagal</option>
                    <option value="half">Half</option>
                  </select>
                </label>

                <button
                  type="button"
                  className="ExerciseForm-iconButton"
                  onClick={() => onRemovePhrase(index)}
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
            onClick={onAddPhrase}
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
    </fieldset>
  );
}
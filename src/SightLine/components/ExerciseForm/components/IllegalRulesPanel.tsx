import type { ExerciseSpec } from '@/SightLine/domain/music';
import { SOLFEGE_DEGREES } from '../helpers/exerciseForm.constants';

interface IllegalRulesPanelProps {
  spec: ExerciseSpec;
  disableAdvancedPanels: boolean;
  onToggleIllegalDegree: (degree: number, enabled: boolean) => void;
  onToggleIllegalIntervals: (intervals: number[], enabled: boolean) => void;
  hasAllIntervalsForSpec: (intervals: number[]) => boolean;
  transitionDraft: { a: number; b: number };
  onTransitionDraftChange: (next: { a: number; b: number }) => void;
  onAddTransitionRule: () => void;
  onRemoveTransitionRule: (index: number) => void;
}

export function IllegalRulesPanel({
  spec,
  disableAdvancedPanels,
  onToggleIllegalDegree,
  onToggleIllegalIntervals,
  hasAllIntervalsForSpec,
  transitionDraft,
  onTransitionDraftChange,
  onAddTransitionRule,
  onRemoveTransitionRule
}: IllegalRulesPanelProps): JSX.Element {
  const largeIntervalFromFourth = Array.from({ length: 32 }, (_, i) => i + 5);
  const largeIntervalFromSixth = Array.from({ length: 29 }, (_, i) => i + 8);

  return (
    <fieldset
      className="ExerciseForm-chunk ExerciseForm-chunk--illegal"
      disabled={disableAdvancedPanels}
      aria-disabled={disableAdvancedPanels}
    >
      <h3>Illegal Rules</h3>

      {disableAdvancedPanels ? (
        <small>Sign in to edit illegal rules.</small>
      ) : null}

      <div className="ExerciseForm-constraintSection">
        <h3>Illegal Degrees</h3>

        <div className="ExerciseForm-toggleGrid ExerciseForm-toggleGrid--degrees">
          {SOLFEGE_DEGREES.map((degree) => (
            <label
              key={`illegal-degree-${degree.value}`}
              className="ExerciseForm-toggleItem"
            >
              <input
                type="checkbox"
                checked={spec.illegalDegrees.includes(degree.value)}
                onChange={(event) =>
                  onToggleIllegalDegree(degree.value, event.target.checked)
                }
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
              checked={hasAllIntervalsForSpec([0])}
              onChange={(event) =>
                onToggleIllegalIntervals([0], event.target.checked)
              }
            />
            <span>Unison</span>
          </label>

          <label className="ExerciseForm-toggleItem">
            <input
              type="checkbox"
              checked={hasAllIntervalsForSpec([3, 4])}
              onChange={(event) =>
                onToggleIllegalIntervals([3, 4], event.target.checked)
              }
            />
            <span>
              3<sup>rds</sup>
            </span>
          </label>

          <label className="ExerciseForm-toggleItem">
            <input
              type="checkbox"
              checked={hasAllIntervalsForSpec([5])}
              onChange={(event) =>
                onToggleIllegalIntervals([5], event.target.checked)
              }
            />
            <span>
              4<sup>ths</sup>
            </span>
          </label>

          <label className="ExerciseForm-toggleItem">
            <input
              type="checkbox"
              checked={hasAllIntervalsForSpec([7])}
              onChange={(event) =>
                onToggleIllegalIntervals([7], event.target.checked)
              }
            />
            <span>
              5<sup>ths</sup>
            </span>
          </label>

          <label className="ExerciseForm-toggleItem">
            <input
              type="checkbox"
              checked={hasAllIntervalsForSpec(largeIntervalFromFourth)}
              onChange={(event) =>
                onToggleIllegalIntervals(
                  largeIntervalFromFourth,
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
              checked={hasAllIntervalsForSpec(largeIntervalFromSixth)}
              onChange={(event) =>
                onToggleIllegalIntervals(
                  largeIntervalFromSixth,
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
              onChange={(event) =>
                onTransitionDraftChange({
                  ...transitionDraft,
                  a: Number(event.target.value)
                })
              }
            >
              {SOLFEGE_DEGREES.map((degree) => (
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
              onChange={(event) =>
                onTransitionDraftChange({
                  ...transitionDraft,
                  b: Number(event.target.value)
                })
              }
            >
              {SOLFEGE_DEGREES.map((degree) => (
                <option key={`tb-${degree.value}`} value={degree.value}>
                  {degree.label}
                </option>
              ))}
            </select>
          </label>

          <button type="button" onClick={onAddTransitionRule}>
            Add Rule
          </button>
        </div>

        <div className="ExerciseForm-transitionList">
          {spec.illegalTransitions.length === 0 ? (
            <p>No transition rules.</p>
          ) : (
            spec.illegalTransitions.map((rule, index) => (
              <div
                key={`${rule.a}-${rule.b}-${index}`}
                className="ExerciseForm-transitionItem"
              >
                <span>
                  {SOLFEGE_DEGREES.find((degree) => degree.value === rule.a)
                    ?.label}{' '}
                  {'<->'}{' '}
                  {SOLFEGE_DEGREES.find((degree) => degree.value === rule.b)
                    ?.label}
                </span>

                <button
                  type="button"
                  onClick={() => onRemoveTransitionRule(index)}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </fieldset>
  );
}
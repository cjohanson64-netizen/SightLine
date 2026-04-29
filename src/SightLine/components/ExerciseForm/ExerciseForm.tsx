import { useState } from "react";
import type { ReactNode } from "react";
import "../../styles/ExerciseForm.css";
import type { ExerciseSpec, PhraseSpec } from "@/SightLine/domain/music";
import {
  LABEL_ORDER,
  MAJOR_KEY_OPTIONS,
  MAX_PHRASES,
  SOLFEGE_DEGREES,
} from "./helpers/exerciseForm.constants";

import {
  allowedLabelsForIndex,
  normalizePhrases,
} from "./helpers/phraseNormalization";
import {
  addPhraseToSpec,
  removePhraseFromSpec,
  updatePhraseInSpec,
} from "./helpers/phraseMutations";
import {
  hasAllIntervals,
  updateIllegalDegreeInSpec,
  updateIllegalIntervalsInSpec,
} from "./helpers/intervalRules";
import {
  addTransitionRuleToSpec,
  removeTransitionRuleFromSpec,
} from "./helpers/transitionRules";

import { CorePreferencesPanel } from "./components/CorePreferencesPanel";
import { IllegalRulesPanel } from "./components/IllegalRulesPanel";
import { PhraseBuilderPanel } from "./components/PhraseBuilderPanel";

interface ExerciseFormProps {
  spec: ExerciseSpec;
  onSpecChange: (next: ExerciseSpec) => void;
  onRandomizeSeed: () => void;
  onExport: () => void;
  showActions?: boolean;
  disableAdvancedPanels?: boolean;
  headerActions?: ReactNode;
  bare?: boolean;
  interactionDisabled?: boolean;
}

export default function ExerciseForm({
  spec,
  onSpecChange,
  onRandomizeSeed,
  onExport,
  showActions = true,
  disableAdvancedPanels = false,
  headerActions,
  bare = false,
  interactionDisabled = false,
}: ExerciseFormProps): JSX.Element {
  const [transitionDraft, setTransitionDraft] = useState<{
    a: number;
    b: number;
  }>({ a: 1, b: 2 });

  const update = <K extends keyof ExerciseSpec>(
    field: K,
    value: ExerciseSpec[K],
  ) => {
    onSpecChange({ ...spec, [field]: value });
  };

  const updateRange = <K extends keyof ExerciseSpec["range"]>(
    field: K,
    value: ExerciseSpec["range"][K],
  ) => {
    onSpecChange({
      ...spec,
      range: {
        ...spec.range,
        [field]: value,
      },
    });
  };

  const updateAllowedNoteValue = (
    value: "EE" | "Q" | "H" | "W",
    enabled: boolean,
  ) => {
    const current = new Set(
      spec.userConstraints?.allowedNoteValues ?? ["EE", "Q", "H"],
    );
    if (enabled) {
      current.add(value);
    } else {
      current.delete(value);
    }
    onSpecChange({
      ...spec,
      userConstraints: {
        ...(spec.userConstraints ?? {}),
        allowedNoteValues: [...current] as Array<"EE" | "Q" | "H" | "W">,
      },
    });
  };

  const toggleIllegalDegree = (degree: number, enabled: boolean) => {
    onSpecChange(updateIllegalDegreeInSpec(spec, degree, enabled));
  };

  const toggleIllegalIntervals = (intervals: number[], enabled: boolean) => {
    onSpecChange(updateIllegalIntervalsInSpec(spec, intervals, enabled));
  };

  const hasAllIntervalsForSpec = (intervals: number[]): boolean =>
    hasAllIntervals(spec, intervals);

  const addTransitionRule = () => {
    onSpecChange(addTransitionRuleToSpec(spec, transitionDraft));
  };

  const removeTransitionRule = (index: number) => {
    onSpecChange(removeTransitionRuleFromSpec(spec, index));
  };

  const updatePhrase = <K extends keyof PhraseSpec>(
    index: number,
    field: K,
    value: PhraseSpec[K],
  ) => {
    onSpecChange(updatePhraseInSpec(spec, index, field, value));
  };

  const addPhrase = () => {
    onSpecChange(addPhraseToSpec(spec));
  };

  const removePhrase = (index: number) => {
    onSpecChange(removePhraseFromSpec(spec, index));
  };

  const phrases = normalizePhrases(spec.phrases);
  const allowedNoteValues = spec.userConstraints?.allowedNoteValues ?? [
    "EE",
    "Q",
    "H",
  ];

  const structurePreview = phrases
    .map((phrase) => {
      if (phrase.prime) {
        return `${phrase.label}\u2032`;
      }
      return phrase.label;
    })
    .join("");

  return (
    <section className={`ExerciseForm${bare ? " ExerciseForm--bare" : ""}`}>
      <fieldset
        className="AppInteractionFieldset"
        disabled={interactionDisabled}
      >
        <div className="ExerciseForm-header">
          <h2>Melody Preferences</h2>
          {headerActions ? (
            <div className="ExerciseForm-headerActions">{headerActions}</div>
          ) : null}
        </div>
        <div className="ExerciseForm-chunks">
          <CorePreferencesPanel
            spec={spec}
            allowedNoteValues={allowedNoteValues}
            onUpdate={update}
            onUpdateRange={updateRange}
            onUpdateAllowedNoteValue={updateAllowedNoteValue}
          />

          <IllegalRulesPanel
            spec={spec}
            disableAdvancedPanels={disableAdvancedPanels}
            onToggleIllegalDegree={toggleIllegalDegree}
            onToggleIllegalIntervals={toggleIllegalIntervals}
            hasAllIntervalsForSpec={hasAllIntervalsForSpec}
            transitionDraft={transitionDraft}
            onTransitionDraftChange={setTransitionDraft}
            onAddTransitionRule={addTransitionRule}
            onRemoveTransitionRule={removeTransitionRule}
          />

          <PhraseBuilderPanel
            spec={spec}
            phrases={phrases}
            structurePreview={structurePreview}
            showActions={showActions}
            disableAdvancedPanels={disableAdvancedPanels}
            onUpdate={update}
            onUpdatePhrase={updatePhrase}
            onAddPhrase={addPhrase}
            onRemovePhrase={removePhrase}
            onRandomizeSeed={onRandomizeSeed}
            onExport={onExport}
          />
        </div>
      </fieldset>
    </section>
  );
}

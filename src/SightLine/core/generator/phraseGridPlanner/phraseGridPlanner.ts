import type { PhraseSpec, RhythmWeights } from "@/SightLine/domain/music";
import { createRng } from "../../../utils/rng";
import {
  chooseHarmonicRhythmPattern,
  type HarmonicRhythmPattern,
} from "../harmonicRhythm";
import type { PhrasePlan } from "../phrasePlanner";
import { resolveMeasureTemplateState } from "./measureTemplateResolver";

import {
  eeWindowBeatForTemplateInMeter,
  templateOnsetsForMeter,
} from "./templateMeterMapping";

import {
  anchorOnsetsForTemplate,
  templateUsesOnlyAllowed,
  type NoteValue,
} from "./templateAnalysis";

import { enforceEeWindows } from "./eeWindowPlanner";
import {
  optimizeRhythmDistribution,
  sumNoteValueCounts,
} from "./rhythmDistributionOptimizer";

import { resolveClimaxOnset } from "./climaxPlanner";
import { resolveRhythmTarget } from "./rhythmTarget";

export type MeasureTemplateId =
  | "STABLE"
  | "SMOOTH_BEAT1"
  | "SMOOTH_BEAT2"
  | "SMOOTH_BEAT3"
  | "RUN_EEEEH"
  | "RUN_HEEEE"
  | "CADENCE_W"
  | "CADENCE_HH"
  | "CLIMAX_SUSTAINED"
  | "CLIMAX_SIMPLE";

export interface PhraseGridMeasurePlan {
  measure: number;
  templateId: MeasureTemplateId;
  onsets: number[];
  anchorOnsets: number[];
  harmonicRhythmPattern: HarmonicRhythmPattern;
  isCadenceMeasure: boolean;
  isClimaxMeasure: boolean;
  eeWindowBeat?: 1 | 2 | 3 | 4;
  wholeNoteRole?: "cadence";
}

export interface PhraseGridPlan {
  measures: PhraseGridMeasurePlan[];
  climax: { measure: number; onset: number };
  eeMeasures: number[];
  noteValueCounts: { W: number; H: number; Q: number; EE: number };
}

function pickCadenceTemplate(
  cadence: PhraseSpec["cadence"],
  rhythmDist?: { W: number; H: number },
): MeasureTemplateId {
  if (cadence === "half") {
    return "CADENCE_HH";
  }
  return (rhythmDist?.W ?? 0) >= (rhythmDist?.H ?? 0)
    ? "CADENCE_W"
    : "CADENCE_HH";
}

export function generatePhraseGrid(input: {
  phrasePlan: PhrasePlan;
  phraseSpec: PhraseSpec;
  phraseStartMeasure: number;
  phraseLengthMeasures: number;
  beatsPerMeasure: number;
  rhythmWeights: RhythmWeights;
  rhythmDist?: { EE: number; Q: number; H: number; W: number };
  minEighthPairsPerPhrase?: number;
  lockRhythmConstraints?: boolean;
  allowedNoteValues?: NoteValue[];
  seed?: number;
}): PhraseGridPlan {
  const rng = createRng(
    (input.seed ?? 0) +
      input.phraseStartMeasure * 97 +
      input.phraseLengthMeasures * 31,
  );
  const measures: PhraseGridMeasurePlan[] = [];
  const finalMeasure =
    input.phraseStartMeasure + input.phraseLengthMeasures - 1;
  const climaxMeasure = Math.max(
    input.phraseStartMeasure,
    Math.min(
      finalMeasure,
      input.phraseStartMeasure + input.phrasePlan.peakMeasure - 1,
    ),
  );
  const minEePairs = Math.max(
    0,
    input.minEighthPairsPerPhrase ??
      input.rhythmWeights.minEighthPairsPerPhrase ??
      0,
  );

  const lockRhythmConstraints = input.lockRhythmConstraints !== false;
  const allowedNoteValues = Array.from(
    new Set(input.allowedNoteValues ?? (["EE", "Q", "H"] as NoteValue[])),
  );
  if (allowedNoteValues.length === 0) {
    throw new Error("input_invalid_allowed_note_values_empty");
  }
  const allowedSet = new Set<NoteValue>(allowedNoteValues);
  const rhythmTarget = resolveRhythmTarget({
    rhythmWeights: input.rhythmWeights,
    rhythmDist: input.rhythmDist,
  });

  const defaultTemplate: MeasureTemplateId = templateUsesOnlyAllowed(
    "STABLE",
    allowedSet,
    input.beatsPerMeasure,
  )
    ? "STABLE"
    : templateUsesOnlyAllowed("CADENCE_HH", allowedSet, input.beatsPerMeasure)
      ? "CADENCE_HH"
      : "CADENCE_W";

  const chooseFallbackTemplate = (
    candidates: MeasureTemplateId[],
    softFallback = true,
  ): MeasureTemplateId => {
    const filtered = candidates.filter((id) =>
      templateUsesOnlyAllowed(id, allowedSet, input.beatsPerMeasure),
    );
    if (filtered.length > 0) {
      return filtered[rng.int(0, filtered.length - 1)];
    }
    if (softFallback) {
      const allCandidates: MeasureTemplateId[] = [
        "STABLE",
        "SMOOTH_BEAT1",
        "SMOOTH_BEAT2",
        "SMOOTH_BEAT3",
        "RUN_EEEEH",
        "RUN_HEEEE",
        "CADENCE_HH",
        "CADENCE_W",
        "CLIMAX_SUSTAINED",
        "CLIMAX_SIMPLE",
      ];
      const allFiltered = allCandidates.filter((id) =>
        templateUsesOnlyAllowed(id, allowedSet, input.beatsPerMeasure),
      );
      if (allFiltered.length > 0) {
        return allFiltered[rng.int(0, allFiltered.length - 1)];
      }
    }
    throw new Error("input_invalid_allowed_note_values_no_template_match");
  };

  for (
    let measure = input.phraseStartMeasure;
    measure <= finalMeasure;
    measure += 1
  ) {
    const resolvedTemplate = resolveMeasureTemplateState({
      measure,
      finalMeasure,
      climaxMeasure,
      defaultTemplate,
      phrasePlan: input.phrasePlan,
      phraseSpec: input.phraseSpec,
      rhythmDist: input.rhythmDist,
      allowedNoteValues,
      allowedSet,
      beatsPerMeasure: input.beatsPerMeasure,
      rng,
    });

    const templateId = resolvedTemplate.templateId;
    const wholeNoteRole = resolvedTemplate.wholeNoteRole;

    const baseOnsets = templateOnsetsForMeter(
      templateId,
      input.beatsPerMeasure,
    );

    const harmonicRhythmPattern = chooseHarmonicRhythmPattern({
      beatsPerMeasure: input.beatsPerMeasure,
      cadence: input.phraseSpec.cadence,
      isClimaxMeasure: measure === climaxMeasure,
      isPhraseFinalMeasure: measure === finalMeasure,
      rng,
      wholeNoteRole,
    });

    measures.push({
      measure,
      templateId,
      onsets: [...baseOnsets],
      anchorOnsets: anchorOnsetsForTemplate(baseOnsets),
      harmonicRhythmPattern,
      isCadenceMeasure: measure === finalMeasure,
      isClimaxMeasure: measure === climaxMeasure,
      eeWindowBeat: eeWindowBeatForTemplateInMeter(
        templateId,
        input.beatsPerMeasure,
      ),
      wholeNoteRole,
    });
  }

  const forcedEeMeasures = enforceEeWindows({
    measures,
    climaxMeasure,
    minEighthPairsPerPhrase: input.minEighthPairsPerPhrase,
    rhythmWeights: input.rhythmWeights,
    rhythmTarget,
    allowedSet,
    beatsPerMeasure: input.beatsPerMeasure,
    rng,
  });

  if (lockRhythmConstraints) {
    optimizeRhythmDistribution({
      measures,
      forcedEeMeasures,
      rhythmTarget,
      allowedSet,
      beatsPerMeasure: input.beatsPerMeasure,
      rng,
    });
  }

  const climaxOnset = resolveClimaxOnset({
    measures,
    climaxMeasure,
    phrasePlan: input.phrasePlan,
  });

  const noteValueCounts = sumNoteValueCounts(measures, input.beatsPerMeasure);

  return {
    measures,
    climax: { measure: climaxMeasure, onset: climaxOnset },
    eeMeasures: measures
      .filter((m) => m.eeWindowBeat !== undefined)
      .map((m) => m.measure),
    noteValueCounts,
  };
}

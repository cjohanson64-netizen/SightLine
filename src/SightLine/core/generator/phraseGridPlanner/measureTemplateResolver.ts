import type { PhraseSpec } from "@/SightLine/domain/music";
import { isSemanticCadentialWholeNoteEligible } from "../harmonicRhythm";
import type { PhrasePlan } from "../phrasePlanner";
import type {
  MeasureTemplateId,
  PhraseGridMeasurePlan,
} from "./phraseGridPlanner";
import type { NoteValue } from "./templateAnalysis";
import { templateUsesOnlyAllowed } from "./templateAnalysis";

type Rng = {
  int: (min: number, max: number) => number;
};

type ResolveMeasureTemplateInput = {
  measure: number;
  finalMeasure: number;
  climaxMeasure: number;
  defaultTemplate: MeasureTemplateId;
  phrasePlan: PhrasePlan;
  phraseSpec: PhraseSpec;
  rhythmDist?: { EE: number; Q: number; H: number; W: number };
  allowedNoteValues: NoteValue[];
  allowedSet: Set<NoteValue>;
  beatsPerMeasure: number;
  rng: Rng;
};

type ResolvedMeasureTemplate = {
  templateId: MeasureTemplateId;
  wholeNoteRole?: PhraseGridMeasurePlan["wholeNoteRole"];
};

const ALL_FALLBACK_TEMPLATES: MeasureTemplateId[] = [
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

const GENERAL_FALLBACK_TEMPLATES: MeasureTemplateId[] = [
  "STABLE",
  "CADENCE_HH",
  "CADENCE_W",
  "SMOOTH_BEAT1",
  "SMOOTH_BEAT2",
  "SMOOTH_BEAT3",
  "RUN_EEEEH",
  "RUN_HEEEE",
  "CLIMAX_SUSTAINED",
];

const CLIMAX_FALLBACK_TEMPLATES: MeasureTemplateId[] = [
  "STABLE",
  "SMOOTH_BEAT1",
  "SMOOTH_BEAT2",
  "SMOOTH_BEAT3",
  "RUN_EEEEH",
  "RUN_HEEEE",
  "CADENCE_HH",
  "CADENCE_W",
  "CLIMAX_SUSTAINED",
];

export function resolveMeasureTemplateState(
  input: ResolveMeasureTemplateInput,
): ResolvedMeasureTemplate {
  if (input.measure === input.finalMeasure) {
    return resolveCadenceTemplateState(input);
  }

  if (input.measure === input.climaxMeasure) {
    return resolveClimaxTemplateState(input);
  }

  return resolveInteriorTemplateState(input);
}

export function chooseAllowedFallbackTemplate(input: {
  candidates: MeasureTemplateId[];
  allowedSet: Set<NoteValue>;
  beatsPerMeasure: number;
  rng: Rng;
  softFallback?: boolean;
}): MeasureTemplateId {
  const filtered = input.candidates.filter((id) =>
    templateUsesOnlyAllowed(id, input.allowedSet, input.beatsPerMeasure),
  );

  if (filtered.length > 0) {
    return filtered[input.rng.int(0, filtered.length - 1)];
  }

  if (input.softFallback ?? true) {
    const allFiltered = ALL_FALLBACK_TEMPLATES.filter((id) =>
      templateUsesOnlyAllowed(id, input.allowedSet, input.beatsPerMeasure),
    );

    if (allFiltered.length > 0) {
      return allFiltered[input.rng.int(0, allFiltered.length - 1)];
    }
  }

  throw new Error("input_invalid_allowed_note_values_no_template_match");
}

export function pickCadenceTemplate(
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

function resolveCadenceTemplateState(
  input: ResolveMeasureTemplateInput,
): ResolvedMeasureTemplate {
  const cadenceWholeEligible = isCadentialWholeNoteEligible(input);

  let templateId = cadenceWholeEligible
    ? "CADENCE_W"
    : pickCadenceTemplate(
        input.phraseSpec.cadence,
        input.rhythmDist
          ? { W: input.rhythmDist.W, H: input.rhythmDist.H }
          : undefined,
      );

  if (
    !templateUsesOnlyAllowed(templateId, input.allowedSet, input.beatsPerMeasure)
  ) {
    templateId = chooseAllowedFallbackTemplate({
      candidates:
        input.phraseSpec.cadence === "half"
          ? ["CADENCE_HH"]
          : ["CADENCE_W", "CADENCE_HH"],
      allowedSet: input.allowedSet,
      beatsPerMeasure: input.beatsPerMeasure,
      rng: input.rng,
    });
  }

  const wholeNoteRole =
    templateId === "CADENCE_W" && isCadentialWholeNoteEligible(input)
      ? "cadence"
      : undefined;

  return {
    templateId,
    wholeNoteRole,
  };
}

function resolveClimaxTemplateState(
  input: ResolveMeasureTemplateInput,
): ResolvedMeasureTemplate {
  if (
    input.phrasePlan.climaxStyle === "sustained" &&
    templateUsesOnlyAllowed(
      "CLIMAX_SUSTAINED",
      input.allowedSet,
      input.beatsPerMeasure,
    )
  ) {
    return { templateId: "CLIMAX_SUSTAINED" };
  }

  if (
    input.phrasePlan.climaxStyle === "stepwise" &&
    templateUsesOnlyAllowed("SMOOTH_BEAT3", input.allowedSet, input.beatsPerMeasure)
  ) {
    return { templateId: "SMOOTH_BEAT3" };
  }

  const templateId = templateUsesOnlyAllowed(
    "CLIMAX_SIMPLE",
    input.allowedSet,
    input.beatsPerMeasure,
  )
    ? "CLIMAX_SIMPLE"
    : chooseAllowedFallbackTemplate({
        candidates: CLIMAX_FALLBACK_TEMPLATES,
        allowedSet: input.allowedSet,
        beatsPerMeasure: input.beatsPerMeasure,
        rng: input.rng,
      });

  return { templateId };
}

function resolveInteriorTemplateState(
  input: ResolveMeasureTemplateInput,
): ResolvedMeasureTemplate {
  if (
    input.phrasePlan.climaxStyle === "stepwise" &&
    input.measure === input.climaxMeasure - 1 &&
    templateUsesOnlyAllowed("SMOOTH_BEAT3", input.allowedSet, input.beatsPerMeasure)
  ) {
    return { templateId: "SMOOTH_BEAT3" };
  }

  if (
    input.phrasePlan.climaxStyle === "leap" &&
    input.measure === input.climaxMeasure - 1 &&
    templateUsesOnlyAllowed("STABLE", input.allowedSet, input.beatsPerMeasure)
  ) {
    return { templateId: "STABLE" };
  }

  if (
    input.phrasePlan.climaxStyle === "delayed" &&
    input.measure === input.climaxMeasure - 1 &&
    templateUsesOnlyAllowed("RUN_HEEEE", input.allowedSet, input.beatsPerMeasure)
  ) {
    return { templateId: "RUN_HEEEE" };
  }

  if (
    !templateUsesOnlyAllowed(
      input.defaultTemplate,
      input.allowedSet,
      input.beatsPerMeasure,
    )
  ) {
    return {
      templateId: chooseAllowedFallbackTemplate({
        candidates: GENERAL_FALLBACK_TEMPLATES,
        allowedSet: input.allowedSet,
        beatsPerMeasure: input.beatsPerMeasure,
        rng: input.rng,
      }),
    };
  }

  return { templateId: input.defaultTemplate };
}

function isCadentialWholeNoteEligible(
  input: ResolveMeasureTemplateInput,
): boolean {
  return isSemanticCadentialWholeNoteEligible({
    allowedNoteValues: input.allowedNoteValues,
    beatsPerMeasure: input.beatsPerMeasure,
    cadence: input.phraseSpec.cadence,
    isPhraseFinalMeasure: true,
  });
}
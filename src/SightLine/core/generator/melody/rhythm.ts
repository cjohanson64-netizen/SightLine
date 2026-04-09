import type {
  HarmonyEvent,
  MelodyEvent,
  PhraseSpec,
  RhythmWeights,
} from "@/SightLine/domain/music";
import type { PhrasePlan } from "../phrasePlanner";
import type { MeasureTemplateId } from "./types";

export interface RhythmMeasureTags {
  measure: number;
  is_final_measure: boolean;
  is_pre_cadence_measure: boolean;
  has_climax_in_measure: boolean;
  needs_smoothing_in_measure: boolean;
  run_intensity: number;
  stability_needed: boolean;
}

type RhythmTemplate = {
  id: MeasureTemplateId;
  grid: number[];
  counts: { whole: number; half: number; quarter: number; eighth: number };
  tags: {
    stable?: boolean;
    run?: boolean;
    smoothing?: boolean;
    climax?: boolean;
    cadence?: boolean;
  };
};

export type MeasureRhythmMode =
  | "normal"
  | "smoothing"
  | "climax"
  | "cadence";

const RHYTHM_TEMPLATES: RhythmTemplate[] = [
  {
    id: "STABLE",
    grid: [1, 2, 3, 4],
    counts: { whole: 0, half: 0, quarter: 4, eighth: 0 },
    tags: { stable: true },
  },
  {
    id: "SMOOTH_BEAT1",
    grid: [1, 1.5, 2, 3, 4],
    counts: { whole: 0, half: 0, quarter: 3, eighth: 2 },
    tags: { smoothing: true, run: true },
  },
  {
    id: "SMOOTH_BEAT2",
    grid: [1, 2, 2.5, 3, 4],
    counts: { whole: 0, half: 0, quarter: 3, eighth: 2 },
    tags: { smoothing: true, run: true },
  },
  {
    id: "SMOOTH_BEAT3",
    grid: [1, 2, 3, 3.5, 4],
    counts: { whole: 0, half: 0, quarter: 3, eighth: 2 },
    tags: { smoothing: true, run: true },
  },
  {
    id: "RUN_EEEEH",
    grid: [1, 1.5, 2, 2.5, 3],
    counts: { whole: 0, half: 1, quarter: 0, eighth: 4 },
    tags: { run: true, smoothing: true },
  },
  {
    id: "RUN_HEEEE",
    grid: [1, 3, 3.5, 4, 4.5],
    counts: { whole: 0, half: 1, quarter: 0, eighth: 4 },
    tags: { run: true, smoothing: true },
  },
  {
    id: "CADENCE_W",
    grid: [1],
    counts: { whole: 1, half: 0, quarter: 0, eighth: 0 },
    tags: { cadence: true },
  },
  {
    id: "CADENCE_HH",
    grid: [1, 3],
    counts: { whole: 0, half: 2, quarter: 0, eighth: 0 },
    tags: { cadence: true },
  },
  {
    id: "CLIMAX_SIMPLE",
    grid: [1, 3],
    counts: { whole: 0, half: 2, quarter: 0, eighth: 0 },
    tags: { climax: true },
  },
];

function templateWeightFit(
  template: RhythmTemplate,
  weights: RhythmWeights,
): number {
  return (
    template.counts.whole * weights.whole +
    template.counts.half * weights.half +
    template.counts.quarter * weights.quarter +
    template.counts.eighth * weights.eighth
  );
}

export function templateById(id: MeasureTemplateId): RhythmTemplate {
  return (
    RHYTHM_TEMPLATES.find((template) => template.id === id) ??
    RHYTHM_TEMPLATES[0]
  );
}

export function classifyMeasuresForRhythm(
  _phrase: PhraseSpec,
  events: MelodyEvent[],
  _phrasePlan: PhrasePlan,
  _harmonyFrames: HarmonyEvent[],
): RhythmMeasureTags[] {
  const grouped = new Map<number, MelodyEvent[]>();
  for (const event of events) {
    if (!grouped.has(event.measure)) {
      grouped.set(event.measure, []);
    }
    grouped.get(event.measure)!.push(event);
  }

  const sortedEvents = [...events].sort(
    (a, b) => a.measure - b.measure || a.beat - b.beat,
  );
  const climaxMidi = sortedEvents.reduce(
    (max, event) => Math.max(max, event.midi),
    Number.NEGATIVE_INFINITY,
  );
  const climaxMeasure =
    sortedEvents.find((event) => event.midi === climaxMidi)?.measure ??
    sortedEvents[0]?.measure ??
    1;
  const finalMeasure = sortedEvents[sortedEvents.length - 1]?.measure ?? 1;
  const preCadenceMeasure = Math.max(1, finalMeasure - 1);

  const tags: RhythmMeasureTags[] = [];
  for (const [measure, inMeasureUnsorted] of grouped.entries()) {
    const inMeasure = [...inMeasureUnsorted].sort((a, b) => a.beat - b.beat);
    let leaps = 0;
    let steps = 0;
    let smoothingEdge = false;
    for (let i = 1; i < inMeasure.length; i += 1) {
      const semis = Math.abs(inMeasure[i].midi - inMeasure[i - 1].midi);
      if (semis >= 5) {
        smoothingEdge = true;
      }
      if (semis >= 3) {
        leaps += 1;
      } else if (semis > 0 && semis <= 2) {
        steps += 1;
      }
    }

    const runIntensity = steps / Math.max(1, inMeasure.length - 1);
    const hasClimaxInMeasure = inMeasure.some(
      (event) => event.midi === climaxMidi,
    );
    const stabilityNeeded =
      measure > climaxMeasure || measure >= preCadenceMeasure;

    tags.push({
      measure,
      is_final_measure: measure === finalMeasure,
      is_pre_cadence_measure: measure === preCadenceMeasure,
      has_climax_in_measure: hasClimaxInMeasure,
      needs_smoothing_in_measure: smoothingEdge || leaps >= 2,
      run_intensity: runIntensity,
      stability_needed: stabilityNeeded,
    });
  }

  return tags.sort((a, b) => a.measure - b.measure);
}

export function eligibleTemplatesForMeasure(
  tags: RhythmMeasureTags,
): RhythmTemplate[] {
  if (tags.is_final_measure) {
    return RHYTHM_TEMPLATES.filter((template) => template.tags.cadence);
  }
  if (tags.has_climax_in_measure) {
    return RHYTHM_TEMPLATES.filter(
      (template) => template.tags.climax || template.tags.stable,
    );
  }
  if (tags.needs_smoothing_in_measure) {
    return RHYTHM_TEMPLATES.filter(
      (template) => template.tags.smoothing || template.tags.stable,
    );
  }
  return RHYTHM_TEMPLATES.filter(
    (template) => template.tags.stable || template.tags.run,
  );
}

export function chooseMeasureTemplate(
  tags: RhythmMeasureTags,
  weights: RhythmWeights,
): MeasureTemplateId {
  const eligible = eligibleTemplatesForMeasure(tags);
  const scored = eligible
    .map((template) => ({
      template,
      score: templateWeightFit(template, weights),
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.template.id ?? "STABLE";
}

export function classifyMeasureRhythmMode(
  eventsInMeasure: MelodyEvent[],
): MeasureRhythmMode {
  const hasCadence = eventsInMeasure.some((event) =>
    event.functionTags?.includes("cadence"),
  );
  if (hasCadence) {
    return "cadence";
  }

  const hasClimax = eventsInMeasure.some((event) =>
    event.functionTags?.includes("climax"),
  );
  if (hasClimax) {
    return "climax";
  }

  const hasSmoothingTag = eventsInMeasure.some((event) =>
    event.functionTags?.includes("smoothing_run"),
  );
  const hasLargeLeap = eventsInMeasure.some((event, index) => {
    if (index === 0) {
      return false;
    }
    return Math.abs(event.midi - eventsInMeasure[index - 1].midi) >= 5;
  });
  if (hasSmoothingTag || hasLargeLeap) {
    return "smoothing";
  }

  return "normal";
}

export function chooseGrid(
  mode: MeasureRhythmMode,
  eventsInMeasure: MelodyEvent[],
): number[] {
  if (mode === "normal") {
    return [1, 2, 3, 4];
  }

  if (mode === "cadence") {
    const hardCount = eventsInMeasure.filter((event) =>
      (event.functionTags ?? []).some(
        (tag) => tag === "anchor" || tag === "structural" || tag === "cadence",
      ),
    ).length;
    return hardCount <= 1 ? [1] : [1, 3];
  }

  if (mode === "climax") {
    const hasStrongThree = eventsInMeasure.some(
      (event) => event.beat >= 3 && event.beat < 4,
    );
    return hasStrongThree ? [1, 3] : [1];
  }

  const runBeats = eventsInMeasure
    .filter((event) => event.functionTags?.includes("smoothing_run"))
    .map((event) => event.beat);
  const center =
    runBeats.length > 0
      ? runBeats.reduce((a, b) => a + b, 0) / runBeats.length
      : 2.5;
  return center < 3 ? [1, 2, 2.5, 3, 4] : [1, 2, 3, 3.5, 4];
}

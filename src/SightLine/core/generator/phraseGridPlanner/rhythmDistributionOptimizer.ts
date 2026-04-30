import type { PhraseGridMeasurePlan, MeasureTemplateId } from './phraseGridPlanner';
import type { NoteValue, NoteValueCounts } from './templateAnalysis';
import {
  anchorOnsetsForTemplate,
  durationCountsFromOnsets,
  templateUsesOnlyAllowed
} from './templateAnalysis';
import {
  eeWindowBeatForTemplateInMeter,
  templateOnsetsForMeter
} from './templateMeterMapping';

type Rng = {
  next: () => number;
};

type RhythmTarget = {
  EE: number;
  Q: number;
  H: number;
  W: number;
};

interface OptimizeRhythmDistributionInput {
  measures: PhraseGridMeasurePlan[];
  forcedEeMeasures: Set<number>;
  rhythmTarget: RhythmTarget;
  allowedSet: Set<NoteValue>;
  beatsPerMeasure: number;
  rng: Rng;
}

export function optimizeRhythmDistribution(
  input: OptimizeRhythmDistributionInput
): void {
  const flexible = input.measures.filter(
    (measure) => !measure.isCadenceMeasure && !measure.isClimaxMeasure
  );

  for (let index = 0; index < flexible.length; index += 1) {
    const measurePlan = flexible[index];

    if (input.forcedEeMeasures.has(measurePlan.measure)) {
      // Forced EE windows are hard requirements; do not optimize them away.
      continue;
    }

    const candidateTemplates = getCandidateTemplates({
      measurePlan,
      forcedEeMeasures: input.forcedEeMeasures,
      allowedSet: input.allowedSet,
      beatsPerMeasure: input.beatsPerMeasure
    });

    if (candidateTemplates.length === 0) {
      continue;
    }

    const bestTemplate = chooseBestTemplate({
      measurePlan,
      candidateTemplates,
      measures: input.measures,
      previousTemplate: index > 0 ? flexible[index - 1].templateId : undefined,
      rhythmTarget: input.rhythmTarget,
      beatsPerMeasure: input.beatsPerMeasure,
      rng: input.rng
    });

    applyTemplateToMeasurePlan(
      measurePlan,
      bestTemplate,
      input.beatsPerMeasure
    );
  }
}

function getCandidateTemplates(input: {
  measurePlan: PhraseGridMeasurePlan;
  forcedEeMeasures: Set<number>;
  allowedSet: Set<NoteValue>;
  beatsPerMeasure: number;
}): MeasureTemplateId[] {
  const allowEeChange = !input.forcedEeMeasures.has(input.measurePlan.measure);

  const candidatePool: MeasureTemplateId[] = [
    'STABLE',
    ...(allowEeChange
      ? ([
          'SMOOTH_BEAT1',
          'SMOOTH_BEAT2',
          'SMOOTH_BEAT3',
          'RUN_EEEEH',
          'RUN_HEEEE'
        ] as MeasureTemplateId[])
      : [])
  ];

  return candidatePool.filter((id) =>
    templateUsesOnlyAllowed(id, input.allowedSet, input.beatsPerMeasure)
  );
}

function chooseBestTemplate(input: {
  measurePlan: PhraseGridMeasurePlan;
  candidateTemplates: MeasureTemplateId[];
  measures: PhraseGridMeasurePlan[];
  previousTemplate?: MeasureTemplateId;
  rhythmTarget: RhythmTarget;
  beatsPerMeasure: number;
  rng: Rng;
}): MeasureTemplateId {
  let bestTemplate = input.measurePlan.templateId;
  let bestError = Number.POSITIVE_INFINITY;
  const scored: Array<{ id: MeasureTemplateId; err: number }> = [];

  for (const candidate of input.candidateTemplates) {
    const original = input.measurePlan.templateId;

    input.measurePlan.templateId = candidate;
    input.measurePlan.onsets = templateOnsetsForMeter(
      candidate,
      input.beatsPerMeasure
    );

    const err = distributionError(
      sumNoteValueCounts(input.measures, input.beatsPerMeasure),
      input.rhythmTarget
    );

    scored.push({ id: candidate, err });

    if (err < bestError) {
      bestError = err;
      bestTemplate = candidate;
    }

    input.measurePlan.templateId = original;
    input.measurePlan.onsets = templateOnsetsForMeter(
      original,
      input.beatsPerMeasure
    );
  }

  const nearBest = scored.filter((entry) => entry.err <= bestError + 4);

  if (nearBest.length <= 1) {
    return bestTemplate;
  }

  return pickWeightedNearBestTemplate({
    nearBest,
    bestError,
    bestTemplate,
    previousTemplate: input.previousTemplate,
    rhythmTarget: input.rhythmTarget,
    rng: input.rng
  });
}

function pickWeightedNearBestTemplate(input: {
  nearBest: Array<{ id: MeasureTemplateId; err: number }>;
  bestError: number;
  bestTemplate: MeasureTemplateId;
  previousTemplate?: MeasureTemplateId;
  rhythmTarget: RhythmTarget;
  rng: Rng;
}): MeasureTemplateId {
  const weighted = input.nearBest.map((entry) => {
    const eeBonus =
      (entry.id === 'RUN_EEEEH' ||
        entry.id === 'RUN_HEEEE' ||
        entry.id === 'SMOOTH_BEAT2' ||
        entry.id === 'SMOOTH_BEAT3') &&
      input.rhythmTarget.EE >= input.rhythmTarget.Q
        ? 1.18
        : 1;

    const repeatPenalty =
      input.previousTemplate && input.previousTemplate === entry.id ? 0.58 : 1;

    return {
      id: entry.id,
      weight:
        (1 / (1 + (entry.err - input.bestError))) *
        eeBonus *
        repeatPenalty
    };
  });

  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = input.rng.next() * totalWeight;
  let picked = input.bestTemplate;

  for (const entry of weighted) {
    cursor -= entry.weight;

    if (cursor <= 0) {
      picked = entry.id;
      break;
    }
  }

  return picked;
}

export function sumNoteValueCounts(
  plans: PhraseGridMeasurePlan[],
  beatsPerMeasure: number
): NoteValueCounts {
  return plans.reduce(
    (acc, plan) => {
      const counts = templateNoteValueCounts(plan.templateId, beatsPerMeasure);

      acc.W += counts.W;
      acc.H += counts.H;
      acc.Q += counts.Q;
      acc.EE += counts.EE;

      return acc;
    },
    { W: 0, H: 0, Q: 0, EE: 0 }
  );
}

function templateNoteValueCounts(
  templateId: MeasureTemplateId,
  beatsPerMeasure: number
): NoteValueCounts {
  return durationCountsFromOnsets(
    templateOnsetsForMeter(templateId, beatsPerMeasure),
    beatsPerMeasure
  );
}

function distributionError(
  counts: NoteValueCounts,
  rhythmTarget: RhythmTarget
): number {
  const total = Math.max(1, counts.W + counts.H + counts.Q + counts.EE);

  const pct = {
    W: (counts.W / total) * 100,
    H: (counts.H / total) * 100,
    Q: (counts.Q / total) * 100,
    EE: (counts.EE / total) * 100
  };

  return (
    Math.abs(pct.W - rhythmTarget.W) +
    Math.abs(pct.H - rhythmTarget.H) +
    Math.abs(pct.Q - rhythmTarget.Q) +
    Math.abs(pct.EE - rhythmTarget.EE)
  );
}

function applyTemplateToMeasurePlan(
  measurePlan: PhraseGridMeasurePlan,
  templateId: MeasureTemplateId,
  beatsPerMeasure: number
): void {
  measurePlan.templateId = templateId;
  measurePlan.onsets = templateOnsetsForMeter(templateId, beatsPerMeasure);
  measurePlan.anchorOnsets = anchorOnsetsForTemplate(measurePlan.onsets);
  measurePlan.eeWindowBeat = eeWindowBeatForTemplateInMeter(
    templateId,
    beatsPerMeasure
  );
}
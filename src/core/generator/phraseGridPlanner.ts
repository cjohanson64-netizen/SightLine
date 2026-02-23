import type { PhraseSpec, RhythmWeights } from '../../tat/models/schema';
import { createRng } from '../../utils/rng';
import type { PhrasePlan } from './phrasePlanner';

export type MeasureTemplateId =
  | 'STABLE'
  | 'SMOOTH_BEAT1'
  | 'SMOOTH_BEAT2'
  | 'SMOOTH_BEAT3'
  | 'RUN_EEEEH'
  | 'RUN_HEEEE'
  | 'CADENCE_W'
  | 'CADENCE_HH'
  | 'CLIMAX_SIMPLE';

export interface PhraseGridMeasurePlan {
  measure: number;
  templateId: MeasureTemplateId;
  onsets: number[];
  anchorOnsets: number[];
  isCadenceMeasure: boolean;
  isClimaxMeasure: boolean;
  eeWindowBeat?: 1 | 2 | 3 | 4;
}

export interface PhraseGridPlan {
  measures: PhraseGridMeasurePlan[];
  climax: { measure: number; onset: number };
  eeMeasures: number[];
  noteValueCounts: { W: number; H: number; Q: number; EE: number };
}

type TemplateDef = {
  id: MeasureTemplateId;
  onsets: number[];
};

type NoteValue = 'EE' | 'Q' | 'H' | 'W';

const TEMPLATE_DEFS: Record<MeasureTemplateId, TemplateDef> = {
  STABLE: { id: 'STABLE', onsets: [1, 2, 3, 4] },
  SMOOTH_BEAT1: { id: 'SMOOTH_BEAT1', onsets: [1, 1.5, 2, 3, 4] },
  SMOOTH_BEAT2: { id: 'SMOOTH_BEAT2', onsets: [1, 2, 2.5, 3, 4] },
  SMOOTH_BEAT3: { id: 'SMOOTH_BEAT3', onsets: [1, 2, 3, 3.5, 4] },
  RUN_EEEEH: { id: 'RUN_EEEEH', onsets: [1, 1.5, 2, 2.5, 3] },
  RUN_HEEEE: { id: 'RUN_HEEEE', onsets: [1, 3, 3.5, 4, 4.5] },
  CADENCE_W: { id: 'CADENCE_W', onsets: [1] },
  CADENCE_HH: { id: 'CADENCE_HH', onsets: [1, 3] },
  CLIMAX_SIMPLE: { id: 'CLIMAX_SIMPLE', onsets: [1, 3] }
};

function templateOnsetsForMeter(templateId: MeasureTemplateId, beatsPerMeasure: number): number[] {
  const quarterGrid = Array.from({ length: Math.max(1, Math.floor(beatsPerMeasure)) }, (_, i) => i + 1);
  if (Math.abs(beatsPerMeasure - 4) < 0.001) {
    return [...TEMPLATE_DEFS[templateId].onsets];
  }
  if (Math.abs(beatsPerMeasure - 3) < 0.001) {
    switch (templateId) {
      case 'STABLE':
        return [1, 2, 3];
      case 'SMOOTH_BEAT1':
        return [1, 1.5, 2, 3];
      case 'SMOOTH_BEAT2':
        return [1, 2, 2.5, 3];
      case 'SMOOTH_BEAT3':
        return [1, 2, 3];
      case 'RUN_EEEEH':
        return [1, 1.5, 2, 2.5, 3];
      case 'RUN_HEEEE':
        return [1, 2, 2.5, 3];
      case 'CADENCE_W':
        return [1];
      case 'CADENCE_HH':
      case 'CLIMAX_SIMPLE':
        return [1, 2];
      default:
        return quarterGrid;
    }
  }
  if (Math.abs(beatsPerMeasure - 2) < 0.001) {
    switch (templateId) {
      case 'STABLE':
        return [1, 2];
      case 'SMOOTH_BEAT1':
      case 'SMOOTH_BEAT2':
      case 'SMOOTH_BEAT3':
        return [1, 1.5, 2];
      case 'RUN_EEEEH':
      case 'RUN_HEEEE':
        return [1, 1.5, 2];
      case 'CADENCE_W':
      case 'CADENCE_HH':
      case 'CLIMAX_SIMPLE':
        return [1];
      default:
        return quarterGrid;
    }
  }
  return quarterGrid;
}

function eeWindowBeatForTemplate(templateId: MeasureTemplateId): 1 | 2 | 3 | 4 | undefined {
  if (templateId === 'SMOOTH_BEAT1' || templateId === 'RUN_EEEEH') {
    return 1;
  }
  if (templateId === 'SMOOTH_BEAT2') {
    return 2;
  }
  if (templateId === 'SMOOTH_BEAT3' || templateId === 'RUN_HEEEE') {
    return 3;
  }
  return undefined;
}

function eeWindowBeatForTemplateInMeter(templateId: MeasureTemplateId, beatsPerMeasure: number): 1 | 2 | 3 | 4 | undefined {
  const preferred = eeWindowBeatForTemplate(templateId);
  const onsets = templateOnsetsForMeter(templateId, beatsPerMeasure);
  if (preferred && onsets.includes(preferred) && onsets.includes(preferred + 0.5)) {
    return preferred;
  }
  const candidates: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];
  return candidates.find((beat) => onsets.includes(beat) && onsets.includes(beat + 0.5));
}

function durationCountsFromOnsets(onsets: number[], beatsPerMeasure: number): { W: number; H: number; Q: number; EE: number } {
  const counts = { W: 0, H: 0, Q: 0, EE: 0 };
  const sorted = [...onsets].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += 1) {
    const curr = sorted[i];
    const next = sorted[i + 1] ?? (beatsPerMeasure + 1);
    const dur = Number((next - curr).toFixed(3));
    if (Math.abs(dur - 4) < 1e-6) {
      counts.W += 1;
    } else if (Math.abs(dur - 2) < 1e-6) {
      counts.H += 1;
    } else if (Math.abs(dur - 1) < 1e-6) {
      counts.Q += 1;
    } else if (Math.abs(dur - 0.5) < 1e-6) {
      counts.EE += 1;
    }
  }
  return counts;
}

function templateUsesOnlyAllowed(templateId: MeasureTemplateId, allowed: Set<NoteValue>, beatsPerMeasure: number): boolean {
  const counts = durationCountsFromOnsets(templateOnsetsForMeter(templateId, beatsPerMeasure), beatsPerMeasure);
  if (counts.W > 0 && !allowed.has('W')) {
    return false;
  }
  if (counts.H > 0 && !allowed.has('H')) {
    return false;
  }
  if (counts.Q > 0 && !allowed.has('Q')) {
    return false;
  }
  if (counts.EE > 0 && !allowed.has('EE')) {
    return false;
  }
  return true;
}

function pickCadenceTemplate(cadence: PhraseSpec['cadence'], rhythmDist?: { W: number; H: number }): MeasureTemplateId {
  if (cadence === 'half') {
    return (rhythmDist?.W ?? 0) >= (rhythmDist?.H ?? 0) ? 'CADENCE_W' : 'CADENCE_HH';
  }
  return (rhythmDist?.W ?? 0) >= (rhythmDist?.H ?? 0) ? 'CADENCE_W' : 'CADENCE_HH';
}

function anchorOnsetsForTemplate(onsets: number[]): number[] {
  const anchors = onsets.filter((onset) => Math.abs(onset - 1) < 0.001 || Math.abs(onset - 3) < 0.001);
  if (anchors.length > 0) {
    return anchors;
  }
  return [onsets[0] ?? 1];
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
  const rng = createRng((input.seed ?? 0) + input.phraseStartMeasure * 97 + input.phraseLengthMeasures * 31);
  const measures: PhraseGridMeasurePlan[] = [];
  const finalMeasure = input.phraseStartMeasure + input.phraseLengthMeasures - 1;
  const climaxMeasure = Math.max(input.phraseStartMeasure, Math.min(finalMeasure, input.phraseStartMeasure + input.phrasePlan.peakMeasure - 1));
  const minEePairs = Math.max(0, input.minEighthPairsPerPhrase ?? input.rhythmWeights.minEighthPairsPerPhrase ?? 0);

  const lockRhythmConstraints = input.lockRhythmConstraints !== false;
  const allowedNoteValues = Array.from(new Set(input.allowedNoteValues ?? (['EE', 'Q', 'H'] as NoteValue[])));
  if (allowedNoteValues.length === 4) {
    throw new Error('input_invalid_allowed_note_values_max_three');
  }
  if (allowedNoteValues.length === 0) {
    throw new Error('input_invalid_allowed_note_values_empty');
  }
  const allowedSet = new Set<NoteValue>(allowedNoteValues);
  const rhythmTarget = input.rhythmDist ?? {
    EE: input.rhythmWeights.eighth,
    Q: input.rhythmWeights.quarter,
    H: input.rhythmWeights.half,
    W: input.rhythmWeights.whole
  };
  const defaultTemplate: MeasureTemplateId = templateUsesOnlyAllowed('STABLE', allowedSet, input.beatsPerMeasure)
    ? 'STABLE'
    : templateUsesOnlyAllowed('CADENCE_HH', allowedSet, input.beatsPerMeasure)
      ? 'CADENCE_HH'
      : 'CADENCE_W';

  const chooseFallbackTemplate = (candidates: MeasureTemplateId[], softFallback = true): MeasureTemplateId => {
    const filtered = candidates.filter((id) => templateUsesOnlyAllowed(id, allowedSet, input.beatsPerMeasure));
    if (filtered.length > 0) {
      return filtered[rng.int(0, filtered.length - 1)];
    }
    if (softFallback) {
      const allCandidates: MeasureTemplateId[] = [
        'STABLE',
        'SMOOTH_BEAT1',
        'SMOOTH_BEAT2',
        'SMOOTH_BEAT3',
        'RUN_EEEEH',
        'RUN_HEEEE',
        'CADENCE_HH',
        'CADENCE_W',
        'CLIMAX_SIMPLE'
      ];
      const allFiltered = allCandidates.filter((id) => templateUsesOnlyAllowed(id, allowedSet, input.beatsPerMeasure));
      if (allFiltered.length > 0) {
        return allFiltered[rng.int(0, allFiltered.length - 1)];
      }
    }
    throw new Error('input_invalid_allowed_note_values_no_template_match');
  };

  for (let measure = input.phraseStartMeasure; measure <= finalMeasure; measure += 1) {
    let templateId: MeasureTemplateId = defaultTemplate;
    if (measure === finalMeasure) {
      templateId = pickCadenceTemplate(input.phraseSpec.cadence, input.rhythmDist ? { W: input.rhythmDist.W, H: input.rhythmDist.H } : undefined);
      if (!templateUsesOnlyAllowed(templateId, allowedSet, input.beatsPerMeasure)) {
        templateId = chooseFallbackTemplate(['CADENCE_W', 'CADENCE_HH']);
      }
    } else if (measure === climaxMeasure) {
      templateId = templateUsesOnlyAllowed('CLIMAX_SIMPLE', allowedSet, input.beatsPerMeasure)
        ? 'CLIMAX_SIMPLE'
        : chooseFallbackTemplate([
            'STABLE',
            'SMOOTH_BEAT1',
            'SMOOTH_BEAT2',
            'SMOOTH_BEAT3',
            'RUN_EEEEH',
            'RUN_HEEEE',
            'CADENCE_HH',
            'CADENCE_W'
          ]);
    } else if (!templateUsesOnlyAllowed(templateId, allowedSet, input.beatsPerMeasure)) {
      templateId = chooseFallbackTemplate([
        'STABLE',
        'CADENCE_HH',
        'CADENCE_W',
        'SMOOTH_BEAT1',
        'SMOOTH_BEAT2',
        'SMOOTH_BEAT3',
        'RUN_EEEEH',
        'RUN_HEEEE'
      ]);
    }
    const baseOnsets = templateOnsetsForMeter(templateId, input.beatsPerMeasure);
    measures.push({
      measure,
      templateId,
      onsets: [...baseOnsets],
      anchorOnsets: anchorOnsetsForTemplate(baseOnsets),
      isCadenceMeasure: measure === finalMeasure,
      isClimaxMeasure: measure === climaxMeasure,
      eeWindowBeat: eeWindowBeatForTemplateInMeter(templateId, input.beatsPerMeasure)
    });
  }

  const effectiveMinEePairs = allowedSet.has('EE') ? minEePairs : 0;

  const eligibleEe = measures.filter((m) => !m.isCadenceMeasure && m.measure < climaxMeasure);
  const forcedEeMeasures = new Set<number>();
  let eePlaced = 0;
  for (const measurePlan of eligibleEe) {
    if (eePlaced >= effectiveMinEePairs) {
      break;
    }
    const eeHeavyTarget = rhythmTarget.EE >= Math.max(rhythmTarget.Q, rhythmTarget.H, rhythmTarget.W);
    const eeTemplates: MeasureTemplateId[] = eeHeavyTarget
      ? ['RUN_EEEEH', 'RUN_HEEEE', 'SMOOTH_BEAT3', 'SMOOTH_BEAT2', 'SMOOTH_BEAT1']
      : ['SMOOTH_BEAT2', 'SMOOTH_BEAT3', 'SMOOTH_BEAT1', 'RUN_HEEEE', 'RUN_EEEEH'];
    const preferred = eeTemplates[(eePlaced + rng.int(0, eeTemplates.length - 1)) % eeTemplates.length];
    const chosenEeTemplate = templateUsesOnlyAllowed(preferred, allowedSet, input.beatsPerMeasure)
      ? preferred
      : eeTemplates.find((id) => templateUsesOnlyAllowed(id, allowedSet, input.beatsPerMeasure));
    if (!chosenEeTemplate) {
      continue;
    }
    measurePlan.templateId = chosenEeTemplate;
    measurePlan.onsets = templateOnsetsForMeter(measurePlan.templateId, input.beatsPerMeasure);
    measurePlan.anchorOnsets = anchorOnsetsForTemplate(measurePlan.onsets);
    measurePlan.eeWindowBeat = eeWindowBeatForTemplateInMeter(measurePlan.templateId, input.beatsPerMeasure);
    forcedEeMeasures.add(measurePlan.measure);
    eePlaced += 1;
  }

  const templateCounts = (templateId: MeasureTemplateId): { W: number; H: number; Q: number; EE: number } =>
    durationCountsFromOnsets(templateOnsetsForMeter(templateId, input.beatsPerMeasure), input.beatsPerMeasure);
  const sumCounts = (plans: PhraseGridMeasurePlan[]): { W: number; H: number; Q: number; EE: number } =>
    plans.reduce(
      (acc, plan) => {
        const c = templateCounts(plan.templateId);
        acc.W += c.W;
        acc.H += c.H;
        acc.Q += c.Q;
        acc.EE += c.EE;
        return acc;
      },
      { W: 0, H: 0, Q: 0, EE: 0 }
    );
  const distError = (counts: { W: number; H: number; Q: number; EE: number }): number => {
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
  };

  if (lockRhythmConstraints) {
    const flexible = measures.filter((m) => !m.isCadenceMeasure && !m.isClimaxMeasure);
    for (let i = 0; i < flexible.length; i += 1) {
      const measurePlan = flexible[i];
      if (forcedEeMeasures.has(measurePlan.measure)) {
        // Forced EE windows are hard requirements; do not optimize them away.
        continue;
      }
      const allowEeChange = !forcedEeMeasures.has(measurePlan.measure);
      const candidatePool: MeasureTemplateId[] = [
        'STABLE',
        ...(allowEeChange
          ? (['SMOOTH_BEAT1', 'SMOOTH_BEAT2', 'SMOOTH_BEAT3', 'RUN_EEEEH', 'RUN_HEEEE'] as MeasureTemplateId[])
          : [])
      ];
      const candidateTemplates: MeasureTemplateId[] = candidatePool.filter((id) =>
        templateUsesOnlyAllowed(id, allowedSet, input.beatsPerMeasure)
      );
      if (candidateTemplates.length === 0) {
        continue;
      }
      let bestTemplate = measurePlan.templateId;
      let bestError = Number.POSITIVE_INFINITY;
      const scored: Array<{ id: MeasureTemplateId; err: number }> = [];
      for (const candidate of candidateTemplates) {
        const original = measurePlan.templateId;
        measurePlan.templateId = candidate;
        measurePlan.onsets = templateOnsetsForMeter(candidate, input.beatsPerMeasure);
        const err = distError(sumCounts(measures));
        scored.push({ id: candidate, err });
        if (err < bestError) {
          bestError = err;
          bestTemplate = candidate;
        }
        measurePlan.templateId = original;
        measurePlan.onsets = templateOnsetsForMeter(original, input.beatsPerMeasure);
      }
      const nearBest = scored.filter((entry) => entry.err <= bestError + 4);
      const prevTemplate = i > 0 ? flexible[i - 1].templateId : undefined;
      if (nearBest.length > 1) {
        const weighted = nearBest.map((entry) => {
          const eeBonus =
            (entry.id === 'RUN_EEEEH' || entry.id === 'RUN_HEEEE' || entry.id === 'SMOOTH_BEAT2' || entry.id === 'SMOOTH_BEAT3') &&
            rhythmTarget.EE >= rhythmTarget.Q
            ? 1.18
            : 1;
          const repeatPenalty = prevTemplate && prevTemplate === entry.id ? 0.58 : 1;
          return {
            id: entry.id,
            weight: (1 / (1 + (entry.err - bestError))) * eeBonus * repeatPenalty
          };
        });
        const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
        let cursor = rng.next() * totalWeight;
        let picked = bestTemplate;
        for (const entry of weighted) {
          cursor -= entry.weight;
          if (cursor <= 0) {
            picked = entry.id;
            break;
          }
        }
        bestTemplate = picked;
      }
      measurePlan.templateId = bestTemplate;
      measurePlan.onsets = templateOnsetsForMeter(bestTemplate, input.beatsPerMeasure);
      measurePlan.anchorOnsets = anchorOnsetsForTemplate(measurePlan.onsets);
      measurePlan.eeWindowBeat = eeWindowBeatForTemplateInMeter(bestTemplate, input.beatsPerMeasure);
    }
  }

  const climaxMeasurePlan = measures.find((m) => m.measure === climaxMeasure);
  const climaxOnset = climaxMeasurePlan
    ? (climaxMeasurePlan.onsets.includes(3) ? 3 : climaxMeasurePlan.onsets[Math.max(0, climaxMeasurePlan.onsets.length - 1)] ?? 1)
    : 1;

  const noteValueCounts = measures.reduce(
    (acc, measure) => {
      const counts = durationCountsFromOnsets(measure.onsets, input.beatsPerMeasure);
      acc.W += counts.W;
      acc.H += counts.H;
      acc.Q += counts.Q;
      acc.EE += counts.EE;
      return acc;
    },
    { W: 0, H: 0, Q: 0, EE: 0 }
  );

  return {
    measures,
    climax: { measure: climaxMeasure, onset: climaxOnset },
    eeMeasures: measures.filter((m) => m.eeWindowBeat !== undefined).map((m) => m.measure),
    noteValueCounts
  };
}

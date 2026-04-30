import type { MeasureTemplateId } from './phraseGridPlanner';

type TemplateDef = {
  id: MeasureTemplateId;
  onsets: number[];
};

const TEMPLATE_DEFS: Record<MeasureTemplateId, TemplateDef> = {
  STABLE: { id: 'STABLE', onsets: [1, 2, 3, 4] },
  SMOOTH_BEAT1: { id: 'SMOOTH_BEAT1', onsets: [1, 1.5, 2, 3, 4] },
  SMOOTH_BEAT2: { id: 'SMOOTH_BEAT2', onsets: [1, 2, 2.5, 3, 4] },
  SMOOTH_BEAT3: { id: 'SMOOTH_BEAT3', onsets: [1, 2, 3, 3.5, 4] },
  RUN_EEEEH: { id: 'RUN_EEEEH', onsets: [1, 1.5, 2, 2.5, 3] },
  RUN_HEEEE: { id: 'RUN_HEEEE', onsets: [1, 3, 3.5, 4, 4.5] },
  CADENCE_W: { id: 'CADENCE_W', onsets: [1] },
  CADENCE_HH: { id: 'CADENCE_HH', onsets: [1, 3] },
  CLIMAX_SUSTAINED: { id: 'CLIMAX_SUSTAINED', onsets: [1] },
  CLIMAX_SIMPLE: { id: 'CLIMAX_SIMPLE', onsets: [1, 3] }
};

export function templateOnsetsForMeter(
  templateId: MeasureTemplateId,
  beatsPerMeasure: number
): number[] {
  const quarterGrid = Array.from(
    { length: Math.max(1, Math.floor(beatsPerMeasure)) },
    (_, i) => i + 1
  );

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
      case 'CLIMAX_SUSTAINED':
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
      case 'CLIMAX_SUSTAINED':
      case 'CLIMAX_SIMPLE':
        return [1];
      default:
        return quarterGrid;
    }
  }

  return quarterGrid;
}

function eeWindowBeatForTemplate(
  templateId: MeasureTemplateId
): 1 | 2 | 3 | 4 | undefined {
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

export function eeWindowBeatForTemplateInMeter(
  templateId: MeasureTemplateId,
  beatsPerMeasure: number
): 1 | 2 | 3 | 4 | undefined {
  const preferred = eeWindowBeatForTemplate(templateId);
  const onsets = templateOnsetsForMeter(templateId, beatsPerMeasure);

  if (
    preferred &&
    onsets.includes(preferred) &&
    onsets.includes(preferred + 0.5)
  ) {
    return preferred;
  }

  const candidates: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];

  return candidates.find(
    (beat) => onsets.includes(beat) && onsets.includes(beat + 0.5)
  );
}
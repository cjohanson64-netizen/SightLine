import type { MeasureTemplateId } from './phraseGridPlanner';
import { templateOnsetsForMeter } from './templateMeterMapping';

export type NoteValue = 'EE' | 'Q' | 'H' | 'W';

export type NoteValueCounts = {
  W: number;
  H: number;
  Q: number;
  EE: number;
};

export function durationCountsFromOnsets(
  onsets: number[],
  beatsPerMeasure: number
): NoteValueCounts {
  const counts: NoteValueCounts = { W: 0, H: 0, Q: 0, EE: 0 };
  const sorted = [...onsets].sort((a, b) => a - b);

  for (let i = 0; i < sorted.length; i += 1) {
    const curr = sorted[i];
    const next = sorted[i + 1] ?? beatsPerMeasure + 1;
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

export function templateUsesOnlyAllowed(
  templateId: MeasureTemplateId,
  allowed: Set<NoteValue>,
  beatsPerMeasure: number
): boolean {
  const counts = durationCountsFromOnsets(
    templateOnsetsForMeter(templateId, beatsPerMeasure),
    beatsPerMeasure
  );

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

export function anchorOnsetsForTemplate(onsets: number[]): number[] {
  const anchors = onsets.filter(
    (onset) => Math.abs(onset - 1) < 0.001 || Math.abs(onset - 3) < 0.001
  );

  if (anchors.length > 0) {
    return anchors;
  }

  return [onsets[0] ?? 1];
}
import type { RhythmWeights } from '@/SightLine/domain/music';
import type { PhraseGridMeasurePlan, MeasureTemplateId } from './phraseGridPlanner';
import type { NoteValue } from './templateAnalysis';
import {
  anchorOnsetsForTemplate,
  templateUsesOnlyAllowed
} from './templateAnalysis';
import {
  eeWindowBeatForTemplateInMeter,
  templateOnsetsForMeter
} from './templateMeterMapping';

type Rng = {
  int: (min: number, max: number) => number;
};

type RhythmTarget = {
  EE: number;
  Q: number;
  H: number;
  W: number;
};

interface EnforceEeWindowInput {
  measures: PhraseGridMeasurePlan[];
  climaxMeasure: number;
  minEighthPairsPerPhrase?: number;
  rhythmWeights: RhythmWeights;
  rhythmTarget: RhythmTarget;
  allowedSet: Set<NoteValue>;
  beatsPerMeasure: number;
  rng: Rng;
}

export function enforceEeWindows(input: EnforceEeWindowInput): Set<number> {
  const minEePairs = Math.max(
    0,
    input.minEighthPairsPerPhrase ??
      input.rhythmWeights.minEighthPairsPerPhrase ??
      0
  );

  const effectiveMinEePairs = input.allowedSet.has('EE') ? minEePairs : 0;
  const eligibleEe = input.measures.filter(
    (measure) => !measure.isCadenceMeasure && measure.measure < input.climaxMeasure
  );

  const forcedEeMeasures = new Set<number>();
  let eePlaced = 0;

  for (const measurePlan of eligibleEe) {
    if (eePlaced >= effectiveMinEePairs) {
      break;
    }

    const chosenEeTemplate = chooseEeTemplate({
      eePlaced,
      rhythmTarget: input.rhythmTarget,
      allowedSet: input.allowedSet,
      beatsPerMeasure: input.beatsPerMeasure,
      rng: input.rng
    });

    if (!chosenEeTemplate) {
      continue;
    }

    applyTemplateToMeasurePlan(
      measurePlan,
      chosenEeTemplate,
      input.beatsPerMeasure
    );

    forcedEeMeasures.add(measurePlan.measure);
    eePlaced += 1;
  }

  return forcedEeMeasures;
}

function chooseEeTemplate(input: {
  eePlaced: number;
  rhythmTarget: RhythmTarget;
  allowedSet: Set<NoteValue>;
  beatsPerMeasure: number;
  rng: Rng;
}): MeasureTemplateId | undefined {
  const eeHeavyTarget =
    input.rhythmTarget.EE >=
    Math.max(input.rhythmTarget.Q, input.rhythmTarget.H, input.rhythmTarget.W);

  const eeTemplates: MeasureTemplateId[] = eeHeavyTarget
    ? ['RUN_EEEEH', 'RUN_HEEEE', 'SMOOTH_BEAT3', 'SMOOTH_BEAT2', 'SMOOTH_BEAT1']
    : ['SMOOTH_BEAT2', 'SMOOTH_BEAT3', 'SMOOTH_BEAT1', 'RUN_HEEEE', 'RUN_EEEEH'];

  const preferred =
    eeTemplates[(input.eePlaced + input.rng.int(0, eeTemplates.length - 1)) % eeTemplates.length];

  return templateUsesOnlyAllowed(
    preferred,
    input.allowedSet,
    input.beatsPerMeasure
  )
    ? preferred
    : eeTemplates.find((id) =>
        templateUsesOnlyAllowed(id, input.allowedSet, input.beatsPerMeasure)
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
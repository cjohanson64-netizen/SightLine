import type { ExerciseSpec, MelodyEvent } from '../../../tat/models/schema';

export function runPhraseConstraintPasses(input: {
  events: MelodyEvent[];
  applyIllegalRulesAdjacencyPass: (args: {
    events: MelodyEvent[];
    spec: ExerciseSpec;
    keyScale: number[];
    rangeMin: number;
    rangeMax: number;
    maxLeapSemitones: number;
  }) => MelodyEvent[];
  applyDominantTendencyVoiceLeadingPass: (args: {
    events: MelodyEvent[];
    spec: ExerciseSpec;
    keyScale: number[];
    rangeMin: number;
    rangeMax: number;
    maxLeapSemitones: number;
  }) => MelodyEvent[];
  enforceLeapBudgetPerPhrasePass: (
    events: MelodyEvent[],
    ctx: {
      beatsPerMeasure: number;
      tessitura: { minMidi: number; maxMidi: number };
      keyId: string;
      mode: ExerciseSpec['mode'];
      user: {
        maxLeapSemitones: number;
        maxLargeLeapsPerPhrase: number;
      };
    },
    repairLog: Array<{ code: string; detail: unknown }>
  ) => MelodyEvent[];
  enforceEePairMelodicRules: (
    events: MelodyEvent[],
    spec: ExerciseSpec,
    tonicPc: number,
    keyScale: number[],
    rangeMin: number,
    rangeMax: number
  ) => MelodyEvent[];
  passContext: {
    spec: ExerciseSpec;
    keyScale: number[];
    rangeMin: number;
    rangeMax: number;
    maxLeapSemitones: number;
    maxLargeLeapsPerPhrase: number;
    beatsPerMeasure: number;
    keyId: string;
    tonicPc: number;
  };
}): { events: MelodyEvent[]; leapBudgetRepairs: number } {
  let events = input.applyIllegalRulesAdjacencyPass({
    events: input.events,
    spec: input.passContext.spec,
    keyScale: input.passContext.keyScale,
    rangeMin: input.passContext.rangeMin,
    rangeMax: input.passContext.rangeMax,
    maxLeapSemitones: input.passContext.maxLeapSemitones
  });

  events = input.applyDominantTendencyVoiceLeadingPass({
    events,
    spec: input.passContext.spec,
    keyScale: input.passContext.keyScale,
    rangeMin: input.passContext.rangeMin,
    rangeMax: input.passContext.rangeMax,
    maxLeapSemitones: input.passContext.maxLeapSemitones
  });

  const leapBudgetRepairLog: Array<{ code: string; detail: unknown }> = [];
  events = input.enforceLeapBudgetPerPhrasePass(
    events,
    {
      beatsPerMeasure: input.passContext.beatsPerMeasure,
      tessitura: { minMidi: input.passContext.rangeMin, maxMidi: input.passContext.rangeMax },
      keyId: input.passContext.keyId,
      mode: input.passContext.spec.mode,
      user: {
        maxLeapSemitones: input.passContext.maxLeapSemitones,
        maxLargeLeapsPerPhrase: input.passContext.maxLargeLeapsPerPhrase
      }
    },
    leapBudgetRepairLog
  );

  events = input.enforceEePairMelodicRules(
    events,
    input.passContext.spec,
    input.passContext.tonicPc,
    input.passContext.keyScale,
    input.passContext.rangeMin,
    input.passContext.rangeMax
  );

  return { events, leapBudgetRepairs: leapBudgetRepairLog.length };
}

export function runFinalizationPipeline(input: {
  melody: MelodyEvent[];
  beatsPerMeasure: number;
  buildPlaybackArrayPass5: (events: MelodyEvent[], beatsPerMeasure: number) => MelodyEvent[];
  filterRenderableAttackEvents: (events: MelodyEvent[]) => MelodyEvent[];
  applyUserConstraintsPass10: (
    events: MelodyEvent[],
    ctx: {
      keyId: string;
      mode: ExerciseSpec['mode'];
      tessitura: { minMidi: number; maxMidi: number };
      illegalDegrees?: number[];
      illegalIntervalsSemis?: number[];
      illegalTransitions?: ExerciseSpec['illegalTransitions'];
      allowedNoteValues?: Array<'EE' | 'Q' | 'H' | 'W'>;
      lockFinalRhythmFromPass2?: boolean;
      user: {
        hardStartDo?: boolean;
        cadenceType?: 'authentic' | 'half';
        endOnDoHard?: boolean;
        rhythmDist?: { EE: number; Q: number; H: number; W: number };
        minEighthPairsPerPhrase?: number;
        maxLeapSemitones?: number;
      };
      beatsPerMeasure?: number;
    }
  ) => { events: MelodyEvent[]; constraintLog: Array<{ code: string; detail: unknown }> };
  pass10Ctx: {
    keyId: string;
    mode: ExerciseSpec['mode'];
    tessitura: { minMidi: number; maxMidi: number };
    illegalDegrees?: number[];
    illegalIntervalsSemis?: number[];
    illegalTransitions?: ExerciseSpec['illegalTransitions'];
    allowedNoteValues?: Array<'EE' | 'Q' | 'H' | 'W'>;
    lockFinalRhythmFromPass2?: boolean;
    user: {
      hardStartDo?: boolean;
      cadenceType?: 'authentic' | 'half';
      endOnDoHard?: boolean;
      rhythmDist?: { EE: number; Q: number; H: number; W: number };
      minEighthPairsPerPhrase?: number;
      maxLeapSemitones?: number;
    };
    beatsPerMeasure?: number;
  };
}): { pass5BaseMelody: MelodyEvent[]; pass5ConstraintSweep: { events: MelodyEvent[]; constraintLog: Array<{ code: string; detail: unknown }> }; pass5FinalMelody: MelodyEvent[] } {
  const pass5BaseMelody = input.buildPlaybackArrayPass5(input.filterRenderableAttackEvents(input.melody), input.beatsPerMeasure);
  const pass5ConstraintSweep = input.applyUserConstraintsPass10(pass5BaseMelody, input.pass10Ctx);
  const pass5FinalMelody = input.buildPlaybackArrayPass5(pass5ConstraintSweep.events, input.beatsPerMeasure);
  return { pass5BaseMelody, pass5ConstraintSweep, pass5FinalMelody };
}

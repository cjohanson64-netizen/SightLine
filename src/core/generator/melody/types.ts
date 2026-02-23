import type { ExerciseSpec, MelodyEvent, PhraseSpec } from '../../../tat/models/schema';

export type CadenceSlotContext = { type: PhraseSpec['cadence']; slotTag: 'penultimate' | 'final' };

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

export interface MelodySelectionTrace {
  measure: number;
  beat: number;
  steps: Array<{ step: string; remainingCandidateCount: number; chosenPitch?: string; reason: string }>;
}

export interface MelodyCandidateResult {
  melody: MelodyEvent[];
  trace: MelodySelectionTrace[];
  relaxationTier: number;
  relaxedRules: string[];
}

export interface MelodyNoSolutionDetails {
  illegalDegrees: number[];
  illegalIntervalsSemis: number[];
  illegalTransitions: ExerciseSpec['illegalTransitions'];
}

export type MelodyGenerationOutput =
  | {
      status: 'ok';
      candidates: MelodyCandidateResult[];
    }
  | {
      status: 'no_solution';
      reasonCode: 'constraints_too_strict';
      details: MelodyNoSolutionDetails;
    };

export interface RewriteAttackOptions {
  beatsPerMeasure?: number;
  eeWindowBeat?: 1 | 2 | 3 | 4;
  templatesByMeasure?: Map<number, MeasureTemplateId>;
}

export interface Pass4RepairLogEntry {
  code: string;
  detail: unknown;
}

export interface Pass4RepairContext {
  timeSigBeatsPerMeasure: number;
  allowEighthBeats?: Array<1 | 2 | 3 | 4> | 1 | 2 | 3 | 4;
  tessitura: { minMidi: number; maxMidi: number };
  user: {
    hardStartDo?: boolean;
    cadenceType?: 'authentic' | 'half';
    minEighthPairsPerPhrase?: number;
    maxLeapSemitones?: number;
  };
}

export interface Pass10UserConstraintContext {
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

export interface Pass10ConstraintLogEntry {
  code: string;
  detail: unknown;
}

export interface PlaybackEvent {
  midi: number;
  measure: number;
  onsetBeat: number;
  durationBeats: number;
  startBeats: number;
}

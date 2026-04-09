export interface ExerciseSpec {
  title: string;
  startingDegree: 1 | 3 | 5;
  key: string;
  mode: 'major' | 'minor';
  clef: 'treble' | 'bass';
  range: {
    lowDegree: number;
    highDegree: number;
    lowOctave: number;
    highOctave: number;
  };
  phraseLengthMeasures: 2 | 3 | 4;
  phrases: PhraseSpec[];
  timeSig: string;
  chromatic: boolean;
  illegalDegrees: number[];
  illegalIntervalsSemis: number[];
  illegalTransitions: IllegalTransitionRule[];
  rhythmWeights?: RhythmWeights;
  userConstraints?: UserConstraints;
}

export interface UserConstraints {
  startDegreeLocked?: boolean;
  hardStartDo?: boolean;
  cadenceType?: 'authentic' | 'half' | 'plagal';
  endOnDoHard?: boolean;
  maxLeapSemitones?: number;
  maxLargeLeapsPerPhrase?: number;
  minEighthPairsPerPhrase?: number;
  rhythmDist?: { EE: number; Q: number; H: number; W: number };
  allowedNoteValues?: Array<'EE' | 'Q' | 'H' | 'W'>;
}

export interface RhythmWeights {
  whole: number;
  half: number;
  quarter: number;
  eighth: number;
  minEighthPairsPerPhrase?: number;
  preferEighthInPreClimax?: boolean;
}

export interface PhraseSpec {
  label: 'A' | 'B' | 'C' | 'D';
  prime: boolean;
  cadence: 'authentic' | 'plagal' | 'half';
}

export interface IllegalTransitionRule {
  a: number;
  b: number;
  mode: 'adjacent';
}

export interface HarmonyEvent {
  measure: number;
  beat: number;
  degree: number;
  rootPc: number;
  chordPcs: number[];
  quality: 'major' | 'minor' | 'diminished';
}

export interface MelodyEvent {
  pitch: string;
  octave: number;
  midi: number;
  duration: string;
  measure: number;
  beat: number;
  phraseIndex?: number;
  role: 'ChordTone' | 'NonHarmonicTone' | 'FallbackTonic';
  reason: string;
  chordId: string;
  keyId: string;
  nonHarmonicTone?: boolean;
  onsetBeat?: number;
  durationBeats?: number;
  isAttack?: boolean;
  tieStart?: boolean;
  tieStop?: boolean;
  functionTags?: Array<'anchor' | 'structural' | 'connective_nht' | 'smoothing_run' | 'climax' | 'cadence'>;
  originalMidi?: number;
  editedMidi?: number;
  editedPitch?: string;
  isEdited?: boolean;
}

export interface AssayMetric {
  name: string;
  value: number;
}

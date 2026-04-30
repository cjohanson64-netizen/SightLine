import type { TonnetzGraph } from '../tonnetz/buildTonnetz';
import { toOctave } from '../midi';
import type { ClimaxStyle, PhraseDirection, PhraseTarget } from './phrasePlanner';
import { applyCadencePolicy, type CadenceOption, type CadenceType } from './cadenceVoiceLeading';
import { chooseBest } from './candidateScoring';
import { createSelectedNoteEvent } from './noteEventFactory';
import type { IllegalTransitionRule } from '@/SightLine/domain/music';

export { chooseBest } from './candidateScoring';

export type NoteRole = 'ChordTone' | 'NonHarmonicTone' | 'FallbackTonic';

export interface PrevPitch {
  pc: number;
  midi: number;
}

export interface PitchRange {
  minMidi: number;
  maxMidi: number;
}

export interface SelectNextPitchInput {
  tonnetz: TonnetzGraph;
  key: {
    keyId: string;
    keyPitchSet: Set<number>;
    tonicPc: number;
    keyScale: number[];
  };
  harmony: {
    chordId: string;
    chordNowPitchSet: Set<number>;
    chordNextPitchSet: Set<number>;
    harmonyChangesNext: boolean;
  };
  prevPitch: PrevPitch;
  range: PitchRange;
  seed: number;
  constraints?: {
    illegalDegrees: number[];
    illegalIntervalsSemis: number[];
    illegalTransitions: IllegalTransitionRule[];
  };
  forceNonHarmonic?: boolean;
  forceChordTone?: boolean;
  isFirstNote?: boolean;
  startingDegree?: 1 | 3 | 5;
  cadenceApproach?: boolean;
  isStrongBeat?: boolean;
  cadenceContext?: { type: CadenceType; slotTag: 'penultimate' | 'final' };
  phrase?: {
    currentPhraseTarget?: PhraseTarget;
    direction: PhraseDirection;
    peakMeasure: number;
    currentMeasure: number;
    recentHistory: number[];
    expectedMotion?: 'up' | 'down' | 'any';
    peakDeadlineActive?: boolean;
    stallStreak?: number;
    oppositionStreak?: number;
    peakApproachWindow?: boolean;
    peakTargetDegree?: number;
    climaxStyle?: ClimaxStyle;
  };
}

export interface SelectionDebug {
  step: string;
  remainingCandidateCount: number;
  chosenPitch?: string;
  reason: string;
}

export interface SelectedNoteEvent {
  pitch: string;
  octave: number;
  midi: number;
  role: NoteRole;
  reason: string;
  chordId: string;
  keyId: string;
  nht?: {
    requiresResolution: boolean;
  };
}

export interface SelectNextPitchOutput {
  status: 'ok';
  noteEvent: SelectedNoteEvent;
  debug: SelectionDebug[];
  relaxationTier: number;
  relaxedRules: string[];
}

export interface SelectNextPitchNoSolution {
  status: 'no_solution';
  debug: SelectionDebug[];
  relaxationTier: number;
  relaxedRules: string[];
  noSolutionDetails: {
    illegalDegrees: number[];
    illegalIntervalsSemis: number[];
    illegalTransitions: IllegalTransitionRule[];
  };
}

export interface CandidatePitch {
  pc: number;
  midi: number;
}

export interface BestResult {
  candidate: CandidatePitch;
  leapReason: 'arpeggiate_same_chord' | 'shared_tone_across_change' | 'leap_to_peak' | 'fallback_leap_penalized_but_best' | null;
  cadenceMatchingOption?: CadenceOption;
  cadenceBonus?: number;
  cadenceFromDegree?: number;
  startDegree?: number;
  startBonus?: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function toPitchName(pc: number): string {
  return NOTE_NAMES[((pc % 12) + 12) % 12];
}

export function buildAllCandidates(tonnetz: TonnetzGraph, range: PitchRange): CandidatePitch[] {
  const pcs = new Set(tonnetz.nodes.map((node) => node.pitchClass));
  const result: CandidatePitch[] = [];

  for (let midi = range.minMidi; midi <= range.maxMidi; midi += 1) {
    const pc = ((midi % 12) + 12) % 12;
    if (pcs.has(pc)) {
      result.push({ pc, midi });
    }
  }

  return result;
}

export function precomputeTonnetzDistances(tonnetz: TonnetzGraph): Map<string, number> {
  const distances = new Map<string, number>();

  for (const startNode of tonnetz.nodes) {
    const startPc = startNode.pitchClass;
    const visited = new Set<number>([startPc]);
    const queue: Array<{ pc: number; dist: number }> = [{ pc: startPc, dist: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      distances.set(`${startPc}->${current.pc}`, current.dist);

      const next = tonnetz.edges
        .filter((edge) => Number(edge.from.replace('pc-', '')) === current.pc)
        .map((edge) => Number(edge.to.replace('pc-', '')));

      for (const pc of next) {
        if (!visited.has(pc)) {
          visited.add(pc);
          queue.push({ pc, dist: current.dist + 1 });
        }
      }
    }
  }

  return distances;
}

export function nearestTonicInRange(tonicPc: number, prev: PrevPitch, range: PitchRange): CandidatePitch | null {
  let best: CandidatePitch | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let midi = range.minMidi; midi <= range.maxMidi; midi += 1) {
    const pc = ((midi % 12) + 12) % 12;
    if (pc !== tonicPc) {
      continue;
    }

    const distance = Math.abs(midi - prev.midi);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { pc, midi };
    }
  }

  return best;
}

export function candidateToPitchString(candidate: CandidatePitch): string {
  return `${toPitchName(candidate.pc)}${toOctave(candidate.midi)}`;
}

export function withLeapDebug(debug: SelectionDebug[], result: BestResult): void {
  if (result.leapReason) {
    // Emit explicit leap rationale for trace/console diagnostics.
    debug.push({
      step: 'leapChoice',
      remainingCandidateCount: 1,
      chosenPitch: candidateToPitchString(result.candidate),
      reason: result.leapReason
    });
  }
}

export function withCadenceDebug(debug: SelectionDebug[], input: SelectNextPitchInput, result: BestResult, appliedHard: boolean): void {
  if (!input.cadenceContext) {
    return;
  }

  const chosenDegree = result.cadenceMatchingOption?.degree ?? result.startDegree;
  debug.push({
    step: 'cadenceChoice',
    remainingCandidateCount: 1,
    chosenPitch: candidateToPitchString(result.candidate),
    reason: `cadence type=${input.cadenceContext.type} slot=${input.cadenceContext.slotTag} fromDegree=${String(
      result.cadenceFromDegree ?? '?'
    )} chosenDegree=${String(chosenDegree ?? '?')} appliedHard=${String(appliedHard)} weightBonus=${String(
      (result.cadenceBonus ?? 0).toFixed(3)
    )}`
  });
}

export function withStartDebug(debug: SelectionDebug[], input: SelectNextPitchInput, result: BestResult): void {
  if (!input.isFirstNote) {
    return;
  }

  debug.push({
    step: 'startWeight',
    remainingCandidateCount: 1,
    chosenPitch: candidateToPitchString(result.candidate),
    reason: `degree=${String(result.startDegree ?? '?')} startBonus=${String((result.startBonus ?? 0).toFixed(3))}`
  });
}

export function selectNextPitch(input: SelectNextPitchInput): SelectNextPitchOutput | SelectNextPitchNoSolution {
  const debug: SelectionDebug[] = [];
  const allCandidates = buildAllCandidates(input.tonnetz, input.range);
  const tonnetzDistances = precomputeTonnetzDistances(input.tonnetz);
  const degreeForPc = (pc: number): number => {
    const idx = input.key.keyScale.indexOf(((pc % 12) + 12) % 12);
    return idx === -1 ? 1 : idx + 1;
  };

  const constraints = input.constraints ?? {
    illegalDegrees: [],
    illegalIntervalsSemis: [],
    illegalTransitions: []
  };

  const toNoSolution = (): SelectNextPitchNoSolution => ({
    status: 'no_solution',
    debug,
    relaxationTier: 3,
    relaxedRules: ['constraints_too_strict'],
    noSolutionDetails: {
      illegalDegrees: [...constraints.illegalDegrees],
      illegalIntervalsSemis: [...constraints.illegalIntervalsSemis],
      illegalTransitions: [...constraints.illegalTransitions]
    }
  });

  const success = (
    noteEvent: SelectedNoteEvent,
    relaxationTier: number,
    relaxedRules: string[]
  ): SelectNextPitchOutput => ({
    status: 'ok',
    noteEvent,
    debug,
    relaxationTier,
    relaxedRules
  });

  const applyConstraintTier = (
    candidates: CandidatePitch[],
    options: { allowTransitions: boolean; allowIntervals: boolean }
  ): CandidatePitch[] => {
    const illegalDegreeSet = new Set(constraints.illegalDegrees);
    const illegalIntervalSet = new Set(constraints.illegalIntervalsSemis);
    const prevDegree = degreeForPc(input.prevPitch.pc);

    return candidates.filter((candidate) => {
      const candDegree = degreeForPc(candidate.pc);
      if (illegalDegreeSet.has(candDegree)) {
        return false;
      }

      if (options.allowIntervals) {
        const semis = Math.abs(candidate.midi - input.prevPitch.midi);
        if (illegalIntervalSet.has(semis)) {
          return false;
        }
      }

      if (options.allowTransitions && constraints.illegalTransitions.length > 0) {
        const blocked = constraints.illegalTransitions.some((rule) => {
          if (rule.mode !== 'adjacent') {
            return false;
          }
          return (
            (rule.a === prevDegree && rule.b === candDegree) ||
            (rule.b === prevDegree && rule.a === candDegree)
          );
        });
        if (blocked) {
          return false;
        }
      }

      return true;
    });
  };

  const applyCadenceToCandidates = (
    candidates: CandidatePitch[]
  ): {
    candidates: CandidatePitch[];
    bonusByMidi: Map<number, { bonus: number; matchingOption?: CadenceOption }>;
    appliedHard: boolean;
    fromDegree?: number;
  } => {
    if (!input.cadenceContext) {
      return {
        candidates,
        bonusByMidi: new Map<number, { bonus: number; matchingOption?: CadenceOption }>(),
        appliedHard: false,
        fromDegree: undefined
      };
    }

    const fromDegree = degreeForPc(input.prevPitch.pc);
    const policy = applyCadencePolicy({
      cadenceType: input.cadenceContext.type,
      fromDegree,
      candidates: candidates.map((candidate) => ({ midi: candidate.midi, degree: degreeForPc(candidate.pc) })),
      tonicDegree: 1,
      slotTag: input.cadenceContext.slotTag
    });

    debug.push({
      step: 'cadencePolicy',
      remainingCandidateCount: policy.candidatesOut.length,
      reason: policy.debug
    });

    const allowedMidi = new Set(policy.candidatesOut.map((entry) => entry.midi));
    const bonusByMidi = new Map<number, { bonus: number; matchingOption?: CadenceOption }>();
    for (const entry of policy.candidatesOut) {
      bonusByMidi.set(entry.midi, {
        bonus: entry.cadenceWeightBonus,
        matchingOption: entry.matchingOption
      });
    }

    return {
      candidates: candidates.filter((candidate) => allowedMidi.has(candidate.midi)),
      bonusByMidi,
      appliedHard: policy.appliedHard,
      fromDegree
    };
  };

  debug.push({
    step: 'start',
    remainingCandidateCount: allCandidates.length,
    reason: 'allTonnetzPitchesInRange'
  });

  const keyCandidates = allCandidates.filter((candidate) => input.key.keyPitchSet.has(candidate.pc));
  debug.push({
    step: 'pruneKey',
    remainingCandidateCount: keyCandidates.length,
    reason: 'candidates∩keyPitchSet'
  });

  let activeRelaxationTier = 0;
  const relaxedRules: string[] = [];
  let constrainedKeyCandidates = applyConstraintTier(keyCandidates, {
    allowTransitions: true,
    allowIntervals: true
  });
  debug.push({
    step: 'pruneIllegalTier0',
    remainingCandidateCount: constrainedKeyCandidates.length,
    reason: 'illegalDegrees+illegalIntervals+illegalTransitions'
  });

  if (constrainedKeyCandidates.length === 0) {
    activeRelaxationTier = 1;
    relaxedRules.push('illegalTransitions');
    constrainedKeyCandidates = applyConstraintTier(keyCandidates, {
      allowTransitions: false,
      allowIntervals: true
    });
    debug.push({
      step: 'relaxTier1',
      remainingCandidateCount: constrainedKeyCandidates.length,
      reason: 'ignored illegalTransitions'
    });
  }

  if (constrainedKeyCandidates.length === 0) {
    const degreesOnlyCandidates = applyConstraintTier(keyCandidates, {
      allowTransitions: false,
      allowIntervals: false
    });
    const hadStepwiseIfIntervalsRelaxed = degreesOnlyCandidates.some(
      (candidate) => Math.abs(candidate.midi - input.prevPitch.midi) <= 2
    );

    if (hadStepwiseIfIntervalsRelaxed) {
      activeRelaxationTier = 3;
      if (!relaxedRules.includes('illegalIntervalsSemis')) {
        relaxedRules.push('illegalIntervalsSemis');
      }
      constrainedKeyCandidates = degreesOnlyCandidates;
      debug.push({
        step: 'relaxTier3',
        remainingCandidateCount: constrainedKeyCandidates.length,
        reason: 'relaxed illegalIntervals to preserve stepwise options'
      });
    }
  }

  if (constrainedKeyCandidates.length === 0) {
    debug.push({
      step: 'noSolution',
      remainingCandidateCount: 0,
      reason: 'constraints_too_strict'
    });
    return toNoSolution();
  }

  const chordCandidates = constrainedKeyCandidates.filter((candidate) => input.harmony.chordNowPitchSet.has(candidate.pc));
  debug.push({
    step: 'pruneHarmony',
    remainingCandidateCount: chordCandidates.length,
    reason: 'candidates∩harmonyPitchSet'
  });

  if (input.forceChordTone) {
    const cadenceAdjusted = applyCadenceToCandidates(chordCandidates);
    const forcedChord = chooseBest(cadenceAdjusted.candidates, input, tonnetzDistances, cadenceAdjusted.bonusByMidi);
    if (forcedChord) {
      forcedChord.cadenceFromDegree = cadenceAdjusted.fromDegree;
      forcedChord.startDegree = degreeForPc(forcedChord.candidate.pc);
      withLeapDebug(debug, forcedChord);
      withCadenceDebug(debug, input, forcedChord, cadenceAdjusted.appliedHard);
      debug.push({
        step: 'selectForcedChordTone',
        remainingCandidateCount: chordCandidates.length,
        chosenPitch: candidateToPitchString(forcedChord.candidate),
        reason: 'forcedCadenceChordTone'
      });

      return success(
        createSelectedNoteEvent({
          candidate: forcedChord.candidate,
          role: 'ChordTone',
          reason: 'forcedCadenceChordTone',
          chordId: input.harmony.chordId,
          keyId: input.key.keyId
        }),
        activeRelaxationTier,
        relaxedRules
      );
    }

    // Cadence policy still applies if harmony-pruned set is empty; fall back to key-pruned set.
    const cadenceAdjustedKeyFallback = applyCadenceToCandidates(constrainedKeyCandidates);
    const forcedKeyFallback = chooseBest(
      cadenceAdjustedKeyFallback.candidates,
      input,
      tonnetzDistances,
      cadenceAdjustedKeyFallback.bonusByMidi
    );
    if (forcedKeyFallback) {
      forcedKeyFallback.cadenceFromDegree = cadenceAdjustedKeyFallback.fromDegree;
      forcedKeyFallback.startDegree = degreeForPc(forcedKeyFallback.candidate.pc);
      withLeapDebug(debug, forcedKeyFallback);
      withCadenceDebug(debug, input, forcedKeyFallback, cadenceAdjustedKeyFallback.appliedHard);
      debug.push({
        step: 'cadenceFallbackPath',
        remainingCandidateCount: constrainedKeyCandidates.length,
        chosenPitch: candidateToPitchString(forcedKeyFallback.candidate),
        reason: 'harmonyPrunedEmpty_orRejected_then_keyOnlyWithCadencePolicy'
      });

      const isChordTone = input.harmony.chordNowPitchSet.has(forcedKeyFallback.candidate.pc);
      return success(
        createSelectedNoteEvent({
          candidate: forcedKeyFallback.candidate,
          role: isChordTone ? 'ChordTone' : 'NonHarmonicTone',
          reason: 'forcedCadence_keyOnlyFallback',
          chordId: input.harmony.chordId,
          keyId: input.key.keyId,
          requiresResolution: !isChordTone
        }),
        activeRelaxationTier < 2 ? 2 : activeRelaxationTier,
        activeRelaxationTier < 2 && !relaxedRules.includes('harmonyPreference')
          ? [...relaxedRules, 'harmonyPreference']
          : relaxedRules
      );
    }

    const tonic = nearestTonicInRange(input.key.tonicPc, input.prevPitch, input.range);
    const fallback = tonic ?? { pc: input.key.tonicPc, midi: input.prevPitch.midi };
    debug.push({
      step: 'fallback',
      remainingCandidateCount: 0,
      chosenPitch: candidateToPitchString(fallback),
      reason: 'forcedCadence_noChordTone_returnToTonic'
    });

    return success(
      createSelectedNoteEvent({
        candidate: fallback,
        role: 'FallbackTonic',
        reason: 'forcedCadence_noChordTone_returnToTonic',
        chordId: input.harmony.chordId,
        keyId: input.key.keyId
      }),
      activeRelaxationTier,
      relaxedRules
    );
  }

  if (input.forceNonHarmonic) {
    const forcedNhtCandidates = constrainedKeyCandidates.filter((candidate) => !input.harmony.chordNowPitchSet.has(candidate.pc));
    debug.push({
      step: 'forceNonHarmonic',
      remainingCandidateCount: forcedNhtCandidates.length,
      reason: 'beat2or4_requireNHT'
    });

    const cadenceAdjusted = applyCadenceToCandidates(forcedNhtCandidates);
    const forcedBest = chooseBest(cadenceAdjusted.candidates, input, tonnetzDistances, cadenceAdjusted.bonusByMidi);
    if (forcedBest) {
      withLeapDebug(debug, forcedBest);
      withCadenceDebug(debug, input, forcedBest, cadenceAdjusted.appliedHard);
      debug.push({
        step: 'selectForcedNonHarmonic',
        remainingCandidateCount: forcedNhtCandidates.length,
        chosenPitch: candidateToPitchString(forcedBest.candidate),
        reason: 'forcedBeat24_keyOnly_NHT'
      });

      return success(
        createSelectedNoteEvent({
          candidate: forcedBest.candidate,
          role: 'NonHarmonicTone',
          reason: 'forcedBeat24_keyOnly_NHT',
          chordId: input.harmony.chordId,
          keyId: input.key.keyId,
          requiresResolution: true
        }),
        activeRelaxationTier,
        relaxedRules
      );
    }

    const tonic = nearestTonicInRange(input.key.tonicPc, input.prevPitch, input.range);
    const fallback = tonic ?? { pc: input.key.tonicPc, midi: input.prevPitch.midi };
    debug.push({
      step: 'fallback',
      remainingCandidateCount: 0,
      chosenPitch: candidateToPitchString(fallback),
      reason: 'forcedBeat24_noNHT_returnToTonic'
    });

    return success(
      createSelectedNoteEvent({
        candidate: fallback,
        role: 'FallbackTonic',
        reason: 'forcedBeat24_noNHT_returnToTonic',
        chordId: input.harmony.chordId,
        keyId: input.key.keyId
      }),
      activeRelaxationTier,
      relaxedRules
    );
  }

  if (input.isFirstNote) {
    const preferredStartCandidates = constrainedKeyCandidates.filter(
      (candidate) => degreeForPc(candidate.pc) === (input.startingDegree ?? 1)
    );
    const startPool = preferredStartCandidates.length > 0 ? preferredStartCandidates : constrainedKeyCandidates;
    debug.push({
      step: 'startDegreeFilter',
      remainingCandidateCount: startPool.length,
      reason:
        preferredStartCandidates.length > 0
          ? `preferredStartDegree=${String(input.startingDegree ?? 1)}`
          : `preferredStartDegreeUnavailable_fallbackWeighted=${String(input.startingDegree ?? 1)}`
    });

    const cadenceAdjustedStart = applyCadenceToCandidates(startPool);
    const startBest = chooseBest(cadenceAdjustedStart.candidates, input, tonnetzDistances, cadenceAdjustedStart.bonusByMidi);
    if (startBest) {
      startBest.cadenceFromDegree = cadenceAdjustedStart.fromDegree;
      startBest.startDegree = degreeForPc(startBest.candidate.pc);
      withLeapDebug(debug, startBest);
      withCadenceDebug(debug, input, startBest, cadenceAdjustedStart.appliedHard);
      withStartDebug(debug, input, startBest);
      debug.push({
        step: 'selectStartNote',
        remainingCandidateCount: constrainedKeyCandidates.length,
        chosenPitch: candidateToPitchString(startBest.candidate),
        reason: 'firstNote_weightedScaleDegree'
      });

      return success(
        createSelectedNoteEvent({
          candidate: startBest.candidate,
          role: input.harmony.chordNowPitchSet.has(startBest.candidate.pc) ? 'ChordTone' : 'NonHarmonicTone',
          reason: 'firstNote_weightedScaleDegree',
          chordId: input.harmony.chordId,
          keyId: input.key.keyId,
          requiresResolution: !input.harmony.chordNowPitchSet.has(startBest.candidate.pc)
        }),
        activeRelaxationTier,
        relaxedRules
      );
    }
  }

  const cadenceAdjustedChord = applyCadenceToCandidates(chordCandidates);
  const chordBest = chooseBest(cadenceAdjustedChord.candidates, input, tonnetzDistances, cadenceAdjustedChord.bonusByMidi);
  if (chordBest) {
    chordBest.cadenceFromDegree = cadenceAdjustedChord.fromDegree;
    chordBest.startDegree = degreeForPc(chordBest.candidate.pc);
    withLeapDebug(debug, chordBest);
    withCadenceDebug(debug, input, chordBest, cadenceAdjustedChord.appliedHard);
    withStartDebug(debug, input, chordBest);
    debug.push({
      step: 'selectChordTone',
      remainingCandidateCount: chordCandidates.length,
      chosenPitch: candidateToPitchString(chordBest.candidate),
      reason: 'key+harmony+closest'
    });

    return success(
      createSelectedNoteEvent({
        candidate: chordBest.candidate,
        role: 'ChordTone',
        reason: 'key+harmony+closest',
        chordId: input.harmony.chordId,
        keyId: input.key.keyId
      }),
      activeRelaxationTier,
      relaxedRules
    );
  }

  const cadenceAdjustedKey = applyCadenceToCandidates(constrainedKeyCandidates);
  const nhtBest = chooseBest(cadenceAdjustedKey.candidates, input, tonnetzDistances, cadenceAdjustedKey.bonusByMidi);
  if (nhtBest) {
    nhtBest.cadenceFromDegree = cadenceAdjustedKey.fromDegree;
    nhtBest.startDegree = degreeForPc(nhtBest.candidate.pc);
    withLeapDebug(debug, nhtBest);
    withCadenceDebug(debug, input, nhtBest, cadenceAdjustedKey.appliedHard);
    withStartDebug(debug, input, nhtBest);
    debug.push({
      step: 'graftBackHarmonyPrune',
      remainingCandidateCount: constrainedKeyCandidates.length,
      reason: input.cadenceContext
        ? 'restoreKeyPrunedCandidates_withCadencePolicyFallback'
        : 'restoreKeyPrunedCandidates'
    });
    debug.push({
      step: 'selectNonHarmonic',
      remainingCandidateCount: constrainedKeyCandidates.length,
      chosenPitch: candidateToPitchString(nhtBest.candidate),
      reason: 'keyOnly+closest_NHT'
    });

    if (activeRelaxationTier < 2) {
      activeRelaxationTier = 2;
    }
    if (!relaxedRules.includes('harmonyPreference')) {
      relaxedRules.push('harmonyPreference');
    }

    return success(
      createSelectedNoteEvent({
        candidate: nhtBest.candidate,
        role: 'NonHarmonicTone',
        reason: 'keyOnly+closest_NHT',
        chordId: input.harmony.chordId,
        keyId: input.key.keyId,
        requiresResolution: true
      }),
      activeRelaxationTier,
      relaxedRules
    );
  }

  const tonic = nearestTonicInRange(input.key.tonicPc, input.prevPitch, input.range);
  const fallback = tonic ?? { pc: input.key.tonicPc, midi: input.prevPitch.midi };
  debug.push({
    step: 'fallback',
    remainingCandidateCount: 0,
    chosenPitch: candidateToPitchString(fallback),
    reason: 'noCandidates_returnToTonic'
  });

  return success(
    createSelectedNoteEvent({
      candidate: fallback,
      role: 'FallbackTonic',
      reason: 'noCandidates_returnToTonic',
      chordId: input.harmony.chordId,
      keyId: input.key.keyId
    }),
    activeRelaxationTier,
    relaxedRules
  );
}

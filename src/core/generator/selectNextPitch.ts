import type { TonnetzGraph } from '../tonnetz/buildTonnetz';
import type { PhraseDirection, PhraseTarget } from './phrasePlanner';
import { applyCadencePolicy, type CadenceOption, type CadenceType } from './cadenceVoiceLeading';
import type { IllegalTransitionRule } from '../../tat/models/schema';

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

interface CandidatePitch {
  pc: number;
  midi: number;
}

interface BestResult {
  candidate: CandidatePitch;
  leapReason: 'arpeggiate_same_chord' | 'shared_tone_across_change' | 'leap_to_peak' | 'fallback_leap_penalized_but_best' | null;
  cadenceMatchingOption?: CadenceOption;
  cadenceBonus?: number;
  cadenceFromDegree?: number;
  startDegree?: number;
  startBonus?: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LEAP_INTERVALS = new Set([3, 4, 5, 7]);
const W_START = 10;

function toPitchName(pc: number): string {
  return NOTE_NAMES[((pc % 12) + 12) % 12];
}

function toOctave(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

function buildAllCandidates(tonnetz: TonnetzGraph, range: PitchRange): CandidatePitch[] {
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

function scaleDistance(candidateMidi: number, prevMidi: number, keyScale: number[]): { diatonic: number; semitone: number } {
  const toScalePosition = (midi: number): number | null => {
    const pc = ((midi % 12) + 12) % 12;
    const degreeIndex = keyScale.indexOf(pc);
    if (degreeIndex === -1) {
      return null;
    }

    const octave = Math.floor(midi / 12);
    return octave * 7 + degreeIndex;
  };

  const posA = toScalePosition(prevMidi);
  const posB = toScalePosition(candidateMidi);

  const diatonic = posA === null || posB === null ? 999 : Math.abs(posB - posA);
  const semitone = Math.abs(candidateMidi - prevMidi);

  return { diatonic, semitone };
}

function precomputeTonnetzDistances(tonnetz: TonnetzGraph): Map<string, number> {
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

function nearestTonicInRange(tonicPc: number, prev: PrevPitch, range: PitchRange): CandidatePitch | null {
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

function chooseBest(
  candidates: CandidatePitch[],
  input: SelectNextPitchInput,
  tonnetzDistances: Map<string, number>,
  cadenceBonusByMidi: Map<number, { bonus: number; matchingOption?: CadenceOption }>
): BestResult | null {
  if (candidates.length === 0) {
    return null;
  }

  const prevPitch = input.prevPitch;
  const keyScale = input.key.keyScale;
  const tonicPc = input.key.tonicPc;
  const chordNowPitchSet = input.harmony.chordNowPitchSet;
  const chordNextPitchSet = input.harmony.chordNextPitchSet;
  const sharedTones = new Set([...chordNowPitchSet].filter((pc) => chordNextPitchSet.has(pc)));

  const leadingTonePc = keyScale[6] ?? ((tonicPc + 11) % 12);
  const pcOfMidi = (midi: number): number => ((midi % 12) + 12) % 12;
  const sign = (value: number): number => (value > 0 ? 1 : value < 0 ? -1 : 0);

  const degreeForPc = (pc: number): number => {
    const idx = keyScale.indexOf(((pc % 12) + 12) % 12);
    return idx === -1 ? 1 : idx + 1;
  };

  const startDegreeWeight = (degree: number): number => {
    if (degree === 1) {
      return 0.5;
    }
    if (degree === 5) {
      return 0.3;
    }
    if (degree === 3) {
      return 0.2;
    }
    return 0.05;
  };

  const penaltyDoToTiDown = (candMidi: number): number => {
    if (input.cadenceApproach) {
      return 0;
    }

    const prevPc = pcOfMidi(prevPitch.midi);
    const candPc = pcOfMidi(candMidi);
    return prevPc === tonicPc && candPc === leadingTonePc && candMidi < prevPitch.midi ? 1 : 0;
  };

  const bonusTiToDoUp = (candMidi: number): number => {
    const prevPc = pcOfMidi(prevPitch.midi);
    const candPc = pcOfMidi(candMidi);
    return prevPc === leadingTonePc && candPc === tonicPc && candMidi > prevPitch.midi ? 1 : 0;
  };

  const directionAlignment = (candidate: CandidatePitch): number => {
    const phrase = input.phrase;
    if (!phrase) {
      return 0;
    }

    const up = candidate.midi > prevPitch.midi;
    const down = candidate.midi < prevPitch.midi;
    const expected = phrase.expectedMotion ?? 'any';

    if (expected === 'up') {
      return up ? 1 : down ? -1 : 0;
    }
    if (expected === 'down') {
      return down ? 1 : up ? -1 : 0;
    }

    if (phrase.direction === 'wave' && phrase.recentHistory.length >= 2) {
      const trend = phrase.recentHistory[phrase.recentHistory.length - 1] - phrase.recentHistory[phrase.recentHistory.length - 2];
      if (trend > 0) {
        return up ? 0.6 : down ? -0.6 : 0;
      }
      if (trend < 0) {
        return down ? 0.6 : up ? -0.6 : 0;
      }
    }

    return 0;
  };

  const targetCloseness = (candidate: CandidatePitch): number => {
    const targetDegree = input.phrase?.currentPhraseTarget?.targetDegree;
    if (!targetDegree) {
      return 0;
    }

    const candidateDegree = degreeForPc(candidate.pc);
    const distance = Math.abs(candidateDegree - targetDegree);
    return 1 / (1 + distance);
  };

  const immediateBacktrackPenalty = (candidate: CandidatePitch): number => {
    const history = input.phrase?.recentHistory ?? [];
    if (history.length < 2) {
      return 0;
    }

    const prev = history[history.length - 1];
    const prevPrev = history[history.length - 2];
    return candidate.midi === prevPrev && prev !== prevPrev ? 1 : 0;
  };

  const stallPenalty = (candidate: CandidatePitch): number => {
    const samePitch = candidate.midi === prevPitch.midi ? 1 : 0;
    return samePitch * Math.max(0, input.phrase?.stallStreak ?? 0);
  };

  const oppositionPenalty = (candidate: CandidatePitch): number => {
    const expected = input.phrase?.expectedMotion ?? 'any';
    if (expected === 'any') {
      return 0;
    }

    const opposed = expected === 'up' ? candidate.midi < prevPitch.midi : candidate.midi > prevPitch.midi;
    return opposed ? Math.max(1, input.phrase?.oppositionStreak ?? 0) : 0;
  };

  const peakDeadlinePenalty = (candidate: CandidatePitch): number => {
    if (!input.phrase?.peakDeadlineActive) {
      return 0;
    }

    const expected = input.phrase.expectedMotion ?? 'any';
    if (expected === 'up') {
      return candidate.midi <= prevPitch.midi ? 1 : 0;
    }
    if (expected === 'down') {
      return candidate.midi >= prevPitch.midi ? 1 : 0;
    }
    return 0;
  };

  const tooStepwisePenalty = (_candidate: CandidatePitch, intervalSemis: number): number => {
    const history = input.phrase?.recentHistory ?? [];
    if (history.length < 7) {
      return 0;
    }

    const lastIntervals = history.slice(-7).map((midi, i, arr) => (i === 0 ? 0 : Math.abs(midi - arr[i - 1]))).slice(1);
    const allStepwise = lastIntervals.length === 6 && lastIntervals.every((interval) => interval <= 2);
    return allStepwise && intervalSemis <= 2 ? 1 : 0;
  };

  const prevMotionInfo = (): { interval: number; direction: number } | null => {
    const history = input.phrase?.recentHistory ?? [];
    if (history.length < 2) {
      return null;
    }

    const prev = history[history.length - 1];
    const prevPrev = history[history.length - 2];
    return {
      interval: Math.abs(prev - prevPrev),
      direction: sign(prev - prevPrev)
    };
  };

  const sorted = [...candidates]
    .map((candidate) => {
      const intervalSemis = Math.abs(candidate.midi - prevPitch.midi);
      const isStep = intervalSemis <= 2;
      const isLeap = intervalSemis >= 3;
      const isAllowedLeap = LEAP_INTERVALS.has(intervalSemis);
      const isChordToneNow = chordNowPitchSet.has(candidate.pc);
      const isSharedTone = sharedTones.has(candidate.pc);
      const prevIsChordToneNow = chordNowPitchSet.has(prevPitch.pc);

      let leapReason: BestResult['leapReason'] = null;
      let leapBonus = 0;

      if (isAllowedLeap) {
        // Musical skip/leap A: reward arpeggiation in stable harmony.
        if (!input.harmony.harmonyChangesNext && prevIsChordToneNow && isChordToneNow && (intervalSemis === 3 || intervalSemis === 4 || intervalSemis === 7)) {
          leapBonus += 3.9;
          leapReason = 'arpeggiate_same_chord';
        }

        // Musical skip/leap B: reward shared-tone connectivity across harmony changes.
        if (input.harmony.harmonyChangesNext && isSharedTone) {
          leapBonus += 3.4;
          leapReason = 'shared_tone_across_change';
        }

        // Musical skip/leap C: allow expressive lift into phrase peak window.
        if (input.phrase?.peakApproachWindow && isChordToneNow && (intervalSemis === 3 || intervalSemis === 4 || intervalSemis === 7)) {
          const peakTarget = input.phrase.peakTargetDegree ?? input.phrase.currentPhraseTarget?.targetDegree;
          if (peakTarget) {
            const prevDistance = Math.abs(degreeForPc(prevPitch.pc) - peakTarget);
            const nextDistance = Math.abs(degreeForPc(candidate.pc) - peakTarget);
            if (nextDistance < prevDistance) {
              leapBonus += 4.1;
              leapReason = 'leap_to_peak';
            }
          }
        }
      }

      if (isSharedTone && input.harmony.harmonyChangesNext && !isLeap) {
        leapBonus += 1.3;
      }

      const prevMotion = prevMotionInfo();
      const unrepairedLeapPenalty = (() => {
        if (!prevMotion || prevMotion.interval < 3) {
          return 0;
        }

        // Singability guard: after a leap, prefer opposite stepwise repair.
        const nextDirection = sign(candidate.midi - prevPitch.midi);
        if (isStep && nextDirection !== 0 && nextDirection === -prevMotion.direction) {
          return 0;
        }
        return 1;
      })();

      const leapToNonChordPenalty = isLeap && !isChordToneNow ? 1 : 0;
      const disallowedLargeLeapPenalty = intervalSemis > 7 ? 1 : 0;

      const distance = scaleDistance(candidate.midi, prevPitch.midi, keyScale);
      const tonnetzDistance = tonnetzDistances.get(`${prevPitch.pc}->${candidate.pc}`) ?? 999;

      const targetPriority = input.phrase?.currentPhraseTarget?.priority ?? 'low';
      const priorityWeight = targetPriority === 'high' ? 1.35 : targetPriority === 'medium' ? 1.05 : 0.8;
      const candidateDegree = degreeForPc(candidate.pc);
      const startBonus = input.isFirstNote ? Math.log(startDegreeWeight(candidateDegree)) * W_START : 0;

      const W_TARGET = 5.2 * priorityWeight;
      const W_DIRECTION = 4.4;
      const W_BACKTRACK = 2.8;
      const W_DO_TI_PENALTY = 2.6;
      const W_TI_DO_BONUS = 1.8;
      const W_STALL = 3.0;
      const W_OPPOSITION = 2.9;
      const W_PEAK_DEADLINE = 7.5;
      const W_UNREPAIRED = 4.7;
      const W_LEAP_NONCHORD = 3.8;
      const W_TOO_STEPWISE = 1.4;
      const W_BIG_LEAP = 5.8;
      const W_STRONG_CHORD = 1.8;

      const base = -(distance.diatonic * 1.7 + distance.semitone * 0.28 + tonnetzDistance * 0.14);

      const score =
        base +
        (cadenceBonusByMidi.get(candidate.midi)?.bonus ?? 0) +
        startBonus +
        W_TARGET * targetCloseness(candidate) +
        W_DIRECTION * directionAlignment(candidate) +
        leapBonus +
        (input.isStrongBeat && isChordToneNow ? W_STRONG_CHORD : 0) -
        W_BACKTRACK * immediateBacktrackPenalty(candidate) -
        W_STALL * stallPenalty(candidate) -
        W_OPPOSITION * oppositionPenalty(candidate) -
        W_PEAK_DEADLINE * peakDeadlinePenalty(candidate) -
        W_UNREPAIRED * unrepairedLeapPenalty -
        W_LEAP_NONCHORD * leapToNonChordPenalty -
        W_TOO_STEPWISE * tooStepwisePenalty(candidate, intervalSemis) -
        W_BIG_LEAP * disallowedLargeLeapPenalty -
        W_DO_TI_PENALTY * penaltyDoToTiDown(candidate.midi) +
        W_TI_DO_BONUS * bonusTiToDoUp(candidate.midi);

      const resolvedLeapReason: BestResult['leapReason'] = isLeap
        ? (leapReason ?? 'fallback_leap_penalized_but_best')
        : null;

      return {
        candidate,
        score,
        distance,
        tonnetzDistance,
        leapReason: resolvedLeapReason,
        cadenceMatchingOption: cadenceBonusByMidi.get(candidate.midi)?.matchingOption,
        cadenceBonus: cadenceBonusByMidi.get(candidate.midi)?.bonus ?? 0,
        startDegree: candidateDegree,
        startBonus
      };
    })
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }

      if (a.distance.diatonic !== b.distance.diatonic) {
        return a.distance.diatonic - b.distance.diatonic;
      }

      if (a.distance.semitone !== b.distance.semitone) {
        return a.distance.semitone - b.distance.semitone;
      }

      if (a.tonnetzDistance !== b.tonnetzDistance) {
        return a.tonnetzDistance - b.tonnetzDistance;
      }

      if (a.candidate.pc !== b.candidate.pc) {
        return a.candidate.pc - b.candidate.pc;
      }

      const aMidiDistance = Math.abs(a.candidate.midi - prevPitch.midi);
      const bMidiDistance = Math.abs(b.candidate.midi - prevPitch.midi);
      if (aMidiDistance !== bMidiDistance) {
        return aMidiDistance - bMidiDistance;
      }

      return ((a.candidate.midi + input.seed) % 2) - ((b.candidate.midi + input.seed) % 2);
    });

  return {
    candidate: sorted[0].candidate,
    leapReason: sorted[0].leapReason,
    cadenceMatchingOption: sorted[0].cadenceMatchingOption,
    cadenceBonus: sorted[0].cadenceBonus,
    startDegree: sorted[0].startDegree,
    startBonus: sorted[0].startBonus
  };
}

function candidateToPitchString(candidate: CandidatePitch): string {
  return `${toPitchName(candidate.pc)}${toOctave(candidate.midi)}`;
}

function withLeapDebug(debug: SelectionDebug[], result: BestResult): void {
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

function withCadenceDebug(debug: SelectionDebug[], input: SelectNextPitchInput, result: BestResult, appliedHard: boolean): void {
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

function withStartDebug(debug: SelectionDebug[], input: SelectNextPitchInput, result: BestResult): void {
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
        {
          pitch: toPitchName(forcedChord.candidate.pc),
          octave: toOctave(forcedChord.candidate.midi),
          midi: forcedChord.candidate.midi,
          role: 'ChordTone',
          reason: 'forcedCadenceChordTone',
          chordId: input.harmony.chordId,
          keyId: input.key.keyId
        },
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
        {
          pitch: toPitchName(forcedKeyFallback.candidate.pc),
          octave: toOctave(forcedKeyFallback.candidate.midi),
          midi: forcedKeyFallback.candidate.midi,
          role: isChordTone ? 'ChordTone' : 'NonHarmonicTone',
          reason: 'forcedCadence_keyOnlyFallback',
          chordId: input.harmony.chordId,
          keyId: input.key.keyId,
          nht: isChordTone
            ? undefined
            : {
                requiresResolution: true
              }
        },
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
      {
        pitch: toPitchName(fallback.pc),
        octave: toOctave(fallback.midi),
        midi: fallback.midi,
        role: 'FallbackTonic',
        reason: 'forcedCadence_noChordTone_returnToTonic',
        chordId: input.harmony.chordId,
        keyId: input.key.keyId
      },
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
        {
          pitch: toPitchName(forcedBest.candidate.pc),
          octave: toOctave(forcedBest.candidate.midi),
          midi: forcedBest.candidate.midi,
          role: 'NonHarmonicTone',
          reason: 'forcedBeat24_keyOnly_NHT',
          chordId: input.harmony.chordId,
          keyId: input.key.keyId,
          nht: {
            requiresResolution: true
          }
        },
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
      {
        pitch: toPitchName(fallback.pc),
        octave: toOctave(fallback.midi),
        midi: fallback.midi,
        role: 'FallbackTonic',
        reason: 'forcedBeat24_noNHT_returnToTonic',
        chordId: input.harmony.chordId,
        keyId: input.key.keyId
      },
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
        {
          pitch: toPitchName(startBest.candidate.pc),
          octave: toOctave(startBest.candidate.midi),
          midi: startBest.candidate.midi,
          role: input.harmony.chordNowPitchSet.has(startBest.candidate.pc) ? 'ChordTone' : 'NonHarmonicTone',
          reason: 'firstNote_weightedScaleDegree',
          chordId: input.harmony.chordId,
          keyId: input.key.keyId,
          nht: input.harmony.chordNowPitchSet.has(startBest.candidate.pc)
            ? undefined
            : {
                requiresResolution: true
              }
        },
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
      {
        pitch: toPitchName(chordBest.candidate.pc),
        octave: toOctave(chordBest.candidate.midi),
        midi: chordBest.candidate.midi,
        role: 'ChordTone',
        reason: 'key+harmony+closest',
        chordId: input.harmony.chordId,
        keyId: input.key.keyId
      },
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
      {
        pitch: toPitchName(nhtBest.candidate.pc),
        octave: toOctave(nhtBest.candidate.midi),
        midi: nhtBest.candidate.midi,
        role: 'NonHarmonicTone',
        reason: 'keyOnly+closest_NHT',
        chordId: input.harmony.chordId,
        keyId: input.key.keyId,
        nht: {
          requiresResolution: true
        }
      },
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
    {
      pitch: toPitchName(fallback.pc),
      octave: toOctave(fallback.midi),
      midi: fallback.midi,
      role: 'FallbackTonic',
      reason: 'noCandidates_returnToTonic',
      chordId: input.harmony.chordId,
      keyId: input.key.keyId
    },
    activeRelaxationTier,
    relaxedRules
  );
}

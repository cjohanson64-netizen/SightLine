import type { TonnetzGraph } from '../tonnetz/buildTonnetz';
import type { PhraseDirection, PhraseTarget } from './phrasePlanner';

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
    harmonyPitchSet: Set<number>;
  };
  prevPitch: PrevPitch;
  range: PitchRange;
  seed: number;
  forceNonHarmonic?: boolean;
  forceChordTone?: boolean;
  cadenceApproach?: boolean;
  phrase?: {
    currentPhraseTarget?: PhraseTarget;
    direction: PhraseDirection;
    peakMeasure: number;
    currentMeasure: number;
    recentHistory: number[];
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
  noteEvent: SelectedNoteEvent;
  debug: SelectionDebug[];
}

interface CandidatePitch {
  pc: number;
  midi: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function toPitchName(pc: number): string {
  return NOTE_NAMES[((pc % 12) + 12) % 12];
}

function toOctave(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

function buildAllCandidates(tonnetz: TonnetzGraph, range: PitchRange): CandidatePitch[] {
  const pcs = tonnetz.nodes.map((node) => node.pitchClass);
  const result: CandidatePitch[] = [];

  for (let midi = range.minMidi; midi <= range.maxMidi; midi += 1) {
    const pc = ((midi % 12) + 12) % 12;
    if (pcs.includes(pc)) {
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
  prevPitch: PrevPitch,
  tonicPc: number,
  keyScale: number[],
  tonnetzDistances: Map<string, number>,
  seed: number,
  cadenceApproach: boolean,
  phrase?: SelectNextPitchInput['phrase']
): CandidatePitch | null {
  if (candidates.length === 0) {
    return null;
  }

  const leadingTonePc = keyScale[6] ?? ((tonicPc + 11) % 12);
  const pcOfMidi = (midi: number): number => ((midi % 12) + 12) % 12;

  const penaltyDoToTiDown = (candMidi: number): number => {
    if (cadenceApproach) {
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

  const degreeForPc = (pc: number): number => {
    const idx = keyScale.indexOf(((pc % 12) + 12) % 12);
    return idx === -1 ? 1 : idx + 1;
  };

  const targetDegree = phrase?.currentPhraseTarget?.targetDegree;
  const targetPriority = phrase?.currentPhraseTarget?.priority ?? 'low';
  const priorityWeight = targetPriority === 'high' ? 1.2 : targetPriority === 'medium' ? 1.0 : 0.8;
  const W_TARGET = 2.8 * priorityWeight;
  const W_DIRECTION = 1.7;
  const W_BACKTRACK = 2.2;
  const W_DO_TI_PENALTY = 2.6;
  const W_TI_DO_BONUS = 1.8;

  const directionAlignment = (candidate: CandidatePitch): number => {
    if (!phrase) {
      return 0;
    }

    const up = candidate.midi > prevPitch.midi;
    const down = candidate.midi < prevPitch.midi;
    const isBeforePeak = phrase.currentMeasure < phrase.peakMeasure;
    const isAfterPeak = phrase.currentMeasure > phrase.peakMeasure;

    if (phrase.direction === 'ascending') {
      return up ? 1 : down ? -1 : 0;
    }
    if (phrase.direction === 'descending') {
      return down ? 1 : up ? -1 : 0;
    }
    if (phrase.direction === 'arch') {
      if (isBeforePeak) {
        return up ? 1 : down ? -1 : 0;
      }
      if (isAfterPeak) {
        return down ? 1 : up ? -1 : 0;
      }
      return 0;
    }
    if (phrase.direction === 'invertedArch') {
      if (isBeforePeak) {
        return down ? 1 : up ? -1 : 0;
      }
      if (isAfterPeak) {
        return up ? 1 : down ? -1 : 0;
      }
      return 0;
    }

    const h = phrase.recentHistory;
    if (h.length >= 2) {
      const trend = h[h.length - 1] - h[h.length - 2];
      if (trend > 0) {
        return up ? 0.7 : down ? -0.7 : 0;
      }
      if (trend < 0) {
        return down ? 0.7 : up ? -0.7 : 0;
      }
    }
    return 0;
  };

  const immediateBacktrackPenalty = (candidate: CandidatePitch): number => {
    if (!phrase || phrase.recentHistory.length < 2) {
      return 0;
    }

    const prev = phrase.recentHistory[phrase.recentHistory.length - 1];
    const prevPrev = phrase.recentHistory[phrase.recentHistory.length - 2];
    return candidate.midi === prevPrev && prev !== prevPrev ? 1 : 0;
  };

  const targetCloseness = (candidate: CandidatePitch): number => {
    if (!targetDegree) {
      return 0;
    }
    const candidateDegree = degreeForPc(candidate.pc);
    const distance = Math.abs(candidateDegree - targetDegree);
    return 1 / (1 + distance);
  };

  const sorted = [...candidates].sort((a, b) => {
    const adMidi = scaleDistance(a.midi, prevPitch.midi, keyScale);
    const bdMidi = scaleDistance(b.midi, prevPitch.midi, keyScale);
    const aTonnetz = tonnetzDistances.get(`${prevPitch.pc}->${a.pc}`) ?? 999;
    const bTonnetz = tonnetzDistances.get(`${prevPitch.pc}->${b.pc}`) ?? 999;

    const aBase = -(adMidi.diatonic * 3.6 + adMidi.semitone * 0.9 + aTonnetz * 0.25);
    const bBase = -(bdMidi.diatonic * 3.6 + bdMidi.semitone * 0.9 + bTonnetz * 0.25);
    const aScore =
      aBase +
      W_TARGET * targetCloseness(a) +
      W_DIRECTION * directionAlignment(a) -
      W_BACKTRACK * immediateBacktrackPenalty(a) -
      W_DO_TI_PENALTY * penaltyDoToTiDown(a.midi) +
      W_TI_DO_BONUS * bonusTiToDoUp(a.midi);
    const bScore =
      bBase +
      W_TARGET * targetCloseness(b) +
      W_DIRECTION * directionAlignment(b) -
      W_BACKTRACK * immediateBacktrackPenalty(b) -
      W_DO_TI_PENALTY * penaltyDoToTiDown(b.midi) +
      W_TI_DO_BONUS * bonusTiToDoUp(b.midi);

    if (aScore !== bScore) {
      return bScore - aScore;
    }

    if (adMidi.diatonic !== bdMidi.diatonic) {
      return adMidi.diatonic - bdMidi.diatonic;
    }

    const aStepwisePenalty = adMidi.diatonic === 1 ? 0 : 1;
    const bStepwisePenalty = bdMidi.diatonic === 1 ? 0 : 1;
    if (aStepwisePenalty !== bStepwisePenalty) {
      return aStepwisePenalty - bStepwisePenalty;
    }

    if (adMidi.semitone !== bdMidi.semitone) {
      return adMidi.semitone - bdMidi.semitone;
    }

    if (aTonnetz !== bTonnetz) {
      return aTonnetz - bTonnetz;
    }

    if (a.pc !== b.pc) {
      return a.pc - b.pc;
    }

    const aMidi = Math.abs(a.midi - prevPitch.midi);
    const bMidi = Math.abs(b.midi - prevPitch.midi);
    if (aMidi !== bMidi) {
      return aMidi - bMidi;
    }

    return ((a.midi + seed) % 2) - ((b.midi + seed) % 2);
  });

  return sorted[0];
}

function candidateToPitchString(candidate: CandidatePitch): string {
  return `${toPitchName(candidate.pc)}${toOctave(candidate.midi)}`;
}

export function selectNextPitch(input: SelectNextPitchInput): SelectNextPitchOutput {
  const debug: SelectionDebug[] = [];
  const allCandidates = buildAllCandidates(input.tonnetz, input.range);
  const tonnetzDistances = precomputeTonnetzDistances(input.tonnetz);

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

  if (keyCandidates.length === 0) {
    const tonic = nearestTonicInRange(input.key.tonicPc, input.prevPitch, input.range);
    const fallback = tonic ?? { pc: input.key.tonicPc, midi: input.prevPitch.midi };
    debug.push({
      step: 'fallback',
      remainingCandidateCount: 0,
      chosenPitch: candidateToPitchString(fallback),
      reason: 'noCandidates_returnToTonic'
    });

    return {
      noteEvent: {
        pitch: toPitchName(fallback.pc),
        octave: toOctave(fallback.midi),
        midi: fallback.midi,
        role: 'FallbackTonic',
        reason: 'noCandidates_returnToTonic',
        chordId: input.harmony.chordId,
        keyId: input.key.keyId
      },
      debug
    };
  }

  const chordCandidates = keyCandidates.filter((candidate) => input.harmony.harmonyPitchSet.has(candidate.pc));
  debug.push({
    step: 'pruneHarmony',
    remainingCandidateCount: chordCandidates.length,
    reason: 'candidates∩harmonyPitchSet'
  });

  if (input.forceChordTone) {
    const forcedChord = chooseBest(
      chordCandidates,
      input.prevPitch,
      input.key.tonicPc,
      input.key.keyScale,
      tonnetzDistances,
      input.seed,
      Boolean(input.cadenceApproach),
      input.phrase
    );
    if (forcedChord) {
      debug.push({
        step: 'selectForcedChordTone',
        remainingCandidateCount: chordCandidates.length,
        chosenPitch: candidateToPitchString(forcedChord),
        reason: 'forcedCadenceChordTone'
      });

      return {
        noteEvent: {
          pitch: toPitchName(forcedChord.pc),
          octave: toOctave(forcedChord.midi),
          midi: forcedChord.midi,
          role: 'ChordTone',
          reason: 'forcedCadenceChordTone',
          chordId: input.harmony.chordId,
          keyId: input.key.keyId
        },
        debug
      };
    }

    const tonic = nearestTonicInRange(input.key.tonicPc, input.prevPitch, input.range);
    const fallback = tonic ?? { pc: input.key.tonicPc, midi: input.prevPitch.midi };
    debug.push({
      step: 'fallback',
      remainingCandidateCount: 0,
      chosenPitch: candidateToPitchString(fallback),
      reason: 'forcedCadence_noChordTone_returnToTonic'
    });

    return {
      noteEvent: {
        pitch: toPitchName(fallback.pc),
        octave: toOctave(fallback.midi),
        midi: fallback.midi,
        role: 'FallbackTonic',
        reason: 'forcedCadence_noChordTone_returnToTonic',
        chordId: input.harmony.chordId,
        keyId: input.key.keyId
      },
      debug
    };
  }

  if (input.forceNonHarmonic) {
    const forcedNhtCandidates = keyCandidates.filter((candidate) => !input.harmony.harmonyPitchSet.has(candidate.pc));
    debug.push({
      step: 'forceNonHarmonic',
      remainingCandidateCount: forcedNhtCandidates.length,
      reason: 'beat2or4_requireNHT'
    });

    const forcedBest = chooseBest(
      forcedNhtCandidates,
      input.prevPitch,
      input.key.tonicPc,
      input.key.keyScale,
      tonnetzDistances,
      input.seed,
      Boolean(input.cadenceApproach),
      input.phrase
    );
    if (forcedBest) {
      debug.push({
        step: 'selectForcedNonHarmonic',
        remainingCandidateCount: forcedNhtCandidates.length,
        chosenPitch: candidateToPitchString(forcedBest),
        reason: 'forcedBeat24_keyOnly_NHT'
      });

      return {
        noteEvent: {
          pitch: toPitchName(forcedBest.pc),
          octave: toOctave(forcedBest.midi),
          midi: forcedBest.midi,
          role: 'NonHarmonicTone',
          reason: 'forcedBeat24_keyOnly_NHT',
          chordId: input.harmony.chordId,
          keyId: input.key.keyId,
          nht: {
            requiresResolution: true
          }
        },
        debug
      };
    }

    const tonic = nearestTonicInRange(input.key.tonicPc, input.prevPitch, input.range);
    const fallback = tonic ?? { pc: input.key.tonicPc, midi: input.prevPitch.midi };
    debug.push({
      step: 'fallback',
      remainingCandidateCount: 0,
      chosenPitch: candidateToPitchString(fallback),
      reason: 'forcedBeat24_noNHT_returnToTonic'
    });

    return {
      noteEvent: {
        pitch: toPitchName(fallback.pc),
        octave: toOctave(fallback.midi),
        midi: fallback.midi,
        role: 'FallbackTonic',
        reason: 'forcedBeat24_noNHT_returnToTonic',
        chordId: input.harmony.chordId,
        keyId: input.key.keyId
      },
      debug
    };
  }

  const chordBest = chooseBest(
    chordCandidates,
    input.prevPitch,
    input.key.tonicPc,
    input.key.keyScale,
    tonnetzDistances,
    input.seed,
    Boolean(input.cadenceApproach),
    input.phrase
  );
  if (chordBest) {
    debug.push({
      step: 'selectChordTone',
      remainingCandidateCount: chordCandidates.length,
      chosenPitch: candidateToPitchString(chordBest),
      reason: 'key+harmony+closest'
    });

    return {
      noteEvent: {
        pitch: toPitchName(chordBest.pc),
        octave: toOctave(chordBest.midi),
        midi: chordBest.midi,
        role: 'ChordTone',
        reason: 'key+harmony+closest',
        chordId: input.harmony.chordId,
        keyId: input.key.keyId
      },
      debug
    };
  }

  const nhtBest = chooseBest(
    keyCandidates,
    input.prevPitch,
    input.key.tonicPc,
    input.key.keyScale,
    tonnetzDistances,
    input.seed,
    Boolean(input.cadenceApproach),
    input.phrase
  );
  if (nhtBest) {
    debug.push({
      step: 'graftBackHarmonyPrune',
      remainingCandidateCount: keyCandidates.length,
      reason: 'restoreKeyPrunedCandidates'
    });
    debug.push({
      step: 'selectNonHarmonic',
      remainingCandidateCount: keyCandidates.length,
      chosenPitch: candidateToPitchString(nhtBest),
      reason: 'keyOnly+closest_NHT'
    });

    return {
      noteEvent: {
        pitch: toPitchName(nhtBest.pc),
        octave: toOctave(nhtBest.midi),
        midi: nhtBest.midi,
        role: 'NonHarmonicTone',
        reason: 'keyOnly+closest_NHT',
        chordId: input.harmony.chordId,
        keyId: input.key.keyId,
        nht: {
          requiresResolution: true
        }
      },
      debug
    };
  }

  const tonic = nearestTonicInRange(input.key.tonicPc, input.prevPitch, input.range);
  const fallback = tonic ?? { pc: input.key.tonicPc, midi: input.prevPitch.midi };
  debug.push({
    step: 'fallback',
    remainingCandidateCount: 0,
    chosenPitch: candidateToPitchString(fallback),
    reason: 'noCandidates_returnToTonic'
  });

  return {
    noteEvent: {
      pitch: toPitchName(fallback.pc),
      octave: toOctave(fallback.midi),
      midi: fallback.midi,
      role: 'FallbackTonic',
      reason: 'noCandidates_returnToTonic',
      chordId: input.harmony.chordId,
      keyId: input.key.keyId
    },
    debug
  };
}

import type { CadenceOption } from './cadenceVoiceLeading';
import type { BestResult, CandidatePitch, SelectNextPitchInput } from './selectNextPitchCore';

const LEAP_INTERVALS = new Set([3, 4, 5, 7]);
const W_START = 10;

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

function downwardLeapTastePenalty(
  prevDegree: number,
  candidateDegree: number,
  interval: number
): number {
  if (interval >= 0) {
    return 0;
  }

  const absInterval = Math.abs(interval);
  if (absInterval <= 4) {
    return 0;
  }
  if (absInterval === 5) {
    if (
      (prevDegree === 1 && candidateDegree === 5) ||
      (prevDegree === 5 && candidateDegree === 2)
    ) {
      return -0.3;
    }
    if (prevDegree === 4 && candidateDegree === 1) {
      return 0.5;
    }
    return 0.3;
  }
  if (absInterval === 7) {
    if (prevDegree === 5 && candidateDegree === 1) {
      return 1.0;
    }
    if (prevDegree === 1 && candidateDegree === 4) {
      return 3.0;
    }
    return 1.7;
  }
  if (absInterval === 8 || absInterval === 9) {
    return 4.5;
  }
  if (absInterval === 10 || absInterval === 11) {
    return 7.0;
  }
  return 9.0;
}

function tendencyToneMotionPenalty(
  prevDegree: number,
  candidateDegree: number,
  interval: number
): number {
  const absInterval = Math.abs(interval);
  const unstableDegrees = new Set([4, 7]);
  let penalty = 0;
  if (unstableDegrees.has(candidateDegree) && absInterval > 2) {
    penalty += 2.6;
  }
  if (unstableDegrees.has(prevDegree) && absInterval > 2) {
    penalty += 2.9;
  }
  return penalty;
}

function tonicCadencePenalty(
  prevDegree: number,
  candidateDegree: number,
  interval: number,
  options: {
    cadenceZone: boolean;
    prevTessituraProgress: number;
    strongContext: boolean;
  }
): number {
  if (prevDegree !== 1) {
    return 0;
  }

  let penalty = 0;
  if (candidateDegree === 2 && interval > 0) {
    penalty += options.cadenceZone ? 4.4 : 1.6;
    if (options.prevTessituraProgress >= 0.65) {
      penalty += 1.4;
    }
    if (options.strongContext) {
      penalty += 1;
    }
  }
  if (candidateDegree === 1) {
    penalty -= options.cadenceZone ? 0.7 : 0.25;
  }
  if ((candidateDegree === 7 || candidateDegree === 6) && interval < 0) {
    penalty -= options.cadenceZone ? 0.8 : 0.3;
  }
  return penalty;
}

function leadingToneResolutionPenalty(
  prevDegree: number,
  candidateDegree: number,
  interval: number,
  options: {
    cadenceZone: boolean;
    descendingBias: boolean;
  }
): number {
  if (prevDegree !== 7) {
    return 0;
  }

  const absInterval = Math.abs(interval);
  if (candidateDegree === 1 && interval > 0 && absInterval <= 2) {
    return options.cadenceZone ? -3.0 : -2.0;
  }
  if (candidateDegree === 6 && interval < 0 && absInterval <= 2) {
    return options.cadenceZone
      ? (options.descendingBias ? -0.7 : 0.8)
      : (options.descendingBias ? -0.5 : 1.0);
  }
  if (candidateDegree === 2) {
    return options.cadenceZone ? 5.0 : 3.0;
  }
  if (absInterval > 2) {
    return options.cadenceZone ? 5.8 : 4.0;
  }
  return options.cadenceZone ? 2.1 : 1.4;
}

export function chooseBest(
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

  const tessituraProgress = (midi: number): number => {
    const span = Math.max(1, input.range.maxMidi - input.range.minMidi);
    return (midi - input.range.minMidi) / span;
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

  const peakDegreeProgressBonus = (candidate: CandidatePitch): number => {
    const peakTarget = input.phrase?.peakTargetDegree;
    if (!peakTarget) {
      return 0;
    }
    const prevDistance = Math.abs(degreeForPc(prevPitch.pc) - peakTarget);
    const nextDistance = Math.abs(degreeForPc(candidate.pc) - peakTarget);
    if (nextDistance >= prevDistance) {
      return 0;
    }
    const styleBonus =
      input.phrase?.climaxStyle === 'stepwise'
        ? 1.2
        : input.phrase?.climaxStyle === 'leap'
          ? 0.9
          : 1;
    return (prevDistance - nextDistance) * styleBonus;
  };

  const climaxArrivalBonus = (candidate: CandidatePitch): number => {
    const phrase = input.phrase;
    if (!phrase || phrase.currentMeasure !== phrase.peakMeasure) {
      return 0;
    }
    const peakTarget = phrase.peakTargetDegree;
    const degreeBonus = peakTarget
      ? Math.max(0, 3 - Math.abs(degreeForPc(candidate.pc) - peakTarget))
      : 0;
    const interval = Math.abs(candidate.midi - prevPitch.midi);
    const styleBonus =
      phrase.climaxStyle === 'leap'
        ? interval >= 3 && interval <= 9
          ? 1.6
          : 0.2
        : phrase.climaxStyle === 'stepwise'
          ? interval <= 2
            ? 1.4
            : -0.2
          : phrase.climaxStyle === 'sustained'
            ? 1.2
            : 1;
    return degreeBonus + tessituraProgress(candidate.midi) * 2.2 + styleBonus;
  };

  const postClimaxReleasePenalty = (candidate: CandidatePitch): number => {
    const phrase = input.phrase;
    if (!phrase || phrase.currentMeasure <= phrase.peakMeasure) {
      return 0;
    }
    const interval = candidate.midi - prevPitch.midi;
    let penalty = 0;
    if (interval > 0) {
      penalty += 1 + interval * 0.25;
    }
    if (interval < 0 && Math.abs(interval) <= 2) {
      penalty -= 0.8;
    }
    if (phrase.climaxStyle === 'sustained' && interval < 0) {
      penalty += 0.6;
    }
    if (phrase.climaxStyle === 'stepwise' && interval < 0 && Math.abs(interval) <= 2) {
      penalty -= 0.6;
    }
    return penalty;
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
      const intervalSigned = candidate.midi - prevPitch.midi;
      const isStep = intervalSemis <= 2;
      const isLeap = intervalSemis >= 3;
      const isAllowedLeap = LEAP_INTERVALS.has(intervalSemis);
      const isChordToneNow = chordNowPitchSet.has(candidate.pc);
      const isSharedTone = sharedTones.has(candidate.pc);
      const prevIsChordToneNow = chordNowPitchSet.has(prevPitch.pc);
      const candidateDegree = degreeForPc(candidate.pc);
      const prevDegree = degreeForPc(prevPitch.pc);
      const tritonePenalty = intervalSemis === 6 ? 1 : 0;

      let leapReason: BestResult['leapReason'] = null;
      let leapBonus = 0;

      if (isAllowedLeap) {
        // Musical skip/leap A: reward arpeggiation in stable harmony.
        if (!input.harmony.harmonyChangesNext && prevIsChordToneNow && isChordToneNow) {
          if (intervalSigned > 0 && (intervalSemis === 3 || intervalSemis === 4 || intervalSemis === 7)) {
            leapBonus += 3.9;
            leapReason = 'arpeggiate_same_chord';
          } else if (intervalSigned < 0 && (intervalSemis === 3 || intervalSemis === 4)) {
            leapBonus += 1.8;
            leapReason = 'arpeggiate_same_chord';
          }
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
      const startBonus = input.isFirstNote ? Math.log(startDegreeWeight(candidateDegree)) * W_START : 0;
      const downwardLeapPenalty = downwardLeapTastePenalty(prevDegree, candidateDegree, intervalSigned);
      const tendencyPenalty = tendencyToneMotionPenalty(prevDegree, candidateDegree, intervalSigned);
      const cadenceZone = input.cadenceContext?.slotTag === 'penultimate' || input.cadenceContext?.slotTag === 'final';
      const tonicPenalty = tonicCadencePenalty(prevDegree, candidateDegree, intervalSigned, {
        cadenceZone,
        prevTessituraProgress: tessituraProgress(prevPitch.midi),
        strongContext: input.isStrongBeat === true || cadenceZone
      });
      const leadingTonePenalty = leadingToneResolutionPenalty(prevDegree, candidateDegree, intervalSigned, {
        cadenceZone,
        descendingBias: intervalSigned < 0 && intervalSemis <= 2
      });

      const W_TARGET = 5.2 * priorityWeight;
      const W_DIRECTION = 4.4;
      const W_BACKTRACK = 2.8;
      const W_DO_TI_PENALTY = 2.6;
      const W_TI_DO_BONUS = 1.8;
      const W_STALL = 3.0;
      const W_OPPOSITION = 2.9;
      const W_PEAK_DEADLINE = 7.5;
      const W_PEAK_PROGRESS = 4.6;
      const W_CLIMAX_ARRIVAL = 6.8;
      const W_POST_CLIMAX_RELEASE = 5.1;
      const W_DOWNWARD_LEAP_TASTE = 4.8;
      const W_TENDENCY_TONE_MOTION = 4.2;
      const W_TRITONE_LEAP = 10.5;
      const W_TONIC_CADENCE_PROTECTION = 5.2;
      const W_LEADING_TONE_RESOLUTION = 5.4;
      const W_UNREPAIRED = 4.7;
      const W_REPEAT_LEAP_AFTER_LEAP = 7.4;
      const W_SAME_DIRECTION_LEAP_AFTER_LEAP = 8.8;
      const W_CLIMAX_JUMP_OUT = 12.5;
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
        W_PEAK_PROGRESS * peakDegreeProgressBonus(candidate) +
        W_CLIMAX_ARRIVAL * climaxArrivalBonus(candidate) +
        leapBonus +
        (input.isStrongBeat && isChordToneNow ? W_STRONG_CHORD : 0) -
        W_BACKTRACK * immediateBacktrackPenalty(candidate) -
        W_STALL * stallPenalty(candidate) -
        W_OPPOSITION * oppositionPenalty(candidate) -
        W_PEAK_DEADLINE * peakDeadlinePenalty(candidate) -
        W_POST_CLIMAX_RELEASE * postClimaxReleasePenalty(candidate) -
        W_DOWNWARD_LEAP_TASTE * downwardLeapPenalty -
        W_TENDENCY_TONE_MOTION * tendencyPenalty -
        W_TRITONE_LEAP * tritonePenalty -
        W_TONIC_CADENCE_PROTECTION * tonicPenalty -
        W_LEADING_TONE_RESOLUTION * leadingTonePenalty -
        W_UNREPAIRED * unrepairedLeapPenalty -
        W_LEAP_NONCHORD * leapToNonChordPenalty -
        W_TOO_STEPWISE * tooStepwisePenalty(candidate, intervalSemis) -
        W_BIG_LEAP * disallowedLargeLeapPenalty -
        W_DO_TI_PENALTY * penaltyDoToTiDown(candidate.midi) +
        W_TI_DO_BONUS * bonusTiToDoUp(candidate.midi);

      const prevMotionForChain = prevMotion;
      const climbJumpOutPenalty =
        input.phrase &&
        input.phrase.currentMeasure >= input.phrase.peakMeasure &&
        prevMotionForChain &&
        prevMotionForChain.interval >= 3 &&
        isLeap &&
        sign(intervalSigned) === prevMotionForChain.direction
          ? W_CLIMAX_JUMP_OUT
          : 0;

      const leapChainPenalty =
        prevMotionForChain && prevMotionForChain.interval >= 3 && isLeap
          ? W_REPEAT_LEAP_AFTER_LEAP +
            (sign(intervalSigned) === prevMotionForChain.direction ? W_SAME_DIRECTION_LEAP_AFTER_LEAP : 0)
          : 0;

      const finalScore = score - leapChainPenalty - climbJumpOutPenalty;

      const resolvedLeapReason: BestResult['leapReason'] = isLeap
        ? (leapReason ?? 'fallback_leap_penalized_but_best')
        : null;

      return {
        candidate,
        score: finalScore,
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


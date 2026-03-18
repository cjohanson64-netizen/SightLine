import { buildCandidatePool } from "./candidatePools.js";
import {
  chooseTopCandidate,
  chooseWeightedTopCandidate,
  STRUCTURAL_WEIGHTS,
  DECORATIVE_WEIGHTS,
} from "./pitchScorer.js";

const KEY_TO_PC = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

const SHARP_NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

const FLAT_NOTE_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];

function createRng(seed) {
  let state = (Number(seed) || 0) >>> 0;
  return {
    next() {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 0x100000000;
    },
    pick(items) {
      if (!Array.isArray(items) || items.length === 0) return undefined;
      return items[Math.floor(this.next() * items.length)];
    },
  };
}

function modeScale(mode) {
  return mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
}

function midiToPc(midi) {
  return ((midi % 12) + 12) % 12;
}

function toOctave(midi) {
  return Math.floor(midi / 12) - 1;
}

function prefersFlatsForKey(key, mode) {
  const majorFifths = {
    C: 0,
    G: 1,
    D: 2,
    A: 3,
    E: 4,
    B: 5,
    "F#": 6,
    "C#": 7,
    F: -1,
    Bb: -2,
    Eb: -3,
    Ab: -4,
    Db: -5,
    Gb: -6,
  };
  const minorFifths = {
    A: 0,
    E: 1,
    B: 2,
    "F#": 3,
    "C#": 4,
    "G#": 5,
    "D#": 6,
    D: -1,
    G: -2,
    C: -3,
    F: -4,
    Bb: -5,
    Eb: -6,
    Ab: -7,
  };
  const fifths = mode === "major" ? majorFifths[key] : minorFifths[key];
  return typeof fifths === "number" ? fifths < 0 : false;
}

function midiToPitch(midi, preferFlats) {
  const names = preferFlats ? FLAT_NOTE_NAMES : SHARP_NOTE_NAMES;
  return `${names[midiToPc(midi)]}${toOctave(midi)}`;
}

function durationNameForBeats(durationBeats) {
  if (durationBeats >= 4) return "whole";
  if (durationBeats >= 2) return "half";
  if (durationBeats >= 1) return "quarter";
  return "eighth";
}

function parseBeatsPerMeasure(timeSig) {
  const numerator = Number(String(timeSig ?? "4/4").split("/")[0]);
  return Math.max(1, Number.isFinite(numerator) ? numerator : 4);
}

function parseRange(spec) {
  const tonicPc = KEY_TO_PC[spec.key] ?? 0;
  const scale = modeScale(spec.mode).map((step) => (tonicPc + step) % 12);
  const lowPc = scale[(spec.range.lowDegree - 1 + 700) % 7] ?? tonicPc;
  const highPc = scale[(spec.range.highDegree - 1 + 700) % 7] ?? tonicPc;
  const lowMidi = (spec.range.lowOctave + 1) * 12 + lowPc;
  const highMidi = (spec.range.highOctave + 1) * 12 + highPc;
  return {
    minMidi: Math.min(lowMidi, highMidi),
    maxMidi: Math.max(lowMidi, highMidi),
  };
}

function degreeToPitchClass(spec, degree) {
  const tonicPc = KEY_TO_PC[spec.key] ?? 0;
  return (tonicPc + modeScale(spec.mode)[(degree - 1 + 700) % 7]) % 12;
}

function isLeadingToneResolutionDown(spec, fromPitch, toPitch) {
  if (!Number.isFinite(fromPitch) || !Number.isFinite(toPitch)) {
    return false;
  }

  const tiPc = degreeToPitchClass(spec, 7);
  const doPc = degreeToPitchClass(spec, 1);
  return midiToPc(fromPitch) === tiPc && midiToPc(toPitch) === doPc && toPitch < fromPitch;
}

function getHigherTonicResolution(spec, fromPitch, scalePitches, rangeMin, rangeMax) {
  if (!Number.isFinite(fromPitch)) {
    return undefined;
  }

  const tonicPc = degreeToPitchClass(spec, 1);
  return [...scalePitches]
    .sort((a, b) => a - b)
    .find(
      (pitch) =>
        pitch > fromPitch &&
        pitch >= rangeMin &&
        pitch <= rangeMax &&
        midiToPc(pitch) === tonicPc,
    );
}

function enforceAscendingLeadingToneResolution(
  spec,
  previousPitch,
  candidatePitch,
  scalePitches,
  rangeMin,
  rangeMax,
) {
  if (!isLeadingToneResolutionDown(spec, previousPitch, candidatePitch)) {
    return candidatePitch;
  }

  return (
    getHigherTonicResolution(spec, previousPitch, scalePitches, rangeMin, rangeMax) ??
    candidatePitch
  );
}

function buildScalePitches(spec, rangeMin, rangeMax) {
  const pcs = new Set(
    modeScale(spec.mode).map((step) => ((KEY_TO_PC[spec.key] ?? 0) + step) % 12),
  );
  const pitches = [];
  for (let midi = rangeMin; midi <= rangeMax; midi += 1) {
    if (pcs.has(midiToPc(midi))) {
      pitches.push(midi);
    }
  }
  return pitches;
}

function buildChordTonePitches(spec, degree, rangeMin, rangeMax) {
  const root = degreeToPitchClass(spec, degree);
  const third = degreeToPitchClass(spec, degree + 2);
  const fifth = degreeToPitchClass(spec, degree + 4);
  const pcs = new Set([root, third, fifth]);
  const pitches = [];
  for (let midi = rangeMin; midi <= rangeMax; midi += 1) {
    if (pcs.has(midiToPc(midi))) {
      pitches.push(midi);
    }
  }
  return pitches;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function nearestPitch(targetPitch, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - targetPitch) < Math.abs(best - targetPitch)
      ? candidate
      : best,
  );
}

function nearestScalePitch(targetPitch, scalePitches) {
  return nearestPitch(targetPitch, scalePitches);
}

function nearestChordTone(targetPitch, chordTones) {
  return nearestPitch(targetPitch, chordTones);
}

function beatsToPosition(absoluteBeat, beatsPerMeasure) {
  const measure = Math.floor(absoluteBeat / beatsPerMeasure) + 1;
  const onsetBeat = absoluteBeat - (measure - 1) * beatsPerMeasure + 1;
  return { measure, onsetBeat };
}

function beatsToPhraseIndex(measure, phraseLengthMeasures) {
  return Math.floor((measure - 1) / phraseLengthMeasures) + 1;
}

function allowedDurations(spec) {
  const allowed = spec.userConstraints?.allowedNoteValues ?? ["EE", "Q", "H"];
  const durations = [];
  if (allowed.includes("W")) durations.push(4);
  if (allowed.includes("H")) durations.push(2);
  if (allowed.includes("Q")) durations.push(1);
  if (allowed.includes("EE")) durations.push(0.5);
  return durations.sort((a, b) => b - a);
}

function getDurationWeight(spec, durationBeats, phase) {
  const rhythm = spec.userConstraints?.rhythmDist ?? spec.rhythmWeights ?? {};
  const base =
    durationBeats === 4
      ? rhythm.W ?? rhythm.whole ?? 1
      : durationBeats === 2
        ? rhythm.H ?? rhythm.half ?? 1
        : durationBeats === 1
          ? rhythm.Q ?? rhythm.quarter ?? 1
          : rhythm.EE ?? rhythm.eighth ?? 1;

  if (phase === "pre") {
    if (durationBeats === 0.5) return base * 1.35;
    if (durationBeats === 1) return base * 1.15;
    if (durationBeats === 2) return base * 0.85;
    return base * 0.5;
  }
  if (phase === "post") {
    if (durationBeats === 2) return base * 1.25;
    if (durationBeats === 1) return base * 1.05;
    if (durationBeats === 0.5) return base * 0.7;
    return base * 0.85;
  }
  if (phase === "cadence") {
    if (durationBeats === 2) return base * 1.4;
    if (durationBeats === 1) return base * 1.1;
    return base * 0.75;
  }
  return base;
}

function createFillMemoKey(remainingTicks, beatInMeasureTicks) {
  return `${remainingTicks}:${beatInMeasureTicks}`;
}

function canFillExact(
  remainingTicks,
  beatInMeasureTicks,
  allowedTicks,
  measureTicks,
  memo,
) {
  const key = createFillMemoKey(remainingTicks, beatInMeasureTicks);
  if (memo.has(key)) return memo.get(key);
  if (remainingTicks === 0) {
    memo.set(key, true);
    return true;
  }

  for (const durationTicks of allowedTicks) {
    if (durationTicks > remainingTicks) continue;
    if (durationTicks > measureTicks - beatInMeasureTicks) continue;
    const nextBeatInMeasure = (beatInMeasureTicks + durationTicks) % measureTicks;
    if (
      canFillExact(
        remainingTicks - durationTicks,
        nextBeatInMeasure,
        allowedTicks,
        measureTicks,
        memo,
      )
    ) {
      memo.set(key, true);
      return true;
    }
  }

  memo.set(key, false);
  return false;
}

function canFillEndingWithoutFinalEighth(
  remainingTicks,
  beatInMeasureTicks,
  allowedTicks,
  measureTicks,
  memo,
) {
  const key = `no-final-eighth:${remainingTicks}:${beatInMeasureTicks}`;
  if (memo.has(key)) return memo.get(key);
  if (remainingTicks === 0) {
    memo.set(key, true);
    return true;
  }

  for (const durationTicks of allowedTicks) {
    if (durationTicks > remainingTicks) continue;
    if (durationTicks > measureTicks - beatInMeasureTicks) continue;
    if (remainingTicks === durationTicks && durationTicks === 1) continue;

    const nextRemainingTicks = remainingTicks - durationTicks;
    if (nextRemainingTicks === 1) continue;

    const nextBeatInMeasure = (beatInMeasureTicks + durationTicks) % measureTicks;
    if (
      canFillEndingWithoutFinalEighth(
        nextRemainingTicks,
        nextBeatInMeasure,
        allowedTicks,
        measureTicks,
        memo,
      )
    ) {
      memo.set(key, true);
      return true;
    }
  }

  memo.set(key, false);
  return false;
}

function isDurationPlacementLegal(
  beatsPerMeasure,
  beatInMeasureTicks,
  durationTicks,
) {
  // In 3/4, avoid notated patterns like EE + H in the same bar.
  // A half note beginning on beat 2 obscures the beat grouping the app expects
  // and reads as an illegal rhythm for this training context.
  if (beatsPerMeasure === 3 && durationTicks === 4 && beatInMeasureTicks === 2) {
    return false;
  }

  return true;
}

function chooseDuration(
  spec,
  remainingBeats,
  absoluteBeat,
  phase,
  beatsPerMeasure,
  rng,
  previousDurationBeats,
  avoidFinalEighth = false,
) {
  const durations = allowedDurations(spec);
  const allowedTicks = durations.map((duration) => Math.round(duration * 2));
  const measureTicks = beatsPerMeasure * 2;
  const remainingTicks = Math.round(remainingBeats * 2);
  const beatInMeasureTicks = Math.round((absoluteBeat % beatsPerMeasure) * 2);
  const memo = new Map();
  const endingMemo = new Map();

  const valid = durations.filter((duration, index) => {
    const durationTicks = allowedTicks[index];
    if (durationTicks > remainingTicks) return false;
    if (durationTicks > measureTicks - beatInMeasureTicks) return false;
    if (!isDurationPlacementLegal(beatsPerMeasure, beatInMeasureTicks, durationTicks)) {
      return false;
    }
    if (previousDurationBeats === 0.5 && duration !== 0.5) {
      return false;
    }
    if (duration === 0.5) {
      const previousWasEighth = previousDurationBeats === 0.5;
      const canLeadIntoAnotherEighth =
        remainingTicks - durationTicks >= 1 &&
        measureTicks - beatInMeasureTicks - durationTicks >= 1 &&
        canFillExact(
          remainingTicks - durationTicks - 1,
          (beatInMeasureTicks + durationTicks + 1) % measureTicks,
          allowedTicks,
          measureTicks,
          memo,
        );
      if (!previousWasEighth && !canLeadIntoAnotherEighth) {
        return false;
      }
    }
    if (avoidFinalEighth) {
      if (remainingTicks === durationTicks && duration === 0.5) {
        return false;
      }
      if (remainingTicks - durationTicks === 1) {
        return false;
      }
      return canFillEndingWithoutFinalEighth(
        remainingTicks - durationTicks,
        (beatInMeasureTicks + durationTicks) % measureTicks,
        allowedTicks,
        measureTicks,
        endingMemo,
      );
    }
    return canFillExact(
      remainingTicks - durationTicks,
      (beatInMeasureTicks + durationTicks) % measureTicks,
      allowedTicks,
      measureTicks,
      memo,
    );
  });

  if (valid.length === 0) {
    const emergency = durations.filter((duration) => {
      const durationTicks = Math.round(duration * 2);
      if (durationTicks > remainingTicks) return false;
      if (durationTicks > measureTicks - beatInMeasureTicks) return false;
      if (!isDurationPlacementLegal(beatsPerMeasure, beatInMeasureTicks, durationTicks)) {
        return false;
      }
      if (previousDurationBeats === 0.5 && duration !== 0.5) return false;
      if (duration === 0.5) return false;
      if (avoidFinalEighth && remainingTicks - durationTicks === 1) return false;
      return true;
    });
    if (emergency.length > 0) {
      return emergency[0];
    }
    return durations.find((duration) => duration !== 0.5) ?? durations[0] ?? 1;
  }

  const weighted = valid.map((duration) => ({
    duration,
    weight: Math.max(0.01, getDurationWeight(spec, duration, phase)),
  }));
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = rng.next() * totalWeight;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) return item.duration;
  }
  return weighted[weighted.length - 1].duration;
}

function activeHarmonyAtBeat(harmonySpans, absoluteBeat) {
  let active = harmonySpans[0];
  for (const span of harmonySpans) {
    if (span.startBeat <= absoluteBeat + 0.0001) {
      active = span;
    } else {
      break;
    }
  }
  return active;
}

function getMetricStrength(absoluteBeat, beatsPerMeasure) {
  const withinMeasure = absoluteBeat % beatsPerMeasure;
  const onsetBeat = withinMeasure + 1;

  if (Math.abs(onsetBeat - 1) < 0.001) return "strong";

  if (Number.isInteger(onsetBeat)) {
    if (beatsPerMeasure >= 4 && Math.abs(onsetBeat - 3) < 0.001) return "medium";
    return "weak";
  }

  return "off";
}

function isChordTonePitch(pitch, harmonySpan) {
  return Array.isArray(harmonySpan?.absoluteChordTones)
    ? harmonySpan.absoluteChordTones.includes(pitch)
    : false;
}

function getContourBias(harmonyType) {
  if (harmonyType === "dominant") return "up";
  if (harmonyType === "subdominant") return "down";
  return "balanced";
}

function interpolatePitch(fromPitch, toPitch, progress, scalePitches) {
  const raw = fromPitch + (toPitch - fromPitch) * progress;
  return nearestScalePitch(raw, scalePitches) ?? Math.round(raw);
}

function getCadencePitch(spec, scalePitches, harmonySpan) {
  const cadenceType =
    spec.userConstraints?.cadenceType ??
    spec.phrases?.[spec.phrases.length - 1]?.cadence ??
    "authentic";
  const targetDegree = cadenceType === "half" ? 5 : 1;
  const targetPc = degreeToPitchClass(spec, targetDegree);
  const candidates = scalePitches.filter((pitch) => midiToPc(pitch) === targetPc);
  return (
    nearestChordTone(
      scalePitches[Math.max(0, Math.floor(scalePitches.length * 0.35))] ?? 60,
      candidates.length > 0 ? candidates : harmonySpan.absoluteChordTones,
    ) ?? scalePitches[0]
  );
}

function getStartPitch(spec, scalePitches, harmonySpan) {
  const startPc = degreeToPitchClass(spec, spec.startingDegree ?? 1);
  const candidates = scalePitches.filter((pitch) => midiToPc(pitch) === startPc);
  const referenceIndex = Math.min(scalePitches.length - 1, Math.max(0, Math.floor(scalePitches.length * 0.3)));
  return (
    nearestChordTone(
      scalePitches[referenceIndex] ?? 60,
      candidates.length > 0 ? candidates : harmonySpan.absoluteChordTones,
    ) ?? scalePitches[0]
  );
}

function nearestStepToward(currentPitch, targetPitch, scalePitches) {
  if (targetPitch === currentPitch) return currentPitch;
  const sorted = [...scalePitches].sort((a, b) => a - b);
  if (targetPitch > currentPitch) {
    return sorted.find((pitch) => pitch > currentPitch) ?? currentPitch;
  }
  const descending = [...sorted].reverse();
  return descending.find((pitch) => pitch < currentPitch) ?? currentPitch;
}

export function createGenerationContext(params = {}) {
  const spec = params.spec ?? params;
  const seed = Number(params.seed ?? 0);
  const rng = createRng(seed);
  const beatsPerMeasure = parseBeatsPerMeasure(spec.timeSig);
  const phraseCount = Math.max(1, spec.phrases?.length ?? 1);
  const totalMeasures = Math.max(1, spec.phraseLengthMeasures * phraseCount);
  const totalBeats = totalMeasures * beatsPerMeasure;
  const range = parseRange(spec);
  const scalePitches = buildScalePitches(spec, range.minMidi, range.maxMidi);
  const preferFlats = prefersFlatsForKey(spec.key, spec.mode);

  return {
    spec,
    seed,
    rng,
    beatsPerMeasure,
    phraseCount,
    totalMeasures,
    totalBeats,
    rangeMin: range.minMidi,
    rangeMax: range.maxMidi,
    scalePitches,
    preferFlats,
    logs: [],
    harmonicRhythm: [],
    harmonySpans: [],
    melodicEvents: [],
    climax: null,
  };
}

function buildHarmonicLengths(totalBeats, beatsPerMeasure) {
  const lengths = [];
  let remainingBeats = totalBeats;
  let localBeat = 0;

  while (remainingBeats > 0.0001) {
    const beatsLeftInMeasure =
      beatsPerMeasure - (localBeat % beatsPerMeasure || 0);
    const isCadentialWindow = remainingBeats <= Math.max(2, beatsPerMeasure);

    let nextLength = 2;
    if (remainingBeats === 1 || beatsLeftInMeasure === 1) {
      nextLength = 1;
    } else if (isCadentialWindow) {
      nextLength = 1;
    } else if (beatsLeftInMeasure < 2) {
      nextLength = 1;
    }

    nextLength = Math.min(nextLength, remainingBeats, beatsLeftInMeasure);

    if (nextLength !== 1 && nextLength !== 2) {
      nextLength = nextLength > 1 ? 2 : 1;
      nextLength = Math.min(nextLength, remainingBeats, beatsLeftInMeasure);
    }

    lengths.push(nextLength);
    remainingBeats -= nextLength;
    localBeat += nextLength;
  }

  return lengths;
}

// Pass 1: select harmonic rhythm.
export function pass1_selectHarmonicRhythm(ctx) {
  const spans = [];
  const beatsPerMeasure = ctx.beatsPerMeasure;

  for (let phraseIndex = 0; phraseIndex < ctx.phraseCount; phraseIndex += 1) {
    const phraseStartBeat =
      phraseIndex * ctx.spec.phraseLengthMeasures * beatsPerMeasure;
    const phraseBeats = ctx.spec.phraseLengthMeasures * beatsPerMeasure;
    const lengths = buildHarmonicLengths(phraseBeats, beatsPerMeasure);
    let cursor = phraseStartBeat;

    for (const length of lengths) {
      const { measure, onsetBeat } = beatsToPosition(cursor, beatsPerMeasure);
      spans.push({
        phraseIndex,
        measure,
        beat: onsetBeat,
        startBeat: cursor,
        lengthBeats: length,
      });
      cursor += length;
    }
  }

  ctx.harmonicRhythm = spans
    .sort((a, b) => a.startBeat - b.startBeat)
    .map((span, index, list) => ({
      ...span,
      endBeat: list[index + 1]?.startBeat ?? ctx.totalBeats,
      slotIndex: index,
    }));
  ctx.logs.push(
    `tetrachord pass1 spans=${ctx.harmonicRhythm.length} lengths=${ctx.harmonicRhythm
      .map((span) => span.endBeat - span.startBeat)
      .join(",")}`,
  );
  return ctx;
}

function nextHarmonyType(previousType, phaseHint) {
  if (phaseHint === "opening") {
    return previousType === "tonic" ? "tonic" : "tonic";
  }
  if (phaseHint === "predominant") {
    return previousType === "dominant" ? "tonic" : "subdominant";
  }
  if (phaseHint === "dominant") {
    return "dominant";
  }
  if (previousType === "tonic") return "subdominant";
  if (previousType === "subdominant") return "dominant";
  return "tonic";
}

function harmonyTypeToDegree(harmonyType) {
  if (harmonyType === "subdominant") return 4;
  if (harmonyType === "dominant") return 5;
  return 1;
}

// Pass 2: select harmony progression.
export function pass2_selectHarmonyProgression(ctx) {
  const spans = [];

  for (let phraseIndex = 0; phraseIndex < ctx.phraseCount; phraseIndex += 1) {
    const phraseCadence = ctx.spec.phrases?.[phraseIndex]?.cadence ?? "authentic";
    const phraseSpans = ctx.harmonicRhythm.filter((span) => span.phraseIndex === phraseIndex);
    let previousType = "tonic";

    phraseSpans.forEach((span, localIndex) => {
      const lastIndex = phraseSpans.length - 1;
      const penultIndex = Math.max(0, lastIndex - 1);
      let harmonyType = "tonic";

      if (localIndex === 0) {
        harmonyType = "tonic";
      } else if (localIndex === lastIndex) {
        harmonyType = phraseCadence === "half" ? "dominant" : "tonic";
      } else if (localIndex === penultIndex) {
        harmonyType = phraseCadence === "plagal" ? "subdominant" : "dominant";
      } else if (localIndex < Math.max(1, Math.floor(lastIndex / 2))) {
        harmonyType = nextHarmonyType(previousType, "predominant");
      } else {
        harmonyType = nextHarmonyType(previousType, "dominant");
      }

      previousType = harmonyType;
      const degree = harmonyTypeToDegree(harmonyType);
      const absoluteChordTones = buildChordTonePitches(
        ctx.spec,
        degree,
        ctx.rangeMin,
        ctx.rangeMax,
      );

      spans.push({
        ...span,
        harmonyType,
        degree,
        rootPc: degreeToPitchClass(ctx.spec, degree),
        chordPcs: [
          degreeToPitchClass(ctx.spec, degree),
          degreeToPitchClass(ctx.spec, degree + 2),
          degreeToPitchClass(ctx.spec, degree + 4),
        ],
        absoluteChordTones,
        chordId: `tetrachord:m${span.measure}:b${span.beat}:d${degree}`,
      });
    });
  }

  ctx.harmonySpans = spans;
  ctx.logs.push(
    `tetrachord pass2 harmony=${spans.map((span) => span.harmonyType[0].toUpperCase()).join("")}`,
  );
  return ctx;
}

// Pass 3: select climax event.
export function pass3_selectClimaxEvent(ctx) {
  const allowedTicks = allowedDurations(ctx.spec).map((duration) => Math.round(duration * 2));
  const measureTicks = ctx.beatsPerMeasure * 2;
  const reachMemo = new Map();
  const eligible = ctx.harmonySpans.filter((span) => {
    if (span.startBeat >= ctx.totalBeats - ctx.beatsPerMeasure) return false;
    const startTicks = Math.round(span.startBeat * 2);
    return canFillExact(startTicks, 0, allowedTicks, measureTicks, reachMemo);
  });

  const targetBeat = ctx.totalBeats * 0.7;
  const chosenSpan =
    eligible.sort((a, b) => {
      const aDistance = Math.abs(a.startBeat - targetBeat);
      const bDistance = Math.abs(b.startBeat - targetBeat);
      return aDistance - bDistance || b.startBeat - a.startBeat;
    })[0] ?? ctx.harmonySpans[Math.max(0, ctx.harmonySpans.length - 2)] ?? ctx.harmonySpans[0];

  const highTarget = ctx.rangeMin + (ctx.rangeMax - ctx.rangeMin) * 0.82;
  const climaxPitch =
    nearestChordTone(highTarget, chosenSpan.absoluteChordTones) ??
    nearestScalePitch(highTarget, ctx.scalePitches) ??
    ctx.rangeMax;

  ctx.climax = {
    slotIndex: chosenSpan.slotIndex,
    startBeat: chosenSpan.startBeat,
    pitch: clamp(climaxPitch, ctx.rangeMin, ctx.rangeMax),
    locked: true,
  };
  ctx.logs.push(
    `tetrachord pass3 climax beat=${ctx.climax.startBeat} pitch=${ctx.climax.pitch}`,
  );
  return ctx;
}

// Pass 4: generate melodic rhythm around the climax.
export function pass4_generateMelodicRhythm(ctx) {
  const events = [];
  let absoluteBeat = 0;
  const climaxBeat = ctx.climax.startBeat;
  let previousDurationBeats = null;

  while (absoluteBeat < climaxBeat - 0.0001) {
    const remaining = climaxBeat - absoluteBeat;
    const duration = chooseDuration(
      ctx.spec,
      remaining,
      absoluteBeat,
      remaining <= 2 ? "pre" : "pre",
      ctx.beatsPerMeasure,
      ctx.rng,
      previousDurationBeats,
      true,
    );
    events.push({ startBeat: absoluteBeat, durationBeats: duration });
    absoluteBeat += duration;
    previousDurationBeats = duration;
  }

  const beatsLeftInMeasure = ctx.beatsPerMeasure - (climaxBeat % ctx.beatsPerMeasure);
  const remainingAfterClimax = ctx.totalBeats - climaxBeat;
  const climaxOptions = allowedDurations(ctx.spec)
    .filter((duration) => {
      const durationTicks = Math.round(duration * 2);
      const beatInMeasureTicks = Math.round((climaxBeat % ctx.beatsPerMeasure) * 2);
      return (
        duration <= beatsLeftInMeasure &&
        duration <= remainingAfterClimax &&
        isDurationPlacementLegal(ctx.beatsPerMeasure, beatInMeasureTicks, durationTicks)
      );
    })
    .sort((a, b) => b - a);
  const climaxDuration =
    climaxOptions.find((duration) => duration >= 1 && duration <= 2) ??
    climaxOptions.find((duration) => duration <= 2 && duration !== 0.5) ??
    climaxOptions.find((duration) => duration <= 2) ??
    climaxOptions[0] ??
    Math.min(1, remainingAfterClimax);
  events.push({ startBeat: climaxBeat, durationBeats: climaxDuration, isClimaxEvent: true });
  absoluteBeat = climaxBeat + climaxDuration;
  previousDurationBeats = climaxDuration;

  while (absoluteBeat < ctx.totalBeats - 0.0001) {
    const remaining = ctx.totalBeats - absoluteBeat;
    const phase =
      remaining <= ctx.beatsPerMeasure ? "cadence" : "post";
    const duration = chooseDuration(
      ctx.spec,
      remaining,
      absoluteBeat,
      phase,
      ctx.beatsPerMeasure,
      ctx.rng,
      previousDurationBeats,
      true,
    );
    events.push({ startBeat: absoluteBeat, durationBeats: duration });
    absoluteBeat += duration;
    previousDurationBeats = duration;
  }

  ctx.melodicEvents = events.map((event, index) => {
    const { measure, onsetBeat } = beatsToPosition(event.startBeat, ctx.beatsPerMeasure);
    return {
      ...event,
      index,
      measure,
      onsetBeat,
      phraseIndex: beatsToPhraseIndex(measure, ctx.spec.phraseLengthMeasures),
    };
  });
  ctx.logs.push(`tetrachord pass4 events=${ctx.melodicEvents.length}`);
  return ctx;
}

// Pass 5: assign metric strength to melodic events.
export function pass5_assignMetricStrength(ctx) {
  const climaxIndex = ctx.melodicEvents.findIndex((event) => event.isClimaxEvent === true);
  ctx.melodicEvents = ctx.melodicEvents.map((event, index) => {
    const metricStrength = getMetricStrength(event.startBeat, ctx.beatsPerMeasure);
    const isFinal = index === ctx.melodicEvents.length - 1;
    const isStructural =
      index === 0 ||
      isFinal ||
      event.isClimaxEvent === true ||
      metricStrength === "strong" ||
      metricStrength === "medium";
    return {
      ...event,
      metricStrength,
      isStructural,
      isCadenceEvent: isFinal,
      isClimaxApproach: climaxIndex > 0 && index === climaxIndex - 1,
    };
  });
  ctx.logs.push("tetrachord pass5 metric-strength assigned");
  return ctx;
}

function getStructuralTargetPitches(ctx) {
  const structuralEvents = ctx.melodicEvents.filter((event) => event.isStructural);
  const firstHarmony = activeHarmonyAtBeat(ctx.harmonySpans, 0);
  const lastHarmony = activeHarmonyAtBeat(ctx.harmonySpans, ctx.totalBeats - 0.5);
  const startPitch = getStartPitch(ctx.spec, ctx.scalePitches, firstHarmony);
  const cadencePitch = getCadencePitch(ctx.spec, ctx.scalePitches, lastHarmony);
  const climaxStructuralIndex = structuralEvents.findIndex((event) => event.isClimaxEvent);

  return structuralEvents.map((event, index) => {
    if (event.isClimaxEvent) return ctx.climax.pitch;
    if (climaxStructuralIndex <= 0 || index < climaxStructuralIndex) {
      const progress = climaxStructuralIndex <= 0 ? 0 : index / climaxStructuralIndex;
      return interpolatePitch(startPitch, ctx.climax.pitch, progress, ctx.scalePitches);
    }
    const denominator = Math.max(1, structuralEvents.length - 1 - climaxStructuralIndex);
    const progress = (index - climaxStructuralIndex) / denominator;
    return interpolatePitch(ctx.climax.pitch, cadencePitch, progress, ctx.scalePitches);
  });
}

// Pass 6: place structural pitches.
export function pass6_placeStructuralPitches(ctx) {
  const structuralEvents = ctx.melodicEvents.filter((event) => event.isStructural);
  const targetPitches = getStructuralTargetPitches(ctx);
  const placedPitches = [];

  structuralEvents.forEach((event, structuralIndex) => {
    const harmonySpan = activeHarmonyAtBeat(ctx.harmonySpans, event.startBeat);
    const previousPitch =
      placedPitches[placedPitches.length - 1] ?? targetPitches[structuralIndex];
    const previousPreviousPitch =
      placedPitches[placedPitches.length - 2];
    const targetPitch = targetPitches[structuralIndex];
    const nextStructuralPitch = targetPitches[structuralIndex + 1];

    const scoringCtx = {
      currentPitch: previousPitch,
      previousPitch: previousPreviousPitch,
      recentPitches: placedPitches.slice(-4),
      nextStructuralPitch,
      targetPitch,
      harmonyType: harmonySpan.harmonyType,
      harmonyChordTones: harmonySpan.absoluteChordTones,
      scalePitches: ctx.scalePitches,
      metricStrength: event.metricStrength,
      isStructural: true,
      isClimaxEvent: event.isClimaxEvent === true,
      isCadenceEvent: event.isCadenceEvent === true,
      isClimaxApproach: event.isClimaxApproach === true,
      rangeMin: ctx.rangeMin,
      rangeMax: ctx.rangeMax,
      weights: STRUCTURAL_WEIGHTS,
    };

    const candidatePool = buildCandidatePool(scoringCtx);
    const scored = chooseTopCandidate(candidatePool, scoringCtx);
    const chosenPitch =
      event.isClimaxEvent === true
        ? ctx.climax.pitch
        : scored?.candidatePitch ?? targetPitch ?? previousPitch;

    event.pitch = clamp(
      enforceAscendingLeadingToneResolution(
        ctx.spec,
        placedPitches[placedPitches.length - 1],
        chosenPitch,
        ctx.scalePitches,
        ctx.rangeMin,
        ctx.rangeMax,
      ),
      ctx.rangeMin,
      ctx.rangeMax,
    );
    event.locked = event.isClimaxEvent === true;
    event.harmonyType = harmonySpan.harmonyType;
    event.chordId = harmonySpan.chordId;
    event.role = isChordTonePitch(event.pitch, harmonySpan)
      ? "ChordTone"
      : "NonHarmonicTone";
    event.functionTags = ["anchor", "structural"];
    if (event.isClimaxEvent) event.functionTags.push("climax");
    if (event.isCadenceEvent) event.functionTags.push("cadence");
    placedPitches.push(event.pitch);
  });

  ctx.logs.push("tetrachord pass6 structural pitches placed");
  return ctx;
}

function findNextStructuralPitch(events, startIndex) {
  for (let index = startIndex + 1; index < events.length; index += 1) {
    if (events[index].isStructural && typeof events[index].pitch === "number") {
      return events[index].pitch;
    }
  }
  return undefined;
}

// Pass 7: fill decorative pitches.
export function pass7_fillDecorativePitches(ctx) {
  const recentPitches = [];

  ctx.melodicEvents.forEach((event, index) => {
    const harmonySpan = activeHarmonyAtBeat(ctx.harmonySpans, event.startBeat);
    if (typeof event.pitch === "number") {
      recentPitches.push(event.pitch);
      return;
    }

    const previousPitch =
      recentPitches[recentPitches.length - 1] ??
      nearestChordTone(ctx.rangeMin + 4, harmonySpan.absoluteChordTones) ??
      ctx.scalePitches[0];
    const previousPreviousPitch = recentPitches[recentPitches.length - 2];
    const nextStructuralPitch = findNextStructuralPitch(ctx.melodicEvents, index);
    const allowNonChordTones =
      event.metricStrength === "weak" || event.metricStrength === "off";
    const scoringCtx = {
      currentPitch: previousPitch,
      previousPitch: previousPreviousPitch,
      recentPitches: recentPitches.slice(-4),
      nextStructuralPitch,
      targetPitch: nextStructuralPitch,
      harmonyType: harmonySpan.harmonyType,
      harmonyChordTones: harmonySpan.absoluteChordTones,
      scalePitches: ctx.scalePitches,
      metricStrength: event.metricStrength,
      isStructural: false,
      allowNonChordTones,
      isClimaxApproach: event.isClimaxApproach === true,
      rangeMin: ctx.rangeMin,
      rangeMax: ctx.rangeMax,
      weights: DECORATIVE_WEIGHTS,
    };

    const candidatePool = buildCandidatePool(scoringCtx);
    const scored =
      allowNonChordTones
        ? chooseWeightedTopCandidate(candidatePool, scoringCtx, 3)
        : chooseTopCandidate(candidatePool, scoringCtx);
    const chosenPitch =
      scored?.candidatePitch ??
      nextStructuralPitch ??
      previousPitch;

    event.pitch = clamp(
      enforceAscendingLeadingToneResolution(
        ctx.spec,
        recentPitches[recentPitches.length - 1],
        chosenPitch,
        ctx.scalePitches,
        ctx.rangeMin,
        ctx.rangeMax,
      ),
      ctx.rangeMin,
      ctx.rangeMax,
    );
    event.harmonyType = harmonySpan.harmonyType;
    event.chordId = harmonySpan.chordId;
    event.role = isChordTonePitch(event.pitch, harmonySpan)
      ? "ChordTone"
      : "NonHarmonicTone";
    event.functionTags = event.role === "ChordTone" ? [] : ["connective_nht"];
    recentPitches.push(event.pitch);
  });

  ctx.logs.push("tetrachord pass7 decorative pitches filled");
  return ctx;
}

function findNeighborScalePitch(currentPitch, scalePitches, direction) {
  const sorted = [...scalePitches].sort((a, b) => a - b);
  if (direction > 0) {
    return sorted.find((pitch) => pitch > currentPitch);
  }
  const descending = [...sorted].reverse();
  return descending.find((pitch) => pitch < currentPitch);
}

// Pass 8: validate and repair.
export function pass8_validateAndRepair(ctx) {
  const maxLeap = Math.max(1, ctx.spec.userConstraints?.maxLeapSemitones ?? 12);
  const events = ctx.melodicEvents.map((event) => ({ ...event }));

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const harmonySpan = activeHarmonyAtBeat(ctx.harmonySpans, event.startBeat);
    if (!event.locked) {
      event.pitch = clamp(event.pitch, ctx.rangeMin, ctx.rangeMax);
    }

    if (
      index >= 2 &&
      events[index - 1].pitch === events[index - 2].pitch &&
      event.pitch === events[index - 1].pitch &&
      !event.locked
    ) {
      const nextPitch = findNextStructuralPitch(events, index) ?? events[index - 1].pitch;
      const stepped = nearestStepToward(event.pitch, nextPitch, ctx.scalePitches);
      event.pitch = clamp(stepped, ctx.rangeMin, ctx.rangeMax);
    }

    if (index > 0 && !event.locked) {
      const prevPitch = events[index - 1].pitch;
      if (Math.abs(event.pitch - prevPitch) > maxLeap) {
        event.pitch = nearestStepToward(prevPitch, event.pitch, ctx.scalePitches);
      }
    }

    if (index > 0) {
      event.pitch = enforceAscendingLeadingToneResolution(
        ctx.spec,
        events[index - 1].pitch,
        event.pitch,
        ctx.scalePitches,
        ctx.rangeMin,
        ctx.rangeMax,
      );
    }

    event.role = isChordTonePitch(event.pitch, harmonySpan)
      ? "ChordTone"
      : event.metricStrength === "weak" || event.metricStrength === "off"
        ? "NonHarmonicTone"
        : "ChordTone";
  }

  const finalEvent = events[events.length - 1];
  if (finalEvent && finalEvent.durationBeats === 0.5) {
    const penultimateEvent = events[events.length - 2];
    if (
      penultimateEvent &&
      !penultimateEvent.locked &&
      penultimateEvent.durationBeats >= 0.5
    ) {
      penultimateEvent.durationBeats += finalEvent.durationBeats;
      events.pop();
    }
  }

  const stableFinalEvent = events[events.length - 1];
  if (stableFinalEvent) {
    const finalPosition = beatsToPosition(stableFinalEvent.startBeat, ctx.beatsPerMeasure);
    stableFinalEvent.measure = finalPosition.measure;
    stableFinalEvent.onsetBeat = finalPosition.onsetBeat;
    stableFinalEvent.phraseIndex = beatsToPhraseIndex(
      finalPosition.measure,
      ctx.spec.phraseLengthMeasures,
    );
    stableFinalEvent.isCadenceEvent = true;
  }

  const finalEventForPitch = events[events.length - 1];
  const finalHarmony = activeHarmonyAtBeat(ctx.harmonySpans, finalEventForPitch.startBeat);
  const cadencePitch = getCadencePitch(ctx.spec, ctx.scalePitches, finalHarmony);
  finalEventForPitch.pitch = cadencePitch;
  finalEventForPitch.role = "ChordTone";
  finalEventForPitch.functionTags = Array.from(
    new Set([...(finalEventForPitch.functionTags ?? []), "cadence", "structural"]),
  );

  const climaxIndex = events.findIndex((event) => event.locked === true);
  if (climaxIndex >= 0) {
    events[climaxIndex].pitch = ctx.climax.pitch;
    events[climaxIndex].role = "ChordTone";
  }

  ctx.melodicEvents = events;
  ctx.logs.push("tetrachord pass8 repair complete");
  return ctx;
}

// Pass 9: create playback-ready output.
export function pass9_buildOutput(ctx) {
  const keyId = `${ctx.spec.key}-${ctx.spec.mode}`;
  const melody = ctx.melodicEvents.map((event) => ({
    pitch: midiToPitch(event.pitch, ctx.preferFlats),
    octave: toOctave(event.pitch),
    midi: event.pitch,
    duration: durationNameForBeats(event.durationBeats),
    measure: event.measure,
    beat: event.onsetBeat,
    phraseIndex: event.phraseIndex,
    role: event.role,
    reason:
      event.isClimaxEvent === true
        ? "tetrachord-climax"
        : event.isCadenceEvent === true
          ? "tetrachord-cadence"
          : event.isStructural
            ? "tetrachord-structural"
            : "tetrachord-decorative",
    chordId: event.chordId,
    keyId,
    nonHarmonicTone: event.role === "NonHarmonicTone",
    onsetBeat: event.onsetBeat,
    durationBeats: event.durationBeats,
    isAttack: true,
    functionTags:
      event.functionTags && event.functionTags.length > 0
        ? Array.from(new Set(event.functionTags))
        : undefined,
  }));

  ctx.output = {
    status: "ok",
    strategy: "tetrachord",
    melody,
    logs: [...ctx.logs, "tetrachord pass9 output built"],
  };
  return ctx;
}

// Pass 10: unlock for teacher editing.
export function pass10_unlockForTeacherEditing(ctx) {
  ctx.output = {
    ...ctx.output,
    melody: ctx.output.melody.map((event) => ({
      ...event,
    })),
    logs: [...ctx.output.logs, "tetrachord pass10 editing unlocked"],
  };
  return ctx;
}

export function generateMelodyTetrachord(params = {}) {
  const ctx = createGenerationContext(params);
  pass1_selectHarmonicRhythm(ctx);
  pass2_selectHarmonyProgression(ctx);
  pass3_selectClimaxEvent(ctx);
  pass4_generateMelodicRhythm(ctx);
  pass5_assignMetricStrength(ctx);
  pass6_placeStructuralPitches(ctx);
  pass7_fillDecorativePitches(ctx);
  pass8_validateAndRepair(ctx);
  pass9_buildOutput(ctx);
  pass10_unlockForTeacherEditing(ctx);
  return ctx.output;
}

export default generateMelodyTetrachord;

import type { ExerciseSpec, HarmonyEvent } from '@/SightLine/domain/music';
import { KEY_TO_PC } from '../midi';
import { modeScale } from '../scale';
import { createRng } from '../../utils/rng';
import type { Rng } from '../../utils/rng';
import type { TonnetzGraph } from '../tonnetz/buildTonnetz';
import { buildTonnetz } from '../tonnetz/buildTonnetz';
import {
  chooseHarmonicRhythmPattern,
  harmonicRhythmBeats,
  isSemanticCadentialWholeNoteEligible,
  type HarmonicRhythmPattern,
} from "./harmonicRhythm";

function degreeQuality(mode: ExerciseSpec['mode'], degree: number): HarmonyEvent['quality'] {
  if (mode === 'major') {
    const map: HarmonyEvent['quality'][] = ['major', 'minor', 'minor', 'major', 'major', 'minor', 'diminished'];
    return map[(degree - 1) % 7];
  }

  const map: HarmonyEvent['quality'][] = ['minor', 'diminished', 'major', 'minor', 'minor', 'major', 'major'];
  return map[(degree - 1) % 7];
}

function chordForDegree(tonicPc: number, mode: ExerciseSpec['mode'], degree: number): number[] {
  const scale = modeScale(mode);
  const root = (tonicPc + scale[(degree - 1) % 7]) % 12;
  const third = (tonicPc + scale[(degree + 1) % 7]) % 12;
  const fifth = (tonicPc + scale[(degree + 3) % 7]) % 12;
  return [root, third, fifth];
}

function buildNeighborMaps(tonnetz: TonnetzGraph): { one: Map<number, Set<number>>; two: Map<number, Set<number>> } {
  const one = new Map<number, Set<number>>();
  const two = new Map<number, Set<number>>();

  for (let pc = 0; pc < 12; pc += 1) {
    const oneStep = new Set(
      tonnetz.edges.filter((edge) => edge.from === `pc-${pc}`).map((edge) => Number(edge.to.replace('pc-', '')))
    );
    one.set(pc, oneStep);

    const twoStep = new Set<number>();
    for (const mid of oneStep) {
      const next = tonnetz.edges
        .filter((edge) => edge.from === `pc-${mid}`)
        .map((edge) => Number(edge.to.replace('pc-', '')));
      for (const end of next) {
        if (end !== pc) {
          twoStep.add(end);
        }
      }
    }
    two.set(pc, twoStep);
  }

  return { one, two };
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

type FunctionalRole = 'T' | 'PD' | 'D' | 'X';
type PhraseStage = 'opening' | 'middle' | 'preCadence' | 'cadence';
type CadenceType = ExerciseSpec['phrases'][number]['cadence'];

const CADENCE_TAIL_PATTERNS: Record<CadenceType, number[][]> = {
  authentic: [
    [2, 5, 1],
    [1, 5, 1],
    [4, 5, 1]
  ],
  plagal: [
    [1, 4, 1],
    [6, 4, 1]
  ],
  half: [
    [4, 1, 5],
    [5, 1, 5]
  ]
};

function degreeToRole(mode: ExerciseSpec['mode'], degree: number): FunctionalRole {
  const d = ((degree - 1 + 700) % 7) + 1;
  if (mode === 'major') {
    if (d === 1 || d === 6) {
      return 'T';
    }
    if (d === 2 || d === 4) {
      return 'PD';
    }
    if (d === 5 || d === 7) {
      return 'D';
    }
    return 'X';
  }

  if (d === 1 || d === 6) {
    return 'T';
  }
  if (d === 2 || d === 4) {
    return 'PD';
  }
  if (d === 5 || d === 7) {
    return 'D';
  }
  return 'X';
}

function allowedRoleTransition(prevRole: FunctionalRole, nextRole: FunctionalRole): boolean {
  if (prevRole === 'T') {
    return nextRole === 'PD' || nextRole === 'D' || nextRole === 'T' || nextRole === 'X';
  }
  if (prevRole === 'PD') {
    return nextRole === 'D' || nextRole === 'PD' || nextRole === 'X';
  }
  if (prevRole === 'D') {
    return nextRole === 'T' || nextRole === 'D' || nextRole === 'X';
  }
  return true;
}

function cadenceRoleRequirement(
  cadence: ExerciseSpec['phrases'][number]['cadence'],
  localSlotIndex: number,
  slotsPerPhrase: number
): FunctionalRole | null {
  const last = slotsPerPhrase - 1;
  const penult = Math.max(0, last - 1);
  if (cadence === 'half') {
    return localSlotIndex === last ? 'D' : null;
  }
  if (cadence === 'plagal') {
    if (localSlotIndex === penult) {
      return 'PD';
    }
    if (localSlotIndex === last) {
      return 'T';
    }
    return null;
  }
  if (localSlotIndex === penult) {
    return 'D';
  }
  if (localSlotIndex === last) {
    return 'T';
  }
  return null;
}

function phraseStageForSlot(
  cadence: ExerciseSpec['phrases'][number]['cadence'],
  localSlotIndex: number,
  slotsPerPhrase: number
): PhraseStage {
  const cadenceSlots = cadence === 'half' ? 1 : 2;
  if (localSlotIndex <= 1) {
    return 'opening';
  }
  if (localSlotIndex >= slotsPerPhrase - cadenceSlots) {
    return 'cadence';
  }
  if (localSlotIndex >= Math.max(0, slotsPerPhrase - cadenceSlots - 2)) {
    return 'preCadence';
  }
  return 'middle';
}

function weightedPick<T>(items: Array<{ item: T; weight: number }>, rng: Rng): T | null {
  const positive = items.filter((entry) => entry.weight > 0);
  if (positive.length === 0) {
    return null;
  }
  const total = positive.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = rng.next() * total;
  for (const entry of positive) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.item;
    }
  }
  return positive[positive.length - 1].item;
}

export function buildHarmonySpine(spec: ExerciseSpec, tonnetz: TonnetzGraph, rng: Rng): HarmonyEvent[] {
  const beatsPerMeasure = Math.max(1, Number(spec.timeSig.split('/')[0]) || 4);
  const phraseCount = Math.max(1, spec.phrases.length);
  const totalMeasures = Math.max(1, spec.phraseLengthMeasures * phraseCount);
  const tonicPc = KEY_TO_PC[spec.key] ?? 0;

  const degreeToRootPc = new Map<number, number>();
  const rootPcToDegree = new Map<number, number>();
  for (let degree = 1; degree <= 7; degree += 1) {
    const rootPc = chordForDegree(tonicPc, spec.mode, degree)[0];
    degreeToRootPc.set(degree, rootPc);
    rootPcToDegree.set(rootPc, degree);
  }

  const chordByRootPc = new Map<number, number[]>();
  for (let degree = 1; degree <= 7; degree += 1) {
    const chord = chordForDegree(tonicPc, spec.mode, degree);
    chordByRootPc.set(chord[0], chord);
  }

  const diatonicRoots = [...chordByRootPc.keys()];
  const neighbors = buildNeighborMaps(tonnetz);

  const transitionMap = new Map<number, number[]>();
  for (const from of diatonicRoots) {
    const transitions = new Set<number>([from]);

    for (const to of diatonicRoots) {
      const oneStep = neighbors.one.get(from)?.has(to) ?? false;
      const twoStep = neighbors.two.get(from)?.has(to) ?? false;
      if (oneStep || twoStep) {
        transitions.add(to);
      }
    }

    transitionMap.set(from, [...transitions].sort((a, b) => a - b));
  }

  const degreeByRoot = (rootPc: number): number => rootPcToDegree.get(rootPc) ?? 1;
  const overlapWeight = (a: number, b: number): number => {
    const chordA = new Set(chordByRootPc.get(a) ?? []);
    const chordB = chordByRootPc.get(b) ?? [];
    let overlap = 0;
    for (const pc of chordB) {
      if (chordA.has(pc)) {
        overlap += 1;
      }
    }
    return 1 + overlap * 0.2;
  };

  const chooseCadenceFallbackRoot = (requiredRole: FunctionalRole, prevRoot: number): number => {
    const targets = diatonicRoots
      .map((rootPc) => ({ rootPc, degree: degreeByRoot(rootPc), role: degreeToRole(spec.mode, degreeByRoot(rootPc)) }))
      .filter((entry) => entry.role === requiredRole)
      .map((entry) => entry.rootPc);
    if (targets.length === 0) {
      return tonicPc;
    }
    const oneStepTargets = targets.filter((target) => neighbors.one.get(prevRoot)?.has(target) ?? false);
    if (oneStepTargets.length > 0) {
      return oneStepTargets[0];
    }
    const twoStepTargets = targets.filter((target) => neighbors.two.get(prevRoot)?.has(target) ?? false);
    if (twoStepTargets.length > 0) {
      return twoStepTargets[0];
    }
    return targets[0];
  };

  const measurePlans: Array<{
    measure: number;
    phraseIndex: number;
    localMeasure: number;
    pattern: HarmonicRhythmPattern;
    beats: number[];
  }> = [];
  for (let phraseIndex = 0; phraseIndex < phraseCount; phraseIndex += 1) {
    const cadenceType: CadenceType = spec.phrases[phraseIndex]?.cadence ?? 'authentic';
    for (let localMeasure = 1; localMeasure <= spec.phraseLengthMeasures; localMeasure += 1) {
      const measure = phraseIndex * spec.phraseLengthMeasures + localMeasure;
      const wholeNoteRole = isSemanticCadentialWholeNoteEligible({
        allowedNoteValues: spec.userConstraints?.allowedNoteValues,
        beatsPerMeasure,
        cadence: cadenceType,
        isPhraseFinalMeasure: localMeasure === spec.phraseLengthMeasures,
      })
        ? "cadence"
        : undefined;
      const pattern = chooseHarmonicRhythmPattern({
        beatsPerMeasure,
        cadence: cadenceType,
        isClimaxMeasure: false,
        isPhraseFinalMeasure: localMeasure === spec.phraseLengthMeasures,
        rng,
        wholeNoteRole,
      });
      measurePlans.push({
        measure,
        phraseIndex,
        localMeasure,
        pattern,
        beats: harmonicRhythmBeats(pattern),
      });
    }
  }

  const slotPlans = measurePlans.flatMap((measurePlan) =>
    measurePlan.beats.map((beat) => ({
      measure: measurePlan.measure,
      phraseIndex: measurePlan.phraseIndex,
      pattern: measurePlan.pattern,
      beat,
    })),
  );
  const phraseSlotOffsets: number[] = [];
  let slotCursor = 0;
  for (let phraseIndex = 0; phraseIndex < phraseCount; phraseIndex += 1) {
    phraseSlotOffsets.push(slotCursor);
    slotCursor += slotPlans.filter((slot) => slot.phraseIndex === phraseIndex).length;
  }

  const rootPath: number[] = [tonicPc];
  for (let slot = 1; slot < slotPlans.length; slot += 1) {
    const prevRoot = rootPath[slot - 1];
    const prevDegree = degreeByRoot(prevRoot);
    const prevRole = degreeToRole(spec.mode, prevDegree);
    const slotPlan = slotPlans[slot];
    const phraseIndex = slotPlan.phraseIndex;
    const cadenceType = spec.phrases[phraseIndex]?.cadence ?? 'authentic';
    const phraseStartSlot = phraseSlotOffsets[phraseIndex] ?? 0;
    const phraseEndSlot = phraseIndex + 1 < phraseSlotOffsets.length
      ? phraseSlotOffsets[phraseIndex + 1]
      : slotPlans.length;
    const slotsPerPhrase = Math.max(1, phraseEndSlot - phraseStartSlot);
    const localSlot = slot - phraseStartSlot;
    const stage = phraseStageForSlot(cadenceType, localSlot, slotsPerPhrase);
    const requiredRole = cadenceRoleRequirement(cadenceType, localSlot, slotsPerPhrase);
    const strictWindow = stage === 'preCadence' || stage === 'cadence';

    const rawCandidates = shuffle(transitionMap.get(prevRoot) ?? diatonicRoots, rng);
    const scored: Array<{ item: number; weight: number }> = [];
    let afterFunctional = 0;
    for (const candidateRoot of rawCandidates) {
      const degree = degreeByRoot(candidateRoot);
      const role = degreeToRole(spec.mode, degree);
      const transitionOk = allowedRoleTransition(prevRole, role);
      if (requiredRole && role !== requiredRole) {
        continue;
      }
      if (!transitionOk && strictWindow) {
        continue;
      }
      if (!spec.chromatic && !diatonicRoots.includes(candidateRoot)) {
        continue;
      }
      afterFunctional += 1;
      let weight = 1;
      if (!transitionOk) {
        weight *= 0.08;
      }
      if (prevRole === 'T' && role === 'PD') {
        weight *= 1.45;
      } else if (prevRole === 'PD' && role === 'D') {
        weight *= 1.6;
      } else if (prevRole === 'D' && role === 'T') {
        weight *= 1.75;
      } else if (prevRole === role) {
        if (role === 'T' || role === 'PD') {
          weight *= stage === 'opening' ? 1.05 : 0.5;
        } else if (role === 'D') {
          weight *= stage === 'opening' ? 0.6 : 0.3;
        }
      }
      if (role === 'X') {
        weight *= 0.55;
      }
      if (requiredRole && role === requiredRole) {
        weight *= 2.2;
      }
      weight *= overlapWeight(prevRoot, candidateRoot);
      scored.push({ item: candidateRoot, weight });
    }

    let forcedFallback = false;
    let chosenRoot = weightedPick(scored, rng);
    if (chosenRoot === null) {
      forcedFallback = true;
      if (requiredRole) {
        chosenRoot = chooseCadenceFallbackRoot(requiredRole, prevRoot);
      } else {
        const fallback = transitionMap.get(prevRoot) ?? diatonicRoots;
        chosenRoot = fallback.length > 0 ? fallback[0] : tonicPc;
      }
    }
    rootPath.push(chosenRoot);

    const chosenDegree = degreeByRoot(chosenRoot);
    const chosenRole = degreeToRole(spec.mode, chosenDegree);
    console.debug(
      `[harmony] phrase=${phraseIndex + 1} slot=${localSlot + 1}/${slotsPerPhrase} m=${slotPlan.measure} b=${slotPlan.beat} pattern=${slotPlan.pattern} stage=${stage} degree=${chosenDegree} role=${chosenRole} candidates=${rawCandidates.length}->${afterFunctional} forcedFallback=${String(
        forcedFallback
      )}`
    );
  }

  for (let phraseIndex = 0; phraseIndex < phraseCount; phraseIndex += 1) {
    const cadenceType: CadenceType = spec.phrases[phraseIndex]?.cadence ?? 'authentic';
    const patterns = CADENCE_TAIL_PATTERNS[cadenceType];
    const phraseStartSlot = phraseSlotOffsets[phraseIndex] ?? 0;
    const phraseEndSlot = phraseIndex + 1 < phraseSlotOffsets.length
      ? phraseSlotOffsets[phraseIndex + 1]
      : slotPlans.length;
    const slotsPerPhrase = phraseEndSlot - phraseStartSlot;
    if (!patterns || patterns.length === 0 || slotsPerPhrase < 3) {
      continue;
    }
    const patternPick = (rng.int(0, Number.MAX_SAFE_INTEGER) + phraseIndex * 17) % patterns.length;
    const chosenPattern = patterns[patternPick];
    const cadenceStartSlot = phraseStartSlot + slotsPerPhrase - 3;
    const overriddenSlots: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      const slot = cadenceStartSlot + i;
      if (slot < 0 || slot >= rootPath.length) {
        continue;
      }
      const degree = chosenPattern[i] ?? chosenPattern[chosenPattern.length - 1] ?? 1;
      rootPath[slot] = degreeToRootPc.get(degree) ?? tonicPc;
      const slotPlan = slotPlans[slot];
      overriddenSlots.push(`m${slotPlan.measure}b${slotPlan.beat}->${degree}`);
    }

    console.debug(
      `[harmony-cadence-tail] phrase=${phraseIndex + 1} cadence=${cadenceType} pattern=[${chosenPattern.join(
        ','
      )}] slots=${overriddenSlots.join(',')}`
    );
  }

  return rootPath.map((rootPc, index) => {
    const degree = rootPcToDegree.get(rootPc) ?? 1;
    const slotPlan = slotPlans[index];
    return {
      measure: slotPlan.measure,
      beat: slotPlan.beat,
      degree,
      rootPc,
      chordPcs: chordByRootPc.get(rootPc) ?? chordForDegree(tonicPc, spec.mode, degree),
      quality: degreeQuality(spec.mode, degree),
      harmonicRhythmPattern: slotPlan.pattern,
    };
  });
}

export function debugFunctionalHarmonyHarness(): void {
  const cadences: Array<'authentic' | 'half' | 'plagal'> = ['authentic', 'half', 'plagal'];
  const keys: Array<{ key: string; mode: ExerciseSpec['mode'] }> = [
    { key: 'C', mode: 'major' },
    { key: 'A', mode: 'minor' }
  ];
  for (const { key, mode } of keys) {
    for (const cadence of cadences) {
      for (let i = 0; i < 5; i += 1) {
        const seed = 202600 + i;
        const spec: ExerciseSpec = {
          title: 'debug',
          startingDegree: 1,
          key,
          mode,
          clef: 'treble',
          range: { lowDegree: 1, highDegree: 1, lowOctave: 4, highOctave: 5 },
          phraseLengthMeasures: 4,
          phrases: [{ label: 'A', prime: false, cadence }],
          timeSig: '4/4',
          chromatic: false,
          illegalDegrees: [],
          illegalIntervalsSemis: [],
          illegalTransitions: []
        };
        const harmony = buildHarmonySpine(spec, buildTonnetz(key), createRng(seed));
        const degrees = harmony.map((h) => h.degree).join('-');
        const roles = harmony.map((h) => degreeToRole(mode, h.degree)).join('');
        const last = harmony[harmony.length - 1]?.degree ?? 1;
        const penult = harmony[harmony.length - 2]?.degree ?? 1;
        const validCadence =
          cadence === 'half' ? last === 5 : cadence === 'plagal' ? penult === 4 && last === 1 : penult === 5 && last === 1;
        console.debug(
          `[harmony-harness] key=${key} mode=${mode} cadence=${cadence} seed=${seed} last=${last} penult=${penult} validCadence=${String(
            validCadence
          )} degrees=${degrees} roles=${roles}`
        );
      }
    }
  }
}

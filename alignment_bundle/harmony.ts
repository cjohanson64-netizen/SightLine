import type { ExerciseSpec, HarmonyEvent } from '../../tat/models/schema';
import type { Rng } from '../../utils/rng';
import type { TonnetzGraph } from '../tonnetz/buildTonnetz';

const KEY_TO_PC: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11
};

function modeScale(mode: ExerciseSpec['mode']): number[] {
  return mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
}

function cadenceTail(cadence: ExerciseSpec['cadence']): [number, number] {
  if (cadence === 'plagal') {
    return [4, 1];
  }
  if (cadence === 'half') {
    return [2, 5];
  }
  return [5, 1];
}

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

function buildDistances(transitionMap: Map<number, number[]>, roots: number[]): Map<string, number> {
  const distances = new Map<string, number>();

  for (const start of roots) {
    const visited = new Set<number>([start]);
    const queue: Array<{ node: number; dist: number }> = [{ node: start, dist: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      distances.set(`${start}->${current.node}`, current.dist);

      for (const next of transitionMap.get(current.node) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ node: next, dist: current.dist + 1 });
        }
      }
    }
  }

  return distances;
}

export function buildHarmonySpine(spec: ExerciseSpec, tonnetz: TonnetzGraph, rng: Rng): HarmonyEvent[] {
  const total = Math.max(2, spec.measures * 2);
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
    const transitions: number[] = [];

    for (const to of diatonicRoots) {
      const oneStep = neighbors.one.get(from)?.has(to) ?? false;
      const twoStep = neighbors.two.get(from)?.has(to) ?? false;
      const canBuildChord = chordByRootPc.has(to);

      if (oneStep || (twoStep && canBuildChord)) {
        transitions.push(to);
      }
    }

    transitionMap.set(from, transitions);
  }

  const distanceMap = buildDistances(transitionMap, diatonicRoots);
  const [cadencePenultimate, cadenceFinal] = cadenceTail(spec.cadence);
  const cadenceFinalPc = degreeToRootPc.get(cadenceFinal) ?? tonicPc;
  const cadencePenultimatePc = degreeToRootPc.get(cadencePenultimate) ?? tonicPc;

  const rootPath = Array<number>(total).fill(-1);
  rootPath[0] = tonicPc;
  rootPath[total - 1] = cadenceFinalPc;
  if (total > 2) {
    rootPath[total - 2] = cadencePenultimatePc;
  }

  const canReachFutureTarget = (position: number, currentPc: number): boolean => {
    for (let i = position + 1; i < total; i += 1) {
      if (rootPath[i] === -1) {
        continue;
      }
      const target = rootPath[i];
      const remainingSteps = i - position;
      const distance = distanceMap.get(`${currentPc}->${target}`);
      return distance !== undefined && distance <= remainingSteps;
    }

    return true;
  };

  const fill = (position: number): boolean => {
    if (position >= total) {
      return true;
    }

    const prev = rootPath[position - 1];
    if (prev === -1) {
      return false;
    }

    const fixed = rootPath[position];
    if (fixed !== -1) {
      const allowed = transitionMap.get(prev) ?? [];
      if (!allowed.includes(fixed)) {
        return false;
      }
      if (!canReachFutureTarget(position, fixed)) {
        return false;
      }
      return fill(position + 1);
    }

    const allowed = shuffle(transitionMap.get(prev) ?? [], rng);
    for (const next of allowed) {
      if (!canReachFutureTarget(position, next)) {
        continue;
      }

      rootPath[position] = next;
      if (fill(position + 1)) {
        return true;
      }
      rootPath[position] = -1;
    }

    return false;
  };

  if (!fill(1)) {
    for (let i = 1; i < total - 1; i += 1) {
      const prev = rootPath[i - 1];
      const options = transitionMap.get(prev) ?? diatonicRoots;
      rootPath[i] = options.length > 0 ? rng.pick(options) : tonicPc;
    }
  }

  return rootPath.map((rootPc, index) => {
    const degree = rootPcToDegree.get(rootPc) ?? 1;
    const measure = Math.floor(index / 2) + 1;
    const beat = index % 2 === 0 ? 1 : 3;
    return {
      measure,
      beat,
      degree,
      rootPc,
      chordPcs: chordByRootPc.get(rootPc) ?? chordForDegree(tonicPc, spec.mode, degree),
      quality: degreeQuality(spec.mode, degree)
    };
  });
}

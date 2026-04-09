import type { Rng } from '../../utils/rng';
import type { TonnetzGraph } from './buildTonnetz';

export function traverseTonnetz(graph: TonnetzGraph, length: number, rng: Rng): number[] {
  const sequence: number[] = [];
  let current = graph.root;

  for (let i = 0; i < length; i += 1) {
    const pc = Number(current.replace('pc-', ''));
    sequence.push(pc);

    const options = graph.edges.filter((edge) => edge.from === current);
    if (options.length === 0) {
      continue;
    }

    current = rng.pick(options).to;
  }

  return sequence;
}

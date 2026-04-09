export interface TonnetzNode {
  id: string;
  pitchClass: number;
}

export interface TonnetzEdge {
  from: string;
  to: string;
  relation: 'P5' | 'M3' | 'm3';
}

export interface TonnetzGraph {
  nodes: TonnetzNode[];
  edges: TonnetzEdge[];
  root: string;
}

export function buildTonnetz(key: string): TonnetzGraph {
  const keyToPc: Record<string, number> = {
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

  const tonicPc = keyToPc[key] ?? 0;
  const nodes = Array.from({ length: 12 }, (_, pitchClass) => ({
    id: `pc-${pitchClass}`,
    pitchClass
  }));

  const edges: TonnetzEdge[] = [];
  for (let pc = 0; pc < 12; pc += 1) {
    const from = `pc-${pc}`;
    edges.push({ from, to: `pc-${(pc + 7) % 12}`, relation: 'P5' });
    edges.push({ from, to: `pc-${(pc + 4) % 12}`, relation: 'M3' });
    edges.push({ from, to: `pc-${(pc + 3) % 12}`, relation: 'm3' });
  }

  return {
    nodes,
    edges,
    root: `pc-${tonicPc}`
  };
}

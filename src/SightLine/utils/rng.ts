export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: T[]): T;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };

  return {
    next,
    int(min: number, max: number) {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    pick<T>(items: T[]): T {
      if (items.length === 0) {
        throw new Error('Cannot pick from empty list.');
      }
      return items[Math.floor(next() * items.length)];
    }
  };
}

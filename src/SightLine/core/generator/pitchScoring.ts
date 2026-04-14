import {
  chooseBest,
  type BestResult,
  type CandidatePitch,
  type SelectNextPitchInput,
} from "./selectNextPitchCore";

export interface ScoredPitchCandidates {
  best: BestResult | null;
  candidates: CandidatePitch[];
}

export function scoreCandidates(
  candidates: CandidatePitch[],
  input: SelectNextPitchInput,
  tonnetzDistances: Map<string, number>,
  cadenceBonusByMidi: Map<number, { bonus: number; matchingOption?: unknown }>,
): ScoredPitchCandidates {
  return {
    best: chooseBest(
      candidates,
      input,
      tonnetzDistances,
      cadenceBonusByMidi as Map<number, { bonus: number }>,
    ),
    candidates,
  };
}

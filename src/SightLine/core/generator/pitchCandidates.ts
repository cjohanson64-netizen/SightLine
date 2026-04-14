import {
  buildAllCandidates,
  precomputeTonnetzDistances,
  type CandidatePitch,
  type SelectNextPitchInput,
} from "./selectNextPitchCore";

export interface PitchCandidateSet {
  allCandidates: CandidatePitch[];
  keyCandidates: CandidatePitch[];
  tonnetzDistances: Map<string, number>;
}

export function buildCandidates(input: SelectNextPitchInput): PitchCandidateSet {
  const allCandidates = buildAllCandidates(input.tonnetz, input.range);
  const keyCandidates = allCandidates.filter((candidate) =>
    input.key.keyPitchSet.has(candidate.pc),
  );

  return {
    allCandidates,
    keyCandidates,
    tonnetzDistances: precomputeTonnetzDistances(input.tonnetz),
  };
}

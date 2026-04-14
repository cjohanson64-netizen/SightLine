import type { PhraseSpec, RhythmWeights } from "@/SightLine/domain/music";
import { generatePhraseGrid, type PhraseGridPlan } from "./phraseGridPlanner";
import type { PhrasePlan } from "./phrasePlanner";

export interface BuildMelodyGridInput {
  allowedNoteValues?: Array<"EE" | "Q" | "H" | "W">;
  beatsPerMeasure: number;
  lockRhythmConstraints: boolean;
  minEighthPairsPerPhrase: number;
  phraseLengthMeasures: number;
  phrasePlan: PhrasePlan;
  phraseSpec: PhraseSpec;
  phraseStartMeasure: number;
  rhythmDist?: { EE: number; Q: number; H: number; W: number };
  rhythmWeights: RhythmWeights;
  seed: number;
}

export function buildMelodyGrid(input: BuildMelodyGridInput): PhraseGridPlan {
  return generatePhraseGrid(input);
}

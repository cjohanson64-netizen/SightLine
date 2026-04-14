import type { PhraseSpec } from "@/SightLine/domain/music";
import type { Rng } from "../../utils/rng";

export type HarmonicRhythmPattern =
  | "4"
  | "22"
  | "112"
  | "121"
  | "211"
  | "1111"
  | "11"
  | "12";

export function harmonicRhythmBeats(
  pattern: HarmonicRhythmPattern,
): number[] {
  switch (pattern) {
    case "4":
      return [1];
    case "22":
      return [1, 3];
    case "112":
      return [1, 2, 3];
    case "121":
      return [1, 2, 4];
    case "211":
      return [1, 3, 4];
    case "1111":
      return [1, 2, 3, 4];
    case "11":
      return [1, 2];
    case "12":
      return [1, 2.5];
  }
}

export function isSemanticCadentialWholeNoteEligible(input: {
  allowedNoteValues?: Array<"EE" | "Q" | "H" | "W">;
  beatsPerMeasure: number;
  cadence: PhraseSpec["cadence"];
  isPhraseFinalMeasure: boolean;
}): boolean {
  return (
    input.isPhraseFinalMeasure &&
    input.beatsPerMeasure === 4 &&
    input.cadence !== "half" &&
    (input.allowedNoteValues ?? []).includes("W")
  );
}

function weightedPatternPick(
  weights: Array<{ pattern: HarmonicRhythmPattern; weight: number }>,
  rng: Rng,
): HarmonicRhythmPattern {
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = rng.next() * total;
  for (const entry of weights) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.pattern;
    }
  }
  return weights[weights.length - 1]?.pattern ?? "22";
}

export function chooseHarmonicRhythmPattern(input: {
  beatsPerMeasure: number;
  cadence: PhraseSpec["cadence"];
  isClimaxMeasure: boolean;
  isPhraseFinalMeasure: boolean;
  rng: Rng;
  wholeNoteRole?: "cadence";
}): HarmonicRhythmPattern {
  if (input.beatsPerMeasure === 2) {
    return "11";
  }

  if (input.beatsPerMeasure === 3) {
    return "12";
  }

  if (input.wholeNoteRole === "cadence") {
    return "4";
  }

  if (input.isPhraseFinalMeasure) {
    return "22";
  }

  if (input.isClimaxMeasure) {
    return weightedPatternPick(
      [
        { pattern: "121", weight: 1.2 },
        { pattern: "211", weight: 1.2 },
        { pattern: "1111", weight: 1.1 },
        { pattern: "112", weight: 1.0 },
        { pattern: "22", weight: 0.8 },
      ],
      input.rng,
    );
  }

  return weightedPatternPick(
    [
      { pattern: "22", weight: 1.15 },
      { pattern: "112", weight: 1.0 },
      { pattern: "121", weight: 1.0 },
      { pattern: "211", weight: 1.0 },
      { pattern: "1111", weight: 0.85 },
    ],
    input.rng,
  );
}

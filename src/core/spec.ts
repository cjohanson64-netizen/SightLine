import type { ExerciseSpec } from "../tat";

export const defaultSpec: ExerciseSpec = {
  title: "SightLine Melody",
  startingDegree: 1,
  key: "C",
  mode: "major",
  clef: "treble",
  range: { lowDegree: 1, highDegree: 1, lowOctave: 4, highOctave: 5 },
  phraseLengthMeasures: 4,
  phrases: [{ label: "A", prime: false, cadence: "authentic" }],
  timeSig: "4/4",
  chromatic: false,
  illegalDegrees: [],
  illegalIntervalsSemis: [],
  illegalTransitions: [],
  rhythmWeights: {
    whole: 15,
    half: 25,
    quarter: 30,
    eighth: 30,
    minEighthPairsPerPhrase: 1,
    preferEighthInPreClimax: true,
  },
  userConstraints: {
    startDegreeLocked: false,
    hardStartDo: false,
    cadenceType: "authentic",
    endOnDoHard: true,
    maxLeapSemitones: 12,
    minEighthPairsPerPhrase: 1,
    rhythmDist: { EE: 30, Q: 30, H: 25, W: 15 },
    allowedNoteValues: ["EE", "Q", "H"],
  },
};

export const normalizeUserConstraintsInSpec = (nextSpec: ExerciseSpec): ExerciseSpec => {
  const rhythmWeights = nextSpec.rhythmWeights ?? defaultSpec.rhythmWeights!;
  const inferredCadenceType: "authentic" | "half" | "plagal" =
    nextSpec.userConstraints?.cadenceType ??
    (() => {
      const cadence = nextSpec.phrases[nextSpec.phrases.length - 1]?.cadence ?? "authentic";
      return cadence === "half" ? "half" : cadence === "plagal" ? "plagal" : "authentic";
    })();
  return {
    ...nextSpec,
    userConstraints: {
      startDegreeLocked: nextSpec.userConstraints?.startDegreeLocked === true,
      hardStartDo: nextSpec.userConstraints?.hardStartDo === true,
      cadenceType: inferredCadenceType,
      endOnDoHard: nextSpec.userConstraints?.endOnDoHard ?? inferredCadenceType !== "half",
      maxLeapSemitones: Math.max(1, nextSpec.userConstraints?.maxLeapSemitones ?? 12),
      minEighthPairsPerPhrase: Math.max(
        0,
        nextSpec.userConstraints?.minEighthPairsPerPhrase ??
          rhythmWeights.minEighthPairsPerPhrase ??
          0,
      ),
      allowedNoteValues: Array.from(
        new Set(nextSpec.userConstraints?.allowedNoteValues ?? ["EE", "Q", "H"]),
      ) as Array<"EE" | "Q" | "H" | "W">,
      rhythmDist: nextSpec.userConstraints?.rhythmDist ?? {
        EE: rhythmWeights.eighth,
        Q: rhythmWeights.quarter,
        H: rhythmWeights.half,
        W: rhythmWeights.whole,
      },
    },
  };
};

export const toGuestSpec = (input: ExerciseSpec): ExerciseSpec => {
  const normalized = normalizeUserConstraintsInSpec(input);
  return {
    ...normalized,
    chromatic: false,
    phraseLengthMeasures: 4,
    phrases: [{ label: "A", prime: false, cadence: "authentic" }],
    illegalDegrees: [],
    illegalIntervalsSemis: [],
    illegalTransitions: [],
    userConstraints: {
      ...normalized.userConstraints,
      cadenceType: "authentic",
      endOnDoHard: true,
    },
  };
};

import type { ExerciseSpec, MelodyEvent } from "../../../tat";

export interface TetrachordGenerationResult {
  status: "ok";
  strategy: "tetrachord";
  melody: MelodyEvent[];
  logs: string[];
}

export interface TetrachordGenerationInput {
  spec: ExerciseSpec;
  seed: number;
}

export function generateMelodyTetrachord(
  input: TetrachordGenerationInput,
): TetrachordGenerationResult;

export default generateMelodyTetrachord;

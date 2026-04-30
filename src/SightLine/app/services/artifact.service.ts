import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";

export function isIllegalTransition(
  prevDegree: number,
  currDegree: number,
  transitions: ExerciseSpec["illegalTransitions"],
): boolean {
  return transitions.some(
    (r) => r.mode === "adjacent" && r.a === prevDegree && r.b === currDegree,
  );
}

export function formatSavedDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export const extractMelodyEvents = (artifact: {
  nodes: Array<{ kind: string; data: unknown }>;
}): MelodyEvent[] =>
  artifact.nodes
    .filter((n) => n.kind === "leaf")
    .map((n) => n.data as Partial<MelodyEvent>)
    .filter(
      (d): d is MelodyEvent =>
        typeof d.midi === "number" &&
        typeof d.measure === "number" &&
        typeof d.duration === "string",
    )
    .sort(
      (a, b) =>
        a.measure - b.measure ||
        (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat),
    );
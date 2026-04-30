import type { DebugSemanticsProjection } from "@/SightLine/domain/artifact";

export const EMPTY_DEBUG_SEMANTICS: DebugSemanticsProjection = {
  targetNotes: [],
  phraseSummaries: [],
  strengths: [],
  weaknesses: [],
  recommendation: null,
};
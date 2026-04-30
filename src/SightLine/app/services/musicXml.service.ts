import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";
import type {
  SolfegeAccidentalMode,
  SolfegeMode,
} from "@/SightLine/hooks/useSolfege";
import { toMusicXmlFromMelody } from "../../core/projection/toMusicXml";


type SolfegeLyricsOptions = {
  solfegeMode: SolfegeMode;
  accidentalMode: SolfegeAccidentalMode;
  fallback: {
    key: ExerciseSpec["key"];
    mode: ExerciseSpec["mode"];
  };
  colorizeLyrics?: boolean;
};

type AddSolfegeLyricsToMusicXml = (
  musicXml: string,
  options: SolfegeLyricsOptions,
) => string;

type HighlightOptions =
  {
    highlightedMelodyIndex?: number;
    highlightColor?: string;
    noteColorsByIndex?: Record<number, string | undefined>;
  };

export function buildExportMusicXml({
  currentSpecSnapshot,
  currentMelody,
  currentPatchedMelody,
  fallbackMusicXml,
}: {
  currentSpecSnapshot: ExerciseSpec | null;
  currentMelody: MelodyEvent[];
  currentPatchedMelody: MelodyEvent[];
  fallbackMusicXml: string;
}): string {
  if (!currentSpecSnapshot || currentMelody.length === 0) {
    return fallbackMusicXml;
  }

  return toMusicXmlFromMelody(
    currentSpecSnapshot as unknown as Record<string, unknown>,
    currentPatchedMelody,
  );
}

export function buildNotationMusicXml({
  currentSpecSnapshot,
  currentMelody,
  currentPatchedMelody,
  playbackHighlightIndex,
  pitchEditMode,
  selectedMelodyIndex,
  noteColorsByIndex,
}: {
  currentSpecSnapshot: ExerciseSpec | null;
  currentMelody: MelodyEvent[];
  currentPatchedMelody: MelodyEvent[];
  playbackHighlightIndex: number | null;
  pitchEditMode: boolean;
  selectedMelodyIndex: number;
  noteColorsByIndex?: Record<number, string | undefined>;
}): string {
  if (!currentSpecSnapshot || currentMelody.length === 0) {
    return "";
  }

  const highlightOptions = getNotationHighlightOptions({
    playbackHighlightIndex,
    pitchEditMode,
    selectedMelodyIndex,
    noteColorsByIndex,
  });

  return toMusicXmlFromMelody(
    currentSpecSnapshot as unknown as Record<string, unknown>,
    currentPatchedMelody,
    highlightOptions,
  );
}

export function buildDisplayNotationMusicXml({
  notationMusicXml,
  addSolfegeLyricsToMusicXml,
  solfegeMode,
  accidentalMode,
  colorizeLyrics,
  fallback,
}: {
  notationMusicXml: string;
  addSolfegeLyricsToMusicXml: AddSolfegeLyricsToMusicXml;
  solfegeMode: SolfegeLyricsOptions["solfegeMode"];
  accidentalMode: SolfegeLyricsOptions["accidentalMode"];
  colorizeLyrics: boolean;
  fallback: SolfegeLyricsOptions["fallback"];
}): string {
  if (notationMusicXml.trim().length === 0) {
    return "";
  }

  return addSolfegeLyricsToMusicXml(notationMusicXml, {
    solfegeMode,
    accidentalMode,
    colorizeLyrics,
    fallback,
  });
}

function getNotationHighlightOptions({
  playbackHighlightIndex,
  pitchEditMode,
  selectedMelodyIndex,
  noteColorsByIndex,
}: {
  playbackHighlightIndex: number | null;
  pitchEditMode: boolean;
  selectedMelodyIndex: number;
  noteColorsByIndex?: Record<number, string | undefined>;
}): HighlightOptions {
  if (playbackHighlightIndex !== null) {
    return {
      highlightedMelodyIndex: playbackHighlightIndex,
      highlightColor: "#1ecf87",
      noteColorsByIndex,
    };
  }

  if (pitchEditMode && selectedMelodyIndex >= 0) {
    return {
      highlightedMelodyIndex: selectedMelodyIndex,
      highlightColor: "#ff2da6",
      noteColorsByIndex,
    };
  }

  return { noteColorsByIndex };
}

import { useState } from "react";
import type { ExerciseSpec } from "../tat";

export type SolfegeMode = "off" | "movable" | "fixed";
export type SolfegeAccidentalMode = "diatonic" | "chromatic";

const DIATONIC_SOLFEGE = ["Do", "Re", "Mi", "Fa", "Sol", "La", "Ti"];
const CHROMATIC_SOLFEGE = [
  "Do", "Di", "Re", "Ri", "Mi", "Fa", "Fi", "Sol", "Si", "La", "Li", "Ti",
];

const STEP_TO_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

const KEY_TO_PC: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4,
  F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9,
  "A#": 10, Bb: 10, B: 11,
};

function tonicPcFromFifths(fifths: number, mode: "major" | "minor"): number | null {
  const majorPcByFifths = [11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1];
  const minorPcByFifths = [8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
  const index = fifths + 7;
  if (index < 0 || index >= majorPcByFifths.length) return null;
  return mode === "minor" ? minorPcByFifths[index] : majorPcByFifths[index];
}

function parseKeyContext(
  doc: Document,
  fallback: { key: ExerciseSpec["key"]; mode: ExerciseSpec["mode"] },
): { tonicPc: number; mode: "major" | "minor" } {
  const keyNode = doc.querySelector("attributes key");
  const fifthsRaw = keyNode?.querySelector("fifths")?.textContent ?? "";
  const parsedFifths = Number.parseInt(fifthsRaw, 10);
  const modeRaw = (keyNode?.querySelector("mode")?.textContent ?? fallback.mode)
    .trim()
    .toLowerCase();
  const mode: "major" | "minor" = modeRaw === "minor" ? "minor" : "major";

  if (Number.isFinite(parsedFifths)) {
    const parsedPc = tonicPcFromFifths(parsedFifths, mode);
    if (parsedPc !== null) return { tonicPc: parsedPc, mode };
  }
  return {
    tonicPc: KEY_TO_PC[fallback.key] ?? 0,
    mode: fallback.mode === "minor" ? "minor" : "major",
  };
}

function pitchClassFromNote(noteNode: Element): number | null {
  const pitchNode = noteNode.querySelector("pitch");
  if (!pitchNode) return null;
  const step = (pitchNode.querySelector("step")?.textContent ?? "").trim().toUpperCase();
  if (!(step in STEP_TO_PC)) return null;
  const alter = Number.parseInt(
    (pitchNode.querySelector("alter")?.textContent ?? "0").trim(), 10,
  );
  const basePc = STEP_TO_PC[step];
  return (basePc + (Number.isFinite(alter) ? alter : 0) + 120) % 12;
}

function syllableForPc(
  pc: number,
  context: { tonicPc: number; mode: "major" | "minor" },
  solfegeMode: SolfegeMode,
  accidentalMode: SolfegeAccidentalMode,
): string {
  if (solfegeMode === "off") return "";
  if (solfegeMode === "fixed") {
    if (accidentalMode === "chromatic") return CHROMATIC_SOLFEGE[pc] ?? "";
    const naturals = [0, 2, 4, 5, 7, 9, 11];
    const idx = naturals.indexOf(pc);
    return idx === -1 ? "" : DIATONIC_SOLFEGE[idx];
  }
  const relative = (pc - context.tonicPc + 12) % 12;
  if (accidentalMode === "chromatic") return CHROMATIC_SOLFEGE[relative] ?? "";
  const scale = context.mode === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const idx = scale.indexOf(relative);
  return idx === -1 ? "" : DIATONIC_SOLFEGE[idx];
}

export function colorForSolfegeSyllable(syllable: string): string | null {
  const key = syllable.trim().toUpperCase();
  if (key === "DO" || key === "DI") return "#ff3b30";
  if (key === "RE" || key === "RI" || key === "RA") return "#ff9500";
  if (key === "MI" || key === "ME") return "#ffd60a";
  if (key === "FA" || key === "FI") return "#32d74b";
  if (key === "SOL" || key === "SO" || key === "SI" || key === "SE") return "#00c7be";
  if (key === "LA" || key === "LE" || key === "LI") return "#bf5af2";
  if (key === "TI" || key === "TE") return "#ff2d95";
  return null;
}

export function addSolfegeLyricsToMusicXml(
  xml: string,
  options: {
    solfegeMode: SolfegeMode;
    accidentalMode: SolfegeAccidentalMode;
    fallback: { key: ExerciseSpec["key"]; mode: ExerciseSpec["mode"] };
  },
): string {
  if (options.solfegeMode === "off" || !xml.trim()) return xml;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) return xml;

    const context = parseKeyContext(doc, options.fallback);
    for (const noteNode of Array.from(doc.querySelectorAll("note"))) {
      if (noteNode.querySelector("rest") || noteNode.querySelector("chord")) continue;
      const pc = pitchClassFromNote(noteNode);
      if (pc === null) continue;
      const syllable = syllableForPc(pc, context, options.solfegeMode, options.accidentalMode);
      noteNode.querySelectorAll("lyric").forEach(l => l.remove());
      if (!syllable) continue;
      const lyricNode = doc.createElement("lyric");
      const textNode = doc.createElement("text");
      textNode.textContent = syllable;
      const color = colorForSolfegeSyllable(syllable);
      if (color) {
        textNode.setAttribute("color", color);
        lyricNode.setAttribute("color", color);
      }
      lyricNode.appendChild(textNode);
      noteNode.appendChild(lyricNode);
    }
    return new XMLSerializer().serializeToString(doc);
  } catch {
    return xml;
  }
}

export function useSolfege() {
  const [solfegeMode, setSolfegeMode] = useState<SolfegeMode>("off");
  const [solfegeAccidentalMode, setSolfegeAccidentalMode] = useState<SolfegeAccidentalMode>("diatonic");
  const [solfegeOverlayMode, setSolfegeOverlayMode] = useState(false);

  return {
    solfegeMode,
    setSolfegeMode,
    solfegeAccidentalMode,
    setSolfegeAccidentalMode,
    solfegeOverlayMode,
    setSolfegeOverlayMode,
    addSolfegeLyricsToMusicXml,
    colorForSolfegeSyllable,
  };
}
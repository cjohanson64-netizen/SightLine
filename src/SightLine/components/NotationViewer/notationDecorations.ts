import type { MutableRefObject } from "react";
import {
  getNoteheadNodes,
  getOrderedNoteheads,
  getPaintTargets,
  getPositionedNoteheads,
  paintNoteheadElement,
} from "./noteheadHelpers";
import {
  clearPaintStyling,
  normalizeColorToken,
  readPaintColor,
  safeCenterX,
} from "./svgHelpers";

const SOLFEGE_COLOR_MAP: Record<string, string> = {
  DO: "#ff3b30",
  DI: "#ff3b30",
  RE: "#ff9500",
  RI: "#ff9500",
  RA: "#ff9500",
  MI: "#ffd60a",
  ME: "#ffd60a",
  FA: "#32d74b",
  FI: "#32d74b",
  SOL: "#00c7be",
  SO: "#00c7be",
  SI: "#00c7be",
  SE: "#00c7be",
  LA: "#bf5af2",
  LE: "#bf5af2",
  LI: "#bf5af2",
  TI: "#ff2d95",
  TE: "#ff2d95",
};

const HIGHLIGHT_COLOR_RGB: Record<string, string> = {
  "#1ecf87": "30,207,135",
  "#ff2da6": "255,45,166",
};

type RhythmMarker = "match" | "close" | "mismatch" | "missing";

const RHYTHM_MARKER_TEXT: Record<RhythmMarker, string> = {
  match: "✓",
  close: "~",
  mismatch: "×",
  missing: "—",
};
const RHYTHM_MARKER_ROW_TOLERANCE = 36;
const RHYTHM_MARKER_BASELINE_OFFSET = 18;

type DecorationOptions = {
  solfegeColorizeLyrics: boolean;
  solfegeOverlayNoteheads: boolean;
  climaxNoteIndices: number[];
  showClimaxMarkers: boolean;
  enableGlowEffects: boolean;
  rhythmMarkersByIndex: Record<number, RhythmMarker | undefined>;
};

type SolfegeLyricEntry = {
  x: number;
  color: string;
};

type RhythmMarkerTarget = {
  notehead: SVGElement;
  box: DOMRect;
  x: number;
  bottom: number;
};

export function scheduleNotationDecorations(
  container: HTMLElement,
  renderSeqRef: MutableRefObject<number>,
  options: DecorationOptions,
): void {
  const seq = renderSeqRef.current;

  runNotationDecorationPass(container, options);

  requestAnimationFrame(() => {
    if (seq !== renderSeqRef.current || !container.isConnected) {
      return;
    }

    runNotationDecorationPass(container, options);

    requestAnimationFrame(() => {
      if (seq !== renderSeqRef.current || !container.isConnected) {
        return;
      }

      runNotationDecorationPass(container, options);
    });
  });
}

function runNotationDecorationPass(
  container: HTMLElement,
  options: DecorationOptions,
): void {
  applyNotationDecorations(
    container,
    options.solfegeColorizeLyrics,
    options.solfegeOverlayNoteheads,
    options.enableGlowEffects,
  );

  decorateClimaxNoteheads(
    container,
    options.climaxNoteIndices,
    options.showClimaxMarkers,
  );

  decorateRhythmMarkers(container, options.rhythmMarkersByIndex);
}

function applyNotationDecorations(
  container: HTMLElement,
  solfegeColorizeLyrics: boolean,
  solfegeOverlayNoteheads: boolean,
  enableGlowEffects: boolean,
): void {
  if (solfegeColorizeLyrics) {
    applySolfegeLyricColors(container);
  }

  if (enableGlowEffects) {
    applyHighlightedNoteheadShadows(container);
  }

  if (solfegeOverlayNoteheads) {
    applySolfegeNoteheadColors(container);
  }
}

function applySolfegeLyricColors(container: HTMLElement): void {
  const textNodes = Array.from(container.querySelectorAll("svg text"));

  for (const node of textNodes) {
    const raw = node.textContent?.trim() ?? "";

    if (!raw) {
      continue;
    }

    const key = raw.toUpperCase();
    const color = SOLFEGE_COLOR_MAP[key];

    if (!color) {
      continue;
    }

    node.setAttribute("fill", color);
    (node as SVGTextElement).style.setProperty("fill", color, "important");
    (node as SVGTextElement).style.fontWeight = "700";
  }
}

function applySolfegeNoteheadColors(container: HTMLElement): void {
  const lyricEntries = getSolfegeLyricEntries(container);

  if (lyricEntries.length === 0) {
    return;
  }

  const noteheadEntries = getPositionedNoteheads(container);

  if (noteheadEntries.length === 0) {
    return;
  }

  const used = new Set<number>();

  for (const lyric of lyricEntries) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < noteheadEntries.length; index += 1) {
      if (used.has(index)) {
        continue;
      }

      const distance = Math.abs(noteheadEntries[index].x - lyric.x);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    if (bestIndex === -1 || bestDistance > 28) {
      continue;
    }

    used.add(bestIndex);
    paintNoteheadElement(noteheadEntries[bestIndex].node, lyric.color);
  }
}

function applyHighlightedNoteheadShadows(container: HTMLElement): void {
  const noteheads = getNoteheadNodes(container);

  for (const notehead of noteheads) {
    const paintTargets = getPaintTargets(notehead);
    let highlightHex: string | null = null;

    for (const target of paintTargets) {
      const candidate = parseHighlightHex(readPaintColor(target as SVGElement));

      if (candidate) {
        highlightHex = candidate;
        break;
      }
    }

    if (!highlightHex) {
      continue;
    }

    applyNoteheadHighlightShadow(notehead, highlightHex);
  }
}

function decorateClimaxNoteheads(
  container: HTMLElement,
  climaxNoteIndices: number[],
  showClimaxMarkers: boolean,
): void {
  Array.from(
    container.querySelectorAll("svg .NotationViewer-climaxBadge"),
  ).forEach((node) => node.remove());

  const noteheads = getOrderedNoteheads(container);
  const climaxIndices = new Set(climaxNoteIndices);

  noteheads.forEach((node, index) => {
    node.classList.remove("NotationViewer-notehead--climax");
    node.removeAttribute("data-climax-marker");

    if (!showClimaxMarkers || !climaxIndices.has(index)) {
      return;
    }

    node.classList.add("NotationViewer-notehead--climax");
    node.setAttribute("data-climax-marker", "Climax");
    appendClimaxBadge(node);
  });
}

function appendClimaxBadge(node: SVGElement): void {
  try {
    const svg = node.ownerSVGElement;
    const box = (node as SVGGraphicsElement).getBBox();

    if (!svg || !Number.isFinite(box.x) || !Number.isFinite(box.y)) {
      return;
    }

    const namespace = "http://www.w3.org/2000/svg";
    const badgeGroup = document.createElementNS(namespace, "g");
    badgeGroup.setAttribute("class", "NotationViewer-climaxBadge");
    badgeGroup.setAttribute("pointer-events", "none");

    const label = "Climax";
    const charWidth = 5.4;
    const horizontalPadding = 6;
    const badgeWidth = label.length * charWidth + horizontalPadding * 2;
    const badgeHeight = 14;
    const badgeX = box.x + box.width / 2 - badgeWidth / 2;
    const badgeY = box.y - 22;

    const rect = document.createElementNS(namespace, "rect");
    rect.setAttribute("x", badgeX.toFixed(2));
    rect.setAttribute("y", badgeY.toFixed(2));
    rect.setAttribute("width", badgeWidth.toFixed(2));
    rect.setAttribute("height", badgeHeight.toFixed(2));
    rect.setAttribute("rx", "7");
    rect.setAttribute("ry", "7");
    rect.setAttribute("class", "NotationViewer-climaxBadgeRect");

    const text = document.createElementNS(namespace, "text");
    text.setAttribute("x", (box.x + box.width / 2).toFixed(2));
    text.setAttribute("y", (badgeY + 9.6).toFixed(2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "NotationViewer-climaxBadgeText");
    text.textContent = label;

    badgeGroup.appendChild(rect);
    badgeGroup.appendChild(text);
    svg.appendChild(badgeGroup);
  } catch {
    // If a badge cannot be placed, leave the note tagged without blocking render.
  }
}

function decorateRhythmMarkers(
  container: HTMLElement,
  rhythmMarkersByIndex: DecorationOptions["rhythmMarkersByIndex"],
): void {
  Array.from(
    container.querySelectorAll("svg .NotationViewer-rhythmMarker"),
  ).forEach((node) => node.remove());

  if (Object.keys(rhythmMarkersByIndex).length === 0) {
    return;
  }

  const markerTargets = getRhythmMarkerTargets(container);

  for (const [rawIndex, marker] of Object.entries(rhythmMarkersByIndex)) {
    const index = Number(rawIndex);
    const target = markerTargets[index];

    if (!marker || !Number.isInteger(index) || !target) {
      continue;
    }

    appendRhythmMarker(target, marker);
  }
}

function getRhythmMarkerTargets(container: HTMLElement): RhythmMarkerTarget[] {
  const entries = getOrderedNoteheads(container)
    .map((notehead) => {
      try {
        const box = (notehead as SVGGraphicsElement).getBBox();

        if (!Number.isFinite(box.x) || !Number.isFinite(box.y)) {
          return null;
        }

        return {
          notehead,
          box,
          x: box.x + box.width / 2,
          bottom: box.y + box.height,
        };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is RhythmMarkerTarget => entry !== null);

  if (entries.length === 0) {
    return [];
  }

  const rows = groupRhythmMarkerTargetsByRow(entries);

  for (const row of rows) {
    const sharedBaseline =
      Math.max(...row.map((entry) => entry.bottom)) +
      RHYTHM_MARKER_BASELINE_OFFSET;

    for (const entry of row) {
      entry.bottom = sharedBaseline;
    }
  }

  return entries;
}

function groupRhythmMarkerTargetsByRow(
  entries: RhythmMarkerTarget[],
): RhythmMarkerTarget[][] {
  const rows: RhythmMarkerTarget[][] = [];

  for (const entry of entries) {
    const row = rows.find((candidate) => {
      const averageCenterY =
        candidate.reduce(
          (total, candidateEntry) =>
            total + candidateEntry.box.y + candidateEntry.box.height / 2,
          0,
        ) / candidate.length;
      const centerY = entry.box.y + entry.box.height / 2;

      return Math.abs(centerY - averageCenterY) <= RHYTHM_MARKER_ROW_TOLERANCE;
    });

    if (row) {
      row.push(entry);
    } else {
      rows.push([entry]);
    }
  }

  return rows;
}

function appendRhythmMarker(
  target: RhythmMarkerTarget,
  marker: RhythmMarker,
): void {
  try {
    const svg = target.notehead.ownerSVGElement;

    if (!svg) {
      return;
    }

    const namespace = "http://www.w3.org/2000/svg";
    const text = document.createElementNS(namespace, "text");

    text.setAttribute("x", target.x.toFixed(2));
    text.setAttribute("y", target.bottom.toFixed(2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute(
      "class",
      `NotationViewer-rhythmMarker NotationViewer-rhythmMarker--${marker}`,
    );
    text.setAttribute("pointer-events", "none");
    text.textContent = RHYTHM_MARKER_TEXT[marker];

    svg.appendChild(text);
  } catch {
    // Rhythm feedback should never block notation rendering.
  }
}

function getSolfegeLyricEntries(container: HTMLElement): SolfegeLyricEntry[] {
  return Array.from(container.querySelectorAll("svg text"))
    .map((node) => {
      const raw = node.textContent?.trim() ?? "";
      const key = raw.toUpperCase();
      const color = SOLFEGE_COLOR_MAP[key];
      const x = safeCenterX(node);

      if (!color || x === null) {
        return null;
      }

      return { x, color };
    })
    .filter((entry): entry is SolfegeLyricEntry => entry !== null)
    .sort((a, b) => a.x - b.x);
}

function applyNoteheadHighlightShadow(notehead: Element, hex: string): void {
  const rgb = HIGHLIGHT_COLOR_RGB[hex];

  if (!rgb) {
    return;
  }

  const glowOuter = `rgba(${rgb},1)`;
  const glowInner = `rgba(${rgb},1)`;
  const svgNode = notehead as SVGElement;

  svgNode.style.setProperty(
    "filter",
    `drop-shadow(0 0 3px ${glowInner}) drop-shadow(0 0 6px ${glowOuter})`,
    "important",
  );

  svgNode.style.setProperty("stroke-width", "1.25px", "important");

  for (const target of getPaintTargets(notehead)) {
    clearPaintStyling(target as SVGElement);
  }
}

function parseHighlightHex(color: string | null | undefined): string | null {
  if (!color) {
    return null;
  }

  const normalized = normalizeColorToken(color);

  for (const hex of Object.keys(HIGHLIGHT_COLOR_RGB)) {
    if (normalized === hex) {
      return hex;
    }

    const rgb = HIGHLIGHT_COLOR_RGB[hex];

    if (
      normalized === `rgb(${rgb})` ||
      normalized === `rgba(${rgb},1)` ||
      normalized === `rgba(${rgb},1.0)`
    ) {
      return hex;
    }
  }

  return null;
}

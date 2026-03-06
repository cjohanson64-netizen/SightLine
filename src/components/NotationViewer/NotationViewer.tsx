import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import '../../styles/NotationViewer.css';

interface NotationViewerProps {
  musicXml: string;
  headerControls?: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  focusTitle?: string;
  zoom?: number;
  projectionMode?: boolean;
  solfegeActive?: boolean;
  solfegeOverlayNoteheads?: boolean;
}

const SOLFEGE_COLOR_MAP: Record<string, string> = {
  DO: '#ff3b30',
  DI: '#ff3b30',
  RE: '#ff9500',
  RI: '#ff9500',
  RA: '#ff9500',
  MI: '#ffd60a',
  ME: '#ffd60a',
  FA: '#32d74b',
  FI: '#32d74b',
  SOL: '#00c7be',
  SO: '#00c7be',
  SI: '#00c7be',
  SE: '#00c7be',
  LA: '#bf5af2',
  LE: '#bf5af2',
  LI: '#bf5af2',
  TI: '#ff2d95',
  TE: '#ff2d95'
};

const HIGHLIGHT_COLOR_RGB: Record<string, string> = {
  '#1ecf87': '30,207,135',
  '#ff2da6': '255,45,166'
};

function applySolfegeLyricColors(container: HTMLElement): void {
  const textNodes = Array.from(container.querySelectorAll('svg text'));
  for (const node of textNodes) {
    const raw = node.textContent?.trim() ?? '';
    if (!raw) {
      continue;
    }
    const key = raw.toUpperCase();
    const color = SOLFEGE_COLOR_MAP[key];
    if (!color) {
      continue;
    }
    node.setAttribute('fill', color);
    (node as SVGTextElement).style.setProperty('fill', color, 'important');
    (node as SVGTextElement).style.fontWeight = '700';
  }
}

function safeCenterX(element: Element): number | null {
  try {
    const box = (element as SVGGraphicsElement).getBBox();
    if (!Number.isFinite(box.x) || !Number.isFinite(box.width)) {
      return null;
    }
    return box.x + box.width / 2;
  } catch {
    return null;
  }
}

function paintNoteheadElement(notehead: Element, color: string): void {
  const targets = notehead.matches('path, ellipse, circle, polygon')
    ? [notehead]
    : Array.from(notehead.querySelectorAll('path, ellipse, circle, polygon'));
  for (const target of targets) {
    (target as SVGElement).style.setProperty('fill', color, 'important');
    (target as SVGElement).style.setProperty('stroke', color, 'important');
  }
}

function normalizeColorToken(color: string): string {
  return color.replace(/\s+/g, '').toLowerCase();
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

function readPaintColor(target: SVGElement): string | null {
  const styleFill = target.style.getPropertyValue('fill');
  if (styleFill) {
    return styleFill;
  }
  const styleStroke = target.style.getPropertyValue('stroke');
  if (styleStroke) {
    return styleStroke;
  }
  const attrFill = target.getAttribute('fill');
  if (attrFill) {
    return attrFill;
  }
  const attrStroke = target.getAttribute('stroke');
  if (attrStroke) {
    return attrStroke;
  }
  return null;
}

function clearPaintStyling(target: SVGElement): void {
  target.style.removeProperty('fill');
  target.style.removeProperty('stroke');
  target.removeAttribute('fill');
  target.removeAttribute('stroke');
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
    'filter',
    `drop-shadow(0 0 3px ${glowInner}) drop-shadow(0 0 6px ${glowOuter})`,
    'important'
  );
  svgNode.style.setProperty('stroke-width', '1.25px', 'important');
  const paintTargets = notehead.matches('path, ellipse, circle, polygon')
    ? [notehead]
    : Array.from(notehead.querySelectorAll('path, ellipse, circle, polygon'));
  for (const target of paintTargets) {
    clearPaintStyling(target as SVGElement);
  }
}

function applyHighlightedNoteheadShadows(container: HTMLElement): void {
  let noteheads = Array.from(container.querySelectorAll('svg g.vf-notehead'));
  if (noteheads.length === 0) {
    noteheads = Array.from(container.querySelectorAll('svg .vf-notehead'));
  }
  for (const notehead of noteheads) {
    const paintTargets = notehead.matches('path, ellipse, circle, polygon')
      ? [notehead]
      : Array.from(notehead.querySelectorAll('path, ellipse, circle, polygon'));
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

function applySolfegeNoteheadColors(container: HTMLElement): void {
  const lyricEntries = Array.from(container.querySelectorAll('svg text'))
    .map((node) => {
      const raw = node.textContent?.trim() ?? '';
      const key = raw.toUpperCase();
      const color = SOLFEGE_COLOR_MAP[key];
      const x = safeCenterX(node);
      if (!color || x === null) {
        return null;
      }
      return { x, color };
    })
    .filter((entry): entry is { x: number; color: string } => entry !== null)
    .sort((a, b) => a.x - b.x);

  if (lyricEntries.length === 0) {
    return;
  }

  let noteheads = Array.from(container.querySelectorAll('svg g.vf-notehead'));
  if (noteheads.length === 0) {
    noteheads = Array.from(container.querySelectorAll('svg .vf-notehead'));
  }
  const noteheadEntries = noteheads
    .map((node) => {
      const x = safeCenterX(node);
      return x === null ? null : { node, x };
    })
    .filter((entry): entry is { node: Element; x: number } => entry !== null)
    .sort((a, b) => a.x - b.x);

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

export default function NotationViewer({
  musicXml,
  headerControls,
  onKeyDown,
  focusTitle,
  zoom = 1,
  projectionMode = false,
  solfegeActive = false,
  solfegeOverlayNoteheads = false
}: NotationViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const renderSeqRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, {
      drawingParameters: 'default',
      autoResize: true,
      backend: 'svg'
    });
    const rules = (osmdRef.current as unknown as {
      EngravingRules?: {
        RenderTitle?: boolean;
        RenderSubtitle?: boolean;
        RenderComposer?: boolean;
        RenderLyricist?: boolean;
        RenderPartNames?: boolean;
        RenderPartAbbreviations?: boolean;
      };
    }).EngravingRules;
    if (rules) {
      rules.RenderTitle = false;
      rules.RenderSubtitle = false;
      rules.RenderComposer = false;
      rules.RenderLyricist = false;
      rules.RenderPartNames = false;
      rules.RenderPartAbbreviations = false;
    }
  }, []);

  useEffect(() => {
    const osmd = osmdRef.current;
    const container = containerRef.current;
    if (!osmd || !container || !musicXml) {
      return;
    }

    const seq = renderSeqRef.current + 1;
    renderSeqRef.current = seq;

    void osmd
      .load(musicXml)
      .then(() => {
        if (seq !== renderSeqRef.current) {
          return;
        }
        // Apply zoom immediately before render so staff scaling is reflected.
        osmd.Zoom = Math.max(0.1, zoom);
        osmd.render();
        applySolfegeLyricColors(container);
        applyHighlightedNoteheadShadows(container);
        if (solfegeOverlayNoteheads) {
          applySolfegeNoteheadColors(container);
        }
      })
      .catch(() => {
        if (seq !== renderSeqRef.current) {
          return;
        }
        if (containerRef.current) {
          containerRef.current.innerHTML =
            '<p class="NotationViewer-error">Unable to render MusicXML.</p>';
        }
      });
  }, [musicXml, zoom, solfegeOverlayNoteheads]);

  return (
    <section className={`NotationViewer ${projectionMode ? 'NotationViewer--projection' : ''} ${solfegeActive ? 'NotationViewer--solfege' : ''}`}>
      {headerControls ? <h2 className="NotationViewer-controls">{headerControls}</h2> : null}
      <div
        className="NotationViewer-canvas"
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        title={focusTitle ?? 'Click to focus. Use arrow keys to navigate.'}
      />
    </section>
  );
}

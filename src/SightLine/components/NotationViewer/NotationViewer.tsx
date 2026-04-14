import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MutableRefObject, ReactNode } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import '../../styles/NotationViewer.css';

interface NotationViewerProps {
  musicXml: string;
  headerControls?: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  focusTitle?: string;
  zoom?: number;
  projectionMode?: boolean;
  timeSig?: string;
  phraseLengthMeasures?: number;
  solfegeActive?: boolean;
  solfegeColorizeLyrics?: boolean;
  solfegeOverlayNoteheads?: boolean;
  selectableNoteCount?: number;
  selectedNoteIndex?: number | null;
  noteOutcomeByIndex?: Array<'correct' | 'near' | 'incorrect' | 'ambiguous' | null>;
  onNoteSelect?: (index: number) => void;
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

const CANVAS_HORIZONTAL_PADDING_PX = 24;
const MIN_RENDER_WIDTH_PX = 280;

function countMeasures(musicXml: string): number {
  const matches = musicXml.match(/<measure\b/gi);
  return matches?.length ?? 0;
}

function hasRenderableMusicXml(musicXml: string): boolean {
  if (!musicXml.trim()) {
    return false;
  }

  try {
    const doc = new DOMParser().parseFromString(musicXml, 'application/xml');
    if (doc.querySelector('parsererror')) {
      return false;
    }
    return doc.querySelector('measure note') !== null;
  } catch {
    return false;
  }
}

function renderOsmdWithoutSkyBottomWarnings(osmd: OpenSheetMusicDisplay): void {
  const originalWarn = console.warn;
  const originalError = console.error;
  const shouldSuppress = (args: unknown[]): boolean =>
    args.some(
      (arg) =>
        typeof arg === 'string' &&
        arg.includes('SkyBottomLineCalculator: width not > 0')
    );

  console.warn = (...args: unknown[]) => {
    if (shouldSuppress(args)) {
      return;
    }
    originalWarn(...args);
  };

  console.error = (...args: unknown[]) => {
    if (shouldSuppress(args)) {
      return;
    }
    originalError(...args);
  };

  try {
    osmd.render();
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getMeasuresPerSystem(
  measureCount: number,
  availableWidth: number,
  projectionMode: boolean,
  timeSig?: string,
  phraseLengthMeasures?: number
): number {
  if (typeof phraseLengthMeasures === 'number' && phraseLengthMeasures > 0) {
    if (timeSig === '2/4') {
      return clamp(phraseLengthMeasures * 2, 1, measureCount);
    }
    if (timeSig === '3/4' || timeSig === '4/4') {
      return clamp(phraseLengthMeasures, 1, measureCount);
    }
  }

  if (measureCount <= 2) {
    return measureCount;
  }
  if (measureCount <= 4) {
    return Math.min(measureCount, availableWidth >= 880 ? 4 : 3);
  }
  if (projectionMode) {
    if (availableWidth >= 1400) {
      return 6;
    }
    if (availableWidth >= 1100) {
      return 5;
    }
  }
  if (availableWidth >= 1200) {
    return 5;
  }
  if (availableWidth >= 900) {
    return 4;
  }
  if (availableWidth >= 640) {
    return 3;
  }
  return 2;
}

function getShortPhraseStretchLimit(measureCount: number, projectionMode: boolean): number {
  if (projectionMode) {
    return measureCount <= 2 ? 2.8 : measureCount <= 4 ? 2.15 : 1.55;
  }
  return measureCount <= 2 ? 2.35 : measureCount <= 4 ? 1.85 : 1.35;
}

function getResponsiveZoom(
  baseZoom: number,
  measureCount: number,
  availableWidth: number,
  projectionMode: boolean
): number {
  if (projectionMode) {
    return baseZoom;
  }
  const shortPhraseBoost =
    measureCount <= 2
      ? availableWidth >= 920
        ? 1.22
        : 1.12
      : measureCount <= 4
        ? availableWidth >= 920
          ? 1.12
          : 1.04
        : 1;
  return baseZoom * shortPhraseBoost;
}

function configureResponsiveLayout(
  osmd: OpenSheetMusicDisplay,
  availableWidth: number,
  measureCount: number,
  projectionMode: boolean,
  timeSig?: string,
  phraseLengthMeasures?: number
): void {
  const rules = osmd.EngravingRules;
  const measuresPerSystem = getMeasuresPerSystem(
    measureCount,
    availableWidth,
    projectionMode,
    timeSig,
    phraseLengthMeasures
  );

  rules.PageLeftMargin = projectionMode ? 8 : 6;
  rules.PageRightMargin = projectionMode ? 8 : 6;
  rules.SystemLeftMargin = 0;
  rules.SystemRightMargin = 0;
  rules.MinimumDistanceBetweenSystems = projectionMode ? 8 : 7;
  rules.MinSkyBottomDistBetweenSystems = projectionMode ? 5 : 4;
  rules.StretchLastSystemLine = true;
  rules.LastSystemMaxScalingFactor = getShortPhraseStretchLimit(measureCount, projectionMode);
  rules.RenderXMeasuresPerLineAkaSystem =
    measureCount > 0 ? clamp(measuresPerSystem, 1, measureCount) : 0;
  rules.SheetMaximumWidth = Math.max(MIN_RENDER_WIDTH_PX, Math.floor(availableWidth));
}

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

function applyNotationDecorations(
  container: HTMLElement,
  solfegeColorizeLyrics: boolean,
  solfegeOverlayNoteheads: boolean
): void {
  if (solfegeColorizeLyrics) {
    applySolfegeLyricColors(container);
  }
  applyHighlightedNoteheadShadows(container);
  if (solfegeOverlayNoteheads) {
    applySolfegeNoteheadColors(container);
  }
}

function decorateSelectableNoteheads(
  container: HTMLElement,
  selectableNoteCount: number,
  selectedNoteIndex: number | null,
  noteOutcomeByIndex: Array<'correct' | 'near' | 'incorrect' | 'ambiguous' | null>,
  onNoteSelect?: (index: number) => void
): void {
  let noteheads = Array.from(container.querySelectorAll('svg g.vf-notehead'));
  if (noteheads.length === 0) {
    noteheads = Array.from(container.querySelectorAll('svg .vf-notehead'));
  }

  const ordered = noteheads
    .map((node) => {
      const x = safeCenterX(node);
      return x === null ? null : { node, x };
    })
    .filter((entry): entry is { node: Element; x: number } => entry !== null)
    .sort((a, b) => a.x - b.x)
    .slice(0, selectableNoteCount);

  ordered.forEach(({ node }, index) => {
    const svgNode = node as SVGElement;
    svgNode.classList.add('NotationViewer-notehead', 'NotationViewer-notehead--selectable');
    svgNode.classList.remove(
      'NotationViewer-notehead--correct',
      'NotationViewer-notehead--near',
      'NotationViewer-notehead--incorrect',
      'NotationViewer-notehead--ambiguous',
      'NotationViewer-notehead--selected'
    );
    const outcome = noteOutcomeByIndex[index];
    if (outcome) {
      svgNode.classList.add(`NotationViewer-notehead--${outcome}`);
    }
    if (selectedNoteIndex === index) {
      svgNode.classList.add('NotationViewer-notehead--selected');
    }
    svgNode.style.cursor = onNoteSelect ? 'pointer' : 'default';
    svgNode.onclick = onNoteSelect ? () => onNoteSelect(index) : null;
  });
}

function scheduleNotationDecorations(
  container: HTMLElement,
  renderSeqRef: MutableRefObject<number>,
  solfegeColorizeLyrics: boolean,
  solfegeOverlayNoteheads: boolean,
  selectableNoteCount: number,
  selectedNoteIndex: number | null,
  noteOutcomeByIndex: Array<'correct' | 'near' | 'incorrect' | 'ambiguous' | null>,
  onNoteSelect?: (index: number) => void
): void {
  const seq = renderSeqRef.current;
  applyNotationDecorations(container, solfegeColorizeLyrics, solfegeOverlayNoteheads);
  decorateSelectableNoteheads(
    container,
    selectableNoteCount,
    selectedNoteIndex,
    noteOutcomeByIndex,
    onNoteSelect
  );
  requestAnimationFrame(() => {
    if (seq !== renderSeqRef.current || !container.isConnected) {
      return;
    }
    applyNotationDecorations(container, solfegeColorizeLyrics, solfegeOverlayNoteheads);
    decorateSelectableNoteheads(
      container,
      selectableNoteCount,
      selectedNoteIndex,
      noteOutcomeByIndex,
      onNoteSelect
    );
    requestAnimationFrame(() => {
      if (seq !== renderSeqRef.current || !container.isConnected) {
        return;
      }
      applyNotationDecorations(container, solfegeColorizeLyrics, solfegeOverlayNoteheads);
      decorateSelectableNoteheads(
        container,
        selectableNoteCount,
        selectedNoteIndex,
        noteOutcomeByIndex,
        onNoteSelect
      );
    });
  });
}

export default function NotationViewer({
  musicXml,
  headerControls,
  onKeyDown,
  focusTitle,
  zoom = 1,
  projectionMode = false,
  timeSig,
  phraseLengthMeasures,
  solfegeActive = false,
  solfegeColorizeLyrics = false,
  solfegeOverlayNoteheads = false,
  selectableNoteCount = 0,
  selectedNoteIndex = null,
  noteOutcomeByIndex = [],
  onNoteSelect
}: NotationViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const renderSeqRef = useRef<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const hasMusicXml = hasRenderableMusicXml(musicXml);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, {
      drawingParameters: 'default',
      autoResize: false,
      backend: 'svg',
      pageFormat: 'Endless',
      stretchLastSystemLine: true
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
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateWidth = (): void => {
      const nextWidth = Math.max(
        MIN_RENDER_WIDTH_PX,
        Math.floor(container.clientWidth - CANVAS_HORIZONTAL_PADDING_PX)
      );
      setContainerWidth((current) => (Math.abs(current - nextWidth) > 1 ? nextWidth : current));
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || hasMusicXml) {
      return;
    }

    renderSeqRef.current += 1;
    container.innerHTML = '';
  }, [hasMusicXml]);

  useEffect(() => {
    const osmd = osmdRef.current;
    const container = containerRef.current;
    if (!osmd || !container || !musicXml || containerWidth <= 0) {
      return;
    }

    const seq = renderSeqRef.current + 1;
    renderSeqRef.current = seq;
    const measureCount = countMeasures(musicXml);

    void osmd
      .load(musicXml)
      .then(() => {
        if (seq !== renderSeqRef.current) {
          return;
        }
        configureResponsiveLayout(
          osmd,
          containerWidth,
          measureCount,
          projectionMode,
          timeSig,
          phraseLengthMeasures
        );
        osmd.Zoom = Math.max(
          0.1,
          getResponsiveZoom(zoom, measureCount, containerWidth, projectionMode)
        );
        renderOsmdWithoutSkyBottomWarnings(osmd);
        scheduleNotationDecorations(
          container,
          renderSeqRef,
          solfegeColorizeLyrics,
          solfegeOverlayNoteheads,
          selectableNoteCount,
          selectedNoteIndex,
          noteOutcomeByIndex,
          onNoteSelect
        );
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
  }, [
    musicXml,
    zoom,
    projectionMode,
    timeSig,
    phraseLengthMeasures,
    containerWidth,
    solfegeColorizeLyrics,
    solfegeOverlayNoteheads
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !musicXml) {
      return;
    }

    scheduleNotationDecorations(
      container,
      renderSeqRef,
      solfegeColorizeLyrics,
      solfegeOverlayNoteheads,
      selectableNoteCount,
      selectedNoteIndex,
      noteOutcomeByIndex,
      onNoteSelect
    );
  }, [
    musicXml,
    solfegeActive,
    solfegeColorizeLyrics,
    solfegeOverlayNoteheads,
    projectionMode,
    headerControls,
    selectableNoteCount,
    selectedNoteIndex,
    noteOutcomeByIndex,
    onNoteSelect
  ]);

  return (
    <section className={`NotationViewer ${projectionMode ? 'NotationViewer--projection' : ''} ${solfegeActive ? 'NotationViewer--solfege' : ''}`}>
      {headerControls ? <h2 className="NotationViewer-controls">{headerControls}</h2> : null}
      <div
        className={`NotationViewer-canvas ${!hasMusicXml ? 'NotationViewer-canvas--empty' : ''}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        title={focusTitle ?? 'Click to focus. Use arrow keys to navigate.'}
      >
        <div
          className="NotationViewer-canvasMount"
          ref={containerRef}
        />
        {!hasMusicXml ? (
          <p className="NotationViewer-empty">Please generate a melody</p>
        ) : null}
      </div>
    </section>
  );
}

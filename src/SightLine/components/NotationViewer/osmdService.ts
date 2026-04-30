import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

export const CANVAS_HORIZONTAL_PADDING_PX = 24;
export const MIN_RENDER_WIDTH_PX = 280;

type HiddenMetadataRules = {
  RenderTitle?: boolean;
  RenderSubtitle?: boolean;
  RenderComposer?: boolean;
  RenderLyricist?: boolean;
  RenderPartNames?: boolean;
  RenderPartAbbreviations?: boolean;
};

export function createNotationDisplay(container: HTMLElement): OpenSheetMusicDisplay {
  const osmd = new OpenSheetMusicDisplay(container, {
    drawingParameters: 'default',
    autoResize: false,
    backend: 'svg',
    pageFormat: 'Endless',
    stretchLastSystemLine: true
  });
  hideScoreMetadata(osmd);
  return osmd;
}

export function renderOsmdWithoutSkyBottomWarnings(osmd: OpenSheetMusicDisplay): void {
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

export function configureResponsiveLayout(
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

export function getResponsiveZoom(
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

function hideScoreMetadata(osmd: OpenSheetMusicDisplay): void {
  const rules = (osmd as unknown as { EngravingRules?: HiddenMetadataRules }).EngravingRules;
  if (rules) {
    rules.RenderTitle = false;
    rules.RenderSubtitle = false;
    rules.RenderComposer = false;
    rules.RenderLyricist = false;
    rules.RenderPartNames = false;
    rules.RenderPartAbbreviations = false;
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

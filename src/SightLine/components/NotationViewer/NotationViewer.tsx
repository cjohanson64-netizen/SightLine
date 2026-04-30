import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import '../../styles/NotationViewer.css';
import { countMeasures, hasRenderableMusicXml } from './musicXml';
import {
  CANVAS_HORIZONTAL_PADDING_PX,
  MIN_RENDER_WIDTH_PX,
  configureResponsiveLayout,
  createNotationDisplay,
  getResponsiveZoom,
  renderOsmdWithoutSkyBottomWarnings
} from './osmdService';
import { scheduleNotationDecorations } from './notationDecorations';

type RhythmMarker = "match" | "close" | "mismatch" | "missing";
const EMPTY_RHYTHM_MARKERS: Record<number, RhythmMarker | undefined> = {};

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
  climaxNoteIndices?: number[];
  showClimaxMarkers?: boolean;
  enableGlowEffects?: boolean;
  rhythmMarkersByIndex?: Record<number, RhythmMarker | undefined>;
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
  climaxNoteIndices = [],
  showClimaxMarkers = false,
  enableGlowEffects = false,
  rhythmMarkersByIndex = EMPTY_RHYTHM_MARKERS
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

    osmdRef.current = createNotationDisplay(containerRef.current);
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
        scheduleNotationDecorations(container, renderSeqRef, {
          solfegeColorizeLyrics,
          solfegeOverlayNoteheads,
          climaxNoteIndices,
          showClimaxMarkers,
          enableGlowEffects,
          rhythmMarkersByIndex
        });
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
    solfegeOverlayNoteheads,
    enableGlowEffects,
    rhythmMarkersByIndex
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !musicXml) {
      return;
    }

    scheduleNotationDecorations(container, renderSeqRef, {
      solfegeColorizeLyrics,
      solfegeOverlayNoteheads,
      climaxNoteIndices,
      showClimaxMarkers,
      enableGlowEffects,
      rhythmMarkersByIndex
    });
  }, [
    musicXml,
    solfegeActive,
    solfegeColorizeLyrics,
    solfegeOverlayNoteheads,
    projectionMode,
    headerControls,
    climaxNoteIndices,
    showClimaxMarkers,
    enableGlowEffects,
    rhythmMarkersByIndex
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

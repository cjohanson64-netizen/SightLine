import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import '../../styles/NotationViewer.css';

interface NotationViewerProps {
  musicXml: string;
  headerControls?: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  focusTitle?: string;
}

export default function NotationViewer({
  musicXml,
  headerControls,
  onKeyDown,
  focusTitle
}: NotationViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || !musicXml) {
      return;
    }

    const osmd = new OpenSheetMusicDisplay(containerRef.current, {
      drawingParameters: 'default',
      autoResize: true,
      backend: 'svg'
    });

    void osmd
      .load(musicXml)
      .then(() => {
        osmd.render();
      })
      .catch(() => {
        if (containerRef.current) {
          containerRef.current.innerHTML = '<p class="NotationViewer-error">Unable to render MusicXML.</p>';
        }
      });
  }, [musicXml]);

  return (
    <section className="NotationViewer">
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

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import '../../styles/NotationViewer.css';

interface NotationViewerProps {
  musicXml: string;
  headerControls?: ReactNode;
}

export default function NotationViewer({ musicXml, headerControls }: NotationViewerProps): JSX.Element {
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
      <h2>Notation</h2>
      {headerControls ? <div className="NotationViewer-controls">{headerControls}</div> : null}
      <div className="NotationViewer-canvas" ref={containerRef} />
    </section>
  );
}

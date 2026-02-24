import { useMemo, useState } from 'react';
import ExerciseForm from './ExerciseForm';
import NotationViewer from '../src/components/NotationViewer/NotationViewer';
import ConsolePanel from '../src/components/ConsolePanel/ConsolePanel';
import { generateExercise } from './engine';
import type { ExerciseSpec } from './schema';
import '../src/styles/App.css';

const defaultSpec: ExerciseSpec = {
  key: 'C',
  mode: 'major',
  clef: 'treble',
  range: {
    lowDegree: 1,
    highDegree: 6,
    lowOctave: 4,
    highOctave: 5
  },
  measures: 4,
  timeSig: '4/4',
  difficulty: 'medium',
  chromatic: false,
  cadence: 'authentic'
};

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

export default function App(): JSX.Element {
  const [spec, setSpec] = useState<ExerciseSpec>(defaultSpec);
  const [seed, setSeed] = useState<number>(20260219);
  const [musicXml, setMusicXml] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);

  const generated = useMemo(() => {
    if (!musicXml) {
      return null;
    }

    return { musicXml, logs };
  }, [musicXml, logs]);

  const runGeneration = () => {
    const output = generateExercise({ spec, seed });
    setMusicXml(output.musicXml);
    setLogs(output.logs);
  };

  const handleExport = () => {
    if (!musicXml) {
      return;
    }

    const blob = new Blob([musicXml], { type: 'application/vnd.recordare.musicxml+xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `exercise-${seed}.musicxml`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="AppShell">
      <div className="AppMain">
        <ExerciseForm
          spec={spec}
          seed={seed}
          onSpecChange={setSpec}
          onSeedChange={setSeed}
          onGenerate={runGeneration}
          onRegenerate={runGeneration}
          onRandomizeSeed={() => setSeed(randomSeed())}
          onExport={handleExport}
        />
        <NotationViewer musicXml={generated?.musicXml ?? ''} />
      </div>
      <ConsolePanel logs={generated?.logs ?? []} />
    </div>
  );
}

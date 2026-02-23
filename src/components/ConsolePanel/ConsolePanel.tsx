import '../../styles/ConsolePanel.css';

interface ConsolePanelProps {
  logs: string[];
}

export default function ConsolePanel({ logs }: ConsolePanelProps): JSX.Element {
  return (
    <section className="ConsolePanel">
      <h2>Engine Console</h2>
      <div className="ConsolePanel-logWindow">
        {logs.length === 0 ? <p>No logs yet.</p> : logs.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
      </div>
    </section>
  );
}

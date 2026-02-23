import '../../styles/ErrorBanner.css';

interface ErrorBannerProps {
  title: string;
  message: string;
  suggestions: string[];
}

export default function ErrorBanner({ title, message, suggestions }: ErrorBannerProps): JSX.Element {
  return (
    <section className="ErrorBanner" role="alert" aria-live="polite">
      <h3>{title}</h3>
      <p>{message}</p>
      <ul>
        {suggestions.map((suggestion) => (
          <li key={suggestion}>{suggestion}</li>
        ))}
      </ul>
    </section>
  );
}

import "../styles/SightLineLandingPage.css";

type SightLineLandingPageProps = {
  onPrimaryCta?: () => void;
  onSecondaryCta?: () => void;
};

const problemPoints = [
  "Planning fresh melodic examples for each class takes significant prep time.",
  "Students need more reps than most teachers can manually produce each week.",
  "Differentiating for mixed skill levels often means building multiple versions of the same concept.",
  "Classroom-ready formatting and clean notation adds one more layer of work.",
];

const featureCards = [
  {
    title: "Generate in seconds",
    body: "Create classroom-ready sight-singing material quickly so planning time stays focused on instruction.",
  },
  {
    title: "Support direct instruction",
    body: "Use clear melodic examples to introduce patterns, reinforce concepts, and model strategy in real time.",
  },
  {
    title: "Increase student reps",
    body: "Provide more practice-ready examples so students sing more often and build confidence faster.",
  },
  {
    title: "Build melodic literacy",
    body: "Use targeted material for reading, analysis, and transfer so literacy skills improve with consistency.",
  },
];

const audienceCards = [
  "Middle and high school choir directors",
  "General music teachers teaching melodic reading",
  "Collegiate methods instructors",
  "Private lesson teachers building literacy fluency",
];

const useCaseCards = [
  {
    title: "Warm-ups and daily reps",
    body: "Open class with focused examples tied to current learning goals.",
  },
  {
    title: "Small-group differentiation",
    body: "Give different sections level-appropriate material without extra prep burden.",
  },
  {
    title: "Assessment prep",
    body: "Generate varied practice that mirrors the format and demand of classroom checks.",
  },
  {
    title: "Melodic analysis tasks",
    body: "Use generated lines for interval, contour, and tonal function discussion.",
  },
];

const testimonials = [
  {
    quote:
      "SightLine cut my planning time and gave my students far more singing reps each week.",
    name: "Choir Director, District Program",
  },
  {
    quote:
      "I can move from concept introduction to targeted practice in minutes, not hours.",
    name: "Middle School Music Teacher",
  },
  {
    quote:
      "The material is practical for real class pacing and easy to use right away.",
    name: "High School Choral Educator",
  },
];

export default function SightLineLandingPage({
  onPrimaryCta,
  onSecondaryCta,
}: SightLineLandingPageProps): JSX.Element {
  return (
    <div className="LandingPage">
      <header className="LandingNav">
        <div className="LandingContainer LandingNavRow">
          <a href="#top" className="LandingBrand">
            SightLine
          </a>
          <nav className="LandingNavLinks" aria-label="Landing sections">
            <a href="#problem">Problem</a>
            <a href="#features">Features</a>
            <a href="#audience">Audience</a>
            <a href="#use-cases">Use Cases</a>
            <a href="#credibility">Credibility</a>
          </nav>
          <button type="button" className="LandingButton LandingButtonGhost" onClick={onPrimaryCta}>
            Open Generator
          </button>
        </div>
      </header>

      <main id="top">
        <section className="LandingHero">
          <div className="LandingContainer LandingHeroGrid">
            <div>
              <p className="LandingKicker">For choir and music educators</p>
              <h1>Better sight-singing practice, without the prep overload.</h1>
              <p className="LandingLead">
                SightLine helps choir and music teachers generate classroom-ready
                sight-reading materials for instruction, student practice, and melodic
                literacy.
              </p>
              <div className="LandingActions">
                <button type="button" className="LandingButton" onClick={onPrimaryCta}>
                  Start generating materials
                </button>
                <button type="button" className="LandingButton LandingButtonGhost" onClick={onSecondaryCta}>
                  View teacher dashboard
                </button>
              </div>
              <p className="LandingBuilderNote">Built by a music educator for real classroom use</p>
            </div>
            <aside className="LandingHeroPanel" aria-label="SightLine outcomes">
              <h2>Why teachers use SightLine</h2>
              <ul>
                <li>Reduce prep load while still teaching with intentional sequence</li>
                <li>Increase class singing reps without sacrificing quality</li>
                <li>Reinforce melodic concepts with consistent, reusable workflows</li>
              </ul>
            </aside>
          </div>
        </section>

        <section id="problem" className="LandingSection">
          <div className="LandingContainer">
            <h2>Problem</h2>
            <p className="LandingSectionLead">
              Music teachers need high-quality material fast, but creating enough examples
              for effective repetition can consume planning time.
            </p>
            <div className="LandingCardGrid LandingCardGridSingleCol">
              {problemPoints.map((point) => (
                <article key={point} className="LandingCard">
                  <p>{point}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="LandingSection LandingSectionAlt">
          <div className="LandingContainer">
            <h2>Features and value</h2>
            <div className="LandingCardGrid">
              {featureCards.map((card) => (
                <article key={card.title} className="LandingCard">
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="audience" className="LandingSection">
          <div className="LandingContainer">
            <h2>Who it is for</h2>
            <div className="LandingChipGrid">
              {audienceCards.map((audience) => (
                <p key={audience} className="LandingChip">
                  {audience}
                </p>
              ))}
            </div>
          </div>
        </section>

        <section id="use-cases" className="LandingSection LandingSectionAlt">
          <div className="LandingContainer">
            <h2>Use cases</h2>
            <div className="LandingCardGrid">
              {useCaseCards.map((card) => (
                <article key={card.title} className="LandingCard">
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="credibility" className="LandingSection">
          <div className="LandingContainer">
            <h2>Credibility and teacher feedback</h2>
            <p className="LandingSectionLead">
              Built around practical classroom constraints, not abstract workflows.
            </p>
            <div className="LandingCardGrid">
              {testimonials.map((item) => (
                <article key={item.name} className="LandingCard">
                  <p className="LandingQuote">"{item.quote}"</p>
                  <p className="LandingQuoteAuthor">{item.name}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="LandingSection LandingFinalCta">
          <div className="LandingContainer LandingFinalCtaBox">
            <h2>Ready to spend less time prepping and more time teaching?</h2>
            <p>
              Use SightLine to generate practical melodic material your students can
              sing today.
            </p>
            <div className="LandingActions">
              <button type="button" className="LandingButton" onClick={onPrimaryCta}>
                Launch SightLine
              </button>
              <button type="button" className="LandingButton LandingButtonGhost" onClick={onSecondaryCta}>
                Explore teacher tools
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="LandingFooter">
        <div className="LandingContainer LandingFooterRow">
          <p>SightLine</p>
          <p>Built by a music educator for real classroom use</p>
          <p>© {new Date().getFullYear()} SightLine</p>
        </div>
      </footer>
    </div>
  );
}

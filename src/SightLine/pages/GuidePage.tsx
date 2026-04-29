import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useStudentSession } from "../hooks/useStudentSession";
import { useTeacherLibrary } from "../hooks/useTeacherLibrary";

type AuthState = ReturnType<typeof useAuth>;
type StudentSessionState = ReturnType<typeof useStudentSession>;
type TeacherLibraryState = ReturnType<typeof useTeacherLibrary>;

interface GuidePageProps {
  auth: AuthState;
  mode: "teacher" | "student" | "guest";
  modeLabel: "Teacher" | "Student" | "Guest";
  student: StudentSessionState;
  teacher: TeacherLibraryState;
}

const quickStartSteps = [
  "Open the generator.",
  "Set the musical parameters you want to practice.",
  "Generate an exercise.",
  "Play or project the melody for practice.",
  "Repeat with more reps or generate a new variation.",
];

const teacherWorkflow = [
  "Generate targeted melodic examples for the concept you are teaching.",
  "Use the exercise live in class or assign it for independent practice.",
  "Save useful exercises so you can reuse them with the same class or a new group.",
  "Open class tools when needed for saved exercises, roster setup, or practice access.",
];

const studentWorkflow = [
  "Open the assigned exercise or join with class access details.",
  "Practice independently with playback, projection, and solfege support.",
  "Submit completed work to your teacher when needed.",
  "Repeat for more reps and cleaner accuracy.",
];

const keyFeatures = [
  {
    title: "Targeted generation",
    body: "Build sight-singing material around the exact range, rhythm, and tonal limits you want students to practice.",
  },
  {
    title: "Structured practice",
    body: "Move from setup to singing quickly so more class time goes toward actual reps.",
  },
  {
    title: "Flexible presentation",
    body: "Use playback, projection mode, and solfege overlays to support practice in class or independently.",
  },
  {
    title: "Classroom usefulness",
    body: "Save and reuse exercises for class routines, assignments, and differentiated support.",
  },
];

export default function GuidePage({
  auth,
  mode,
  modeLabel,
  student,
  teacher,
}: GuidePageProps): JSX.Element {
  const summaryItems = [
    {
      label: "Mode",
      value: `${modeLabel} mode`,
      detail: auth.authUser?.email
        ? `Signed in as ${auth.authUser.email}`
        : mode === "student"
          ? "Working in student session"
          : "Open the generator to begin",
    },
    {
      label: "Saved exercises",
      value: String(teacher.savedExercises.length),
      detail:
        mode === "teacher"
          ? "Reusable examples ready for class or assignment."
          : "Teacher summaries appear after you sign in.",
    },
    {
      label: "Class rows",
      value: String(teacher.teacherProgressRows.length),
      detail:
        mode === "teacher"
          ? "Lightweight classroom activity snapshot."
          : "Classroom summaries show up in teacher mode.",
    },
    {
      label: "Student practice",
      value:
        mode === "student"
          ? `${student.studentProgress.total_attempts} attempts`
          : "Ready",
      detail:
        mode === "student"
          ? `${student.studentProgress.total_minutes} minutes logged this week.`
          : "Students can practice independently once they join or open an assignment.",
    },
  ];

  return (
    <section className="AppRoutePage AppGuidePage">
      <div className="AppGuideHero AppDashboardCard">
        <div>
          <p className="AppGuideEyebrow">SightLine Guide</p>
          <h2>How to Use SightLine</h2>
          <p className="AppGuideLead">
            SightLine helps teachers generate targeted sight-singing practice
            and helps students practice independently with fast feedback.
          </p>
        </div>
        <div className="AppDashboardActions">
          <Link className="AppHistoryButton" to="/">
            Open Generator
          </Link>
          {mode === "teacher" ? (
            <Link className="AppHistoryButton" to="/class">
              Open Class Access
            </Link>
          ) : null}
        </div>
      </div>

      <div className="AppGuideGrid">
        <section className="AppDashboardCard">
          <h3>Quick Start</h3>
          <ol className="AppGuideList AppGuideListNumbered">
            {quickStartSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="AppDashboardCard">
          <h3>Teacher Workflow</h3>
          <ul className="AppGuideList">
            {teacherWorkflow.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </section>

        <section className="AppDashboardCard">
          <h3>Student Workflow</h3>
          <ul className="AppGuideList">
            {studentWorkflow.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </section>

        <section className="AppDashboardCard">
          <h3>Key Features</h3>
          <div className="AppGuideFeatureGrid">
            {keyFeatures.map((feature) => (
              <article key={feature.title} className="AppGuideFeature">
                <h4>{feature.title}</h4>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="AppDashboardCard">
        <h3>At a Glance</h3>
        <div className="AppGuideSummaryGrid">
          {summaryItems.map((item) => (
            <article key={item.label} className="AppGuideSummaryItem">
              <p className="AppGuideSummaryLabel">{item.label}</p>
              <p className="AppGuideSummaryValue">{item.value}</p>
              <p className="AppHistoryLabel">{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="AppDashboardActions">
        <Link className="AppHistoryButton" to="/">
          Back to Generator
        </Link>
      </div>
    </section>
  );
}

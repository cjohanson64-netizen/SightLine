import type { DebugSemanticsProjection } from '@/SightLine/domain/artifact';

interface DebugSemanticsPanelProps {
  debugSemantics: DebugSemanticsProjection;
}

export default function DebugSemanticsPanel({
  debugSemantics
}: DebugSemanticsPanelProps): JSX.Element {
  return (
    <div className="AppAssessmentGrid">
      <div className="AppAssessmentCard">
        <h4>TAT Target Note Semantics</h4>
        {debugSemantics.targetNotes.length === 0 ? (
          <p className="AppHistoryLabel">No projected target-note semantics are available.</p>
        ) : (
          <ul className="AppAssessmentList">
            {debugSemantics.targetNotes.map((note) => (
              <li key={note.noteId}>
                {note.measure}.{note.beat} | {note.pitch} | phrase {note.phraseIndex} |{' '}
                {note.functions.length > 0 ? note.functions.join(', ') : 'none'}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="AppAssessmentCard">
        <h4>TAT Assessment Explanations</h4>
        {debugSemantics.assessmentExplanations.length === 0 ? (
          <p className="AppHistoryLabel">
            No projected assessment explanations are available for this artifact.
          </p>
        ) : (
          <ul className="AppAssessmentList">
            {debugSemantics.assessmentExplanations.map((item) => (
              <li key={item.explanationId}>
                {item.outcome} | target {item.targetNoteId ?? 'none'} | performed{' '}
                {item.performedNoteId ?? 'none'}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="AppAssessmentCard">
        <h4>TAT Phrase Semantics Summaries</h4>
        {debugSemantics.phraseSummaries.length === 0 ? (
          <p className="AppHistoryLabel">No phrase summaries are available for this artifact.</p>
        ) : (
          <ul className="AppAssessmentList">
            {debugSemantics.phraseSummaries.map((summary) => (
              <li key={`phrase-summary-${summary.phraseIndex}`}>
                {summary.summaryText}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

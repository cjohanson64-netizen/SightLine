import type {
  DebugPhraseSemanticsSummary,
  DebugProjectedTargetNote,
} from '@/SightLine/domain/artifact';

function compareByMusicalTime(
  a: DebugProjectedTargetNote,
  b: DebugProjectedTargetNote,
): number {
  return a.measure - b.measure || a.beat - b.beat;
}

function formatPitch(value: string | null): string {
  return value ?? 'unknown pitch';
}

function formatCadencePitches(pitches: string[]): string {
  if (pitches.length === 0) {
    return 'an unknown cadence';
  }
  if (pitches.length === 1) {
    return pitches[0];
  }
  if (pitches.length === 2) {
    return `${pitches[0]} to ${pitches[1]}`;
  }
  return pitches.join(', ');
}

function buildSummaryText(summary: Omit<DebugPhraseSemanticsSummary, 'summaryText'>): string {
  const phraseNumber = summary.phraseIndex > 0 ? summary.phraseIndex : 1;
  const parts = [
    `Phrase ${phraseNumber} opens on ${formatPitch(summary.openingPitch)}, climaxes on ${formatPitch(summary.climaxPitch)}, and cadences on ${formatCadencePitches(summary.cadencePitches)}.`
  ];

  if (summary.hasRelease) {
    parts.push('Release follows the climax.');
  }

  if (summary.hasConnectiveNht) {
    parts.push('Connective non-harmonic motion is present.');
  }

  return parts.join(' ');
}

export function projectPhraseSemanticsSummaries(
  targetNotes: DebugProjectedTargetNote[],
): DebugPhraseSemanticsSummary[] {
  const byPhrase = new Map<number, DebugProjectedTargetNote[]>();

  for (const note of targetNotes) {
    const bucket = byPhrase.get(note.phraseIndex) ?? [];
    bucket.push(note);
    byPhrase.set(note.phraseIndex, bucket);
  }

  return Array.from(byPhrase.entries())
    .sort(([a], [b]) => a - b)
    .map(([phraseIndex, notes]) => {
      const orderedNotes = [...notes].sort(compareByMusicalTime);
      const openingPitch =
        orderedNotes.find((note) => note.functions.includes('opening'))?.pitch ?? null;
      const climaxPitch =
        orderedNotes.find((note) => note.functions.includes('climax'))?.pitch ?? null;
      const cadencePitches = orderedNotes
        .filter((note) => note.functions.includes('cadence'))
        .map((note) => note.pitch);
      const hasRelease = orderedNotes.some((note) => note.functions.includes('release'));
      const hasConnectiveNht = orderedNotes.some((note) =>
        note.functions.includes('connective_nht'),
      );

      const summaryBase = {
        phraseIndex,
        openingPitch,
        climaxPitch,
        cadencePitches,
        hasRelease,
        hasConnectiveNht,
      };

      return {
        ...summaryBase,
        summaryText: buildSummaryText(summaryBase),
      };
    });
}

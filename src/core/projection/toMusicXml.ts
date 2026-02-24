import type { ArtifactGraph, MelodyEvent } from '../../tat/models/schema';
import { buildSinglePartMusicXml, type MusicXmlNote } from '../musicxml/builder';

interface ProjectionRenderOptions {
  highlightedMelodyIndex?: number;
  highlightColor?: string;
}

const FIFTHS_BY_KEY: Record<string, number> = {
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  'F#': 6,
  'C#': 7,
  F: -1,
  Bb: -2,
  Eb: -3,
  Ab: -4,
  Db: -5,
  Gb: -6,
  Cb: -7
};

function pitchToMusicXml(pitch: string): Pick<MusicXmlNote, 'step' | 'alter' | 'octave'> {
  const match = /^([A-G])(#|b)?(\d)$/.exec(pitch);
  if (!match) {
    return { step: 'C', alter: 0, octave: 4 };
  }

  const [, step, accidental, octave] = match;
  return {
    step,
    alter: accidental === '#' ? 1 : accidental === 'b' ? -1 : 0,
    octave: Number(octave)
  };
}

function durationToMusicXml(duration: string): Pick<MusicXmlNote, 'duration' | 'type'> {
  if (duration === 'whole') {
    return { duration: 8, type: 'whole' };
  }
  if (duration === 'half') {
    return { duration: 4, type: 'half' };
  }
  if (duration === 'eighth') {
    return { duration: 1, type: 'eighth' };
  }
  return { duration: 2, type: 'quarter' };
}

function buildMusicXmlFromSpecAndMelody(
  spec: Record<string, unknown>,
  melodyEvents: MelodyEvent[],
  options?: ProjectionRenderOptions
): string {

  const beats = Math.max(1, Number(String(spec.timeSig ?? '4/4').split('/')[0]) || 4);
  const beatType = Math.max(1, Number(String(spec.timeSig ?? '4/4').split('/')[1]) || 4);
  const phraseLengthMeasures = Math.max(1, Number(spec.phraseLengthMeasures ?? 4));
  const phraseCount = Array.isArray(spec.phrases) ? spec.phrases.length : 1;
  const measures = Math.max(1, phraseLengthMeasures * Math.max(1, phraseCount));

  type MeasureNote = MusicXmlNote & { onset: number };
  const notesByMeasure: MeasureNote[][] = Array.from({ length: measures }, () => []);

  for (let eventIndex = 0; eventIndex < melodyEvents.length; eventIndex += 1) {
    const event = melodyEvents[eventIndex];
    const index = Math.max(0, Math.min(measures - 1, event.measure - 1));
    const pitch = pitchToMusicXml(event.pitch);
    const rhythm = durationToMusicXml(event.duration);
    const isHighlighted = options?.highlightedMelodyIndex === eventIndex;
    notesByMeasure[index].push({
      ...pitch,
      ...rhythm,
      onset: event.onsetBeat ?? event.beat,
      color: isHighlighted ? options?.highlightColor ?? '#ff2da6' : undefined
    });
  }

  for (let measure = 0; measure < notesByMeasure.length; measure += 1) {
    notesByMeasure[measure].sort((a, b) => a.onset - b.onset);
    let i = 0;
    while (i < notesByMeasure[measure].length) {
      const start = i;
      if (notesByMeasure[measure][start].type !== 'eighth' || notesByMeasure[measure][start].onset <= 0) {
        i += 1;
        continue;
      }

      let end = start;
      while (end + 1 < notesByMeasure[measure].length) {
        const curr = notesByMeasure[measure][end];
        const next = notesByMeasure[measure][end + 1];
        if (curr.type !== 'eighth' || next.type !== 'eighth') {
          break;
        }
        const contiguous = Math.abs((next.onset ?? 0) - (curr.onset ?? 0) - 0.5) < 0.001;
        if (!contiguous) {
          break;
        }
        end += 1;
      }

      if (end > start) {
        notesByMeasure[measure][start].beam = 'begin';
        for (let k = start + 1; k < end; k += 1) {
          notesByMeasure[measure][k].beam = 'continue';
        }
        notesByMeasure[measure][end].beam = 'end';
      }

      i = Math.max(i + 1, end + 1);
    }
  }

  const measureDivisions = beats * 2;
  for (let measure = 0; measure < notesByMeasure.length; measure += 1) {
    let used = notesByMeasure[measure].reduce((sum, note) => sum + note.duration, 0);
    while (used < measureDivisions) {
      const remaining = measureDivisions - used;
      if (remaining >= 2) {
        notesByMeasure[measure].push({ step: 'C', alter: 0, octave: 4, duration: 2, type: 'quarter', onset: 0 });
        used += 2;
      } else {
        notesByMeasure[measure].push({ step: 'C', alter: 0, octave: 4, duration: 1, type: 'eighth', onset: 0 });
        used += 1;
      }
    }
  }

  const finalPhraseBoundary = phraseCount * phraseLengthMeasures;
  const phraseBoundaryMeasures = finalPhraseBoundary <= measures ? [finalPhraseBoundary] : [];

  return buildSinglePartMusicXml({
    title: String(spec.title ?? 'SightLine Melody'),
    keyFifths: FIFTHS_BY_KEY[String(spec.key ?? 'C')] ?? 0,
    timeBeats: beats,
    timeBeatType: beatType,
    clefSign: spec.clef === 'bass' ? 'F' : 'G',
    clefLine: spec.clef === 'bass' ? 4 : 2,
    divisions: 2,
    measures: notesByMeasure.map((measureNotes) =>
      measureNotes.map(({ onset, ...note }) => note)
    ),
    phraseBoundaryMeasures
  });
}

export function toMusicXmlFromMelody(
  spec: Record<string, unknown>,
  melodyEvents: MelodyEvent[],
  options?: ProjectionRenderOptions
): string {
  return buildMusicXmlFromSpecAndMelody(spec, melodyEvents, options);
}

export function toMusicXml(artifact: ArtifactGraph, _seed?: number): string {
  const specNode = artifact.nodes.find((node) => node.id === 'exercise-spec');
  const spec = (specNode?.data ?? {}) as Record<string, unknown>;

  const melodyEvents = artifact.nodes
    .filter((node) => {
      const data = node.data as Partial<MelodyEvent>;
      return node.kind === 'leaf' && typeof data.pitch === 'string' && typeof data.measure === 'number';
    })
    .map((node) => node.data as MelodyEvent)
    .sort((a, b) => a.measure - b.measure || a.beat - b.beat);

  return buildMusicXmlFromSpecAndMelody(spec, melodyEvents);
}

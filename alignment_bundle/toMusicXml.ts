import type { ArtifactGraph, MelodyEvent } from '../../tat/models/schema';
import { buildSinglePartMusicXml, type MusicXmlNote } from '../musicxml/builder';

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

export function toMusicXml(artifact: ArtifactGraph): string {
  const specNode = artifact.nodes.find((node) => node.id === 'exercise-spec');
  const spec = (specNode?.data ?? {}) as Record<string, unknown>;

  const melodyEvents = artifact.nodes
    .filter((node) => {
      const data = node.data as Partial<MelodyEvent>;
      return node.kind === 'leaf' && typeof data.pitch === 'string' && typeof data.measure === 'number';
    })
    .map((node) => node.data as MelodyEvent)
    .sort((a, b) => a.measure - b.measure || a.beat - b.beat);

  const beats = Math.max(1, Number(String(spec.timeSig ?? '4/4').split('/')[0]) || 4);
  const beatType = Math.max(1, Number(String(spec.timeSig ?? '4/4').split('/')[1]) || 4);
  const measures = Math.max(1, Number(spec.measures ?? 4));

  const notesByMeasure: MusicXmlNote[][] = Array.from({ length: measures }, () => []);

  for (const event of melodyEvents) {
    const index = Math.max(0, Math.min(measures - 1, event.measure - 1));
    const pitch = pitchToMusicXml(event.pitch);
    notesByMeasure[index].push({
      ...pitch,
      duration: 1,
      type: 'quarter'
    });
  }

  for (let measure = 0; measure < notesByMeasure.length; measure += 1) {
    while (notesByMeasure[measure].length < beats) {
      notesByMeasure[measure].push({ step: 'C', alter: 0, octave: 4, duration: 1, type: 'quarter' });
    }
  }

  return buildSinglePartMusicXml({
    title: 'Tonnetz Sight Singing Exercise',
    composer: 'TAT Engine',
    keyFifths: FIFTHS_BY_KEY[String(spec.key ?? 'C')] ?? 0,
    timeBeats: beats,
    timeBeatType: beatType,
    clefSign: spec.clef === 'bass' ? 'F' : 'G',
    clefLine: spec.clef === 'bass' ? 4 : 2,
    divisions: 1,
    measures: notesByMeasure
  });
}

import type { ArtifactGraph } from '@/SightLine/domain/artifact';
import type { MelodyEvent } from '@/SightLine/domain/music';
import { buildSinglePartMusicXml, type MusicXmlNote } from '../musicxml/builder';

interface ProjectionRenderOptions {
  highlightedMelodyIndex?: number;
  highlightColor?: string;
  noteColorsByIndex?: Record<number, string | undefined>;
}

type ParsedSpec = {
  title: string;
  keyFifths: number;
  timeBeats: number;
  timeBeatType: number;
  phraseLengthMeasures: number;
  phraseCount: number;
  measureCount: number;
  clefSign: 'G' | 'F';
  clefLine: 2 | 4;
};

type MeasureNote = MusicXmlNote & { onset: number };

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

function pitchToMusicXml(
  pitch: string
): Pick<MusicXmlNote, 'step' | 'alter' | 'octave'> {
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

function durationToMusicXml(
  duration: string
): Pick<MusicXmlNote, 'duration' | 'type'> {
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

function parseTimeSignature(spec: Record<string, unknown>): {
  beats: number;
  beatType: number;
} {
  const [rawBeats, rawBeatType] = String(spec.timeSig ?? '4/4').split('/');

  return {
    beats: Math.max(1, Number(rawBeats) || 4),
    beatType: Math.max(1, Number(rawBeatType) || 4)
  };
}

function parseSpec(spec: Record<string, unknown>): ParsedSpec {
  const { beats, beatType } = parseTimeSignature(spec);

  const phraseLengthMeasures = Math.max(
    1,
    Number(spec.phraseLengthMeasures ?? 4)
  );

  const phraseCount = Array.isArray(spec.phrases) ? spec.phrases.length : 1;

  const measureCount = Math.max(
    1,
    phraseLengthMeasures * Math.max(1, phraseCount)
  );

  const clefIsBass = spec.clef === 'bass';

  return {
    title: String(spec.title ?? '').trim(),
    keyFifths: FIFTHS_BY_KEY[String(spec.key ?? 'C')] ?? 0,
    timeBeats: beats,
    timeBeatType: beatType,
    phraseLengthMeasures,
    phraseCount,
    measureCount,
    clefSign: clefIsBass ? 'F' : 'G',
    clefLine: clefIsBass ? 4 : 2
  };
}

function createEmptyMeasures(measureCount: number): MeasureNote[][] {
  return Array.from({ length: measureCount }, () => []);
}

function getMeasureIndex(event: MelodyEvent, measureCount: number): number {
  return Math.max(0, Math.min(measureCount - 1, event.measure - 1));
}

function getNoteheadColor(
  eventIndex: number,
  options?: ProjectionRenderOptions
): string | undefined {
  const isHighlighted = options?.highlightedMelodyIndex === eventIndex;

  if (isHighlighted) {
    return options?.highlightColor ?? '#ff2da6';
  }

  return options?.noteColorsByIndex?.[eventIndex];
}

function melodyEventToMeasureNote(
  event: MelodyEvent,
  eventIndex: number,
  options?: ProjectionRenderOptions
): MeasureNote {
  return {
    ...pitchToMusicXml(event.pitch),
    ...durationToMusicXml(event.duration),
    onset: event.onsetBeat ?? event.beat,
    noteheadColor: getNoteheadColor(eventIndex, options)
  };
}

function groupMelodyEventsByMeasure(
  melodyEvents: MelodyEvent[],
  measureCount: number,
  options?: ProjectionRenderOptions
): MeasureNote[][] {
  const notesByMeasure = createEmptyMeasures(measureCount);

  for (let eventIndex = 0; eventIndex < melodyEvents.length; eventIndex += 1) {
    const event = melodyEvents[eventIndex];
    const measureIndex = getMeasureIndex(event, measureCount);

    notesByMeasure[measureIndex].push(
      melodyEventToMeasureNote(event, eventIndex, options)
    );
  }

  return notesByMeasure;
}

function isContiguousEighthPair(
  current: MeasureNote,
  next: MeasureNote
): boolean {
  if (current.type !== 'eighth' || next.type !== 'eighth') {
    return false;
  }

  return Math.abs((next.onset ?? 0) - (current.onset ?? 0) - 0.5) < 0.001;
}

function applyBeamGroup(
  measureNotes: MeasureNote[],
  groupStart: number,
  groupEnd: number
): void {
  if (groupEnd === groupStart) {
    return;
  }

  measureNotes[groupStart].beam = 'begin';

  for (let index = groupStart + 1; index < groupEnd; index += 1) {
    measureNotes[index].beam = 'continue';
  }

  measureNotes[groupEnd].beam = 'end';
}

function applyEighthNoteBeamsToMeasure(measureNotes: MeasureNote[]): void {
  measureNotes.sort((a, b) => a.onset - b.onset);

  let index = 0;

  while (index < measureNotes.length) {
    const start = index;

    if (measureNotes[start].type !== 'eighth' || measureNotes[start].onset <= 0) {
      index += 1;
      continue;
    }

    let end = start;

    while (end + 1 < measureNotes.length) {
      const current = measureNotes[end];
      const next = measureNotes[end + 1];

      if (!isContiguousEighthPair(current, next)) {
        break;
      }

      end += 1;
    }

    if (end > start) {
      for (let groupStart = start; groupStart <= end; groupStart += 4) {
        const groupEnd = Math.min(end, groupStart + 3);
        applyBeamGroup(measureNotes, groupStart, groupEnd);
      }
    }

    index = Math.max(index + 1, end + 1);
  }
}

function applyEighthNoteBeams(notesByMeasure: MeasureNote[][]): void {
  for (const measureNotes of notesByMeasure) {
    applyEighthNoteBeamsToMeasure(measureNotes);
  }
}

function createPaddingNote(duration: 1 | 2): MeasureNote {
  return {
    step: 'C',
    alter: 0,
    octave: 4,
    duration,
    type: duration === 2 ? 'quarter' : 'eighth',
    onset: 0
  };
}

function padMeasureToDivisions(
  measureNotes: MeasureNote[],
  measureDivisions: number
): void {
  let used = measureNotes.reduce((sum, note) => sum + note.duration, 0);

  while (used < measureDivisions) {
    const remaining = measureDivisions - used;

    if (remaining >= 2) {
      measureNotes.push(createPaddingNote(2));
      used += 2;
    } else {
      measureNotes.push(createPaddingNote(1));
      used += 1;
    }
  }
}

function padMeasuresToFullLength(
  notesByMeasure: MeasureNote[][],
  measureDivisions: number
): void {
  for (const measureNotes of notesByMeasure) {
    padMeasureToDivisions(measureNotes, measureDivisions);
  }
}

function getPhraseBoundaryMeasures(spec: ParsedSpec): number[] {
  const finalPhraseBoundary = spec.phraseCount * spec.phraseLengthMeasures;

  return finalPhraseBoundary <= spec.measureCount ? [finalPhraseBoundary] : [];
}

function stripInternalOnsets(notesByMeasure: MeasureNote[][]): MusicXmlNote[][] {
  return notesByMeasure.map((measureNotes) =>
    measureNotes.map(({ onset, ...note }) => note)
  );
}

function buildMusicXmlFromSpecAndMelody(
  specInput: Record<string, unknown>,
  melodyEvents: MelodyEvent[],
  options?: ProjectionRenderOptions
): string {
  const spec = parseSpec(specInput);

  const notesByMeasure = groupMelodyEventsByMeasure(
    melodyEvents,
    spec.measureCount,
    options
  );

  applyEighthNoteBeams(notesByMeasure);

  padMeasuresToFullLength(notesByMeasure, spec.timeBeats * 2);

  return buildSinglePartMusicXml({
    title: spec.title,
    keyFifths: spec.keyFifths,
    timeBeats: spec.timeBeats,
    timeBeatType: spec.timeBeatType,
    clefSign: spec.clefSign,
    clefLine: spec.clefLine,
    divisions: 2,
    measures: stripInternalOnsets(notesByMeasure),
    phraseBoundaryMeasures: getPhraseBoundaryMeasures(spec)
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

      return (
        node.kind === 'leaf' &&
        typeof data.pitch === 'string' &&
        typeof data.measure === 'number'
      );
    })
    .map((node) => node.data as MelodyEvent)
    .sort((a, b) => a.measure - b.measure || a.beat - b.beat);

  return buildMusicXmlFromSpecAndMelody(spec, melodyEvents);
}
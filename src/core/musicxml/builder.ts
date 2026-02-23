export interface MusicXmlNote {
  step: string;
  alter: number;
  octave: number;
  duration: number;
  type: 'eighth' | 'quarter' | 'half' | 'whole';
  beam?: 'begin' | 'continue' | 'end';
  lyric?: string;
}

export interface MusicXmlBuildInput {
  title: string;
  composer?: string;
  keyFifths: number;
  timeBeats: number;
  timeBeatType: number;
  clefSign: 'G' | 'F';
  clefLine: 2 | 4;
  divisions: number;
  measures: MusicXmlNote[][];
  phraseBoundaryMeasures?: number[];
}

function noteXml(note: MusicXmlNote): string {
  const alterXml = note.alter !== 0 ? `<alter>${note.alter}</alter>` : '';
  const beamXml = note.beam ? `<beam number="1">${note.beam}</beam>` : '';
  const lyricXml = note.lyric ? `<lyric><text>${note.lyric}</text></lyric>` : '';
  return [
    '<note>',
    '<pitch>',
    `<step>${note.step}</step>`,
    alterXml,
    `<octave>${note.octave}</octave>`,
    '</pitch>',
    `<duration>${note.duration}</duration>`,
    `<type>${note.type}</type>`,
    beamXml,
    lyricXml,
    '</note>'
  ]
    .filter(Boolean)
    .join('');
}

export function buildSinglePartMusicXml(input: MusicXmlBuildInput): string {
  const phraseBoundaries = new Set((input.phraseBoundaryMeasures ?? []).filter((n) => Number.isFinite(n)));
  const measureXml = input.measures
    .map((notes, index) => {
      const attrs =
        index === 0
          ? [
              '<attributes>',
              `<divisions>${input.divisions}</divisions>`,
              '<key>',
              `<fifths>${input.keyFifths}</fifths>`,
              '</key>',
              '<time>',
              `<beats>${input.timeBeats}</beats>`,
              `<beat-type>${input.timeBeatType}</beat-type>`,
              '</time>',
              '<clef>',
              `<sign>${input.clefSign}</sign>`,
              `<line>${input.clefLine}</line>`,
              '</clef>',
              '</attributes>'
            ].join('')
          : '';

      const notesXml = notes.map((note) => noteXml(note)).join('');
      const measureNumber = index + 1;
      const boundaryXml = phraseBoundaries.has(measureNumber)
        ? '<barline location=\"right\"><bar-style>light-heavy</bar-style></barline>'
        : '';
      return `<measure number=\"${measureNumber}\">${attrs}${notesXml}${boundaryXml}</measure>`;
    })
    .join('');

  const identificationXml = input.composer
    ? ['<identification>', `<creator type="composer">${input.composer}</creator>`, '</identification>'].join('')
    : '';

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="3.1">',
    '<work>',
    `<work-title>${input.title}</work-title>`,
    '</work>',
    identificationXml,
    '<part-list>',
    '<score-part id="P1"><part-name>Voice</part-name></score-part>',
    '</part-list>',
    `<part id="P1">${measureXml}</part>`,
    '</score-partwise>'
  ].join('');
}

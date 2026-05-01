import type { MelodyEvent } from "@/SightLine/domain/music";

export type ExpectedNote = {
  index: number;
  id: string;
  writtenMidi: number;
  writtenNoteName?: string;
  durationBeats: number;
};

export type ExpectedAssessment = {
  notes: ExpectedNote[];
};

type BuildExpectedAssessmentInput = {
  melody: MelodyEvent[];
};

/**
 * Converts the generated melody into assessment-ready expected notes.
 *
 * This file owns only the expected note model.
 *
 * Intervals belong to:
 * intervals/buildExpectedIntervals.ts
 *
 * Rhythm belongs to:
 * rhythm/buildExpectedRhythm.ts
 */
export function buildExpectedAssessment(
  input: BuildExpectedAssessmentInput,
): ExpectedAssessment {
  const renderableAttacks = getRenderableAttacks(input.melody);
  const notes = buildExpectedNotes(renderableAttacks);

  return {
    notes,
  };
}

function getRenderableAttacks(melody: MelodyEvent[]): MelodyEvent[] {
  return melody.filter((event) => event.isAttack !== false);
}

function buildExpectedNotes(melody: MelodyEvent[]): ExpectedNote[] {
  return melody.map((event, index) => ({
    index,
    id: getExpectedNoteId(event, index),
    writtenMidi: getWrittenMidi(event),
    writtenNoteName: getWrittenNoteName(event),
    durationBeats: getDurationBeats(event),
  }));
}

function getExpectedNoteId(event: MelodyEvent, index: number): string {
  const eventWithId = event as MelodyEvent & {
    id?: string | number;
  };

  if (eventWithId.id !== undefined && eventWithId.id !== null) {
    return String(eventWithId.id);
  }

  return `expected-${index + 1}`;
}

function getWrittenMidi(event: MelodyEvent): number {
  const eventWithMidi = event as MelodyEvent & {
    midi?: number;
    writtenMidi?: number;
  };

  const midi = eventWithMidi.writtenMidi ?? eventWithMidi.midi;

  if (typeof midi !== "number" || !Number.isFinite(midi)) {
    throw new Error(
      "Expected melody event is missing a valid MIDI value for assessment.",
    );
  }

  return midi;
}

function getWrittenNoteName(event: MelodyEvent): string | undefined {
  const eventWithNoteName = event as MelodyEvent & {
    noteName?: string;
    writtenNoteName?: string;
  };

  return eventWithNoteName.writtenNoteName ?? eventWithNoteName.noteName;
}

function getDurationBeats(event: MelodyEvent): number {
  const eventWithDuration = event as MelodyEvent & {
    durationBeats?: number;
    beats?: number;
    duration?: string;
    noteType?: string;
  };

  const explicitBeats =
    eventWithDuration.durationBeats ?? eventWithDuration.beats;

  if (typeof explicitBeats === "number" && Number.isFinite(explicitBeats)) {
    return explicitBeats;
  }

  const durationName = eventWithDuration.duration ?? eventWithDuration.noteType;
  const beatsFromDurationName = getBeatsFromDurationName(durationName);

  if (beatsFromDurationName !== null) {
    return beatsFromDurationName;
  }

  return 1;
}

function getBeatsFromDurationName(durationName?: string): number | null {
  if (!durationName) {
    return null;
  }

  const normalizedDurationName = durationName.toLowerCase();

  switch (normalizedDurationName) {
    case "whole":
      return 4;

    case "half":
      return 2;

    case "quarter":
      return 1;

    case "eighth":
      return 0.5;

    case "sixteenth":
      return 0.25;

    default:
      return null;
  }
}
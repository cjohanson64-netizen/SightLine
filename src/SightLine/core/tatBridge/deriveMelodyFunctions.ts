import type { MelodyEvent } from "@/SightLine/domain/music";

export type MelodyFunction =
  | "climax"
  | "cadence"
  | "structural"
  | "opening"
  | "release"
  | "connective_nht";

type IndexedMelodyEvent = {
  index: number;
  event: MelodyEvent;
};

function groupByPhrase(melody: MelodyEvent[]): Map<number, IndexedMelodyEvent[]> {
  const byPhrase = new Map<number, IndexedMelodyEvent[]>();

  melody.forEach((event, index) => {
    const phraseIndex = event.phraseIndex ?? 0;
    const bucket = byPhrase.get(phraseIndex) ?? [];
    bucket.push({ index, event });
    byPhrase.set(phraseIndex, bucket);
  });

  return byPhrase;
}

function hasFunctionTag(
  event: MelodyEvent,
  tag: "structural" | "connective_nht" | "climax" | "cadence",
): boolean {
  return event.functionTags?.includes(tag) === true;
}

function isConnectiveNht(event: MelodyEvent): boolean {
  if (hasFunctionTag(event, "connective_nht")) {
    return true;
  }

  if (event.nonHarmonicTone !== true) {
    return false;
  }

  const reason = event.reason.toLowerCase();
  return (
    reason.includes("connective") ||
    reason.includes("passing") ||
    reason.includes("neighbor") ||
    reason.includes("smoothing")
  );
}

function isStructural(event: MelodyEvent): boolean {
  if (hasFunctionTag(event, "structural")) {
    return true;
  }

  if (isConnectiveNht(event)) {
    return false;
  }

  // v1 rule:
  // anything not clearly connective filler counts as structural.
  return true;
}

function findClimaxIndex(events: IndexedMelodyEvent[]): number | null {
  const tagged = events.find(({ event }) => hasFunctionTag(event, "climax"));
  if (tagged) {
    return tagged.index;
  }

  // v1 fallback:
  // highest pitch in the phrase, preferring earliest occurrence.
  let best: IndexedMelodyEvent | null = null;

  for (const item of events) {
    if (!best || item.event.midi > best.event.midi) {
      best = item;
    }
  }

  return best?.index ?? null;
}

function findReleaseIndices(
  phraseEvents: IndexedMelodyEvent[],
  climaxLocalIndex: number,
): number[] {
  const climaxEvent = phraseEvents[climaxLocalIndex]?.event;
  if (!climaxEvent) {
    return [];
  }

  const climaxMidi = climaxEvent.midi;
  const cadenceStartIndex =
    phraseEvents.length >= 2 ? phraseEvents[phraseEvents.length - 2]?.index : null;
  const cadenceEndIndex =
    phraseEvents.length >= 1 ? phraseEvents[phraseEvents.length - 1]?.index : null;

  return phraseEvents
    .slice(climaxLocalIndex + 1, climaxLocalIndex + 3)
    .filter((item) => {
      if (item.event.midi > climaxMidi) {
        return false;
      }

      // Let the cadence begin the release, but do not automatically carry
      // release tagging across the full cadence pair.
      if (cadenceEndIndex !== null && item.index === cadenceEndIndex) {
        return false;
      }

      if (cadenceStartIndex !== null && item.index >= cadenceStartIndex) {
        return item.index === cadenceStartIndex;
      }

      return true;
    })
    .map((item) => item.index);
}

export function deriveMelodyFunctions(
  melody: MelodyEvent[],
): Map<number, Set<MelodyFunction>> {
  const functionsByIndex = new Map<number, Set<MelodyFunction>>();
  const byPhrase = groupByPhrase(melody);

  const addFunction = (index: number, fn: MelodyFunction): void => {
    const bucket = functionsByIndex.get(index) ?? new Set<MelodyFunction>();
    bucket.add(fn);
    functionsByIndex.set(index, bucket);
  };

  melody.forEach((event, index) => {
    if (isConnectiveNht(event)) {
      addFunction(index, "connective_nht");
    }

    if (isStructural(event)) {
      addFunction(index, "structural");
    }
  });

  for (const phraseEvents of byPhrase.values()) {
    if (phraseEvents.length === 0) {
      continue;
    }

    // opening = first structural note in phrase, else first note
    const opening =
      phraseEvents.find(({ event }) => isStructural(event)) ?? phraseEvents[0];
    addFunction(opening.index, "opening");

    // cadence = final 2 notes of phrase
    const cadenceSlice = phraseEvents.slice(-2);
    for (const item of cadenceSlice) {
      addFunction(item.index, "cadence");
    }

    // climax = tagged climax if available, else highest note
    const climaxIndex = findClimaxIndex(phraseEvents);
    if (climaxIndex !== null) {
      addFunction(climaxIndex, "climax");

      // release = first 2 notes after climax in same phrase
      const localClimaxPos = phraseEvents.findIndex(
        (item) => item.index === climaxIndex,
      );
      if (localClimaxPos !== -1) {
        const releaseIndices = findReleaseIndices(phraseEvents, localClimaxPos);
        for (const index of releaseIndices) {
          addFunction(index, "release");
        }
      }
    }
  }

  return functionsByIndex;
}

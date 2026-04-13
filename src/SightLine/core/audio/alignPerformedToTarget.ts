import { midiToPitch, pitchOctaveForMidi, prefersFlatsForKey } from '@/SightLine/core/midi';
import type { MelodyEvent } from '@/SightLine/domain/music';
import type { PerformedAlignment, SegmentedPerformedNote } from './types';

export function alignPerformedToTarget(
  segmentedNotes: SegmentedPerformedNote[],
  targetMelody: MelodyEvent[]
): PerformedAlignment {
  if (segmentedNotes.length === 0) {
    return {
      alignedMelody: [],
      targetIndices: [],
    };
  }

  const activeTarget = targetMelody.filter((event) => event.isAttack !== false);
  const referenceTarget = activeTarget[0] ?? null;
  const [referenceKey = 'C', referenceModeRaw = 'major'] = String(
    referenceTarget?.keyId ?? 'C-major'
  ).split('-');
  const preferFlats = prefersFlatsForKey(
    referenceKey,
    referenceModeRaw === 'minor' ? 'minor' : 'major'
  );

  const performedWindows = segmentedNotes.filter((note) => note.midi !== null);
  const targetIndices = performedWindows.map((note) => note.targetIndex);

  const alignedMelody = performedWindows.map((note) => {
    const target = activeTarget[note.targetIndex] ?? referenceTarget;
    const [targetKey = referenceKey, targetModeRaw = referenceModeRaw] = String(
      target?.keyId ?? `${referenceKey}-${referenceModeRaw}`
    ).split('-');
    const pitch = midiToPitch(note.midi as number, {
      preferFlats,
      key: targetKey,
      mode: targetModeRaw === 'minor' ? 'minor' : 'major',
    });

    return {
      pitch,
      octave: pitchOctaveForMidi(note.midi as number, {
        preferFlats,
        key: targetKey,
        mode: targetModeRaw === 'minor' ? 'minor' : 'major',
      }),
      midi: note.midi as number,
      duration: target?.duration ?? 'quarter',
      measure: target?.measure ?? 1,
      beat: target?.beat ?? note.targetIndex + 1,
      phraseIndex: target?.phraseIndex ?? 0,
      role: target?.role ?? 'FallbackTonic',
      reason: 'mic_assessment_detected_note',
      chordId: target?.chordId ?? `assessment-chord-${note.targetIndex}`,
      keyId: target?.keyId ?? 'C-major',
      nonHarmonicTone: target?.nonHarmonicTone ?? false,
      onsetBeat: target?.onsetBeat ?? target?.beat ?? note.targetIndex + 1,
      durationBeats: target?.durationBeats ?? 1,
      isAttack: true,
    } satisfies MelodyEvent;
  });

  return {
    alignedMelody,
    targetIndices,
  };
}

import type { Graph } from '@tat/runtime/graph';
import type { MelodyEvent } from '@/SightLine/domain/music';
import { buildMelodyGraph } from './buildTargetMelodyGraph';

export function buildPerformedMelodyGraph(melody: MelodyEvent[]): Graph {
  return buildMelodyGraph(melody, {
    collectionId: 'performed-melody-events',
    collectionLabel: 'Performed Melody',
    noteIdPrefix: 'performed-note',
    includeFunctions: false,
  });
}

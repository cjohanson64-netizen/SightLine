export function frequencyToMidiFloat(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

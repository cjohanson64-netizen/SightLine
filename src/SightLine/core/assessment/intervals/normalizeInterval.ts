/**
 * Normalizes a sung interval into the nearest octave-equivalent interval.
 *
 * This protects the assessment from octave displacement.
 *
 * Example:
 * +14 semitones becomes +2
 * -10 semitones becomes +2
 * +13 semitones becomes +1
 *
 * This is especially useful for middle school choir settings where students
 * may sing in different octaves or where pitch detection briefly jumps octaves.
 */
export function normalizeInterval(intervalSemitones: number): number {
  if (!Number.isFinite(intervalSemitones)) {
    throw new Error("normalizeInterval requires a finite interval value.");
  }

  let normalizedInterval = intervalSemitones;

  while (normalizedInterval > 6) {
    normalizedInterval -= 12;
  }

  while (normalizedInterval < -6) {
    normalizedInterval += 12;
  }

  return normalizedInterval;
}
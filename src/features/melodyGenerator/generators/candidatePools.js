// Candidate-pool builders for a future tetrachord-aware melody generator.
// This module is intentionally framework-agnostic and not yet wired into the
// live generator flow.

function isFinitePitch(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function asPitchArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter(isFinitePitch);
}

export function sortAscending(candidates) {
  return [...asPitchArray(candidates)].sort((a, b) => a - b);
}

export function dedupeCandidates(candidates) {
  const result = [];
  const seen = new Set();

  for (const candidate of asPitchArray(candidates)) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    result.push(candidate);
  }

  return result;
}

export function clampCandidatesToRange(candidates, rangeMin, rangeMax) {
  if (!isFinitePitch(rangeMin) || !isFinitePitch(rangeMax)) {
    return dedupeCandidates(candidates);
  }

  return dedupeCandidates(candidates).filter(
    (candidate) => candidate >= rangeMin && candidate <= rangeMax,
  );
}

export function getNearestChordToneAbove(currentPitch, harmonyChordTones) {
  if (!isFinitePitch(currentPitch)) {
    return undefined;
  }

  return sortAscending(harmonyChordTones).find(
    (candidate) => candidate > currentPitch,
  );
}

export function getNearestChordToneBelow(currentPitch, harmonyChordTones) {
  if (!isFinitePitch(currentPitch)) {
    return undefined;
  }

  const descending = sortAscending(harmonyChordTones).reverse();
  return descending.find((candidate) => candidate < currentPitch);
}

export function getNeighborToneCandidates(currentPitch, scalePitches) {
  if (!isFinitePitch(currentPitch)) {
    return [];
  }

  const sorted = sortAscending(scalePitches);
  const below = [...sorted].reverse().find((candidate) => candidate < currentPitch);
  const above = sorted.find((candidate) => candidate > currentPitch);

  return dedupeCandidates([below, above]);
}

export function getPassingToneCandidates(
  currentPitch,
  nextStructuralPitch,
  scalePitches,
) {
  if (!isFinitePitch(currentPitch) || !isFinitePitch(nextStructuralPitch)) {
    return [];
  }

  const low = Math.min(currentPitch, nextStructuralPitch);
  const high = Math.max(currentPitch, nextStructuralPitch);

  return sortAscending(scalePitches).filter(
    (candidate) => candidate > low && candidate < high,
  );
}

function isPitchInChord(candidate, harmonyChordTones) {
  return asPitchArray(harmonyChordTones).includes(candidate);
}

function isPitchInRange(candidate, rangeMin, rangeMax) {
  return (
    isFinitePitch(candidate) &&
    isFinitePitch(rangeMin) &&
    isFinitePitch(rangeMax) &&
    candidate >= rangeMin &&
    candidate <= rangeMax
  );
}

function withFallback(candidates, ctx) {
  const inRangeCandidates = clampCandidatesToRange(
    candidates,
    ctx.rangeMin,
    ctx.rangeMax,
  );

  if (inRangeCandidates.length > 0) {
    return sortAscending(inRangeCandidates);
  }

  if (isPitchInRange(ctx.currentPitch, ctx.rangeMin, ctx.rangeMax)) {
    return [ctx.currentPitch];
  }

  const backupPool = clampCandidatesToRange(
    [...asPitchArray(ctx.harmonyChordTones), ...asPitchArray(ctx.scalePitches)],
    ctx.rangeMin,
    ctx.rangeMax,
  );

  return sortAscending(backupPool);
}

export function buildStructuralCandidatePool(ctx = {}) {
  const nearestBelow = getNearestChordToneBelow(
    ctx.currentPitch,
    ctx.harmonyChordTones,
  );
  const nearestAbove = getNearestChordToneAbove(
    ctx.currentPitch,
    ctx.harmonyChordTones,
  );

  const candidates = [];

  if (isPitchInChord(ctx.currentPitch, ctx.harmonyChordTones)) {
    candidates.push(ctx.currentPitch);
  }

  candidates.push(nearestBelow, nearestAbove);

  if (isPitchInRange(ctx.nextStructuralPitch, ctx.rangeMin, ctx.rangeMax)) {
    candidates.push(ctx.nextStructuralPitch);
  }

  if (isPitchInRange(ctx.targetPitch, ctx.rangeMin, ctx.rangeMax)) {
    candidates.push(ctx.targetPitch);
  }

  // Cadential moments should stay especially stable, so we re-add the nearest
  // chord tones here before dedupe. This does not change the final set in v1,
  // but documents the intended emphasis and keeps the cadence logic explicit.
  if (ctx.isCadenceEvent) {
    candidates.push(nearestBelow, nearestAbove);
  }

  return withFallback(candidates, ctx);
}

export function buildDecorativeCandidatePool(ctx = {}) {
  const candidates = [];
  const neighbors = getNeighborToneCandidates(ctx.currentPitch, ctx.scalePitches);
  const passingTones = getPassingToneCandidates(
    ctx.currentPitch,
    ctx.nextStructuralPitch,
    ctx.scalePitches,
  );

  if (isFinitePitch(ctx.currentPitch)) {
    candidates.push(ctx.currentPitch);
  }

  candidates.push(...neighbors);
  candidates.push(...passingTones);

  if (
    (ctx.metricStrength === "weak" || ctx.metricStrength === "off") &&
    isPitchInRange(ctx.nextStructuralPitch, ctx.rangeMin, ctx.rangeMax)
  ) {
    candidates.push(ctx.nextStructuralPitch);
  }

  return withFallback(candidates, ctx);
}

export function buildCandidatePool(ctx = {}) {
  if (ctx.isStructural === true) {
    return buildStructuralCandidatePool(ctx);
  }
  return buildDecorativeCandidatePool(ctx);
}

/*
Dev-only usage examples:

Structural example:
buildStructuralCandidatePool({
  currentPitch: 64,
  nextStructuralPitch: 67,
  targetPitch: 65,
  harmonyType: "tonic",
  harmonyChordTones: [60, 64, 67, 72],
  scalePitches: [60, 62, 64, 65, 67, 69, 71, 72],
  isStructural: true,
  isCadenceEvent: false,
  rangeMin: 60,
  rangeMax: 72
});
// Expected kind of result: [60, 64, 65, 67]

Decorative example:
buildDecorativeCandidatePool({
  currentPitch: 64,
  nextStructuralPitch: 67,
  harmonyType: "dominant",
  harmonyChordTones: [62, 65, 69],
  scalePitches: [60, 62, 64, 65, 67, 69, 71, 72],
  metricStrength: "weak",
  isStructural: false,
  rangeMin: 60,
  rangeMax: 72
});
// Expected kind of result: [62, 64, 65, 67]
*/

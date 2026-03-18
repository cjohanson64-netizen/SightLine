// Weighted pitch scoring for a future melody-generation refactor.
// This module is intentionally standalone and not yet connected to the
// active app generator flow.

export const STRUCTURAL_WEIGHTS = {
  resolution: 4,
  harmonyFit: 6,
  contour: 4,
  targetFit: 5,
  metricFit: 5,
  repetitionPenalty: -3,
  leapPenalty: -2,
};

export const DECORATIVE_WEIGHTS = {
  resolution: 6,
  harmonyFit: 2,
  contour: 3,
  targetFit: 3,
  metricFit: 2,
  repetitionPenalty: -5,
  leapPenalty: -4,
};

function isFinitePitch(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function toPitchArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter(isFinitePitch);
}

function getActiveWeights(ctx = {}) {
  const preset = ctx.isStructural ? STRUCTURAL_WEIGHTS : DECORATIVE_WEIGHTS;
  return {
    ...preset,
    ...(ctx.weights ?? {}),
  };
}

function isChordTone(candidatePitch, harmonyChordTones) {
  return toPitchArray(harmonyChordTones).includes(candidatePitch);
}

function getInterval(fromPitch, toPitch) {
  if (!isFinitePitch(fromPitch) || !isFinitePitch(toPitch)) {
    return null;
  }
  return Math.abs(toPitch - fromPitch);
}

// Resolution rewards stepwise or gently-directed motion and also rewards motion
// that closes distance to the next structural destination when available.
function getResolutionSeverity(candidatePitch, ctx = {}) {
  let severity = 0;
  const interval = getInterval(ctx.currentPitch, candidatePitch);

  if (interval === null) {
    return severity;
  }

  if (interval === 0) severity += 0.2;
  else if (interval === 1) severity += 1.4;
  else if (interval === 2) severity += 1.1;
  else if (interval <= 4) severity += 0.5;
  else if (interval <= 7) severity -= 0.35;
  else severity -= 0.9;

  if (isFinitePitch(ctx.nextStructuralPitch) && isFinitePitch(ctx.currentPitch)) {
    const currentDistance = Math.abs(ctx.nextStructuralPitch - ctx.currentPitch);
    const candidateDistance = Math.abs(ctx.nextStructuralPitch - candidatePitch);
    if (candidateDistance < currentDistance) severity += 0.9;
    else if (candidateDistance > currentDistance) severity -= 0.6;
  }

  return severity;
}

// Harmony fit evaluates whether the pitch supports or colors the current
// harmony, shaped by metric position and explicit non-chord-tone allowance.
function getHarmonyFitSeverity(candidatePitch, ctx = {}) {
  const chordTones = toPitchArray(ctx.harmonyChordTones);
  if (chordTones.length === 0) {
    return 0;
  }

  const chordTone = isChordTone(candidatePitch, chordTones);
  const metric = ctx.metricStrength ?? "medium";
  const allowNonChordTones = ctx.allowNonChordTones === true;

  if (metric === "strong") {
    return chordTone ? 1.3 : -1.1;
  }
  if (metric === "medium") {
    return chordTone ? 0.9 : -0.45;
  }
  if (metric === "weak" || metric === "off") {
    if (chordTone) {
      return allowNonChordTones ? 0.1 : 0.45;
    }
    return allowNonChordTones ? 0.35 : -0.2;
  }

  return chordTone ? 0.5 : 0;
}

// Contour bias nudges the line in a functional direction without making it
// deterministic.
function getContourSeverity(candidatePitch, ctx = {}) {
  if (!isFinitePitch(ctx.currentPitch)) {
    return 0;
  }

  const delta = candidatePitch - ctx.currentPitch;
  const direction = delta === 0 ? 0 : delta > 0 ? 1 : -1;

  if (ctx.harmonyType === "dominant") {
    if (direction > 0) return 0.9;
    if (direction < 0) return -0.6;
    return 0.1;
  }

  if (ctx.harmonyType === "subdominant") {
    if (direction < 0) return 0.9;
    if (direction > 0) return -0.6;
    return 0.1;
  }

  if (ctx.harmonyType === "tonic") {
    const interval = Math.abs(delta);
    if (interval === 0) return 0.3;
    if (interval <= 2) return 0.75;
    if (interval <= 4) return 0.2;
    return -0.45;
  }

  return 0;
}

// Target fit rewards pitches that move toward the explicit target note.
function getTargetFitSeverity(candidatePitch, ctx = {}) {
  if (!isFinitePitch(ctx.targetPitch) || !isFinitePitch(ctx.currentPitch)) {
    return 0;
  }

  const currentDistance = Math.abs(ctx.targetPitch - ctx.currentPitch);
  const candidateDistance = Math.abs(ctx.targetPitch - candidatePitch);

  if (candidateDistance < currentDistance) return 1;
  if (candidateDistance > currentDistance) return -0.8;
  return 0;
}

// Metric fit rewards stability on structural/strong events and allows more
// color on weak positions.
function getMetricFitSeverity(candidatePitch, ctx = {}) {
  const chordTone = isChordTone(candidatePitch, ctx.harmonyChordTones);
  const metric = ctx.metricStrength ?? "medium";

  if (ctx.isStructural && metric === "strong") {
    return chordTone ? 1.4 : -1.2;
  }
  if (ctx.isStructural && metric === "medium") {
    return chordTone ? 0.85 : -0.5;
  }
  if (metric === "weak" || metric === "off") {
    if (ctx.allowNonChordTones && !chordTone) return 0.45;
    if (chordTone) return 0.1;
    return -0.15;
  }
  if (metric === "strong") {
    return chordTone ? 0.75 : -0.55;
  }
  return chordTone ? 0.35 : 0;
}

// Repetition severity grows if the candidate repeats the immediate previous
// pitch or matches several recent notes.
function getRepetitionPenaltySeverity(candidatePitch, ctx = {}) {
  let severity = 0;

  if (isFinitePitch(ctx.previousPitch) && candidatePitch === ctx.previousPitch) {
    severity += 1;
  }

  const recentMatches = toPitchArray(ctx.recentPitches).filter(
    (pitch) => pitch === candidatePitch,
  ).length;
  severity += Math.min(1.5, recentMatches * 0.35);

  return severity;
}

// Leap severity penalizes bigger motions, but a climax approach can absorb a
// little more leap energy.
function getLeapPenaltySeverity(candidatePitch, ctx = {}) {
  const interval = getInterval(ctx.currentPitch, candidatePitch);
  if (interval === null) {
    return 0;
  }

  let severity = 0;
  if (interval <= 2) severity = 0;
  else if (interval <= 4) severity = 0.35;
  else if (interval <= 7) severity = 0.8;
  else if (interval <= 10) severity = 1.25;
  else severity = 1.8;

  if (ctx.isClimaxApproach) {
    severity *= 0.7;
  }

  return severity;
}

function applyWeightedBreakdown(candidatePitch, ctx = {}) {
  const weights = getActiveWeights(ctx);

  const breakdown = {
    resolution: getResolutionSeverity(candidatePitch, ctx) * weights.resolution,
    harmonyFit: getHarmonyFitSeverity(candidatePitch, ctx) * weights.harmonyFit,
    contour: getContourSeverity(candidatePitch, ctx) * weights.contour,
    targetFit: getTargetFitSeverity(candidatePitch, ctx) * weights.targetFit,
    metricFit: getMetricFitSeverity(candidatePitch, ctx) * weights.metricFit,
    repetitionPenalty:
      getRepetitionPenaltySeverity(candidatePitch, ctx) * weights.repetitionPenalty,
    leapPenalty: getLeapPenaltySeverity(candidatePitch, ctx) * weights.leapPenalty,
  };

  return breakdown;
}

export function scoreCandidatePitch(candidatePitch, ctx = {}) {
  const breakdown = applyWeightedBreakdown(candidatePitch, ctx);
  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);

  return {
    candidatePitch,
    total,
    breakdown,
  };
}

export function scoreCandidatePool(candidates, ctx = {}) {
  return toPitchArray(candidates)
    .map((candidatePitch) => scoreCandidatePitch(candidatePitch, ctx))
    .sort((a, b) => b.total - a.total || a.candidatePitch - b.candidatePitch);
}

export function chooseTopCandidate(candidates, ctx = {}) {
  const scored = scoreCandidatePool(candidates, ctx);
  return scored[0] ?? null;
}

export function chooseWeightedTopCandidate(candidates, ctx = {}, topN = 3) {
  const scored = scoreCandidatePool(candidates, ctx);
  if (scored.length === 0) {
    return null;
  }

  const limited = scored.slice(0, Math.max(1, Math.floor(topN) || 1));
  const weighted = limited.map((entry, index) => {
    const shifted = entry.total - limited[limited.length - 1].total;
    const safeWeight = Math.max(0.05, shifted + 1 + (limited.length - index) * 0.02);
    return {
      entry,
      weight: safeWeight,
    };
  });

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.random() * totalWeight;

  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return item.entry;
    }
  }

  return weighted[weighted.length - 1]?.entry ?? null;
}

/*
Dev-only usage example:

const candidates = [62, 64, 65, 67];
const ctx = {
  currentPitch: 64,
  previousPitch: 62,
  recentPitches: [60, 62, 64],
  nextStructuralPitch: 67,
  targetPitch: 67,
  harmonyType: "dominant",
  harmonyChordTones: [62, 65, 69],
  metricStrength: "weak",
  isStructural: false,
  allowNonChordTones: true,
  isClimaxApproach: false,
};

scoreCandidatePool(candidates, ctx);
chooseWeightedTopCandidate(candidates, ctx, 3);
*/

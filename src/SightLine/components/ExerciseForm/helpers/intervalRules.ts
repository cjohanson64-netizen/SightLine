import type { ExerciseSpec } from '@/SightLine/domain/music';

export function hasAllIntervals(
  spec: ExerciseSpec,
  intervals: number[]
): boolean {
  return intervals.every((interval) =>
    spec.illegalIntervalsSemis.includes(interval)
  );
}

export function updateIllegalIntervalsInSpec(
  spec: ExerciseSpec,
  intervals: number[],
  enabled: boolean
): ExerciseSpec {
  const next = enabled
    ? [...spec.illegalIntervalsSemis, ...intervals]
    : spec.illegalIntervalsSemis.filter((value) => !intervals.includes(value));

  return {
    ...spec,
    illegalIntervalsSemis: Array.from(new Set(next)).sort((a, b) => a - b)
  };
}

export function updateIllegalDegreeInSpec(
  spec: ExerciseSpec,
  degree: number,
  enabled: boolean
): ExerciseSpec {
  const next = enabled
    ? [...spec.illegalDegrees, degree]
    : spec.illegalDegrees.filter((value) => value !== degree);

  return {
    ...spec,
    illegalDegrees: Array.from(new Set(next)).sort((a, b) => a - b)
  };
}
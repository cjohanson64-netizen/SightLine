import type { ExerciseSpec, PhraseSpec } from '@/SightLine/domain/music';
import { MAX_PHRASES } from './exerciseForm.constants';
import { allowedLabelsForIndex, normalizePhrases } from './phraseNormalization';

export function updatePhraseInSpec<K extends keyof PhraseSpec>(
  spec: ExerciseSpec,
  index: number,
  field: K,
  value: PhraseSpec[K]
): ExerciseSpec {
  const next = normalizePhrases(spec.phrases).map((phrase, i) => {
    if (i !== index) {
      return phrase;
    }

    const updated = { ...phrase, [field]: value } as PhraseSpec;

    if (i === 0) {
      updated.label = 'A';
      updated.prime = false;
    }

    return updated;
  });

  return {
    ...spec,
    phrases: normalizePhrases(next)
  };
}

export function addPhraseToSpec(spec: ExerciseSpec): ExerciseSpec {
  const current = normalizePhrases(spec.phrases);

  if (current.length >= MAX_PHRASES) {
    return spec;
  }

  const nextIndex = current.length;
  const allowed = allowedLabelsForIndex(current, nextIndex);
  const nextLabel = allowed[allowed.length - 1] ?? 'A';

  const nextPhrase: PhraseSpec = {
    label: nextLabel,
    prime: false,
    cadence: 'authentic'
  };

  return {
    ...spec,
    phrases: normalizePhrases([...current, nextPhrase])
  };
}

export function removePhraseFromSpec(
  spec: ExerciseSpec,
  index: number
): ExerciseSpec {
  const current = normalizePhrases(spec.phrases);

  if (current.length <= 1 || index === 0) {
    return spec;
  }

  const next = current.filter((_, i) => i !== index);

  return {
    ...spec,
    phrases: normalizePhrases(next)
  };
}
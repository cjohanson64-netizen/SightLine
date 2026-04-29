import type { PhraseSpec } from '@/SightLine/domain/music';
import { LABEL_ORDER, MAX_PHRASES } from './exerciseForm.constants';

export function clampLabelToAllowed(
  label: PhraseSpec['label'],
  maxAllowedIndex: number
): PhraseSpec['label'] {
  const currentIndex = LABEL_ORDER.indexOf(label);

  const clampedIndex = Math.max(
    0,
    Math.min(maxAllowedIndex, currentIndex)
  );

  return LABEL_ORDER[clampedIndex];
}

export function normalizePhrases(
  phrases: PhraseSpec[]
): PhraseSpec[] {
  const seed: PhraseSpec[] =
    phrases.length > 0
      ? phrases
      : [
          {
            label: 'A',
            prime: false,
            cadence: 'authentic'
          }
        ];

  const normalized: PhraseSpec[] = [];

  let maxSeenIndex = 0;

  for (let index = 0; index < seed.length; index += 1) {
    const phrase = seed[index];

    if (index === 0) {
      normalized.push({
        ...phrase,
        label: 'A',
        prime: false
      });

      maxSeenIndex = 0;
      continue;
    }

    const maxAllowedIndex = Math.min(
      LABEL_ORDER.length - 1,
      maxSeenIndex + 1
    );

    const label = clampLabelToAllowed(
      phrase.label,
      maxAllowedIndex
    );

    const labelIndex = LABEL_ORDER.indexOf(label);

    maxSeenIndex = Math.max(maxSeenIndex, labelIndex);

    normalized.push({
      ...phrase,
      label
    });
  }

  return normalized.slice(0, MAX_PHRASES);
}

export function allowedLabelsForIndex(
  phrases: PhraseSpec[],
  index: number
): PhraseSpec['label'][] {
  if (index <= 0) {
    return ['A'];
  }

  let maxSeenIndex = 0;

  for (let i = 0; i < index; i += 1) {
    const phrase = phrases[i];

    const labelIndex = LABEL_ORDER.indexOf(
      phrase?.label ?? 'A'
    );

    maxSeenIndex = Math.max(
      maxSeenIndex,
      Math.max(0, labelIndex)
    );
  }

  const maxAllowedIndex = Math.min(
    LABEL_ORDER.length - 1,
    maxSeenIndex + 1
  );

  return LABEL_ORDER.slice(0, maxAllowedIndex + 1);
}
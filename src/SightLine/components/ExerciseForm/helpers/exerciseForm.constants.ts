import type { PhraseSpec } from '@/SightLine/domain/music';

export const MAX_PHRASES = 4;

export const LABEL_ORDER: PhraseSpec['label'][] = ['A', 'B', 'C', 'D'];

export const MAJOR_KEY_OPTIONS = [
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F#',
  'C#',
  'F',
  'Bb',
  'Eb',
  'Ab',
  'Db',
  'Gb',
  'Cb'
] as const;

export const SOLFEGE_DEGREES = [
  { value: 1, label: 'Do' },
  { value: 2, label: 'Re' },
  { value: 3, label: 'Mi' },
  { value: 4, label: 'Fa' },
  { value: 5, label: 'Sol' },
  { value: 6, label: 'La' },
  { value: 7, label: 'Ti' }
] as const;
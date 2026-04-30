export function countMeasures(musicXml: string): number {
  const matches = musicXml.match(/<measure\b/gi);
  return matches?.length ?? 0;
}

export function hasRenderableMusicXml(musicXml: string): boolean {
  if (!musicXml.trim()) {
    return false;
  }

  try {
    const doc = new DOMParser().parseFromString(musicXml, 'application/xml');
    if (doc.querySelector('parsererror')) {
      return false;
    }
    return doc.querySelector('measure note') !== null;
  } catch {
    return false;
  }
}

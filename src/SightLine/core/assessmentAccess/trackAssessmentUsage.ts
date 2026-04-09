const ASSESSMENT_USAGE_STORAGE_KEY = 'sightline_assessment_usage_v1';

type AssessmentUsageLedger = Record<
  string,
  {
    date: string;
    count: number;
  }
>;

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage;
}

function readLedger(): AssessmentUsageLedger {
  const storage = getLocalStorage();
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(ASSESSMENT_USAGE_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw) as AssessmentUsageLedger;
  } catch {
    return {};
  }
}

function writeLedger(ledger: AssessmentUsageLedger): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  storage.setItem(ASSESSMENT_USAGE_STORAGE_KEY, JSON.stringify(ledger));
}

export function getAssessmentUsageDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function readAssessmentUsageCount(identityKey: string, todayKey = getAssessmentUsageDateKey()): number {
  const ledger = readLedger();
  const entry = ledger[identityKey];
  if (!entry || entry.date !== todayKey) {
    return 0;
  }
  return entry.count;
}

export function incrementAssessmentUsageCount(
  identityKey: string,
  todayKey = getAssessmentUsageDateKey()
): number {
  const ledger = readLedger();
  const current = ledger[identityKey];
  const nextCount =
    current && current.date === todayKey
      ? current.count + 1
      : 1;

  ledger[identityKey] = {
    date: todayKey,
    count: nextCount,
  };
  writeLedger(ledger);
  return nextCount;
}


export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_MAX_MS = 5 * 60 * 1000;

/** Exponential backoff with ±30% jitter. attempts = number of failures so far (≥1). */
export function backoffDelay(attempts: number, rand: () => number = Math.random, fast = false): number {
  const base = fast ? 50 : BACKOFF_BASE_MS;
  const max = fast ? 400 : BACKOFF_MAX_MS;
  const raw = Math.min(base * 2 ** Math.max(0, attempts - 1), max);
  return Math.round(raw * (0.7 + rand() * 0.6));
}

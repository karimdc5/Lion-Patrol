import { describe, it, expect } from 'vitest';
import { classify } from '../../src/data/outbox/classify';
import { backoffDelay, BACKOFF_MAX_MS } from '../../src/data/outbox/backoff';
import { BackendError } from '../../src/data/backend/types';

describe('classify', () => {
  const e = (code: string, http?: number, network = false) => new BackendError(code, code, http, network);
  it.each([
    [e('network', undefined, true), 'retry'],
    [new TypeError('Failed to fetch'), 'retry'],
    [e('500', 500), 'retry'],
    [e('429', 429), 'retry'],
    [e('408', 408), 'retry'],
    [e('23505', 409), 'success'],
    [e('PGRST301', 401), 'refresh'],
    [e('42501', 403), 'retry-limited'],
    [e('23503', 409), 'success'], // 409 alone counts as conflict-applied
    [e('23503'), 'retry-limited'],
    [e('22P02', 400), 'dead'],
    [e('23514', 400), 'dead'],
    [e('P0001', 400), 'dead'],
  ])('%s → %s', (err, action) => {
    expect(classify(err).action).toBe(action);
  });
  it('humanizes known trigger messages', () => {
    const v = classify(new BackendError('P0001', 'not_editable', 400));
    expect(v.action === 'dead' && v.reason).toMatch(/already submitted/);
  });
});

describe('backoff', () => {
  it('grows exponentially and caps at 5 minutes with ±30% jitter', () => {
    expect(backoffDelay(1, () => 0.5)).toBe(2000);
    expect(backoffDelay(2, () => 0.5)).toBe(4000);
    expect(backoffDelay(3, () => 0.5)).toBe(8000);
    expect(backoffDelay(30, () => 0.5)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelay(1, () => 0)).toBe(1400);
    expect(backoffDelay(1, () => 1)).toBe(2600);
  });
});

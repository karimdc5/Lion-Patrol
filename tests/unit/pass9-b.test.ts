import { describe, it, expect } from 'vitest';
import { alertCleared } from '../../src/data/ownerAlerts';

describe('pass 9 B9: owner alerts auto-clear when the condition clears', () => {
  const raised = '2026-11-08T07:10:00.000Z'; // 11:10 PM PT
  it('no-show clears once that guard clocks in', () => {
    const a = { kind: 'no_show' as const, member_id: 'm1', created_at: raised };
    expect(alertCleared(a, [])).toBe(false);
    expect(alertCleared(a, [{ id: 't0', member_id: 'm2', clock_in_at: '2026-11-08T07:12:00.000Z' }])).toBe(false);
    expect(alertCleared(a, [{ id: 't1', member_id: 'm1', clock_in_at: '2026-11-08T07:12:00.000Z' }])).toBe(true);
    expect(alertCleared(a, [{ id: 't2', member_id: 'm1', clock_in_at: '2026-11-07T07:12:00.000Z' }])).toBe(false); // last night's shift
  });
  it('long shift clears once clocked out or voided; missed checkpoints stay until dismissed', () => {
    const a = { kind: 'long_shift' as const, member_id: 'm1', created_at: raised, time_entry_id: 't1' };
    expect(alertCleared(a, [{ id: 't1', clock_out_at: null }])).toBe(false);
    expect(alertCleared(a, [{ id: 't1', clock_out_at: raised }])).toBe(true);
    expect(alertCleared(a, [{ id: 't1', clock_out_at: null, voided_at: raised }])).toBe(true);
    expect(alertCleared({ kind: 'missed_checkpoint', member_id: 'm1', created_at: raised }, [{ id: 't1', member_id: 'm1', clock_in_at: raised }])).toBe(false);
  });
});

import { classify, isDuplicateSubmit } from '../../src/data/outbox/classify';
import { BackendError } from '../../src/data/backend/types';

describe('pass 9 B3: an already-submitted DAR is a duplicate, never NEEDS ATTENTION', () => {
  const err = new BackendError('P0001', 'not_editable', 400);
  it('submit of a submitted DAR / incident = success', () => {
    expect(classify(err, { kind: 'update', table: 'patrol_dars', payload: { status: 'submitted', summary: 'x' } })).toEqual({ action: 'success' });
    expect(classify(err, { kind: 'update', table: 'patrol_incidents', payload: { status: 'submitted' } })).toEqual({ action: 'success' });
  });
  it('a real edit after submit is still a dead op with a clear message', () => {
    expect(classify(err, { kind: 'update', table: 'patrol_dars', payload: { summary: 'late edit' } })).toEqual({ action: 'dead', reason: 'This report was already submitted and can no longer be edited.' });
    expect(classify(err)).toMatchObject({ action: 'dead' });
  });
  it('recognises old dead ops by their humanized message', () => {
    expect(isDuplicateSubmit('This report was already submitted and can no longer be edited.', { kind: 'update', table: 'patrol_dars', payload: { status: 'submitted' } })).toBe(true);
    expect(isDuplicateSubmit('This report was already submitted and can no longer be edited.', { kind: 'insert', table: 'patrol_dars', payload: { status: 'submitted' } })).toBe(false);
  });
});

import { phoneError, phoneInput } from '../../src/lib/phone';
import { cardSummary, cardDays } from '../../src/data/owner';

describe('pass 9 B8: phones and guard-card expiry', () => {
  it('phone inputs drop letters; save-time check rejects garbage', () => {
    expect(phoneInput('(253) 555-01a6')).toBe('(253) 555-016');
    expect(phoneError('(253) 555-01a6')).toMatch(/digits only/);
    expect(phoneError('555')).toMatch(/full phone number/);
    expect(phoneError('(206) 555-0139')).toBeNull();
    expect(phoneError('+1 206.555.0139')).toBeNull();
    expect(phoneError('')).toBeNull();
  });
  it('expiry is counted on the Pacific date and summarised from the cards on file only', () => {
    const now = new Date('2026-11-08T06:30:00Z'); // Nov 7, 10:30 PM PT (already Nov 8 in UTC)
    expect(cardDays('2026-11-27', now)).toBe(20);
    expect(cardDays('2026-11-07', now)).toBe(0);
    const cards = ['2026-11-27', '2028-11-03', '2028-02-23', '2027-07-31', '2030-07-30'].map((expires_on) => ({ expires_on }));
    expect(cardSummary(cards, now)).toEqual({ onFile: 5, valid: 5, expired: 0, soon: 1 });
    expect(cardSummary([...cards, { expires_on: '2026-11-03' }], now)).toMatchObject({ expired: 1 });
  });
});

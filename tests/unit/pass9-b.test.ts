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

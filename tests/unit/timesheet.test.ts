import { describe, it, expect } from 'vitest';
import { weekStart, weekByMember, payPeriod, toGustoCsv, splitName, type TimeRow } from '../../src/domain/timesheet';

const mon = weekStart(new Date(2026, 9, 28, 15)); // Wed Oct 28 2026 → Mon Oct 26
const at = (dayOffset: number, hour: number) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + dayOffset, hour).toISOString();
const shift = (id: string, member: string, day: number, start: number, hours: number, extra: Partial<TimeRow> = {}): TimeRow =>
  ({ id, member_id: member, site_id: 's', clock_in_at: at(day, start), clock_out_at: new Date(Date.parse(at(day, start)) + hours * 3600e3).toISOString(), confirmed_at: at(day, start + hours), ...extra });

describe('timesheet', () => {
  it('weeks start on Monday', () => {
    expect(mon.getDay()).toBe(1);
    expect(mon.getDate()).toBe(26);
    expect(weekStart(new Date(2026, 10, 1)).getDate()).toBe(26); // Sunday belongs to the same week
  });
  it('splits regular and overtime at 40 h per workweek; overnight shifts count on the start day', () => {
    const rows = [0, 1, 2, 3, 4].map((d) => shift(`a${d}`, 'm1', d, 21, 9)); // 5 × 9 h overnight = 45 h
    const [w] = weekByMember(rows, mon);
    expect(w!.total).toBe(45);
    expect(w!.regular).toBe(40);
    expect(w!.overtime).toBe(5);
    expect(w!.days).toEqual([9, 9, 9, 9, 9, 0, 0]);
  });
  it('ignores shifts outside the week, counts open and unconfirmed/flagged entries', () => {
    const now = Date.parse(at(2, 23));
    const rows = [shift('x', 'm1', -1, 21, 8), shift('y', 'm1', 1, 9, 8, { confirmed_at: null, timesheet_note: 'forgot to clock in at 8' }), { ...shift('z', 'm1', 2, 21, 0), clock_out_at: null }];
    const [w] = weekByMember(rows, mon, now);
    expect(w!.entries.map((e) => e.id)).toEqual(['y', 'z']);
    expect(w!.open).toBe(1);
    expect(w!.unconfirmed).toBe(1);
    expect(w!.flagged).toBe(1);
    expect(w!.total).toBe(10);
  });
  it('splits compound last names', () => {
    expect(splitName('Maria de la Cruz')).toEqual({ first: 'Maria', last: 'de la Cruz' });
    expect(splitName('Mary Ann Van Dyke')).toEqual({ first: 'Mary Ann', last: 'Van Dyke' });
    expect(splitName('Abdinasir Elmi')).toEqual({ first: 'Abdinasir', last: 'Elmi' });
  });
  it('pay period OT is per workweek, then summed; Gusto CSV', () => {
    const rows = [...[0, 1, 2, 3, 4].map((d) => shift(`a${d}`, 'm1', d, 8, 10)), ...[7, 8].map((d) => shift(`b${d}`, 'm1', d, 8, 10)), shift('c', 'm2', 3, 8, 6)];
    const lines = payPeriod(rows, mon, 2, [{ member_id: 'm1', name: 'Marcus Reed', email: 'm@x.test', gusto_employee_id: 'G-1001' }, { member_id: 'm2', name: 'Cher' }]);
    expect(lines.map((l) => [l.person.name, l.regular, l.overtime])).toEqual([['Cher', 6, 0], ['Marcus Reed', 60, 10]]);
    const csv = toGustoCsv(lines);
    expect(csv.split('\r\n')[0]).toBe('last_name,first_name,gusto_employee_id,regular_hours,overtime_hours,double_overtime_hours');
    expect(csv).toContain('Reed,Marcus,G-1001,60.00,10.00,\r\n');
    expect(csv).toContain(',Cher,,6.00,0.00,\r\n');
    expect(csv).not.toContain('@');
  });
});

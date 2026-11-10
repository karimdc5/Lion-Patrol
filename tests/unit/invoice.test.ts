import { describe, it, expect } from 'vitest';
import { buildInvoiceLines, invoiceTotal, invoiceHours, invoiceNumber, invoiceDates, pacificDate, billableHours } from '../../src/domain/invoice';

const t = (member: string, inIso: string, hours: number, confirmed = true, site = 'S1') => ({
  member_id: member, site_id: site, clock_in_at: inIso, clock_out_at: new Date(Date.parse(inIso) + hours * 3600e3).toISOString(), confirmed_at: confirmed ? inIso : null,
});

describe('invoice', () => {
  it('groups confirmed hours by Pacific shift date and guard; skips other sites/months/open shifts', () => {
    const rows = [
      t('m1', '2026-10-01T04:00:00Z', 8),       // Sep 30, 9 PM PDT → September: not in October
      t('m1', '2026-10-02T04:00:00Z', 8),       // Oct 1 PDT
      t('m1', '2026-10-02T06:00:00Z', 1.5),     // same guard, same Pacific day → merged
      t('m2', '2026-10-02T04:00:00Z', 8),
      t('m2', '2026-10-05T04:00:00Z', 8, false), // unconfirmed → excluded
      t('m1', '2026-10-06T04:00:00Z', 8, true, 'S2'),
      { ...t('m1', '2026-10-07T04:00:00Z', 8), clock_out_at: null },
    ];
    const { lines, excluded } = buildInvoiceLines(rows, { siteId: 'S1', month: '2026-10-01', rate: 38, names: { m1: 'Marcus Reed', m2: 'Tasha Greene' }, onlyConfirmed: true });
    expect(lines).toEqual([
      { date: '2026-10-01', guard: 'Marcus Reed', hours: 9.5, rate: 38, description: 'Security officer services' },
      { date: '2026-10-01', guard: 'Tasha Greene', hours: 8, rate: 38, description: 'Security officer services' },
    ]);
    expect(excluded).toBe(1);
    expect(invoiceHours(lines)).toBe(17.5);
    expect(invoiceTotal(lines)).toBe(665);
    expect(buildInvoiceLines(rows, { siteId: 'S1', month: '2026-10-01', rate: 38, names: {}, onlyConfirmed: false }).lines).toHaveLength(3);
  });
  it('uses guard-confirmed minutes when present', () => {
    expect(billableHours({ ...t('m', '2026-10-02T04:00:00Z', 8), confirmed_minutes: 450 })).toBe(7.5);
  });
  it('numbers, dates and Pacific dates', () => {
    expect(invoiceNumber('LSS-INV', '2026-10-01', 'KSM', 'Kent Station Market')).toBe('LSS-INV-202610-KSM');
    expect(invoiceNumber('', '2026-10-01', null, 'Willow Creek Apts')).toBe('LSS-INV-202610-WILLOW');
    expect(invoiceDates('2026-10-01', 15, new Date(2026, 9, 20))).toEqual({ issue: '2026-11-01', due: '2026-11-16' });
    expect(invoiceDates('2026-09-01', 15, new Date(2026, 9, 20))).toEqual({ issue: '2026-10-20', due: '2026-11-04' });
    expect(pacificDate('2026-10-02T06:59:00Z')).toBe('2026-10-01');
  });
});

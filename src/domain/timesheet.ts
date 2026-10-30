/**
 * Item 15 (Homebase replacement): weekly hours, overtime and a Gusto hours CSV. Pure; unit tested.
 * No break tracking (Karim declined). Washington overtime: hours over 40 in a workweek (Mon–Sun);
 * no daily or double overtime. Shifts count toward the workweek they start in.
 */
export interface TimeRow { id: string; member_id: string; site_id: string; clock_in_at: string; clock_out_at: string | null; confirmed_at?: string | null; timesheet_note?: string | null }
export interface MemberWeek { member_id: string; days: number[]; total: number; regular: number; overtime: number; entries: TimeRow[]; open: number; unconfirmed: number; flagged: number }

export const OT_WEEKLY_HOURS = 40;

/** Monday 00:00 (local time) of the week containing `d`. */
export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
export function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

export function entryHours(t: TimeRow, now = Date.now()): number {
  const end = t.clock_out_at ? Date.parse(t.clock_out_at) : now;
  return Math.max(0, (end - Date.parse(t.clock_in_at)) / 3600e3);
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Hours per member for the week starting `start` (Mon), index 0 = Monday. */
export function weekByMember(rows: TimeRow[], start: Date, now = Date.now()): MemberWeek[] {
  const s = start.getTime(), e = addDays(start, 7).getTime();
  const by = new Map<string, MemberWeek>();
  for (const t of rows) {
    const at = Date.parse(t.clock_in_at);
    if (at < s || at >= e) continue;
    const w = by.get(t.member_id) ?? { member_id: t.member_id, days: [0, 0, 0, 0, 0, 0, 0], total: 0, regular: 0, overtime: 0, entries: [], open: 0, unconfirmed: 0, flagged: 0 };
    const h = entryHours(t, now);
    const day = Math.floor((new Date(at).setHours(0, 0, 0, 0) - s) / 864e5 + 0.01);
    w.days[Math.min(6, Math.max(0, day))]! += h;
    w.total += h;
    w.entries.push(t);
    if (!t.clock_out_at) w.open++;
    else if (!t.confirmed_at) { w.unconfirmed++; if (t.timesheet_note) w.flagged++; }
    by.set(t.member_id, w);
  }
  for (const w of by.values()) {
    w.days = w.days.map(round2);
    w.total = round2(w.total);
    w.regular = round2(Math.min(w.total, OT_WEEKLY_HOURS));
    w.overtime = round2(Math.max(0, w.total - OT_WEEKLY_HOURS));
    w.entries.sort((a, b) => a.clock_in_at.localeCompare(b.clock_in_at));
  }
  return [...by.values()];
}

export interface PayrollPerson { member_id: string; name: string; email?: string | null }
export interface PayrollLine { person: PayrollPerson; regular: number; overtime: number }

/** Regular/OT per person over one or more whole workweeks (OT computed per week, then summed). */
export function payPeriod(rows: TimeRow[], firstWeek: Date, weeks: number, people: PayrollPerson[], now = Date.now()): PayrollLine[] {
  const acc = new Map<string, { regular: number; overtime: number }>();
  for (let i = 0; i < weeks; i++) {
    for (const w of weekByMember(rows, addDays(firstWeek, 7 * i), now)) {
      const a = acc.get(w.member_id) ?? { regular: 0, overtime: 0 };
      a.regular += w.regular; a.overtime += w.overtime;
      acc.set(w.member_id, a);
    }
  }
  return [...acc.entries()].map(([id, a]) => ({ person: people.find((p) => p.member_id === id) ?? { member_id: id, name: 'Unknown' }, regular: round2(a.regular), overtime: round2(a.overtime) }))
    .sort((x, y) => x.person.name.localeCompare(y.person.name));
}

const csvCell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Gusto "import hours" CSV: one row per employee for the pay period (no double OT in WA). */
export function toGustoCsv(lines: PayrollLine[], periodStart: Date, periodEndInclusive: Date): string {
  const head = ['Last Name', 'First Name', 'Email', 'Regular Hours', 'Overtime Hours', 'Double Overtime Hours', 'Pay Period Start', 'Pay Period End'];
  const body = lines.map(({ person, regular, overtime }) => {
    const parts = person.name.trim().split(/\s+/);
    const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] ?? '';
    const last = parts.length > 1 ? parts.at(-1)! : '';
    return [last, first, person.email ?? '', regular.toFixed(2), overtime.toFixed(2), '0.00', ymd(periodStart), ymd(periodEndInclusive)].map(csvCell).join(',');
  });
  return [head.join(','), ...body].join('\r\n') + '\r\n';
}

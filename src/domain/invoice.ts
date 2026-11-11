/**
 * Item 26: monthly client invoice = confirmed clocked hours × the site's hourly rate.
 * Pure; unit tested. One invoice per site per month; one line per guard per day (shift start date, Pacific).
 */
export interface InvoiceTimeRow { id?: string; member_id: string; site_id: string; clock_in_at: string; clock_out_at: string | null; confirmed_at?: string | null; confirmed_minutes?: number | null; voided_at?: string | null }
/** A shift left out of an invoice and why (pass 9 A2: shown to the owner instead of a silent $0). */
export interface LeftOut { id?: string; date: string; guard: string; hours: number; reason: 'unconfirmed' | 'open' }
export interface InvoiceLine { date: string; guard: string; hours: number; rate: number; description?: string }

const TZ = 'America/Los_Angeles';
/** YYYY-MM-DD of an instant in Pacific time. */
export function pacificDate(iso: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return p; // en-CA formats as YYYY-MM-DD
}
export const monthKey = (d: string) => `${d.slice(0, 7)}-01`;
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Billable hours of one entry: the guard-confirmed minutes when present, else clock-out − clock-in. */
export function billableHours(t: InvoiceTimeRow): number {
  if (t.confirmed_minutes != null) return r2(t.confirmed_minutes / 60);
  if (!t.clock_out_at) return 0;
  return r2(Math.max(0, Date.parse(t.clock_out_at) - Date.parse(t.clock_in_at)) / 3600e3);
}

export function buildInvoiceLines(rows: InvoiceTimeRow[], opts: { siteId: string; month: string; rate: number; names: Record<string, string>; onlyConfirmed: boolean }, now = Date.now()): { lines: InvoiceLine[]; excluded: number; leftOut: LeftOut[] } {
  const byKey = new Map<string, InvoiceLine>();
  const leftOut: LeftOut[] = [];
  for (const t of rows) {
    if (t.site_id !== opts.siteId || t.voided_at) continue;
    const date = pacificDate(t.clock_in_at);
    if (monthKey(date) !== opts.month) continue;
    const guard = opts.names[t.member_id] ?? 'Guard';
    if (!t.clock_out_at) { leftOut.push({ id: t.id, date, guard, hours: r2(Math.max(0, now - Date.parse(t.clock_in_at)) / 3600e3), reason: 'open' }); continue; }
    if (opts.onlyConfirmed && !t.confirmed_at) { leftOut.push({ id: t.id, date, guard, hours: billableHours(t), reason: 'unconfirmed' }); continue; }
    const key = `${date}|${t.member_id}`;
    const line = byKey.get(key) ?? { date, guard, hours: 0, rate: opts.rate, description: 'Security officer services' };
    line.hours = r2(line.hours + billableHours(t));
    byKey.set(key, line);
  }
  leftOut.sort((a, b) => a.date.localeCompare(b.date) || a.guard.localeCompare(b.guard));
  return { lines: [...byKey.values()].filter((l) => l.hours > 0).sort((a, b) => a.date.localeCompare(b.date) || a.guard.localeCompare(b.guard)), excluded: leftOut.filter((l) => l.reason === 'unconfirmed').length, leftOut };
}

/** Pass 9 A2: name the exact billing field that is missing before a draft can be made. */
export function missingBillingField(b: { hourly_rate?: number | null; client_name?: string | null } | null | undefined): string | null {
  if (b?.hourly_rate == null || Number.isNaN(Number(b.hourly_rate))) return 'Rate per guard hour ($)';
  if (Number(b.hourly_rate) <= 0) return 'Rate per guard hour ($) — it is $0';
  return null;
}

/** Pass 9 A2: payment state for the list — draft / unpaid / overdue / paid / void. `today` is the Pacific date YYYY-MM-DD. */
export function invoiceState(inv: { status: string; due_date: string }, today: string): 'draft' | 'unpaid' | 'overdue' | 'paid' | 'void' {
  if (inv.status === 'paid' || inv.status === 'void' || inv.status === 'draft') return inv.status;
  return inv.due_date < today ? 'overdue' : 'unpaid';
}

export const lineAmount = (l: InvoiceLine) => r2(l.hours * l.rate);
export const invoiceTotal = (lines: InvoiceLine[]) => r2(lines.reduce((n, l) => n + lineAmount(l), 0));
export const invoiceHours = (lines: InvoiceLine[]) => r2(lines.reduce((n, l) => n + l.hours, 0));

/** e.g. LSS-INV-202610-KSM */
export function invoiceNumber(prefix: string, month: string, siteCode: string | null, siteName: string): string {
  const code = (siteCode || siteName).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'SITE';
  return `${prefix || 'LSS-INV'}-${month.slice(0, 4)}${month.slice(5, 7)}-${code}`;
}
/** Issue on the 1st of the next month (or today, if later); due after the org's terms. */
export function invoiceDates(month: string, termsDays: number, today = new Date()): { issue: string; due: string } {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y!, m!, 1));
  const t = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const issue = first > t ? first : t;
  const due = new Date(issue.getTime() + termsDays * 864e5);
  return { issue: issue.toISOString().slice(0, 10), due: due.toISOString().slice(0, 10) };
}
export const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

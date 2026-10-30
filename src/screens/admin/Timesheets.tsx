import { useEffect, useState } from 'preact/hooks';
import { Screen, TopBar, SyncPill, SectionLabel, Empty, Button, Avatar, toast } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId, getBackend, orgName } from '../../auth/session';
import { listRecords, putServerRows, scopeOf } from '../../data/repos/records';
import { weekStart, addDays, weekByMember, payPeriod, toGustoCsv, OT_WEEKLY_HOURS, type TimeRow } from '../../domain/timesheet';
import { fmtTime, fmtHours } from '../../lib/format';
import type { Member, Site } from '../../data/types';
import type { SelectQuery } from '../../data/backend/types';
import type { Row } from '../../data/db';
import { Stat } from './Dashboard';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const h = (n: number) => (n ? n.toFixed(1) : '–');
const dlabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Pull the time entries for a range from the server (staff RLS) into the cache. */
async function fetchRange(org: string, from: Date, to: Date) {
  const q: SelectQuery = { eq: { org_id: org }, gte: { clock_in_at: from.toISOString() }, order: ['clock_in_at', 'asc'], limit: 2000 };
  try {
    const startedAt = Date.now();
    const rows = (await getBackend().select<Row>('patrol_time_entries', q)).filter((r) => String(r.clock_in_at) < to.toISOString());
    await putServerRows('patrol_time_entries', rows, { scope: { ...scopeOf(q, rows, startedAt), match: (r) => scopeOf(q, rows, startedAt).match(r) && String(r.clock_in_at) < to.toISOString() } });
  } catch { /* offline: cached */ }
}

/**
 * Item 15: weekly hours + overtime from guard-confirmed time entries, and a Gusto hours CSV.
 * Time records are never auto-deleted (kept 3+ years; sites with records can't be deleted).
 */
export function Timesheets() {
  const org = currentOrgId.value;
  const [start, setStart] = useState(() => weekStart(new Date()));
  const [open, setOpen] = useState<string | null>(null);
  const [weeks, setWeeks] = useState<1 | 2>(1);
  useEffect(() => { if (org) void fetchRange(org, addDays(start, -7), addDays(start, 7)); }, [org, start.getTime()]);
  const data = useData(async () => {
    const [times, members, sites] = await Promise.all([listRecords<TimeRow & Row>('patrol_time_entries', org), listRecords<Member>('patrol_members', org), listRecords<Site>('patrol_sites', org)]);
    return { times, members, sites };
  }, [org]);
  const week = weekByMember(data.data?.times ?? [], start);
  const name = (id: string) => data.data?.members.find((m) => m.id === id)?.display_name ?? 'Guard';
  const rows = week.sort((a, b) => name(a.member_id).localeCompare(name(b.member_id)));
  const tot = rows.reduce((a, w) => ({ total: a.total + w.total, ot: a.ot + w.overtime }), { total: 0, ot: 0 });
  const thisWeek = weekStart(new Date()).getTime() === start.getTime();

  const exportCsv = async () => {
    const first = weeks === 2 ? addDays(start, -7) : start;
    if (org) await fetchRange(org, first, addDays(start, 7));
    const times = await listRecords<TimeRow & Row>('patrol_time_entries', org);
    const people = (data.data?.members ?? []).map((m) => ({ member_id: m.id, name: m.display_name, gusto_employee_id: (m as Member & { gusto_employee_id?: string | null }).gusto_employee_id ?? null }));
    const lines = payPeriod(times, first, weeks, people);
    if (!lines.length) { toast('No hours in this period.', 'info'); return; }
    const csv = toGustoCsv(lines);
    const filename = `gusto-hours-${first.toISOString().slice(0, 10)}-to-${addDays(start, 6).toISOString().slice(0, 10)}.csv`;
    const file = new File([csv], filename, { type: 'text/csv' });
    if (__E2E__) (window as unknown as { __lpLastCsv?: { name: string; text: string } }).__lpLastCsv = { name: filename, text: csv };
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Gusto CSV downloaded');
  };

  return (
    <Screen tabbar>
      <TopBar title="Timesheets" large right={<SyncPill />} sub={orgName.value} />
      <div class="screen-body stack-lg" data-testid="timesheets">
        <div class="card row-between">
          <Button variant="ghost" icon="chevron-left" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))} data-testid="ts-prev" />
          <div style={{ textAlign: 'center' }}>
            <div class="headline" data-testid="ts-week">{dlabel(start)} – {dlabel(addDays(start, 6))}</div>
            <div class="foot muted">{thisWeek ? 'This week' : 'Workweek Mon–Sun'} · OT after {OT_WEEKLY_HOURS} h</div>
          </div>
          <Button variant="ghost" icon="chevron-right" aria-label="Next week" disabled={thisWeek} onClick={() => setStart(addDays(start, 7))} data-testid="ts-next" />
        </div>
        <div class="grid-3">
          <Stat label="Hours" value={tot.total.toFixed(1)} testid="ts-total" />
          <Stat label="Overtime" value={tot.ot.toFixed(1)} tone={tot.ot ? 'warning' : undefined} testid="ts-ot" />
          <Stat label="People" value={String(rows.length)} />
        </div>
        {rows.length ? (
          <div>
            <SectionLabel>Weekly hours</SectionLabel>
            <div class="card ts-table-wrap">
              <table class="ts-table" data-testid="ts-table">
                <thead><tr><th>Name</th>{DAYS.map((d, i) => <th key={d}>{d}<div class="foot muted">{addDays(start, i).getDate()}</div></th>)}<th>Total</th><th>OT</th></tr></thead>
                <tbody>
                  {rows.map((w) => (
                    <tr key={w.member_id} data-testid="ts-row" onClick={() => setOpen(open === w.member_id ? null : w.member_id)} class="tap">
                      <td><span class="row" style={{ gap: 8 }}><Avatar name={name(w.member_id)} />{name(w.member_id)}</span>
                        <span class="foot muted">{w.open ? `${w.open} on duty · ` : ''}{w.unconfirmed ? `${w.unconfirmed} unconfirmed` : 'all confirmed'}</span></td>
                      {w.days.map((d, i) => <td key={i} class="tnum">{h(d)}</td>)}
                      <td class="tnum"><b>{w.total.toFixed(1)}</b></td>
                      <td class={`tnum ${w.overtime ? 'warning-text' : ''}`}>{w.overtime ? w.overtime.toFixed(1) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot data-testid="ts-foot">
                  <tr>
                    <td><b>Total</b></td>
                    {DAYS.map((_, i) => <td key={i} class="tnum">{h(Math.round(rows.reduce((n, w) => n + w.days[i]!, 0) * 100) / 100)}</td>)}
                    <td class="tnum"><b>{tot.total.toFixed(1)}</b></td>
                    <td class={`tnum ${tot.ot ? 'warning-text' : ''}`}>{tot.ot ? tot.ot.toFixed(1) : '–'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : <Empty icon="clock" title="No hours this week" body="Clock-ins appear here as guards work their shifts." />}
        {open && (() => {
          const w = rows.find((x) => x.member_id === open);
          if (!w) return null;
          return (
            <div data-testid="ts-detail">
              <SectionLabel>{name(open)} · shifts</SectionLabel>
              <div class="card stack" style={{ gap: 10 }}>
                {w.entries.map((t) => (
                  <div key={t.id} class="row-between">
                    <span><b>{new Date(t.clock_in_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</b> · {fmtTime(t.clock_in_at)}–{t.clock_out_at ? fmtTime(t.clock_out_at) : 'now'}
                      <div class="foot muted">{data.data?.sites.find((s) => s.id === t.site_id)?.name ?? ''}{t.timesheet_note ? ` · “${t.timesheet_note}”` : ''}</div></span>
                    <span class="row" style={{ gap: 6 }}>
                      <span class="tnum">{fmtHours(((t.clock_out_at ? Date.parse(t.clock_out_at) : Date.now()) - Date.parse(t.clock_in_at)) / 60000)}</span>
                      {!t.clock_out_at ? <span class="pill pill-info">On duty</span> : t.confirmed_at ? <span class="pill pill-success"><Icon name="check" size={14} /> Confirmed</span> : t.timesheet_note ? <span class="pill pill-warning">Flagged</span> : <span class="pill pill-muted">Not confirmed</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        <div class="card stack">
          <div class="headline">Payroll export</div>
          <div class="foot muted">Gusto hours CSV (last_name, first_name, gusto_employee_id, regular_hours, overtime_hours). Overtime is calculated per workweek. Set each person’s Gusto employee ID in People.</div>
          <div class="seg">
            <button class={weeks === 1 ? 'active' : ''} onClick={() => setWeeks(1)}>This week</button>
            <button class={weeks === 2 ? 'active' : ''} onClick={() => setWeeks(2)} data-testid="ts-2weeks">2 weeks (ending this week)</button>
          </div>
          <Button variant="primary" icon="download" onClick={() => void exportCsv()} data-testid="ts-export">Export Gusto CSV</Button>
        </div>
        <p class="foot faint">Time records are kept for at least 3 years and are never deleted automatically. No break tracking.</p>
      </div>
    </Screen>
  );
}

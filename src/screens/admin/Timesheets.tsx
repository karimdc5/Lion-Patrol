import { useEffect, useState } from 'preact/hooks';
import { Screen, TopBar, SyncPill, SectionLabel, Empty, Button, Avatar, Field, toast } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId, getBackend, orgName } from '../../auth/session';
import { listRecords, getRecord, putServerRows, scopeOf } from '../../data/repos/records';
import { weekStart, addDays, weekByMember, payPeriod, toGustoCsv, longFlag, LONG_LABEL, OPEN_ALERT_HOURS, OT_WEEKLY_HOURS, type TimeRow } from '../../domain/timesheet';
import { fmtHours, fmtDateTime, fmtDay, fmtTime, toPacificInput, fromPacificInput } from '../../lib/format';
import { gpsLine } from '../../lib/geo';
import { confirmTimeEntry, editTimeEntry, voidTimeEntry, unvoidTimeEntry } from '../../data/admin';
import { navigate } from '../../router';
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
                        <span class="foot muted">{w.open ? `${w.open} on duty · ` : ''}{w.unconfirmed ? `${w.unconfirmed} unconfirmed` : 'all confirmed'}{w.voided ? ` · ${w.voided} voided` : ''}</span>
                        {w.long > 0 && <span class="pill pill-danger" style={{ marginTop: 4 }} data-testid="ts-long">{w.long} unclosed / forgot clock-out?</span>}</td>
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
                {w.entries.map((t) => {
                  const lf = longFlag(t);
                  const x = t as TimeRow & Row;
                  return (
                    // A3: start DATE + TIME and end DATE + TIME on every row; tap → owner confirm / edit / void (A2).
                    <button key={t.id} class="row-between tap" style={{ textAlign: 'left', width: '100%', alignItems: 'flex-start' }} onClick={() => navigate(`/a/timesheets/shift/${t.id}`)} data-testid="ts-shift">
                      <span style={{ minWidth: 0 }}>
                        <b data-testid="ts-shift-range">{fmtDay(t.clock_in_at)}, {fmtTime(t.clock_in_at)} → {t.clock_out_at ? `${fmtDay(t.clock_out_at)}, ${fmtTime(t.clock_out_at)}` : 'still open'}</b>
                        <div class="foot muted">{data.data?.sites.find((s) => s.id === t.site_id)?.name ?? ''}{t.timesheet_note ? ` · “${t.timesheet_note}”` : ''}{x.void_reason ? ` · voided: ${String(x.void_reason)}` : ''}</div>
                        {lf && <span class="pill pill-danger" style={{ marginTop: 4 }} data-testid="ts-shift-long">{LONG_LABEL[lf]}</span>}
                      </span>
                      <span class="row" style={{ gap: 6, flexShrink: 0 }}>
                        <span class="tnum" style={x.voided_at ? { textDecoration: 'line-through' } : undefined}>{fmtHours(((t.clock_out_at ? Date.parse(t.clock_out_at) : Date.now()) - Date.parse(t.clock_in_at)) / 60000)}</span>
                        <ShiftPill t={x} />
                        <Icon name="chevron-right" size={16} />
                      </span>
                    </button>
                  );
                })}
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
        <p class="foot faint">Tap a shift to confirm, edit or void it (every change is logged). Shifts over 12 h are flagged; owners get an alert when a shift is still open after {OPEN_ALERT_HOURS} h. Nothing is clocked out automatically. Time records are kept for at least 3 years and are never deleted. No break tracking.</p>
      </div>
    </Screen>
  );
}

function ShiftPill({ t }: { t: Row }) {
  if (t.voided_at) return <span class="pill pill-danger">Voided</span>;
  if (!t.clock_out_at) return <span class="pill pill-info">On duty</span>;
  if (t.confirmed_at) return <span class="pill pill-success"><Icon name="check" size={14} /> {t.owner_confirmed_by ? 'Owner confirmed' : 'Confirmed'}</span>;
  if (t.timesheet_note) return <span class="pill pill-warning">Flagged</span>;
  return <span class="pill pill-muted">Not confirmed</span>;
}

/**
 * Pass 9 A2/A3: one shift — exact start/end dates, GPS, notes — with owner Confirm, Edit hours, Void
 * (reason required, logged in Activity → Audit). Nothing is deleted.
 */
export function ShiftDetail({ id }: { id: string }) {
  const org = currentOrgId.value;
  useEffect(() => { void getBackend().select<Row>('patrol_time_entries', { eq: { id } }).then((r) => putServerRows('patrol_time_entries', r)).catch(() => undefined); }, [id]);
  const d = useData(async () => {
    const t = await getRecord<Row>('patrol_time_entries', id);
    const [members, site] = await Promise.all([listRecords<Member>('patrol_members', org), t ? getRecord<Site>('patrol_sites', String(t.site_id)) : undefined]);
    return { t, members, site };
  }, [id, org]);
  const [mode, setMode] = useState<'edit' | 'void' | null>(null);
  const [inV, setIn] = useState(''), [outV, setOut] = useState(''), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const t = d.data?.t;
  if (!t) return <Screen><TopBar title="Shift" backTo="/a/timesheets" /><div class="screen-body">{d.loading ? null : <Empty icon="clock" title="Shift not found" body="It may not be synced to this device yet." />}</div></Screen>;
  const name = d.data?.members.find((m) => m.id === t.member_id)?.display_name ?? 'Guard';
  const site = d.data?.site ?? null;
  const lf = longFlag(t as unknown as TimeRow);
  const minutes = ((t.clock_out_at ? Date.parse(String(t.clock_out_at)) : Date.now()) - Date.parse(String(t.clock_in_at))) / 60000;
  const run = async (fn: () => Promise<void>, msg: string) => {
    setBusy(true);
    try { await fn(); toast(msg); setMode(null); setReason(''); } catch (e) { toast((e as Error).message, 'error', 4000); } finally { setBusy(false); }
  };
  const openEdit = () => { setIn(toPacificInput(String(t.clock_in_at))); setOut(toPacificInput(String(t.clock_out_at ?? new Date().toISOString()))); setReason(''); setMode('edit'); };
  return (
    <Screen>
      <TopBar title="Shift" backTo="/a/timesheets" right={<SyncPill />} />
      <div class="screen-body stack-lg" data-testid="shift-detail" style={{ paddingBottom: 120 }}>
        <div class="card stack" style={{ gap: 8 }}>
          <div class="row-between"><b>{name}</b><ShiftPill t={t} /></div>
          <div class="foot muted">{site?.name ?? ''}</div>
          <div><span class="muted">Start</span> <b data-testid="sd-start">{fmtDateTime(String(t.clock_in_at))}</b></div>
          <div><span class="muted">End</span> <b data-testid="sd-end">{t.clock_out_at ? fmtDateTime(String(t.clock_out_at)) : 'Still open (no clock-out)'}</b></div>
          <div><span class="muted">Length</span> <b class="tnum">{fmtHours(minutes)}</b>{t.confirmed_minutes != null ? <span class="muted"> · billable {fmtHours(Number(t.confirmed_minutes))}</span> : null}</div>
          {lf && <div class="form-error" role="alert" data-testid="sd-long">{LONG_LABEL[lf]} Check the real end time, then Edit hours or Void.</div>}
          {t.voided_at ? <div class="form-error" data-testid="sd-voided">Voided {fmtDateTime(String(t.voided_at))} · {String(t.void_reason ?? '')}. Counts 0 hours on timesheets, payroll and invoices.</div> : null}
          {t.edited_at ? <div class="foot muted">Edited {fmtDateTime(String(t.edited_at))} · {String(t.edit_reason ?? '')}{t.original_clock_out_at ? ` · original clock-out ${fmtDateTime(String(t.original_clock_out_at))}` : ''}</div> : null}
          {t.timesheet_note ? <div class="foot">Guard’s note: “{String(t.timesheet_note)}”</div> : null}
          {t.shift_note ? <div class="foot">Shift note: {String(t.shift_note)}</div> : null}
        </div>
        <div class="card stack" style={{ gap: 6 }}>
          <div class="headline">Location</div>
          <div class="foot" data-testid="sd-gps-in">Clock-in: {gpsLine({ lat: t.clock_in_lat, lng: t.clock_in_lng, accuracy: t.clock_in_accuracy_m }, site)}</div>
          {t.clock_in_override_reason ? <div class="foot warning-text">Owner override at clock-in: {String(t.clock_in_override_reason)}</div> : null}
          {t.clock_out_at ? <div class="foot" data-testid="sd-gps-out">Clock-out: {gpsLine({ lat: t.clock_out_lat, lng: t.clock_out_lng, accuracy: t.clock_out_accuracy_m }, site)}</div> : null}
        </div>
        {mode === 'edit' && (
          <div class="card stack" data-testid="sd-edit">
            <div class="headline">Edit hours (Pacific time)</div>
            <div class="grid-2">
              <Field label="Clock-in"><input class="input" type="datetime-local" value={inV} onInput={(e) => setIn((e.target as HTMLInputElement).value)} data-testid="sd-in" /></Field>
              <Field label="Clock-out"><input class="input" type="datetime-local" value={outV} onInput={(e) => setOut((e.target as HTMLInputElement).value)} data-testid="sd-out" /></Field>
            </div>
            <Field label="Reason (required, logged)"><input class="input" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} placeholder="e.g. forgot to clock out, left at 6:00 AM" data-testid="sd-reason" /></Field>
            <div class="row" style={{ gap: 8 }}>
              <Button variant="primary" loading={busy} onClick={() => void run(() => editTimeEntry(t, fromPacificInput(inV), fromPacificInput(outV), reason), 'Hours updated (logged)')} data-testid="sd-save">Save hours</Button>
              <Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
            </div>
          </div>
        )}
        {mode === 'void' && (
          <div class="card stack" data-testid="sd-void">
            <div class="headline">Void this shift</div>
            <div class="foot muted">The shift stays in the history, marked Voided, and counts 0 hours. You can restore it later.</div>
            <Field label="Reason (required, logged)"><input class="input" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} placeholder="e.g. test shift, not worked" data-testid="sd-void-reason" /></Field>
            <div class="row" style={{ gap: 8 }}>
              <Button variant="danger" loading={busy} onClick={() => void run(() => voidTimeEntry(t, reason), 'Shift voided (logged)')} data-testid="sd-void-confirm">Void shift</Button>
              <Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
      {!mode && (
        <div class="sticky-bar stack" style={{ gap: 8 }}>
          {!t.voided_at && t.clock_out_at && !t.confirmed_at && <Button variant="primary" size="lg" block loading={busy} onClick={() => void run(() => confirmTimeEntry(t), 'Hours confirmed (logged)')} data-testid="sd-confirm">Confirm {fmtHours(minutes)}</Button>}
          {!t.voided_at && <div class="grid-2">
            <Button variant="outline" onClick={openEdit} data-testid="sd-edit-btn">{t.clock_out_at ? 'Edit hours' : 'Set clock-out'}</Button>
            <Button variant="outline" onClick={() => { setReason(''); setMode('void'); }} data-testid="sd-void-btn">Void…</Button>
          </div>}
          {t.voided_at ? <Button variant="outline" block loading={busy} onClick={() => void run(() => unvoidTimeEntry(t), 'Shift restored (logged)')} data-testid="sd-unvoid">Restore shift</Button> : null}
        </div>
      )}
    </Screen>
  );
}

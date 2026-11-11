import { useState } from 'preact/hooks';
import { Screen, TopBar, SyncPill, Empty, SkeletonList, Sheet, Button } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId, isAdmin } from '../../auth/session';
import { gpsLine } from '../../lib/geo';
import { loadOps, type OpsData } from './ops';
import { fmtTime, fmtDay } from '../../lib/format';
import { navigate } from '../../router';

type Kind = 'all' | 'incident' | 'log' | 'scan' | 'shift' | 'sos' | 'audit';
interface Item { id: string; at: string; kind: Exclude<Kind, 'all'>; title: string; sub: string; site: string; member: string; href?: string; flags?: string[]; shift?: string }

function items(d: OpsData): Item[] {
  const name = (id: unknown) => d.members.find((m) => m.id === id)?.display_name ?? 'Guard';
  const cp = (id: unknown) => d.checkpoints.find((c) => c.id === id)?.name ?? 'Checkpoint';
  const out: Item[] = [];
  for (const i of d.incidents) out.push({ id: i.id, at: i.occurred_at as string, kind: 'incident', title: String(i.title || i.category_name || 'Incident'), sub: `${name(i.member_id)} · ${String(i.status).replace(/_/g, ' ')}`, site: i.site_id as string, member: i.member_id as string, href: `/a/incidents/${i.id}` });
  const darShift = (darId: unknown) => d.dars.find((x) => x.id === darId)?.time_entry_id as string | undefined;
  for (const e of d.entries) out.push({ id: e.id, at: e.occurred_at as string, kind: 'log', title: String(e.body), sub: `${name(e.member_id)}${e.category_name ? ` · ${e.category_name}` : ''}`, site: e.site_id as string, member: e.member_id as string, shift: darShift(e.dar_id) });
  const site = (id: unknown) => d.sites.find((s) => s.id === id) ?? null;
  for (const s of d.scans) out.push({ id: s.id, at: s.scanned_at as string, kind: 'scan', title: cp(s.checkpoint_id), sub: `${name(s.member_id)} · ${gpsLine({ lat: s.lat, lng: s.lng, accuracy: s.accuracy_m })}`, site: s.site_id as string, member: s.member_id as string, flags: (s.flags as string[]) ?? [], shift: s.time_entry_id as string | undefined });
  for (const t of d.times) {
    // A1/A2: GPS (or the labeled site-address fallback) on every clock-in/out; tap opens the shift detail.
    const href = isAdmin.value ? `/a/timesheets/shift/${t.id}` : undefined;
    const flags = [...(t.clock_in_override_reason ? ['owner_override'] : []), ...(t.voided_at ? ['voided'] : [])];
    out.push({ id: `${t.id}:in`, at: t.clock_in_at as string, kind: 'shift', title: 'Clocked in', sub: `${name(t.member_id)} · ${gpsLine({ lat: t.clock_in_lat, lng: t.clock_in_lng, accuracy: t.clock_in_accuracy_m }, site(t.site_id))}${t.clock_in_override_reason ? ` · override: ${t.clock_in_override_reason}` : ''}`, site: t.site_id as string, member: t.member_id as string, href, flags });
    if (t.clock_out_at) out.push({ id: `${t.id}:out`, at: t.clock_out_at as string, kind: 'shift', title: 'Clocked out', sub: `${name(t.member_id)} · ${gpsLine({ lat: t.clock_out_lat, lng: t.clock_out_lng, accuracy: t.clock_out_accuracy_m }, site(t.site_id))}${t.shift_note ? ` · ${t.shift_note}` : ''}`, site: t.site_id as string, member: t.member_id as string, href });
  }
  for (const a of d.audit) out.push({ id: a.id, at: a.created_at as string, kind: 'audit', title: AUDIT_LABEL[String(a.kind)] ?? String(a.kind), sub: `${String(a.actor_name ?? 'Someone')}${a.detail ? ` · ${a.detail}` : ''}`, site: (a.site_id as string) ?? '', member: (a.actor_id as string) ?? '',
    href: a.entity_table === 'patrol_time_entries' && a.entity_id && isAdmin.value ? `/a/timesheets/shift/${a.entity_id}` : undefined });
  for (const a of d.alerts) out.push({ id: a.id, at: a.triggered_at as string, kind: 'sos', title: `SOS · ${String(a.status)}`, sub: `${a.member_name || name(a.member_id)}${a.note ? ` · ${a.note}` : ''}`, site: (a.site_id as string) ?? '', member: a.member_id as string, shift: a.time_entry_id as string | undefined });
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

const META: Record<Item['kind'], [string, string]> = {
  incident: ['alert', 'var(--danger)'], log: ['note', 'var(--gold)'], scan: ['qr', 'var(--success)'], shift: ['clock', 'var(--info)'], sos: ['bell', 'var(--danger)'], audit: ['shield-check', 'var(--warning)'],
};
const AUDIT_LABEL: Record<string, string> = {
  clock_in_override: 'Clock-in override (outside geofence / no GPS)', timesheet_confirm: 'Shift hours confirmed', timesheet_edit: 'Shift hours edited', timesheet_void: 'Shift voided', timesheet_unvoid: 'Shift restored',
  codes_viewed: 'Gate/alarm codes viewed', dar_shared: 'DAR shared with client', dar_unshared: 'DAR un-shared', dar_autoshare: 'DAR auto-share changed', pin_admin_switch: 'Switched to Admin mode',
};

export function Feed() {
  const org = currentOrgId.value;
  const d = useData(() => loadOps(org), [org]);
  const [kind, setKind] = useState<Kind>('all');
  const [site, setSite] = useState('');
  const [member, setMember] = useState('');
  const [range, setRange] = useState(1);
  const [open, setOpen] = useState<Item | null>(null); // B13: every entry opens something
  const since = Date.now() - range * 864e5;
  const list = d.data ? items(d.data).filter((i) => (kind === 'all' || i.kind === kind) && (!site || i.site === site) && (!member || i.member === member) && Date.parse(i.at) >= since) : [];
  const groups: Array<[string, Item[]]> = [];
  for (const it of list.slice(0, 300)) { const day = fmtDay(it.at); const g = groups.at(-1); if (g && g[0] === day) g[1].push(it); else groups.push([day, [it]]); }
  return (
    <Screen tabbar>
      <TopBar title="Activity" large right={<SyncPill />} />
      <div class="screen-body">
        <div class="filter-row" data-testid="feed-filters">
          {(['all', 'incident', 'log', 'scan', 'shift', 'sos', ...(isAdmin.value ? ['audit'] : [])] as Kind[]).map((k) => (
            <button key={k} class={`chip ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>{{ all: 'All', incident: 'Incidents', log: 'Log', scan: 'Scans', shift: 'Shifts', sos: 'SOS', audit: 'Audit' }[k]}</button>
          ))}
        </div>
        <div class="filter-row">
          <select class="chip" value={site} onChange={(e) => setSite((e.target as HTMLSelectElement).value)} aria-label="Site"><option value="">All sites</option>{d.data?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select class="chip" value={member} onChange={(e) => setMember((e.target as HTMLSelectElement).value)} aria-label="Guard"><option value="">All guards</option>{d.data?.members.filter((m) => m.role !== 'client').map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select>
          <select class="chip" value={String(range)} onChange={(e) => setRange(Number((e.target as HTMLSelectElement).value))} aria-label="Date range"><option value="1">Last 24 h</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
        </div>
        {d.loading ? <SkeletonList /> : !groups.length ? <Empty icon="activity" title="Nothing here" body="Try a wider date range or clear the filters." /> : groups.map(([day, its]) => (
          <div key={day}>
            <div class="tl-day cap muted">{day}</div>
            {its.map((it) => (
              <button key={it.id} class="tl-item" style={{ width: '100%', textAlign: 'left' }} onClick={() => (it.href ? navigate(it.href) : setOpen(it))} data-testid="feed-item">
                <div class="tl-time">{fmtTime(it.at)}</div>
                <div class="tl-dot" style={{ background: META[it.kind][1] }} />
                <div class="tl-body">
                  <div class="tl-title"><Icon name={META[it.kind][0]} /><span class="ellipsis">{it.title}</span></div>
                  <div class="tl-sub">{d.data!.sites.find((s) => s.id === it.site)?.name ?? ''} · {it.sub}</div>
                  {it.flags && it.flags.filter((f) => f !== 'no_gps').length > 0 && <div class="row" style={{ gap: 4, marginTop: 4 }}>{it.flags.filter((f) => f !== 'no_gps').map((f) => <span key={f} class={`pill ${f === 'off_site' || f === 'voided' ? 'pill-danger' : 'pill-warning'}`}>{f.replace(/_/g, ' ')}</span>)}</div>}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
      {/* B13: checkpoint scans, log entries and SOS have no page of their own — show the full entry here. */}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? { log: 'Log entry', scan: 'Checkpoint scan', sos: 'SOS', incident: 'Incident', shift: 'Shift', audit: 'Audit' }[open.kind] : ''} testid="feed-detail">
        {open && <div class="stack">
          <div class="headline" data-testid="feed-detail-title">{open.title}</div>
          <div class="sub muted">{fmtDay(open.at)} · {fmtTime(open.at)} PT</div>
          <div class="sub">{d.data?.sites.find((s) => s.id === open.site)?.name ?? ''}</div>
          <div class="sub muted">{open.sub}</div>
          {open.flags && open.flags.length > 0 && <div class="row" style={{ gap: 4, flexWrap: 'wrap' }}>{open.flags.map((f) => <span key={f} class="pill pill-warning">{f.replace(/_/g, ' ')}</span>)}</div>}
          {open.shift && isAdmin.value && <Button block onClick={() => { const id = open.shift!; setOpen(null); navigate(`/a/timesheets/shift/${id}`); }} data-testid="feed-detail-shift">Open the shift</Button>}
          {open.kind === 'scan' && open.site && <Button variant="ghost" block onClick={() => { const id = open.site; setOpen(null); navigate(`/a/sites/${id}`); }}>Open the site</Button>}
        </div>}
      </Sheet>
    </Screen>
  );
}

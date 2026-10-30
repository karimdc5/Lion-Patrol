import { Screen, TopBar, SyncPill, List, Row, SectionLabel, Empty, Avatar, Button, toast } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId, orgName, isAdmin } from '../../auth/session';
import { listOwnerAlerts, ackOwnerAlert, type OwnerAlert } from '../../data/ownerAlerts';
import { loadOps, completionBySite } from './ops';
import { setAlertStatus } from '../../data/admin';
import { relTime, fmtTime } from '../../lib/format';
import { navigate } from '../../router';
import type { Row as R } from '../../data/db';

export function AlertBanner({ alerts, members, sites }: { alerts: R[]; members: { id: string; display_name: string }[]; sites: { id: string; name: string }[] }) {
  const live = alerts.filter((a) => a.status === 'open' || a.status === 'acknowledged').sort((a, b) => String(b.triggered_at).localeCompare(String(a.triggered_at)));
  if (!live.length) return null;
  return (
    <div class="stack" data-testid="sos-banner">
      {live.map((a) => {
        const name = (a.member_name as string) || members.find((m) => m.id === a.member_id)?.display_name || 'Guard';
        const site = sites.find((s) => s.id === a.site_id)?.name ?? 'Unknown site';
        const open = a.status === 'open';
        return (
          <div key={a.id} class={`sos-alert ${open ? 'open' : ''}`} role="alert">
            <div class="row" style={{ alignItems: 'flex-start' }}>
              <span class="sos-alert-icon"><Icon name="alert" size={26} /></span>
              <div class="grow" style={{ minWidth: 0 }}>
                <div class="cap" style={{ opacity: 0.9 }}>{open ? 'SOS — needs response' : 'SOS — acknowledged'}</div>
                <div class="title" style={{ fontSize: 20 }}>{name}</div>
                <div class="sub" style={{ opacity: 0.92 }}>{site} · {fmtTime(a.triggered_at as string)} ({relTime(a.triggered_at as string)})</div>
                {a.lat != null && <a class="sub" style={{ color: '#fff', textDecoration: 'underline' }} href={`https://maps.apple.com/?q=${a.lat},${a.lng}`} target="_blank" rel="noopener">Open location in Maps</a>}
              </div>
            </div>
            <div class="grid-2" style={{ marginTop: 12 }}>
              {open ? <Button class="sos-ack" onClick={async () => { await setAlertStatus(a.id, 'acknowledged'); toast('Acknowledged'); }} data-testid="sos-ack">Acknowledge</Button> : <span />}
              <Button class="sos-res" onClick={async () => { await setAlertStatus(a.id, 'resolved'); toast('Alert resolved'); }} data-testid="sos-resolve">Resolve</Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Dashboard() {
  const org = currentOrgId.value;
  const d = useData(() => loadOps(org), [org]);
  const data = d.data;
  const onDuty = (data?.status ?? []).filter((s) => s.on_duty);
  const comp = data ? completionBySite(data, Date.now() - 24 * 3600e3) : [];
  const review = (data?.incidents ?? []).filter((i) => i.status === 'submitted').sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
  const totalPct = comp.reduce((n, c) => n + c.expected, 0) ? Math.round((comp.reduce((n, c) => n + c.scanned, 0) / comp.reduce((n, c) => n + c.expected, 0)) * 100) : 0;
  return (
    <Screen tabbar>
      <TopBar title="Live" large sub={orgName.value} right={<SyncPill />} action={isAdmin.value ? <Button icon="map" onClick={() => navigate('/a/map')} data-testid="open-map">Map</Button> : undefined} />
      <div class="screen-body stack-lg">
        {data && <AlertBanner alerts={data.alerts} members={data.members} sites={data.sites} />}
        {isAdmin.value && <OwnerAlerts />}
        {data && <GettingStarted d={data} />}
        <div class="grid-3">
          <Stat label="On duty" value={String(onDuty.length)} testid="stat-onduty" />
          <Stat label="To review" value={String(review.length)} tone={review.length ? 'warning' : undefined} />
          <Stat label="Patrols 24h" value={`${totalPct}%`} tone={totalPct < 80 ? 'warning' : 'success'} />
        </div>

        <div>
          <SectionLabel>On shift now</SectionLabel>
          {onDuty.length ? (
            <List>
              {onDuty.map((s) => {
                const m = data!.members.find((x) => x.id === s.member_id);
                const site = data!.sites.find((x) => x.id === s.site_id);
                const run = data!.runs.filter((r) => r.member_id === s.member_id && !r.completed_at).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0];
                const stale = !s.last_ping_at || Date.now() - Date.parse(s.last_ping_at) > 15 * 60e3;
                return (
                  <Row key={s.member_id} testid="onshift-row"
                    title={<span class="row" style={{ gap: 10 }}><Avatar name={m?.display_name ?? '?'} gold />{m?.display_name ?? 'Guard'}</span>}
                    sub={`${site?.name ?? ''} · on since ${fmtTime(s.on_duty_since)} · ping ${relTime(s.last_ping_at)}`}
                    right={<span class="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
                      {run && <span class="pill pill-gold tnum">{String(run.scanned_count ?? 0)}/{String(run.expected_count)}</span>}
                      {stale && <span class="pill pill-warning">No recent GPS</span>}
                    </span>} />
                );
              })}
            </List>
          ) : <Empty icon="shield" title="No one is on shift" body="Guards appear here when they clock in." />}
          <p class="foot faint" style={{ padding: '6px 4px' }}>Locations update while a guard has Lion Patrol open; iPhone pauses web apps in the background.</p>
        </div>

        <div>
          <SectionLabel>Patrol completion · last 24 h</SectionLabel>
          {!comp.length ? <Empty icon="building" title="No sites yet" body="Patrol completion appears here once you add a site with checkpoints." /> : <List>
            {comp.map((c) => (
              <div class="list-row" key={c.site.id} data-testid="completion-row">
                <span class="grow" style={{ minWidth: 0 }}>
                  <span class="row-between"><b class="ellipsis">{c.site.name}</b><span class="tnum">{c.pct}%</span></span>
                  <span class="progress" style={{ display: 'block', margin: '8px 0 6px' }}><span style={{ width: `${c.pct}%`, background: c.pct < 80 ? 'var(--warning)' : 'var(--success)' }} /></span>
                  <span class="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <span class="pill pill-muted">{c.runs} tour{c.runs === 1 ? '' : 's'}</span>
                    {c.missed > 0 && <span class="pill pill-danger">{c.missed} missed</span>}
                    {c.late > 0 && <span class="pill pill-warning">{c.late} late</span>}
                    {!c.missed && !c.late && c.runs > 0 && <span class="pill pill-success">On track</span>}
                  </span>
                </span>
              </div>
            ))}
          </List>}
        </div>

        <div>
          <SectionLabel>Needs review</SectionLabel>
          {review.length ? (
            <List>{review.slice(0, 5).map((i) => <Row key={i.id} icon="alert" iconBg="var(--warning-soft)" iconColor="var(--warning)" title={String(i.title || i.category_name)} sub={`${i.author_name} · ${relTime(i.occurred_at as string)}`} chevron href={`/a/incidents/${i.id}`} />)}</List>
          ) : <Empty icon="check-circle" title="All caught up" body="New incident reports appear here for review." />}
          <Button variant="ghost" block onClick={() => navigate('/a/feed')}>Open activity feed</Button>
        </div>
      </div>
    </Screen>
  );
}

export function Stat({ label, value, tone, testid }: { label: string; value: string; tone?: 'warning' | 'success'; testid?: string }) {
  return (
    <div class="card" style={{ padding: 14 }} data-testid={testid}>
      <div class="tnum" style={{ fontSize: 28, lineHeight: '32px', fontWeight: 700, color: tone === 'warning' ? 'var(--warning)' : tone === 'success' ? 'var(--success)' : 'var(--gold)' }}>{value}</div>
      <div class="foot muted">{label}</div>
    </div>
  );
}

/** First-run checklist for a brand-new org; disappears once the basics exist. */
function GettingStarted({ d }: { d: import('./ops').OpsData }) {
  const site = d.sites.find((x) => x.active !== false);
  const steps: Array<[boolean, string, string, string]> = [
    [!!site, 'Add your first client site', 'Address, map pin and post orders.', '/a/sites/new'],
    [d.checkpoints.some((c) => c.active), 'Add checkpoints and print QR codes', 'Stick one QR at each patrol point.', site ? `/a/sites/${site.id}` : '/a/sites'],
    [d.members.some((m) => m.role === 'guard' || m.role === 'supervisor'), 'Invite your first guard', 'Share a one-time code; nothing is emailed.', '/a/people'],
    [d.members.some((m) => m.role === 'client'), 'Invite the client (optional)', 'Or share a read-only portal link from the site.', '/a/people'],
  ];
  if (steps.slice(0, 3).every(([done]) => done)) return null;
  return (
    <div class="card stack" data-testid="getting-started">
      <div class="row"><span class="list-icon" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}><Icon name="shield-check" /></span><div><div class="headline">Getting started</div><div class="foot muted">Set up Lion Patrol in a few minutes.</div></div></div>
      <List>
        {steps.map(([done, title, sub, href], i) => (
          <Row key={i} icon={done ? 'check' : 'chevron-right'} iconBg={done ? 'var(--success-soft)' : 'var(--raised-2)'} iconColor={done ? 'var(--success)' : 'var(--text-2)'}
            title={<span style={done ? { color: 'var(--text-3)', textDecoration: 'line-through' } : undefined}>{title}</span>} sub={sub} chevron={!done} onClick={done ? undefined : () => navigate(href)} testid={`setup-step-${i}`} />
        ))}
      </List>
    </div>
  );
}

const ALERT_ICON: Record<string, string> = { missed_checkpoint: 'qr', overdue_patrol: 'clock', no_show: 'user-x', geofence: 'pin' };
/** Item 18: owners/admins only (RLS returns no rows to anyone else). */
function OwnerAlerts() {
  const org = currentOrgId.value;
  const list = useData(() => listOwnerAlerts(org), [org]);
  const open = (list.data ?? []).filter((a) => !a.acknowledged_at).slice(0, 8);
  if (!open.length) return null;
  return (
    <div data-testid="owner-alerts">
      <SectionLabel>Owner alerts</SectionLabel>
      <List>
        {open.map((a: OwnerAlert) => (
          <Row key={a.id} testid="owner-alert" icon={ALERT_ICON[a.kind] ?? 'alert'} iconBg="var(--warning-soft)" iconColor="var(--warning)" title={a.title} sub={`${a.body} · ${relTime(a.created_at)}`}
            right={<Button variant="ghost" onClick={async () => { await ackOwnerAlert(a); toast('Alert dismissed'); }} data-testid="owner-alert-ack">Dismiss</Button>} />
        ))}
      </List>
    </div>
  );
}

import { useEffect, useState } from 'preact/hooks';
import { Screen, TopBar, List, Row, SectionLabel, Empty, Skeleton, Button } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { HoldButton } from '../../ui/Hold';
import { useData } from '../../ui/useData';
import { currentOrgId, memberId, membership, isStaff } from '../../auth/session';
import { sitesFor, shiftsFor, checkpointsFor } from '../../data/repos/queries';
import { onShift, openRun, listDrafts } from '../../data/guard';
import { fmtDay, fmtTime, hms, relTime } from '../../lib/format';
import { navigate } from '../../router';
import { GuardRight } from './common';
import { fireSos } from './Sos';
import { ClockOutSheet } from './Clock';

export function GuardHome() {
  const org = currentOrgId.value;
  const me = memberId.value;
  const staff = isStaff.value;
  const te = onShift.value;
  const sites = useData(() => sitesFor(org, me, staff), [org, me, staff]);
  const shifts = useData(() => shiftsFor(org), [org]);
  const site = sites.data?.find((s) => s.id === te?.site_id);
  const cps = useData(() => checkpointsFor(org, te?.site_id), [org, te?.site_id]);
  const run = useData(() => (te ? openRun(te.site_id) : Promise.resolve(null)), [te?.id]);
  const drafts = useData(() => listDrafts(), []);
  const [clockOut, setClockOut] = useState(false);
  const upcoming = (shifts.data ?? []).filter((s) => s.member_id === me && Date.parse(s.ends_at) > Date.now()).slice(0, 4);
  const first = membership.value?.display_name.split(' ')[0] ?? '';
  const total = cps.data?.length ?? 0;
  const done = Math.min(total, Number((run.data as { scanned_count?: number } | null)?.scanned_count ?? 0));

  return (
    <Screen tabbar>
      <TopBar title={`Hi, ${first}`} large right={<GuardRight />} />
      <div class="screen-body stack-lg">
        <div class="hero" data-testid="duty-hero">
          <div class="row">
            <DutyRing onDuty={!!te} since={te?.clock_in_at} />
            <div class="grow" style={{ minWidth: 0 }}>
              <div class={`cap ${te ? 'success-text' : 'muted'}`}>{te ? 'On duty' : 'Off duty'}</div>
              <div class="title tnum" style={{ marginTop: 2 }} data-testid="duty-status">{te ? <Elapsed since={te.clock_in_at} /> : 'Not clocked in'}</div>
              <div class="foot muted ellipsis" style={{ marginTop: 2 }}>
                {te ? `${site?.name ?? 'Your site'} · since ${fmtTime(te.clock_in_at)}` : upcoming[0] ? `Next shift ${fmtDay(upcoming[0].starts_at)}, ${fmtTime(upcoming[0].starts_at)}` : 'No upcoming shifts'}
              </div>
            </div>
          </div>
          {te ? (
            <div class="stack" style={{ marginTop: 16, gap: 10 }}>
              <div class="row-between foot"><span class="muted">Patrol {run.data ? 'in progress' : 'not started'}</span><span class="tnum">{done}/{total} checkpoints</span></div>
              <div class="progress"><span style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
              <div class="grid-2" style={{ marginTop: 4 }}>
                <Button variant="primary" icon="scan" onClick={() => navigate('/g/scan')} data-testid="home-scan">Scan</Button>
                <Button variant="outline" icon="log-out" onClick={() => setClockOut(true)} data-testid="clock-out-btn">Clock out</Button>
              </div>
            </div>
          ) : (
            <Button variant="primary" size="lg" block style={{ marginTop: 16 }} onClick={() => navigate('/g/clock')} data-testid="home-clock-in">Clock in</Button>
          )}
        </div>

        {te && (
          <div class="qa-grid">
            <QA icon="scan" label="Scan" href="/g/scan" />
            <QA icon="note" label="Log entry" href="/g/dar" />
            <QA icon="alert" label="Incident" href="/g/report" />
            <QA icon="file" label="Post orders" href={`/g/post-orders/${te.site_id}`} />
          </div>
        )}

        {(drafts.data ?? []).length > 0 && (
          <div>
            <SectionLabel>Continue report</SectionLabel>
            <List>
              {drafts.data!.slice(0, 3).map((d) => (
                <Row key={d.id} icon="file" iconBg="var(--warning-soft)" iconColor="var(--warning)" title={d.title || 'Untitled incident'} sub={`Draft · saved on this phone · ${relTime(d.created_at)}`} chevron
                  onClick={() => navigate(`/g/report/${d.id}`)} testid="continue-draft" />
              ))}
            </List>
          </div>
        )}

        <div class="home-sos">
          <HoldButton label="Hold for SOS" onConfirm={() => void fireSos()} class="hold-sos" size={76} testid="home-sos"><b style={{ fontSize: 17 }}>SOS</b></HoldButton>
          <div class="grow">
            <div class="headline">Emergency</div>
            <div class="foot muted">Press and hold 2 seconds to alert the owners with your location. Call 911 first if anyone is in danger.</div>
          </div>
        </div>

        {!te && (
          <div>
            <SectionLabel>Upcoming shifts</SectionLabel>
            {shifts.loading ? <Skeleton h={100} r={16} /> : upcoming.length ? (
              <List>
                {upcoming.map((s) => <Row key={s.id} icon="calendar" title={fmtDay(s.starts_at)} sub={`${fmtTime(s.starts_at)} – ${fmtTime(s.ends_at)} · ${sites.data?.find((x) => x.id === s.site_id)?.name ?? ''}`} />)}
              </List>
            ) : <Empty icon="calendar" title="No shifts scheduled" body="Your schedule appears here when a supervisor assigns you." />}
          </div>
        )}

        <div>
          <SectionLabel>{staff ? 'Sites' : 'Your sites'}</SectionLabel>
          {sites.loading ? <Skeleton h={120} r={16} /> : sites.data?.length ? (
            <List>
              {sites.data.map((s) => (
                <Row key={s.id} icon={s.kind === 'apartment' ? 'building' : 'store'} iconBg="var(--gold-soft)" iconColor="var(--gold)"
                  title={s.name} sub={`Post orders · ${[s.address, s.city].filter(Boolean).join(', ')}`} chevron onClick={() => navigate(`/g/post-orders/${s.id}`)} testid="site-row" />
              ))}
            </List>
          ) : <Empty icon="building" title="No sites assigned yet" body="Ask your supervisor to assign you to a site." />}
        </div>
      </div>
      <ClockOutSheet open={clockOut} onClose={() => setClockOut(false)} />
    </Screen>
  );
}

function QA({ icon, label, href }: { icon: string; label: string; href: string }) {
  return <button class="qa" onClick={() => navigate(href)}><span class="qa-i"><Icon name={icon} /></span>{label}</button>;
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return <>{hms(now - Date.parse(since))}</>;
}

function DutyRing({ onDuty, since }: { onDuty: boolean; since?: string }) {
  const [, tick] = useState(0);
  useEffect(() => { if (!onDuty) return; const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, [onDuty]);
  const frac = onDuty && since ? Math.min(1, (Date.now() - Date.parse(since)) / (8 * 3600e3)) : 0;
  const r = 36, c = 2 * Math.PI * r;
  return (
    <div class="ring" aria-hidden="true">
      <svg viewBox="0 0 84 84">
        <circle cx="42" cy="42" r={r} fill="none" stroke={onDuty ? 'rgba(34,197,94,.18)' : 'var(--raised-2)'} stroke-width="6" />
        {onDuty && <circle cx="42" cy="42" r={r} fill="none" stroke="var(--success)" stroke-width="6" stroke-linecap="round" stroke-dasharray={`${c * Math.max(frac, 0.03)} ${c}`} />}
      </svg>
      <div class="ring-label">
        <span class="ring-icon" style={{ background: onDuty ? 'var(--success-soft)' : 'var(--raised)', color: onDuty ? 'var(--success)' : 'var(--text-2)' }}>
          <Icon name={onDuty ? 'shield-check' : 'clock'} size={26} />
        </span>
      </div>
    </div>
  );
}

import { Screen, TopBar, List, Row, SectionLabel, Empty, SkeletonList, Button } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId, memberId, isStaff } from '../../auth/session';
import { sitesFor, checkpointsFor } from '../../data/repos/queries';
import { onShift, openRun } from '../../data/guard';
import { listRecords } from '../../data/repos/records';
import { fmtTime } from '../../lib/format';
import { navigate } from '../../router';
import { GuardRight } from './common';
import type { Row as R } from '../../data/db';

const FLAG: Record<string, [string, string]> = {
  out_of_order: ['Out of order', 'pill-warning'], late: ['Late', 'pill-warning'], off_site: ['Off site', 'pill-danger'], duplicate: ['Repeat', 'pill-muted'], no_gps: ['No GPS', 'pill-muted'],
};
export function FlagPills({ flags }: { flags: string[] }) {
  return <>{flags.map((f) => <span key={f} class={`pill ${FLAG[f]?.[1] ?? 'pill-muted'}`}>{FLAG[f]?.[0] ?? f}</span>)}</>;
}

export function PatrolScreen() {
  const org = currentOrgId.value;
  const te = onShift.value;
  const sites = useData(() => sitesFor(org, memberId.value, isStaff.value), [org]);
  const cps = useData(() => checkpointsFor(org), [org]);
  const run = useData(() => (te ? openRun(te.site_id) : Promise.resolve(null)), [te?.id]);
  const scans = useData(async () => (te ? (await listRecords<R>('patrol_scans', org)).filter((s) => s.time_entry_id === te.id) : []), [te?.id]);
  const runs = useData(async () => (te ? (await listRecords<R>('patrol_tour_runs', org)).filter((r) => r.time_entry_id === te.id) : []), [te?.id]);

  if (te) {
    const site = sites.data?.find((s) => s.id === te.site_id);
    const siteCps = (cps.data ?? []).filter((c) => c.site_id === te.site_id);
    const runScans = (scans.data ?? []).filter((s) => run.data && s.tour_run_id === run.data.id);
    const doneIds = new Set(runScans.filter((s) => !(s.flags as string[]).includes('duplicate')).map((s) => s.checkpoint_id));
    const nextCp = siteCps.find((c) => !doneIds.has(c.id));
    return (
      <Screen tabbar>
        <TopBar title="Patrol" large right={<GuardRight />} sub={site?.name} />
        <div class="screen-body stack-lg">
          <div class="card stack">
            <div class="row-between"><span class="headline">{run.data ? 'Current tour' : 'Ready to start'}</span><span class="pill pill-gold tnum" data-testid="tour-progress">{doneIds.size}/{siteCps.length}</span></div>
            <div class="progress"><span style={{ width: `${siteCps.length ? (doneIds.size / siteCps.length) * 100 : 0}%` }} /></div>
            <div class="foot muted">{nextCp ? `Next: ${nextCp.name}` : run.data ? 'All checkpoints scanned' : 'Scan any checkpoint to start a tour.'}</div>
            <Button variant="primary" size="lg" block icon="scan" onClick={() => navigate('/g/scan')} data-testid="patrol-scan">Scan checkpoint</Button>
          </div>
          <div>
            <SectionLabel>Checkpoints</SectionLabel>
            <List>
              {siteCps.map((c) => {
                const s = runScans.filter((x) => x.checkpoint_id === c.id).at(-1);
                return (
                  <Row key={c.id} testid="checkpoint-row" icon={s ? 'check' : 'qr'} iconBg={s ? 'var(--success-soft)' : 'var(--raised-2)'} iconColor={s ? 'var(--success)' : 'var(--text-2)'}
                    title={`${c.seq}. ${c.name}`} sub={s ? `Scanned ${fmtTime(s.scanned_at as string)}` : c.id === nextCp?.id ? 'Next' : 'Not scanned yet'}
                    right={s ? <span class="row" style={{ gap: 4 }}><FlagPills flags={(s.flags as string[]).filter((f) => f !== 'no_gps')} /></span> : undefined} />
                );
              })}
            </List>
          </div>
          {(runs.data ?? []).length > 0 && (
            <div>
              <SectionLabel>Tours this shift</SectionLabel>
              <List>
                {(runs.data ?? []).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at))).map((r) => (
                  <Row key={r.id} icon="shield" title={`Started ${fmtTime(r.started_at as string)}`} sub={r.completed_at ? `Completed ${fmtTime(r.completed_at as string)}` : 'In progress'}
                    right={<span class="pill pill-muted tnum">{String(r.scanned_count ?? 0)}/{String(r.expected_count)}</span>} />
                ))}
              </List>
            </div>
          )}
        </div>
      </Screen>
    );
  }

  return (
    <Screen tabbar>
      <TopBar title="Patrol" large right={<GuardRight />} sub="Clock in to start a patrol tour." />
      <div class="screen-body">
        <Button variant="primary" size="lg" block onClick={() => navigate('/g/clock')}>Clock in</Button>
        {sites.loading ? <SkeletonList /> : !sites.data?.length ? (
          <Empty icon="qr" title="No checkpoints yet" body="Once you’re assigned to a site, its checkpoints appear here." />
        ) : sites.data.map((s) => (
          <div key={s.id}>
            <SectionLabel>{s.name}</SectionLabel>
            <List>{(cps.data ?? []).filter((c) => c.site_id === s.id).map((c) => <Row key={c.id} icon="qr" title={`${c.seq}. ${c.name}`} sub={`Code ${c.code.slice(0, 4)}-${c.code.slice(4)}`} />)}</List>
          </div>
        ))}
      </div>
    </Screen>
  );
}

export { Icon };

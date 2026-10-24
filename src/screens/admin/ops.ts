import { listRecords } from '../../data/repos/records';
import type { Row } from '../../data/db';
import type { Member, MemberStatus, Site, Checkpoint } from '../../data/types';

export interface OpsData {
  sites: Site[]; members: Member[]; status: MemberStatus[]; alerts: Row[]; incidents: Row[]; scans: Row[]; runs: Row[]; entries: Row[]; dars: Row[]; times: Row[]; checkpoints: Checkpoint[];
}
export async function loadOps(org: string | null): Promise<OpsData> {
  const [sites, members, status, alerts, incidents, scans, runs, entries, dars, times, checkpoints] = await Promise.all([
    listRecords<Site>('patrol_sites', org), listRecords<Member>('patrol_members', org), listRecords<MemberStatus>('patrol_member_status', org),
    listRecords<Row>('patrol_alerts', org), listRecords<Row>('patrol_incidents', org), listRecords<Row>('patrol_scans', org),
    listRecords<Row>('patrol_tour_runs', org), listRecords<Row>('patrol_dar_entries', org), listRecords<Row>('patrol_dars', org),
    listRecords<Row>('patrol_time_entries', org), listRecords<Checkpoint>('patrol_checkpoints', org),
  ]);
  return { sites, members, status, alerts, incidents: incidents.filter((i) => i.status !== 'draft'), scans, runs, entries, dars, times, checkpoints };
}

export interface SiteCompletion { site: Site; runs: number; complete: number; missed: number; late: number; pct: number; scanned: number; expected: number }
export function completionBySite(d: OpsData, sinceMs: number): SiteCompletion[] {
  return d.sites.filter((s) => s.active !== false).map((site) => {
    const runs = d.runs.filter((r) => r.site_id === site.id && Date.parse(r.started_at as string) >= sinceMs);
    const expected = runs.reduce((n, r) => n + Number(r.expected_count ?? 0), 0);
    const scanned = runs.reduce((n, r) => n + Math.min(Number(r.scanned_count ?? 0), Number(r.expected_count ?? 0)), 0);
    const finished = runs.filter((r) => Date.now() - Date.parse(r.started_at as string) > 60 * 60e3 || r.completed_at);
    const missed = finished.filter((r) => Number(r.scanned_count ?? 0) < Number(r.expected_count ?? 0)).length;
    const late = runs.filter((r) => r.late).length + d.scans.filter((s) => s.site_id === site.id && Date.parse(s.scanned_at as string) >= sinceMs && (s.flags as string[] ?? []).includes('late')).length;
    return { site, runs: runs.length, complete: runs.filter((r) => r.completed_at).length, missed, late, scanned, expected, pct: expected ? Math.round((scanned / expected) * 100) : 0 };
  });
}

import { listRecords } from './records';
import type { Category, Checkpoint, Member, Org, Shift, Site, SiteAccess, Subtype, TimeEntry, PublicSettings, OrgSettings, MemberStatus } from '../types';

export const sitesFor = async (orgId: string | null, memberId: string | null, staff: boolean) => {
  const sites = (await listRecords<Site>('patrol_sites', orgId)).filter((s) => s.active !== false);
  if (staff) return sites.sort((a, b) => a.name.localeCompare(b.name));
  const access = await listRecords<SiteAccess>('patrol_site_access', orgId);
  const mine = new Set(access.filter((a) => a.member_id === memberId).map((a) => a.site_id));
  return sites.filter((s) => mine.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));
};
export const checkpointsFor = async (orgId: string | null, siteId?: string) =>
  (await listRecords<Checkpoint>('patrol_checkpoints', orgId)).filter((c) => (!siteId || c.site_id === siteId) && c.active).sort((a, b) => a.seq - b.seq);
export const categoriesFor = async (orgId: string | null) =>
  (await listRecords<Category>('patrol_categories', orgId)).sort((a, b) => a.sort - b.sort);
export const subtypesFor = async (orgId: string | null) =>
  (await listRecords<Subtype>('patrol_subtypes', orgId)).sort((a, b) => a.sort - b.sort);
export const shiftsFor = async (orgId: string | null) =>
  (await listRecords<Shift>('patrol_shifts', orgId)).filter((s) => !s.cancelled_at).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
export const openTimeEntry = async (orgId: string | null, memberId: string | null) =>
  (await listRecords<TimeEntry>('patrol_time_entries', orgId)).find((t) => t.member_id === memberId && !t.clock_out_at) ?? null;
export const orgById = async (orgId: string | null) => (await listRecords<Org>('patrol_orgs')).find((o) => o.id === orgId) ?? null;
export const membersFor = async (orgId: string | null) => (await listRecords<Member>('patrol_members', orgId)).sort((a, b) => a.display_name.localeCompare(b.display_name));
export const publicSettings = async (orgId: string | null) => (await listRecords<PublicSettings>('patrol_public_settings', orgId))[0] ?? null;
export const orgSettings = async (orgId: string | null) => (await listRecords<OrgSettings>('patrol_org_settings', orgId))[0] ?? null;
export const memberStatuses = async (orgId: string | null) => listRecords<MemberStatus>('patrol_member_status', orgId);

/** Site name for history/schedule rows, including deactivated sites ("Name (inactive)"). QA bug (a). */
// Wrapped in an object: useData's setState would treat a bare function as an updater.
export const siteLabels = async (orgId: string | null): Promise<{ label: (id: string | null | undefined) => string }> => {
  const all = await listRecords<Site>('patrol_sites', orgId);
  return { label: (id) => { const s = all.find((x) => x.id === id); return s ? `${s.name}${s.active === false ? ' (inactive)' : ''}` : 'Unknown site'; } };
};

-- Lion Patrol v2 — row level security. Every helper is wrapped in a scalar subselect so
-- Postgres evaluates it once per statement (InitPlan). Clients have no write policies.
begin;

-- enable RLS + baseline grants on every patrol table
do $$
declare t text;
begin
  foreach t in array array[
    'patrol_orgs','patrol_org_settings','patrol_members','patrol_sites','patrol_site_access',
    'patrol_checkpoints','patrol_shifts','patrol_time_entries','patrol_location_pings',
    'patrol_member_status','patrol_tour_runs','patrol_scans','patrol_categories','patrol_subtypes',
    'patrol_incidents','patrol_incident_events','patrol_dars','patrol_dar_entries',
    'patrol_attachments','patrol_alerts','patrol_consents','patrol_invites',
    'patrol_invite_failures','patrol_share_links']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
  -- server-only tables
  revoke all on table public.patrol_invite_failures from authenticated;
end $$;

-- helper macro: (re)create a policy idempotently
create or replace function pg_temp.pol(p_name text, p_table text, p_cmd text, p_using text, p_check text default null)
returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  execute format('create policy %I on public.%I as permissive for %s to authenticated %s %s',
    p_name, p_table, p_cmd,
    case when p_using is not null then 'using (' || p_using || ')' else '' end,
    case when p_check is not null then 'with check (' || p_check || ')' else '' end);
end $$;

-- shorthand fragments
-- S = staff orgs, A = admin orgs, O = member orgs, M = my member ids, W = workable sites,
-- MS = my assigned sites, C = client sites
select pg_temp.pol('patrol_orgs_select', 'patrol_orgs', 'select', 'id = any ((select public.patrol_member_orgs())::uuid[])');
select pg_temp.pol('patrol_orgs_update_admin', 'patrol_orgs', 'update', 'id = any ((select public.patrol_admin_orgs())::uuid[])', 'id = any ((select public.patrol_admin_orgs())::uuid[])');

select pg_temp.pol('patrol_org_settings_select_staff', 'patrol_org_settings', 'select', 'org_id = any ((select public.patrol_staff_orgs())::uuid[])');
select pg_temp.pol('patrol_org_settings_update_admin', 'patrol_org_settings', 'update', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])');

select pg_temp.pol('patrol_members_select', 'patrol_members', 'select',
  'user_id = (select auth.uid()) or org_id = any ((select public.patrol_staff_orgs())::uuid[])');
select pg_temp.pol('patrol_members_update', 'patrol_members', 'update',
  'user_id = (select auth.uid()) or org_id = any ((select public.patrol_admin_orgs())::uuid[])',
  'user_id = (select auth.uid()) or org_id = any ((select public.patrol_admin_orgs())::uuid[])');

select pg_temp.pol('patrol_sites_select', 'patrol_sites', 'select',
  'org_id = any ((select public.patrol_staff_orgs())::uuid[]) or id = any ((select public.patrol_my_sites())::uuid[])');
select pg_temp.pol('patrol_sites_insert_admin', 'patrol_sites', 'insert', null, 'org_id = any ((select public.patrol_admin_orgs())::uuid[])');
select pg_temp.pol('patrol_sites_update_admin', 'patrol_sites', 'update', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])');
select pg_temp.pol('patrol_sites_delete_admin', 'patrol_sites', 'delete', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])');

select pg_temp.pol('patrol_site_access_select', 'patrol_site_access', 'select',
  'org_id = any ((select public.patrol_staff_orgs())::uuid[]) or member_id = any ((select public.patrol_my_member_ids())::uuid[])');
select pg_temp.pol('patrol_site_access_insert_admin', 'patrol_site_access', 'insert', null,
  'org_id = any ((select public.patrol_admin_orgs())::uuid[]) and exists (select 1 from public.patrol_sites s where s.id = site_id and s.org_id = patrol_site_access.org_id) and exists (select 1 from public.patrol_members m where m.id = member_id and m.org_id = patrol_site_access.org_id)');
select pg_temp.pol('patrol_site_access_delete_admin', 'patrol_site_access', 'delete', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])');

select pg_temp.pol('patrol_checkpoints_select', 'patrol_checkpoints', 'select',
  'org_id = any ((select public.patrol_staff_orgs())::uuid[]) or site_id = any ((select public.patrol_my_sites())::uuid[])');
select pg_temp.pol('patrol_checkpoints_insert_admin', 'patrol_checkpoints', 'insert', null,
  'org_id = any ((select public.patrol_admin_orgs())::uuid[]) and exists (select 1 from public.patrol_sites s where s.id = site_id and s.org_id = patrol_checkpoints.org_id)');
select pg_temp.pol('patrol_checkpoints_update_admin', 'patrol_checkpoints', 'update', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])');
select pg_temp.pol('patrol_checkpoints_delete_admin', 'patrol_checkpoints', 'delete', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])');

select pg_temp.pol('patrol_shifts_select', 'patrol_shifts', 'select',
  'org_id = any ((select public.patrol_staff_orgs())::uuid[]) or member_id = any ((select public.patrol_my_member_ids())::uuid[]) or (member_id is null and site_id = any ((select public.patrol_workable_sites())::uuid[]))');
select pg_temp.pol('patrol_shifts_insert_staff', 'patrol_shifts', 'insert', null, 'org_id = any ((select public.patrol_staff_orgs())::uuid[])');
select pg_temp.pol('patrol_shifts_update_staff', 'patrol_shifts', 'update', 'org_id = any ((select public.patrol_staff_orgs())::uuid[])', 'org_id = any ((select public.patrol_staff_orgs())::uuid[])');
select pg_temp.pol('patrol_shifts_delete_staff', 'patrol_shifts', 'delete', 'org_id = any ((select public.patrol_staff_orgs())::uuid[])');

select pg_temp.pol('patrol_time_entries_select', 'patrol_time_entries', 'select',
  'org_id = any ((select public.patrol_staff_orgs())::uuid[]) or member_id = any ((select public.patrol_my_member_ids())::uuid[])');
select pg_temp.pol('patrol_time_entries_insert_own', 'patrol_time_entries', 'insert', null,
  'member_id = public.patrol_member_id_in(org_id) and site_id = any ((select public.patrol_workable_sites())::uuid[])');
select pg_temp.pol('patrol_time_entries_update', 'patrol_time_entries', 'update',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[]) or org_id = any ((select public.patrol_staff_orgs())::uuid[])',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[]) or org_id = any ((select public.patrol_staff_orgs())::uuid[])');

drop policy if exists patrol_pings_select_staff on public.patrol_location_pings;
-- own rows are readable so idempotent replays (INSERT … ON CONFLICT DO NOTHING) pass RLS
select pg_temp.pol('patrol_pings_select', 'patrol_location_pings', 'select', 'org_id = any ((select public.patrol_staff_orgs())::uuid[]) or member_id = any ((select public.patrol_my_member_ids())::uuid[])');
select pg_temp.pol('patrol_pings_insert_own', 'patrol_location_pings', 'insert', null,
  'member_id = public.patrol_member_id_in(org_id) and exists (select 1 from public.patrol_time_entries t where t.id = time_entry_id and t.member_id = patrol_location_pings.member_id and t.clock_out_at is null)');

select pg_temp.pol('patrol_member_status_select', 'patrol_member_status', 'select',
  'org_id = any ((select public.patrol_staff_orgs())::uuid[]) or member_id = any ((select public.patrol_my_member_ids())::uuid[])');

select pg_temp.pol('patrol_tour_runs_select', 'patrol_tour_runs', 'select',
  'org_id = any ((select public.patrol_staff_orgs())::uuid[]) or member_id = any ((select public.patrol_my_member_ids())::uuid[]) or site_id = any ((select public.patrol_client_sites())::uuid[])');
select pg_temp.pol('patrol_tour_runs_insert_own', 'patrol_tour_runs', 'insert', null,
  'member_id = public.patrol_member_id_in(org_id) and site_id = any ((select public.patrol_workable_sites())::uuid[])');
select pg_temp.pol('patrol_tour_runs_update', 'patrol_tour_runs', 'update',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[]) or org_id = any ((select public.patrol_staff_orgs())::uuid[])',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[]) or org_id = any ((select public.patrol_staff_orgs())::uuid[])');

select pg_temp.pol('patrol_scans_select', 'patrol_scans', 'select',
  'org_id = any ((select public.patrol_staff_orgs())::uuid[]) or member_id = any ((select public.patrol_my_member_ids())::uuid[]) or site_id = any ((select public.patrol_client_sites())::uuid[])');
select pg_temp.pol('patrol_scans_insert_own', 'patrol_scans', 'insert', null,
  'member_id = public.patrol_member_id_in(org_id) and site_id = any ((select public.patrol_workable_sites())::uuid[])');

select pg_temp.pol('patrol_categories_select', 'patrol_categories', 'select', 'org_id = any ((select public.patrol_member_orgs())::uuid[])');
select pg_temp.pol('patrol_categories_insert_admin', 'patrol_categories', 'insert', null, 'org_id = any ((select public.patrol_admin_orgs())::uuid[])');
select pg_temp.pol('patrol_categories_update_admin', 'patrol_categories', 'update', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])');
select pg_temp.pol('patrol_categories_delete_admin', 'patrol_categories', 'delete', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])');

select pg_temp.pol('patrol_subtypes_select', 'patrol_subtypes', 'select', 'org_id = any ((select public.patrol_member_orgs())::uuid[])');
select pg_temp.pol('patrol_subtypes_insert_admin', 'patrol_subtypes', 'insert', null,
  'org_id = any ((select public.patrol_admin_orgs())::uuid[]) and exists (select 1 from public.patrol_categories c where c.id = category_id and c.org_id = patrol_subtypes.org_id)');
select pg_temp.pol('patrol_subtypes_update_admin', 'patrol_subtypes', 'update', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])');
select pg_temp.pol('patrol_subtypes_delete_admin', 'patrol_subtypes', 'delete', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])');

select pg_temp.pol('patrol_incidents_select', 'patrol_incidents', 'select',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[]) or (org_id = any ((select public.patrol_staff_orgs())::uuid[]) and status <> ''draft'') or (site_id = any ((select public.patrol_client_sites())::uuid[]) and client_visible and status <> ''draft'')');
select pg_temp.pol('patrol_incidents_insert_own', 'patrol_incidents', 'insert', null,
  'member_id = public.patrol_member_id_in(org_id) and site_id = any ((select public.patrol_workable_sites())::uuid[]) and status in (''draft'',''submitted'')');
-- column/transition rules live in trigger patrol_incidents_guard; staff changes use RPCs
select pg_temp.pol('patrol_incidents_update_own', 'patrol_incidents', 'update',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[])',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[])');
select pg_temp.pol('patrol_incidents_delete_own_draft', 'patrol_incidents', 'delete',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[]) and status = ''draft''');

select pg_temp.pol('patrol_incident_events_select', 'patrol_incident_events', 'select',
  'org_id = any ((select public.patrol_staff_orgs())::uuid[]) or exists (select 1 from public.patrol_incidents i where i.id = incident_id and i.member_id = any ((select public.patrol_my_member_ids())::uuid[]))');
select pg_temp.pol('patrol_incident_events_insert', 'patrol_incident_events', 'insert', null,
  'actor_id = public.patrol_member_id_in(org_id) and exists (select 1 from public.patrol_incidents i where i.id = incident_id and i.org_id = patrol_incident_events.org_id) and (org_id = any ((select public.patrol_staff_orgs())::uuid[]) or (kind = ''addendum'' and exists (select 1 from public.patrol_incidents i where i.id = incident_id and i.member_id = any ((select public.patrol_my_member_ids())::uuid[]))))');

select pg_temp.pol('patrol_dars_select', 'patrol_dars', 'select',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[]) or (org_id = any ((select public.patrol_staff_orgs())::uuid[]) and status <> ''open'') or (site_id = any ((select public.patrol_client_sites())::uuid[]) and client_visible)');
select pg_temp.pol('patrol_dars_insert_own', 'patrol_dars', 'insert', null,
  'member_id = public.patrol_member_id_in(org_id) and site_id = any ((select public.patrol_workable_sites())::uuid[]) and status in (''open'',''submitted'')');
select pg_temp.pol('patrol_dars_update_own', 'patrol_dars', 'update',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[])',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[])');

select pg_temp.pol('patrol_dar_entries_select', 'patrol_dar_entries', 'select',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[]) or exists (select 1 from public.patrol_dars d where d.id = dar_id)');
select pg_temp.pol('patrol_dar_entries_insert_own', 'patrol_dar_entries', 'insert', null,
  'member_id = public.patrol_member_id_in(org_id)');
select pg_temp.pol('patrol_dar_entries_update_own', 'patrol_dar_entries', 'update',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[])',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[])');

select pg_temp.pol('patrol_attachments_select', 'patrol_attachments', 'select',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[]) or (case parent_type'
  || ' when ''incident'' then exists (select 1 from public.patrol_incidents p where p.id = parent_id)'
  || ' when ''dar_entry'' then exists (select 1 from public.patrol_dar_entries p where p.id = parent_id)'
  || ' when ''scan'' then exists (select 1 from public.patrol_scans p where p.id = parent_id)'
  || ' when ''alert'' then exists (select 1 from public.patrol_alerts p where p.id = parent_id)'
  || ' when ''site'' then exists (select 1 from public.patrol_sites p where p.id = parent_id)'
  || ' else false end)');
select pg_temp.pol('patrol_attachments_insert_own', 'patrol_attachments', 'insert', null,
  'member_id = public.patrol_member_id_in(org_id)');
select pg_temp.pol('patrol_attachments_update_own', 'patrol_attachments', 'update',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[])',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[])');
select pg_temp.pol('patrol_attachments_delete', 'patrol_attachments', 'delete',
  'org_id = any ((select public.patrol_admin_orgs())::uuid[]) or (member_id = any ((select public.patrol_my_member_ids())::uuid[]) and upload_status = ''pending'')');

select pg_temp.pol('patrol_alerts_select', 'patrol_alerts', 'select',
  'org_id = any ((select public.patrol_staff_orgs())::uuid[]) or member_id = any ((select public.patrol_my_member_ids())::uuid[])');
select pg_temp.pol('patrol_alerts_insert_own', 'patrol_alerts', 'insert', null,
  'member_id = public.patrol_member_id_in(org_id) and org_id = any ((select public.patrol_worker_orgs())::uuid[]) and status = ''open''');

select pg_temp.pol('patrol_consents_select', 'patrol_consents', 'select',
  'member_id = any ((select public.patrol_my_member_ids())::uuid[]) or org_id = any ((select public.patrol_staff_orgs())::uuid[])');
select pg_temp.pol('patrol_consents_insert_own', 'patrol_consents', 'insert', null,
  'member_id = public.patrol_member_id_in(org_id)');

select pg_temp.pol('patrol_invites_select_admin', 'patrol_invites', 'select', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])');
select pg_temp.pol('patrol_invites_update_admin', 'patrol_invites', 'update', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])', 'org_id = any ((select public.patrol_admin_orgs())::uuid[])');

select pg_temp.pol('patrol_share_links_select_staff', 'patrol_share_links', 'select', 'org_id = any ((select public.patrol_staff_orgs())::uuid[])');
select pg_temp.pol('patrol_share_links_update_staff', 'patrol_share_links', 'update', 'org_id = any ((select public.patrol_staff_orgs())::uuid[])', 'org_id = any ((select public.patrol_staff_orgs())::uuid[])');

commit;

-- Lion Patrol v2 — pass 9, chunk 1 (Karim real-account bugs A1–A4, A8). Re-runnable; patrol_* objects only.
--  * A1: clock-in GPS status + logged owner override; staff (not only guards) must be inside the geofence
--        or give an override reason. Guards are never allowed to override.
--  * A2/A3: owner confirm / edit hours / void with reason on time entries (history is never deleted:
--        voided rows stay, edits keep the original clock-out).
--  * A3: owner alert for any shift still open after 16 hours (server-side, same cron detector).
--  * A4: per-site DAR auto-share + owner share/unshare RPC.
--  * Audit log (owners/admins read; anyone in the org appends their own actions through one RPC).
begin;

-- ===================================================================== audit log
create table if not exists public.patrol_audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  actor_id uuid references public.patrol_members(id) on delete set null,
  actor_name text,
  kind text not null check (kind in ('clock_in_override', 'timesheet_confirm', 'timesheet_edit', 'timesheet_void', 'timesheet_unvoid',
                                     'codes_viewed', 'dar_shared', 'dar_unshared', 'dar_autoshare', 'pin_admin_switch')),
  entity_table text,
  entity_id uuid,
  site_id uuid references public.patrol_sites(id) on delete set null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists patrol_audit_log_org_idx on public.patrol_audit_log(org_id, created_at desc);
alter table public.patrol_audit_log enable row level security;
revoke all on table public.patrol_audit_log from anon;
grant select on table public.patrol_audit_log to authenticated;
drop policy if exists patrol_audit_log_select on public.patrol_audit_log;
create policy patrol_audit_log_select on public.patrol_audit_log for select to authenticated
  using (org_id = any ((select public.patrol_admin_orgs())::uuid[]));

-- Append-only: the actor is always the caller (never client-supplied). No update/delete grants.
create or replace function public.patrol_log_audit(p_org uuid, p_kind text, p_entity_table text default null, p_entity_id uuid default null,
                                                   p_site uuid default null, p_detail text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor uuid; v_name text; v_id uuid;
begin
  if not (p_org = any(public.patrol_worker_orgs())) then raise exception 'not_allowed' using errcode = '42501'; end if;
  v_actor := public.patrol_member_id_in(p_org);
  select display_name into v_name from public.patrol_members where id = v_actor;
  if p_site is not null and not exists (select 1 from public.patrol_sites s where s.id = p_site and s.org_id = p_org) then p_site := null; end if;
  insert into public.patrol_audit_log (org_id, actor_id, actor_name, kind, entity_table, entity_id, site_id, detail)
  values (p_org, v_actor, v_name, p_kind, nullif(p_entity_table, ''), p_entity_id, p_site, left(coalesce(p_detail, ''), 1000))
  returning id into v_id;
  return v_id;
end $$;

-- ===================================================================== A1 + A2/A3: time entry columns
alter table public.patrol_time_entries add column if not exists clock_in_gps_status text
  check (clock_in_gps_status is null or clock_in_gps_status in ('ok', 'outside', 'unavailable', 'no_site_pin'));
alter table public.patrol_time_entries add column if not exists clock_in_distance_m integer;
alter table public.patrol_time_entries add column if not exists clock_in_override_reason text;
alter table public.patrol_time_entries add column if not exists clock_out_gps_status text
  check (clock_out_gps_status is null or clock_out_gps_status in ('ok', 'outside', 'unavailable', 'no_site_pin'));
alter table public.patrol_time_entries add column if not exists owner_confirmed_by uuid references public.patrol_members(id) on delete set null;
alter table public.patrol_time_entries add column if not exists edited_at timestamptz;
alter table public.patrol_time_entries add column if not exists edited_by uuid references public.patrol_members(id) on delete set null;
alter table public.patrol_time_entries add column if not exists edit_reason text;
alter table public.patrol_time_entries add column if not exists original_clock_out_at timestamptz;
alter table public.patrol_time_entries add column if not exists voided_at timestamptz;
alter table public.patrol_time_entries add column if not exists voided_by uuid references public.patrol_members(id) on delete set null;
alter table public.patrol_time_entries add column if not exists void_reason text;

-- Authors (guards) may only clock out: the new owner-only columns are kept as they were.
create or replace function public.patrol_time_entries_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if new.id <> old.id or new.org_id <> old.org_id or new.member_id <> old.member_id then
    raise exception 'immutable_columns' using errcode = '42501';
  end if;
  if old.org_id = any(public.patrol_staff_orgs()) then return new; end if;
  if old.clock_out_at is not null then return old; end if;  -- replayed clock-out
  new.site_id := old.site_id;
  new.shift_id := old.shift_id;
  new.clock_in_at := old.clock_in_at;
  new.clock_in_lat := old.clock_in_lat;
  new.clock_in_lng := old.clock_in_lng;
  new.clock_in_accuracy_m := old.clock_in_accuracy_m;
  new.clock_in_gps_status := old.clock_in_gps_status;
  new.clock_in_distance_m := old.clock_in_distance_m;
  new.clock_in_override_reason := old.clock_in_override_reason;
  new.owner_confirmed_by := old.owner_confirmed_by;
  new.edited_at := old.edited_at; new.edited_by := old.edited_by; new.edit_reason := old.edit_reason;
  new.original_clock_out_at := old.original_clock_out_at;
  new.voided_at := old.voided_at; new.voided_by := old.voided_by; new.void_reason := old.void_reason;
  new.gps_notice_accepted_at := old.gps_notice_accepted_at;
  new.created_at := old.created_at;
  return new;
end $$;

-- Geofenced clock-in. Guards: inside the fence with a GPS fix, no exceptions (unchanged).
-- Owners/admins/supervisors: same check, unless they give an override reason (stored on the row and
-- in the audit log by the app). Sites without a pin always pass.
create or replace function public.patrol_time_entries_geofence()
returns trigger language plpgsql set search_path = public as $$
declare v_site public.patrol_sites; v_role public.patrol_role; v_d double precision; v_inside boolean;
begin
  if current_user <> 'authenticated' then return new; end if;
  select role into v_role from public.patrol_members where id = new.member_id;
  select * into v_site from public.patrol_sites where id = new.site_id;
  if v_site.lat is null or v_site.lng is null then
    new.clock_in_gps_status := coalesce(new.clock_in_gps_status, 'no_site_pin');
    return new;
  end if;
  if new.clock_in_lat is null or new.clock_in_lng is null then
    v_inside := false;
    new.clock_in_gps_status := 'unavailable';
    new.clock_in_distance_m := null;
  else
    v_d := public.patrol_distance_m(new.clock_in_lat, new.clock_in_lng, v_site.lat, v_site.lng);
    v_inside := v_d <= v_site.geofence_m + least(coalesce(new.clock_in_accuracy_m, 0), 100);
    new.clock_in_gps_status := case when v_inside then 'ok' else 'outside' end;
    new.clock_in_distance_m := round(v_d)::integer;
  end if;
  if v_inside then
    new.clock_in_override_reason := null;
    return new;
  end if;
  if v_role is not distinct from 'guard' or v_role is null then
    if new.clock_in_lat is null then raise exception 'clock_in_gps_required' using errcode = '23514'; end if;
    raise exception 'outside_geofence' using errcode = '23514';
  end if;
  if length(trim(coalesce(new.clock_in_override_reason, ''))) < 3 then
    raise exception 'geofence_override_required' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists patrol_08_geofence on public.patrol_time_entries;
create trigger patrol_08_geofence before insert on public.patrol_time_entries
  for each row execute function public.patrol_time_entries_geofence();

-- ===================================================================== A3: open-shift owner alert (16 h)
alter table public.patrol_owner_alerts drop constraint if exists patrol_owner_alerts_kind_check;
alter table public.patrol_owner_alerts add constraint patrol_owner_alerts_kind_check
  check (kind in ('missed_checkpoint', 'overdue_patrol', 'no_show', 'geofence', 'guard_card', 'long_shift'));

create or replace function public.patrol_check_owner_alerts(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n integer := 0; v_c integer; v_settings public.patrol_org_settings;
begin
  -- auth.uid() is null only for privileged SQL sessions (anon has no EXECUTE).
  if auth.uid() is not null and not (p_org = any(public.patrol_worker_orgs())) then
    return jsonb_build_object('created', 0);
  end if;
  select * into v_settings from public.patrol_org_settings where org_id = p_org;

  -- Missed checkpoints: a round still open past its time limit with checkpoints unscanned.
  insert into public.patrol_owner_alerts (org_id, kind, dedupe_key, site_id, member_id, tour_run_id, time_entry_id, title, body)
  select r.org_id, 'missed_checkpoint', 'missed:' || r.id, r.site_id, r.member_id, r.id, r.time_entry_id,
         'Missed checkpoints at ' || s.name,
         coalesce(m.display_name, 'Guard') || ' scanned ' || r.scanned_count || ' of ' || r.expected_count
           || ' checkpoints; round started ' || to_char(r.started_at at time zone coalesce(s.timezone, 'America/Los_Angeles'), 'HH12:MI AM') || '.'
    from public.patrol_tour_runs r
    join public.patrol_sites s on s.id = r.site_id
    left join public.patrol_members m on m.id = r.member_id
   where r.org_id = p_org and r.completed_at is null and r.expected_count > 0 and r.scanned_count < r.expected_count
     and r.started_at > now() - interval '2 days'
     and r.started_at + make_interval(mins => coalesce(s.tour_max_duration_min, v_settings.tour_max_duration_min, 30)) < now()
  on conflict (org_id, dedupe_key) do nothing;
  get diagnostics v_c = row_count; v_n := v_n + v_c;

  -- Overdue patrol: on duty but no round started within interval + time limit (+10 min grace).
  insert into public.patrol_owner_alerts (org_id, kind, dedupe_key, site_id, member_id, time_entry_id, title, body)
  select t.org_id, 'overdue_patrol',
         'overdue:' || t.id || ':' || floor(extract(epoch from (now() - coalesce(lr.started_at, t.clock_in_at)))
           / (60 * (coalesce(s.tour_interval_min, v_settings.tour_interval_min, 60) + coalesce(s.tour_max_duration_min, v_settings.tour_max_duration_min, 30))))::text
           || ':' || coalesce(lr.id::text, 'none'),
         t.site_id, t.member_id, t.id,
         'Patrol round overdue at ' || s.name,
         coalesce(m.display_name, 'Guard') || ' has not started a patrol round since '
           || to_char(coalesce(lr.started_at, t.clock_in_at) at time zone coalesce(s.timezone, 'America/Los_Angeles'), 'HH12:MI AM') || '.'
    from public.patrol_time_entries t
    join public.patrol_sites s on s.id = t.site_id
    left join public.patrol_members m on m.id = t.member_id
    left join lateral (select r.id, r.started_at from public.patrol_tour_runs r where r.time_entry_id = t.id order by r.started_at desc limit 1) lr on true
   where t.org_id = p_org and t.clock_out_at is null and t.voided_at is null and t.clock_in_at > now() - interval '24 hours'
     and exists (select 1 from public.patrol_checkpoints c where c.site_id = t.site_id and c.active)
     and coalesce(lr.started_at, t.clock_in_at)
         + make_interval(mins => coalesce(s.tour_interval_min, v_settings.tour_interval_min, 60) + coalesce(s.tour_max_duration_min, v_settings.tour_max_duration_min, 30) + 10) < now()
  on conflict (org_id, dedupe_key) do nothing;
  get diagnostics v_c = row_count; v_n := v_n + v_c;

  -- No-show: scheduled guard not clocked in 10 minutes after shift start.
  insert into public.patrol_owner_alerts (org_id, kind, dedupe_key, site_id, member_id, shift_id, title, body)
  select sh.org_id, 'no_show', 'noshow:' || sh.id, sh.site_id, sh.member_id, sh.id,
         'No-show at ' || s.name,
         coalesce(m.display_name, 'Guard') || ' has not clocked in for the shift that started '
           || to_char(sh.starts_at at time zone coalesce(s.timezone, 'America/Los_Angeles'), 'HH12:MI AM') || '.'
    from public.patrol_shifts sh
    join public.patrol_sites s on s.id = sh.site_id
    left join public.patrol_members m on m.id = sh.member_id
   where sh.org_id = p_org and sh.member_id is not null and sh.cancelled_at is null
     and sh.starts_at + interval '10 minutes' < now() and sh.ends_at > now()
     and not exists (select 1 from public.patrol_time_entries t
                      where t.member_id = sh.member_id and t.clock_in_at > sh.starts_at - interval '2 hours'
                        and t.clock_in_at < sh.ends_at)
  on conflict (org_id, dedupe_key) do nothing;
  get diagnostics v_c = row_count; v_n := v_n + v_c;

  -- Guard cards (item 23): reminder 30 days before expiry, and again once expired.
  insert into public.patrol_owner_alerts (org_id, kind, dedupe_key, member_id, title, body)
  select gc.org_id, 'guard_card',
         case when gc.expires_on < current_date then 'cardexp:' else 'card30:' end || gc.member_id || ':' || gc.expires_on,
         gc.member_id,
         case when gc.expires_on < current_date then 'Guard card expired: ' else 'Guard card expires soon: ' end || coalesce(m.display_name, 'Guard'),
         'WA guard card ' || coalesce(gc.card_no, '') || case when gc.expires_on < current_date then ' expired on ' else ' expires on ' end
           || to_char(gc.expires_on, 'Mon DD, YYYY') || '.'
    from public.patrol_guard_cards gc
    join public.patrol_members m on m.id = gc.member_id and m.status = 'active'
   where gc.org_id = p_org and gc.expires_on is not null and gc.expires_on <= current_date + 30
  on conflict (org_id, dedupe_key) do nothing;
  get diagnostics v_c = row_count; v_n := v_n + v_c;

  -- Pass 9 A3: a shift still open 16 h after clock-in (forgot to clock out?). One alert per entry.
  -- Nothing is clocked out automatically: the owner corrects or voids it in Timesheets.
  insert into public.patrol_owner_alerts (org_id, kind, dedupe_key, site_id, member_id, time_entry_id, title, body)
  select t.org_id, 'long_shift', 'long:' || t.id, t.site_id, t.member_id, t.id,
         'Shift open over 16 hours at ' || s.name,
         coalesce(m.display_name, 'Guard') || ' clocked in '
           || to_char(t.clock_in_at at time zone coalesce(s.timezone, 'America/Los_Angeles'), 'Mon DD, HH12:MI AM')
           || ' PT and has not clocked out. Forgot to clock out? Fix or void it in Timesheets.'
    from public.patrol_time_entries t
    join public.patrol_sites s on s.id = t.site_id
    left join public.patrol_members m on m.id = t.member_id
   where t.org_id = p_org and t.clock_out_at is null and t.voided_at is null
     and t.clock_in_at < now() - interval '16 hours'
  on conflict (org_id, dedupe_key) do nothing;
  get diagnostics v_c = row_count; v_n := v_n + v_c;

  return jsonb_build_object('created', v_n);
end $$;

-- ===================================================================== A4: DAR sharing
alter table public.patrol_sites add column if not exists auto_share_dars boolean not null default false;

-- Runs after patrol_20_submit (trigger names fire alphabetically): a DAR submitted at a site with
-- auto-share on becomes client-visible. Never un-shares; the org-wide auto-share still applies too.
create or replace function public.patrol_dars_site_autoshare()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status::text <> 'submitted' or new.client_visible then return new; end if;
  if tg_op = 'UPDATE' and old.status::text <> 'open' then return new; end if;
  if exists (select 1 from public.patrol_sites s where s.id = new.site_id and s.auto_share_dars) then
    new.client_visible := true;
    new.sent_to_client_at := coalesce(new.sent_to_client_at, now());
  end if;
  return new;
end $$;
drop trigger if exists patrol_21_site_autoshare on public.patrol_dars;
create trigger patrol_21_site_autoshare before insert or update on public.patrol_dars
  for each row execute function public.patrol_dars_site_autoshare();

-- Owner/admin/supervisor share or un-share one DAR with the site's client portal (logged).
create or replace function public.patrol_set_dar_client_visible(p_id uuid, p_visible boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_dar public.patrol_dars;
begin
  select * into v_dar from public.patrol_dars where id = p_id for update;
  if v_dar.id is null or v_dar.status = 'open' or not (v_dar.org_id = any(public.patrol_staff_orgs())) then
    raise exception 'not_found' using errcode = '42501';
  end if;
  update public.patrol_dars set client_visible = p_visible,
    sent_to_client_at = case when p_visible then coalesce(sent_to_client_at, now()) else sent_to_client_at end
  where id = p_id;
  perform public.patrol_log_audit(v_dar.org_id, case when p_visible then 'dar_shared' else 'dar_unshared' end, 'patrol_dars', p_id, v_dar.site_id,
                                  coalesce(v_dar.report_no, v_dar.report_date::text));
end $$;

-- ===================================================================== grants
do $$
begin
  revoke all on function public.patrol_log_audit(uuid, text, text, uuid, uuid, text) from public, anon;
  grant execute on function public.patrol_log_audit(uuid, text, text, uuid, uuid, text) to authenticated;
  revoke all on function public.patrol_set_dar_client_visible(uuid, boolean) from public, anon;
  grant execute on function public.patrol_set_dar_client_visible(uuid, boolean) to authenticated;
  revoke all on function public.patrol_check_owner_alerts(uuid) from public, anon;
  grant execute on function public.patrol_check_owner_alerts(uuid) to authenticated;
  revoke all on function public.patrol_time_entries_geofence() from public, anon, authenticated;
  revoke all on function public.patrol_dars_site_autoshare() from public, anon, authenticated;
end $$;

commit;

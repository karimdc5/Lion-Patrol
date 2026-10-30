-- Lion Patrol v2 — pass 7 (Karim feedback items 9/13, 15, 16, 18, 22 + portal media).
-- Only patrol_* objects (plus patrol-media scoped storage policies). Re-runnable. Deletes nothing.
--  * patrol_redeem_invite: never updates an existing member's name/role; client invites can't be
--    redeemed by an account that already works for a company (separate identities).
--  * Geofenced clock-in for guards (server check mirrors the app check).
--  * Last seen: scans / log entries with GPS update patrol_member_status while on duty.
--  * Timesheets: guard confirmation columns; time records can't be cascaded away by deleting a site.
--  * Owner-only alerts table (owners/admins only via RLS) + detector RPC + geofence-block report.
--  * patrol_add_shift_by_names: lets the owner's chat assistant schedule shifts by site/guard name.
--  * Portal: category-specific fields (incident.extra) + client-visible BOLO photos.
begin;

-- ---------- 9/13: invite redemption keeps identities separate ----------
create or replace function public.patrol_redeem_invite(p_code text, p_display_name text, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_inv public.patrol_invites;
  v_member public.patrol_members;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if (select count(*) from public.patrol_invite_failures
      where user_id = v_uid and failed_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  select * into v_inv from public.patrol_invites
   where code_hash = public.patrol_sha256(public.patrol_normalize_code(p_code))
   for update;
  if v_inv.id is null or v_inv.revoked_at is not null or v_inv.expires_at < now()
     or v_inv.uses >= v_inv.max_uses
     or (v_inv.email is not null and v_inv.email <> v_email) then
    insert into public.patrol_invite_failures (user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'error', 'invalid_invite');
  end if;

  -- A client code redeemed by someone who already works for a company (any org) would mix the
  -- two identities (the "Client client" bug). Refuse; the invite stays unused.
  if v_inv.role = 'client' and exists (
    select 1 from public.patrol_members m where m.user_id = v_uid and m.role <> 'client') then
    return jsonb_build_object('ok', false, 'error', 'use_separate_account');
  end if;

  select * into v_member from public.patrol_members where org_id = v_inv.org_id and user_id = v_uid;
  if v_member.id is null then
    insert into public.patrol_members (org_id, user_id, role, display_name, email, phone, invited_by)
    values (v_inv.org_id, v_uid, v_inv.role,
            coalesce(nullif(trim(p_display_name), ''), v_inv.display_name, split_part(v_email, '@', 1), 'Guard'),
            nullif(v_email, ''), nullif(trim(p_phone), ''), v_inv.created_by)
    returning * into v_member;
  elsif v_member.status <> 'active' then
    -- disabled members stay disabled; an owner restores access in People
    return jsonb_build_object('ok', false, 'error', 'member_disabled');
  end if;
  -- Existing members: the member row (name, role, phone) is never touched here.

  insert into public.patrol_site_access (org_id, site_id, member_id)
  select v_inv.org_id, sid, v_member.id from unnest(v_inv.site_ids) sid
  on conflict do nothing;

  update public.patrol_invites set uses = uses + 1 where id = v_inv.id;
  return jsonb_build_object('ok', true, 'org_id', v_inv.org_id, 'member_id', v_member.id, 'role', v_member.role);
end $$;

-- ---------- 11: no client-visibility field on the guard's form ----------
update public.patrol_categories
   set field_config = jsonb_set(field_config, '{extra}', coalesce((
         select jsonb_agg(e) from jsonb_array_elements(field_config -> 'extra') e where e ->> 'key' <> 'client_notified'), '[]'::jsonb))
 where field_config -> 'extra' @> '[{"key": "client_notified"}]'::jsonb;

-- ---------- geo helper ----------
create or replace function public.patrol_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = public as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- ---------- 18: geofenced clock-in (guards only; owners/staff exempt) ----------
-- Invoker rights so current_user is the API role (the guard can read their own member row + site).
create or replace function public.patrol_time_entries_geofence()
returns trigger language plpgsql set search_path = public as $$
declare v_site public.patrol_sites; v_role public.patrol_role; v_d double precision;
begin
  if current_user <> 'authenticated' then return new; end if;
  select role into v_role from public.patrol_members where id = new.member_id;
  if v_role is distinct from 'guard' then return new; end if;
  select * into v_site from public.patrol_sites where id = new.site_id;
  if v_site.lat is null or v_site.lng is null then return new; end if;
  if new.clock_in_lat is null or new.clock_in_lng is null then
    raise exception 'clock_in_gps_required' using errcode = '23514';
  end if;
  v_d := public.patrol_distance_m(new.clock_in_lat, new.clock_in_lng, v_site.lat, v_site.lng);
  if v_d > v_site.geofence_m + least(coalesce(new.clock_in_accuracy_m, 0), 100) then
    raise exception 'outside_geofence' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists patrol_08_geofence on public.patrol_time_entries;
create trigger patrol_08_geofence before insert on public.patrol_time_entries
  for each row execute function public.patrol_time_entries_geofence();

-- ---------- 22: last seen from scans / log entries (only while on duty for that shift) ----------
create or replace function public.patrol_status_from_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_at timestamptz; v_te uuid;
begin
  if new.lat is null or new.lng is null then return null; end if;
  if tg_table_name = 'patrol_scans' then v_at := new.scanned_at; v_te := new.time_entry_id;
  else
    v_at := new.occurred_at;
    select time_entry_id into v_te from public.patrol_dars where id = new.dar_id;
  end if;
  update public.patrol_member_status
     set lat = new.lat, lng = new.lng, accuracy_m = new.accuracy_m, last_ping_at = v_at
   where member_id = new.member_id and on_duty and time_entry_id = v_te
     and (last_ping_at is null or last_ping_at < v_at);
  return null;
end $$;
drop trigger if exists patrol_31_status on public.patrol_scans;
create trigger patrol_31_status after insert on public.patrol_scans
  for each row execute function public.patrol_status_from_activity();
drop trigger if exists patrol_31_status on public.patrol_dar_entries;
create trigger patrol_31_status after insert on public.patrol_dar_entries
  for each row execute function public.patrol_status_from_activity();

-- ---------- 15: timesheets ----------
alter table public.patrol_time_entries add column if not exists confirmed_at timestamptz;
alter table public.patrol_time_entries add column if not exists confirmed_minutes integer check (confirmed_minutes is null or confirmed_minutes between 0 and 2880);
alter table public.patrol_time_entries add column if not exists timesheet_note text;

-- Time records are kept 3+ years: a site that has them can't be deleted by the app (deactivate it).
create or replace function public.patrol_sites_keep_time_records()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' and exists (
    select 1 from public.patrol_time_entries t where t.site_id = old.id and t.clock_in_at > now() - interval '3 years') then
    raise exception 'site_has_time_records' using errcode = 'P0001', hint = 'Mark the site inactive instead.';
  end if;
  return old;
end $$;
drop trigger if exists patrol_05_keep_time on public.patrol_sites;
create trigger patrol_05_keep_time before delete on public.patrol_sites
  for each row execute function public.patrol_sites_keep_time_records();

-- ---------- 18: owner-only alerts ----------
create table if not exists public.patrol_owner_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  kind text not null check (kind in ('missed_checkpoint', 'overdue_patrol', 'no_show', 'geofence')),
  dedupe_key text not null,
  site_id uuid references public.patrol_sites(id) on delete cascade,
  member_id uuid references public.patrol_members(id) on delete set null,
  shift_id uuid references public.patrol_shifts(id) on delete set null,
  tour_run_id uuid references public.patrol_tour_runs(id) on delete set null,
  time_entry_id uuid references public.patrol_time_entries(id) on delete set null,
  title text not null,
  body text not null default '',
  lat double precision, lng double precision,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.patrol_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, dedupe_key)
);
create index if not exists patrol_owner_alerts_org_idx on public.patrol_owner_alerts(org_id, created_at desc);

alter table public.patrol_owner_alerts enable row level security;
revoke all on table public.patrol_owner_alerts from anon;
revoke all on table public.patrol_owner_alerts from authenticated;
grant select, update on table public.patrol_owner_alerts to authenticated;
-- Owners/admins only. Guards, supervisors and clients get no rows (no insert/delete policy at all:
-- rows are only created by the security-definer functions below).
drop policy if exists patrol_owner_alerts_select on public.patrol_owner_alerts;
create policy patrol_owner_alerts_select on public.patrol_owner_alerts for select to authenticated
  using (org_id = any ((select public.patrol_admin_orgs())::uuid[]));
drop policy if exists patrol_owner_alerts_update on public.patrol_owner_alerts;
create policy patrol_owner_alerts_update on public.patrol_owner_alerts for update to authenticated
  using (org_id = any ((select public.patrol_admin_orgs())::uuid[]))
  with check (org_id = any ((select public.patrol_admin_orgs())::uuid[]));

create or replace function public.patrol_owner_alerts_guard()
returns trigger language plpgsql set search_path = public as $$
declare v_ack timestamptz := new.acknowledged_at;
begin
  if current_user <> 'authenticated' then return new; end if;
  new := old;  -- owners may only acknowledge
  new.acknowledged_at := v_ack;
  new.acknowledged_by := case when v_ack is null then null else public.patrol_member_id_in(old.org_id) end;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists patrol_10_guard on public.patrol_owner_alerts;
create trigger patrol_10_guard before update on public.patrol_owner_alerts
  for each row execute function public.patrol_owner_alerts_guard();

-- Detector. Any worker/owner device of the org calls it periodically (no server cron needed).
-- Returns only a count, never alert contents, so guards' devices learn nothing.
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
   where t.org_id = p_org and t.clock_out_at is null and t.clock_in_at > now() - interval '24 hours'
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

  return jsonb_build_object('created', v_n);
end $$;

-- The app blocks clock-in outside the geofence; it reports the blocked attempt here for owners.
create or replace function public.patrol_report_geofence_block(p_site uuid, p_lat double precision, p_lng double precision, p_accuracy double precision default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_site public.patrol_sites; v_member uuid; v_name text; v_d double precision;
begin
  select * into v_site from public.patrol_sites where id = p_site;
  if v_site.id is null or not (p_site = any(public.patrol_workable_sites())) then return; end if;
  v_member := public.patrol_member_id_in(v_site.org_id);
  select display_name into v_name from public.patrol_members where id = v_member;
  v_d := case when p_lat is null or v_site.lat is null then null else public.patrol_distance_m(p_lat, p_lng, v_site.lat, v_site.lng) end;
  insert into public.patrol_owner_alerts (org_id, kind, dedupe_key, site_id, member_id, title, body, lat, lng)
  values (v_site.org_id, 'geofence', 'geofence:' || v_member || ':' || to_char(now(), 'YYYYMMDDHH24MI'), p_site, v_member,
          'Clock-in blocked outside ' || v_site.name,
          coalesce(v_name, 'A guard') || ' tried to clock in '
            || coalesce(round(v_d)::text || ' m from the site', 'without a GPS fix') || '.',
          p_lat, p_lng)
  on conflict (org_id, dedupe_key) do nothing;
end $$;

-- ---------- 16: schedule by name (owner's chat assistant via the Supabase connector) ----------
-- Matches the site by code or name and the guard by display name or email (case-insensitive,
-- must be unique). Callable by staff of the org, or by a privileged connector session.
create or replace function public.patrol_add_shift_by_names(
  p_org uuid, p_site text, p_guard text, p_starts_at timestamptz, p_ends_at timestamptz, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_member uuid; v_n integer; v_id uuid;
begin
  -- auth.uid() is null only for privileged SQL sessions (the connector); anon has no EXECUTE.
  if auth.uid() is not null and not (p_org = any(public.patrol_staff_orgs())) then
    raise exception 'not_staff' using errcode = '42501';
  end if;
  if p_ends_at <= p_starts_at then raise exception 'ends_before_start' using errcode = '22023'; end if;
  select count(*), min(id::text)::uuid into v_n, v_site from public.patrol_sites
   where org_id = p_org and active and (lower(code) = lower(trim(p_site)) or lower(name) = lower(trim(p_site)));
  if v_n = 0 then
    select count(*), min(id::text)::uuid into v_n, v_site from public.patrol_sites
     where org_id = p_org and active and name ilike '%' || trim(p_site) || '%';
  end if;
  if v_n <> 1 then raise exception 'site_not_unique: % matches for "%"', v_n, p_site using errcode = '22023'; end if;
  if nullif(trim(coalesce(p_guard, '')), '') is not null and lower(trim(p_guard)) not in ('open', 'unassigned') then
    select count(*), min(id::text)::uuid into v_n, v_member from public.patrol_members
     where org_id = p_org and status = 'active' and role <> 'client'
       and (lower(display_name) = lower(trim(p_guard)) or lower(email) = lower(trim(p_guard)));
    if v_n = 0 then
      select count(*), min(id::text)::uuid into v_n, v_member from public.patrol_members
       where org_id = p_org and status = 'active' and role <> 'client' and display_name ilike trim(p_guard) || '%';
    end if;
    if v_n <> 1 then raise exception 'guard_not_unique: % matches for "%"', v_n, p_guard using errcode = '22023'; end if;
  end if;
  insert into public.patrol_shifts (org_id, site_id, member_id, starts_at, ends_at, notes, created_by)
  values (p_org, v_site, v_member, p_starts_at, p_ends_at, nullif(trim(p_notes), ''),
          case when auth.uid() is not null then public.patrol_member_id_in(p_org) end)
  returning id into v_id;
  return jsonb_build_object('shift_id', v_id, 'site_id', v_site, 'member_id', v_member, 'starts_at', p_starts_at, 'ends_at', p_ends_at);
end $$;

-- ---------- portal: client-visible BOLO photos ----------
-- True when a storage object is a photo of an active, client-visible BOLO at a site with a live
-- portal link. Used by the storage policies below (anon portal + signed-in clients).
create or replace function public.patrol_portal_media_ok(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.patrol_attachments a
    join public.patrol_bolos b on b.id = a.parent_id
    where a.parent_type::text = 'bolo' and a.kind = 'image' and (a.storage_path = p_name or a.thumb_path = p_name)
      and b.visible_to_client and b.status = 'active' and (b.expires_at is null or b.expires_at > now())
      and (exists (select 1 from public.patrol_portal_links l
                    where l.site_id = b.site_id and l.revoked_at is null and (l.expires_at is null or l.expires_at > now()))
           or b.site_id = any(public.patrol_client_sites())))
$$;

drop policy if exists patrol_media_portal_bolo_anon on storage.objects;
create policy patrol_media_portal_bolo_anon on storage.objects for select to anon
  using (bucket_id = 'patrol-media' and public.patrol_portal_media_ok(name));
drop policy if exists patrol_media_portal_bolo_auth on storage.objects;
create policy patrol_media_portal_bolo_auth on storage.objects for select to authenticated
  using (bucket_id = 'patrol-media' and public.patrol_portal_media_ok(name));

-- Client-visible active BOLOs for a signed-in client's sites (clients can't read patrol_bolos).
create or replace function public.patrol_client_bolos()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', bo.id, 'site_id', bo.site_id, 'title', bo.title, 'description', bo.description,
    'person_desc', bo.person_desc, 'vehicle_desc', bo.vehicle_desc, 'expires_at', bo.expires_at, 'created_at', bo.created_at,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('path', a.storage_path, 'thumb', a.thumb_path) order by a.created_at)
                        from public.patrol_attachments a where a.parent_type::text = 'bolo' and a.parent_id = bo.id and a.kind = 'image'
                          and a.upload_status = 'uploaded'), '[]'::jsonb)) order by bo.created_at desc), '[]'::jsonb)
  from public.patrol_bolos bo
  where bo.site_id = any(public.patrol_client_sites()) and bo.visible_to_client and bo.status = 'active'
    and (bo.expires_at is null or bo.expires_at > now())
$$;

-- Portal payload: + incident.extra (category-specific fields) + BOLO photo paths.
create or replace function public.patrol_get_portal(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_link public.patrol_portal_links;
begin
  select * into v_link from public.patrol_portal_links
   where token_hash = public.patrol_sha256(coalesce(p_token, ''))
     and revoked_at is null and (expires_at is null or expires_at > now());
  if v_link.id is null then return null; end if;
  update public.patrol_portal_links set view_count = view_count + 1, last_viewed_at = now() where id = v_link.id;
  return jsonb_build_object(
    'expires_at', v_link.expires_at,
    'org', (select jsonb_build_object('name', o.name, 'phone', o.phone, 'email', o.email, 'license_no', o.license_no) from public.patrol_orgs o where o.id = v_link.org_id),
    'site', (select jsonb_build_object('id', s.id, 'name', s.name, 'address', s.address, 'city', s.city, 'state', s.state) from public.patrol_sites s where s.id = v_link.site_id),
    'incidents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'report_no', i.report_no, 'title', i.title, 'category_name', i.category_name, 'subtype_name', i.subtype_name,
        'occurred_at', i.occurred_at, 'submitted_at', i.submitted_at, 'author_name', i.author_name, 'severity', i.severity, 'status', i.status,
        'location_text', i.location_text, 'description', i.description, 'people', i.people, 'vehicles', i.vehicles,
        'police_called', i.police_called, 'police_agency', i.police_agency, 'police_case_no', i.police_case_no,
        'fire_called', i.fire_called, 'ems_called', i.ems_called, 'injury', i.injury, 'injury_details', i.injury_details,
        'property_damage', i.property_damage, 'damage_estimate_usd', i.damage_estimate_usd, 'extra', i.extra,
        'field_config', (select c.field_config from public.patrol_categories c where c.id = i.category_id)) order by i.occurred_at desc)
      from public.patrol_incidents i
      where i.site_id = v_link.site_id and i.client_visible and i.status <> 'draft' and i.occurred_at > now() - interval '180 days'), '[]'::jsonb),
    'dars', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'report_no', d.report_no, 'report_date', d.report_date, 'author_name', d.author_name, 'summary', d.summary, 'status', d.status,
        'entries', coalesce((select jsonb_agg(jsonb_build_object('occurred_at', e.occurred_at, 'category_name', e.category_name, 'body', e.body) order by e.occurred_at)
                             from public.patrol_dar_entries e where e.dar_id = d.id and e.deleted_at is null), '[]'::jsonb),
        'tours', coalesce((select jsonb_agg(jsonb_build_object('started_at', r.started_at, 'completed_at', r.completed_at, 'expected_count', r.expected_count, 'scanned_count', r.scanned_count) order by r.started_at)
                           from public.patrol_tour_runs r where r.time_entry_id = d.time_entry_id and d.time_entry_id is not null), '[]'::jsonb)
      ) order by d.report_date desc)
      from public.patrol_dars d
      where d.site_id = v_link.site_id and d.client_visible and d.report_date > current_date - 90), '[]'::jsonb),
    'bolos', coalesce((
      select jsonb_agg(jsonb_build_object('id', bo.id, 'title', bo.title, 'description', bo.description, 'person_desc', bo.person_desc,
        'vehicle_desc', bo.vehicle_desc, 'expires_at', bo.expires_at, 'created_at', bo.created_at,
        'photos', coalesce((select jsonb_agg(jsonb_build_object('path', a.storage_path, 'thumb', a.thumb_path) order by a.created_at)
                            from public.patrol_attachments a where a.parent_type::text = 'bolo' and a.parent_id = bo.id and a.kind = 'image'
                              and a.upload_status = 'uploaded'), '[]'::jsonb)) order by bo.created_at desc)
      from public.patrol_bolos bo
      where bo.site_id = v_link.site_id and bo.visible_to_client and bo.status = 'active'
        and (bo.expires_at is null or bo.expires_at > now())), '[]'::jsonb),
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object('started_at', r.started_at, 'expected_count', r.expected_count, 'scanned_count', r.scanned_count, 'completed_at', r.completed_at))
      from public.patrol_tour_runs r where r.site_id = v_link.site_id and r.started_at > now() - interval '14 days'), '[]'::jsonb)
  );
end $$;

-- ---------- grants (same pattern as 20261024000900_patrol_hardening) ----------
do $$
declare f text;
begin
  foreach f in array array[
    'patrol_redeem_invite(text,text,text)', 'patrol_check_owner_alerts(uuid)',
    'patrol_report_geofence_block(uuid,double precision,double precision,double precision)',
    'patrol_add_shift_by_names(uuid,text,text,timestamptz,timestamptz,text)', 'patrol_client_bolos()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array[
    'patrol_time_entries_geofence()', 'patrol_status_from_activity()', 'patrol_sites_keep_time_records()', 'patrol_owner_alerts_guard()']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  revoke all on function public.patrol_distance_m(double precision,double precision,double precision,double precision) from public, anon;
  grant execute on function public.patrol_distance_m(double precision,double precision,double precision,double precision) to authenticated;
  -- storage policies evaluate this for anon (portal) and authenticated callers
  revoke all on function public.patrol_portal_media_ok(text) from public;
  grant execute on function public.patrol_portal_media_ok(text) to anon, authenticated;
  revoke all on function public.patrol_get_portal(text) from public;
  grant execute on function public.patrol_get_portal(text) to anon, authenticated;
end $$;

-- Realtime for owner alerts (staff dashboards already subscribe to patrol_* changes).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'patrol_owner_alerts') then
    execute 'alter publication supabase_realtime add table public.patrol_owner_alerts';
  end if;
end $$;

commit;

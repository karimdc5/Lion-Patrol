-- Lion Patrol v2 — integrity triggers (name snapshots, column guards, report numbers,
-- live status, tour counters). Writes coming from SECURITY DEFINER RPCs run as the
-- function owner, so guards only police direct writes by the `authenticated` role.
begin;

-- ---------- name snapshots (author can't spoof) ----------
create or replace function public.patrol_snapshot_names()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if tg_table_name = 'patrol_incident_events' then
    select display_name into v_name from public.patrol_members where id = new.actor_id;
    new.actor_name := coalesce(v_name, '');
  else
    select display_name into v_name from public.patrol_members where id = new.member_id;
    if tg_table_name = 'patrol_alerts' then
      new.member_name := coalesce(v_name, '');
    else
      new.author_name := coalesce(v_name, '');
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['patrol_incidents','patrol_dars','patrol_alerts','patrol_incident_events'] loop
    execute format('drop trigger if exists patrol_05_names on public.%I', t);
    execute format('create trigger patrol_05_names before insert on public.%I for each row execute function public.patrol_snapshot_names()', t);
  end loop;
end $$;

-- ---------- incidents: author-draft rules; staff changes go through RPCs ----------
create or replace function public.patrol_incidents_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_author boolean := old.member_id = any(public.patrol_my_member_ids());
begin
  if current_user <> 'authenticated' then return new; end if;
  if new.id <> old.id or new.org_id <> old.org_id or new.member_id <> old.member_id then
    raise exception 'immutable_columns' using errcode = '42501';
  end if;
  if not (v_author and old.status = 'draft') then
    -- stale replay of an author write after submit: silently ignore
    if v_author and new.client_rev <= old.client_rev then return old; end if;
    raise exception 'not_editable' using errcode = 'P0001';
  end if;
  if new.client_rev <= old.client_rev then return old; end if;
  if new.status not in ('draft', 'submitted') then
    raise exception 'not_allowed_status' using errcode = '42501';
  end if;
  new.author_name := old.author_name;
  new.report_no := old.report_no;
  new.client_visible := old.client_visible;
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  new.review_notes := old.review_notes;
  new.sent_to_client_at := old.sent_to_client_at;
  new.notified_at := old.notified_at;
  new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists patrol_10_guard on public.patrol_incidents;
create trigger patrol_10_guard before update on public.patrol_incidents
  for each row execute function public.patrol_incidents_guard();

-- ---------- DARs ----------
create or replace function public.patrol_dars_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_author boolean := old.member_id = any(public.patrol_my_member_ids());
begin
  if current_user <> 'authenticated' then return new; end if;
  if new.id <> old.id or new.org_id <> old.org_id or new.member_id <> old.member_id then
    raise exception 'immutable_columns' using errcode = '42501';
  end if;
  if not (v_author and old.status = 'open') then
    if v_author and new.client_rev <= old.client_rev then return old; end if;
    raise exception 'not_editable' using errcode = 'P0001';
  end if;
  if new.client_rev <= old.client_rev then return old; end if;
  if new.status not in ('open', 'submitted') then
    raise exception 'not_allowed_status' using errcode = '42501';
  end if;
  new.author_name := old.author_name;
  new.report_no := old.report_no;
  new.client_visible := old.client_visible;
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  new.sent_to_client_at := old.sent_to_client_at;
  new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists patrol_10_guard on public.patrol_dars;
create trigger patrol_10_guard before update on public.patrol_dars
  for each row execute function public.patrol_dars_guard();

-- ---------- DAR entries: author may add/edit while the DAR is open ----------
-- Invoker-rights: the DAR lookup is subject to RLS, so callers can only attach to DARs they can see.
create or replace function public.patrol_dar_entries_guard()
returns trigger language plpgsql set search_path = public as $$
declare v_status public.patrol_dar_status; v_dar_member uuid; v_site uuid;
begin
  select status, member_id, site_id into v_status, v_dar_member, v_site from public.patrol_dars where id = new.dar_id;
  if v_dar_member is null then raise exception 'dar_not_found' using errcode = '23503'; end if;
  if current_user = 'authenticated' and (v_dar_member <> new.member_id or v_status <> 'open') then
    raise exception 'dar_not_open' using errcode = 'P0001';
  end if;
  new.site_id := v_site;
  return new;
end $$;
drop trigger if exists patrol_10_guard on public.patrol_dar_entries;
create trigger patrol_10_guard before insert on public.patrol_dar_entries
  for each row execute function public.patrol_dar_entries_guard();

create or replace function public.patrol_dar_entries_update_guard()
returns trigger language plpgsql set search_path = public as $$
declare v_status public.patrol_dar_status;
begin
  if current_user <> 'authenticated' then return new; end if;
  if new.id <> old.id or new.org_id <> old.org_id or new.member_id <> old.member_id or new.dar_id <> old.dar_id then
    raise exception 'immutable_columns' using errcode = '42501';
  end if;
  if new.client_rev <= old.client_rev then return old; end if;
  select status into v_status from public.patrol_dars where id = old.dar_id;
  if v_status is distinct from 'open' then return old; end if;
  new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists patrol_11_guard_upd on public.patrol_dar_entries;
create trigger patrol_11_guard_upd before update on public.patrol_dar_entries
  for each row execute function public.patrol_dar_entries_update_guard();

-- ---------- report numbers + submit side-effects (incidents and DARs) ----------
create or replace function public.patrol_on_submit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_submitting boolean;
  v_n integer; v_prefix text; v_auto boolean; v_code text;
begin
  if tg_op = 'INSERT' then
    -- review fields are never client-supplied
    new.report_no := null;
    new.client_visible := false;
    new.reviewed_by := null; new.reviewed_at := null; new.sent_to_client_at := null;
    if tg_table_name = 'patrol_incidents' then
      new.review_notes := null; new.notified_at := null;
    end if;
    v_submitting := new.status::text = 'submitted';
  else
    v_submitting := new.status::text = 'submitted' and old.status::text in ('draft', 'open');
  end if;
  if not v_submitting then return new; end if;

  update public.patrol_org_settings
     set next_report_no = next_report_no + 1
   where org_id = new.org_id
  returning next_report_no - 1, report_prefix, auto_share_with_client into v_n, v_prefix, v_auto;
  select coalesce(nullif(regexp_replace(upper(code), '[^A-Z0-9]', '', 'g'), ''), 'SITE')
    into v_code from public.patrol_sites where id = new.site_id;
  new.report_no := coalesce(v_prefix, 'LSS') || '-' || coalesce(v_code, 'SITE') || '-'
    || to_char(now() at time zone 'America/Los_Angeles', 'YYYY') || '-' || lpad(coalesce(v_n, 0)::text, 5, '0');
  new.submitted_at := now();
  new.client_visible := coalesce(v_auto, false);
  if new.client_visible then new.sent_to_client_at := now(); end if;
  if tg_table_name = 'patrol_incidents' then
    select name into new.category_name from public.patrol_categories where id = new.category_id;
    select name into new.subtype_name from public.patrol_subtypes where id = new.subtype_id;
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['patrol_incidents','patrol_dars'] loop
    execute format('drop trigger if exists patrol_20_submit on public.%I', t);
    execute format('create trigger patrol_20_submit before insert or update on public.%I for each row execute function public.patrol_on_submit()', t);
  end loop;
end $$;

-- ---------- time entries: author may only clock out; staff may correct ----------
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
  new.gps_notice_accepted_at := old.gps_notice_accepted_at;
  new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists patrol_10_guard on public.patrol_time_entries;
create trigger patrol_10_guard before update on public.patrol_time_entries
  for each row execute function public.patrol_time_entries_guard();

-- ---------- live member status ----------
create or replace function public.patrol_status_from_time_entry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.clock_out_at is null then
    insert into public.patrol_member_status as s
      (member_id, org_id, on_duty, time_entry_id, site_id, lat, lng, accuracy_m, last_ping_at, on_duty_since)
    values (new.member_id, new.org_id, true, new.id, new.site_id, new.clock_in_lat, new.clock_in_lng,
            new.clock_in_accuracy_m, case when new.clock_in_lat is not null then new.clock_in_at end, new.clock_in_at)
    on conflict (member_id) do update set
      on_duty = true, time_entry_id = excluded.time_entry_id, site_id = excluded.site_id,
      lat = coalesce(excluded.lat, s.lat), lng = coalesce(excluded.lng, s.lng),
      accuracy_m = excluded.accuracy_m, last_ping_at = coalesce(excluded.last_ping_at, s.last_ping_at),
      on_duty_since = excluded.on_duty_since;
  else
    update public.patrol_member_status
       set on_duty = false, time_entry_id = null,
           lat = coalesce(new.clock_out_lat, lat), lng = coalesce(new.clock_out_lng, lng),
           last_ping_at = case when new.clock_out_lat is not null then new.clock_out_at else last_ping_at end
     where member_id = new.member_id and time_entry_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists patrol_30_status on public.patrol_time_entries;
create trigger patrol_30_status after insert or update of clock_out_at on public.patrol_time_entries
  for each row execute function public.patrol_status_from_time_entry();

create or replace function public.patrol_status_from_ping()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.patrol_member_status
     set lat = new.lat, lng = new.lng, accuracy_m = new.accuracy_m, last_ping_at = new.recorded_at
   where member_id = new.member_id
     and time_entry_id = new.time_entry_id
     and (last_ping_at is null or last_ping_at < new.recorded_at);
  return null;
end $$;
drop trigger if exists patrol_30_status on public.patrol_location_pings;
create trigger patrol_30_status after insert on public.patrol_location_pings
  for each row execute function public.patrol_status_from_ping();

-- ---------- tour runs ----------
create or replace function public.patrol_tour_runs_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if old.org_id = any(public.patrol_staff_orgs()) then return new; end if;
  -- guards may only complete their run
  new.completed_at := coalesce(old.completed_at, new.completed_at);
  new.org_id := old.org_id; new.site_id := old.site_id; new.member_id := old.member_id;
  new.time_entry_id := old.time_entry_id; new.started_at := old.started_at;
  new.expected_count := old.expected_count; new.scanned_count := old.scanned_count;
  new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists patrol_10_guard on public.patrol_tour_runs;
create trigger patrol_10_guard before update on public.patrol_tour_runs
  for each row execute function public.patrol_tour_runs_guard();

create or replace function public.patrol_scan_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_org uuid;
begin
  select site_id, org_id into v_site, v_org from public.patrol_checkpoints where id = new.checkpoint_id;
  if v_site is null or v_site <> new.site_id or v_org <> new.org_id then
    raise exception 'checkpoint_site_mismatch' using errcode = '23514';
  end if;
  if new.tour_run_id is not null and not exists (
    select 1 from public.patrol_tour_runs r where r.id = new.tour_run_id and r.member_id = new.member_id and r.site_id = new.site_id
  ) then
    raise exception 'tour_run_mismatch' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists patrol_10_check on public.patrol_scans;
create trigger patrol_10_check before insert on public.patrol_scans
  for each row execute function public.patrol_scan_before_insert();

create or replace function public.patrol_scan_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tour_run_id is not null and not ('duplicate' = any(new.flags)) then
    update public.patrol_tour_runs
       set scanned_count = scanned_count + 1,
           completed_at = case when completed_at is null and scanned_count + 1 >= expected_count and expected_count > 0
                               then new.scanned_at else completed_at end,
           late = late or ('late' = any(new.flags))
     where id = new.tour_run_id;
  end if;
  return null;
end $$;
drop trigger if exists patrol_30_after on public.patrol_scans;
create trigger patrol_30_after after insert on public.patrol_scans
  for each row execute function public.patrol_scan_after_insert();

-- ---------- attachments ----------
-- Invoker-rights: parent lookups go through RLS, so you can only attach to records you can see.
create or replace function public.patrol_attachment_before_insert()
returns trigger language plpgsql set search_path = public as $$
declare v_org uuid; v_site uuid; v_member uuid;
begin
  if new.parent_type = 'incident' then
    select org_id, site_id, member_id into v_org, v_site, v_member from public.patrol_incidents where id = new.parent_id;
  elsif new.parent_type = 'dar_entry' then
    select org_id, site_id, member_id into v_org, v_site, v_member from public.patrol_dar_entries where id = new.parent_id;
  elsif new.parent_type = 'scan' then
    select org_id, site_id, member_id into v_org, v_site, v_member from public.patrol_scans where id = new.parent_id;
  elsif new.parent_type = 'alert' then
    select org_id, site_id, member_id into v_org, v_site, v_member from public.patrol_alerts where id = new.parent_id;
  elsif new.parent_type = 'site' then
    select org_id, id into v_org, v_site from public.patrol_sites where id = new.parent_id;
  end if;
  if v_org is null then raise exception 'attachment_parent_not_found' using errcode = '23503'; end if;
  if v_org <> new.org_id then raise exception 'attachment_org_mismatch' using errcode = '42501'; end if;
  if current_user = 'authenticated' then
    if new.parent_type = 'site' then
      if not (new.org_id = any(public.patrol_admin_orgs())) then
        raise exception 'attachment_not_allowed' using errcode = '42501';
      end if;
    elsif v_member <> new.member_id then
      raise exception 'attachment_not_allowed' using errcode = '42501';
    end if;
  end if;
  if left(new.storage_path, 37) <> new.org_id::text || '/' then
    raise exception 'attachment_bad_path' using errcode = '23514';
  end if;
  if new.thumb_path is not null and left(new.thumb_path, 37) <> new.org_id::text || '/' then
    raise exception 'attachment_bad_path' using errcode = '23514';
  end if;
  new.site_id := v_site;
  new.upload_status := 'pending';
  new.uploaded_at := null;
  return new;
end $$;
drop trigger if exists patrol_10_check on public.patrol_attachments;
create trigger patrol_10_check before insert on public.patrol_attachments
  for each row execute function public.patrol_attachment_before_insert();

create or replace function public.patrol_attachment_before_update()
returns trigger language plpgsql set search_path = public as $$
declare v_upload text := new.upload_status; v_at timestamptz := new.uploaded_at;
        v_caption text := new.caption; v_thumb text := new.thumb_path;
begin
  if current_user <> 'authenticated' then return new; end if;
  if v_thumb is not null and left(v_thumb, 37) <> old.org_id::text || '/' then
    raise exception 'attachment_bad_path' using errcode = '23514';
  end if;
  new := old;
  new.upload_status := v_upload;
  new.uploaded_at := case when v_upload = 'uploaded' then coalesce(v_at, now()) else null end;
  new.caption := v_caption;
  new.thumb_path := v_thumb;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists patrol_10_guard on public.patrol_attachments;
create trigger patrol_10_guard before update on public.patrol_attachments
  for each row execute function public.patrol_attachment_before_update();

-- ---------- members ----------
create or replace function public.patrol_members_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_is_admin boolean := old.org_id = any(public.patrol_admin_orgs());
  v_is_owner boolean := old.org_id = any(public.patrol_orgs_with_role('{owner}'));
  v_name text := new.display_name; v_phone text := new.phone;
begin
  if current_user <> 'authenticated' then return new; end if;
  if new.org_id <> old.org_id or new.user_id <> old.user_id or new.id <> old.id then
    raise exception 'immutable_columns' using errcode = '42501';
  end if;
  if not v_is_admin then
    -- self-service: name and phone only
    new := old;
    new.display_name := v_name;
    new.phone := v_phone;
    new.updated_at := now();
    return new;
  end if;
  if (old.role = 'owner' or new.role = 'owner') and new.role is distinct from old.role and not v_is_owner then
    raise exception 'only_owner_can_change_owner' using errcode = '42501';
  end if;
  if old.role = 'owner' and not v_is_owner and (new.status <> old.status) then
    raise exception 'only_owner_can_change_owner' using errcode = '42501';
  end if;
  if old.role = 'owner' and (new.role <> 'owner' or new.status <> 'active') and not exists (
    select 1 from public.patrol_members m
    where m.org_id = old.org_id and m.role = 'owner' and m.status = 'active' and m.id <> old.id
  ) then
    raise exception 'last_owner' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists patrol_10_guard on public.patrol_members;
create trigger patrol_10_guard before update on public.patrol_members
  for each row execute function public.patrol_members_guard();

-- ---------- org settings: counter is server-only ----------
create or replace function public.patrol_org_settings_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  new.next_report_no := old.next_report_no;
  new.org_id := old.org_id;
  return new;
end $$;
drop trigger if exists patrol_10_guard on public.patrol_org_settings;
create trigger patrol_10_guard before update on public.patrol_org_settings
  for each row execute function public.patrol_org_settings_guard();

-- ---------- alerts: guards can't update directly (RPC only) ----------
-- (enforced by having no UPDATE policy for guards)

-- trigger functions are never called directly
do $$
declare f text;
begin
  foreach f in array array[
    'patrol_snapshot_names()','patrol_incidents_guard()','patrol_dars_guard()','patrol_dar_entries_guard()',
    'patrol_dar_entries_update_guard()','patrol_on_submit()','patrol_time_entries_guard()',
    'patrol_status_from_time_entry()','patrol_status_from_ping()','patrol_tour_runs_guard()',
    'patrol_scan_before_insert()','patrol_scan_after_insert()','patrol_attachment_before_insert()',
    'patrol_attachment_before_update()','patrol_members_guard()','patrol_org_settings_guard()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
end $$;

commit;

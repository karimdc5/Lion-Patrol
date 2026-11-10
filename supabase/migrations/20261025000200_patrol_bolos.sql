-- Lion Patrol v2 — BOLO (Be On the Lookout) alerts pinned per site. Re-runnable; patrol_ objects only.
-- Read: staff of the org + workers with access to the site (clients only via the portal RPC, client-visible
-- active unexpired rows, text only). Write: workers insert for sites they can work; staff or the creator
-- update/resolve/archive; only staff delete. Photos: patrol_attachments parent_type 'bolo' (patrol-media bucket;
-- storage policies already follow attachment-row visibility).
begin;

alter type public.patrol_attach_parent add value if not exists 'bolo';

create table if not exists public.patrol_bolos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid not null references public.patrol_sites(id) on delete cascade,
  created_by uuid not null references public.patrol_members(id),
  title text not null check (length(btrim(title)) between 1 and 200),
  description text not null default '',
  person_desc text,
  vehicle_desc text,
  expires_at timestamptz,
  visible_to_client boolean not null default false,
  status text not null default 'active' check (status in ('active','resolved','archived')),
  resolved_at timestamptz,
  client_created_at timestamptz, device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists patrol_bolos_site_idx on public.patrol_bolos(site_id, status);
create index if not exists patrol_bolos_upd_idx on public.patrol_bolos(org_id, updated_at);

alter table public.patrol_bolos enable row level security;
revoke all on table public.patrol_bolos from anon;
grant select, insert, update, delete on table public.patrol_bolos to authenticated;

-- Invoker rights: the site lookup goes through RLS, so you can only post to sites you can see.
create or replace function public.patrol_bolos_guard()
returns trigger language plpgsql set search_path = public as $$
declare v_org uuid;
begin
  if tg_op = 'INSERT' then
    select org_id into v_org from public.patrol_sites where id = new.site_id;
    if v_org is null or v_org <> new.org_id then raise exception 'bolo_site_mismatch' using errcode = '23514'; end if;
    if current_user = 'authenticated' then
      new.status := 'active'; new.resolved_at := null; new.created_at := now();
    end if;
  else
    new.org_id := old.org_id; new.site_id := old.site_id; new.created_by := old.created_by; new.created_at := old.created_at;
    if new.status = 'resolved' and old.status <> 'resolved' then new.resolved_at := now();
    elsif new.status = 'active' then new.resolved_at := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists patrol_10_guard on public.patrol_bolos;
create trigger patrol_10_guard before insert or update on public.patrol_bolos
  for each row execute function public.patrol_bolos_guard();
drop trigger if exists patrol_00_touch on public.patrol_bolos;
create trigger patrol_00_touch before update on public.patrol_bolos
  for each row execute function public.patrol_touch_updated_at();
revoke all on function public.patrol_bolos_guard() from public, anon, authenticated;

drop policy if exists patrol_bolos_select on public.patrol_bolos;
create policy patrol_bolos_select on public.patrol_bolos for select to authenticated
  using (org_id = any ((select public.patrol_staff_orgs())::uuid[]) or site_id = any ((select public.patrol_workable_sites())::uuid[]));
drop policy if exists patrol_bolos_insert on public.patrol_bolos;
create policy patrol_bolos_insert on public.patrol_bolos for insert to authenticated
  with check (created_by = public.patrol_member_id_in(org_id)
              and org_id = any ((select public.patrol_worker_orgs())::uuid[])
              and site_id = any ((select public.patrol_workable_sites())::uuid[]));
drop policy if exists patrol_bolos_update on public.patrol_bolos;
create policy patrol_bolos_update on public.patrol_bolos for update to authenticated
  using (org_id = any ((select public.patrol_staff_orgs())::uuid[]) or created_by = any ((select public.patrol_my_member_ids())::uuid[]))
  with check (org_id = any ((select public.patrol_staff_orgs())::uuid[]) or created_by = any ((select public.patrol_my_member_ids())::uuid[]));
drop policy if exists patrol_bolos_delete on public.patrol_bolos;
create policy patrol_bolos_delete on public.patrol_bolos for delete to authenticated
  using (org_id = any ((select public.patrol_staff_orgs())::uuid[]));

-- Attachments: add the 'bolo' parent (compare as text: the new enum value can't be used in this transaction).
drop policy if exists patrol_attachments_select on public.patrol_attachments;
create policy patrol_attachments_select on public.patrol_attachments as permissive for select to authenticated using (
  member_id = any ((select public.patrol_my_member_ids())::uuid[]) or (case parent_type::text
    when 'incident' then exists (select 1 from public.patrol_incidents p where p.id = parent_id)
    when 'dar_entry' then exists (select 1 from public.patrol_dar_entries p where p.id = parent_id)
    when 'scan' then exists (select 1 from public.patrol_scans p where p.id = parent_id)
    when 'alert' then exists (select 1 from public.patrol_alerts p where p.id = parent_id)
    when 'site' then exists (select 1 from public.patrol_sites p where p.id = parent_id)
    when 'bolo' then exists (select 1 from public.patrol_bolos p where p.id = parent_id)
    else false end));

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
  elsif new.parent_type::text = 'bolo' then
    select org_id, site_id, created_by into v_org, v_site, v_member from public.patrol_bolos where id = new.parent_id;
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

-- Portal: adds client-visible, active, unexpired BOLOs (text only; media stays private).
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
        'property_damage', i.property_damage, 'damage_estimate_usd', i.damage_estimate_usd) order by i.occurred_at desc)
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
        'vehicle_desc', bo.vehicle_desc, 'expires_at', bo.expires_at, 'created_at', bo.created_at) order by bo.created_at desc)
      from public.patrol_bolos bo
      where bo.site_id = v_link.site_id and bo.visible_to_client and bo.status = 'active'
        and (bo.expires_at is null or bo.expires_at > now())), '[]'::jsonb),
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object('started_at', r.started_at, 'expected_count', r.expected_count, 'scanned_count', r.scanned_count, 'completed_at', r.completed_at))
      from public.patrol_tour_runs r where r.site_id = v_link.site_id and r.started_at > now() - interval '14 days'), '[]'::jsonb)
  );
end $$;
revoke all on function public.patrol_get_portal(text) from public;
grant execute on function public.patrol_get_portal(text) to anon, authenticated;

commit;

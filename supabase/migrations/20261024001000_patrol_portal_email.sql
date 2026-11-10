-- Lion Patrol v2 — per-site client portal links + owner email notification settings.
-- New patrol_* objects only (plus new columns on patrol_org_settings). Re-runnable.
begin;

-- ---------- email settings ----------
alter table public.patrol_org_settings add column if not exists email_enabled boolean not null default false;
alter table public.patrol_org_settings add column if not exists email_min_severity public.patrol_severity not null default 'medium';
-- Testing guard: while true, notifications only ever go to owner/admin member emails.
alter table public.patrol_org_settings add column if not exists email_owners_only boolean not null default true;

-- ---------- portal links ----------
create table if not exists public.patrol_portal_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid not null references public.patrol_sites(id) on delete cascade,
  token_hash text not null unique,
  label text,
  expires_at timestamptz,
  revoked_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  created_by uuid not null references public.patrol_members(id),
  created_at timestamptz not null default now()
);
create index if not exists patrol_portal_links_site_idx on public.patrol_portal_links(site_id, created_at desc);

alter table public.patrol_portal_links enable row level security;
revoke all on table public.patrol_portal_links from anon;
revoke all on table public.patrol_portal_links from authenticated;
grant select on table public.patrol_portal_links to authenticated;
drop policy if exists patrol_portal_links_select_staff on public.patrol_portal_links;
create policy patrol_portal_links_select_staff on public.patrol_portal_links for select to authenticated
  using (org_id = any ((select public.patrol_staff_orgs())::uuid[]));

-- ---------- RPCs ----------
create or replace function public.patrol_create_portal_link(p_site uuid, p_days integer default 90, p_label text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_org uuid; v_token text; v_id uuid; v_exp timestamptz;
begin
  select org_id into v_org from public.patrol_sites where id = p_site;
  if v_org is null or not (v_org = any(public.patrol_staff_orgs())) then
    raise exception 'not_found' using errcode = '42501';
  end if;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');
  v_exp := case when coalesce(p_days, 0) > 0 then now() + make_interval(days => least(p_days, 365)) else null end;
  insert into public.patrol_portal_links (org_id, site_id, token_hash, label, expires_at, created_by)
  values (v_org, p_site, public.patrol_sha256(v_token), nullif(trim(p_label), ''), v_exp, public.patrol_member_id_in(v_org))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_exp);
end $$;

create or replace function public.patrol_revoke_portal_link(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.patrol_portal_links where id = p_id;
  if v_org is null or not (v_org = any(public.patrol_staff_orgs())) then
    raise exception 'not_found' using errcode = '42501';
  end if;
  update public.patrol_portal_links set revoked_at = coalesce(revoked_at, now()) where id = p_id;
end $$;

-- Anonymous, read-only portal payload for one site: client-visible incidents and DARs only.
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
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object('started_at', r.started_at, 'expected_count', r.expected_count, 'scanned_count', r.scanned_count, 'completed_at', r.completed_at))
      from public.patrol_tour_runs r where r.site_id = v_link.site_id and r.started_at > now() - interval '14 days'), '[]'::jsonb)
  );
end $$;

-- Who to email for a new incident/SOS. Callable by any worker in the org (the guard's device sends
-- the email). Never returns client addresses; while email_owners_only, only owner/admin emails.
create or replace function public.patrol_notify_targets(p_org uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p_org = any(public.patrol_worker_orgs()) then (
    select jsonb_build_object(
      'enabled', s.email_enabled,
      'min_severity', s.email_min_severity,
      'owners_only', s.email_owners_only,
      'recipients', coalesce((
        select jsonb_agg(distinct lower(e))
        from unnest(s.notify_emails) e
        where (not s.email_owners_only and not exists (
                 select 1 from public.patrol_members m where m.org_id = p_org and m.role = 'client' and lower(m.email) = lower(e)))
           or exists (select 1 from public.patrol_members m
                      where m.org_id = p_org and m.status = 'active' and m.role in ('owner', 'admin') and lower(m.email) = lower(e))
      ), '[]'::jsonb))
    from public.patrol_org_settings s where s.org_id = p_org)
  else null end
$$;

do $$
declare f text;
begin
  foreach f in array array['patrol_create_portal_link(uuid,integer,text)', 'patrol_revoke_portal_link(uuid)', 'patrol_notify_targets(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke all on function public.patrol_get_portal(text) from public;
  grant execute on function public.patrol_get_portal(text) to anon, authenticated;
end $$;

commit;

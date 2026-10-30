-- Lion Patrol v2 — RPCs. SECURITY DEFINER functions check the caller's role themselves.
-- patrol_bootstrap is SECURITY INVOKER on purpose: RLS does all of its filtering.
begin;

-- ---------- bootstrap: create the first org (owners listed in public.app_admins) ----------
create or replace function public.patrol_create_org(
  p_org_id uuid, p_name text, p_timezone text default 'America/Los_Angeles', p_display_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_existing uuid;
begin
  if v_uid is null or not public.patrol_is_app_admin() then
    raise exception 'not_app_admin' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'name_required' using errcode = '22023';
  end if;
  select id into v_existing from public.patrol_orgs where id = p_org_id;
  if v_existing is not null then
    if exists (select 1 from public.patrol_orgs where id = p_org_id and created_by = v_uid) then
      return p_org_id;  -- idempotent replay
    end if;
    raise exception 'org_exists' using errcode = '23505';
  end if;

  insert into public.patrol_orgs (id, name, timezone, email, created_by)
  values (coalesce(p_org_id, gen_random_uuid()), trim(p_name), coalesce(p_timezone, 'America/Los_Angeles'), nullif(v_email, ''), v_uid)
  returning id into v_existing;

  insert into public.patrol_org_settings (org_id, notify_emails)
  values (v_existing, case when v_email <> '' then array[v_email] else '{}'::text[] end);

  insert into public.patrol_members (org_id, user_id, role, display_name, email)
  values (v_existing, v_uid, 'owner',
          coalesce(nullif(trim(p_display_name), ''), split_part(v_email, '@', 1), 'Owner'), nullif(v_email, ''));

  perform public.patrol_seed_categories_internal(v_existing);
  return v_existing;
end $$;

-- ---------- one round-trip bootstrap (RLS-filtered) ----------
create or replace function public.patrol_public_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'org_id', s.org_id, 'gps_ping_interval_s', s.gps_ping_interval_s, 'max_video_mb', s.max_video_mb,
    'max_video_s', s.max_video_s, 'tour_interval_min', s.tour_interval_min,
    'tour_max_duration_min', s.tour_max_duration_min, 'report_prefix', s.report_prefix)), '[]'::jsonb)
  from public.patrol_org_settings s
  where s.org_id = any(public.patrol_member_orgs())
$$;

create or replace function public.patrol_bootstrap()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'is_app_admin', public.patrol_is_app_admin(),
    'server_time', now(),
    'memberships', coalesce((select jsonb_agg(to_jsonb(m)) from public.patrol_members m where m.user_id = auth.uid() and m.status = 'active'), '[]'),
    'orgs', coalesce((select jsonb_agg(to_jsonb(o)) from public.patrol_orgs o), '[]'),
    'settings', coalesce((select jsonb_agg(to_jsonb(s)) from public.patrol_org_settings s), '[]'),
    'public_settings', public.patrol_public_settings(),
    'members', coalesce((select jsonb_agg(to_jsonb(m)) from public.patrol_members m), '[]'),
    'sites', coalesce((select jsonb_agg(to_jsonb(s) order by s.name) from public.patrol_sites s), '[]'),
    'site_access', coalesce((select jsonb_agg(to_jsonb(a)) from public.patrol_site_access a), '[]'),
    'checkpoints', coalesce((select jsonb_agg(to_jsonb(c) order by c.site_id, c.seq) from public.patrol_checkpoints c), '[]'),
    'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort) from public.patrol_categories c), '[]'),
    'subtypes', coalesce((select jsonb_agg(to_jsonb(s) order by s.sort) from public.patrol_subtypes s), '[]'),
    'shifts', coalesce((select jsonb_agg(to_jsonb(s) order by s.starts_at) from public.patrol_shifts s
                        where s.ends_at > now() - interval '1 day' and s.starts_at < now() + interval '14 days'), '[]'),
    'open_time_entries', coalesce((select jsonb_agg(to_jsonb(t)) from public.patrol_time_entries t
                        where t.member_id = any(public.patrol_my_member_ids()) and t.clock_out_at is null), '[]'),
    'open_dars', coalesce((select jsonb_agg(to_jsonb(d)) from public.patrol_dars d
                        where d.member_id = any(public.patrol_my_member_ids()) and d.status = 'open'), '[]'),
    'open_tour_runs', coalesce((select jsonb_agg(to_jsonb(r)) from public.patrol_tour_runs r
                        where r.member_id = any(public.patrol_my_member_ids()) and r.completed_at is null
                          and r.started_at > now() - interval '24 hours'), '[]'),
    'consents', coalesce((select jsonb_agg(to_jsonb(c)) from public.patrol_consents c
                        where c.member_id = any(public.patrol_my_member_ids())), '[]'),
    'member_status', coalesce((select jsonb_agg(to_jsonb(ms)) from public.patrol_member_status ms), '[]')
  )
$$;

-- ---------- invites ----------
create or replace function public.patrol_create_invite(
  p_org uuid, p_role public.patrol_role, p_site_ids uuid[] default '{}', p_email text default null,
  p_display_name text default null, p_ttl_hours integer default 168, p_max_uses integer default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_member uuid; v_code text; v_id uuid;
begin
  if not (p_org = any(public.patrol_admin_orgs())) then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_role = 'owner' then raise exception 'owner_invite_not_allowed' using errcode = '42501'; end if;
  if p_role = 'client' and coalesce(array_length(p_site_ids, 1), 0) = 0 then
    raise exception 'client_requires_site' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_site_ids, '{}')) sid
             where not exists (select 1 from public.patrol_sites s where s.id = sid and s.org_id = p_org)) then
    raise exception 'site_not_in_org' using errcode = '42501';
  end if;
  v_member := public.patrol_member_id_in(p_org);
  v_code := public.patrol_gen_code(8);
  insert into public.patrol_invites (org_id, code_hash, code_hint, role, site_ids, email, display_name,
                                     max_uses, expires_at, created_by)
  values (p_org, public.patrol_sha256(v_code), right(v_code, 4), p_role, coalesce(p_site_ids, '{}'),
          nullif(lower(trim(p_email)), ''), nullif(trim(p_display_name), ''),
          greatest(1, least(coalesce(p_max_uses, 1), 100)),
          now() + make_interval(hours => greatest(1, least(coalesce(p_ttl_hours, 168), 24 * 30))), v_member)
  returning id into v_id;
  return jsonb_build_object('invite_id', v_id,
                            'code', 'LION-' || left(v_code, 4) || '-' || right(v_code, 4));
end $$;

-- Returns {ok, error?, org_id, member_id, role}. Never raises for bad codes so the
-- failure counter (brute-force throttle) is committed.
create or replace function public.patrol_redeem_invite(p_code text, p_display_name text, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_inv public.patrol_invites;
  v_member public.patrol_members;
  v_rank_old int; v_rank_new int;
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

  select * into v_member from public.patrol_members where org_id = v_inv.org_id and user_id = v_uid;
  if v_member.id is null then
    insert into public.patrol_members (org_id, user_id, role, display_name, email, phone, invited_by)
    values (v_inv.org_id, v_uid, v_inv.role,
            coalesce(nullif(trim(p_display_name), ''), v_inv.display_name, split_part(v_email, '@', 1), 'Guard'),
            nullif(v_email, ''), nullif(trim(p_phone), ''), v_inv.created_by)
    returning * into v_member;
  else
    v_rank_old := case v_member.role when 'owner' then 50 when 'admin' then 40 when 'supervisor' then 30 when 'guard' then 20 else 10 end;
    v_rank_new := case v_inv.role when 'owner' then 50 when 'admin' then 40 when 'supervisor' then 30 when 'guard' then 20 else 10 end;
    update public.patrol_members
       set role = case when v_rank_new > v_rank_old then v_inv.role else role end,
           status = 'active',
           display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
           phone = coalesce(nullif(trim(p_phone), ''), phone)
     where id = v_member.id
    returning * into v_member;
  end if;

  insert into public.patrol_site_access (org_id, site_id, member_id)
  select v_inv.org_id, sid, v_member.id from unnest(v_inv.site_ids) sid
  on conflict do nothing;

  update public.patrol_invites set uses = uses + 1 where id = v_inv.id;
  return jsonb_build_object('ok', true, 'org_id', v_inv.org_id, 'member_id', v_member.id, 'role', v_member.role);
end $$;

-- ---------- categories ----------
create or replace function public.patrol_seed_categories(p_org uuid)
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not (p_org = any(public.patrol_admin_orgs())) then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return public.patrol_seed_categories_internal(p_org);
end $$;

create or replace function public.patrol_reorder_categories(p_org uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (p_org = any(public.patrol_admin_orgs())) then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  update public.patrol_categories c set sort = x.idx - 1
    from unnest(p_ids) with ordinality as x(id, idx)
   where c.id = x.id and c.org_id = p_org;
end $$;

create or replace function public.patrol_reorder_subtypes(p_category uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.patrol_categories where id = p_category;
  if v_org is null or not (v_org = any(public.patrol_admin_orgs())) then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  update public.patrol_subtypes s set sort = x.idx - 1
    from unnest(p_ids) with ordinality as x(id, idx)
   where s.id = x.id and s.category_id = p_category;
end $$;

-- ---------- review workflow ----------
create or replace function public.patrol_set_incident_status(
  p_id uuid, p_status public.patrol_incident_status, p_note text default null,
  p_severity public.patrol_severity default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inc public.patrol_incidents; v_actor uuid;
begin
  select * into v_inc from public.patrol_incidents where id = p_id for update;
  if v_inc.id is null or not (v_inc.org_id = any(public.patrol_staff_orgs())) or v_inc.status = 'draft' then
    raise exception 'not_found' using errcode = '42501';
  end if;
  if p_status = 'draft' then raise exception 'invalid_transition' using errcode = '22023'; end if;
  v_actor := public.patrol_member_id_in(v_inc.org_id);
  update public.patrol_incidents set
    status = p_status,
    severity = coalesce(p_severity, severity),
    reviewed_by = case when p_status in ('reviewed','sent_to_client','closed') then coalesce(reviewed_by, v_actor) else reviewed_by end,
    reviewed_at = case when p_status in ('reviewed','sent_to_client','closed') then coalesce(reviewed_at, now()) else reviewed_at end,
    client_visible = client_visible or p_status = 'sent_to_client',
    sent_to_client_at = case when p_status = 'sent_to_client' then coalesce(sent_to_client_at, now()) else sent_to_client_at end
  where id = p_id
  returning * into v_inc;
  insert into public.patrol_incident_events (org_id, incident_id, actor_id, kind, from_status, to_status, body)
  values (v_inc.org_id, p_id, v_actor, 'status', null, p_status, nullif(trim(p_note), ''));
  return to_jsonb(v_inc);
end $$;

create or replace function public.patrol_set_incident_client_visible(p_id uuid, p_visible boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.patrol_incidents where id = p_id and status <> 'draft';
  if v_org is null or not (v_org = any(public.patrol_staff_orgs())) then
    raise exception 'not_found' using errcode = '42501';
  end if;
  update public.patrol_incidents set client_visible = p_visible,
    sent_to_client_at = case when p_visible then coalesce(sent_to_client_at, now()) else sent_to_client_at end
  where id = p_id;
end $$;

create or replace function public.patrol_add_incident_note(p_id uuid, p_body text, p_internal boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_inc public.patrol_incidents; v_actor uuid;
begin
  select * into v_inc from public.patrol_incidents where id = p_id;
  if v_inc.id is null or v_inc.status = 'draft' then raise exception 'not_found' using errcode = '42501'; end if;
  v_actor := public.patrol_member_id_in(v_inc.org_id);
  if v_inc.org_id = any(public.patrol_staff_orgs()) then
    insert into public.patrol_incident_events (org_id, incident_id, actor_id, kind, body)
    values (v_inc.org_id, p_id, v_actor, case when p_internal then 'note' else 'addendum' end, p_body);
    if p_internal then
      update public.patrol_incidents
         set review_notes = concat_ws(E'\n', nullif(review_notes, ''), p_body) where id = p_id;
    end if;
  elsif v_inc.member_id = v_actor then
    insert into public.patrol_incident_events (org_id, incident_id, actor_id, kind, body)
    values (v_inc.org_id, p_id, v_actor, 'addendum', p_body);
  else
    raise exception 'not_found' using errcode = '42501';
  end if;
end $$;

create or replace function public.patrol_set_dar_status(p_id uuid, p_status public.patrol_dar_status)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_dar public.patrol_dars; v_actor uuid;
begin
  select * into v_dar from public.patrol_dars where id = p_id for update;
  if v_dar.id is null or not (v_dar.org_id = any(public.patrol_staff_orgs())) or v_dar.status = 'open' then
    raise exception 'not_found' using errcode = '42501';
  end if;
  if p_status = 'open' then raise exception 'invalid_transition' using errcode = '22023'; end if;
  v_actor := public.patrol_member_id_in(v_dar.org_id);
  update public.patrol_dars set
    status = p_status,
    reviewed_by = case when p_status in ('reviewed','sent_to_client') then coalesce(reviewed_by, v_actor) else reviewed_by end,
    reviewed_at = case when p_status in ('reviewed','sent_to_client') then coalesce(reviewed_at, now()) else reviewed_at end,
    client_visible = client_visible or p_status = 'sent_to_client',
    sent_to_client_at = case when p_status = 'sent_to_client' then coalesce(sent_to_client_at, now()) else sent_to_client_at end
  where id = p_id returning * into v_dar;
  return to_jsonb(v_dar);
end $$;

-- ---------- SOS ----------
create or replace function public.patrol_alert_set_status(p_id uuid, p_status public.patrol_alert_status, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_alert public.patrol_alerts; v_actor uuid; v_staff boolean;
begin
  select * into v_alert from public.patrol_alerts where id = p_id for update;
  if v_alert.id is null then raise exception 'not_found' using errcode = '42501'; end if;
  v_staff := v_alert.org_id = any(public.patrol_staff_orgs());
  v_actor := public.patrol_member_id_in(v_alert.org_id);
  if p_status = 'cancelled' then
    if v_alert.member_id <> v_actor and not v_staff then raise exception 'not_allowed' using errcode = '42501'; end if;
    update public.patrol_alerts set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()),
      note = coalesce(nullif(trim(p_note), ''), note) where id = p_id returning * into v_alert;
  elsif p_status in ('acknowledged', 'resolved') then
    if not v_staff then raise exception 'not_allowed' using errcode = '42501'; end if;
    update public.patrol_alerts set status = p_status,
      acknowledged_by = coalesce(acknowledged_by, v_actor), acknowledged_at = coalesce(acknowledged_at, now()),
      resolved_by = case when p_status = 'resolved' then v_actor else resolved_by end,
      resolved_at = case when p_status = 'resolved' then now() else resolved_at end,
      note = coalesce(nullif(trim(p_note), ''), note)
    where id = p_id returning * into v_alert;
  else
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  return to_jsonb(v_alert);
end $$;

create or replace function public.patrol_mark_notified(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_table = 'patrol_incidents' then
    update public.patrol_incidents set notified_at = coalesce(notified_at, now())
     where id = p_id and (member_id = any(public.patrol_my_member_ids()) or org_id = any(public.patrol_staff_orgs()));
  elsif p_table = 'patrol_alerts' then
    update public.patrol_alerts set notified_at = coalesce(notified_at, now())
     where id = p_id and (member_id = any(public.patrol_my_member_ids()) or org_id = any(public.patrol_staff_orgs()));
  else
    raise exception 'invalid_table' using errcode = '22023';
  end if;
end $$;

-- ---------- share links ----------
create or replace function public.patrol_create_share_link(
  p_target_type text, p_target_id uuid, p_ttl_hours integer default 168, p_signed_assets jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_org uuid; v_token text; v_actor uuid; v_expires timestamptz;
begin
  if p_target_type = 'incident' then
    select org_id into v_org from public.patrol_incidents where id = p_target_id and status <> 'draft';
  elsif p_target_type = 'dar' then
    select org_id into v_org from public.patrol_dars where id = p_target_id and status <> 'open';
  else
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if v_org is null or not (v_org = any(public.patrol_staff_orgs())) then
    raise exception 'not_found' using errcode = '42501';
  end if;
  v_actor := public.patrol_member_id_in(v_org);
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_expires := now() + make_interval(hours => greatest(1, least(coalesce(p_ttl_hours, 168), 168)));
  insert into public.patrol_share_links (org_id, token_hash, target_type, target_id, signed_assets, expires_at, created_by)
  values (v_org, public.patrol_sha256(v_token), p_target_type, p_target_id, coalesce(p_signed_assets, '[]'), v_expires, v_actor);
  if p_target_type = 'incident' then
    insert into public.patrol_incident_events (org_id, incident_id, actor_id, kind, body)
    values (v_org, p_target_id, v_actor, 'shared', 'Share link created, expires ' || to_char(v_expires, 'YYYY-MM-DD HH24:MI'));
  end if;
  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end $$;

create or replace function public.patrol_get_shared_report(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_link public.patrol_share_links; v_report jsonb; v_entries jsonb := '[]'; v_site_id uuid;
begin
  select * into v_link from public.patrol_share_links
   where token_hash = public.patrol_sha256(coalesce(p_token, ''))
     and revoked_at is null and expires_at > now();
  if v_link.id is null then return null; end if;

  if v_link.target_type = 'incident' then
    select to_jsonb(i) - 'review_notes' - 'reviewed_by' - 'client_rev' - 'device_id' - 'notified_at' - 'deleted_at',
           i.site_id
      into v_report, v_site_id
      from public.patrol_incidents i where i.id = v_link.target_id and i.status <> 'draft';
  else
    select to_jsonb(d) - 'reviewed_by' - 'client_rev' - 'device_id', d.site_id
      into v_report, v_site_id
      from public.patrol_dars d where d.id = v_link.target_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'occurred_at', e.occurred_at,
             'category_name', e.category_name, 'body', e.body) order by e.occurred_at), '[]')
      into v_entries
      from public.patrol_dar_entries e where e.dar_id = v_link.target_id and e.deleted_at is null;
  end if;
  if v_report is null then return null; end if;

  update public.patrol_share_links set view_count = view_count + 1, last_viewed_at = now() where id = v_link.id;

  return jsonb_build_object(
    'target_type', v_link.target_type,
    'expires_at', v_link.expires_at,
    'report', v_report,
    'entries', v_entries,
    'assets', v_link.signed_assets,
    'org', (select jsonb_build_object('name', o.name, 'phone', o.phone, 'email', o.email, 'license_no', o.license_no, 'address', o.address)
              from public.patrol_orgs o where o.id = v_link.org_id),
    'site', (select jsonb_build_object('name', s.name, 'address', s.address, 'city', s.city, 'state', s.state, 'code', s.code)
              from public.patrol_sites s where s.id = v_site_id));
end $$;

-- ---------- housekeeping ----------
create or replace function public.patrol_storage_usage(p_org uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p_org = any(public.patrol_staff_orgs()) then
    jsonb_build_object(
      'total_bytes', coalesce((select sum(size_bytes) from public.patrol_attachments where org_id = p_org), 0),
      'by_kind', coalesce((select jsonb_object_agg(kind, b) from (
          select kind, sum(size_bytes) b from public.patrol_attachments where org_id = p_org group by kind) x), '{}'))
  else null end
$$;

create or replace function public.patrol_prune_pings()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if current_user = 'authenticated' and coalesce(array_length(public.patrol_admin_orgs(), 1), 0) = 0 then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  delete from public.patrol_location_pings p
   using public.patrol_org_settings s
   where p.org_id = s.org_id
     and p.recorded_at < now() - make_interval(days => s.ping_retention_days)
     and (current_user <> 'authenticated' or p.org_id = any(public.patrol_admin_orgs()));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------- grants ----------
do $$
declare f text;
begin
  foreach f in array array[
    'patrol_create_org(uuid,text,text,text)','patrol_public_settings()','patrol_bootstrap()',
    'patrol_create_invite(uuid,public.patrol_role,uuid[],text,text,integer,integer)',
    'patrol_redeem_invite(text,text,text)','patrol_seed_categories(uuid)',
    'patrol_reorder_categories(uuid,uuid[])','patrol_reorder_subtypes(uuid,uuid[])',
    'patrol_set_incident_status(uuid,public.patrol_incident_status,text,public.patrol_severity)',
    'patrol_set_incident_client_visible(uuid,boolean)','patrol_add_incident_note(uuid,text,boolean)',
    'patrol_set_dar_status(uuid,public.patrol_dar_status)',
    'patrol_alert_set_status(uuid,public.patrol_alert_status,text)','patrol_mark_notified(text,uuid)',
    'patrol_create_share_link(text,uuid,integer,jsonb)','patrol_storage_usage(uuid)','patrol_prune_pings()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke all on function public.patrol_get_shared_report(text) from public;
  grant execute on function public.patrol_get_shared_report(text) to anon, authenticated;
end $$;

commit;

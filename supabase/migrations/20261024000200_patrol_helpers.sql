-- Lion Patrol v2 — security-definer helpers used by RLS policies and RPCs.
-- Pattern matches public.is_admin(): security definer, fixed search_path,
-- revoked from public/anon, granted to authenticated. Re-runnable.
begin;

create or replace function public.patrol_orgs_with_role(roles public.patrol_role[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(m.org_id), '{}')
  from public.patrol_members m
  where m.user_id = auth.uid() and m.status = 'active' and m.role = any(roles)
$$;

create or replace function public.patrol_member_orgs()
returns uuid[] language sql stable security definer set search_path = public as $$
  select public.patrol_orgs_with_role('{owner,admin,supervisor,guard,client}')
$$;

create or replace function public.patrol_staff_orgs()
returns uuid[] language sql stable security definer set search_path = public as $$
  select public.patrol_orgs_with_role('{owner,admin,supervisor}')
$$;

create or replace function public.patrol_admin_orgs()
returns uuid[] language sql stable security definer set search_path = public as $$
  select public.patrol_orgs_with_role('{owner,admin}')
$$;

create or replace function public.patrol_worker_orgs()
returns uuid[] language sql stable security definer set search_path = public as $$
  select public.patrol_orgs_with_role('{owner,admin,supervisor,guard}')
$$;

create or replace function public.patrol_my_member_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from public.patrol_members
  where user_id = auth.uid() and status = 'active'
$$;

create or replace function public.patrol_my_sites()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(sa.site_id), '{}')
  from public.patrol_site_access sa
  join public.patrol_members m on m.id = sa.member_id
  where m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function public.patrol_workable_sites()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(s.id), '{}') from public.patrol_sites s
  where s.org_id = any(public.patrol_staff_orgs())
     or (s.id = any(public.patrol_my_sites()) and s.org_id = any(public.patrol_worker_orgs()))
$$;

create or replace function public.patrol_client_sites()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(sa.site_id), '{}')
  from public.patrol_site_access sa
  join public.patrol_members m on m.id = sa.member_id
  where m.user_id = auth.uid() and m.status = 'active' and m.role = 'client'
$$;

create or replace function public.patrol_member_id_in(p_org uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.patrol_members
  where org_id = p_org and user_id = auth.uid() and status = 'active'
$$;

create or replace function public.patrol_is_app_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid())
$$;

-- Crockford base32 code (no I, L, O, U). Volatile.
create or replace function public.patrol_gen_code(n int)
returns text language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  bytes bytea := extensions.gen_random_bytes(n);
  out text := '';
  i int;
begin
  for i in 0 .. n - 1 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return out;
end $$;

-- Normalises user-typed codes: strips separators and a LION prefix, maps O→0, I/L→1.
create or replace function public.patrol_normalize_code(p text)
returns text language sql immutable set search_path = public as $$
  select translate(
    case when length(c) = 12 and left(c, 4) = 'LION' then substr(c, 5) else c end,
    'OIL', '011')
  from (select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) as c) s
$$;

create or replace function public.patrol_sha256(p text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex')
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'patrol_orgs_with_role(public.patrol_role[])','patrol_member_orgs()','patrol_staff_orgs()',
    'patrol_admin_orgs()','patrol_worker_orgs()','patrol_my_member_ids()','patrol_my_sites()',
    'patrol_workable_sites()','patrol_client_sites()','patrol_member_id_in(uuid)',
    'patrol_is_app_admin()','patrol_gen_code(int)','patrol_normalize_code(text)','patrol_sha256(text)']
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('revoke all on function public.%s from anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;

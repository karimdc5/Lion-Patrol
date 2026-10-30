-- Lion Patrol v2 — pass 8 (Karim feedback items 23, 24, 26). Re-runnable; patrol_* objects only.
-- Reads (never writes) Karim's onboarding app tables public.onboarding_submissions / public.share_links
-- through one owner-only RPC that returns name, email, guard card number and expiry — nothing else.
begin;

-- ===================================================================== 23: guard cards
create table if not exists public.patrol_guard_cards (
  member_id uuid primary key references public.patrol_members(id) on delete cascade,
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  card_no text,
  expires_on date,
  source text not null default 'manual' check (source in ('manual', 'onboarding')),
  onboarding_link_id text,
  updated_by uuid references public.patrol_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists patrol_guard_cards_org_idx on public.patrol_guard_cards(org_id, expires_on);

create or replace function public.patrol_guard_cards_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.patrol_members m where m.id = new.member_id and m.org_id = new.org_id) then
    raise exception 'guard_card_member_mismatch' using errcode = '23514';
  end if;
  new.card_no := nullif(upper(regexp_replace(coalesce(new.card_no, ''), '\s+', '', 'g')), '');
  return new;
end $$;
drop trigger if exists patrol_10_guard on public.patrol_guard_cards;
create trigger patrol_10_guard before insert or update on public.patrol_guard_cards
  for each row execute function public.patrol_guard_cards_guard();

-- Owners/admins only: guards, supervisors and clients never see guard card data.
alter table public.patrol_guard_cards enable row level security;
revoke all on table public.patrol_guard_cards from anon;
grant select, insert, update, delete on table public.patrol_guard_cards to authenticated;
drop policy if exists patrol_guard_cards_admin on public.patrol_guard_cards;
create policy patrol_guard_cards_admin on public.patrol_guard_cards for all to authenticated
  using (org_id = any ((select public.patrol_admin_orgs())::uuid[]))
  with check (org_id = any ((select public.patrol_admin_orgs())::uuid[]));

-- Owner alerts gain the 'guard_card' kind.
alter table public.patrol_owner_alerts drop constraint if exists patrol_owner_alerts_kind_check;
alter table public.patrol_owner_alerts add constraint patrol_owner_alerts_kind_check
  check (kind in ('missed_checkpoint', 'overdue_patrol', 'no_show', 'geofence', 'guard_card'));

-- Read-only bridge to the onboarding app. Caller must be an owner of p_org AND on the app owners
-- list (public.app_admins, the same list that can already read onboarding_submissions directly).
-- Returns ONLY: link id, first/last name, email, guard card number + expiry, submitted_at and the
-- matching patrol member (by email). SSN, DOB, address, bank, I-9 and W-4 data are never returned.
create or replace function public.patrol_onboarding_guard_cards(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (p_org = any(public.patrol_orgs_with_role('{owner}'))) or not public.patrol_is_app_admin() then
    raise exception 'owners_only' using errcode = '42501';
  end if;
  if to_regclass('public.onboarding_submissions') is null or to_regclass('public.share_links') is null then
    return '[]'::jsonb;
  end if;
  execute $q$
    select coalesce(jsonb_agg(x order by x->>'submitted_at' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'link_id', o.link_id,
        'first_name', o.sensitive #>> '{legal,first}',
        'last_name', o.sensitive #>> '{legal,last}',
        'email', lower(nullif(trim(sl.data ->> 'email'), '')),
        'has_card', o.sensitive #>> '{license,has}',
        'card_no', nullif(trim(o.sensitive #>> '{license,number}'), ''),
        'expires_on', case when (o.sensitive #>> '{license,exp}') ~ '^\d{4}-\d{2}-\d{2}$' then o.sensitive #>> '{license,exp}' end,
        'submitted_at', o.submitted_at,
        'member_id', (select m.id from public.patrol_members m
                       where m.org_id = $1 and m.role <> 'client' and lower(m.email) = lower(nullif(trim(sl.data ->> 'email'), ''))
                       limit 1)) as x
      from public.onboarding_submissions o
      join public.share_links sl on sl.id = o.link_id
      where o.submitted_at > now() - interval '3 years') s
  $q$ into v using p_org;
  return v;
end $$;

-- ===================================================================== 24: post orders — codes + first-shift acknowledgment
-- Gate/door/alarm codes live outside patrol_sites because clients can read their site row.
create table if not exists public.patrol_site_codes (
  site_id uuid primary key references public.patrol_sites(id) on delete cascade,
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  codes text not null default '',
  guard_notes text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.patrol_site_codes enable row level security;
revoke all on table public.patrol_site_codes from anon;
grant select, insert, update, delete on table public.patrol_site_codes to authenticated;
-- Read: staff + guards who can work the site (patrol_workable_sites never includes clients).
drop policy if exists patrol_site_codes_select on public.patrol_site_codes;
create policy patrol_site_codes_select on public.patrol_site_codes for select to authenticated
  using (org_id = any ((select public.patrol_staff_orgs())::uuid[]) or site_id = any ((select public.patrol_workable_sites())::uuid[]));
drop policy if exists patrol_site_codes_write on public.patrol_site_codes;
create policy patrol_site_codes_write on public.patrol_site_codes for all to authenticated
  using (org_id = any ((select public.patrol_admin_orgs())::uuid[]))
  with check (org_id = any ((select public.patrol_admin_orgs())::uuid[])
              and exists (select 1 from public.patrol_sites s where s.id = site_id and s.org_id = patrol_site_codes.org_id));

create table if not exists public.patrol_post_order_acks (
  member_id uuid not null references public.patrol_members(id) on delete cascade,
  site_id uuid not null references public.patrol_sites(id) on delete cascade,
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  acked_at timestamptz not null default now(),
  orders_updated_at timestamptz,
  time_entry_id uuid references public.patrol_time_entries(id) on delete set null,
  primary key (member_id, site_id)
);
alter table public.patrol_post_order_acks enable row level security;
revoke all on table public.patrol_post_order_acks from anon;
grant select, insert on table public.patrol_post_order_acks to authenticated;
drop policy if exists patrol_post_order_acks_select on public.patrol_post_order_acks;
create policy patrol_post_order_acks_select on public.patrol_post_order_acks for select to authenticated
  using (member_id = any ((select public.patrol_my_member_ids())::uuid[]) or org_id = any ((select public.patrol_staff_orgs())::uuid[]));
drop policy if exists patrol_post_order_acks_insert on public.patrol_post_order_acks;
create policy patrol_post_order_acks_insert on public.patrol_post_order_acks for insert to authenticated
  with check (member_id = public.patrol_member_id_in(org_id) and site_id = any ((select public.patrol_workable_sites())::uuid[]));

-- ===================================================================== 26: billing + invoices (owners/admins only)
create table if not exists public.patrol_site_billing (
  site_id uuid primary key references public.patrol_sites(id) on delete cascade,
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  hourly_rate numeric(10,2) check (hourly_rate is null or hourly_rate >= 0),
  client_name text,
  client_email text,
  billing_address text,
  updated_at timestamptz not null default now()
);
create table if not exists public.patrol_org_billing (
  org_id uuid primary key references public.patrol_orgs(id) on delete cascade,
  payment_note text not null default 'Pay by ACH — WaFd Bank',
  payment_details text not null default '',
  terms_days integer not null default 15 check (terms_days between 0 and 120),
  invoice_prefix text not null default 'LSS-INV',
  updated_at timestamptz not null default now()
);
create table if not exists public.patrol_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid not null references public.patrol_sites(id) on delete restrict,
  period_month date not null check (extract(day from period_month) = 1),
  invoice_no text not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  issue_date date not null default current_date,
  due_date date not null default current_date + 15,
  client_name text,
  bill_to text,
  rate numeric(10,2),
  lines jsonb not null default '[]',
  notes text,
  total numeric(12,2) not null default 0,
  sent_at timestamptz, paid_at timestamptz,
  created_by uuid references public.patrol_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, invoice_no)
);
create index if not exists patrol_invoices_org_idx on public.patrol_invoices(org_id, period_month desc);

do $$
declare t text;
begin
  foreach t in array array['patrol_guard_cards', 'patrol_site_codes', 'patrol_site_billing', 'patrol_org_billing', 'patrol_invoices'] loop
    execute format('drop trigger if exists patrol_00_touch on public.%I', t);
    execute format('create trigger patrol_00_touch before update on public.%I for each row execute function public.patrol_touch_updated_at()', t);
  end loop;
  foreach t in array array['patrol_site_billing', 'patrol_org_billing', 'patrol_invoices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (org_id = any ((select public.patrol_admin_orgs())::uuid[])) with check (org_id = any ((select public.patrol_admin_orgs())::uuid[]))', t || '_admin', t);
  end loop;
end $$;

-- Billing rows must point at a site of the same org.
create or replace function public.patrol_billing_site_check()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.patrol_sites s where s.id = new.site_id and s.org_id = new.org_id) then
    raise exception 'billing_site_mismatch' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists patrol_10_check on public.patrol_site_billing;
create trigger patrol_10_check before insert or update on public.patrol_site_billing for each row execute function public.patrol_billing_site_check();
drop trigger if exists patrol_10_check on public.patrol_invoices;
create trigger patrol_10_check before insert or update on public.patrol_invoices for each row execute function public.patrol_billing_site_check();

-- ===================================================================== detector (adds guard cards)
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

  return jsonb_build_object('created', v_n);
end $$;

-- ===================================================================== grants
do $$
begin
  revoke all on function public.patrol_onboarding_guard_cards(uuid) from public, anon;
  grant execute on function public.patrol_onboarding_guard_cards(uuid) to authenticated;
  revoke all on function public.patrol_check_owner_alerts(uuid) from public, anon;
  grant execute on function public.patrol_check_owner_alerts(uuid) to authenticated;
  revoke all on function public.patrol_guard_cards_guard() from public, anon, authenticated;
  revoke all on function public.patrol_billing_site_check() from public, anon, authenticated;
end $$;

commit;

-- Lion Patrol v2 — core schema (enums, tables, indexes, updated_at trigger).
-- Only creates new patrol_* objects. Re-runnable.
begin;

-- ---------- enums ----------
do $$ begin create type public.patrol_role as enum ('owner','admin','supervisor','guard','client'); exception when duplicate_object then null; end $$;
do $$ begin create type public.patrol_membership_status as enum ('active','disabled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.patrol_incident_status as enum ('draft','submitted','reviewed','sent_to_client','closed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.patrol_severity as enum ('low','medium','high','critical'); exception when duplicate_object then null; end $$;
do $$ begin create type public.patrol_dar_status as enum ('open','submitted','reviewed','sent_to_client'); exception when duplicate_object then null; end $$;
do $$ begin create type public.patrol_alert_status as enum ('open','acknowledged','resolved','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.patrol_attach_parent as enum ('incident','dar_entry','scan','alert','site'); exception when duplicate_object then null; end $$;
do $$ begin create type public.patrol_attach_kind as enum ('image','video','audio','voice_note','document'); exception when duplicate_object then null; end $$;
do $$ begin create type public.patrol_scan_method as enum ('qr','manual'); exception when duplicate_object then null; end $$;
do $$ begin create type public.patrol_consent_kind as enum ('gps_notice','audio_notice'); exception when duplicate_object then null; end $$;

-- ---------- updated_at ----------
create or replace function public.patrol_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- orgs ----------
create table if not exists public.patrol_orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  timezone text not null default 'America/Los_Angeles',
  phone text, email text, address text, license_no text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.patrol_org_settings (
  org_id uuid primary key references public.patrol_orgs(id) on delete cascade,
  notify_emails text[] not null default '{}',
  client_notifications_enabled boolean not null default false,
  auto_share_with_client boolean not null default false,
  report_prefix text not null default 'LSS',
  next_report_no integer not null default 1,
  gps_ping_interval_s integer not null default 120 check (gps_ping_interval_s between 30 and 900),
  ping_retention_days integer not null default 30 check (ping_retention_days between 1 and 365),
  max_video_mb integer not null default 50 check (max_video_mb between 1 and 50),
  max_video_s integer not null default 60 check (max_video_s between 5 and 300),
  tour_interval_min integer not null default 60,
  tour_max_duration_min integer not null default 30,
  updated_at timestamptz not null default now()
);

-- ---------- members ----------
create table if not exists public.patrol_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.patrol_role not null,
  status public.patrol_membership_status not null default 'active',
  display_name text not null,
  email text, phone text, badge_no text, guard_card_no text,
  invited_by uuid references public.patrol_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists patrol_members_user_active_idx on public.patrol_members(user_id) where status = 'active';

-- ---------- sites ----------
create table if not exists public.patrol_sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  name text not null,
  code text,
  kind text not null default 'retail' check (kind in ('retail','apartment','other')),
  address text, city text, state text default 'WA', zip text,
  lat double precision, lng double precision,
  geofence_m integer not null default 150,
  timezone text,
  post_orders_html text not null default '',
  post_orders_updated_at timestamptz,
  contacts jsonb not null default '[]',
  tour_interval_min integer,
  tour_max_duration_min integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);
create index if not exists patrol_sites_org_idx on public.patrol_sites(org_id, active);

create table if not exists public.patrol_site_access (
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid not null references public.patrol_sites(id) on delete cascade,
  member_id uuid not null references public.patrol_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (site_id, member_id)
);
create index if not exists patrol_site_access_member_idx on public.patrol_site_access(member_id);

create table if not exists public.patrol_checkpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid not null references public.patrol_sites(id) on delete cascade,
  name text not null,
  seq integer not null default 0,
  code text not null unique,
  lat double precision, lng double precision,
  radius_m integer not null default 40,
  instructions text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists patrol_checkpoints_site_idx on public.patrol_checkpoints(site_id, seq);

-- ---------- schedule ----------
create table if not exists public.patrol_shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid not null references public.patrol_sites(id) on delete cascade,
  member_id uuid references public.patrol_members(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  notes text,
  cancelled_at timestamptz,
  created_by uuid references public.patrol_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists patrol_shifts_org_idx on public.patrol_shifts(org_id, starts_at);
create index if not exists patrol_shifts_member_idx on public.patrol_shifts(member_id, starts_at);

-- ---------- time entries ----------
create table if not exists public.patrol_time_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid not null references public.patrol_sites(id) on delete cascade,
  member_id uuid not null references public.patrol_members(id) on delete cascade,
  shift_id uuid references public.patrol_shifts(id) on delete set null,
  clock_in_at timestamptz not null,
  clock_in_lat double precision, clock_in_lng double precision, clock_in_accuracy_m double precision,
  clock_out_at timestamptz,
  clock_out_lat double precision, clock_out_lng double precision, clock_out_accuracy_m double precision,
  shift_note text,
  gps_notice_accepted_at timestamptz not null,
  client_created_at timestamptz, device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists patrol_time_entries_one_open_idx on public.patrol_time_entries(member_id) where clock_out_at is null;
create index if not exists patrol_time_entries_org_idx on public.patrol_time_entries(org_id, clock_in_at desc);
create index if not exists patrol_time_entries_upd_idx on public.patrol_time_entries(org_id, updated_at);

create table if not exists public.patrol_location_pings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  member_id uuid not null references public.patrol_members(id) on delete cascade,
  time_entry_id uuid not null references public.patrol_time_entries(id) on delete cascade,
  lat double precision not null, lng double precision not null,
  accuracy_m real,
  recorded_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists patrol_pings_entry_idx on public.patrol_location_pings(time_entry_id, recorded_at);
create index if not exists patrol_pings_org_idx on public.patrol_location_pings(org_id, recorded_at);

create table if not exists public.patrol_member_status (
  member_id uuid primary key references public.patrol_members(id) on delete cascade,
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  on_duty boolean not null default false,
  time_entry_id uuid, site_id uuid,
  lat double precision, lng double precision, accuracy_m real,
  last_ping_at timestamptz, on_duty_since timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists patrol_member_status_org_idx on public.patrol_member_status(org_id);

-- ---------- patrol tours ----------
create table if not exists public.patrol_tour_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid not null references public.patrol_sites(id) on delete cascade,
  member_id uuid not null references public.patrol_members(id) on delete cascade,
  time_entry_id uuid references public.patrol_time_entries(id) on delete set null,
  started_at timestamptz not null,
  completed_at timestamptz,
  expected_count integer not null default 0,
  scanned_count integer not null default 0,
  late boolean not null default false,
  client_created_at timestamptz, device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists patrol_tour_runs_site_idx on public.patrol_tour_runs(site_id, started_at desc);
create index if not exists patrol_tour_runs_upd_idx on public.patrol_tour_runs(org_id, updated_at);

create table if not exists public.patrol_scans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid not null references public.patrol_sites(id) on delete cascade,
  member_id uuid not null references public.patrol_members(id) on delete cascade,
  checkpoint_id uuid not null references public.patrol_checkpoints(id) on delete cascade,
  tour_run_id uuid references public.patrol_tour_runs(id) on delete set null,
  time_entry_id uuid references public.patrol_time_entries(id) on delete set null,
  scanned_at timestamptz not null,
  lat double precision, lng double precision, accuracy_m real, distance_m real,
  method public.patrol_scan_method not null default 'qr',
  flags text[] not null default '{}',
  note text,
  client_created_at timestamptz, device_id text,
  created_at timestamptz not null default now()
);
create index if not exists patrol_scans_site_idx on public.patrol_scans(site_id, scanned_at desc);
create index if not exists patrol_scans_run_idx on public.patrol_scans(tour_run_id);
create index if not exists patrol_scans_member_idx on public.patrol_scans(member_id, scanned_at desc);
create index if not exists patrol_scans_org_created_idx on public.patrol_scans(org_id, created_at);

-- ---------- categories ----------
create table if not exists public.patrol_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  name text not null,
  color text not null default '#64748B',
  icon text not null default 'note',
  sort integer not null default 0,
  hidden boolean not null default false,
  required_fields text[] not null default '{}',
  default_severity public.patrol_severity not null default 'low',
  use_for text not null default 'both' check (use_for in ('incident','dar','both')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists patrol_categories_name_uq on public.patrol_categories(org_id, lower(name));
create index if not exists patrol_categories_sort_idx on public.patrol_categories(org_id, sort);

create table if not exists public.patrol_subtypes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  category_id uuid not null references public.patrol_categories(id) on delete cascade,
  name text not null,
  sort integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists patrol_subtypes_name_uq on public.patrol_subtypes(category_id, lower(name));

-- ---------- incidents ----------
create table if not exists public.patrol_incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid not null references public.patrol_sites(id) on delete cascade,
  member_id uuid not null references public.patrol_members(id),
  author_name text not null default '',
  time_entry_id uuid references public.patrol_time_entries(id) on delete set null,
  category_id uuid references public.patrol_categories(id) on delete set null,
  subtype_id uuid references public.patrol_subtypes(id) on delete set null,
  category_name text, subtype_name text,
  title text not null default '',
  occurred_at timestamptz not null default now(),
  location_text text,
  lat double precision, lng double precision, accuracy_m real,
  description text not null default '',
  people jsonb not null default '[]',
  vehicles jsonb not null default '[]',
  police_called boolean not null default false,
  police_agency text, police_case_no text, officer_name text,
  ems_called boolean not null default false,
  fire_called boolean not null default false,
  injury boolean not null default false,
  injury_details text,
  property_damage boolean not null default false,
  damage_estimate_usd numeric(12,2),
  extra jsonb not null default '{}',
  severity public.patrol_severity not null default 'low',
  status public.patrol_incident_status not null default 'draft',
  report_no text unique,
  submitted_at timestamptz,
  client_visible boolean not null default false,
  reviewed_by uuid references public.patrol_members(id) on delete set null,
  reviewed_at timestamptz,
  sent_to_client_at timestamptz,
  review_notes text,
  client_rev integer not null default 0,
  notified_at timestamptz,
  deleted_at timestamptz,
  client_created_at timestamptz, device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists patrol_incidents_org_idx on public.patrol_incidents(org_id, occurred_at desc) where status <> 'draft';
create index if not exists patrol_incidents_client_idx on public.patrol_incidents(site_id, occurred_at desc) where client_visible;
create index if not exists patrol_incidents_member_idx on public.patrol_incidents(member_id, updated_at desc);
create index if not exists patrol_incidents_upd_idx on public.patrol_incidents(org_id, updated_at);

create table if not exists public.patrol_incident_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  incident_id uuid not null references public.patrol_incidents(id) on delete cascade,
  actor_id uuid not null references public.patrol_members(id),
  actor_name text not null default '',
  kind text not null check (kind in ('status','note','addendum','shared','pdf')),
  from_status public.patrol_incident_status,
  to_status public.patrol_incident_status,
  body text,
  created_at timestamptz not null default now()
);
create index if not exists patrol_incident_events_idx on public.patrol_incident_events(incident_id, created_at);

-- ---------- DAR ----------
create table if not exists public.patrol_dars (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid not null references public.patrol_sites(id) on delete cascade,
  member_id uuid not null references public.patrol_members(id),
  author_name text not null default '',
  time_entry_id uuid unique references public.patrol_time_entries(id) on delete set null,
  report_date date not null,
  summary text,
  status public.patrol_dar_status not null default 'open',
  report_no text unique,
  submitted_at timestamptz, reviewed_at timestamptz, sent_to_client_at timestamptz,
  reviewed_by uuid references public.patrol_members(id) on delete set null,
  client_visible boolean not null default false,
  client_rev integer not null default 0,
  client_created_at timestamptz, device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists patrol_dars_site_idx on public.patrol_dars(site_id, report_date desc);
create index if not exists patrol_dars_member_idx on public.patrol_dars(member_id, report_date desc);
create index if not exists patrol_dars_upd_idx on public.patrol_dars(org_id, updated_at);

create table if not exists public.patrol_dar_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid not null references public.patrol_sites(id) on delete cascade,
  member_id uuid not null references public.patrol_members(id),
  dar_id uuid not null references public.patrol_dars(id) on delete cascade,
  occurred_at timestamptz not null,
  category_id uuid references public.patrol_categories(id) on delete set null,
  subtype_id uuid references public.patrol_subtypes(id) on delete set null,
  category_name text,
  body text not null,
  lat double precision, lng double precision, accuracy_m real,
  client_rev integer not null default 0,
  deleted_at timestamptz,
  client_created_at timestamptz, device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists patrol_dar_entries_dar_idx on public.patrol_dar_entries(dar_id, occurred_at);
create index if not exists patrol_dar_entries_upd_idx on public.patrol_dar_entries(org_id, updated_at);

-- ---------- attachments ----------
create table if not exists public.patrol_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid references public.patrol_sites(id) on delete cascade,
  member_id uuid not null references public.patrol_members(id),
  parent_type public.patrol_attach_parent not null,
  parent_id uuid not null,
  kind public.patrol_attach_kind not null,
  storage_path text not null unique,
  thumb_path text unique,
  mime text not null,
  size_bytes bigint not null default 0,
  width integer, height integer,
  duration_s real,
  sha256 text,
  caption text,
  upload_status text not null default 'pending' check (upload_status in ('pending','uploaded')),
  uploaded_at timestamptz,
  client_created_at timestamptz, device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists patrol_attachments_parent_idx on public.patrol_attachments(parent_type, parent_id);
create index if not exists patrol_attachments_org_idx on public.patrol_attachments(org_id, created_at);
create index if not exists patrol_attachments_upd_idx on public.patrol_attachments(org_id, updated_at);

-- ---------- alerts (SOS) ----------
create table if not exists public.patrol_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid references public.patrol_sites(id) on delete set null,
  member_id uuid not null references public.patrol_members(id),
  member_name text not null default '',
  time_entry_id uuid references public.patrol_time_entries(id) on delete set null,
  triggered_at timestamptz not null,
  lat double precision, lng double precision, accuracy_m real,
  status public.patrol_alert_status not null default 'open',
  acknowledged_by uuid references public.patrol_members(id) on delete set null,
  resolved_by uuid references public.patrol_members(id) on delete set null,
  acknowledged_at timestamptz, resolved_at timestamptz, cancelled_at timestamptz,
  note text,
  notified_at timestamptz,
  client_created_at timestamptz, device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists patrol_alerts_org_idx on public.patrol_alerts(org_id, triggered_at desc);
create index if not exists patrol_alerts_open_idx on public.patrol_alerts(org_id) where status = 'open';

-- ---------- consents ----------
create table if not exists public.patrol_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  member_id uuid not null references public.patrol_members(id) on delete cascade,
  kind public.patrol_consent_kind not null,
  version integer not null default 1,
  accepted_at timestamptz not null,
  device_id text, user_agent text,
  created_at timestamptz not null default now(),
  unique (member_id, kind, version)
);

-- ---------- invites ----------
create table if not exists public.patrol_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  code_hash text not null unique,
  code_hint text not null,
  role public.patrol_role not null check (role <> 'owner'),
  site_ids uuid[] not null default '{}',
  email text,
  display_name text,
  max_uses integer not null default 1 check (max_uses between 1 and 100),
  uses integer not null default 0,
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz,
  created_by uuid not null references public.patrol_members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists patrol_invites_org_idx on public.patrol_invites(org_id, created_at desc);

create table if not exists public.patrol_invite_failures (
  user_id uuid not null,
  failed_at timestamptz not null default now()
);
create index if not exists patrol_invite_failures_idx on public.patrol_invite_failures(user_id, failed_at);

-- ---------- share links ----------
create table if not exists public.patrol_share_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  token_hash text not null unique,
  target_type text not null check (target_type in ('incident','dar')),
  target_id uuid not null,
  signed_assets jsonb not null default '[]',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  created_by uuid not null references public.patrol_members(id),
  created_at timestamptz not null default now()
);
create index if not exists patrol_share_links_target_idx on public.patrol_share_links(target_type, target_id);

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array[
    'patrol_orgs','patrol_org_settings','patrol_members','patrol_sites','patrol_checkpoints',
    'patrol_shifts','patrol_time_entries','patrol_member_status','patrol_tour_runs',
    'patrol_categories','patrol_subtypes','patrol_incidents','patrol_dars','patrol_dar_entries',
    'patrol_attachments','patrol_alerts','patrol_invites']
  loop
    execute format('drop trigger if exists patrol_00_touch on public.%I', t);
    execute format('create trigger patrol_00_touch before update on public.%I for each row execute function public.patrol_touch_updated_at()', t);
  end loop;
end $$;

commit;

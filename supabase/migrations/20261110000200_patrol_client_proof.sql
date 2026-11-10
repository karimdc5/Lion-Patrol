-- Lion Patrol v2 — pass 9, chunk 2: client proof. Re-runnable; patrol_* objects only.
--  * A7/C1: portal + signed-in client get live guard status (on site only with GPS-verified clock-in),
--          last checkpoint, next patrol due, patrol % today, checkpoint scan list, per-night patrol proof
--          counting shifts + scans + log entries, last shift date, checkpoint count, incident photos +
--          status follow-up, invoices (sent/paid only) and the client request thread.
--  * C1: client requests (portal link or client login) land as an owner task (patrol_owner_alerts).
--  * A12 + Client logs: per-site client email settings, one server-side email outbox
--          (patrol_client_emails), one nightly report per site per night (patrol_client_reports),
--          "last guard clocked out" trigger + 8 AM PT fallback, invoice "Send to client".
--          Only the edge function (service_role) can mark an email sent — never the browser.
begin;

-- ===================================================================== helpers
-- Report night: the LA wall-clock date of the moment, with the day boundary at 8:00 AM PT
-- (a 10 PM–6 AM shift belongs to the night it started; the 8 AM fallback closes the night).
create or replace function public.patrol_night_of(p_at timestamptz)
returns date language sql immutable set search_path = public as $$
  select ((p_at at time zone 'America/Los_Angeles') - interval '8 hours')::date
$$;
create or replace function public.patrol_night_start(p_night date)
returns timestamptz language sql immutable set search_path = public as $$
  select (p_night::timestamp + interval '8 hours') at time zone 'America/Los_Angeles'
$$;

-- ===================================================================== A7: portal media also covers shared incident photos
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
  or exists (
    select 1 from public.patrol_attachments a
    join public.patrol_incidents i on i.id = a.parent_id
    where a.parent_type::text = 'incident' and a.kind = 'image' and (a.storage_path = p_name or a.thumb_path = p_name)
      and i.client_visible and i.status <> 'draft'
      and (exists (select 1 from public.patrol_portal_links l
                    where l.site_id = i.site_id and l.revoked_at is null and (l.expires_at is null or l.expires_at > now()))
           or i.site_id = any(public.patrol_client_sites())))
$$;

-- ===================================================================== C1: client requests
create table if not exists public.patrol_client_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid not null references public.patrol_sites(id) on delete cascade,
  source text not null check (source in ('portal', 'client')),
  portal_link_id uuid references public.patrol_portal_links(id) on delete set null,
  member_id uuid references public.patrol_members(id) on delete set null,
  contact_name text,
  body text not null check (length(body) between 3 and 2000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  reply text,
  replied_by uuid references public.patrol_members(id) on delete set null,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists patrol_client_requests_site_idx on public.patrol_client_requests(site_id, created_at desc);
alter table public.patrol_client_requests enable row level security;
revoke all on table public.patrol_client_requests from anon;
revoke all on table public.patrol_client_requests from authenticated;
grant select on table public.patrol_client_requests to authenticated;
drop policy if exists patrol_client_requests_select on public.patrol_client_requests;
create policy patrol_client_requests_select on public.patrol_client_requests for select to authenticated
  using (org_id = any ((select public.patrol_staff_orgs())::uuid[]));

alter table public.patrol_owner_alerts drop constraint if exists patrol_owner_alerts_kind_check;
alter table public.patrol_owner_alerts add constraint patrol_owner_alerts_kind_check
  check (kind in ('missed_checkpoint', 'overdue_patrol', 'no_show', 'geofence', 'guard_card', 'long_shift', 'client_request'));

create or replace function public.patrol_add_client_request(p_site uuid, p_source text, p_link uuid, p_member uuid, p_name text, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid; v_site text; v_recent integer;
begin
  select org_id, name into v_org, v_site from public.patrol_sites where id = p_site;
  if v_org is null then raise exception 'not_found' using errcode = '42501'; end if;
  if length(trim(coalesce(p_body, ''))) < 3 then raise exception 'request_too_short' using errcode = '23514'; end if;
  select count(*) into v_recent from public.patrol_client_requests
   where site_id = p_site and created_at > now() - interval '1 day';
  if v_recent >= 20 then raise exception 'too_many_requests' using errcode = '54000'; end if;
  insert into public.patrol_client_requests (org_id, site_id, source, portal_link_id, member_id, contact_name, body)
  values (v_org, p_site, p_source, p_link, p_member, nullif(left(trim(coalesce(p_name, '')), 80), ''), left(trim(p_body), 2000))
  returning id into v_id;
  -- Lands as an owner task (owner/admin alert list on Live).
  insert into public.patrol_owner_alerts (org_id, kind, dedupe_key, site_id, title, body)
  values (v_org, 'client_request', 'req:' || v_id, p_site, 'Client request · ' || v_site, left(trim(p_body), 300))
  on conflict (org_id, dedupe_key) do nothing;
  return v_id;
end $$;

-- Anonymous portal link holder.
create or replace function public.patrol_portal_request(p_token text, p_body text, p_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_link public.patrol_portal_links;
begin
  select * into v_link from public.patrol_portal_links
   where token_hash = public.patrol_sha256(coalesce(p_token, ''))
     and revoked_at is null and (expires_at is null or expires_at > now());
  if v_link.id is null then raise exception 'link_inactive' using errcode = '42501'; end if;
  return public.patrol_add_client_request(v_link.site_id, 'portal', v_link.id, null, p_name, p_body);
end $$;

-- Signed-in client (own sites only).
create or replace function public.patrol_client_request(p_site uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_member uuid; v_name text;
begin
  if not (p_site = any(public.patrol_client_sites())) then raise exception 'not_found' using errcode = '42501'; end if;
  select org_id into v_org from public.patrol_sites where id = p_site;
  v_member := public.patrol_member_id_in(v_org);
  select display_name into v_name from public.patrol_members where id = v_member;
  return public.patrol_add_client_request(p_site, 'client', null, v_member, v_name, p_body);
end $$;

-- Owner/admin/supervisor reply + status.
create or replace function public.patrol_reply_client_request(p_id uuid, p_reply text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.patrol_client_requests where id = p_id;
  if v_org is null or not (v_org = any(public.patrol_staff_orgs())) then raise exception 'not_found' using errcode = '42501'; end if;
  if p_status not in ('open', 'in_progress', 'done') then raise exception 'bad_status' using errcode = '23514'; end if;
  update public.patrol_client_requests set status = p_status,
    reply = coalesce(nullif(left(trim(coalesce(p_reply, '')), 2000), ''), reply),
    replied_by = case when nullif(trim(coalesce(p_reply, '')), '') is not null then public.patrol_member_id_in(v_org) else replied_by end,
    replied_at = case when nullif(trim(coalesce(p_reply, '')), '') is not null then now() else replied_at end,
    updated_at = now()
  where id = p_id;
end $$;

-- ===================================================================== A12: per-site client email settings + pay link
create table if not exists public.patrol_site_client_email (
  site_id uuid primary key references public.patrol_sites(id) on delete cascade,
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  recipients text[] not null default '{}' check (coalesce(array_length(recipients, 1), 0) <= 10),
  auto_send_logs boolean not null default false,     -- default: hold nightly report for the owner's OK
  notify_incident boolean not null default false,    -- incident marked "Sent to client"
  notify_missed_patrol boolean not null default false,
  notify_dar boolean not null default false,         -- DAR shared with the client
  notify_invoice boolean not null default false,     -- invoice "Send to client"
  updated_at timestamptz not null default now()
);
alter table public.patrol_site_client_email enable row level security;
revoke all on table public.patrol_site_client_email from anon;
grant select, insert, update, delete on table public.patrol_site_client_email to authenticated;
drop policy if exists patrol_site_client_email_admin on public.patrol_site_client_email;
create policy patrol_site_client_email_admin on public.patrol_site_client_email for all to authenticated
  using (org_id = any ((select public.patrol_admin_orgs())::uuid[]))
  with check (org_id = any ((select public.patrol_admin_orgs())::uuid[])
              and exists (select 1 from public.patrol_sites s where s.id = site_id and s.org_id = patrol_site_client_email.org_id));
drop trigger if exists patrol_00_touch on public.patrol_site_client_email;
create trigger patrol_00_touch before update on public.patrol_site_client_email
  for each row execute function public.patrol_touch_updated_at();

-- Optional online pay link shown on client invoices (must be https). Without it the portal says so.
alter table public.patrol_org_billing add column if not exists pay_url text;
alter table public.patrol_org_billing drop constraint if exists patrol_org_billing_pay_url_check;
alter table public.patrol_org_billing add constraint patrol_org_billing_pay_url_check check (pay_url is null or pay_url ~ '^https://');

-- ===================================================================== A12: server-side email outbox
-- Rows are queued by triggers / owner RPCs. Only the patrol-client-logs edge function (service_role)
-- claims and finishes them, so 'sent' always means the mail provider accepted the message.
create table if not exists public.patrol_client_emails (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid references public.patrol_sites(id) on delete cascade,
  kind text not null check (kind in ('client_log', 'incident', 'missed_patrol', 'dar', 'invoice', 'owner_ping')),
  ref_id uuid,
  dedupe_key text not null,
  subject text not null default '',
  body_text text not null default '',
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'not_configured', 'failed', 'dry_run', 'no_recipients', 'cancelled')),
  attempts integer not null default 0,
  error text,
  provider_id text,
  sent_to text[] not null default '{}',
  queued_by uuid references public.patrol_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (org_id, dedupe_key)
);
create index if not exists patrol_client_emails_status_idx on public.patrol_client_emails(status, created_at);
alter table public.patrol_client_emails enable row level security;
revoke all on table public.patrol_client_emails from anon;
revoke all on table public.patrol_client_emails from authenticated;
grant select on table public.patrol_client_emails to authenticated;
drop policy if exists patrol_client_emails_select on public.patrol_client_emails;
create policy patrol_client_emails_select on public.patrol_client_emails for select to authenticated
  using (org_id = any ((select public.patrol_admin_orgs())::uuid[]));
drop trigger if exists patrol_00_touch on public.patrol_client_emails;
create trigger patrol_00_touch before update on public.patrol_client_emails
  for each row execute function public.patrol_touch_updated_at();

-- Internal: queue one email (deduped). Returns the outbox id, or null when the site toggle is off.
create or replace function public.patrol_queue_client_email(p_org uuid, p_site uuid, p_kind text, p_ref uuid, p_dedupe text,
                                                            p_subject text, p_body text, p_force boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_set public.patrol_site_client_email; v_on boolean; v_id uuid;
begin
  if not p_force then
    select * into v_set from public.patrol_site_client_email where site_id = p_site;
    v_on := case p_kind when 'incident' then v_set.notify_incident when 'missed_patrol' then v_set.notify_missed_patrol
                        when 'dar' then v_set.notify_dar when 'invoice' then v_set.notify_invoice else true end;
    if not coalesce(v_on, false) then return null; end if;
  end if;
  insert into public.patrol_client_emails (org_id, site_id, kind, ref_id, dedupe_key, subject, body_text, queued_by)
  values (p_org, p_site, p_kind, p_ref, p_dedupe, left(p_subject, 200), left(p_body, 8000),
          case when auth.uid() is not null then public.patrol_member_id_in(p_org) end)
  on conflict (org_id, dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.patrol_fmt_pt(p_at timestamptz)
returns text language sql stable set search_path = public as $$
  select to_char(p_at at time zone 'America/Los_Angeles', 'Mon DD, YYYY HH12:MI AM') || ' PT'
$$;

-- Client email: incident marked "Sent to client" (shared, never internal-only).
create or replace function public.patrol_incidents_client_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_site text;
begin
  if new.status::text = 'sent_to_client' and old.status::text is distinct from 'sent_to_client' and new.client_visible then
    select name into v_site from public.patrol_sites where id = new.site_id;
    perform public.patrol_queue_client_email(new.org_id, new.site_id, 'incident', new.id, 'inc:' || new.id,
      'Incident report ' || coalesce(new.report_no, '') || ' — ' || coalesce(v_site, 'your site'),
      coalesce(nullif(new.title, ''), new.category_name, 'Incident') || E'\n'
        || 'Severity: ' || new.severity::text || E'\n'
        || 'Occurred: ' || public.patrol_fmt_pt(new.occurred_at) || E'\n\n'
        || left(coalesce(new.description, ''), 3000));
  end if;
  return new;
exception when others then
  raise warning 'patrol_incidents_client_email: %', sqlerrm;
  return new;
end $$;
drop trigger if exists patrol_60_client_email on public.patrol_incidents;
create trigger patrol_60_client_email after update on public.patrol_incidents
  for each row execute function public.patrol_incidents_client_email();

-- Client email: DAR shared with the client.
create or replace function public.patrol_dars_client_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_site text;
begin
  if new.client_visible and new.status::text <> 'open' and (tg_op = 'INSERT' or not old.client_visible) then
    select name into v_site from public.patrol_sites where id = new.site_id;
    perform public.patrol_queue_client_email(new.org_id, new.site_id, 'dar', new.id, 'dar:' || new.id,
      'Daily activity report ' || to_char(new.report_date, 'Mon DD, YYYY') || ' — ' || coalesce(v_site, 'your site'),
      'Your daily activity report for ' || to_char(new.report_date, 'Mon DD, YYYY') || ' is ready'
        || coalesce(' (' || new.report_no || ')', '') || E'.\n\n' || left(coalesce(new.summary, ''), 3000));
  end if;
  return new;
exception when others then
  raise warning 'patrol_dars_client_email: %', sqlerrm;
  return new;
end $$;
drop trigger if exists patrol_60_client_email on public.patrol_dars;
create trigger patrol_60_client_email after insert or update on public.patrol_dars
  for each row execute function public.patrol_dars_client_email();

-- Client email: missed / overdue patrol (from the server-side alert detector). No guard names.
create or replace function public.patrol_owner_alerts_client_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_site text;
begin
  if new.kind in ('missed_checkpoint', 'overdue_patrol') and new.site_id is not null then
    select name into v_site from public.patrol_sites where id = new.site_id;
    perform public.patrol_queue_client_email(new.org_id, new.site_id, 'missed_patrol', new.id, 'miss:' || new.id,
      'Patrol notice — ' || coalesce(v_site, 'your site'),
      case new.kind when 'missed_checkpoint' then 'A patrol round at ' || coalesce(v_site, 'your site') || ' did not reach every checkpoint in time'
                    else 'A scheduled patrol round at ' || coalesce(v_site, 'your site') || ' started late' end
        || ' (' || public.patrol_fmt_pt(new.created_at) || '). Our supervisor has been alerted.');
  end if;
  return new;
exception when others then
  raise warning 'patrol_owner_alerts_client_email: %', sqlerrm;
  return new;
end $$;
drop trigger if exists patrol_60_client_email on public.patrol_owner_alerts;
create trigger patrol_60_client_email after insert on public.patrol_owner_alerts
  for each row execute function public.patrol_owner_alerts_client_email();

-- ===================================================================== Client logs: one report per site per night
create table if not exists public.patrol_client_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.patrol_orgs(id) on delete cascade,
  site_id uuid not null references public.patrol_sites(id) on delete cascade,
  night date not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'ready', 'queued', 'sending', 'sent', 'not_configured', 'failed', 'dry_run', 'no_recipients')),
  ready_reason text check (ready_reason is null or ready_reason in ('last_clock_out', 'fallback_8am')),
  note text,
  ready_at timestamptz,
  approved_by uuid references public.patrol_members(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  send_count integer not null default 0,
  last_email_id uuid references public.patrol_client_emails(id) on delete set null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, night)
);
create index if not exists patrol_client_reports_org_idx on public.patrol_client_reports(org_id, night desc);
alter table public.patrol_client_reports enable row level security;
revoke all on table public.patrol_client_reports from anon;
revoke all on table public.patrol_client_reports from authenticated;
grant select on table public.patrol_client_reports to authenticated;
drop policy if exists patrol_client_reports_select on public.patrol_client_reports;
create policy patrol_client_reports_select on public.patrol_client_reports for select to authenticated
  using (org_id = any ((select public.patrol_admin_orgs())::uuid[]));
drop trigger if exists patrol_00_touch on public.patrol_client_reports;
create trigger patrol_00_touch before update on public.patrol_client_reports
  for each row execute function public.patrol_touch_updated_at();

-- Internal: queue the combined report email for one report (send now / auto-send / resend).
create or replace function public.patrol_client_report_queue(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.patrol_client_reports; v_site text; v_email uuid;
begin
  select * into r from public.patrol_client_reports where id = p_id for update;
  select name into v_site from public.patrol_sites where id = r.site_id;
  v_email := public.patrol_queue_client_email(r.org_id, r.site_id, 'client_log', r.id, 'log:' || r.id || ':' || (r.send_count + 1),
    'Nightly patrol report — ' || coalesce(v_site, 'your site') || ' — ' || to_char(r.night, 'Mon DD, YYYY'), '', true);
  update public.patrol_client_reports set status = 'queued', send_count = send_count + 1, last_email_id = v_email, last_error = null
   where id = p_id;
  return v_email;
end $$;

-- "Last scheduled guard clocked out" (mirrors nightReportState() in supabase/functions/_shared/client-logs.ts):
--  * entries = non-voided clock-ins at the site during the night window [night 8 AM PT, next day 8 AM PT)
--  * pending = assigned, uncancelled shifts starting in the window, not yet ended, whose guard has not clocked in
--  * ready when entries exist and nobody is still on shift and nobody scheduled is still to come;
--    otherwise ready at the 8 AM PT fallback with a note naming who never clocked out.
-- Only a 'waiting' (or new) report moves; ready/sent reports are never touched again.
create or replace function public.patrol_client_report_evaluate(p_site uuid, p_night date)
returns text language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_start timestamptz; v_end timestamptz; v_entries integer; v_open integer; v_pending integer;
        v_open_names text; v_report public.patrol_client_reports; v_auto boolean; v_reason text; v_note text; v_site text;
begin
  select org_id, name into v_org, v_site from public.patrol_sites where id = p_site;
  if v_org is null then return 'no_site'; end if;
  v_start := public.patrol_night_start(p_night);
  v_end := public.patrol_night_start(p_night + 1);
  select count(*), count(*) filter (where t.clock_out_at is null),
         string_agg(coalesce(m.display_name, 'A guard'), ', ') filter (where t.clock_out_at is null)
    into v_entries, v_open, v_open_names
    from public.patrol_time_entries t left join public.patrol_members m on m.id = t.member_id
   where t.site_id = p_site and t.voided_at is null and t.clock_in_at >= v_start and t.clock_in_at < v_end;
  select count(*) into v_pending from public.patrol_shifts sh
   where sh.site_id = p_site and sh.member_id is not null and sh.cancelled_at is null
     and sh.starts_at >= v_start and sh.starts_at < v_end and sh.ends_at > now()
     and not exists (select 1 from public.patrol_time_entries t where t.member_id = sh.member_id and t.site_id = p_site
                      and t.voided_at is null and t.clock_in_at >= v_start and t.clock_in_at < v_end);
  if v_entries = 0 and v_pending = 0 then return 'no_activity'; end if;

  insert into public.patrol_client_reports (org_id, site_id, night) values (v_org, p_site, p_night)
  on conflict (site_id, night) do nothing;
  select * into v_report from public.patrol_client_reports where site_id = p_site and night = p_night for update;
  if v_report.status <> 'waiting' then return v_report.status; end if;

  if v_entries > 0 and v_open = 0 and v_pending = 0 then
    v_reason := 'last_clock_out';
  elsif now() >= v_end and v_entries > 0 then
    v_reason := 'fallback_8am';
    v_note := case when v_open > 0 then v_open_names || ' had not clocked out by 8:00 AM PT; this report covers activity until 8:00 AM PT.'
                   else 'A scheduled guard had not clocked in by 8:00 AM PT.' end;
  else
    return 'waiting';
  end if;

  update public.patrol_client_reports set status = 'ready', ready_reason = v_reason, note = v_note, ready_at = now()
   where id = v_report.id;
  select coalesce(auto_send_logs, false) into v_auto from public.patrol_site_client_email where site_id = p_site;
  if coalesce(v_auto, false) then
    perform public.patrol_client_report_queue(v_report.id);
    return 'queued';
  end if;
  -- Hold for the owner's OK: one server-side owners-only ping per report.
  perform public.patrol_queue_client_email(v_org, p_site, 'owner_ping', v_report.id, 'ping:' || v_report.id,
    'Ready for your OK: nightly report — ' || coalesce(v_site, 'site') || ' — ' || to_char(p_night, 'Mon DD, YYYY'),
    'The combined nightly client report for ' || coalesce(v_site, 'this site') || ' (' || to_char(p_night, 'Mon DD, YYYY')
      || ') is ready. Open Lion Patrol → Client logs to preview it and press Send.', true);
  return 'ready';
end $$;

-- Every clock-in / clock-out / void re-evaluates that night. Never blocks the clock action.
create or replace function public.patrol_time_entries_client_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.patrol_client_report_evaluate(new.site_id, public.patrol_night_of(new.clock_in_at));
  return null;
exception when others then
  raise warning 'patrol_time_entries_client_report: %', sqlerrm;
  return null;
end $$;
drop trigger if exists patrol_70_client_report on public.patrol_time_entries;
create trigger patrol_70_client_report after insert or update of clock_out_at, voided_at on public.patrol_time_entries
  for each row execute function public.patrol_time_entries_client_report();

-- Cron: re-evaluate the last 3 nights for every site with activity (drives the 8 AM PT fallback).
create or replace function public.patrol_cron_client_reports()
returns integer language plpgsql security definer set search_path = public as $$
declare x record; v_n integer := 0;
begin
  for x in
    select distinct site_id, public.patrol_night_of(clock_in_at) as night from public.patrol_time_entries
     where clock_in_at > now() - interval '3 days' and voided_at is null
    union
    select distinct site_id, public.patrol_night_of(starts_at) from public.patrol_shifts
     where starts_at > now() - interval '3 days' and starts_at < now() and member_id is not null and cancelled_at is null
  loop
    begin
      if public.patrol_client_report_evaluate(x.site_id, x.night) in ('ready', 'queued') then v_n := v_n + 1; end if;
    exception when others then
      raise warning 'patrol_cron_client_reports: site % night % failed: %', x.site_id, x.night, sqlerrm;
    end;
  end loop;
  return v_n;
end $$;

-- Owner: Send now / Resend (also the "OK" for a held report).
create or replace function public.patrol_client_report_send(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.patrol_client_reports; v_email uuid;
begin
  select * into r from public.patrol_client_reports where id = p_id;
  if r.id is null or not (r.org_id = any(public.patrol_admin_orgs())) then raise exception 'not_found' using errcode = '42501'; end if;
  if r.status in ('waiting', 'queued', 'sending') then raise exception 'report_not_ready' using errcode = '23514'; end if;
  v_email := public.patrol_client_report_queue(p_id);
  update public.patrol_client_reports set approved_by = public.patrol_member_id_in(r.org_id), approved_at = now() where id = p_id;
  return v_email;
end $$;

-- Owner: mark a queued email as "not configured" when the email function isn't deployed (honest state).
create or replace function public.patrol_client_email_unavailable(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare e public.patrol_client_emails;
begin
  select * into e from public.patrol_client_emails where id = p_id;
  if e.id is null or not (e.org_id = any(public.patrol_admin_orgs())) then raise exception 'not_found' using errcode = '42501'; end if;
  if e.status <> 'queued' then return; end if;
  update public.patrol_client_emails set status = 'not_configured', error = left(coalesce(p_reason, 'Email sending is not configured'), 300) where id = p_id;
  if e.kind = 'client_log' then
    update public.patrol_client_reports set status = 'not_configured', last_error = left(coalesce(p_reason, ''), 300)
     where id = e.ref_id and last_email_id = p_id;
  end if;
end $$;

-- Merged raw material for one report (owner preview + the edge function). Internal-only incidents
-- (not client-visible) and drafts are never returned; ordering/formatting is done by
-- mergeNightReport() in supabase/functions/_shared/client-logs.ts.
create or replace function public.patrol_client_report_items(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.patrol_client_reports; v_start timestamptz; v_end timestamptz;
begin
  select * into r from public.patrol_client_reports where id = p_id;
  if r.id is null then return null; end if;
  if auth.uid() is not null and not (r.org_id = any(public.patrol_admin_orgs())) then return null; end if;
  v_start := public.patrol_night_start(r.night);
  v_end := public.patrol_night_start(r.night + 1);
  return jsonb_build_object(
    'report', to_jsonb(r),
    'site', (select jsonb_build_object('id', s.id, 'name', s.name, 'address', s.address, 'city', s.city) from public.patrol_sites s where s.id = r.site_id),
    'org', (select jsonb_build_object('name', o.name, 'phone', o.phone, 'email', o.email) from public.patrol_orgs o where o.id = r.org_id),
    'window', jsonb_build_object('start', v_start, 'end', v_end),
    'shifts', coalesce((select jsonb_agg(jsonb_build_object('member_id', t.member_id, 'guard', coalesce(m.display_name, 'Guard'),
                 'clock_in_at', t.clock_in_at, 'clock_out_at', t.clock_out_at, 'voided_at', t.voided_at) order by t.clock_in_at)
               from public.patrol_time_entries t left join public.patrol_members m on m.id = t.member_id
              where t.site_id = r.site_id and t.voided_at is null and t.clock_in_at >= v_start and t.clock_in_at < v_end), '[]'::jsonb),
    'tours', coalesce((select jsonb_agg(jsonb_build_object('started_at', x.started_at, 'completed_at', x.completed_at,
                 'expected_count', x.expected_count, 'scanned_count', x.scanned_count, 'guard', coalesce(m.display_name, 'Guard')) order by x.started_at)
               from public.patrol_tour_runs x left join public.patrol_members m on m.id = x.member_id
              where x.site_id = r.site_id and x.started_at >= v_start and x.started_at < v_end), '[]'::jsonb),
    'scans', coalesce((select jsonb_agg(jsonb_build_object('scanned_at', sc.scanned_at, 'checkpoint', c.name, 'guard', coalesce(m.display_name, 'Guard')) order by sc.scanned_at)
               from public.patrol_scans sc join public.patrol_checkpoints c on c.id = sc.checkpoint_id left join public.patrol_members m on m.id = sc.member_id
              where sc.site_id = r.site_id and sc.scanned_at >= v_start and sc.scanned_at < v_end), '[]'::jsonb),
    'logs', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'occurred_at', e.occurred_at, 'category', e.category_name, 'body', e.body,
                 'guard', coalesce(m.display_name, 'Guard'), 'deleted_at', e.deleted_at,
                 'photos', coalesce((select jsonb_agg(a.storage_path order by a.created_at) from public.patrol_attachments a
                                      where a.parent_type::text = 'dar_entry' and a.parent_id = e.id and a.kind = 'image' and a.upload_status = 'uploaded'), '[]'::jsonb))
                 order by e.occurred_at)
               from public.patrol_dar_entries e left join public.patrol_members m on m.id = e.member_id
              where e.site_id = r.site_id and e.deleted_at is null and e.occurred_at >= v_start and e.occurred_at < v_end), '[]'::jsonb),
    'incidents', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'occurred_at', i.occurred_at, 'report_no', i.report_no,
                 'title', coalesce(nullif(i.title, ''), i.category_name), 'category', i.category_name, 'severity', i.severity, 'status', i.status,
                 'client_visible', i.client_visible, 'description', i.description, 'guard', i.author_name,
                 'photos', coalesce((select jsonb_agg(a.storage_path order by a.created_at) from public.patrol_attachments a
                                      where a.parent_type::text = 'incident' and a.parent_id = i.id and a.kind = 'image' and a.upload_status = 'uploaded'), '[]'::jsonb))
                 order by i.occurred_at)
               from public.patrol_incidents i
              where i.site_id = r.site_id and i.client_visible and i.status <> 'draft'
                and i.occurred_at >= v_start and i.occurred_at < v_end), '[]'::jsonb)
  );
end $$;

-- ===================================================================== A12: invoice "Send to client"
create or replace function public.patrol_invoice_send(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v public.patrol_invoices; v_set public.patrol_site_client_email; v_bill public.patrol_org_billing; v_site text;
        v_client_email text; v_id uuid; v_n integer;
begin
  select * into v from public.patrol_invoices where id = p_id;
  if v.id is null or not (v.org_id = any(public.patrol_admin_orgs())) then raise exception 'not_found' using errcode = '42501'; end if;
  if v.status = 'void' then raise exception 'invoice_void' using errcode = '23514'; end if;
  if coalesce(v.total, 0) <= 0 then raise exception 'invoice_zero' using errcode = '23514'; end if;
  select * into v_set from public.patrol_site_client_email where site_id = v.site_id;
  if not coalesce(v_set.notify_invoice, false) then raise exception 'invoice_email_off' using errcode = '23514'; end if;
  select client_email into v_client_email from public.patrol_site_billing where site_id = v.site_id;
  if coalesce(array_length(v_set.recipients, 1), 0) = 0 and nullif(trim(coalesce(v_client_email, '')), '') is null then
    raise exception 'no_client_email' using errcode = '23514';
  end if;
  select * into v_bill from public.patrol_org_billing where org_id = v.org_id;
  select name into v_site from public.patrol_sites where id = v.site_id;
  select count(*) into v_n from public.patrol_client_emails where org_id = v.org_id and kind = 'invoice' and ref_id = v.id;
  v_id := public.patrol_queue_client_email(v.org_id, v.site_id, 'invoice', v.id, 'invoice:' || v.id || ':' || (v_n + 1),
    'Invoice ' || v.invoice_no || ' — ' || coalesce(v_site, ''),
    'Invoice ' || v.invoice_no || ' for ' || coalesce(v_site, 'your site') || ', ' || to_char(v.period_month, 'FMMonth YYYY') || E'.\n'
      || 'Amount due: $' || to_char(v.total, 'FM999,999,990.00') || E'\n'
      || 'Due date: ' || to_char(v.due_date, 'Mon DD, YYYY') || E'\n'
      || 'Billed from confirmed guard hours at $' || to_char(coalesce(v.rate, 0), 'FM999,990.00') || E'/hr.\n\n'
      || case when nullif(trim(coalesce(v_bill.pay_url, '')), '') is not null then 'Pay online: ' || v_bill.pay_url
              else 'Online payment is not set up. ' || coalesce(v_bill.payment_note, '') || ' ' || coalesce(v_bill.payment_details, '') end,
    true);
  return v_id;
end $$;

-- ===================================================================== Edge function only (service_role)
-- Claim queued emails (also re-claims rows stuck in 'sending' for 15 min). Resolves recipients
-- server-side: client kinds → the site's client email list (+ billing email for invoices);
-- owner_ping → active owner/admin members' emails that are on the org's notify list.
create or replace function public.patrol_client_email_claim(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with c as (
    select id from public.patrol_client_emails
     where status = 'queued' or (status = 'sending' and updated_at < now() - interval '15 minutes')
     order by created_at limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  ), u as (
    update public.patrol_client_emails e set status = 'sending', attempts = attempts + 1
      from c where e.id = c.id returning e.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'org_id', u.org_id, 'site_id', u.site_id, 'kind', u.kind, 'ref_id', u.ref_id,
           'subject', u.subject, 'body_text', u.body_text, 'attempts', u.attempts,
           'recipients', case when u.kind = 'owner_ping' then
               coalesce((select jsonb_agg(distinct lower(m.email)) from public.patrol_members m join public.patrol_org_settings s on s.org_id = m.org_id
                          where m.org_id = u.org_id and m.status = 'active' and m.role in ('owner', 'admin') and m.email is not null
                            and lower(m.email) = any (select lower(x) from unnest(s.notify_emails) x)), '[]'::jsonb)
             else coalesce((select to_jsonb(array(select distinct lower(trim(x)) from unnest(
                    coalesce(ce.recipients, '{}') || case when u.kind = 'invoice' then array[b.client_email] else '{}'::text[] end) x
                    where nullif(trim(coalesce(x, '')), '') is not null))
                  from (select 1) one
                  left join public.patrol_site_client_email ce on ce.site_id = u.site_id
                  left join public.patrol_site_billing b on b.site_id = u.site_id), '[]'::jsonb) end)), '[]'::jsonb)
    into v from u;
  -- mirror on reports
  update public.patrol_client_reports r set status = 'sending'
    from public.patrol_client_emails e
   where e.kind = 'client_log' and e.status = 'sending' and r.id = e.ref_id and r.last_email_id = e.id and r.status = 'queued';
  return v;
end $$;

create or replace function public.patrol_client_email_result(p_id uuid, p_status text, p_error text default null,
                                                             p_provider_id text default null, p_sent_to text[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare e public.patrol_client_emails;
begin
  if p_status not in ('sent', 'not_configured', 'failed', 'dry_run', 'no_recipients') then raise exception 'bad_status'; end if;
  update public.patrol_client_emails set status = p_status, error = left(p_error, 500), provider_id = p_provider_id,
    sent_to = coalesce(p_sent_to, '{}'), sent_at = case when p_status = 'sent' then now() else sent_at end
   where id = p_id returning * into e;
  if e.id is null then return; end if;
  if e.kind = 'client_log' then
    update public.patrol_client_reports set status = p_status, last_error = left(p_error, 500),
      sent_at = case when p_status = 'sent' then now() else sent_at end
     where id = e.ref_id and last_email_id = e.id;
  elsif e.kind = 'invoice' and p_status = 'sent' then
    update public.patrol_invoices set status = case when status = 'draft' then 'sent' else status end, sent_at = coalesce(sent_at, now())
     where id = e.ref_id;
  end if;
end $$;

-- ===================================================================== C1: per-site client proof payload
-- Internal (no grants): called by the portal RPC and the signed-in client RPC below.
-- "Guard on site" is only 'yes' with a GPS-verified clock-in inside the geofence; a clock-in without
-- verified GPS is reported as such, never as "on site". Guard names are never included.
create or replace function public.patrol_site_proof(p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_site public.patrol_sites; v_interval integer; v_cps integer; v_te public.patrol_time_entries; v_last_run timestamptz;
        v_today date := public.patrol_night_of(now()); v_state text;
begin
  select * into v_site from public.patrol_sites where id = p_site;
  if v_site.id is null then return null; end if;
  select coalesce(v_site.tour_interval_min, s.tour_interval_min, 60) into v_interval from public.patrol_org_settings s where s.org_id = v_site.org_id;
  v_interval := coalesce(v_interval, 60);
  select count(*) into v_cps from public.patrol_checkpoints where site_id = p_site and active;
  select * into v_te from public.patrol_time_entries
   where site_id = p_site and clock_out_at is null and voided_at is null and clock_in_at > now() - interval '16 hours'
   order by coalesce(clock_in_gps_status = 'ok', false) desc, clock_in_at desc limit 1;
  v_state := case when v_te.id is null then 'no' when v_te.clock_in_gps_status = 'ok' then 'yes' else 'unverified' end;
  if v_te.id is not null then
    select max(started_at) into v_last_run from public.patrol_tour_runs where site_id = p_site and started_at >= v_te.clock_in_at;
  end if;
  return jsonb_build_object(
    'checkpoint_count', v_cps,
    'live', jsonb_build_object(
      'on_site', v_state,
      'since', case when v_te.id is not null then v_te.clock_in_at end,
      'last_scan', (select jsonb_build_object('checkpoint', c.name, 'at', sc.scanned_at) from public.patrol_scans sc
                     join public.patrol_checkpoints c on c.id = sc.checkpoint_id where sc.site_id = p_site order by sc.scanned_at desc limit 1),
      'next_patrol_due', case when v_te.id is not null and v_cps > 0 then coalesce(v_last_run, v_te.clock_in_at) + make_interval(mins => v_interval) end,
      'today', (select jsonb_build_object('expected', coalesce(sum(expected_count), 0), 'scanned', coalesce(sum(least(scanned_count, expected_count)), 0))
                  from public.patrol_tour_runs where site_id = p_site and public.patrol_night_of(started_at) = v_today)),
    'last_shift_at', (select max(coalesce(clock_out_at, clock_in_at)) from public.patrol_time_entries where site_id = p_site and voided_at is null),
    'scans', coalesce((select jsonb_agg(jsonb_build_object('checkpoint', x.name, 'at', x.scanned_at) order by x.scanned_at desc) from (
                select c.name, sc.scanned_at from public.patrol_scans sc join public.patrol_checkpoints c on c.id = sc.checkpoint_id
                 where sc.site_id = p_site and sc.scanned_at > now() - interval '7 days' order by sc.scanned_at desc limit 150) x), '[]'::jsonb),
    'nights', coalesce((select jsonb_agg(jsonb_build_object('night', n.night, 'shifts', n.shifts, 'scans', n.scans, 'logs', n.logs,
                 'expected', n.expected, 'scanned', n.scanned) order by n.night) from (
        select d.night,
          (select count(*) from public.patrol_time_entries t where t.site_id = p_site and t.voided_at is null and public.patrol_night_of(t.clock_in_at) = d.night) shifts,
          (select count(*) from public.patrol_scans sc where sc.site_id = p_site and public.patrol_night_of(sc.scanned_at) = d.night) scans,
          (select count(*) from public.patrol_dar_entries e where e.site_id = p_site and e.deleted_at is null and public.patrol_night_of(e.occurred_at) = d.night) logs,
          (select coalesce(sum(expected_count), 0) from public.patrol_tour_runs x where x.site_id = p_site and public.patrol_night_of(x.started_at) = d.night) expected,
          (select coalesce(sum(least(scanned_count, expected_count)), 0) from public.patrol_tour_runs x where x.site_id = p_site and public.patrol_night_of(x.started_at) = d.night) scanned
        from (select (v_today - g)::date night from generate_series(0, 6) g) d) n), '[]'::jsonb),
    'incident_media', coalesce((select jsonb_agg(jsonb_build_object('incident_id', i.id,
          'photos', coalesce((select jsonb_agg(jsonb_build_object('path', a.storage_path, 'thumb', a.thumb_path) order by a.created_at)
                               from public.patrol_attachments a where a.parent_type::text = 'incident' and a.parent_id = i.id and a.kind = 'image'
                                 and a.upload_status = 'uploaded'), '[]'::jsonb),
          'photos_pending', (select count(*) from public.patrol_attachments a where a.parent_type::text = 'incident' and a.parent_id = i.id
                               and a.kind = 'image' and a.upload_status <> 'uploaded'),
          'follow_up', coalesce((select jsonb_agg(jsonb_build_object('at', ev.created_at, 'status', ev.to_status) order by ev.created_at)
                                  from public.patrol_incident_events ev where ev.incident_id = i.id and ev.kind = 'status'), '[]'::jsonb)))
        from public.patrol_incidents i
       where i.site_id = p_site and i.client_visible and i.status <> 'draft' and i.occurred_at > now() - interval '180 days'), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'invoice_no', v.invoice_no, 'status', v.status,
          'issue_date', v.issue_date, 'due_date', v.due_date, 'period_month', v.period_month, 'total', v.total, 'rate', v.rate,
          'sent_at', v.sent_at, 'paid_at', v.paid_at,
          'hours', (select coalesce(sum((l ->> 'hours')::numeric), 0) from jsonb_array_elements(v.lines) l),
          'days', (select coalesce(jsonb_agg(jsonb_build_object('date', d.date, 'hours', d.hours) order by d.date), '[]'::jsonb)
                     from (select l ->> 'date' as date, sum((l ->> 'hours')::numeric) hours from jsonb_array_elements(v.lines) l group by 1) d))
        order by v.period_month desc)
        from public.patrol_invoices v where v.site_id = p_site and v.status in ('sent', 'paid')), '[]'::jsonb),
    'pay_url', (select nullif(trim(coalesce(b.pay_url, '')), '') from public.patrol_org_billing b where b.org_id = v_site.org_id),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'body', q.body, 'created_at', q.created_at, 'status', q.status,
          'reply', q.reply, 'replied_at', q.replied_at, 'contact_name', q.contact_name) order by q.created_at desc)
        from (select * from public.patrol_client_requests where site_id = p_site order by created_at desc limit 20) q), '[]'::jsonb)
  );
end $$;

-- Signed-in client (own sites) or staff.
create or replace function public.patrol_client_site_proof(p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.patrol_sites where id = p_site;
  if v_org is null or not (p_site = any(public.patrol_client_sites()) or v_org = any(public.patrol_staff_orgs())) then return null; end if;
  return public.patrol_site_proof(p_site);
end $$;

-- Portal payload v4: previous payload + incident photos + 'proof'.
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
        'field_config', (select c.field_config from public.patrol_categories c where c.id = i.category_id),
        'photos', coalesce((select jsonb_agg(jsonb_build_object('path', a.storage_path, 'thumb', a.thumb_path) order by a.created_at)
                            from public.patrol_attachments a where a.parent_type::text = 'incident' and a.parent_id = i.id and a.kind = 'image'
                              and a.upload_status = 'uploaded'), '[]'::jsonb)) order by i.occurred_at desc)
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
      from public.patrol_tour_runs r where r.site_id = v_link.site_id and r.started_at > now() - interval '14 days'), '[]'::jsonb),
    'proof', public.patrol_site_proof(v_link.site_id)
  );
end $$;

-- ===================================================================== grants
do $$
declare f text;
begin
  -- signed-in only
  foreach f in array array['patrol_client_request(uuid,text)', 'patrol_reply_client_request(uuid,text,text)',
    'patrol_client_site_proof(uuid)', 'patrol_client_report_send(uuid)', 'patrol_client_email_unavailable(uuid,text)',
    'patrol_client_report_items(uuid)', 'patrol_invoice_send(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- internal / triggers / cron
  foreach f in array array['patrol_add_client_request(uuid,text,uuid,uuid,text,text)',
    'patrol_queue_client_email(uuid,uuid,text,uuid,text,text,text,boolean)', 'patrol_incidents_client_email()', 'patrol_dars_client_email()',
    'patrol_owner_alerts_client_email()', 'patrol_client_report_queue(uuid)', 'patrol_client_report_evaluate(uuid,date)',
    'patrol_time_entries_client_report()', 'patrol_cron_client_reports()', 'patrol_site_proof(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- edge function only (service_role); never the browser
  foreach f in array array['patrol_client_email_claim(integer)', 'patrol_client_email_result(uuid,text,text,text,text[])'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  grant execute on function public.patrol_client_report_items(uuid) to service_role;
  grant execute on function public.patrol_cron_client_reports() to service_role;
  revoke all on function public.patrol_portal_request(text,text,text) from public;
  grant execute on function public.patrol_portal_request(text,text,text) to anon, authenticated;
  revoke all on function public.patrol_portal_media_ok(text) from public;
  grant execute on function public.patrol_portal_media_ok(text) to anon, authenticated;
  revoke all on function public.patrol_get_portal(text) from public;
  grant execute on function public.patrol_get_portal(text) to anon, authenticated;
end $$;

-- ===================================================================== schedules (only where pg_cron is installed)
-- 1) every 15 min: re-evaluate nights (8 AM PT fallback). Pure SQL, no secrets.
-- 2) every 5 min: wake the patrol-client-logs edge function through pg_net, only if both Vault
--    secrets exist: 'patrol_client_logs_url' (https://<project>.supabase.co/functions/v1/patrol-client-logs)
--    and 'patrol_cron_secret' (same value as the function's PATROL_CRON_SECRET). See docs/PASS9-backend-setup.md.
create or replace function public.patrol_cron_kick_client_emails()
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') or not exists (select 1 from pg_namespace where nspname = 'vault') then return; end if;
  if not exists (select 1 from public.patrol_client_emails where status = 'queued' or (status = 'sending' and updated_at < now() - interval '15 minutes')) then return; end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'patrol_client_logs_url'$q$ into v_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'patrol_cron_secret'$q$ into v_secret;
  if v_url is null or v_secret is null then return; end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3)'
    using v_url, jsonb_build_object('Content-Type', 'application/json', 'x-patrol-cron-secret', v_secret), jsonb_build_object('action', 'process');
end $$;
revoke all on function public.patrol_cron_kick_client_emails() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('patrol_client_reports', '*/15 * * * *', 'select public.patrol_cron_client_reports()');
    perform cron.schedule('patrol_client_emails', '*/5 * * * *', 'select public.patrol_cron_kick_client_emails()');
  else
    raise notice 'pg_cron not installed: enable it, then re-run this migration to schedule patrol_client_reports / patrol_client_emails';
  end if;
end $$;

commit;

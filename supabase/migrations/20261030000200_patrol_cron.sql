-- Lion Patrol v2 — item 27: server-side owner-alert check every 5 minutes (no phone needs to be open),
-- + email claiming so each alert triggers at most one owners-only email, + Gusto employee id.
-- Only patrol_* objects and one pg_cron job named 'patrol_owner_alerts'. Re-runnable.
begin;

-- Each alert is emailed once: whichever device claims it first sends the (detail-free) owners email.
alter table public.patrol_owner_alerts add column if not exists notified_at timestamptz;

create or replace function public.patrol_claim_owner_alert_emails(p_org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not (p_org = any(public.patrol_worker_orgs())) then return 0; end if;
  update public.patrol_owner_alerts set notified_at = now()
   where org_id = p_org and notified_at is null and acknowledged_at is null and created_at > now() - interval '1 day';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Cron entry point: runs the same detector the phones run (same dedupe keys + unique constraint,
-- so nothing is ever duplicated) for every org. auth.uid() is null here, which the detector allows.
create or replace function public.patrol_cron_owner_alerts()
returns integer language plpgsql security definer set search_path = public as $$
declare o record; v_n integer := 0; r jsonb;
begin
  for o in select id from public.patrol_orgs loop
    begin
      r := public.patrol_check_owner_alerts(o.id);
      v_n := v_n + coalesce((r ->> 'created')::int, 0);
    exception when others then
      raise warning 'patrol_cron_owner_alerts: org % failed: %', o.id, sqlerrm;
    end;
  end loop;
  return v_n;
end $$;

-- Optional Gusto employee id per member (owners/admins edit it; used in the hours CSV).
alter table public.patrol_members add column if not exists gusto_employee_id text;

do $$
begin
  revoke all on function public.patrol_claim_owner_alert_emails(uuid) from public, anon;
  grant execute on function public.patrol_claim_owner_alert_emails(uuid) to authenticated;
  revoke all on function public.patrol_cron_owner_alerts() from public, anon, authenticated;
end $$;

-- Schedule only where pg_cron is installed (Supabase: Database → Extensions → pg_cron).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('patrol_owner_alerts', '*/5 * * * *', 'select public.patrol_cron_owner_alerts()');
  else
    raise notice 'pg_cron not installed: enable it, then re-run this migration to schedule patrol_owner_alerts';
  end if;
end $$;

commit;

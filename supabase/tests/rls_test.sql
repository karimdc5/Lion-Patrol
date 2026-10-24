-- Lion Patrol v2 — RLS isolation test.
-- Runs in ONE transaction, impersonates throwaway users, raises 'RLS FAIL: …' on the first
-- failed assertion and ends in ROLLBACK, so it leaves zero data behind.
-- Run as postgres:  psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
begin;

-- ===================================================================== fixtures (postgres)
-- users: a1 owner A · a2 guard A (site A1) · a3 guard A (site A2) · a4 client A (site A1)
--        a5 supervisor A · b1 owner B · b2 guard B · c1 outsider · c2 new hire
insert into auth.users (id, email, aud, role, instance_id, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-0000000000a1','rls-owner-a@test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-0000000000a2','rls-guard-a1@test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-0000000000a3','rls-guard-a2@test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-0000000000a4','rls-client-a@test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-0000000000a5','rls-super-a@test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-0000000000b1','rls-owner-b@test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-0000000000b2','rls-guard-b@test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-0000000000c1','rls-outsider@test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-0000000000c2','rls-newhire@test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}','{}',now(),now());
insert into public.app_admins (user_id, email) values
 ('00000000-0000-4000-8000-0000000000a1','rls-owner-a@test.invalid'),
 ('00000000-0000-4000-8000-0000000000b1','rls-owner-b@test.invalid');

-- ===================================================================== bootstrap orgs via RPC
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","email":"rls-owner-a@test.invalid"}', true);
do $$ begin
  if public.patrol_create_org('10000000-0000-4000-8000-00000000000a', 'RLS Org A', 'America/Los_Angeles', 'Owner A') <> '10000000-0000-4000-8000-00000000000a' then
    raise exception 'RLS FAIL: create_org A'; end if;
  -- idempotent replay
  perform public.patrol_create_org('10000000-0000-4000-8000-00000000000a', 'RLS Org A');
  if (select count(*) from public.patrol_categories) < 20 then raise exception 'RLS FAIL: categories not seeded'; end if;
  if (select count(*) from public.patrol_subtypes) < 60 then raise exception 'RLS FAIL: subtypes not seeded'; end if;
  if public.patrol_seed_categories('10000000-0000-4000-8000-00000000000a') <> 0 then raise exception 'RLS FAIL: reseed should add 0'; end if;
  if (select notify_emails from public.patrol_org_settings) <> array['rls-owner-a@test.invalid'] then raise exception 'RLS FAIL: notify_emails'; end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","email":"rls-owner-b@test.invalid"}', true);
select public.patrol_create_org('10000000-0000-4000-8000-00000000000b', 'RLS Org B', 'America/Los_Angeles', 'Owner B');
reset role;

-- members, sites, access, checkpoints (as postgres)
insert into public.patrol_members (id, org_id, user_id, role, display_name) values
 ('20000000-0000-4000-8000-0000000000a2','10000000-0000-4000-8000-00000000000a','00000000-0000-4000-8000-0000000000a2','guard','Guard A1'),
 ('20000000-0000-4000-8000-0000000000a3','10000000-0000-4000-8000-00000000000a','00000000-0000-4000-8000-0000000000a3','guard','Guard A2'),
 ('20000000-0000-4000-8000-0000000000a4','10000000-0000-4000-8000-00000000000a','00000000-0000-4000-8000-0000000000a4','client','Client A'),
 ('20000000-0000-4000-8000-0000000000a5','10000000-0000-4000-8000-00000000000a','00000000-0000-4000-8000-0000000000a5','supervisor','Super A'),
 ('20000000-0000-4000-8000-0000000000b2','10000000-0000-4000-8000-00000000000b','00000000-0000-4000-8000-0000000000b2','guard','Guard B');
insert into public.patrol_sites (id, org_id, name, code) values
 ('30000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-00000000000a','Site A1','A1'),
 ('30000000-0000-4000-8000-0000000000a2','10000000-0000-4000-8000-00000000000a','Site A2','A2'),
 ('30000000-0000-4000-8000-0000000000b1','10000000-0000-4000-8000-00000000000b','Site B1','B1');
insert into public.patrol_site_access (org_id, site_id, member_id) values
 ('10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000a2'),
 ('10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a2','20000000-0000-4000-8000-0000000000a3'),
 ('10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000a4'),
 ('10000000-0000-4000-8000-00000000000b','30000000-0000-4000-8000-0000000000b1','20000000-0000-4000-8000-0000000000b2');
insert into public.patrol_checkpoints (id, org_id, site_id, name, seq, code) values
 ('40000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a1','A1 Front',1,'RLSTSTA1'),
 ('40000000-0000-4000-8000-0000000000a2','10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a1','A1 Rear',2,'RLSTSTA2'),
 ('40000000-0000-4000-8000-0000000000a3','10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a2','A2 Gate',1,'RLSTSTA3'),
 ('40000000-0000-4000-8000-0000000000b1','10000000-0000-4000-8000-00000000000b','30000000-0000-4000-8000-0000000000b1','B1 Door',1,'RLSTSTB1');

-- ===================================================================== guard A1 writes through RLS
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","email":"rls-guard-a1@test.invalid"}', true);
insert into public.patrol_consents (id, org_id, member_id, kind, version, accepted_at)
values ('50000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-00000000000a','20000000-0000-4000-8000-0000000000a2','gps_notice',1,now());
insert into public.patrol_time_entries (id, org_id, site_id, member_id, clock_in_at, clock_in_lat, clock_in_lng, gps_notice_accepted_at)
values ('51000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000a2',now(),47.38,-122.23,now());
insert into public.patrol_location_pings (id, org_id, member_id, time_entry_id, lat, lng, recorded_at)
values ('52000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-00000000000a','20000000-0000-4000-8000-0000000000a2','51000000-0000-4000-8000-0000000000a1',47.381,-122.231,now() + interval '1 minute');
-- idempotent replay of the same ping (outbox resend)
insert into public.patrol_location_pings (id, org_id, member_id, time_entry_id, lat, lng, recorded_at)
values ('52000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-00000000000a','20000000-0000-4000-8000-0000000000a2','51000000-0000-4000-8000-0000000000a1',47.381,-122.231,now() + interval '1 minute')
on conflict (id) do nothing;
insert into public.patrol_tour_runs (id, org_id, site_id, member_id, time_entry_id, started_at, expected_count)
values ('53000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000a2','51000000-0000-4000-8000-0000000000a1',now(),2);
insert into public.patrol_scans (id, org_id, site_id, member_id, checkpoint_id, tour_run_id, scanned_at, method)
values ('54000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000a2','40000000-0000-4000-8000-0000000000a1','53000000-0000-4000-8000-0000000000a1',now(),'manual');
-- I1 draft, I2 submitted
insert into public.patrol_incidents (id, org_id, site_id, member_id, title, status, client_rev, author_name, client_visible, review_notes)
values ('60000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000a2','A1 draft','draft',1,'SPOOFED',true,'spoof');
insert into public.patrol_incidents (id, org_id, site_id, member_id, title, status, client_rev)
values ('60000000-0000-4000-8000-0000000000a2','10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000a2','A1 submitted','draft',1);
update public.patrol_incidents set status = 'submitted', client_rev = 2, description = 'Final' where id = '60000000-0000-4000-8000-0000000000a2';
insert into public.patrol_attachments (id, org_id, member_id, parent_type, parent_id, kind, storage_path, mime, size_bytes)
values ('61000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-00000000000a','20000000-0000-4000-8000-0000000000a2','incident','60000000-0000-4000-8000-0000000000a1','image',
        '10000000-0000-4000-8000-00000000000a/incident/60000000-0000-4000-8000-0000000000a1/61000000-0000-4000-8000-0000000000a1.jpg','image/jpeg',1000);
insert into public.patrol_dars (id, org_id, site_id, member_id, time_entry_id, report_date)
values ('62000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000a2','51000000-0000-4000-8000-0000000000a1',current_date);
insert into public.patrol_dar_entries (id, org_id, site_id, member_id, dar_id, occurred_at, body)
values ('63000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000a2','62000000-0000-4000-8000-0000000000a1',now(),'All doors secure');
insert into public.patrol_alerts (id, org_id, site_id, member_id, triggered_at)
values ('64000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000a2',now());

do $$ declare ok boolean; r record; begin
  -- visibility
  if (select count(*) from public.patrol_sites) <> 1 then raise exception 'RLS FAIL: guard_a1 should see exactly 1 site'; end if;
  if (select count(*) from public.patrol_checkpoints) <> 2 then raise exception 'RLS FAIL: guard_a1 should see 2 checkpoints'; end if;
  if (select count(*) from public.patrol_incidents) <> 2 then raise exception 'RLS FAIL: guard_a1 should see own 2 incidents'; end if;
  if (select count(*) from public.patrol_org_settings) <> 0 then raise exception 'RLS FAIL: guard can read org settings'; end if;
  if (select count(*) from public.patrol_location_pings where member_id <> '20000000-0000-4000-8000-0000000000a2') <> 0 then raise exception 'RLS FAIL: guard can read others pings'; end if;
  if (select count(*) from public.patrol_members) <> 1 then raise exception 'RLS FAIL: guard should see only self in members'; end if;
  if (select count(*) from public.patrol_orgs) <> 1 then raise exception 'RLS FAIL: guard should see only own org'; end if;
  if (select count(*) from public.patrol_categories where org_id = '10000000-0000-4000-8000-00000000000b') <> 0 then raise exception 'RLS FAIL: guard sees org B categories'; end if;
  if (select count(*) from public.patrol_member_status) <> 1 then raise exception 'RLS FAIL: guard should see own status'; end if;

  -- triggers did their job
  select * into r from public.patrol_incidents where id = '60000000-0000-4000-8000-0000000000a1';
  if r.author_name <> 'Guard A1' or r.client_visible or r.review_notes is not null then raise exception 'RLS FAIL: insert spoofing not stripped'; end if;
  select * into r from public.patrol_incidents where id = '60000000-0000-4000-8000-0000000000a2';
  if r.report_no is null or r.report_no not like 'LSS-A1-%-00001' or r.submitted_at is null then raise exception 'RLS FAIL: report_no not assigned (%)', r.report_no; end if;
  if (select scanned_count from public.patrol_tour_runs where id = '53000000-0000-4000-8000-0000000000a1') <> 1 then raise exception 'RLS FAIL: scanned_count'; end if;
  if (select last_ping_at from public.patrol_member_status) is null then raise exception 'RLS FAIL: member_status not updated by ping'; end if;

  -- can't write for another org / another member
  ok := false; begin
    insert into public.patrol_incidents (org_id, site_id, member_id, title)
    values ('10000000-0000-4000-8000-00000000000b','30000000-0000-4000-8000-0000000000b1','20000000-0000-4000-8000-0000000000a2','x');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'RLS FAIL: guard inserted into org B'; end if;
  ok := false; begin
    insert into public.patrol_incidents (org_id, site_id, member_id, title)
    values ('10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000a3','x');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'RLS FAIL: guard inserted as another member'; end if;
  ok := false; begin
    insert into public.patrol_incidents (org_id, site_id, member_id, title)
    values ('10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a2','20000000-0000-4000-8000-0000000000a2','x');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'RLS FAIL: guard inserted at unassigned site'; end if;
  ok := false; begin
    insert into public.patrol_scans (org_id, site_id, member_id, checkpoint_id, scanned_at)
    values ('10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000a2','40000000-0000-4000-8000-0000000000a3', now());
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'RLS FAIL: scan with checkpoint from another site accepted'; end if;

  -- submitted content is frozen; stale replay is a silent no-op
  ok := false; begin
    update public.patrol_incidents set description = 'tampered', client_rev = 3 where id = '60000000-0000-4000-8000-0000000000a2';
  exception when raise_exception then ok := true; end;
  if not ok then raise exception 'RLS FAIL: guard edited submitted incident'; end if;
  update public.patrol_incidents set description = 'stale', client_rev = 2 where id = '60000000-0000-4000-8000-0000000000a2';
  if (select description from public.patrol_incidents where id = '60000000-0000-4000-8000-0000000000a2') <> 'Final' then raise exception 'RLS FAIL: stale replay changed data'; end if;
  ok := false; begin
    update public.patrol_incidents set status = 'reviewed', client_rev = 9 where id = '60000000-0000-4000-8000-0000000000a1';
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'RLS FAIL: guard self-reviewed'; end if;

  -- guards can't change alerts directly, but can cancel their own via RPC
  update public.patrol_alerts set status = 'resolved' where id = '64000000-0000-4000-8000-0000000000a1';
  if (select status from public.patrol_alerts where id = '64000000-0000-4000-8000-0000000000a1') <> 'open' then raise exception 'RLS FAIL: guard updated alert directly'; end if;
  ok := false; begin
    perform public.patrol_alert_set_status('64000000-0000-4000-8000-0000000000a1', 'resolved');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'RLS FAIL: guard resolved alert'; end if;

  -- members: self can rename but not promote
  update public.patrol_members set role = 'owner', display_name = 'Guard A1' where user_id = auth.uid();
  if (select role from public.patrol_members where user_id = auth.uid()) <> 'guard' then raise exception 'RLS FAIL: guard self-promoted'; end if;

  -- invites are admin-only
  ok := false; begin
    perform public.patrol_create_invite('10000000-0000-4000-8000-00000000000a', 'guard');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'RLS FAIL: guard created invite'; end if;
end $$;
reset role;

-- ===================================================================== guard A2
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated","email":"rls-guard-a2@test.invalid"}', true);
insert into public.patrol_incidents (id, org_id, site_id, member_id, title, status, client_rev)
values ('60000000-0000-4000-8000-0000000000a3','10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a2','20000000-0000-4000-8000-0000000000a3','A2 submitted','submitted',1),
       ('60000000-0000-4000-8000-0000000000a4','10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a2','20000000-0000-4000-8000-0000000000a3','A2 draft','draft',1);
do $$ declare ok boolean; begin
  if (select count(*) from public.patrol_incidents where id = '60000000-0000-4000-8000-0000000000a1') <> 0 then raise exception 'RLS FAIL: guard_a2 reads guard_a1 draft'; end if;
  if (select count(*) from public.patrol_incidents where member_id = '20000000-0000-4000-8000-0000000000a2') <> 0 then raise exception 'RLS FAIL: guard_a2 reads guard_a1 incidents'; end if;
  if (select count(*) from public.patrol_attachments) <> 0 then raise exception 'RLS FAIL: guard_a2 reads guard_a1 attachments'; end if;
  if (select count(*) from public.patrol_dar_entries) <> 0 then raise exception 'RLS FAIL: guard_a2 reads guard_a1 DAR entries'; end if;
  if (select count(*) from public.patrol_scans) <> 0 then raise exception 'RLS FAIL: guard_a2 reads guard_a1 scans'; end if;
  if (select count(*) from public.patrol_sites) <> 1 then raise exception 'RLS FAIL: guard_a2 should see 1 site'; end if;
  ok := false; begin
    insert into public.patrol_attachments (org_id, member_id, parent_type, parent_id, kind, storage_path, mime)
    values ('10000000-0000-4000-8000-00000000000a','20000000-0000-4000-8000-0000000000a3','incident','60000000-0000-4000-8000-0000000000a1','image',
            '10000000-0000-4000-8000-00000000000a/incident/x/y.jpg','image/jpeg');
  exception when foreign_key_violation or insufficient_privilege then ok := true; end;
  if not ok then raise exception 'RLS FAIL: guard_a2 attached to guard_a1 incident'; end if;
end $$;
reset role;

-- storage object visibility (skipped gracefully if storage.objects rejects direct inserts)
create temp table rls_storage (inserted boolean) on commit drop;
grant all on rls_storage to authenticated;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('patrol-media',
    '10000000-0000-4000-8000-00000000000a/incident/60000000-0000-4000-8000-0000000000a1/61000000-0000-4000-8000-0000000000a1.jpg');
  insert into rls_storage values (true);
exception when others then
  insert into rls_storage values (false);
  raise notice 'storage.objects direct insert not permitted here; object check skipped (%)', sqlerrm;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from storage.objects where bucket_id = 'patrol-media') <> 0 then raise exception 'RLS FAIL: guard_a2 sees guard_a1 storage object'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
do $$ begin
  if (select inserted from rls_storage) and (select count(*) from storage.objects where bucket_id = 'patrol-media') <> 1 then
    raise exception 'RLS FAIL: guard_a1 should see own storage object'; end if;
end $$;
reset role;

-- ===================================================================== supervisor A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
do $$ declare ok boolean; begin
  if (select count(*) from public.patrol_incidents) <> 2 then raise exception 'RLS FAIL: supervisor should see 2 submitted incidents (no drafts), saw %', (select count(*) from public.patrol_incidents); end if;
  if (select count(*) from public.patrol_incidents where status = 'draft') <> 0 then raise exception 'RLS FAIL: supervisor sees drafts'; end if;
  if (select count(*) from public.patrol_incidents where org_id = '10000000-0000-4000-8000-00000000000b') <> 0 then raise exception 'RLS FAIL: supervisor sees org B'; end if;
  if (select count(*) from public.patrol_sites) <> 2 then raise exception 'RLS FAIL: supervisor should see both org A sites'; end if;
  if (select count(*) from public.patrol_location_pings) <> 1 then raise exception 'RLS FAIL: supervisor should see org pings'; end if;
  if (select count(*) from public.patrol_dars) <> 0 then raise exception 'RLS FAIL: supervisor sees open DAR'; end if;
  perform public.patrol_set_incident_status('60000000-0000-4000-8000-0000000000a3', 'reviewed', 'Looks good');
  ok := false; begin
    perform public.patrol_create_invite('10000000-0000-4000-8000-00000000000a', 'guard');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'RLS FAIL: supervisor created invite'; end if;
  ok := false; begin
    insert into public.patrol_categories (org_id, name) values ('10000000-0000-4000-8000-00000000000a', 'Nope');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'RLS FAIL: supervisor created category'; end if;
end $$;
reset role;

-- ===================================================================== owner A: review, share, invite
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","email":"rls-owner-a@test.invalid"}', true);
create temp table rls_tokens (k text primary key, v text) on commit drop;
grant all on rls_tokens to authenticated, anon;
do $$ declare inv jsonb; link jsonb; ok boolean; begin
  perform public.patrol_set_incident_status('60000000-0000-4000-8000-0000000000a2', 'sent_to_client', 'Sent');
  perform public.patrol_add_incident_note('60000000-0000-4000-8000-0000000000a2', 'internal only');
  if (select count(*) from public.patrol_incidents where status = 'draft') <> 0 then raise exception 'RLS FAIL: owner sees guard drafts'; end if;
  link := public.patrol_create_share_link('incident', '60000000-0000-4000-8000-0000000000a2', 24, '[]');
  insert into rls_tokens values ('share', link ->> 'token');
  inv := public.patrol_create_invite('10000000-0000-4000-8000-00000000000a', 'guard', array['30000000-0000-4000-8000-0000000000a1']::uuid[]);
  insert into rls_tokens values ('invite', inv ->> 'code');
  ok := false; begin
    perform public.patrol_create_invite('10000000-0000-4000-8000-00000000000a', 'owner');
  exception when insufficient_privilege or check_violation then ok := true; end;
  if not ok then raise exception 'RLS FAIL: owner invite allowed'; end if;
  ok := false; begin
    perform public.patrol_create_invite('10000000-0000-4000-8000-00000000000a', 'client', array['30000000-0000-4000-8000-0000000000b1']::uuid[]);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'RLS FAIL: invite to other org site allowed'; end if;
  ok := false; begin
    update public.patrol_members set role = 'guard' where user_id = auth.uid();
  exception when raise_exception then ok := true; end;
  if not ok then raise exception 'RLS FAIL: last owner demoted'; end if;
  perform public.patrol_reorder_categories('10000000-0000-4000-8000-00000000000a',
    array(select id from public.patrol_categories order by sort desc));
  if (select name from public.patrol_categories order by sort limit 1) <> 'Other' then raise exception 'RLS FAIL: reorder'; end if;
  if (public.patrol_bootstrap() -> 'settings') = '[]'::jsonb then raise exception 'RLS FAIL: owner bootstrap lacks settings'; end if;
end $$;
reset role;

-- ===================================================================== client A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
do $$ declare ok boolean; n int; begin
  if (select count(*) from public.patrol_sites) <> 1 then raise exception 'RLS FAIL: client should see 1 site'; end if;
  if (select count(*) from public.patrol_incidents) <> 1 then raise exception 'RLS FAIL: client should see exactly 1 shared incident, saw %', (select count(*) from public.patrol_incidents); end if;
  if (select title from public.patrol_incidents) <> 'A1 submitted' then raise exception 'RLS FAIL: client sees wrong incident'; end if;
  if (select count(*) from public.patrol_scans) <> 1 then raise exception 'RLS FAIL: client should see A1 scans'; end if;
  if (select count(*) from public.patrol_location_pings) + (select count(*) from public.patrol_time_entries)
     + (select count(*) from public.patrol_alerts) + (select count(*) from public.patrol_member_status) <> 0 then
    raise exception 'RLS FAIL: client sees pings/time entries/alerts/status'; end if;
  if (select count(*) from public.patrol_members) <> 1 then raise exception 'RLS FAIL: client sees other members'; end if;
  if (select count(*) from public.patrol_org_settings) <> 0 then raise exception 'RLS FAIL: client sees org settings'; end if;
  if (select count(*) from public.patrol_incident_events) <> 0 then raise exception 'RLS FAIL: client sees incident events'; end if;
  if (select count(*) from public.patrol_dars) <> 0 then raise exception 'RLS FAIL: client sees unshared DAR'; end if;
  if (public.patrol_bootstrap() -> 'settings') <> '[]'::jsonb then raise exception 'RLS FAIL: client bootstrap leaks settings'; end if;
  ok := false; begin
    insert into public.patrol_incidents (org_id, site_id, member_id, title)
    values ('10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000a4','x');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'RLS FAIL: client inserted incident'; end if;
  update public.patrol_incidents set title = 'hacked';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS FAIL: client updated incident'; end if;
  update public.patrol_sites set name = 'hacked';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS FAIL: client updated site'; end if;
  delete from public.patrol_scans;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS FAIL: client deleted scans'; end if;
end $$;
reset role;

-- ===================================================================== org B isolation
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.patrol_incidents where org_id = '10000000-0000-4000-8000-00000000000a') <> 0 then raise exception 'RLS FAIL: owner B sees org A incidents'; end if;
  if (select count(*) from public.patrol_sites where org_id = '10000000-0000-4000-8000-00000000000a') <> 0 then raise exception 'RLS FAIL: owner B sees org A sites'; end if;
  if (select count(*) from public.patrol_members where org_id = '10000000-0000-4000-8000-00000000000a') <> 0 then raise exception 'RLS FAIL: owner B sees org A members'; end if;
  if (select count(*) from public.patrol_categories where org_id = '10000000-0000-4000-8000-00000000000a') <> 0 then raise exception 'RLS FAIL: owner B sees org A categories'; end if;
  if (select count(*) from public.patrol_orgs) <> 1 then raise exception 'RLS FAIL: owner B sees other orgs'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.patrol_sites) <> 1 or (select count(*) from public.patrol_sites where org_id <> '10000000-0000-4000-8000-00000000000b') <> 0 then
    raise exception 'RLS FAIL: guard B site isolation'; end if;
  if (select count(*) from public.patrol_checkpoints where org_id = '10000000-0000-4000-8000-00000000000a') <> 0 then raise exception 'RLS FAIL: guard B sees org A checkpoints'; end if;
end $$;
reset role;

-- ===================================================================== outsider + invite redemption
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated","email":"rls-outsider@test.invalid"}', true);
do $$ declare ok boolean; i int; r jsonb; t text; begin
  foreach t in array array['patrol_orgs','patrol_members','patrol_sites','patrol_checkpoints','patrol_incidents','patrol_scans',
                           'patrol_categories','patrol_dars','patrol_dar_entries','patrol_attachments','patrol_alerts',
                           'patrol_time_entries','patrol_tour_runs','patrol_shifts','patrol_invites','patrol_share_links'] loop
    execute format('select count(*) from public.%I', t) into i;
    if i <> 0 then raise exception 'RLS FAIL: outsider sees % rows in %', i, t; end if;
  end loop;
  ok := false; begin
    perform public.patrol_create_org(gen_random_uuid(), 'Rogue Org');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'RLS FAIL: outsider created org'; end if;
  for i in 1..10 loop
    r := public.patrol_redeem_invite('LION-0000-000' || i::text, 'Rogue');
    if r ->> 'error' <> 'invalid_invite' then raise exception 'RLS FAIL: bad invite code result %', r; end if;
  end loop;
  r := public.patrol_redeem_invite((select v from rls_tokens where k = 'invite'), 'Rogue');
  if r ->> 'error' <> 'too_many_attempts' then raise exception 'RLS FAIL: invite throttle not applied (%)', r; end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated","email":"rls-newhire@test.invalid"}', true);
do $$ declare r jsonb; begin
  r := public.patrol_redeem_invite(lower(replace((select v from rls_tokens where k = 'invite'), '-', ' ')), 'New Hire', '253-555-0100');
  if not (r ->> 'ok')::boolean or r ->> 'role' <> 'guard' then raise exception 'RLS FAIL: invite redeem failed (%)', r; end if;
  if (select count(*) from public.patrol_sites) <> 1 then raise exception 'RLS FAIL: new hire should see site A1'; end if;
  if (select count(*) from public.patrol_incidents) <> 0 then raise exception 'RLS FAIL: new hire sees incidents'; end if;
  r := public.patrol_redeem_invite((select v from rls_tokens where k = 'invite'), 'New Hire');
  if r ->> 'error' <> 'invalid_invite' then raise exception 'RLS FAIL: single-use invite reused'; end if;
  if jsonb_array_length(public.patrol_bootstrap() -> 'memberships') <> 1 then raise exception 'RLS FAIL: bootstrap memberships'; end if;
end $$;
reset role;

-- ===================================================================== anon share link
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ declare r jsonb; ok boolean; begin
  r := public.patrol_get_shared_report((select v from rls_tokens where k = 'share'));
  if r is null or r -> 'report' ->> 'title' <> 'A1 submitted' then raise exception 'RLS FAIL: share link fetch'; end if;
  if (r -> 'report') ? 'review_notes' then raise exception 'RLS FAIL: share link leaks review notes'; end if;
  if public.patrol_get_shared_report('not-a-token') is not null then raise exception 'RLS FAIL: bad token returned data'; end if;
  ok := false; begin
    perform count(*) from public.patrol_incidents;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'RLS FAIL: anon can query patrol_incidents'; end if;
  ok := false; begin
    perform public.patrol_bootstrap();
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'RLS FAIL: anon can call bootstrap'; end if;
end $$;
reset role;

-- ===================================================================== disabled member loses everything
update public.patrol_members set status = 'disabled' where id = '20000000-0000-4000-8000-0000000000a2';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
do $$ declare ok boolean; begin
  if (select count(*) from public.patrol_sites) + (select count(*) from public.patrol_categories)
     + (select count(*) from public.patrol_incidents) + (select count(*) from public.patrol_orgs) <> 0 then
    raise exception 'RLS FAIL: disabled member still has access'; end if;
  ok := false; begin
    insert into public.patrol_dar_entries (org_id, site_id, member_id, dar_id, occurred_at, body)
    values ('10000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000a2','62000000-0000-4000-8000-0000000000a1',now(),'x');
  exception when insufficient_privilege or foreign_key_violation then ok := true; end;
  if not ok then raise exception 'RLS FAIL: disabled member wrote data'; end if;
end $$;
reset role;

do $$ begin raise notice 'RLS TESTS PASSED'; end $$;
select 'RLS TESTS PASSED' as result;
rollback;

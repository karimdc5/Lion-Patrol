-- Lion Patrol v2 — function privilege hardening (security advisor follow-up).
-- * anon may execute nothing patrol_* except patrol_get_shared_report (public share links).
-- * authenticated keeps EXECUTE only on the helpers RLS policies / invoker triggers / invoker
--   bootstrap call, and on the RPCs the app calls. Trigger and internal functions are revoked
--   (triggers still fire: EXECUTE is not checked when a trigger runs).
-- Re-runnable.
begin;

do $$
declare
  f record;
  keep_auth text[] := array[
    -- helpers referenced by RLS policies, storage policies, invoker triggers and patrol_bootstrap
    'patrol_orgs_with_role','patrol_member_orgs','patrol_staff_orgs','patrol_admin_orgs',
    'patrol_worker_orgs','patrol_my_member_ids','patrol_my_sites','patrol_workable_sites',
    'patrol_client_sites','patrol_member_id_in','patrol_is_app_admin','patrol_public_settings',
    -- RPCs called by the app
    'patrol_bootstrap','patrol_create_org','patrol_create_invite','patrol_redeem_invite',
    'patrol_reorder_categories','patrol_reorder_subtypes','patrol_set_incident_status',
    'patrol_set_incident_client_visible','patrol_add_incident_note','patrol_set_dar_status',
    'patrol_alert_set_status','patrol_mark_notified','patrol_create_share_link',
    'patrol_storage_usage','patrol_get_shared_report'];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'patrol\_%'
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon', f.sig);
    if f.proname = any(keep_auth) then
      execute format('grant execute on function %s to authenticated', f.sig);
    else
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
  end loop;
  grant execute on function public.patrol_get_shared_report(text) to anon;
end $$;

commit;

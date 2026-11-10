-- Lion Patrol v2 — pass 9, chunk 3 (Section B). Re-runnable; patrol_* objects only.
--  * B11: owner incident/SOS email alerts are ON by default for NEW organizations.
--         Existing organizations keep whatever the owner chose (no row is changed here).
--         Note: these alerts are sent from the guard's phone via EmailJS (not a server); client email
--         is server-side only (patrol-client-logs edge function, see docs/PASS9-backend-setup.md).
begin;

alter table public.patrol_org_settings alter column email_enabled set default true;

commit;

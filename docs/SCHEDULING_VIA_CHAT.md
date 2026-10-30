# Scheduling shifts by chat (item 16)

Karim tells his assistant (Grok Bot, which already has the Supabase connector for project
`djkinciawtoqlxkpiesq`) something like *"Put Marcus at Kent Station Market Friday 9 PM to 5 AM"*.
The assistant turns that into one SQL call. Shifts land in `patrol_shifts` and show up in the app
right away (Schedule, guard Home "Upcoming shifts", no-show alerts).

No new connector, no service-role key in the app. The helper is
`public.patrol_add_shift_by_names` (migration `20261029000100_patrol_pass7.sql`).

## The call

```sql
select public.patrol_add_shift_by_names(
  p_org       => '<org uuid>',                       -- Lion Security Services org id
  p_site      => 'Kent Station Market',              -- site name, part of the name, or site code (KSM)
  p_guard     => 'Marcus Reed',                      -- display name, first name, or email; 'open' = unassigned
  p_starts_at => '2026-10-30 21:00 America/Los_Angeles',
  p_ends_at   => '2026-10-31 05:00 America/Los_Angeles',
  p_notes     => 'Cover for Tasha'                   -- optional
);
```

Returns `{"shift_id": …, "site_id": …, "member_id": …, "starts_at": …, "ends_at": …}`.

Rules the function enforces:
- The site and the guard must each match exactly one active row in the org, otherwise it raises
  `site_not_unique` / `guard_not_unique` with the number of matches (the assistant should ask Karim
  which one he meant).
- `p_ends_at` must be after `p_starts_at` (overnight shifts end the next day).
- Called from the app with a user JWT it only works for owners/admins/supervisors of that org.
  From the connector's SQL session (no JWT) it is allowed.
- Clients are never matched as guards.

## Assistant instructions (paste into Grok Bot)

> When Karim asks to schedule, move or cancel Lion Patrol shifts:
> 1. Times are Pacific (America/Los_Angeles). A shift that ends at or before its start time ends the next day.
> 2. Schedule: `select public.patrol_add_shift_by_names('<org uuid>', '<site>', '<guard or open>', '<start>', '<end>', '<notes or null>');`
>    For a repeating schedule, make one call per shift.
> 3. List upcoming: `select s.starts_at at time zone 'America/Los_Angeles' as starts, s.ends_at at time zone 'America/Los_Angeles' as ends, si.name site, m.display_name guard, s.notes from patrol_shifts s join patrol_sites si on si.id = s.site_id left join patrol_members m on m.id = s.member_id where s.org_id = '<org uuid>' and s.cancelled_at is null and s.ends_at > now() order by s.starts_at;`
> 4. Cancel (never delete): `update patrol_shifts set cancelled_at = now() where id = '<shift id>';`
> 5. Reassign: `update patrol_shifts set member_id = (select id from patrol_members where org_id = '<org uuid>' and display_name = '<name>') where id = '<shift id>';`
> 6. Only touch `patrol_*` tables. Read back the result and confirm it to Karim in one line.

Owner-only no-show alerts fire if a scheduled guard hasn't clocked in 10 minutes after the start.

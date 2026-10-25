# Karim feedback — Oct 25, 2026 12:30 AM PT (items 1–5 done Oct 25, 2026; item 6 waiting on Karim)
Patrol start/end is wrongly built as an incident report.
1. [DONE] Patrol start/end should NOT create incidents. Remove "Patrol & Shift" from incident categories; Incidents tab shows only real incidents (theft, trespass, medical, etc.).
2. [DONE] "Start patrol" = one tap on Home/Patrol tab (like Clock in): logs a timestamp + GPS to the activity log/DAR, starts the checkpoint round, button flips to "End patrol". No form.
3. [DONE] Choosing a subtype should open only that subtype — no sibling chips (patrol end, checkpoint note, shift notes...) on the form.
4. [DONE] Per-category fields: people/vehicle/police-called only on categories where they fit (suspicious, trespass, theft, vandalism, disturbance, police/fire/EMS). Not on routine entries.
5. [DONE] Shift notes / relief-handoff / post check go to Log entry (DAR), not incidents.
6. [DONE Oct 25] Karim OKed; deleted the 3 test "Patrol start" incidents (LSS-TS-2026-00002/4/6) and their 2 attachment rows. 4 orphaned photo files remain in private patrol-media (SQL delete blocked; remove via Storage dashboard if wanted). Migrations 20261025000100 + 20261025000200 applied live.

Notes: migration `supabase/migrations/20261025000100_patrol_feedback.sql` (patrol_ tables only, re-runnable, deletes no incidents). It hides or removes the "Patrol & Shift" category and adds the "Shift Log" daily-log category. Which fields each category shows is set by `fields` in `src/domain/categories.seed.json`.

## Later (after Claude usage resets)
7. Client portal redesign: make it look client-facing (lighter, simpler summary view: site status, recent reports, pinned BOLOs, download PDFs), not a copy of the guard/admin app.

## Follow-up (Oct 25, 2026)
7. [DONE] Field audit: every category has a `field_config` (standard sections + category-specific fields stored in `patrol_incidents.extra`). Live orgs are backfilled by `20261025000100_patrol_feedback.sql`.
8. [DONE] BOLOs pinned per site: guard Home, Post orders, admin Sites → BOLOs tab (resolve/archive), and the client portal (text only). Migration: `20261025000200_patrol_bolos.sql`.

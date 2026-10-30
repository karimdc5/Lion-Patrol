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
8. Offline cache doesn't drop rows deleted on the server (Activity still showed deleted test incidents). Reconcile local IDB with server on sync.
9. Activity feed showed author/role as "Client client" for Karim's incidents at Trailside — check name/role label.
10. REVERSE item 2 per Karim (Oct 25 1:06 AM): put "Patrol start" back as the FIRST option in the + / New entry list, working like before (opens a short entry form) but clean: only title/notes, time, GPS, photos. No people/vehicle/police fields, no sibling subtype chips. It must save as a Log (DAR) entry, not an incident. Home one-tap button can stay or go; Karim finds it useless.
11. Remove the per-category "notify client"/"client can see" toggle from the guard's new-entry form. (Owners can still decide client visibility in admin incident review.)
12. On clock-out, auto-build ONE end-of-shift PDF for that guard's shift: clock in/out times + GPS, every patrol start/end, checkpoint scans, log entries, incidents (with photos), BOLOs posted. Branded, share-sheet delivery, saved to the shift so owners can open it later in admin.
13. Name bug root cause (per Karim): he used client mode, redeemed a client share/portal code and signed up as "Client client"; that name bled into his real owner account (shows "Hi, Client"). Fix: client sign-up must never overwrite an existing member's name/role; keep identities separate. Fix Karim's display name in DB.
14. Profile: let every user change their display name, and pick a fun avatar icon (toy-like, playful, original set; not a copy of Grok Bot's).
    -> Avatars: DO NOT deploy. Build the avatar set only, show Karim previews first, ship only after his OK.
15. Replace Homebase: NO break tracking (Karim declined). guard-confirmed timesheet at clock-out, weekly hours/OT view, and a Gusto-compatible hours CSV export. Keep time records 3+ years.
16. Scheduling via Grok Bot: Karim tells the assistant shifts in chat; assistant inserts into patrol_shifts via Supabase connector (no new connector needed).
17. PDFs: switch to dark theme matching the app (dark only, no white print version — Karim's call).

## 18. Owner-only alerts (OWNERS ONLY — never visible to clients, never in portal/client PDFs)
- Missed checkpoint: if a patrol round isn't completed on time, notify owners (email/text).
- No-show: if a scheduled guard hasn't clocked in 10 min after shift start (patrol_shifts), notify owners.
- Geofence clock-in: guard can only clock in when GPS is at the site (site radius).

## 19. Site photos
- Owners can upload/replace a photo for each site (patrol-media bucket). Show it on the site card in the Sites list and as a header image on each site's detail view. No full redesign; fit the existing dark UI.

## 20. Interactive owner map (OWNERS ONLY)
- Map in admin (Leaflet + OpenStreetMap, free, no API key) with a pin per site (site photo from item 19 in the popup).
- On-duty guards shown at their latest GPS point (clock-in / scan / log entry) ONLY while clocked in; never track off-shift. Not visible to clients.
- Guard markers use their avatar from item 14 once Karim approves the avatar set; until then a plain default icon. Do not deploy avatars before approval.

## 21. iMessage/link preview tags — DONE (5e86269)
- Add Open Graph + Twitter tags to index.html (og:title, og:description, og:url, og:image 1200x630 dark Lion Patrol share image hosted on the Pages site, og:image:width/height, twitter:card summary_large_image), like lionofseattle.com has. Old iOS iMessage shows a blank bubble without them.

## 22. People list missing signed-up members + last seen
- Elmi (Abdinasir) signed up but doesn't appear in More > People (only "Client client" owner shows). Find why: did his sign-up create a patrol_members row for the org (invite/join flow), RLS hiding other members, or offline cache not syncing the members list. Fix so every org member shows for owners, synced from server.
- Add "Last seen" per person: green pulsing dot when they have location on/active recently (e.g. last GPS ping within ~5 min while clocked in), otherwise grey dot + "Last seen 2h ago" from their latest GPS point (clock-in/scan/log). Owners only.
- ROOT CAUSE (checked 8:20 AM Oct 25): Elmi signed up fresh (lionofseattle@gmail.com) and onboarding created a NEW org 01a1739b-... with him as owner, instead of joining Karim's org 01a16ffd-.... Fix: a sign-up without an invite must not silently create a 2nd company; prompt "Join with invite code" vs "Create company", and owner invites should be the normal path.

## Pass 7 status log (Oct 29–30, 2026)
Migrations written, NOT applied (coordinator applies): `supabase/migrations/20261029000100_patrol_pass7.sql`, `supabase/migrations/20261029000200_patrol_shift_pdf.sql`. The app keeps working before they're applied (fallbacks noted below).

| Item | Status | Notes |
|---|---|---|
| 7 Client portal redesign | DONE | Built last, after everything else was green. Shared client-facing view for the /p/ link portal and the signed-in client app: light theme (client pages only; staff app and PDFs stay dark), site status card (status, last patrol, 7-day checkpoint %, reports shared), pinned BOLOs with photos, one "Recent reports" list (All / Incidents / Daily) with PDF downloads, patrol proof chart, call/email buttons. |
| 8 Offline cache reconcile | DONE | Every server refresh (bootstrap, guard history, dashboard, client) now removes cached rows inside the query window that the server no longer returns; rows of orgs no signed-in user belongs to are pruned on login/refresh/org change. Pending local edits are never dropped. |
| 9 "Client client" label | DONE (code) | DB fixed by coordinator. `patrol_redeem_invite` no longer touches an existing member's name/role/phone; client codes are refused for accounts that already work for a company (`use_separate_account`). |
| 10 "Patrol start" first in + list | DONE | Short Log form (title/notes, time, GPS, photos) → DAR entry in "Shift Log" + opens the checkpoint round. Never an incident. Home one-tap toggle kept. |
| 11 Remove "notify client" toggle | DONE | Client-visibility fields filtered from the guard form; migration strips `client_notified` from live `field_config`. Owners still set visibility in admin review. |
| 12 End-of-shift PDF | DONE | Built on clock-out (clock in/out + GPS, patrol starts/ends, scans, log entries, incidents with photos + category details, BOLOs), share sheet, saved to the shift (attachment parent `shift`, needs migration 000200; skipped automatically until applied). Owners: Daily reports → "Shift PDF". |
| 13 Client sign-up never overwrites a member | DONE | Same as 9; RLS test covers it. |
| 14 Display name + avatars | PARTIAL (by design) | Display name editing shipped (More → Edit). Avatars: 12-piece original toy set, PREVIEWS ONLY in `/workspace/lion-patrol-shots/avatars/` (sheet + PNG/SVG each); source in `design/avatars/` (outside `src/`, not in the bundle). Waiting for Karim's OK. |
| 15 Timesheets | DONE | Guard confirms hours at clock-out (or flags them with a note); admin More → Timesheets: weekly hours per guard, Mon–Sun, OT over 40 h (WA), shift details, Gusto hours CSV (1 or 2 weeks). No break tracking. Time records never auto-deleted; a site with time records < 3 years old can't be deleted (deactivate instead). |
| 16 Scheduling via chat | DONE | `patrol_add_shift_by_names(org, site, guard, start, end, notes)` + `docs/SCHEDULING_VIA_CHAT.md` (instructions to paste into Grok Bot). |
| 17 Dark PDFs | DONE | Incident, DAR, end-of-shift, client-portal and QR sheets are dark (QR codes stay black-on-white inside their frame so they scan). |
| 18 Owner-only alerts | DONE | `patrol_owner_alerts` (RLS: owners/admins only, no insert policy). Missed checkpoints, overdue rounds, no-show 10 min after shift start, geofence blocks. Detector runs from on-duty guard phones and owner dashboards (returns only a count); owners get a detail-free email ("N new owner alerts") via the owners-only EmailJS path. Geofenced clock-in for guards (app + server trigger). |
| 19 Site photos | DONE | Upload/replace in Sites → site → Details; thumbnail on the site card, header image on the site view. Uses existing `site` attachments (no migration). |
| 20 Owner map | DONE | Live → Map (owners/admins only): OSM tiles (CSP updated), site pins with photo popup, on-duty guards at latest GPS point only while clocked in, plain markers (no avatars). |
| 21 Link preview tags | DONE (5e86269) | |
| 22 People + sign-up choice | DONE | Sign-up never auto-creates a company: "Join with invite code" vs "Create company". People shows all members (refreshed from the server on open) with last seen: pulsing green dot = on duty + GPS ≤ 5 min, else grey + "Last seen Xh ago" / "Never". |
| Earlier gaps | DONE | Per-category fields in admin incident detail, client app, portal and PDFs; client-visible BOLO photos on the portal + client app (storage policy limited to active client-visible BOLO photos at sites with a live portal link); auto "Patrol ended" log when every checkpoint is scanned. |

Verification (Oct 29, 2026 ~22:50 PT): typecheck ✓, 70 unit tests ✓, SQL/RLS suite (PGlite, both migration passes) ✓, build + bundle budget ✓ (104.5 KB gzip initial), Playwright 115/115 ✓ (WebKit iPhone 13 + Chromium Pixel 7).
Screenshots: `/workspace/lion-patrol-shots/pass7/` (signup-choice, people-last-seen, site-photo-card, site-detail-photo, map, timesheets-weekly, pdf-dark + dar-dark.pdf, client-portal / client-portal-full). Avatar previews: `/workspace/lion-patrol-shots/avatars/`.

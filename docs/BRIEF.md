# Lion Patrol v2 — Product & Engineering Brief

You are building the flagship guard-tour and security reporting app for **Lion Security
Services**, an unarmed security company in South King County, WA (owners Karim — IT — and
Abdinasir Elmi; both are licensed guards working posts until they hire). Insurance covers
after-hours retail stores and private apartments only, so seed data and copy should fit those.

## The bar
It must feel like an official, highly engineered, popular security reporting product on the
level of TrackTik, Silvertrac, Trackforce or Guardso. Not slow, not buggy, not clunky. Every
screen polished, dark-mode first, instant, and reliable on an iPhone home-screen PWA. The owner
tests everything on his iPhone. Treat iPhone Safari/WebKit as the primary platform.

## Brand
Only name used: "Lion Security Services" (app name "Lion Patrol" may appear as the product
name under it). Gold lion on black/navy. Reuse `logo.png` from the repo root as the source mark
(make crisp PNG icons in all sizes plus an SVG/vector-like version if feasible). Dark mode first,
large tap targets for night shifts, clean typography. Follow `docs/design-refs/DESIGN_BRIEF.md`.

## Platform & stack (improve with reasons if you must)
- Vite + TypeScript + Preact (preferred for bundle size; React-compatible) or Svelte.
- Installable PWA with service worker (vite-plugin-pwa / Workbox), precache app shell.
- Architected so Capacitor can wrap it later into iOS/Android with no rewrite (abstract
  camera, geolocation, share, haptics, storage behind small platform adapters).
- Deploy: GitHub Pages via GitHub Actions (repo `karimdc5/Lion-Patrol`, served at
  `/Lion-Patrol/` base path). The workflow must build on push to `main` AND to
  `feature/lion-patrol-v2` (the preview deploy). Keep the old single-file app available
  by copying the existing `index.html`, `admin.html`, `checkpoint-qr.html` into
  `public/legacy/` (don't delete history).
- Fast: small bundle (route-level code splitting; heavy libs like PDF, QR scanner, map,
  image compression lazy-loaded), instant screen changes, skeleton loaders, no layout jank.

## Backend
- Existing Supabase project `djkinciawtoqlxkpiesq` (URL https://djkinciawtoqlxkpiesq.supabase.co).
  Publishable key may be committed in a config file (it is public by design):
  `sb_publishable_29IrAUCUNA1zdT3qny3c9A_0wV339Ns`. Never commit or print any service-role key.
- You do NOT apply SQL. Write SQL migration files in `supabase/migrations/` (numbered,
  idempotent where possible, wrapped in begin/commit). The coordinator applies them.
- Only NEW tables, all prefixed `patrol_`. Never alter/drop existing tables, policies, data.
  Existing tables in public: signed_agreements, share_links, agreement_counters,
  app_admins (user_id uuid pk → auth.users, email, added_at), app_settings,
  onboarding_submissions, proposals. Existing function `public.is_admin()` = exists in
  app_admins for auth.uid(). Follow that owner-list pattern: security-definer helper
  functions with `set search_path = public`, revoke from public, grant to authenticated.
- Multi-company ready: `org_id` on every patrol_ table; strict RLS per org AND role.
  Roles: owner/admin, supervisor, guard, client (read-only, only their own site(s)).
  Records visible only to the org's owners/admins/supervisors and that site's client(s).
  Guards see their own org's sites they are assigned to, and their own records (and post
  orders/checkpoints for assigned sites). Bootstrap: owners in `public.app_admins` can
  create the first org and become its owner (an RPC). Invites: owner creates an invite
  code (role + optional site); the invitee signs up / signs in and redeems it via RPC.
- Private storage bucket `patrol-media` (create via SQL: insert into storage.buckets,
  public=false, file_size_limit ~ 50MB, sensible allowed mime types) with storage.objects
  policies matching the row RLS; object path `org_id/…`. Free tier = 1GB storage total, so
  compress aggressively.
- Include `supabase/tests/rls_test.sql`: a script that runs inside a single transaction,
  creates throwaway auth users/orgs, impersonates them with
  `set local role authenticated; set local request.jwt.claims = '{"sub":"…","role":"authenticated"}'`,
  asserts isolation (guard can't see other org; client sees only their site; guard can't
  read another guard's draft, etc.) with `raise exception` on failure, and ends in ROLLBACK.
  It must leave zero data behind.
- Email notification of new incidents and SOS: use EmailJS browser SDK with the existing
  account: service `service_49ltt4f`, public key `hF1r9AflJq5A0MSR6`, template
  `template_n369iwa` (admin template; pass to_email, subject, message, plus anything else
  — check the legacy index.html/admin.html for how it's called). Recipients = the org's
  owner emails only (configurable in org settings). Never email clients in this build;
  put a hard guard in code: client notification sending is disabled behind a flag that
  defaults off.

## Legal requirements (must be enforced in UX and code)
- GPS only while the guard is clocked in, with an on-screen notice they must accept
  (store acceptance with timestamp). Stop watchPosition on clock-out. No background
  tracking otherwise.
- Audio: Washington requires all-party consent to record conversations. NO automatic,
  background or covert recording. Allow only the guard's own voice notes (dictation about
  the event, short, explicit tap-to-record with visible indicator) and uploads of existing
  audio files. Show a one-time notice: conversations may not be recorded without everyone's
  consent.
- Records visible only to owners and that site's client.

## Reliability on iPhone home-screen PWAs (top worry)
- Stay logged in: persistent Supabase session, auto refresh, session stored durably
  (localStorage + IndexedDB mirror), call navigator.storage.persist(). Recover the session
  on cold start offline (show cached data, don't kick to login).
- Shared device quick re-entry: remembered device + 4–6 digit PIN unlock (PIN hashed with
  PBKDF2/WebCrypto locally; lockout after attempts). Multiple remembered guards per device.
- Never lose work: every draft, scan, report and attachment saved to IndexedDB
  immediately (Dexie or idb). Outbox queue with retries + exponential backoff, idempotent
  client-generated UUIDs, media uploads chunked/resumable (Supabase supports TUS resumable
  uploads at /storage/v1/upload/resumable — use tus-js-client or fall back to standard
  upload with retry for small files). Clear sync status pill (Synced / N pending /
  Offline / Error-tap-to-retry). Survive app kill, refresh, offline mid-shift.
- iOS quirks: home-screen storage is separate from Safari (explain in the A2HS guide);
  camera via `<input type=file accept="image/*" capture="environment">` and getUserMedia for
  QR; microphone permission; geolocation prompts; background suspension (resume sync on
  visibilitychange/online/focus; no reliance on Background Sync API); safe areas/notch;
  100dvh; no 300ms zoom (font-size >= 16px inputs); disable pull-to-refresh bounce where
  harmful; apple-touch-icon, apple-mobile-web-app-capable, status-bar black-translucent,
  splash screens (apple-touch-startup-image for common iPhone sizes).
- Real app icon, splash screen, manifest, and an "Add to Home Screen" guide screen for
  iPhone (shown when running in Safari not standalone).

## Attachments
Every report, DAR log entry, incident and checkpoint scan can carry multiple attachments:
photos (camera or library), video, the guard's voice notes and audio files, documents/PDFs.
Compress images client-side (max ~1600px long edge, JPEG/WebP ~0.75, strip EXIF except keep
orientation fixed), limit video (e.g. max 60s / 50MB, warn, use capture with low quality where
possible). Show thumbnails and players (image lightbox, <video>, <audio>, PDF icon/open) in
the app and the dashboard. Include photos (plus links to other media via signed URLs) in PDFs.
Store in private `patrol-media`; display via short-lived signed URLs; cache thumbs locally.

## Report categories
Admins can add, edit, reorder (drag), hide and color/icon categories from a settings screen,
with subtypes and optional per-category required fields (e.g. people details, vehicle details,
police called, injury, property damage estimate). Seed a smart default set of ~20–30
well-named categories with subtypes covering almost anything a guard could report, e.g.:
Patrol & Shift (patrol start/end, checkpoint, shift notes, relief/handoff); Access & Doors
(gate/door open or unsecured, lock-up, alarm); Suspicious Activity (person, vehicle,
loitering); Trespass & Removal; Theft & Shoplifting; Vandalism, Graffiti & Damage;
Disturbance & Noise; Medical & Injury; Fire, Safety & Hazard (spill, smoke, hazard);
Maintenance & Facility (lights out, leaks); Parking & Vehicles (towing, violations);
Police, Fire & EMS Contact; Client/Resident Request; Lost & Found; Weather; Other — plus
a few more sensible ones for retail/apartments (e.g. Alarm Response, Package/Delivery,
Homeless/Encampment Welfare Check worded respectfully, Drug Activity/Paraphernalia, Animal).
Seeding: per org, via an RPC or on org creation. Guards pick category then subtype fast:
big tiles, search, recent/favorites first.

## Features (priority order, all polished)
1. Roles & orgs: owner/admin, supervisor, guard, client.
2. Admin: sites (address, map pin, post orders rich text, contacts); checkpoints with
   printable QR sheets (PDF, generated in code); guards (invite + PIN); schedules/shifts
   (simple week view + list; assign guard/site/time); report category management.
3. Guard app: clock in/out with GPS stamp + notice; patrol tours scanning QR checkpoints
   (time + GPS, out-of-order and late detection); daily activity report (DAR) log with quick
   entries; incident reports (category/subtype, attachments, description w/ dictation via
   Web Speech API where available, people & vehicles involved, police called y/n + case #);
   big panic/urgent-alert button (press-and-hold) that notifies owners (EmailJS + row in
   patrol_alerts + realtime on dashboards; queues offline with tel:911 fallback); post orders
   viewable at the post (cached offline). All of it works fully offline.
4. Supervisor/owner dashboard: live view of who's on shift where (Leaflet map, free dark
   tiles, last GPS ping); patrol completion per site with missed/late checkpoint flags;
   a feed of every guard's activity filterable by site, guard, category, date; incident
   review (status: new/reviewed/sent to client, notes).
5. Reports: branded professional PDF incident reports and DARs shareable with the client;
   a client portal (client role login sees their site's reports only; plus optional
   expiring share link via RPC that returns one report); email notification of new
   incidents via EmailJS to owners only.
   PDFs generated in code (pdf-lib or jsPDF with vector text, crisp logo embedded at high
   res, tight letterhead, generous spacing, page numbers, footer). Deliver via
   `navigator.share({files:[pdf]})` (iOS share sheet), fallback to download link.
   NEVER use window.print() (it produced blank pages on iPhone before).

## Testing (iPhone first)
- Playwright with **WebKit** + iPhone 13 device profile (390x844, touch, iOS UA) as the main
  project; Chromium (Pixel/mobile) second. WebKit build 2370 is cached in
  ~/.cache/ms-playwright — pin a @playwright/test version that uses it if practical, otherwise
  `npx playwright install webkit chromium` (host deps for WebKit are present; it launches).
- Tests must not need the real Supabase: build a data-access layer with a swappable backend
  and use a mock/in-memory backend (or Playwright route interception) for e2e.
- Cover: offline mode then later sync (including media); killing/reloading mid-report without
  losing data or attachments; staying logged in after reload; admin category add/edit/
  reorder/hide; clock-in GPS notice; QR scan flow (manual code entry path); PDF generation
  produces non-empty multi-element PDFs; unit tests (Vitest) for outbox, compression, PIN,
  RLS-independent logic.
- Provide `npm run test:e2e`, `npm test`, `npm run build`, and a script
  `scripts/screens.mjs` (or a Playwright spec) that saves dark-mode iPhone screenshots of every
  main screen into `artifacts/screens/` and sample PDFs into `artifacts/pdfs/` (artifacts/
  gitignored), using demo data.
- A demo mode (`?demo=1` or a "Try demo" button on login) with realistic seed data for a retail
  store and an apartment complex in South King County, so the app can be shown without login.

## Git
Work on branch `feature/lion-patrol-v2` (already checked out). Commit in logical chunks with
clear messages and `git push -u origin feature/lion-patrol-v2` after each pass. Never merge
to main, never force-push main. Don't open the PR (coordinator does).

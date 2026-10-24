# Lion Patrol v2 — Architecture

Status: **Pass 1 (architecture)**. This file is the contract for later passes. Where the brief
left a choice open, a decision is made here and marked **Decision**. If a later pass needs to
deviate, it updates this file in the same commit.

Sources: `docs/BRIEF.md`, `docs/design-refs/DESIGN_BRIEF.md`, and the legacy `index.html` /
`admin.html` / `checkpoint-qr.html`.

### What we learned from the legacy app (and what changes)

| Legacy (single file) | v2 |
|---|---|
| Different Supabase project (`raedwcoz…`), tables `officers`, `sites`, `patrols`, `checkpoint_scans`, `incidents`, `location_pings`… | Project `djkinciawtoqlxkpiesq`, **new `patrol_*` tables only**. The legacy tables are not touched. |
| Officers log in by picking a name + 4-digit PIN that is **sent to the server with every write** (`p_pin`), so a guard has no real auth identity | Real Supabase Auth users. The PIN only unlocks a session stored on the device. It never leaves the device. |
| EmailJS SDK from a CDN, `emailjs.send(service, template, {to_email, officer_name, …, summary: html})` to a hardcoded address | EmailJS **REST endpoint via `fetch`** (no SDK bytes). Service `service_49ltt4f`, template `template_n369iwa`, public key `hF1r9AflJq5A0MSR6`, params `to_email, subject, message, …`. Recipients come from the org's owner list only. |
| Signed URLs valid for 10 years baked into emails | Short-lived signed URLs (1 h in-app). Share links use URLs signed with the link's TTL (≤ 7 days). |
| `window.print()` for reports | pdf-lib vector PDFs → `navigator.share({files})`. `print()` is banned (an ESLint rule enforces it). |
| QR payload = raw 24-hex token | QR payload = URL `https://karimdc5.github.io/Lion-Patrol/q/<CODE>` with an 8-char human code printed under it. |
| `?demo=1` in-memory fake client | Kept as a concept. It becomes the `MemoryBackend`, which also powers the e2e tests. |

---

## 1. Stack

| Concern | Choice (pin exact in `package-lock.json`) | Why |
|---|---|---|
| Build | **Vite 8.3.x** | Fast, first-class code splitting, `base: '/Lion-Patrol/'`. |
| Language | **TypeScript 5.9.x** (`strict`, `noUncheckedIndexedAccess`) | TS 7 (native) is out, but 5.9 is the stable typecheck target for the Vite/Preact plugin ecosystem. Re-evaluate later. Vite strips types itself, so TS is only used for `tsc --noEmit`. |
| UI | **Preact 10.29.x** + `@preact/preset-vite` 2.10.x | About 4.5 KB gz and React-compatible. Preact 11 is newly released. We stay on 10.29 (every dependency below is tested against it) and upgrade in a later pass. |
| Routing | **In-house router** (`src/router.ts`, ~60 lines, signals) + `lazyScreen()` helper | Pass 2 change: base-path (`/Lion-Patrol/`) aware with no compat layer or Suspense. preact-iso was dropped. |
| State | **@preact/signals 2.x** | Fine-grained reactive stores without context churn. Sync status, session, and the current shift are global signals. |
| Local DB | **idb 8.0.x** (about 1.3 KB gz) | Dexie (about 26 KB gz) would eat a fifth of the budget. Our schema is small and hand-written repositories over `idb` are enough. |
| Backend client | **`@supabase/auth-js`, `@supabase/postgrest-js`, `@supabase/storage-js` 2.118.x** composed directly. `@supabase/realtime-js` 2.118.x is **lazy**, dashboard only. | `@supabase/supabase-js` always bundles realtime and functions. Composing the parts saves about 15 KB gz from the guard's initial load. Same versions as supabase-js 2.118 for compatibility. |
| PWA | **vite-plugin-pwa 2.0.x** (Workbox 7.4, `injectManifest` strategy) + `@vite-pwa/assets-generator` for icons/splash | A custom SW gives us exact control: no API caching, a prompt-to-update flow. |
| QR scan (lazy) | **qr-scanner 1.4.x** (Nimiq) | Decodes in a Web Worker and uses `BarcodeDetector` when present (iOS Safari lacks it, so the worker runs). About 16 KB gz including the worker. |
| QR generate (lazy) | **uqr 0.1.x** | Returns a module matrix. We draw it as vector rectangles straight into the PDF (crisp at any print size), and as SVG on screen. |
| PDF (lazy) | **pdf-lib 1.17.x** (standard Helvetica fonts, no fontkit) | Vector text, embeds JPEG/PNG without re-encoding, draws vector QR. Standard fonts cost zero bytes (see §7). |
| Map (lazy) | **leaflet 1.9.4** + Carto `dark_all` raster tiles | Free, no key, small. Loaded only on the live-map route. |
| Resumable upload (lazy) | **tus-js-client 4.3.x** | Supabase TUS endpoint `/storage/v1/upload/resumable`. Loaded only when a file is ≥ 6 MB. |
| Image compression | **In-house** (`createImageBitmap` + canvas), about 2 KB | No library needed. See §4.4. |
| Email | **EmailJS REST** (`POST https://api.emailjs.com/api/v1.0/email/send`) | Same account as the brief. Zero bundle cost. |
| Styling | Plain CSS with custom properties (design tokens) in `styles/tokens.css` + one global `styles/base.css` with component class prefixes | No runtime, no Tailwind build step. Tokens map 1:1 to the design brief. (Pass 2 change: global CSS instead of CSS Modules; the whole sheet is ~4.6 KB gz.) |
| Icons | Hand-picked inline SVG set (Lucide-derived, ISC) as a TS map, about 60 icons | Category icons are needed offline and in PDFs. |
| Unit tests | **Vitest 4.1.x** + **fake-indexeddb 6.2.x** + jsdom | Pass 2 change: Vitest 5 requires Node ≥ 22, and CI is pinned to Node 20. |
| E2E | **@playwright/test 1.64.1** (its WebKit revision **2370** is already in `~/.cache/ms-playwright`). Chromium is installed with `npx playwright install chromium`. | Verified from `playwright-core@1.64.1/browsers.json`. |
| Lint | ESLint 9 flat config + `eslint-plugin-preact`-compatible rules. A custom `no-restricted-properties` rule bans `window.print`. | |

### 1.1 Bundle budget

**Initial JS < 120 KB gzip** for any entry route. CI enforces this with
`scripts/check-bundle.mjs`, which gzips the entry chunk plus its static imports from
`dist/.vite/manifest.json` and fails over budget.

Estimated initial load for the guard Home route:

| Piece | ≈ KB gz |
|---|---|
| preact + hooks + router + signals | 10 |
| auth-js + postgrest-js + storage-js | 30 |
| idb + outbox + sync + repositories | 10 |
| shell, tokens, icons, home screen | 30 |
| **Total** | **≈ 82** (38 KB headroom) |

Lazy chunks (`import()`):
- `pdf` (pdf-lib + our layouts)
- `qr-scan` (qr-scanner + worker)
- `qr-gen` (uqr)
- `map` (leaflet + css)
- `media` (tus-js-client, video/audio helpers)
- `realtime` (realtime-js)
- `admin` (all `/a/*` routes)
- `client` (all `/c/*` routes)
- `editor` (post-orders rich text editor)

Each route is its own `lazy()` chunk. Guard core routes (Home, Clock, Patrol, Report, Activity)
are **prefetched on idle** after first paint, so changing screens feels instant.

---

## 2. Folder structure

```
/
├─ ARCHITECTURE.md
├─ index.html                      # Vite entry (v2). Legacy copies live in public/legacy/
├─ vite.config.ts                  # base '/Lion-Patrol/' (env VITE_BASE overrides for Capacitor '/')
├─ tsconfig.json
├─ playwright.config.ts
├─ vitest.config.ts
├─ public/
│  ├─ legacy/                      # index.html, admin.html, checkpoint-qr.html copied verbatim
│  ├─ icons/                       # generated: 180/192/512/maskable, apple-touch-icon
│  ├─ splash/                      # apple-touch-startup-image per iPhone size
│  ├─ brand/logo-mark.svg          # traced vector mark (gold lion)
│  ├─ brand/logo-pdf.png           # 600px optimized PNG for PDFs (~40 KB)
│  └─ 404.html                     # = index.html copy (GitHub Pages SPA fallback; written by build script)
├─ src/
│  ├─ main.tsx                     # boot: storage.persist, session restore, SW register, render
│  ├─ app.tsx                      # LocationProvider + role router
│  ├─ config.ts                    # SUPABASE_URL, publishable key, EmailJS ids, feature flags
│  ├─ styles/                      # tokens.css, base.css, utilities.css
│  ├─ platform/                    # adapters (Capacitor-ready)
│  │  ├─ types.ts                  # Camera, Geo, Share, Haptics, KV, SecureKV, Net, Lifecycle, Scanner, Wake
│  │  ├─ web/                      # current implementations
│  │  └─ index.ts                  # picks web vs capacitor at runtime
│  ├─ data/
│  │  ├─ backend/
│  │  │  ├─ types.ts               # Backend interface (auth, query, mutate, rpc, storage, realtime)
│  │  │  ├─ supabase.ts            # SupabaseBackend
│  │  │  └─ memory.ts              # MemoryBackend (demo + tests, fault injection)
│  │  ├─ db.ts                     # IndexedDB schema + migrations (idb)
│  │  ├─ repos/                    # sites.ts, incidents.ts, dar.ts, scans.ts, categories.ts …
│  │  ├─ outbox/                   # queue.ts, worker.ts, classify.ts, backoff.ts
│  │  ├─ media/                    # compress.ts, thumbs.ts, upload.ts, tus-store.ts, cache.ts
│  │  ├─ sync/                     # bootstrap.ts, delta.ts, status.ts (signals)
│  │  └─ demo/seed.ts              # retail store + apartment complex in South King County
│  ├─ auth/                        # session.ts, storage-adapter.ts, vault.ts (PIN), invite.ts, roles.ts
│  ├─ domain/                      # pure logic, 100% unit tested
│  │  ├─ tour.ts                   # evaluateScan(): out-of-order / late / off-site
│  │  ├─ report-no.ts, geo.ts, time.ts, validation.ts, categories.ts, notify.ts
│  ├─ notify/emailjs.ts            # owner-only email, hard client guard
│  ├─ pdf/                         # (lazy) letterhead.ts, incident.ts, dar.ts, qr-sheet.ts, text.ts
│  ├─ ui/                          # design-system components
│  │  ├─ Button, Sheet, TabBar, Sidebar, ListGroup, Skeleton, SyncPill, Ring, HoldButton,
│  │  ├─ CategoryGrid, ChipRow, AttachmentTray, Lightbox, Toast, EmptyState, Timeline …
│  ├─ screens/
│  │  ├─ public/                   # Login, Join, Install (A2HS), SharedReport, QrLanding, Lock
│  │  ├─ guard/                    # Home, Clock, Patrol, Scan, Report, Activity, More, PostOrders, Sos, Sync
│  │  ├─ admin/                    # Dashboard(map), Feed, Incidents, Dars, Sites, Site, People,
│  │  │                            # Schedule, Settings, Categories, Alerts, OrgCreate
│  │  └─ client/                   # Overview, Report, Dar
│  └─ lib/                         # uuid v7, crypto helpers, format, debounce, html-sanitize
├─ supabase/
│  ├─ migrations/
│  │  ├─ 20261024000100_patrol_core.sql        # enums, tables, indexes, updated_at triggers
│  │  ├─ 20261024000200_patrol_helpers.sql     # security-definer helpers
│  │  ├─ 20261024000300_patrol_triggers.sql    # snapshots, column guards, report numbers, live status
│  │  ├─ 20261024000400_patrol_rls.sql         # enable RLS + policies
│  │  ├─ 20261024000500_patrol_seed.sql        # GENERATED default categories + seed function
│  │  ├─ 20261024000600_patrol_rpc.sql         # RPCs
│  │  ├─ 20261024000700_patrol_storage.sql     # bucket + storage.objects policies
│  │  └─ 20261024000800_patrol_realtime.sql    # publication
│  └─ tests/rls_test.sql
├─ tests/
│  ├─ unit/                        # *.test.ts (Vitest)
│  ├─ e2e/                         # *.spec.ts (Playwright)
│  ├─ fixtures/                    # sample.jpg (with EXIF orientation 6), sample.mp4, sample.m4a, sample.pdf
│  └─ helpers/                     # mock net control, IDB inspection
├─ scripts/
│  ├─ screens.mjs                  # dark iPhone screenshots → artifacts/screens/
│  ├─ pdfs.mjs                     # sample PDFs → artifacts/pdfs/
│  ├─ check-bundle.mjs
│  ├─ icons.mjs                    # logo.png → icons/splash via @vite-pwa/assets-generator + sharp
│  └─ postbuild.mjs                # 404.html, copy legacy/
└─ .github/workflows/pages.yml     # build+test on push to main and feature/lion-patrol-v2, deploy
```

---

## 3. Data model (Supabase / Postgres)

Rules:
- Only new objects, all prefixed `patrol_`. Existing tables, policies and functions are not
  altered. We **call** `public.is_admin()` (from `app_admins`) but never redefine it.
- Every table has `org_id uuid not null references patrol_orgs(id) on delete cascade`.
- Primary keys are client-generated **UUIDv7** (time-ordered, so B-tree friendly). Server
  defaults to `gen_random_uuid()` when they are omitted.
- Every mutable table has `created_at timestamptz not null default now()` and `updated_at`,
  maintained by the trigger `patrol_touch_updated_at()`. Delta sync relies on
  `(org_id, updated_at)` indexes.
- Records captured on a device also carry `client_created_at timestamptz` (device clock) and
  `device_id text`. `created_at` is the server receive time. A skew of more than 5 min is
  flagged in the UI.
- Migrations are wrapped in `begin; … commit;` and are idempotent: `create … if not exists`,
  `do $$ … $$` guards for enums and policies (`drop policy if exists` on **our own** policy
  names only), `create or replace function`.

### 3.1 Enums

```sql
patrol_role            : 'owner','admin','supervisor','guard','client'
patrol_membership_status : 'active','disabled'   -- (renamed in Pass 2: the table patrol_member_status owns that type name)
patrol_incident_status : 'draft','submitted','reviewed','sent_to_client','closed'
patrol_severity        : 'low','medium','high','critical'
patrol_dar_status      : 'open','submitted','reviewed','sent_to_client'
patrol_alert_status    : 'open','acknowledged','resolved','cancelled'
patrol_attach_parent   : 'incident','dar_entry','scan','alert','site'
patrol_attach_kind     : 'image','video','audio','voice_note','document'
patrol_scan_method     : 'qr','manual'
patrol_consent_kind    : 'gps_notice','audio_notice'
```

Role ranks used by helpers: owner 50, admin 40, supervisor 30, guard 20, client 10.
"Staff" means owner, admin or supervisor. "Admin" means owner or admin.

### 3.2 Tables

Shorthand: `pk` = `id uuid primary key default gen_random_uuid()`. `ts` = timestamptz.
`org` = `org_id uuid not null references patrol_orgs on delete cascade`.

**patrol_orgs**
| column | type | notes |
|---|---|---|
| id | pk | |
| name | text not null | "Lion Security Services" |
| legal_name | text | |
| timezone | text not null default 'America/Los_Angeles' | |
| phone, email, address, license_no | text | letterhead |
| created_by | uuid not null references auth.users | |
| created_at, updated_at | ts | |

**patrol_org_settings** (1:1, separated so guards and clients never read owner emails)
| column | type | notes |
|---|---|---|
| org_id | uuid pk references patrol_orgs on delete cascade | |
| notify_emails | text[] not null default '{}' | owners' emails; initialized to the creator's email |
| client_notifications_enabled | boolean not null default false | **also** hard-gated in code (§5.7) |
| auto_share_with_client | boolean not null default false | if true, submitted incidents become client-visible |
| report_prefix | text not null default 'LSS' | |
| next_report_no | integer not null default 1 | incremented by trigger (row lock) |
| gps_ping_interval_s | integer not null default 120 check (between 30 and 900) | |
| ping_retention_days | integer not null default 30 | |
| max_video_mb | integer not null default 50 check (<= 50) | |
| max_video_s | integer not null default 60 | |
| tour_interval_min | integer not null default 60 | default for new sites |
| tour_max_duration_min | integer not null default 30 | |
| updated_at | ts | |

**patrol_members**
| column | type | notes |
|---|---|---|
| id | pk | |
| org_id | org | |
| user_id | uuid not null references auth.users on delete cascade | |
| role | patrol_role not null | |
| status | patrol_member_status not null default 'active' | disabled ⇒ all helpers return nothing ⇒ zero access |
| display_name | text not null | |
| email, phone, badge_no, guard_card_no | text | |
| invited_by | uuid references patrol_members | |
| created_at, updated_at | ts | |
| | | `unique (org_id, user_id)` · idx `(user_id) where status='active'` |

**patrol_sites**
| column | type | notes |
|---|---|---|
| id | pk | |
| org_id | org | |
| name | text not null | |
| code | text | e.g. `KNT-01`, used in report numbers; `unique (org_id, code)` |
| kind | text not null default 'retail' check in ('retail','apartment','other') | insurance scope |
| address, city, state default 'WA', zip | text | |
| lat, lng | double precision | map pin |
| geofence_m | integer not null default 150 | off-site detection for clock-in/scans |
| timezone | text | null ⇒ org tz |
| post_orders_html | text not null default '' | sanitized allowlist HTML (§6.4) |
| post_orders_updated_at | ts | shown to the guard ("Updated Oct 3") |
| contacts | jsonb not null default '[]' | `[{name, role, phone, email, notes}]` |
| tour_interval_min | integer | null ⇒ org default |
| tour_max_duration_min | integer | null ⇒ org default |
| active | boolean not null default true | |
| created_at, updated_at | ts | idx `(org_id, active)` |

**patrol_site_access** (guard assignment and client site scope)
| column | type | notes |
|---|---|---|
| org_id | org | |
| site_id | uuid not null references patrol_sites on delete cascade | |
| member_id | uuid not null references patrol_members on delete cascade | |
| created_at | ts | |
| | | `primary key (site_id, member_id)` · idx `(member_id)` |

**patrol_checkpoints**
| column | type | notes |
|---|---|---|
| id | pk | |
| org_id, site_id | org / FK sites cascade | |
| name | text not null | |
| seq | integer not null | tour order |
| code | text not null unique | 8 chars Crockford base32 (40 bits), server default `patrol_gen_code(8)` |
| lat, lng | double precision | |
| radius_m | integer not null default 40 | |
| instructions | text | |
| active | boolean not null default true | |
| created_at, updated_at | ts | idx `(site_id, seq)` |

**patrol_shifts** (schedule)
| column | type | notes |
|---|---|---|
| id | pk | |
| org_id, site_id | | |
| member_id | uuid references patrol_members on delete set null | null = open shift |
| starts_at, ends_at | ts not null, check ends_at > starts_at | |
| notes | text | |
| cancelled_at | ts | |
| created_by | uuid references patrol_members | |
| created_at, updated_at | ts | idx `(org_id, starts_at)`, `(member_id, starts_at)` |

**patrol_time_entries** (clock in/out)
| column | type | notes |
|---|---|---|
| id | pk (client uuid) | |
| org_id, site_id, member_id | | |
| shift_id | uuid references patrol_shifts on delete set null | |
| clock_in_at | ts not null | |
| clock_in_lat, clock_in_lng, clock_in_accuracy_m | double precision | |
| clock_out_at | ts | |
| clock_out_lat, clock_out_lng, clock_out_accuracy_m | double precision | |
| shift_note | text | asked at clock-out |
| gps_notice_accepted_at | ts not null | legal: no clock-in without accepted notice |
| client_created_at, device_id | | |
| created_at, updated_at | ts | |
| | | `unique (member_id) where clock_out_at is null` (one open entry per member) · idx `(org_id, clock_in_at desc)` |

**patrol_location_pings** (on duty only, foreground only)
| column | type | notes |
|---|---|---|
| id | uuid pk (client) | |
| org_id, member_id | | |
| time_entry_id | uuid not null references patrol_time_entries on delete cascade | |
| lat, lng | double precision not null | |
| accuracy_m | real | |
| recorded_at | ts not null | |
| created_at | ts | idx `(time_entry_id, recorded_at)`, `(org_id, recorded_at)` |

Size: one ping every 120 s over a 12 h shift is 360 rows (≈ 40 KB). Retention runs
`patrol_prune_pings()`, which deletes rows older than `ping_retention_days`. It is scheduled with
pg_cron (`'17 3 * * *'`) if the extension is enabled. Otherwise it is called opportunistically
by the admin dashboard (at most once a day, tracked in `localStorage`).

**patrol_member_status** (one row per on-duty member, the realtime source for the live map)
| column | type | notes |
|---|---|---|
| member_id | uuid pk references patrol_members on delete cascade | |
| org_id | org | |
| on_duty | boolean not null | |
| time_entry_id, site_id | uuid | |
| lat, lng, accuracy_m | | last ping |
| last_ping_at, on_duty_since | ts | |
| updated_at | ts | |

It is written **only** by security-definer triggers on `patrol_time_entries` (insert or
clock-out) and `patrol_location_pings` (insert, only when newer). It is never written by clients.
Realtime subscribes to this small table rather than to pings, which keeps message volume low.

**patrol_tour_runs**
| column | type | notes |
|---|---|---|
| id | pk (client) | |
| org_id, site_id, member_id | | |
| time_entry_id | uuid references patrol_time_entries on delete set null | |
| started_at | ts not null | |
| completed_at | ts | |
| expected_count | integer not null | active checkpoints at start |
| scanned_count | integer not null default 0 | maintained by trigger on scans |
| late | boolean not null default false | |
| client_created_at, device_id, created_at, updated_at | | idx `(site_id, started_at desc)` |

**patrol_scans**
| column | type | notes |
|---|---|---|
| id | pk (client) | |
| org_id, site_id, member_id, checkpoint_id | FKs | |
| tour_run_id | uuid references patrol_tour_runs on delete set null | |
| time_entry_id | uuid references patrol_time_entries on delete set null | |
| scanned_at | ts not null | |
| lat, lng, accuracy_m, distance_m | | distance to checkpoint |
| method | patrol_scan_method not null | |
| flags | text[] not null default '{}' | subset of `out_of_order`, `late`, `off_site`, `duplicate`, `no_gps` |
| note | text | |
| client_created_at, device_id, created_at | | immutable (no updated_at) |
| | | idx `(site_id, scanned_at desc)`, `(tour_run_id)`, `(member_id, scanned_at desc)` |

**patrol_categories**
| column | type | notes |
|---|---|---|
| id | pk | |
| org_id | org | |
| name | text not null | `unique (org_id, lower(name))` |
| color | text not null | hex from the muted palette |
| icon | text not null | key into the icon map |
| sort | integer not null | |
| hidden | boolean not null default false | |
| required_fields | text[] not null default '{}' | subset of `people`,`vehicles`,`police`,`injury`,`property_damage`,`witnesses`,`photos` |
| default_severity | patrol_severity not null default 'low' | |
| use_for | text not null default 'both' check in ('incident','dar','both') | |
| created_at, updated_at | ts | idx `(org_id, sort)` |

**patrol_subtypes**
| column | type | notes |
|---|---|---|
| id | pk | |
| org_id | org | |
| category_id | uuid not null references patrol_categories on delete cascade | |
| name | text not null | `unique (category_id, lower(name))` |
| sort | integer not null | |
| hidden | boolean not null default false | |
| created_at, updated_at | ts | |

**patrol_incidents**
| column | type | notes |
|---|---|---|
| id | pk (client) | |
| org_id, site_id | | |
| member_id | uuid not null references patrol_members | author |
| author_name | text not null | snapshot set by trigger (legal record; clients never need to read members) |
| time_entry_id | uuid references patrol_time_entries on delete set null | |
| category_id | uuid references patrol_categories on delete set null | |
| subtype_id | uuid references patrol_subtypes on delete set null | |
| category_name, subtype_name | text | snapshot at submit |
| title | text not null default '' | |
| occurred_at | ts not null | |
| location_text | text | "Rear loading dock" |
| lat, lng, accuracy_m | | |
| description | text not null default '' | |
| people | jsonb not null default '[]' | `[{role:'subject'|'witness'|'victim'|'reporting', name, dob, description, phone, address, notes}]` |
| vehicles | jsonb not null default '[]' | `[{plate, state, make, model, color, notes}]` |
| police_called | boolean not null default false | |
| police_agency, police_case_no, officer_name | text | |
| ems_called, fire_called | boolean not null default false | |
| injury | boolean not null default false | |
| injury_details | text | |
| property_damage | boolean not null default false | |
| damage_estimate_usd | numeric(12,2) | |
| extra | jsonb not null default '{}' | future required-field types |
| severity | patrol_severity not null default 'low' | |
| status | patrol_incident_status not null default 'draft' | |
| report_no | text unique | assigned on submit: `LSS-KNT01-2026-00042` |
| submitted_at | ts | |
| client_visible | boolean not null default false | |
| reviewed_by | uuid references patrol_members | |
| reviewed_at, sent_to_client_at | ts | |
| review_notes | text | internal, staff only |
| client_rev | integer not null default 0 | last-writer guard for drafts (§4.3) |
| notified_at | ts | owner email sent |
| deleted_at | ts | soft delete (drafts only) |
| client_created_at, device_id, created_at, updated_at | | |
| | | idx `(org_id, occurred_at desc) where status <> 'draft'`, `(site_id, occurred_at desc) where client_visible`, `(member_id, updated_at desc)`, `(org_id, updated_at)` |

**patrol_incident_events** (review trail and guard addenda; content is immutable after submit)
| column | type | notes |
|---|---|---|
| id | pk | |
| org_id | org | |
| incident_id | uuid not null references patrol_incidents on delete cascade | |
| actor_id | uuid not null references patrol_members | |
| actor_name | text not null | |
| kind | text not null check in ('status','note','addendum','shared','pdf') | |
| from_status, to_status | patrol_incident_status | |
| body | text | |
| created_at | ts | idx `(incident_id, created_at)` |

**patrol_dars** (Daily Activity Report header, one per time entry)
| column | type | notes |
|---|---|---|
| id | pk (client) | |
| org_id, site_id, member_id | | |
| author_name | text not null | trigger snapshot |
| time_entry_id | uuid unique references patrol_time_entries on delete set null | |
| report_date | date not null | site-local date of clock-in |
| summary | text | written at clock-out |
| status | patrol_dar_status not null default 'open' | |
| report_no | text unique | assigned on submit |
| submitted_at, reviewed_at, sent_to_client_at | ts | |
| reviewed_by | uuid references patrol_members | |
| client_visible | boolean not null default false | |
| client_rev | integer not null default 0 | |
| client_created_at, device_id, created_at, updated_at | | idx `(site_id, report_date desc)`, `(member_id, report_date desc)` |

**patrol_dar_entries** (quick log lines)
| column | type | notes |
|---|---|---|
| id | pk (client) | |
| org_id, site_id, member_id | | |
| dar_id | uuid not null references patrol_dars on delete cascade | |
| occurred_at | ts not null | |
| category_id, subtype_id | uuid null FKs (set null) | |
| category_name | text | snapshot |
| body | text not null | |
| lat, lng, accuracy_m | | |
| client_rev | integer not null default 0 | |
| deleted_at | ts | guard may delete own entry while the DAR is open |
| client_created_at, device_id, created_at, updated_at | | idx `(dar_id, occurred_at)` |

**patrol_attachments**
| column | type | notes |
|---|---|---|
| id | pk (client) | |
| org_id, site_id | | |
| member_id | uuid not null references patrol_members | uploader |
| parent_type | patrol_attach_parent not null | |
| parent_id | uuid not null | polymorphic; checked by trigger `patrol_attachment_parent_check` |
| kind | patrol_attach_kind not null | |
| storage_path | text not null unique | `{org_id}/{parent_type}/{parent_id}/{id}.{ext}` |
| thumb_path | text unique | `{org_id}/{parent_type}/{parent_id}/{id}.thumb.jpg` (images and video posters) |
| mime | text not null | |
| size_bytes | bigint not null | |
| width, height | integer | |
| duration_s | real | |
| sha256 | text | integrity and dedupe |
| caption | text | |
| upload_status | text not null default 'pending' check in ('pending','uploaded') | |
| uploaded_at | ts | |
| client_created_at, device_id, created_at, updated_at | | idx `(parent_type, parent_id)`, `(org_id, created_at)` |

**patrol_alerts** (SOS)
| column | type | notes |
|---|---|---|
| id | pk (client) | |
| org_id | org | |
| site_id | uuid references patrol_sites | |
| member_id | uuid not null references patrol_members | |
| member_name | text not null | trigger snapshot |
| time_entry_id | uuid references patrol_time_entries on delete set null | |
| triggered_at | ts not null | device time of the hold-release |
| lat, lng, accuracy_m | | |
| status | patrol_alert_status not null default 'open' | |
| acknowledged_by, resolved_by | uuid references patrol_members | |
| acknowledged_at, resolved_at, cancelled_at | ts | |
| note | text | |
| notified_at | ts | |
| client_created_at, device_id, created_at, updated_at | | idx `(org_id, triggered_at desc)`, `(org_id) where status = 'open'` |

**patrol_consents**
| column | type | notes |
|---|---|---|
| id | pk (client) | |
| org_id, member_id | | |
| kind | patrol_consent_kind not null | |
| version | integer not null | notice text version; bumping the version re-prompts |
| accepted_at | ts not null | |
| device_id, user_agent | text | |
| created_at | ts | `unique (member_id, kind, version)` |

**patrol_invites**
| column | type | notes |
|---|---|---|
| id | pk | |
| org_id | org | |
| code_hash | text not null unique | `encode(extensions.digest(upper(code),'sha256'),'hex')`; plaintext is shown once |
| code_hint | text not null | last 4 chars for the admin list |
| role | patrol_role not null check (role <> 'owner') | owners are only created by bootstrap or a future transfer RPC |
| site_ids | uuid[] not null default '{}' | required non-empty for `client` |
| email | text | optional lock to an email (case-insensitive) |
| display_name | text | prefill |
| max_uses | integer not null default 1 | |
| uses | integer not null default 0 | |
| expires_at | ts not null default now() + interval '7 days' | |
| revoked_at | ts | |
| created_by | uuid not null references patrol_members | |
| created_at, updated_at | ts | |

**patrol_invite_failures** (brute-force throttle; no RLS access at all, only RPCs touch it)
`user_id uuid not null, failed_at ts not null default now()`, idx `(user_id, failed_at)`.

**patrol_share_links**
| column | type | notes |
|---|---|---|
| id | pk | |
| org_id | org | |
| token_hash | text not null unique | sha256 of a 32-byte random base64url token |
| target_type | text not null check in ('incident','dar') | |
| target_id | uuid not null | |
| signed_assets | jsonb not null default '[]' | `[{attachment_id, kind, mime, caption, url, thumb_url}]` signed by the creator for the TTL |
| expires_at | ts not null | max now() + 7 days (Free tier: keeps egress predictable) |
| revoked_at | ts | |
| view_count | integer not null default 0 | |
| last_viewed_at | ts | |
| created_by | uuid not null references patrol_members | |
| created_at | ts | |

### 3.3 Security-definer helper functions

All of these are `language sql stable security definer set search_path = public`, with
`revoke all on function … from public, anon; grant execute … to authenticated;`.
Policies call them **wrapped in a scalar subselect**, e.g. `org_id = any ((select patrol_staff_orgs()))`.
Postgres then evaluates each helper once per statement (as an InitPlan), not once per row.

```sql
-- org ids where I hold one of the given roles (active membership only)
create or replace function patrol_orgs_with_role(roles patrol_role[])
returns uuid[] … as $$
  select coalesce(array_agg(m.org_id), '{}')
  from patrol_members m
  where m.user_id = auth.uid() and m.status = 'active' and m.role = any(roles)
$$;

create or replace function patrol_member_orgs() returns uuid[]   -- any role
  as $$ select patrol_orgs_with_role('{owner,admin,supervisor,guard,client}') $$;
create or replace function patrol_staff_orgs()  returns uuid[]
  as $$ select patrol_orgs_with_role('{owner,admin,supervisor}') $$;
create or replace function patrol_admin_orgs()  returns uuid[]
  as $$ select patrol_orgs_with_role('{owner,admin}') $$;
create or replace function patrol_worker_orgs() returns uuid[]   -- may create field records
  as $$ select patrol_orgs_with_role('{owner,admin,supervisor,guard}') $$;

-- my member ids (one per org)
create or replace function patrol_my_member_ids() returns uuid[] as $$
  select coalesce(array_agg(id), '{}') from patrol_members
  where user_id = auth.uid() and status = 'active'
$$;

-- sites explicitly assigned to me (guards + clients)
create or replace function patrol_my_sites() returns uuid[] as $$
  select coalesce(array_agg(sa.site_id), '{}')
  from patrol_site_access sa join patrol_members m on m.id = sa.member_id
  where m.user_id = auth.uid() and m.status = 'active'
$$;

-- sites where I may create field records: assigned sites + every site in orgs where I'm staff
create or replace function patrol_workable_sites() returns uuid[] as $$
  select coalesce(array_agg(s.id), '{}') from patrol_sites s
  where s.org_id = any(patrol_staff_orgs())
     or (s.id = any(patrol_my_sites()) and s.org_id = any(patrol_worker_orgs()))
$$;

-- client-scope sites (assigned sites in orgs where my role is client)
create or replace function patrol_client_sites() returns uuid[] as $$
  select coalesce(array_agg(sa.site_id), '{}')
  from patrol_site_access sa join patrol_members m on m.id = sa.member_id
  where m.user_id = auth.uid() and m.status = 'active' and m.role = 'client'
$$;

-- my member id inside a given org (used in WITH CHECK)
create or replace function patrol_member_id_in(p_org uuid) returns uuid as $$
  select id from patrol_members
  where org_id = p_org and user_id = auth.uid() and status = 'active'
$$;

create or replace function patrol_gen_code(n int) returns text  -- volatile, Crockford base32 from gen_random_bytes
```

Owners and admins who also work posts (Karim and Abdinasir do) get guard capabilities at every
site through `patrol_workable_sites()`. No extra assignment is needed.

### 3.4 RLS policies

`alter table … enable row level security` on every `patrol_*` table, plus
`revoke all … from anon`. Policy names are `patrol_<table>_<action>_<who>`. Below, S = staff
orgs, A = admin orgs, W = workable sites, M = my member ids, C = client sites, O = member orgs.
Each helper appears inside `(select …)` in the real SQL.

| table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| patrol_orgs | `id = any(O)` | none (RPC only) | `id = any(A)` | none |
| patrol_org_settings | `org_id = any(S)` | none (RPC) | `org_id = any(A)` (trigger blocks changes to `next_report_no`) | none |
| patrol_members | `user_id = auth.uid()` **or** `org_id = any(S)` | none (RPCs: bootstrap, redeem) | `org_id = any(A)`; trigger: only an owner may change an owner row or grant owner, and nobody may demote the last owner. Self may update `display_name, phone` only (trigger compares columns). | none (disable instead) |
| patrol_sites | `org_id = any(S)` **or** `id = any(patrol_my_sites())` | `org_id = any(A)` | `org_id = any(A)` | `org_id = any(A)` (soft: `active=false` in UI) |
| patrol_site_access | `org_id = any(S)` **or** `member_id = any(M)` | `org_id = any(A)` | — | `org_id = any(A)` |
| patrol_checkpoints | `org_id = any(S)` **or** `site_id = any(patrol_my_sites())` | `org_id = any(A)` | `org_id = any(A)` | `org_id = any(A)` |
| patrol_shifts | `org_id = any(S)` **or** `member_id = any(M)` **or** (`member_id is null and site_id = any(W)` and not client) | `org_id = any(S)` | `org_id = any(S)` | `org_id = any(S)` |
| patrol_time_entries | `org_id = any(S)` **or** `member_id = any(M)` | `member_id = patrol_member_id_in(org_id) and site_id = any(W)` | `member_id = any(M)` (trigger: only `clock_out_*`, `shift_note`; only while `clock_out_at` was null) **or** `org_id = any(S)` (corrections) | none |
| patrol_location_pings | `org_id = any(S)` | `member_id = patrol_member_id_in(org_id)` and `exists (select 1 from patrol_time_entries t where t.id = time_entry_id and t.member_id = patrol_location_pings.member_id and t.clock_out_at is null)` | none | none (prune fn) |
| patrol_member_status | `org_id = any(S)` **or** `member_id = any(M)` | none | none | none |
| patrol_tour_runs | `org_id = any(S)` **or** `member_id = any(M)` **or** `site_id = any(C)` | `member_id = patrol_member_id_in(org_id) and site_id = any(W)` | `member_id = any(M)` (only `completed_at`) | none |
| patrol_scans | `org_id = any(S)` **or** `member_id = any(M)` **or** `site_id = any(C)` | `member_id = patrol_member_id_in(org_id) and site_id = any(W)` and checkpoint belongs to site (trigger) | none (immutable) | none |
| patrol_categories / patrol_subtypes | `org_id = any(O)` | `org_id = any(A)` | `org_id = any(A)` | `org_id = any(A)` |
| patrol_incidents | `member_id = any(M)` **or** (`org_id = any(S)` and `status <> 'draft'`) **or** (`site_id = any(C)` and `client_visible` and `status <> 'draft'`) | `member_id = patrol_member_id_in(org_id) and site_id = any(W) and status in ('draft','submitted')` | (`member_id = any(M)` and `status = 'draft'`) **or** `org_id = any(S)`. The trigger `patrol_incidents_guard` enforces this: non-staff can only edit while OLD.status = 'draft' and may set status to 'submitted' or keep 'draft'. Staff may only change `status, severity, review_notes, client_visible, reviewed_*, sent_to_client_at`. Content is frozen once OLD.status <> 'draft'. | `member_id = any(M) and status = 'draft'` |
| patrol_incident_events | `org_id = any(S)` **or** incident authored by me (`exists` on patrol_incidents with `member_id = any(M)`) | `actor_id = patrol_member_id_in(org_id)` and (`org_id = any(S)` **or** (`kind = 'addendum'` and the incident is mine)) | none | none |
| patrol_dars | `member_id = any(M)` **or** (`org_id = any(S)` and `status <> 'open'`) **or** (`site_id = any(C)` and `client_visible`) | `member_id = patrol_member_id_in(org_id) and site_id = any(W)` | own while OLD.status = 'open' (→ 'submitted'), **or** staff (review fields only); trigger `patrol_dars_guard` | none |
| patrol_dar_entries | `member_id = any(M)` **or** `exists (select 1 from patrol_dars d where d.id = dar_id)` (the DAR's own RLS decides staff and client visibility) | `member_id = patrol_member_id_in(org_id)` and the DAR is mine and open | own while the DAR is open | none (soft `deleted_at` via update) |
| patrol_attachments | `member_id = any(M)` **or** parent visible: `case parent_type when 'incident' then exists(select 1 from patrol_incidents p where p.id = parent_id) when 'dar_entry' then exists(… patrol_dar_entries …) when 'scan' then exists(… patrol_scans …) when 'alert' then exists(… patrol_alerts …) when 'site' then exists(… patrol_sites …) end`. Because RLS applies inside the subquery, attachments inherit the parent's visibility exactly. | `member_id = patrol_member_id_in(org_id)`, plus trigger: the parent exists, belongs to the same org, and is editable by me (or is a scan/alert I created); `storage_path` must start with `org_id || '/'` | `member_id = any(M)` (only `upload_status, uploaded_at, caption, thumb_path`) | `member_id = any(M)` while the parent is a draft or open, **or** `org_id = any(A)` |
| patrol_alerts | `org_id = any(S)` **or** `member_id = any(M)` | `member_id = patrol_member_id_in(org_id)` and `org_id = any(patrol_worker_orgs())` | none (RPC `patrol_alert_set_status`) | none |
| patrol_consents | `member_id = any(M)` **or** `org_id = any(S)` | `member_id = patrol_member_id_in(org_id)` | none | none |
| patrol_invites | `org_id = any(A)` | none (RPC) | `org_id = any(A)` (revoke only) | none |
| patrol_invite_failures | none | none | none | none |
| patrol_share_links | `org_id = any(S)` | none (RPC) | `org_id = any(S)` (revoke) | none |

Clients have **no** INSERT, UPDATE or DELETE policy anywhere.

Triggers (security definer where they write rows the caller can't):
- `patrol_touch_updated_at` (all mutable tables).
- `patrol_snapshot_names`: sets `author_name` / `member_name` / `actor_name` from patrol_members on insert.
- `patrol_assign_report_no`: on incidents and DARs. When status changes to 'submitted', it
  runs `update patrol_org_settings set next_report_no = next_report_no + 1 … returning` and
  formats `{prefix}-{site.code or 'SITE'}-{yyyy}-{lpad(n,5)}`. Sets `submitted_at`,
  `category_name`, `subtype_name`, and sets `client_visible = auto_share_with_client`.
- `patrol_incidents_guard`, `patrol_dars_guard`, `patrol_time_entries_guard`,
  `patrol_members_guard` (column and transition rules above).
- `patrol_client_rev_guard`: on incidents, DARs and DAR entries for non-staff updates. If
  `NEW.client_rev <= OLD.client_rev`, it returns OLD (a silent no-op for stale replays).
- `patrol_scan_after_insert`: bumps `patrol_tour_runs.scanned_count`. When it reaches
  `expected_count`, sets `completed_at`.
- `patrol_status_from_time_entry`, `patrol_status_from_ping`: maintain patrol_member_status.
- `patrol_attachment_parent_check`, `patrol_scan_checkpoint_check` (checkpoint.site_id = scan.site_id).

### 3.5 RPCs

All are `security definer set search_path = public`, revoked from public and granted to
`authenticated`. The one exception is `patrol_get_shared_report`, which is also granted to `anon`.
Each RPC checks the caller's role itself; RLS is bypassed inside it.

| RPC | Logic |
|---|---|
| `patrol_create_org(p_org_id uuid, p_name text, p_timezone text default 'America/Los_Angeles', p_display_name text default null) returns uuid` | `if not public.is_admin() then raise exception 'not_app_admin' using errcode='42501'`. Idempotent: if `p_org_id` already exists and was created by the caller, it returns it. Inserts patrol_orgs, patrol_org_settings (`notify_emails = array[auth.jwt()->>'email']`), and patrol_members (`role='owner'`), then calls `patrol_seed_categories_internal(org)`. |
| `patrol_bootstrap() returns jsonb` | A single round trip after login and on every foreground. Returns `{memberships:[{org, member, role}], orgs, settings_public (ping interval, video limits, tour defaults; never emails), sites, site_access, checkpoints, categories, subtypes, my_shifts (now-1d … now+14d), open_time_entry, open_dar, open_tour_runs, consents, is_app_admin}`, filtered by role. Staff also get `members` and `settings` (with emails). |
| `patrol_create_invite(p_org uuid, p_role patrol_role, p_site_ids uuid[] default '{}', p_email text default null, p_display_name text default null, p_ttl_hours int default 168, p_max_uses int default 1) returns jsonb` | Requires admin of p_org. Rejects `owner`. `client` requires sites, and all `p_site_ids` must belong to p_org. Generates an 8-char Crockford code shown as `LION-XXXX-XXXX` (40 bits; brute force is made impractical by the 10-failures-per-hour throttle plus the expiry), stores the sha256, and returns `{invite_id, code, url}`. |
| `patrol_redeem_invite(p_code text, p_display_name text, p_phone text default null) returns jsonb` | Requires `auth.uid()`. Throttle: 10 or more rows in patrol_invite_failures for this user in the last hour returns `{ok:false, error:'too_many_attempts'}`. Looks up the hash `for update`. If it is missing, expired, revoked, or `uses >= max_uses`, it records a failure and returns `{ok:false, error:'invalid_invite'}`. (Pass 2 change: it returns an error instead of raising, because a raise would roll back the failure row and defeat the throttle.) If `email` is set, it must equal `lower(auth.jwt()->>'email')`. Upserts the member: if one already exists in the org, it keeps the higher-ranked role and never downgrades. Inserts site_access rows (`on conflict do nothing`), increments `uses`, and returns `{org_id, member_id, role}`. |
| `patrol_seed_categories(p_org uuid) returns int` | Admin only. Inserts the default set (§3.8) `on conflict do nothing` on `(org_id, lower(name))`, so it is safe to re-run. Returns the rows added. |
| `patrol_reorder_categories(p_org uuid, p_ids uuid[]) returns void` | Admin only. `update … set sort = idx from unnest(p_ids) with ordinality`. Same for `patrol_reorder_subtypes(p_category uuid, p_ids uuid[])`. |
| `patrol_set_incident_status(p_id uuid, p_status patrol_incident_status, p_note text default null) returns void` | Staff of the incident's org. Valid transitions: submitted→reviewed→sent_to_client→closed, plus reopen→reviewed. Sets reviewed_* and `client_visible = (p_status in ('sent_to_client','closed'))` unless already true, and inserts a patrol_incident_events row. `patrol_set_dar_status` is analogous. |
| `patrol_alert_set_status(p_id uuid, p_status patrol_alert_status, p_note text default null)` | The owning guard may set `cancelled` ("I'm safe"). Staff may set acknowledged or resolved. |
| `patrol_mark_notified(p_table text, p_id uuid)` | Author or staff. Sets `notified_at = now()` where it is null on incidents or alerts. |
| `patrol_create_share_link(p_target_type text, p_target_id uuid, p_ttl_hours int default 168, p_signed_assets jsonb default '[]') returns text` | Staff of the target org. The target must be non-draft. TTL is clamped to 1..168. Generates a token (`encode(gen_random_bytes(32),'base64')` made URL-safe) and stores its hash. Inserts an event row (`kind='shared'`). Returns the plaintext token once. |
| `patrol_get_shared_report(p_token text) returns jsonb` | Granted to anon. Hashes the token and finds a link that is not revoked or expired, otherwise returns `null`. There is no error, so the RPC cannot be used to check whether a token exists. Increments `view_count`. Returns `{org:{name, phone, email, license_no}, site:{name, address}, report:{… minus review_notes, internal fields}, entries (dar), assets: signed_assets, expires_at}`. |
| `patrol_storage_usage(p_org uuid) returns jsonb` | Staff. `sum(size_bytes)` grouped by kind, for the storage meter against the 1 GB Free limit. |
| `patrol_prune_pings() returns int` | Deletes pings older than the retention period. Executable by `postgres` / pg_cron, and by admins for their own org only. |

### 3.6 Storage

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patrol-media', 'patrol-media', false, 52428800, array[
  'image/jpeg','image/png','image/webp','image/heic','image/heif',
  'video/mp4','video/quicktime','video/webm',
  'audio/mp4','audio/x-m4a','audio/aac','audio/mpeg','audio/wav','audio/webm','audio/ogg',
  'application/pdf'])
on conflict (id) do nothing;
```

Object path: `{org_id}/{parent_type}/{parent_id}/{attachment_id}.{ext}`, with a thumb at
`….thumb.jpg`. The policies on `storage.objects` are new names prefixed `patrol_media_` and
are scoped by `bucket_id = 'patrol-media'`, so they cannot affect other buckets:

- **select**: `bucket_id = 'patrol-media' and exists (select 1 from public.patrol_attachments a where a.storage_path = name or a.thumb_path = name)`.
  Attachment RLS applies inside the subquery, so object visibility equals row visibility,
  which in turn equals parent visibility.
- **insert**: `bucket_id = 'patrol-media' and (storage.foldername(name))[1] = any (select unnest((select patrol_worker_orgs()))::text) and exists (select 1 from public.patrol_attachments a where (a.storage_path = name or a.thumb_path = name) and a.member_id = any((select patrol_my_member_ids())) and a.upload_status = 'pending')`.
  So the attachment row must be synced **before** the upload. The outbox's dependency
  ordering guarantees this (§4.3).
- **update**: same as insert. This is required for `upsert: true` retries and TUS resumption.
- **delete**: `(storage.foldername(name))[1] = any (select unnest((select patrol_admin_orgs()))::text)`
  **or** the uploader's own pending or draft object.

Free tier budget: 1 GB storage, 5 GB egress per month.
- Compressed photos average about 250 KB; thumbs are about 20 KB and are cached locally forever.
- The admin Settings screen shows `patrol_storage_usage` as a meter. It warns at 70% and
  shows a red banner at 90%.
- Video is the main risk, so the defaults are 60 s / 50 MB and the guard sees the file size
  before attaching.

### 3.7 Realtime

```sql
do $$ begin
  -- add each table only if not already in the publication (idempotent)
  perform 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='patrol_alerts';
  if not found then alter publication supabase_realtime add table public.patrol_alerts; end if;
  -- … same for patrol_member_status, patrol_incidents, patrol_scans, patrol_dar_entries
end $$;
```

Realtime `postgres_changes` checks RLS per subscriber, so clients and guards receive only rows
they can select. Only staff dashboards subscribe, using one channel per org with filter
`org_id=eq.{org}`. The guard app never opens a socket. Free limits are 200 concurrent
connections and 2M messages per month, both far above our needs. The dashboard also re-fetches
on reconnect and every 60 s as a safety net.

### 3.8 Default categories (seeded per org)

Format: name → subtypes, with **required fields** in bold. Colors come from a muted palette of
12 swatches. Icons are keys from our icon map.

1. Patrol & Shift → Patrol start, Patrol end, Checkpoint note, Shift notes, Relief / handoff, Post check (DAR)
2. Access & Doors → Door/gate found open, Door/gate unsecured, Lock-up completed, Unlock, Key/fob issue
3. Alarm Response → Intrusion alarm, Fire alarm panel, Panic alarm, False alarm, Alarm reset
4. Suspicious Activity → Suspicious person, Suspicious vehicle, Loitering, Suspicious package (**people** optional)
5. Trespass & Removal → Trespass warning issued, Person removed, Trespass notice served, Returned after warning (**people**)
6. Theft & Shoplifting → Shoplifting, Theft from vehicle, Package theft, Burglary, Attempted theft (**people, property_damage**)
7. Vandalism, Graffiti & Damage → Graffiti, Broken window/glass, Property damage, Vehicle damage (**property_damage, photos**)
8. Disturbance & Noise → Noise complaint, Verbal dispute, Fight/assault, Intoxicated person (**people**)
9. Medical & Injury → Injury, Illness, Fall, Overdose suspected, EMS requested (**injury, people**)
10. Fire, Safety & Hazard → Smoke/fire, Spill, Trip hazard, Gas odor, Blocked exit (**photos**)
11. Maintenance & Facility → Lights out, Water leak, Elevator issue, HVAC issue, Broken fixture
12. Parking & Vehicles → Parking violation, Tow requested, Abandoned vehicle, Blocked fire lane (**vehicles**)
13. Police, Fire & EMS Contact → Police called, Police on site, Fire dept on site, EMS on site (**police**)
14. Client / Resident Request → Escort, Lockout assist, Information, Complaint
15. Package & Delivery → Delivery received, Package left unsecured, Delivery issue
16. Welfare Check (Unhoused Persons) → Welfare check, Encampment observed, Resources offered, Asked to relocate
17. Drug Activity / Paraphernalia → Suspected drug activity, Needles/paraphernalia found (**photos**)
18. Animal → Stray animal, Aggressive animal, Animal control called
19. Lost & Found → Item found, Item reported lost, Item returned
20. Weather → Storm damage, Ice/snow hazard, Flooding, Power outage
21. Retail Operations → Store open check, Store close check, Cash/vault escort, Customer assist
22. Residential (Apartments) → Amenity check (pool/gym), Mailroom check, Unit door open, Move-in/out observed
23. Safety Equipment → Fire extinguisher check, Exit sign out, AED check, Camera not working
24. Other → General observation, Other

The seed set lives in **one** source of truth, `src/domain/categories.seed.ts`. The SQL seed
in `20261024000500_patrol_seed.sql` is generated from it by `scripts/gen-seed-sql.mjs`,
and a unit test asserts the two stay identical.

---

## 4. Offline and sync

Principle: **IndexedDB is the source of truth for the UI.** The network only reconciles.
Nothing is shown as "saved" until the IDB transaction's `complete` event fires.

### 4.1 IndexedDB schema (`lion-patrol` v1, opened through `idb`)

| store | keyPath | indexes | content |
|---|---|---|---|
| `kv` | key | — | `deviceId`, `lastOrgId`, `bootstrapAt`, `deltaCursor:{table}`, `consentsLocal`, `uiPrefs` |
| `session_mirror` | key | — | mirror of the Supabase auth storage key (§5.1) |
| `vault` | userId | — | remembered guards (§5.3) |
| `identity` | userId | — | `{userId, email, memberships, isAppAdmin, bootstrap}` cached for offline cold start |
| `records` | `[table, id]` | `byTableOrg [table, orgId]`, `byTableParent [table, parentId]`, `byTableUpdated [table, updatedAt]`, `byPending _pending` | every cached row from any `patrol_*` table, plus local-only fields `_pending: 0/1`, `_error`, `_localRev` |
| `drafts` | id | `byUser userId` | in-progress form state (incident, DAR summary, shift note), including fields not yet valid |
| `outbox` | id (= idempotency key) | `bySeq seq`, `byUserStatus [userId, status]`, `byEntity entityKey` | ops (§4.2) |
| `blobs` | id (= attachment id) | `byState state` | `{id, mime, bytes: ArrayBuffer, thumb: ArrayBuffer, size, state: 'local'|'uploading'|'uploaded', uploadedAt}` |
| `tus` | fingerprint | — | tus upload URLs for resume across app kills (tus `urlStorage` adapter) |
| `thumb_cache` | storagePath | `byLastUsed lastUsed` | thumbnails fetched from signed URLs (LRU, 100 MB cap) |

**Decision:** blobs are stored as `ArrayBuffer` + mime, never as `Blob`. This sidesteps
historic WebKit bugs with Blobs in IDB, especially after an app kill. The cost is one copy at
write time.

Schema migrations use `upgrade(db, oldVersion)` with explicit version steps and are tested in
Vitest with fake-indexeddb.

### 4.2 Outbox op shape

```ts
type OutboxOp = {
  id: string;            // UUIDv7 — idempotency key, also used as row id where applicable
  seq: number;           // monotonic per device (kv counter), FIFO order
  userId: string;        // ops only flush under this user's session
  orgId: string;
  kind: 'insert' | 'upsert' | 'rpc' | 'upload' | 'email';
  table?: string;        // for insert/upsert
  rpc?: string;
  payload: unknown;      // row / rpc args / {attachmentId} / email params
  entityKey: string;     // 'patrol_incidents:<id>' — for coalescing + dependency chain
  dependsOn: string[];   // op ids that must be 'done' first
  status: 'pending' | 'inflight' | 'done' | 'dead';
  attempts: number;
  nextAttemptAt: number; // epoch ms
  lastError?: { code: string; message: string; http?: number; at: number };
  createdAt: number;
};
```

Done ops are deleted after 24 h. Dead ops are **never** auto-deleted.

**How each operation maps to the backend**
- Append-only records (scans, pings, alerts, consents, time-entry insert, tour-run insert,
  attachment rows, DAR entries create) use `insert` with
  `Prefer: resolution=ignore-duplicates, return=minimal` (INSERT … ON CONFLICT DO NOTHING).
  A replay is a no-op.
- Editable drafts (incident drafts, DAR summary, DAR entry edits, clock-out fields) use
  `upsert` with `Prefer: resolution=merge-duplicates` and `client_rev` incremented on every
  local save. The server `patrol_client_rev_guard` ignores stale replays. **Coalescing:**
  when a new upsert is enqueued for an `entityKey` whose previous op is still `pending` (not
  `inflight`), the payload is replaced in place, so 50 autosaves become one request.
- Pings are batched. The worker merges up to 100 pending ping inserts into one array insert.
- `upload` (§4.4) depends on the attachment-row insert, which depends on the parent insert.
- `email` depends on the parent op and on `patrol_mark_notified`.

**Ordering**
- A single worker, guarded by `navigator.locks.request('lp-outbox')` (Safari 15.4+), takes
  ops in `seq` order whose dependencies are `done` and whose `nextAttemptAt <= now`.
- An op in backoff blocks **only its dependents**, never unrelated ops. A failing photo upload
  does not hold up a checkpoint scan.
- At most 1 upload in flight plus 4 non-upload ops concurrently.

**Conflict policy**
- Field records are single-author. Conflicts can only come from the same guard on two devices,
  so last-writer-wins by `client_rev` is enough.
- After submit, content is server-frozen (trigger). Staff review fields live in columns the
  guard never writes, so they never conflict.
- If the server rejects an update because the record is no longer a draft (`P0001
  'not_editable'`), the op is dead with a clear message. The local copy is kept and offered as
  an **addendum**.

**Error classification** (`outbox/classify.ts`, unit tested)
| Response | Action |
|---|---|
| network error / timeout (15 s) / 5xx / 429 / 408 | retry with backoff |
| 401 / `PGRST301` JWT expired | refresh the session once, retry immediately; if the refresh fails because we're offline, back off; if it fails with `refresh_token_not_found` / `invalid_grant`, pause the outbox and show "Sign in to sync" (ops kept) |
| 409 / `23505` on the primary key | **success** (already applied) |
| `42501` / 403 (RLS) | retry ×3 (membership may be mid-sync), then **dead** |
| `23503` FK violation | retry ×5 (the parent may still be inflight from another device), then dead |
| `22xxx` / `23502` / `23514` / 400 `PGRST` parse | **dead** immediately |
| `P0001` with a known `not_editable` / `invalid_invite` message | dead with a human message |

**Backoff:** `delay = min(2^attempts × 2 s, 5 min) × random(0.7, 1.3)`. Attempts are unbounded
for retryable errors, so the app keeps trying across days offline.

**Poison handling:** dead ops show on the Sync screen (More → Sync). Each card has the
record's title, the error, and the actions **Retry**, **Copy details** (JSON to clipboard for
support), **Export** (downloads JSON plus media), and **Discard** (two-step confirm, only for
non-submitted drafts). Dead ops turn the sync pill red ("Error · tap").

**Flush triggers:**
- boot
- `online`
- `visibilitychange → visible`
- `focus`
- `pageshow` (bfcache restore)
- a new enqueue (debounced 300 ms)
- a 20 s interval while visible and anything is pending
- the Retry button

We never rely on the Background Sync API (it doesn't exist on iOS).

### 4.3 Writing a record (one code path for everything)

```
repo.save(record)
  └─ IDB tx [records, outbox, (blobs)]:
       put records[table,id] with _pending=1
       enqueue/coalesce op
  └─ tx.complete → UI "Saved · just now" → outbox.kick()
```

**The fixed per-feature op chains:**
- **Incident:**
  1. `upsert patrol_incidents (status='draft')`
  2. N× `insert patrol_attachments`
  3. N× `upload` (each depends on its attachment row)
  4. Submitting sets `status='submitted'`, coalesced into the draft upsert. The submit upsert
     has `dependsOn` = all uploads, so the report never becomes visible to staff with missing
     photos.
  5. `email` notify (depends on the submit)
- **DAR:** `insert patrol_dars` happens at clock-in. Each `insert patrol_dar_entries` depends on
  the DAR. Clock-out runs `upsert patrol_dars (status='submitted', summary)` and
  `upsert patrol_time_entries (clock_out_*)`.
- **Scan:** `insert patrol_tour_runs` (first scan of a run) → `insert patrol_scans` → optional
  attachments.
- **SOS:** `insert patrol_alerts` gets **priority 0** (jumps the queue) → `email`.

### 4.4 Media pipeline

1. **Pick:** `<input type=file accept="image/*" capture="environment">` for camera,
   `accept="image/*,video/*"` for the library, `accept="audio/*"` and
   `accept="application/pdf"` for files. Voice notes use our recorder (§6.3).
2. **Validate:**
   - Video: read the duration via a `<video preload=metadata>` object URL. Reject over
     `max_video_s` + 2 s grace or over `max_video_mb`, and show the size before attaching.
     Video thumbnail: seek to 0.5 s, draw to canvas, export a 320px JPEG poster.
   - Audio: max 25 MB.
   - PDF: max 20 MB.
3. **Compress images** (`media/compress.ts`):
   - `createImageBitmap(file, { imageOrientation: 'from-image' })`, falling back to an
     `<img>` decode. iOS already applies EXIF orientation in both paths.
   - Scale so the long edge is ≤ 1600 px, `canvas.toBlob('image/jpeg', 0.75)`.
   - Re-encoding through canvas strips **all** EXIF, including GPS. We keep orientation by
     baking the pixels.
   - HEIC from the library is decoded by Safari natively and comes out as JPEG.
   - Thumb: 320 px long edge, q 0.6.
   - Typical output is about 250 KB for the image and about 20 KB for the thumb.
   - **Decision: JPEG, not WebP.** Safari's `toBlob('image/webp')` support is inconsistent
     across iOS versions and silently falls back to PNG. JPEG at 0.75 is predictable.
4. **Store:** `blobs.put({id, bytes, thumb, mime, size, state:'local'})`, then a
   `patrol_attachments` row in `records` with `upload_status='pending'`, then enqueue the ops.
   The tray shows the thumb instantly from local bytes.
5. **Upload (worker):**
   - size < 6 MB: `storage.from('patrol-media').upload(path, bytes, {upsert: true, contentType})`,
     retried by the outbox.
   - size ≥ 6 MB: lazy-load tus-js-client, endpoint
     `https://djkinciawtoqlxkpiesq.supabase.co/storage/v1/upload/resumable`,
     `chunkSize: 6 * 1024 * 1024` (Supabase requires 6 MB),
     headers `{authorization: Bearer <access>, 'x-upsert': 'true'}`,
     `metadata {bucketName, objectName, contentType, cacheControl: '3600'}`,
     `urlStorage` = the IDB `tus` store, `removeFingerprintOnSuccess: true`. Before each
     chunk, `onBeforeRequest` refreshes the auth header from the current session.
   - The thumb uploads as a separate small object after the main file.
   - Progress is shown as a ring on the tray thumbnail (`onProgress` → signal).
   - On success: `upsert patrol_attachments {upload_status:'uploaded', uploaded_at}` and
     `blobs.state='uploaded'`.
6. **Retention:** uploaded blob bytes are purged after 7 days or when
   `navigator.storage.estimate()` passes 80% of quota. Thumbs move to `thumb_cache`.
7. **Display:** use local bytes if present (object URL). Otherwise `createSignedUrls` in a
   batch (TTL 1 h, memoized until 5 min before expiry), then fetch the thumb into `thumb_cache`
   keyed by **storage path**, since the signed URL changes on each signing. Full-size media
   loads on demand into the lightbox or players.

### 4.5 Read cache and refresh

- **Bootstrap** (`patrol_bootstrap`, about 20–80 KB) on login, on cold start when online, and
  on foreground if older than 5 min. It replaces reference data (sites, checkpoints,
  categories, shifts, settings) in `records`.
- **Delta feeds** for record tables (incidents, DARs, DAR entries, scans, tour runs,
  attachments, alerts, time entries):
  - `select … where org_id = $org and updated_at > $cursor order by updated_at limit 500`
    (scans and created-only tables use `created_at`), looping until a page has fewer than
    500 rows. The cursor is the max `updated_at` seen minus 2 s overlap.
  - Guards pull only their own records for the last 14 days. Staff pull 30 days, and older
    data is paged on scroll. Clients pull client-visible records for their sites, 90 days.
  - Rows with `_pending=1` locally are **not** overwritten by older server copies; the local
    `_localRev` wins until the op is done.
- **Screens render from IDB synchronously-ish:**
  1. Show a skeleton for no more than 1 frame.
  2. Render the cached data.
  3. Revalidate in the background, then a signal update re-renders.
- Pull-to-refresh (custom, only on list screens) forces a bootstrap plus deltas.
- Staff dashboards add realtime patches on top (§3.7).

### 4.6 Sync status model

`sync/status.ts` exports a computed signal:

```
state =
  'offline'  if !navigator.onLine || lastNetworkErrorAt within 10s && no success since
  'error'    if deadCount > 0 || authPaused
  'syncing'  if inflight > 0                        (pill shows "Syncing 2 of 5" + upload %)
  'pending'  if pendingCount > 0                    ("3 pending")
  'synced'   otherwise                              ("Synced · 2m ago" from lastSuccessAt)
```

- The `SyncPill` is in the Home hero and the top bar. Tapping it opens the Sync sheet: lists
  of pending and dead ops, last sync time, storage used, and a "Sync now" button.
- Each record row shows a small icon: clock = pending, check = synced, red dot = error.

### 4.7 Recovery after kill, refresh or crash

- On boot, any `inflight` op is reset to `pending`. Ops are idempotent, so replays are safe.
- Forms autosave to `drafts` (debounced 400 ms) and **also** on `visibilitychange: hidden`
  and `pagehide`, because iOS may kill the app without notice once it's backgrounded.
- On boot, if an unsubmitted incident draft exists, Home shows a "Continue report" card
  (title, category, attachment count, last saved). The Report tab opens it directly.
- An open time entry in `records` restores the On-duty state and timer, and restarts
  `watchPosition` (§6.2) when the app becomes visible.
- TUS resumes from the stored URL. Small uploads restart; they are under 6 MB, so this is cheap.
- **Service worker updates never auto-reload.** `registerType: 'prompt'` shows a toast
  "Update ready". If there is no dirty draft and no inflight upload, the update is applied on
  the next cold start.

---

## 5. Auth and session

### 5.1 Session persistence (iOS home-screen PWA)

- `new GoTrueClient({ url: SUPABASE_URL + '/auth/v1', headers: { apikey: PUBLISHABLE_KEY },
  storageKey: 'lp-auth', storage: durableStorage, autoRefreshToken: true, persistSession: true,
  detectSessionInUrl: false, flowType: 'pkce' })`.
- `durableStorage` implements the sync-or-async `SupportedStorage`:
  - `getItem` reads `localStorage`. If that is missing, it falls back to the IDB
    `session_mirror` and re-hydrates localStorage.
  - `setItem` writes localStorage **and** the IDB mirror.
  - `removeItem` deletes both.

  This protects against Safari evicting one store, and the standalone PWA (which has its own
  storage container) gets both copies.
- `navigator.storage.persist()` is called on first successful login (Safari 17+ grants this
  for home-screen apps). The result is shown in More → Device.
- **Refresh:** auth-js auto-refreshes while visible. On `visibilitychange → visible`,
  `online`, and boot, we call `auth.getSession()`. If `expires_at - now < 120 s`, we call
  `auth.refreshSession()`. Network failures during refresh are retryable and do **not**
  sign out.
- PostgREST and storage clients get the access token through a `fetch` wrapper that asks
  `auth.getSession()` per request. That covers token rotation.

### 5.2 Offline cold start

- Routing never waits for the network. Boot sequence:
  1. Read `kv.lastUserId`, then `identity[userId]`. That holds memberships, role, and the
     cached bootstrap.
  2. Render the role shell from IDB immediately.
  3. Start `auth.initialize()` in parallel. If it ends with a session, mark `online-auth ok`.
     If it fails for network reasons, stay in **offline-authenticated** mode: everything works
     locally and the outbox waits.
  4. Only an explicit sign-out, or a definitive refresh rejection (`invalid_grant`,
     `refresh_token_not_found`, `user_not_found`), leads to the login screen. Even then the
     outbox and drafts are **kept**, keyed by userId, and flush after the same user signs back in.
- The lock screen (§5.3) appears before the shell only if PIN lock is enabled on the device.

### 5.3 Remembered devices and PIN

**Goal:** on a shared post phone, several guards can each re-enter in about 2 seconds without
typing a password. The PIN never leaves the device.

**Enrollment.** After a password login, a prompt asks "Remember me on this device?" and the
guard sets a 4–6 digit PIN, which is required on shared devices.

**Crypto** (`auth/vault.ts`, WebCrypto only):
- `salt = getRandomValues(16)`.
- `bits = PBKDF2-SHA256(PIN, salt, iterations = 310_000, 512 bits)`. That takes about
  250–400 ms on an iPhone 12–15, which is the cost per guess.
- `verifier = bits[0..32]`, compared in constant time.
- `wrapKey = importKey('raw', bits[32..64], 'AES-GCM', extractable=false)`.
- `vault[userId] = { userId, email, displayName, orgName, role, initials, salt, iterations,
  verifier, iv, ciphertext = AES-GCM(wrapKey, JSON{refresh_token, access_token, expires_at, user}),
  failedAttempts, lockedUntil, createdAt, lastUsedAt }`.

**Unlock:**
1. Derive the bits and compare with the verifier.
2. Decrypt the token blob.
3. `auth.setSession({access_token, refresh_token})`. If offline, adopt the identity in
   offline-authenticated mode and keep the decrypted tokens in memory until online.
4. Keep `wrapKey` in memory for the session. On every `TOKEN_REFRESHED` event, re-encrypt
   the new tokens into the vault, so the stored refresh token is never stale. Refresh tokens
   rotate and the old one is invalidated after the reuse interval.

**Lockout (per guard entry):**
- 5 failures → locked 30 s; 6 → 1 min; 7 → 5 min; 8–9 → 15 min.
- **10 consecutive failures wipe that guard's vault entry**, after which a password login is
  required.
- `lockedUntil` is stored, so lockout survives a refresh.

**Multiple guards per device:**
- The lock screen shows remembered guards as avatar tiles (initials, name, org), plus "Use
  password" and "Add guard".
- Switching guards:
  1. Flush the outbox for the current user. If ops are still pending, warn "Alex has 3
     unsynced items. They'll sync next time Alex unlocks."
  2. Re-wrap the current tokens.
  3. `auth.signOut({ scope: 'local' })`. This clears the local session without revoking the
     refresh token.
  4. Unlock the next guard.
- Outbox ops, drafts, and the open time entry are all keyed by `userId`, so they never mix.

**Auto-lock:** with PIN enabled, the app locks after 10 min hidden (configurable 1–60 min) and
on explicit "Lock". The active session stays in auth storage. The lock is a UI gate, which is
the correct threat model for coworkers who pick up a phone.

**Threat model (documented in-app under More → Device):**
- A 4–6 digit PIN with PBKDF2 protects against casual access, not against forensic extraction
  of the IDB.
- Real revocation is server-side: an owner sets the member to `disabled`. Every helper then
  returns empty sets, so a stolen refresh token reads nothing.
- "Sign out everywhere" calls `auth.signOut({scope:'global'})`.

### 5.4 Sign-in method

**Decision: email + password** is the primary method, and every invitee creates a password.
Reasons:
- Magic links open in Safari, not in the home-screen PWA, which has separate storage, so the
  login would land in the wrong container.
- Supabase's built-in SMTP on Free is heavily rate-limited and only delivers to project team
  addresses unless custom SMTP is configured, so neither OTP codes nor magic links are
  reliable for new invitees.

Coordinator setup:
- Auth → Email provider **enabled**.
- "Confirm email" **off**, or custom SMTP configured. The invite code is the trust gate: an
  account that never redeemed an invite has zero data access.
- Site URL `https://karimdc5.github.io/Lion-Patrol/`.

Password reset UI ships later (it needs custom SMTP). For now, owners can disable a member and
reissue an invite, and the guard signs up with a new password.

### 5.5 Invite flow

1. Admin goes to People → Invite, picks role (admin/supervisor/guard/client), sites (required
   for client, recommended for guard), optional email, name and expiry, then calls
   `patrol_create_invite`.
2. A sheet shows the code `LION-7K4Q-9XW2`, a QR code of the join URL
   `/Lion-Patrol/join?code=…`, and "Share" (iOS share sheet with a text message and link). The
   code is shown only once; the list shows `…9XW2` with uses and expiry and a revoke action.
3. The invitee opens the link in Safari. The A2HS guide recommends installing first, and the
   code is carried into the PWA by having them type it, since storage is separate.
   - If not signed in: the Join screen shows code, name, email, password → `auth.signUp`
     (or `signInWithPassword` if the account exists) → `patrol_redeem_invite`.
   - If signed in: `patrol_redeem_invite` directly.
4. Then bootstrap → role routing → (guard) "Remember this device + set PIN" → GPS and
   audio notices are presented at first clock-in or first recording, not at join.

### 5.6 Role routing

After the identity is known:
- **0 memberships:** if `is_app_admin`, go to `/setup` (Create organization →
  `patrol_create_org`, which seeds categories), otherwise to `/join`.
- **1 membership:** owner/admin/supervisor → `/a` (dashboard); guard → `/g`; client → `/c`.
- **Multiple memberships:** an org picker; the last choice is remembered.
- Owner, admin and supervisor see a **"Guard mode"** switch in the shell (header avatar menu),
  which opens `/g` with the same session. This matters because the owners work posts.
- Route guards: `/a/*` requires staff of the current org, and admin-only screens (People,
  Settings, Categories) require admin. `/c/*` requires client. Unauthorized → redirect to the
  role home. RLS is the actual enforcement.

### 5.7 Notifications (EmailJS)

`notify/emailjs.ts`:
- `CLIENT_NOTIFICATIONS_ENABLED` is a `const false` in `config.ts`, and a
  `VITE_ALLOW_CLIENT_EMAIL` build flag is **ignored unless** both that flag is set and the org
  setting `client_notifications_enabled` is true. In this build there is no code path that
  builds a client recipient at all.
- `sendOwnerNotification(org, payload)`:
  1. Recipients are `settings.notify_emails`, lowercased and deduplicated.
  2. `assertOwnerRecipients(recipients, settings.notify_emails)` throws if any address is not in
     the owner list. A unit test checks that no client or guard email can reach the request.
  3. `POST https://api.emailjs.com/api/v1.0/email/send` with body
     `{ service_id:'service_49ltt4f', template_id:'template_n369iwa', user_id:'hF1r9AflJq5A0MSR6',
     template_params:{ to_email: recipients.join(','), subject, message, site_name, guard_name,
     report_no, occurred_at, category, severity, link, lat, lng, map_url } }`.
     `message` is plain-text-first with light HTML, like the legacy `summary` param.
- Notification events: incident **submitted** (subject `[Lion Patrol] Incident LSS-… — Theft & Shoplifting at Kent Station Retail`)
  and **SOS** (subject `🚨 SOS — {guard} at {site}`, with the location link). Both are queued
  as outbox `email` ops and followed by `patrol_mark_notified`.
- If a kill happens between send and mark, the email may be sent twice. That is acceptable;
  a duplicate is better than no email.
- EmailJS Free allows 200 emails per month. The Settings screen shows a count of notifications
  sent this month (from `notified_at`).
- Staff can only receive emails. Supervisors are not emailed in this build (owner emails only).

---

## 6. Screens and navigation

Design tokens map to `styles/tokens.css`:
- Colors: `--bg #0A0F1C`, `--surface #111827`, `--raised #1A2236`,
  `--hairline rgba(255,255,255,.08)`, `--text #F5F7FA`, `--text-2 #9AA4B2`, `--gold #D4A537`,
  `--gold-pressed #B8891F`, and the semantic colors.
- Type scale: 34/41, 22/28, 17/22, 13/18, with `font-variant-numeric: tabular-nums` on times.
- Radius: 16 card, 14 button, 999 chip.
- Layout: 8pt spacing, 48pt minimum tap target, 56pt primary buttons.
- Every fixed bar pads with `env(safe-area-inset-*)`, and the root uses `height: 100dvh`.
- `overscroll-behavior-y: none` on the body. Lists that support pull-to-refresh use a custom
  gesture.
- Inputs are ≥ 16px to prevent iOS zoom. `touch-action: manipulation` globally.
- `prefers-reduced-motion` disables slides, rings and the shimmer.
- Transitions: 200ms push slide (CSS transform on route change, via a small `<Transition>`
  wrapper) and sheets with a grabber that can be swiped down to dismiss.

### 6.1 Public and shared screens

| Route | Screen |
|---|---|
| `/login` | Logo lockup ("Lion Security Services" / "Lion Patrol"), email + password, "Have an invite code?", "Try demo". If remembered guards exist, the Lock screen is shown instead. |
| `/lock` | Remembered-guard tiles, then the PIN pad (large 72pt keys, dots, haptic tick, lockout countdown). |
| `/join?code=` | Code field (auto-formats `LION-XXXX-XXXX`), name, email, password, then redeem. |
| `/setup` | App-admin bootstrap: org name, timezone, your display name → creates the org and seeds categories. |
| `/install` | **A2HS guide**, shown automatically when `!matchMedia('(display-mode: standalone)').matches && !navigator.standalone` on iOS Safari. Steps: Share icon → "Add to Home Screen" → open from the home screen, with illustrations. Explains that **the home-screen app keeps its own login and data, separate from Safari**: sign in again there, and items saved in Safari stay in Safari. A "Continue in browser" link is shown for admins on desktop. |
| `/s/:token` | Public shared report (`patrol_get_shared_report`): letterhead header, report body, photos from signed assets, "Download PDF" (generated client-side), expiry notice. Read-only, with no app shell. Lazy chunk. |
| `/q/:code` | QR landing when scanned by the iOS camera outside the app. In standalone it is treated as a scan. In Safari it shows "Open Lion Patrol from your home screen and tap Scan" with the code shown for manual entry. |
| `/?demo=1` or "Try demo" | Starts the MemoryBackend with seed data and a role picker (Guard / Owner / Client). A "DEMO" ribbon is shown. |

### 6.2 Guard (`/g`)

Bottom tab bar: **Home · Patrol · [ + Report ] · Activity · More**. The tab bar is translucent
(`backdrop-filter: blur(20px)`) with a hairline. Report is the raised gold center button.
Long-pressing it for 2 s triggers SOS, and so does the red SOS button on Home.

| Route | Screen |
|---|---|
| `/g` Home | Hero card: status ring (grey "Off duty" / green "On duty 02:14:33" live timer), site name, SyncPill. If off duty, a "Clock in" CTA. If on duty: next checkpoint card with a progress ring (4/9), a quick actions row (Scan · DAR note · Incident · Post orders), a "Continue report" card if a draft exists, recent activity (5), and a red SOS hold button. |
| `/g/clock` | Site picker (assigned sites as cards with address and distance from the current position, computed only after the notice is accepted), shift match (today's scheduled shift highlighted), and a 56pt "Clock in" button. **GPS notice sheet** on first clock-in per notice version: "Location is recorded only while you're clocked in, to verify patrols and for your safety. It stops when you clock out. No tracking off duty." Actions are **Accept** or **Not now**; "Not now" cancels the clock-in, because the notice is required by policy. Accepting writes a `patrol_consents` row (`gps_notice`, version 1, timestamp) and sets `gps_notice_accepted_at` on the time entry. Clock-out sheet: shift note (required, multiline, dictation), DAR summary preview, then submit. That submits the DAR, sets `clock_out_*`, and calls `geo.stopWatch()`. |
| `/g/patrol` | Current site's tour: checkpoints in `seq` order with status (scanned ✓ time, next, missed, late, out-of-order badges), a "Start tour" / "Scan" CTA, and a tour history for today. |
| `/g/scan` | Full-bleed camera (`getUserMedia({video:{facingMode:'environment'}})` in a lazy qr-scanner chunk), dimmed overlay with a rounded cutout, animated corner brackets, torch toggle (when `track.getCapabilities().torch` exists), and an "Enter code manually" sheet (8-char code field, also accepts the full URL). On success: haptic (`navigator.vibrate?.(30)`; a no-op on iOS, where the visual burst is primary), a green check burst, and a toast "Main Gate ✓ 4/9" with flags if any ("Out of order", "Late"). Optional "Add note/photo". |
| `/g/report/new`, `/g/report/:id` | Incident form, one scroll in steps:<br>1. Category grid (2 columns of large colored tiles; search pinned; **Recent** and **Favorites** first, from local usage counts)<br>2. Subtype chips<br>3. When (defaults to now) / Where (site preselected, location text, "Use my location")<br>4. Title<br>5. Description with mic dictation<br>6. Required-field sections driven by `required_fields`: People cards, Vehicle cards, Police toggle → agency + case #, Injury, Property damage $, Witnesses<br>7. Attachments tray (camera, library, voice note, file)<br>8. Severity<br>Then a sticky "Submit report" bar. An autosave indicator ("Saved · 2s ago") is always visible. Required fields are validated inline, and the first error scrolls into view on submit. |
| `/g/dar` (sheet from Home / Activity) | Quick DAR entry: one-line text with dictation, optional category chip, photo. Plus preset buttons: "All secure", "Doors checked", "Patrol complete", "Lights out noted". |
| `/g/activity` | My timeline (scans, DAR entries, incidents, clock events), grouped by day with sticky headers, colored category dot, tabular time on the left, title and preview, inline thumbs, per-item sync icon. Filter chips: type and date. |
| `/g/sos` | Full red screen after the 2 s hold (filling ring, so a pocket tap doesn't fire it): "Alert sent to owners" (or "Will send when online" while offline), time, location (lat/lng with accuracy), **Call 911** (`tel:911`, 64pt), and "I'm safe — cancel" (`patrol_alert_set_status cancelled`). On trigger, `getCurrentPosition` runs with a 5 s timeout, falling back to the last fix. |
| `/g/more` | Post orders (per assigned site; sanitized HTML cached offline; "Updated {date}"), My schedule (list of the next 14 days), Sync, Profile, Device (PIN, auto-lock, remembered guards, storage persisted?, storage used), Notices (view accepted GPS/audio notices), Install guide, Sign out / Switch guard. |

**GPS rules** (`platform/web/geo.ts`):
- `watchPosition({enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000})` starts
  **only** if there is an open time entry and the notice was accepted.
- A ping is enqueued when either is true: at least `gps_ping_interval_s` has passed since the
  last ping, or the guard has moved more than 50 m.
- Pinging stops on clock-out (`clearWatch`). Watching also stops on `visibilitychange: hidden`,
  because iOS suspends the app anyway, and resumes on visible while still clocked in.
- The dashboard shows "last ping 14m ago". No background tracking exists, which is both the
  legal requirement and the iOS reality.
- Optional Wake Lock ("Keep screen on during patrol", Safari 16.4+).

### 6.3 Audio: voice notes and consent

- The one-time **audio notice** appears before the first voice note:
  "Washington law requires everyone's consent to record a conversation. Use voice notes only to
  dictate your own account of events. Never record other people without their consent." The
  action is "I understand". It writes `patrol_consents (audio_notice)`.
- The recorder sheet:
  - Explicit tap to record and tap to stop.
  - A large red pulsing dot and a timer for the whole duration, plus "Recording your voice note".
  - Max 120 s.
  - `MediaRecorder` with `audio/mp4` on iOS and `audio/webm` elsewhere.
- **Recording stops and discards the track's stream on `visibilitychange: hidden`, `pagehide`,
  and route change.** There is no auto-start, no background recording, and no
  recording-on-trigger (SOS does not record).
- Existing audio files can be attached via `accept="audio/*"`.
- Dictation (speech to text into the description):
  - `webkitSpeechRecognition` where available, with a visible "Listening…" state.
  - It is unreliable in iOS standalone mode, so the UI also hints "or tap the 🎤 on your
    keyboard". iOS keyboard dictation always works and needs no code.

### 6.4 Owner, admin and supervisor (`/a`)

Phone: the same tab-bar shell with **Live · Feed · Incidents · Sites · More**. At ≥ 900 px
there is a left sidebar with all sections.

| Route | Screen | Who |
|---|---|---|
| `/a` Live | Leaflet map (lazy) filling the top 55%, Carto dark tiles, site pins, guard markers from `patrol_member_status` (realtime), and an **open SOS banner** that pulses red with an Acknowledge action. Draggable bottom sheet of on-shift guards: initials avatar, site, "2m ago", patrol % pill. Tapping a guard centers the map on them. | staff |
| `/a/feed` | Unified activity timeline across guards with filter chips: site, guard, category, date range, type. Each filter opens a sheet. Paged from IDB with delta refresh. | staff |
| `/a/incidents`, `/a/incidents/:id` | List segmented by status (New / Reviewed / Sent / Closed). The detail view shows the full report, media (lightbox, video, audio, PDF links), the events trail, and these actions: Mark reviewed, Send to client (sets client_visible), Close, Internal note, **Generate PDF**, **Share link** (TTL picker 24 h / 72 h / 7 d). | staff |
| `/a/dars`, `/a/dars/:id` | DAR list by date and site. The detail view shows the timeline of entries, review actions, and PDF. | staff |
| `/a/patrols` | Patrol completion per site per day: runs, % complete, missed and late checkpoints (red/amber flags), drill-down to scans. | staff |
| `/a/alerts` | SOS history with acknowledge and resolve actions. | staff |
| `/a/sites`, `/a/sites/:id` | Site list. The detail view has tabs: **Info** (address, map pin drag on a mini map, kind, geofence, tour interval), **Post orders** (lazy `editor` chunk: a contenteditable toolbar with B / I / H2 / bullet / numbered / link; output sanitized to the allowlist `p, h2, h3, strong, em, ul, ol, li, a[href^=https:|tel:|mailto:], br`), **Contacts** (addable cards), **Checkpoints** (add, edit, drag to reorder seq, active toggle, regenerate code), **QR sheet** (pick a layout, then generate the PDF, §7.3), and **Access** (assigned guards and clients). | admin edits; supervisor read-only |
| `/a/schedule` | Week view (7 columns × sites on desktop; a day-by-day list with a horizontal week strip on phone) and a list view. Tap an empty slot or "+" to open the sheet: site, guard (or open shift), start/end, notes. Conflict warning if the guard overlaps another shift. Copy-last-week action. | staff |
| `/a/people` | Members grouped by role (status, sites, last seen from member_status), disable/enable, change role, site access. Invites tab: create, active codes (hint, uses, expiry), revoke. | admin |
| `/a/settings` | Grouped inset list: Organization (name, letterhead fields), **Notifications** (owner emails list; client notifications row shown **disabled** with the caption "Not available in this version"), Report numbering, GPS ping interval, Video limits, Tour defaults, Storage meter, **Categories →**. | admin |
| `/a/settings/categories` | **Category manager**: an iOS inset list. Each row has a drag handle (pointer-events-based drag with long-press activation on touch, auto-scroll, keyboard up/down for accessibility), color dot, icon, name, subtype count, and an eye toggle (hide). Tap a row to open the edit sheet: name, 12 color swatches, icon grid (about 40), subtypes list (add, rename, drag reorder, hide), required-field toggles, default severity, "Use for" (incident/DAR/both). "Add category" and "Restore defaults" (calls `patrol_seed_categories`, which only adds missing ones). Reorder persists through `patrol_reorder_categories` (queued offline like everything else). | admin |

### 6.5 Client (`/c`)

Simple shell with no tab bar on a single site and a site switcher if there are several.

| Route | Screen |
|---|---|
| `/c` | Site header, **Patrol proof**: last 7 days of tour completion (bars per day plus checkpoint hit rate), recent reports list (incidents and DARs that are client-visible), and an empty state "No reports shared yet". |
| `/c/reports/:id`, `/c/dars/:id` | Read-only report with media (signed URLs) and a "Download PDF" (share sheet) button. No internal notes. |

---

## 7. PDF design

### 7.1 Library and fonts

- **pdf-lib 1.17.1**, lazy chunk `pdf`.
- **Decision:** use the standard 14 fonts (Helvetica, Helvetica-Bold, Helvetica-Oblique). They
  are vector, need zero font bytes, and print crisply. `pdf/text.ts`:
  - Maps characters outside WinAnsi (curly quotes and dashes are fine; emoji and CJK are not)
    to safe replacements or `?`.
  - Measures with `font.widthOfTextAtSize` and wraps by words, hard-breaking long tokens such
    as URLs and plates.
  - Unit tests cover the wrapping.
- If non-Latin names become a requirement, add `@pdf-lib/fontkit` 1.1.1 and embed an Inter
  subset. That is a contained change in `text.ts`.

### 7.2 Letterhead layout (US Letter 612 × 792 pt, margins 48 pt)

```
┌──────────────────────────────────────────────────────────────┐
│ [logo 44pt]  LION SECURITY SERVICES            INCIDENT REPORT│  y=744
│              Lion Patrol · Licensed Security    LSS-KNT01-2026-00042
│              (253) …  ·  email  ·  WA Lic #…    Oct 24, 2026 │
│━━━━━━━━━━━━━━━━━━━━━━━━━━ gold 1.5pt rule ━━━━━━━━━━━━━━━━━━━│  y≈700
│ SUMMARY (2-col label/value grid, 9pt labels #6B7280 caps,     │
│ 11pt values #111827): Site · Address · Category › Subtype ·   │
│ Severity chip · Occurred · Reported by · Police (agency, #)   │
│                                                               │
│ DESCRIPTION  (11pt / 15.5 leading, wrapped)                   │
│ PEOPLE INVOLVED  (table: role, name, description)             │
│ VEHICLES  (table: plate/state, make/model, color)             │
│ INJURY / DAMAGE                                               │
│ PHOTOS  (2-up grid, 246pt wide each, aspect kept, 8pt caption │
│          with time; max 6 per page; flows to new pages)       │
│ OTHER MEDIA  (list: icon glyph, filename, "Open (link expires │
│          Oct 31)" as link annotation to a 7-day signed URL)   │
│ REVIEW  (status, reviewed by/at) — only on staff PDFs; client │
│          PDFs omit internal notes                             │
├──────────────────────────────────────────────────────────────┤
│ Confidential — prepared for {client site}   Generated {ts}  Page 2 of 3 │ y=28
└──────────────────────────────────────────────────────────────┘
```

- The section header is 10pt bold, letter-spaced caps, with a 0.5pt hairline under it.
  Sections never orphan their header: if less than 60pt remains on the page, a new page starts.
- Page 2 and later get a compact header: a small logo, the report no, and a hairline.
- **Logo:** `public/brand/logo-pdf.png` (600 px wide, optimized, about 40 KB, generated from
  `logo.png` by `scripts/icons.mjs`), fetched once and cached by the SW precache, then
  `embedPng`. It is drawn at 44pt, which is about 330 dpi, so it is crisp.
- **Images:** our JPEGs are embedded as-is with `embedJpg` (no re-encode). PNGs use `embedPng`.
  Anything else gets its thumb. Bytes come from local `blobs` if present, otherwise from signed
  URL fetches (parallel, max 4 at a time). Images are scaled to fit the cell, aspect kept.
- **DAR PDF:** same letterhead with the title "DAILY ACTIVITY REPORT". Summary grid (site,
  guard, shift times, totals: entries, patrol runs, % checkpoints, incidents), then a
  chronological table (time | category | entry) with inline photo thumbs (60pt), then the
  patrol summary per run, then the shift note.
- **Metadata:** `setTitle`, `setAuthor('Lion Security Services')`, `setCreator('Lion Patrol')`,
  `setProducer`, and `setCreationDate`.

### 7.3 QR checkpoint sheets

Layouts:
- **1-up:** per page, a 4in QR, checkpoint name 28pt, site name, the "Scan with Lion Patrol"
  instruction, the manual code `7K4Q-9XW2` in 20pt monospaced-style spacing, and the small logo.
- **6-up labels:** 2 × 3, with cut marks.

The QR matrix from `uqr` (ECC level Q) is drawn as merged vector rectangles. The payload is
`https://karimdc5.github.io/Lion-Patrol/q/7K4Q9XW2`. It prints sharp, and the PDF is about
30 KB per page.

### 7.4 Delivery

- iOS requires transient user activation for `navigator.share`, and that activation is lost
  across long async work. So the flow is two-step:
  1. Tap "Generate PDF". The PDF is built (button spinner) into a `File([bytes],
     'LSS-KNT01-2026-00042.pdf', {type:'application/pdf'})`.
  2. A sheet "PDF ready · 3 pages · 1.2 MB" offers **Share** (a synchronous `navigator.share({files:[file], title})`
     inside the tap handler, guarded by `navigator.canShare({files})`), **Open** (an object URL
     in a new tab, which iOS shows in its PDF viewer), and **Download** (an `<a download>`
     fallback on desktop).
- `window.print()` is never used (lint rule `no-restricted-properties`).
- An incident event `kind='pdf'` is logged when staff share.

---

## 8. Platform adapters and the Capacitor / App Store path

`src/platform/types.ts` defines small interfaces. Feature code imports only from `platform/`.

```ts
interface CameraAdapter   { pickPhoto(src:'camera'|'library'): Promise<File[]>; pickVideo(): Promise<File|null>; pickFile(accept:string): Promise<File[]> }
interface GeoAdapter      { current(opts): Promise<Fix|null>; watch(cb:(f:Fix)=>void, opts): () => void; permission(): Promise<'granted'|'denied'|'prompt'|'unknown'> }
interface ScannerAdapter  { start(el:HTMLElement, onCode:(s:string)=>void): Promise<Stop>; hasTorch(): boolean; setTorch(on:boolean): Promise<void> }
interface ShareAdapter    { canShareFiles(): boolean; shareFile(file:File, title:string): Promise<'shared'|'cancelled'|'unsupported'>; shareText(text:string, url?:string): Promise<…> }
interface HapticsAdapter  { tap(): void; success(): void; warning(): void; heavy(): void }
interface KVAdapter       { get(k): Promise<string|null>; set(k,v): Promise<void>; del(k): Promise<void> }     // non-secret
interface SecureKVAdapter { get/set/del }   // web: same as KV (vault ciphertext already encrypted); native: Keychain/Keystore
interface NetAdapter      { online(): boolean; onChange(cb): Unsub }
interface LifecycleAdapter{ onResume(cb): Unsub; onPause(cb): Unsub }  // web: visibilitychange/pageshow/pagehide/focus
interface RecorderAdapter { start(): Promise<void>; stop(): Promise<File>; cancel(): void; onLevel(cb): Unsub }
interface WakeAdapter     { keepAwake(on:boolean): Promise<void> }
```

`platform/index.ts` picks the implementation with `window.Capacitor?.isNativePlatform()`
(native) or web.

**Later Capacitor wrap (no rewrite):**
- `npx cap add ios android` with `webDir: dist`, built with `VITE_BASE=/` (the base path is
  env-driven).
- Implementations with Capacitor 7 plugins:
  - `@capacitor/camera`, `@capacitor/geolocation`, `@capacitor/share`, `@capacitor/haptics`,
    `@capacitor/preferences`, `@capacitor/network`, `@capacitor/app`
  - `@capacitor-mlkit/barcode-scanning` (native scanner and torch)
  - `@capacitor-community/keep-awake`
  - a Keychain-backed secure storage plugin
  - `@capacitor/filesystem` for large blob storage if IDB quotas become an issue
- Routing: native uses the same router. The service worker is disabled under native
  (`if (!isNative) registerSW()`).
- Deep links (`/q/:code`, `/join`): add Universal Links (`apple-app-site-association` on Pages
  needs the `.well-known/` path, which a GitHub Pages project site can't serve at the domain
  root). Use a custom domain or a custom URL scheme `lionpatrol://`.

**App Store requirements:**
- Apple Developer account ($99/yr).
- Usage strings: `NSLocationWhenInUseUsageDescription` (on-duty only; **no** "Always" or
  background location, matching our legal design), `NSCameraUsageDescription`,
  `NSMicrophoneUsageDescription` (voice notes only), and `NSPhotoLibraryUsageDescription`.
- Privacy manifest (`PrivacyInfo.xcprivacy`) and App Privacy labels: location, photos,
  audio, contact info, and identifiers, all linked to the user and used for app functionality.
- **In-app account deletion** (Guideline 5.1.1(v)). This needs an Edge Function using the
  service role to delete the auth user and anonymize member rows. It is planned for the wrap
  pass and not built now.
- Guideline 4.2 (minimum functionality) is satisfied by the native scanner, haptics, camera
  and offline. Push notifications for SOS (APNs via an Edge Function) are recommended.
- A demo account for App Review: demo mode plus a seeded review org.
- Sign in with Apple is not required, since there is no third-party social login.

---

## 9. Test plan

### 9.1 Backend abstraction

`data/backend/types.ts`:

```ts
interface Backend {
  auth: { signIn, signUp, signOut, getSession, refresh, onChange, setSession };
  select<T>(table, q: Query): Promise<T[]>;           // Query = filters/order/range (subset of PostgREST)
  insert(table, rows, opts:{ignoreDuplicates?:boolean}): Promise<void>;
  upsert(table, rows): Promise<void>;
  rpc<T>(name, args): Promise<T>;
  storage: { upload(path, bytes, mime, onProgress?): Promise<void>; signedUrls(paths, ttl): Promise<Record<string,string>> };
  realtime?: { subscribe(org, tables, onChange): Unsub };   // lazy
}
```

- `SupabaseBackend` maps errors into a normalized `BackendError {code, http, message, retryable}`.
- `MemoryBackend` (`?backend=memory` or demo):
  - Server state is persisted in `localStorage['lp-mock-server']`, so it **survives page
    reloads**, as a real server would.
  - It implements the RPCs we use (bootstrap, create_org, invites, seed, reorder,
    set_status, share links) and a **mini RLS** (role filters mirroring §3.4) so role screens
    behave realistically.
  - Uploads store bytes in a separate IDB database.
  - Fault injection on `window.__lpMock`: `{offline:boolean, latencyMs, failNext(n, code), uploadFailAfterBytes}`.
    It also honours `navigator.onLine` and Playwright's `context.setOffline(true)`, because
    `fetch` is never used, so it checks `navigator.onLine` explicitly.
- e2e runs `vite preview` on the production build with `VITE_E2E=1`, which enables
  `?backend=memory`. The `?demo=1` flag works in production too, but it is read-only-seeded
  and visibly labelled.

### 9.2 Vitest units (`npm test`)

| Area | Tests |
|---|---|
| outbox | enqueue is atomic with the record write; coalescing replaces pending payloads but not inflight ones; dependency ordering (upload waits for the row, submit waits for uploads); unrelated ops not blocked by backoff; backoff schedule with fake timers and jitter bounds; classify() matrix (every row of §4.2); 23505 counts as success; dead-op lifecycle; inflight reset on boot; per-user isolation; ping batching; SOS priority |
| compression | output long edge ≤ 1600; JPEG mime; EXIF stripped (no `Exif` APP1 marker); orientation-6 fixture comes out portrait; thumb ≤ 320. Uses jsdom with a `canvas` polyfill (`@napi-rs/canvas`) behind an injectable `ImageCodec`. The real-browser path is covered in e2e. |
| PIN vault | correct PIN unlocks and wrong PIN fails; constant-time compare; lockout ladder with persisted `lockedUntil`; wipe after 10; re-wrap on token refresh; two guards isolated; iterations configurable (low in tests) |
| auth storage | localStorage loss is restored from the IDB mirror; offline cold start keeps the identity |
| domain/tour | in-order, out-of-order, duplicate, late (run elapsed > max), off-site (distance > radius + accuracy), no GPS, run completion |
| validation | required fields per category config; police case # required when police called |
| notify | recipients ⊆ notify_emails; client flag off ⇒ throws if any non-owner email; payload shape matches the legacy param names |
| pdf | `buildIncidentPdf(sample)` → `PDFDocument.load` round-trip: page count ≥ 2 with 6 photos, contains text objects (title, report no), embedded image count = photos + logo, file > 20 KB; text wrapping; WinAnsi sanitizer; QR sheet module count matches the uqr matrix |
| sanitize | post-orders HTML allowlist strips `script`, `on*`, and `javascript:` |
| categories seed | TS seed ≡ generated SQL |
| db migrations | v1 schema created; upgrade path test template |

### 9.3 Playwright (`npm run test:e2e`)

`playwright.config.ts` projects:
- **`webkit-iphone13`** (primary): `devices['iPhone 13']` (390×844, DPR 3, touch, iOS UA),
  `colorScheme: 'dark'`, `permissions: ['geolocation']`, `geolocation: Kent, WA`.
- **`chromium-pixel7`**: `devices['Pixel 7']`, the same settings, plus camera permission flags
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` (used for one real camera-scan test).
- `webServer: npm run build:e2e && npm run preview -- --port 4173`.
- `baseURL: http://localhost:4173/Lion-Patrol/`. Retries: 1 in CI, 0 locally. Traces on
  first retry. Workers: 2.

Specs (each starts from a fresh context, and the mock server is seeded via `addInitScript`):
1. `auth.spec` — login → reload → still logged in on the home screen; offline reload →
   cached home renders (no login screen); sign out → login.
2. `pin.spec` — remember device + set PIN → lock → unlock; wrong PIN ×5 → lockout timer;
   two guards on one device switch without mixing outboxes.
3. `clock-in.spec` — first clock-in shows the GPS notice sheet; "Not now" → still off duty;
   Accept → on duty with the timer; the consent row exists in the mock server with a
   timestamp; clock-out with note → watch stopped (spy on `navigator.geolocation.clearWatch`
   via init script).
4. `scan.spec` — manual code entry: valid code → ✓ toast and 1/3 progress; scanning the 3rd
   before the 2nd → "Out of order" flag; invalid code → error; scanning via the `/q/:code`
   route in standalone (emulated `navigator.standalone`).
5. `offline-sync.spec` — `context.setOffline(true)` → create an incident with 2 photos
   (`setInputFiles` fixtures) and a DAR entry → pill shows "Offline" then "3 pending" →
   `setOffline(false)` → the pill reaches "Synced" → the mock server has the incident
   (`submitted`), 2 attachments `uploaded`, and the stored objects' bytes are JPEG.
6. `kill-resume.spec` — fill half an incident with a photo → `page.reload()` (and a second
   variant that closes the page and opens a new page in the same context) → the "Continue
   report" card → all fields and the photo thumb restored → submit → syncs.
7. `upload-retry.spec` — `__lpMock.failNext(2, 503)` on upload → retries with backoff (fast
   timers via `?fastBackoff=1`) → synced; `failNext(1, 400)` → dead → the Sync sheet shows
   the error → Retry after clearing → synced.
8. `categories.spec` — admin adds a category with a subtype and required field "vehicles",
   renames it, drags to reorder (pointer drag on the handle; asserts order persists after
   reload), hides one (it disappears from the guard grid in Guard mode), restores defaults
   (only missing ones are added).
9. `incident-required.spec` — a category requiring police → submitting without a case # shows
   an inline error and scrolls to it.
10. `sos.spec` — a short press does nothing; a 2 s hold → red screen; offline shows "Will send
    when online" and a `tel:911` link; back online → alert row plus an email op sent (EmailJS
    intercepted with `page.route('https://api.emailjs.com/**')`, asserting `to_email`
    contains only owner emails).
11. `pdf.spec` — admin opens an incident → Generate PDF → intercept the `File` via an
    init-script stub of `navigator.share`/`canShare` → bytes start with `%PDF-`, are over
    20 KB, and `pdf-lib` in the Node test process loads it: page count ≥ 1, images ≥ 2. Same
    for the DAR and the QR sheet.
12. `client.spec` — the client sees only their site's client-visible reports; a direct URL to
    another site's report shows "Not found".
13. `share-link.spec` — create a link → open `/s/:token` in a fresh context (anon) → report
    renders; an expired link shows the expired state.
14. `a2hs.spec` — in non-standalone WebKit, `/install` is shown on first visit with the
    separate-storage explanation.
15. `bundle.spec` (node) — runs `check-bundle.mjs` against `dist/`.

### 9.4 Artifacts (gitignored `artifacts/`)

- `scripts/screens.mjs` (`npm run screens`):
  - Launches WebKit iPhone 13 in dark mode against `vite preview` with `?demo=1`.
  - Walks a route list (login, lock, install, guard home off and on duty, clock notice, patrol,
    scan manual, incident form (top, middle, attachments), DAR sheet, activity, SOS, more,
    post orders, sync sheet; admin live map with a tile stub, feed, incidents, incident
    detail, sites, site checkpoints, QR sheet, schedule week, people, invite sheet, settings,
    category manager, category edit sheet; client overview and report).
  - Saves `artifacts/screens/{nn}-{role}-{screen}.png` at DPR 3.
- `scripts/pdfs.mjs` (`npm run pdfs`): builds a sample incident (with photos), DAR, and
  QR sheet from demo data using the same `src/pdf/*` modules through `vite-node`. Writes
  `artifacts/pdfs/*.pdf`.

### 9.5 RLS SQL test (`supabase/tests/rls_test.sql`)

Run with `psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql` (coordinator).

Structure:

```sql
begin;
-- 1. fixtures as postgres (bypasses RLS): fixed uuids
insert into auth.users (id, email, aud, role, instance_id, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-0000000000a1','rls-owner-a@test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}','{}',now(),now()),
       … guard-a1, guard-a2, client-a (site A1 only), supervisor-a, owner-b, guard-b, outsider;
insert into public.app_admins (user_id, email) values (owner-a uuid, …);   -- rolled back with everything
-- orgs A, B; sites A1, A2, B1; site_access; checkpoints; categories
-- records: guard-a1 draft incident @A1, guard-a1 submitted incident @A1 (client_visible=true),
--          guard-a2 submitted incident @A2 (client_visible=false), guard-b submitted @B1,
--          scans, dar+entries, attachments rows, alert, pings, invites

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', …)::text, true);
end $$;
create or replace function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'RLS FAIL: %', msg; end if; end $$;
```

Assertions. Each one runs `select pg_temp.as_user(…)`, then asserts with
`pg_temp.expect((select count(*) from …) = n, '…')`, then calls `reset role`:

- **guard-a1**:
  - sees only sites A1 (assigned), not A2 or B1
  - sees checkpoints of A1 only
  - sees own draft and own submitted incident
  - does **not** see guard-a2's incident
  - sees zero rows in patrol_location_pings and in org B tables
  - cannot read patrol_org_settings
  - cannot insert an incident for org B (expect `42501` via a `begin … exception when insufficient_privilege` block)
  - cannot insert with `member_id` = guard-a2
  - cannot update own submitted incident content (trigger exception)
  - can cancel own alert via RPC
  - cannot read another guard's draft **even with an explicit id filter**
- **guard-a2**: cannot read guard-a1's draft, its attachments, or its storage object row
  (`select from storage.objects where name = …` after inserting the object metadata as postgres).
- **client-a**:
  - sees site A1 only
  - sees the client-visible incident at A1 only (not the draft, not A2's)
  - sees A1 scans
  - sees no pings, no time entries, no alerts, no members other than self, no org settings
  - every insert, update and delete fails or affects 0 rows
- **supervisor-a**: sees all submitted incidents in org A but **not** drafts, and none of
  org B; can call `patrol_set_incident_status`; cannot create invites.
- **owner-b**: sees nothing of org A.
- **outsider** (no membership): zero rows in every patrol table; `patrol_create_org` raises
  `not_app_admin`; redeeming a bad code returns `invalid_invite`; the 11th attempt returns
  `too_many_attempts`.
- **owner-a**:
  - `patrol_create_org` works (is_admin) and seeds about 24 categories
  - creates an invite, which outsider redeems → becomes a guard with site A1
  - an `owner` invite is rejected
- **anon**: `set local role anon`; `patrol_get_shared_report` with a valid token returns the
  report without `review_notes`, and with a bad token returns null; direct table selects
  return 0 rows or permission denied.
- **disabled member**: after `status='disabled'`, guard-a1 sees nothing.

The script ends with `rollback;`, and `raise notice 'RLS: all N assertions passed'` runs just
before it. Because everything, including the `auth.users` and `app_admins` inserts, happens
inside one transaction that rolls back, it leaves zero data behind.

### 9.6 CI (`.github/workflows/pages.yml`)

- Triggers: `push` to `main` and `feature/lion-patrol-v2`, plus `workflow_dispatch`.
- Jobs: `npm ci` → `npm run typecheck` → `npm test` → `npm run build` →
  `node scripts/check-bundle.mjs` → `npx playwright install --with-deps webkit chromium` →
  `npm run test:e2e` → upload `playwright-report` on failure → upload the Pages artifact
  `dist/` → deploy.
- **Pages caveat:** GitHub Pages serves one site per repo. Both branches deploy to the same
  URL, and the last push wins. That matches the brief ("preview deploy"), but the workflow uses
  `concurrency: pages` so deploys never interleave. The legacy app stays at
  `/Lion-Patrol/legacy/`.

---

## 10. Build order (consolidated by the coordinator into 5 build passes)

Each pass ends green (`typecheck`, `test`, `test:sql`, `build`, `check:bundle`, relevant e2e on
**WebKit iPhone 13 first**, then Chromium), is committed in logical chunks, and is pushed.

1. **Pass 2 — Scaffold, SQL, data layer, auth** ✅
   - Vite/Preact/TS, tokens and UI kit, icons/splash from `logo.png`, manifest, SW, iOS meta, A2HS guide, `public/legacy/`, `404.html`, Pages workflow, bundle check.
   - All migrations plus `rls_test.sql`, verified locally in PGlite (`npm run test:sql`) against a Supabase shim: migrations applied twice, mutation-checked.
   - IDB, Backend interface, SupabaseBackend, MemoryBackend with the demo seed, outbox, sync status, bootstrap.
   - Durable session, offline cold start, login/signup/join/setup, role routing (owners get Admin + Guard mode), PIN vault, lock screen, multi-guard switching, demo mode.
2. **Pass 3 — Guard core.** Clock in/out (GPS notice and consent, watch and pings), Home hero, DAR quick log, patrol tours and QR (manual entry plus lazy camera scanner, `/q/:code`), the incident form with categories and required fields, the media pipeline (compress, blobs, tray, upload, TUS), voice notes with the audio notice, SOS and owner EmailJS notification, the Activity timeline. e2e: clock-in notice, QR manual, offline sync with media, kill/reload mid-report, upload retry, SOS.
3. **Pass 4 — Admin.** Sites (map pin, post-orders editor, contacts, access), checkpoints and the QR sheet PDF, people and invites, schedule week and list, settings with the storage meter, the category manager (add/edit/drag reorder/hide/subtypes/required fields). e2e: categories.
4. **Pass 5 — Dashboard, review, PDFs, client portal.** Live map (Leaflet lazy, realtime), feed with filters, patrol completion, incident and DAR review, alerts; incident and DAR PDFs with share-sheet delivery; client portal and share links `/s/:token`. e2e: pdf, client, share link. `scripts/pdfs.mjs`.
5. **Pass 6 — Polish and hardening.** Screenshots of every screen (`npm run screens`), transitions and skeletons audit, accessibility, performance and budget, iPhone checklist, owner README.

### Pass 2 implementation notes (decisions refined while building)
- **Trigger guards and RPCs.** Column/transition guards act only when `current_user = 'authenticated'` (direct PostgREST writes). SECURITY DEFINER RPCs run as the owner, so their writes pass. Guards that look up parents for authorization (`patrol_attachment_before_insert`, `patrol_dar_entries_guard`) are **invoker-rights**, so the lookup itself goes through RLS.
- **Staff review changes go only through RPCs** (`patrol_set_incident_status`, `patrol_set_incident_client_visible`, `patrol_add_incident_note`, `patrol_set_dar_status`). The direct UPDATE policy on incidents and DARs is author-only. A stale author replay after submit is a silent no-op (`client_rev`), so outbox resends never go dead.
- **Own-row SELECT on append-only tables.** Guards can SELECT their own pings, because `INSERT … ON CONFLICT DO NOTHING` (idempotent outbox replays) must see the conflicting row through RLS.
- **`patrol_bootstrap` is SECURITY INVOKER**, so RLS does the filtering. Owner emails come back only to staff (`settings`). Everyone gets `public_settings`.
- **PIN unlock is required at cold start** once a user has enrolled on the device. The vault key must be in memory so rotated refresh tokens are re-wrapped on every `TOKEN_REFRESHED`; otherwise a stale stored refresh token could trip reuse detection. Switching guards writes the stored session into auth storage (`auth.adopt`), which works offline.
- **Per-backend isolation.** IndexedDB and auth keys are namespaced: `lion-patrol`/`lp-auth` (real), `lion-patrol-demo`/`lp-auth-demo`, `lion-patrol-mem`/`lp-auth-mem` (e2e). Demo mode is shown as a thin gold stripe at the very top, clear of the Dynamic Island, plus labels on Login and More.
- **Service worker in e2e builds.** The SW is enabled in e2e builds so the offline cold-start test is real (precache under `vite preview`).

## Appendix A — Decisions made without asking

1. **Supabase client is split into parts** (auth, postgrest and storage now; realtime lazy)
   instead of the full `supabase-js`, to protect the 120 KB budget.
2. **idb, not Dexie**, for the same budget reason.
3. **Preact 10.29, not 11**, because the ecosystem is proven on 10.x.
4. **Email + password sign-in.** Magic links break the separate PWA storage container and
   Free SMTP limits make email OTP unreliable. "Confirm email" should be off, or custom SMTP
   set up.
5. **Drafts sync to the server** (`status='draft'`, author-only RLS), so a dead phone never
   loses a report. Staff see a report only once it is submitted.
6. **Submitted reports are immutable.** Corrections are addenda and staff change only review
   fields. This gives a defensible legal record.
7. **Client visibility is explicit** (`client_visible`, set by "Send to client", or
   automatically if the org enables `auto_share_with_client`, default off). Clients can see
   patrol scans for their sites (proof of service) but never GPS pings, time entries, alerts or
   other guards' details.
8. **Supervisors are org-wide** for viewing and review, and manage schedules. They cannot
   manage members, invites, categories or org settings.
9. **Owner emails are in `patrol_org_settings`**, which is staff-only, so guards and clients
   never see them. `author_name` is snapshotted onto records, so clients never read
   `patrol_members`.
10. **Share links need no Edge Functions.** Asset URLs are signed by the staff member at
    creation time with the link's TTL (≤ 7 days) and returned by an anon RPC that requires the
    token. Trade-off: revoking a link stops the RPC immediately, but already-fetched signed
    URLs stay valid until expiry.
11. **QR payload is a URL** to `/q/<code>`, so the iOS Camera app degrades gracefully, with an
    8-char manual code printed under it.
12. **JPEG at 0.75, ≤ 1600 px.** WebP encoding in Safari is unreliable. Blobs are stored in IDB
    as ArrayBuffers.
13. **Realtime only for staff dashboards**, on `patrol_member_status`, `patrol_alerts`,
    `patrol_incidents`, `patrol_scans` and `patrol_dar_entries`. Guards never hold sockets.
14. **Path routing with a `404.html` fallback** on GitHub Pages, plus an SW navigation
    fallback offline.
15. **EmailJS over REST `fetch`**, not the SDK: zero bytes, same account and template.
16. **Standard PDF fonts.** Vector, zero bytes. Fontkit is an opt-in later.
17. **Free-tier hygiene:**
    - Ping retention of 30 days with a prune function.
    - Storage meter with warnings.
    - Share-link TTL of at most 7 days.
    - Thumbs cached locally to save egress.
    - Note: a Free project **pauses after about 7 days of inactivity**. Daily use avoids this.
      If it ever pauses, the offline outbox keeps all data until the coordinator resumes it.

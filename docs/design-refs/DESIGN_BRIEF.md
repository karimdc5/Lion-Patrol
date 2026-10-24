# Lion Patrol — Design Brief

Note: the Mobbin connector refused screen searches (it needs a paid Mobbin plan), so no
reference screenshots are stored here. This brief is written from established iOS
patterns used by top field-ops / security / safety apps (TrackTik, Silvertrac, Trackforce,
Guardso, Life360, Apple Health/Wallet/Find My). Copy patterns, never branding.

## Visual system
- Dark first. Background #0A0F1C (near-black navy), surface #111827, raised #1A2236,
  hairline borders rgba(255,255,255,0.08). Text #F5F7FA / secondary #9AA4B2.
- Brand accent: lion gold #D4A537 (pressed #B8891F). Use gold sparingly: primary CTA,
  active tab, key numbers. Semantic: success #22C55E, warning #F59E0B, danger #EF4444,
  info #3B82F6. Category colors are muted (60–70% saturation) so they read at night.
- Type: system stack (-apple-system, SF Pro). Large title 34/41 bold, title 22/28
  semibold, body 17/22, footnote 13/18. Tabular numbers for times and counts.
- 8pt grid. Screen side padding 16–20. Card radius 16, button radius 14, chip radius 999.
- Tap targets minimum 48pt, primary actions 56pt tall, full-width at thumb height.
- Honor env(safe-area-inset-*) on every fixed bar. No content under the home indicator.

## Navigation
- Guard: bottom tab bar (Home, Patrol, Report [center raised gold +], Activity, More).
  Tab bar is translucent blurred dark (backdrop-filter) with 1px top hairline.
- Admin/supervisor: same shell on phone; on >=900px a left sidebar + content.
- Screen changes are instant (no full reloads); push transitions 200ms slide, modal
  sheets slide up with a grabber and swipe-down to dismiss.

## Key screens (layout patterns)
1. Shift start / clock-in: big status hero ("Off duty" grey ring → "On duty 02:14:33"
   green ring with live timer). Site picker as a card list with address + distance.
   One giant "Clock in" slide-to-confirm or 56pt button. GPS notice appears as a
   bottom sheet the first time (accept / not now). Clock-out asks for a short shift note.
2. Home / dashboard (guard): top hero card = current shift + site + sync pill
   (green "Synced", amber "3 pending", grey "Offline"). Below: next checkpoint card with
   progress ring (4/9), quick actions row (Scan, DAR note, Incident, Post orders), then a
   recent activity list. Pull-to-refresh.
3. Incident form: step flow in one scroll — category grid (2 columns of large colored
   tiles with icon + name, search field pinned on top) → subtype chips → details
   (when, where, description with mic dictation button) → people/vehicles as addable
   cards → police called toggle with report # field → attachments tray (horizontal
   thumbnails with +, progress rings on upload) → sticky bottom "Submit report" bar.
   Required fields marked, inline validation, autosave indicator ("Saved · 2s ago").
4. QR scanner: full-bleed camera, dimmed overlay with rounded square cutout and animated
   corner brackets, torch toggle top-right, "Enter code manually" link, success = haptic
   (navigator.vibrate where available) + green check burst + checkpoint name toast.
5. Activity log / timeline: vertical timeline grouped by day with sticky day headers,
   colored category dot, time on the left (tabular), title + one-line preview, media
   thumbnails inline, sync status icon per item. Filter chips row at top (site, guard,
   category, date) that opens sheets.
6. Live map (supervisor): map fills top 55%, draggable bottom sheet listing on-shift
   guards (avatar initials, site, last ping "2m ago", patrol % pill). Tapping a guard
   centers the map. Use Leaflet + OSM/Carto dark tiles (free, no key).
7. Settings / category management: grouped inset list (iOS settings style), each row
   has drag handle, color dot, icon, name, subtype count, eye toggle for hide. Editing
   opens a sheet with name, color swatches, icon grid, subtypes list, required-field
   toggles.
8. SOS: dedicated red button on Home and in the tab bar long-press; press-and-hold 2s
   with a filling ring to send (prevents pocket taps), then a full red screen
   "Alert sent to owners" with location, time, cancel ("I'm safe") and call 911 button
   (tel: link). Works offline by queuing and showing "Will send when online" plus the
   tel: fallback.

## Motion and feel
- Skeleton loaders (shimmer on #1A2236) instead of spinners for lists.
- Optimistic UI everywhere: items appear instantly with a pending clock icon.
- No layout shift: reserve image aspect boxes, fixed heights for bars.
- Respect prefers-reduced-motion.

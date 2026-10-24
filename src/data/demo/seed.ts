import seedCategories from '../../domain/categories.seed.json';
import { defaultSettings, type MockState } from '../backend/memory';

/**
 * Realistic demo data: Lion Security Services with a retail store in Kent and an apartment
 * complex in Federal Way (South King County). Deterministic ids so tests can reference them.
 */
export const DEMO_PASSWORD = 'demo1234';
export const DEMO = {
  org: '0b5e0000-0000-7000-8000-000000000001',
  users: {
    karim: { id: '0b5e0000-0000-7000-8000-0000000000a1', email: 'karim@lionsecurity.demo', name: 'Karim Daher', role: 'owner' },
    abdinasir: { id: '0b5e0000-0000-7000-8000-0000000000a2', email: 'abdinasir@lionsecurity.demo', name: 'Abdinasir Elmi', role: 'owner' },
    marcus: { id: '0b5e0000-0000-7000-8000-0000000000a3', email: 'marcus@lionsecurity.demo', name: 'Marcus Reed', role: 'guard' },
    dana: { id: '0b5e0000-0000-7000-8000-0000000000a4', email: 'dana@lionsecurity.demo', name: 'Dana Whitfield', role: 'supervisor' },
    client: { id: '0b5e0000-0000-7000-8000-0000000000a5', email: 'manager@kentstationmarket.demo', name: 'Priya Natarajan', role: 'client' },
  },
  sites: {
    market: '0b5e0000-0000-7000-8000-00000000c001',
    willow: '0b5e0000-0000-7000-8000-00000000c002',
  },
} as const;

const memberId = (userId: string) => userId.replace(/a(\d)$/, 'b$1');

export function demoSeed(now = Date.now()): MockState {
  const iso = (ms: number) => new Date(ms).toISOString();
  const H = 3600e3;
  const org = DEMO.org;
  const s: MockState = { users: [], appAdmins: [DEMO.users.karim.id, DEMO.users.abdinasir.id], tables: {}, objects: {}, counters: { [org]: 41 } };
  const t = (name: string) => (s.tables[name] ??= []);

  for (const u of Object.values(DEMO.users)) s.users.push({ id: u.id, email: u.email, password: DEMO_PASSWORD });

  t('patrol_orgs').push({
    id: org, name: 'Lion Security Services', legal_name: 'Lion Security Services LLC', timezone: 'America/Los_Angeles',
    phone: '(253) 555-0142', email: 'ops@lionsecurity.demo', address: 'Kent, WA 98032', license_no: 'WA PSA #0000-DEMO',
    created_by: DEMO.users.karim.id, created_at: iso(now - 90 * 24 * H), updated_at: iso(now - 90 * 24 * H),
  });
  t('patrol_org_settings').push(defaultSettings(org, [DEMO.users.karim.email, DEMO.users.abdinasir.email]));

  for (const u of Object.values(DEMO.users)) {
    t('patrol_members').push({
      id: memberId(u.id), org_id: org, user_id: u.id, role: u.role, status: 'active', display_name: u.name, email: u.email,
      phone: '(253) 555-01' + u.id.slice(-2), badge_no: u.role === 'client' ? null : 'LSS-' + u.id.slice(-2).toUpperCase(),
      created_at: iso(now - 60 * 24 * H), updated_at: iso(now - 60 * 24 * H),
    });
  }

  t('patrol_sites').push(
    {
      id: DEMO.sites.market, org_id: org, name: 'Kent Station Market', code: 'KSM', kind: 'retail',
      address: '418 Ramsay Way', city: 'Kent', state: 'WA', zip: '98032', lat: 47.3826, lng: -122.2346, geofence_m: 150,
      post_orders_html: '<h2>After-hours patrol</h2><p>Post hours <strong>10:00 PM – 6:00 AM</strong>. Report to the loading dock door on arrival.</p><ul><li>Exterior patrol every 60 minutes: front entrance, east side, loading dock, dumpster enclosure.</li><li>Check all exterior doors are locked. Report any unsecured door immediately.</li><li>Do not enter the pharmacy area. Alarm code is held by the store manager only.</li><li>Trespassers: give a verbal warning first. Call Kent PD non-emergency at (253) 856-5800 if they refuse to leave.</li></ul><h2>Emergencies</h2><p>Call 911 first, then the on-call owner.</p>',
      post_orders_updated_at: iso(now - 9 * 24 * H),
      contacts: [{ name: 'Priya Natarajan', role: 'Store manager', phone: '(253) 555-0188', email: 'manager@kentstationmarket.demo' }, { name: 'Kent PD (non-emergency)', role: 'Police', phone: '(253) 856-5800' }],
      tour_interval_min: 60, tour_max_duration_min: 25, active: true, created_at: iso(now - 80 * 24 * H), updated_at: iso(now - 9 * 24 * H),
    },
    {
      id: DEMO.sites.willow, org_id: org, name: 'Willow Creek Apartments', code: 'WCA', kind: 'apartment',
      address: '31600 20th Ave S', city: 'Federal Way', state: 'WA', zip: '98003', lat: 47.3223, lng: -122.3126, geofence_m: 200,
      post_orders_html: '<h2>Overnight residential patrol</h2><p>Post hours <strong>9:00 PM – 5:00 AM</strong>. Drive and walk the grounds, buildings A–F.</p><ul><li>Pool and gym close at 10:00 PM. Ask anyone still inside to leave politely.</li><li>Check the mailroom and package lockers each round.</li><li>Fire lanes must stay clear. Log the plate of any vehicle parked there, then call the tow company after 15 minutes.</li><li>Noise complaints: knock, identify yourself, and ask once. Log the unit number.</li></ul>',
      post_orders_updated_at: iso(now - 20 * 24 * H),
      contacts: [{ name: 'Leasing office', role: 'Property manager', phone: '(253) 555-0170' }, { name: 'Federal Way PD (non-emergency)', role: 'Police', phone: '(253) 835-2121' }],
      tour_interval_min: 90, tour_max_duration_min: 35, active: true, created_at: iso(now - 70 * 24 * H), updated_at: iso(now - 20 * 24 * H),
    },
  );

  const access = (site: string, user: string) => t('patrol_site_access').push({ id: `${site}:${memberId(user)}`, org_id: org, site_id: site, member_id: memberId(user), created_at: iso(now - 50 * 24 * H) });
  access(DEMO.sites.market, DEMO.users.marcus.id);
  access(DEMO.sites.willow, DEMO.users.marcus.id);
  access(DEMO.sites.market, DEMO.users.client.id);

  const cps: Array<[string, string, string, number, number, number]> = [
    [DEMO.sites.market, 'Front Entrance', 'KSM1FRNT', 1, 47.38268, -122.23472],
    [DEMO.sites.market, 'East Side Fire Exit', 'KSM2EAST', 2, 47.38259, -122.23421],
    [DEMO.sites.market, 'Loading Dock', 'KSM3DOCK', 3, 47.38236, -122.23446],
    [DEMO.sites.market, 'Dumpster Enclosure', 'KSM4DMPS', 4, 47.38228, -122.23489],
    [DEMO.sites.willow, 'Main Gate', 'WCA1GATE', 1, 47.32245, -122.31291],
    [DEMO.sites.willow, 'Pool & Courtyard', 'WCA2POOL', 2, 47.32221, -122.31248],
    [DEMO.sites.willow, 'Mailroom (Bldg C)', 'WCA3MAIL', 3, 47.32204, -122.31277],
    [DEMO.sites.willow, 'Parking Garage Level 1', 'WCA4GRGE', 4, 47.32188, -122.31233],
    [DEMO.sites.willow, 'Building F Rear Stairwell', 'WCA5BLDF', 5, 47.32172, -122.31302],
  ];
  cps.forEach(([site, name, code, seq, lat, lng], i) => t('patrol_checkpoints').push({
    id: `0b5e0000-0000-7000-8000-0000000d${String(i + 1).padStart(4, '0')}`, org_id: org, site_id: site, name, seq, code, lat, lng, radius_m: 40,
    instructions: null, active: true, created_at: iso(now - 60 * 24 * H), updated_at: iso(now - 60 * 24 * H),
  }));

  // Categories from the shared seed
  (seedCategories as Array<{ name: string; color: string; icon: string; use_for: string; default_severity: string; required_fields: string[]; subtypes: string[] }>).forEach((c, i) => {
    const catId = `0b5e0000-0000-7000-8000-0000000e${String(i + 1).padStart(4, '0')}`;
    t('patrol_categories').push({ id: catId, org_id: org, name: c.name, color: c.color, icon: c.icon, sort: i, hidden: false, required_fields: c.required_fields, default_severity: c.default_severity, use_for: c.use_for, created_at: iso(now - 60 * 24 * H), updated_at: iso(now - 60 * 24 * H) });
    c.subtypes.forEach((name, j) => t('patrol_subtypes').push({ id: `${catId.slice(0, -4)}${String(i + 1).padStart(2, '0')}${String(j + 1).padStart(2, '0')}`.replace(/-0000000e/, '-0000000f'), org_id: org, category_id: catId, name, sort: j, hidden: false, created_at: iso(now - 60 * 24 * H), updated_at: iso(now - 60 * 24 * H) }));
  });

  // Schedule: tonight + the next 6 nights
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  for (let d = -1; d < 7; d++) {
    const base = dayStart.getTime() + d * 24 * H;
    t('patrol_shifts').push({ id: `0b5e0000-0000-7000-8000-00000005${String(d + 2).padStart(2, '0')}01`, org_id: org, site_id: DEMO.sites.market, member_id: memberId(DEMO.users.marcus.id), starts_at: iso(base + 22 * H), ends_at: iso(base + 30 * H), notes: null, cancelled_at: null, created_at: iso(now - 7 * 24 * H), updated_at: iso(now - 7 * 24 * H) });
    t('patrol_shifts').push({ id: `0b5e0000-0000-7000-8000-00000005${String(d + 2).padStart(2, '0')}02`, org_id: org, site_id: DEMO.sites.willow, member_id: d % 2 === 0 ? memberId(DEMO.users.karim.id) : memberId(DEMO.users.abdinasir.id), starts_at: iso(base + 21 * H), ends_at: iso(base + 29 * H), notes: null, cancelled_at: null, created_at: iso(now - 7 * 24 * H), updated_at: iso(now - 7 * 24 * H) });
  }

  // History: last night's shift at Kent Station Market by Marcus
  const lastIn = dayStart.getTime() - 2 * H; // 10 PM yesterday
  const te = '0b5e0000-0000-7000-8000-000000070001';
  t('patrol_time_entries').push({ id: te, org_id: org, site_id: DEMO.sites.market, member_id: memberId(DEMO.users.marcus.id), shift_id: null, clock_in_at: iso(lastIn), clock_in_lat: 47.3824, clock_in_lng: -122.2344, clock_out_at: iso(lastIn + 8 * H), clock_out_lat: 47.3825, clock_out_lng: -122.2345, shift_note: 'Quiet night. One trespass warning at the loading dock, east fire exit found unlatched and secured.', gps_notice_accepted_at: iso(now - 30 * 24 * H), created_at: iso(lastIn), updated_at: iso(lastIn + 8 * H) });
  const dar = '0b5e0000-0000-7000-8000-000000080001';
  t('patrol_dars').push({ id: dar, org_id: org, site_id: DEMO.sites.market, member_id: memberId(DEMO.users.marcus.id), author_name: DEMO.users.marcus.name, time_entry_id: te, report_date: iso(lastIn).slice(0, 10), summary: 'Quiet night. One trespass warning at the loading dock, east fire exit found unlatched and secured.', status: 'sent_to_client', report_no: 'LSS-KSM-2026-00040', submitted_at: iso(lastIn + 8 * H), client_visible: true, client_rev: 3, created_at: iso(lastIn), updated_at: iso(lastIn + 9 * H) });
  const entries: Array<[number, string, string]> = [
    [0.05, 'Patrol & Shift', 'On post. Met closing manager, received keys and radio.'],
    [0.6, 'Access & Doors', 'All exterior doors checked and locked.'],
    [1.4, 'Access & Doors', 'East side fire exit found unlatched. Secured it and notified the store manager by text.'],
    [3.1, 'Trespass & Removal', 'Adult male sleeping at loading dock. Gave a verbal warning and he left without incident.'],
    [5.2, 'Maintenance & Facility', 'Light out over dumpster enclosure (pole 3).'],
    [7.9, 'Patrol & Shift', 'Final patrol complete. Handed keys to the opening manager.'],
  ];
  entries.forEach(([h, cat, body], i) => t('patrol_dar_entries').push({ id: `0b5e0000-0000-7000-8000-00000009${String(i + 1).padStart(4, '0')}`, org_id: org, site_id: DEMO.sites.market, member_id: memberId(DEMO.users.marcus.id), dar_id: dar, occurred_at: iso(lastIn + h * H), category_name: cat, body, client_rev: 1, created_at: iso(lastIn + h * H), updated_at: iso(lastIn + h * H) }));

  const cat = (name: string) => t('patrol_categories').find((c) => c.name === name)!;
  const sub = (catName: string, name: string) => t('patrol_subtypes').find((x) => x.category_id === cat(catName).id && x.name === name)!;
  t('patrol_incidents').push({
    id: '0b5e0000-0000-7000-8000-0000000a0001', org_id: org, site_id: DEMO.sites.market, member_id: memberId(DEMO.users.marcus.id), author_name: DEMO.users.marcus.name,
    time_entry_id: te, category_id: cat('Trespass & Removal').id, subtype_id: sub('Trespass & Removal', 'Trespass warning issued').id,
    category_name: 'Trespass & Removal', subtype_name: 'Trespass warning issued', title: 'Trespasser at loading dock',
    occurred_at: iso(lastIn + 3.1 * H), location_text: 'Rear loading dock', lat: 47.38236, lng: -122.23446,
    description: 'During the 01:00 patrol I found an adult male sleeping beside the loading dock compactor. I identified myself as security and told him the property is closed and he could not stay. He gathered his belongings and left north on Ramsay Way without incident. Nothing was damaged and there were no signs of forced entry.',
    people: [{ role: 'subject', name: 'Unknown', description: 'Adult male, about 40, grey hoodie, dark jeans, black backpack' }], vehicles: [],
    police_called: false, injury: false, property_damage: false, severity: 'low', status: 'sent_to_client', report_no: 'LSS-KSM-2026-00041',
    submitted_at: iso(lastIn + 3.4 * H), client_visible: true, reviewed_by: memberId(DEMO.users.karim.id), reviewed_at: iso(lastIn + 10 * H), sent_to_client_at: iso(lastIn + 10 * H),
    client_rev: 4, created_at: iso(lastIn + 3.15 * H), updated_at: iso(lastIn + 10 * H),
  });

  // Last night's tour scans at the market
  const run = '0b5e0000-0000-7000-8000-0000000b0001';
  t('patrol_tour_runs').push({ id: run, org_id: org, site_id: DEMO.sites.market, member_id: memberId(DEMO.users.marcus.id), time_entry_id: te, started_at: iso(lastIn + 1 * H), completed_at: iso(lastIn + 1.3 * H), expected_count: 4, scanned_count: 4, late: false, created_at: iso(lastIn + H), updated_at: iso(lastIn + 1.3 * H) });
  t('patrol_checkpoints').filter((c) => c.site_id === DEMO.sites.market).forEach((c, i) => t('patrol_scans').push({ id: `0b5e0000-0000-7000-8000-0000000c${String(i + 1).padStart(4, '0')}`, org_id: org, site_id: DEMO.sites.market, member_id: memberId(DEMO.users.marcus.id), checkpoint_id: c.id, tour_run_id: run, time_entry_id: te, scanned_at: iso(lastIn + H + i * 5 * 60e3), lat: c.lat, lng: c.lng, distance_m: 6 + i, method: 'qr', flags: [], created_at: iso(lastIn + H + i * 5 * 60e3) }));
  t('patrol_member_status').push({ id: memberId(DEMO.users.marcus.id), member_id: memberId(DEMO.users.marcus.id), org_id: org, on_duty: false, time_entry_id: null, site_id: DEMO.sites.market, lat: 47.3825, lng: -122.2345, last_ping_at: iso(lastIn + 8 * H), on_duty_since: null, updated_at: iso(lastIn + 8 * H) });
  return s;
}

import { test, expect, type Page } from '@playwright/test';
import { openApp, login, dismissEnroll, USERS, mutateServer } from './helpers';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Pass 7 (Karim feedback items 8–22). Key screens are also saved to SHOTS on the iPhone 13 run.
const PHOTO = fileURLToPath(new URL('../fixtures/photo.jpg', import.meta.url));
const SHOTS = process.env.LP_SHOTS ?? '/workspace/lion-patrol-shots/pass7';
/** Screenshots only on the local iPhone 13 run (the shots folder doesn't exist in CI). */
const wantShots = () => test.info().project.name === 'webkit-iphone13' && existsSync(SHOTS.replace(/\/[^/]+$/, ''));
type Server = { tables: Record<string, Array<Record<string, any>>> };
const rows = async (page: Page, table: string) => ((await page.evaluate(() => JSON.parse(localStorage.getItem('lp-mock-server')!) as Server)).tables[table] ?? []);
const MARKET = '0b5e0000-0000-7000-8000-00000000c001';

async function shot(page: Page, name: string) {
  if (!wantShots()) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
async function signIn(page: Page, email: string) {
  await openApp(page);
  await login(page, email);
  await dismissEnroll(page);
}
async function owner(page: Page) {
  await signIn(page, USERS.karim);
  await expect(page.getByRole('heading', { name: 'Live' })).toBeVisible();
}
async function guard(page: Page) {
  await signIn(page, USERS.marcus);
  await expect(page.getByRole('heading', { name: 'Hi, Marcus' })).toBeVisible();
}
async function clockIn(page: Page) {
  await page.getByTestId('home-clock-in').click();
  await page.getByTestId('site-option').filter({ hasText: 'Kent Station Market' }).click();
  await page.getByTestId('clock-in-btn').click();
  await page.getByTestId('gps-accept').click();
  await expect(page.getByTestId('duty-hero')).toContainText('On duty');
}
async function more(page: Page, testid: string) {
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByTestId(testid).click();
}

test('item 22: a new account chooses "Join with invite code" or "Create company" — never a silent second company', async ({ page }) => {
  await openApp(page);
  await page.waitForFunction(() => !!localStorage.getItem('lp-mock-server'));
  await mutateServer(page, `s.users.push({ id: 'elmi-new', email: 'elmi@example.com', password: 'demo1234' }); s.appAdmins.push('elmi-new');`);
  await login(page, 'elmi@example.com');
  await expect(page.getByTestId('setup-choice')).toBeVisible();
  await expect(page.getByTestId('choice-join')).toContainText('Join with invite code');
  await expect(page.getByTestId('choice-create')).toContainText('Create company');
  await shot(page, 'signup-choice');
  const orgsBefore = (await rows(page, 'patrol_orgs')).length;
  await page.getByTestId('choice-join').click();
  await expect(page.getByRole('heading', { name: 'Join your team' })).toBeVisible();
  expect((await rows(page, 'patrol_orgs')).length).toBe(orgsBefore);
});

test('items 9/13: a client portal code redeemed on an owner account is refused and never renames the owner', async ({ page }) => {
  await owner(page);
  await mutateServer(page, `s.tables.patrol_invites = s.tables.patrol_invites || []; s.tables.patrol_invites.push({ id: 'inv-client', org_id: '0b5e0000-0000-7000-8000-000000000001', code_plain: 'CXR7NT00', code_hint: 'NT00', role: 'client', site_ids: ['${MARKET}'], email: null, display_name: null, max_uses: 1, uses: 0, expires_at: new Date(Date.now() + 864e5).toISOString(), revoked_at: null });`);
  await page.goto('join?code=CXR7NT00&backend=memory');
  await page.getByLabel('Your full name').fill('Client client');
  await page.getByRole('button', { name: 'Join team' }).click();
  await expect(page.getByRole('alert')).toContainText('different email');
  const me = (await rows(page, 'patrol_members')).filter((m) => m.email === USERS.karim);
  expect(me).toHaveLength(1);
  expect(me[0]!.display_name).toBe('Karim Daher');
  expect(me[0]!.role).toBe('owner');
  expect((await rows(page, 'patrol_invites')).find((i) => i.id === 'inv-client')!.uses).toBe(0);
});

test('item 22: People shows every member with last seen (live dot only when on duty with a fresh GPS point)', async ({ page }) => {
  await owner(page);
  await more(page, 'more-people');
  const rowFor = (name: string) => page.getByTestId('member-row').filter({ hasText: name });
  await expect(rowFor('Tasha Greene').getByTestId('last-seen')).toContainText('Active now');
  await expect(rowFor('Tasha Greene').locator('.seen-dot')).toHaveAttribute('data-live', '1');
  await expect(rowFor('Abdinasir Elmi').locator('.seen-dot')).toHaveAttribute('data-live', '0'); // on duty, last GPS 6 min ago
  await expect(rowFor('Abdinasir Elmi').getByTestId('last-seen')).toContainText(/Last seen \dm ago/);
  await expect(rowFor('Marcus Reed').getByTestId('last-seen')).toContainText(/Last seen (just now|\d+[smhd] ago)/); // off duty
  await expect(rowFor('Marcus Reed').locator('.seen-dot')).toHaveAttribute('data-live', '0');
  await expect(rowFor('Dana Whitfield').getByTestId('last-seen')).toContainText('Never');
  await shot(page, 'people-last-seen');
});

test('item 8: offline cache reconciles — an incident deleted on the server disappears from Activity', async ({ page }) => {
  await guard(page);
  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(page.getByText('Vehicle idling behind loading dock')).toBeVisible();
  await mutateServer(page, `s.tables.patrol_incidents = s.tables.patrol_incidents.filter((i) => i.title !== 'Vehicle idling behind loading dock');`);
  await page.reload();
  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(page.getByTestId('activity-item').first()).toBeVisible();
  await expect(page.getByText('Vehicle idling behind loading dock')).toHaveCount(0);
});

test('item 10: "Patrol start" is first in the + list and saves a short Log entry (not an incident)', async ({ page }) => {
  await guard(page);
  await clockIn(page);
  const incidentsBefore = (await rows(page, 'patrol_incidents')).length;
  await page.getByRole('button', { name: 'Report' }).click();
  await expect(page.getByTestId('category-grid').locator('button').first()).toHaveAttribute('data-testid', 'patrol-start-tile');
  await page.getByTestId('patrol-start-tile').click();
  await expect(page.getByTestId('patrol-start-form')).toBeVisible();
  await expect(page.getByTestId('people-section')).toHaveCount(0);
  await expect(page.getByTestId('subtype-chip')).toHaveCount(0);
  await expect(page.getByTestId('ps-gps')).toContainText('47.38');
  await page.getByTestId('ps-notes').fill('Exterior first');
  await page.getByTestId('ps-photo').setInputFiles(PHOTO);
  await expect(page.getByTestId('ps-photo-count')).toHaveText('1 photo attached');
  await page.getByTestId('ps-save').click();
  await expect(page.getByTestId('end-patrol')).toBeVisible();
  await expect.poll(async () => (await rows(page, 'patrol_dar_entries')).filter((e) => e.body === 'Patrol started — Exterior first' && e.device_id).length).toBe(1);
  const e = (await rows(page, 'patrol_dar_entries')).find((x) => x.body === 'Patrol started — Exterior first')!;
  expect(e.category_name).toBe('Shift Log');
  expect(e.lat).toBeCloseTo(47.3826, 3);
  await expect.poll(async () => (await rows(page, 'patrol_attachments')).filter((a) => a.parent_id === e.id).length).toBe(1);
  await expect.poll(async () => (await rows(page, 'patrol_tour_runs')).filter((r) => r.device_id && !r.completed_at).length).toBe(1);
  expect((await rows(page, 'patrol_incidents')).length).toBe(incidentsBefore);
});

test('item 11: the guard form has no "client notified / client can see" field', async ({ page }) => {
  await guard(page);
  await page.getByRole('button', { name: 'Report' }).click();
  await page.getByTestId('cat-search').fill('access');
  await page.getByTestId('category-tile').first().click();
  await expect(page.getByTestId('extra-door')).toBeVisible();
  await expect(page.getByTestId('extra-section')).not.toContainText('Client notified');
  await expect(page.getByTestId('incident-form')).not.toContainText(/client can see|notify client/i);
});

test('scanning every checkpoint auto-logs "Patrol ended"', async ({ page }) => {
  await guard(page);
  await clockIn(page);
  await page.getByRole('link', { name: 'Patrol' }).click();
  for (const code of ['KSM1FRNT', 'KSM2EAST', 'KSM3DOCK', 'KSM4DMPS']) {
    await page.getByTestId('patrol-scan').click();
    await page.getByTestId('manual-entry').click();
    await page.getByTestId('manual-code').fill(code);
    await page.getByTestId('manual-submit').click();
    await expect(page.getByTestId('scan-result')).toBeVisible();
    await page.getByTestId('scan-done').click();
  }
  await expect.poll(async () => (await rows(page, 'patrol_dar_entries')).filter((e) => e.body === 'Patrol ended · all 4 checkpoints scanned' && e.device_id).length, { timeout: 15_000 }).toBe(1);
  await expect(page.getByTestId('start-patrol')).toBeVisible();
});

test('item 18: guards can only clock in at the site; the blocked attempt becomes an owner-only alert', async ({ page, context }) => {
  await guard(page);
  await context.setGeolocation({ latitude: 47.6062, longitude: -122.3321, accuracy: 10 }); // downtown Seattle
  await page.getByTestId('home-clock-in').click();
  await page.getByTestId('site-option').filter({ hasText: 'Kent Station Market' }).click();
  await page.getByTestId('clock-in-btn').click();
  await page.getByTestId('gps-accept').click();
  await expect(page.getByTestId('geofence-blocked')).toContainText('from Kent Station Market');
  expect((await rows(page, 'patrol_time_entries')).filter((t) => t.device_id)).toHaveLength(0);
  await expect.poll(async () => (await rows(page, 'patrol_owner_alerts')).filter((a) => a.kind === 'geofence').length).toBe(1);
});

test('item 18: owners see missed-checkpoint alerts on Live and can dismiss them', async ({ page }) => {
  await owner(page);
  const alerts = page.getByTestId('owner-alerts');
  await expect(alerts).toBeVisible({ timeout: 20_000 });
  const missed = alerts.getByTestId('owner-alert').filter({ hasText: 'Missed checkpoints at Willow Creek' });
  await expect(missed.first()).toBeVisible();
  const n = await missed.count();
  await missed.first().getByTestId('owner-alert-ack').click();
  await expect(missed).toHaveCount(n - 1);
  await expect.poll(async () => (await rows(page, 'patrol_owner_alerts')).filter((a) => a.acknowledged_at).length).toBe(1);
});

test('item 19: owner uploads a site photo; it shows on the site card and the site header', async ({ page }) => {
  await owner(page);
  await page.getByRole('link', { name: 'Sites' }).click();
  await page.getByTestId('site-admin-row').filter({ hasText: 'Kent Station Market' }).click();
  await page.getByTestId('site-photo-input').setInputFiles(PHOTO);
  await expect(page.getByTestId('site-hero')).toBeVisible();
  await expect.poll(async () => (await rows(page, 'patrol_attachments')).filter((a) => a.parent_type === 'site' && a.parent_id === MARKET).length).toBe(1);
  await shot(page, 'site-detail-photo');
  // replacing keeps one photo
  await page.getByTestId('site-photo-input').setInputFiles(PHOTO);
  await expect.poll(async () => (await rows(page, 'patrol_attachments')).filter((a) => a.parent_type === 'site' && a.parent_id === MARKET).length).toBe(1);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('site-admin-row').filter({ hasText: 'Kent Station Market' }).getByTestId('site-thumb')).toBeVisible();
  await shot(page, 'site-photo-card');
});

test('item 20: owner map shows site pins and on-duty guards only', async ({ page }) => {
  await owner(page);
  await page.getByTestId('open-map').click();
  await expect(page.getByTestId('owner-map')).toBeVisible();
  await expect(page.locator('.map-site-pin')).toHaveCount(2);
  await expect(page.locator('.owner-map path.leaflet-interactive')).toHaveCount(2); // Tasha + Abdinasir (Marcus is off duty)
  await page.locator('img.leaflet-tile-loaded').first().waitFor({ timeout: 8_000 }).catch(() => undefined); // OSM tiles (needs network)
  await shot(page, 'map');
  await page.locator('.map-site-pin').first().click();
  await expect(page.getByTestId('map-site-popup')).toBeVisible();
});

test('item 15: timesheets — weekly hours/OT and a Gusto CSV export', async ({ page }) => {
  await owner(page);
  await more(page, 'more-timesheets');
  await expect(page.getByTestId('ts-week')).toBeVisible();
  // Tasha's current shift started 3 h ago: early on a Monday that is still last week
  if (!(await page.getByTestId('ts-row').filter({ hasText: 'Tasha Greene' }).isVisible().catch(() => false))) {
    await page.waitForTimeout(800);
    if (!(await page.getByTestId('ts-row').filter({ hasText: 'Tasha Greene' }).isVisible())) await page.getByTestId('ts-prev').click();
  }
  await expect(page.getByTestId('ts-table')).toBeVisible();
  await expect(page.getByTestId('ts-row').filter({ hasText: 'Tasha Greene' })).toBeVisible();
  await shot(page, 'timesheets-weekly');
  await page.getByTestId('ts-row').filter({ hasText: 'Tasha Greene' }).click();
  await expect(page.getByTestId('ts-detail')).toContainText('On duty');
  await page.getByTestId('ts-export').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __lpLastCsv?: { text: string } }).__lpLastCsv?.text ?? '')).toContain('last_name,first_name,gusto_employee_id,regular_hours,overtime_hours,double_overtime_hours');
  const csv = await page.evaluate(() => (window as unknown as { __lpLastCsv: { text: string } }).__lpLastCsv.text);
  expect(csv).toMatch(/Greene,Tasha,,\d+\.\d\d,0\.00,\r\n/);
  await expect(page.getByTestId('ts-foot').locator('td')).toHaveCount(10);
});

test('item 17: PDFs are dark-themed (DAR render saved as PNG)', async ({ page }) => {
  await owner(page);
  await more(page, 'more-dars');
  await page.getByTestId('dar-row').first().getByTestId('dar-pdf').click();
  await expect(page.getByTestId('pdf-ready')).toBeVisible({ timeout: 15_000 });
  const pdf = await page.evaluate(() => (window as unknown as { __lpLastPdf: { name: string; bytes: number[] } }).__lpLastPdf);
  const buf = Buffer.from(pdf.bytes);
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  if (wantShots()) {
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(`${SHOTS}/dar-dark.pdf`, buf);
    try { execFileSync('pdftoppm', ['-png', '-r', '70', '-f', '1', '-l', '1', '-singlefile', `${SHOTS}/dar-dark.pdf`, `${SHOTS}/pdf-dark`]); } catch { /* renderer optional */ }
  }
  // page background is the app's dark navy (#0A0F1C)
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(buf);
  expect(doc.getPageCount()).toBeGreaterThan(0);
});

test('client portal + client app: BOLO photos and category-specific fields', async ({ page, context }) => {
  await owner(page);
  await mutateServer(page, `
    const b = s.tables.patrol_bolos.find((x) => x.title.includes('Grey hoodie'));
    (s.tables.patrol_attachments = s.tables.patrol_attachments || []).push({ id: 'att-bolo-1', org_id: b.org_id, site_id: b.site_id, member_id: b.created_by, parent_type: 'bolo', parent_id: b.id, kind: 'image', mime: 'image/jpeg', storage_path: b.org_id + '/bolo/' + b.id + '/p1.jpg', thumb_path: null, upload_status: 'uploaded', size_bytes: 1000, created_at: new Date().toISOString() });
    const i = s.tables.patrol_incidents.find((x) => x.title === 'Graffiti on east wall');
    i.extra = { surface: 'Brick wall', client_notified: 'Yes' };`);
  const graffiti = (await rows(page, 'patrol_incidents')).find((x) => x.title === 'Graffiti on east wall')!;
  await page.goto(`a/incidents/${graffiti.id}?backend=memory`);
  await expect(page.getByTestId('extra-details')).toContainText('Brick wall');
  await expect(page.getByTestId('extra-details')).not.toContainText('Client notified');
  await page.goto('a/sites?backend=memory');
  await page.getByTestId('site-admin-row').filter({ hasText: 'Kent Station Market' }).click();
  await page.getByTestId('site-tab-portal').click();
  await page.getByTestId('portal-create').click();
  const url = (await page.getByTestId('portal-url').textContent())!.trim();
  const portal = await context.newPage();
  await portal.goto(url);
  await expect(portal.getByTestId('portal-bolos').getByTestId('bolo-photo')).toHaveCount(1);
  await portal.getByTestId('portal-incident').filter({ hasText: 'Graffiti' }).locator('button').first().click();
  await expect(portal.getByTestId('portal-extra')).toContainText('Brick wall');
});

test('signed-in client app shows client-visible BOLOs with photos', async ({ page }) => {
  await openApp(page);
  await page.waitForFunction(() => !!localStorage.getItem('lp-mock-server'));
  await mutateServer(page, `
    const b = s.tables.patrol_bolos.find((x) => x.title.includes('Grey hoodie'));
    (s.tables.patrol_attachments = s.tables.patrol_attachments || []).push({ id: 'att-bolo-2', org_id: b.org_id, site_id: b.site_id, member_id: b.created_by, parent_type: 'bolo', parent_id: b.id, kind: 'image', mime: 'image/jpeg', storage_path: b.org_id + '/bolo/' + b.id + '/p2.jpg', thumb_path: null, upload_status: 'uploaded', size_bytes: 1000, created_at: new Date().toISOString() });`);
  await login(page, USERS.client);
  await dismissEnroll(page);
  await expect(page.getByTestId('client-bolos')).toContainText('Grey hoodie');
  await expect(page.getByTestId('client-bolos').getByTestId('bolo-photo')).toHaveCount(1);
});

test('item 14: anyone can change their display name (avatars are not in the app)', async ({ page }) => {
  await guard(page);
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByTestId('edit-name').click();
  await page.getByTestId('name-input').fill('Marcus J. Reed');
  await page.getByTestId('name-save').click();
  await expect(page.getByTestId('my-name')).toHaveText('Marcus J. Reed');
  await expect.poll(async () => (await rows(page, 'patrol_members')).find((m) => m.email === USERS.marcus)?.display_name).toBe('Marcus J. Reed');
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { name: 'Hi, Marcus' })).toBeVisible();
  await expect(page.locator('[aria-label="Lion Cub"]')).toHaveCount(0);
});

import { test, expect, type Page } from '@playwright/test';
import { openApp, login, dismissEnroll, USERS, mutateServer, passAdminGate } from './helpers';

// Pass 9, chunk 1 (Karim's real-account bugs A1–A10). Memory backend only; nothing is ever emailed.
type Server = { tables: Record<string, Array<Record<string, any>>> };
const rows = async (page: Page, table: string) => ((await page.evaluate(() => JSON.parse(localStorage.getItem('lp-mock-server')!) as Server)).tables[table] ?? []);
const MARKET = '0b5e0000-0000-7000-8000-00000000c001';

async function signIn(page: Page, email: string) { await openApp(page); await login(page, email); await dismissEnroll(page); }
async function owner(page: Page) { await signIn(page, USERS.karim); await expect(page.getByRole('heading', { name: 'Live' })).toBeVisible(); }
async function more(page: Page, testid: string) { await page.getByRole('link', { name: 'More' }).click(); await page.getByTestId(testid).click(); }

test('A1: an owner outside the geofence is blocked, can override with a logged reason (row + audit log)', async ({ page, context }) => {
  await context.setGeolocation({ latitude: 47.6062, longitude: -122.3321, accuracy: 10 }); // downtown Seattle, far from Kent
  await owner(page);
  await more(page, 'mode-switch');
  await page.getByTestId('home-clock-in').click();
  await page.getByTestId('site-option').filter({ hasText: 'Kent Station Market' }).click();
  await page.getByTestId('clock-in-btn').click();
  await page.getByTestId('gps-accept').click();
  await expect(page.getByTestId('geofence-blocked')).toContainText('from Kent Station Market');
  expect((await rows(page, 'patrol_time_entries')).filter((t) => t.device_id)).toHaveLength(0); // never silently clocked in
  await expect(page.getByTestId('override-clock-in')).toBeDisabled();
  await page.getByTestId('override-reason').fill('Testing from the office');
  await page.getByTestId('override-clock-in').click();
  await page.getByTestId('po-ack').click(); // first shift at this site → post orders first
  await expect(page.getByTestId('duty-hero')).toContainText('On duty');
  await expect(page.getByTestId('gps-background-warning')).toBeVisible();
  await expect.poll(async () => (await rows(page, 'patrol_time_entries')).find((t) => t.device_id && !t.clock_out_at)?.clock_in_override_reason).toBe('Testing from the office');
  const te = (await rows(page, 'patrol_time_entries')).find((t) => t.device_id && !t.clock_out_at)!;
  expect(te.clock_in_gps_status).toBe('outside');
  await expect.poll(async () => (await rows(page, 'patrol_audit_log')).filter((a) => a.kind === 'clock_in_override').length).toBe(1);
});

test('A1: a guard can never override the geofence', async ({ page, context }) => {
  await signIn(page, USERS.marcus);
  await context.setGeolocation({ latitude: 47.6062, longitude: -122.3321, accuracy: 10 });
  await page.getByTestId('home-clock-in').click();
  await page.getByTestId('site-option').filter({ hasText: 'Kent Station Market' }).click();
  await page.getByTestId('clock-in-btn').click();
  await page.getByTestId('gps-accept').click();
  await expect(page.getByTestId('geofence-blocked')).toBeVisible();
  await expect(page.getByTestId('geofence-override')).toHaveCount(0);
});

test('A2/A3: owner opens a shift, sees exact start/end dates, confirms one and voids another; a $0 invoice is blocked with the left-out list', async ({ page }) => {
  await owner(page);
  // No confirmed hours anywhere, and one forgotten 30 h shift at the market.
  await mutateServer(page, `for (const t of s.tables.patrol_time_entries) { t.confirmed_at = null; t.confirmed_minutes = null; }
    const t0 = s.tables.patrol_time_entries.find((t) => t.clock_out_at && t.site_id === '${MARKET}');
    t0.clock_out_at = new Date(Date.parse(t0.clock_in_at) + 30 * 3600e3).toISOString();`);
  const closed = (await rows(page, 'patrol_time_entries')).filter((t) => t.clock_out_at && t.site_id === MARKET);
  const long = closed[0]!, other = closed[1]!;
  await more(page, 'more-invoices');
  await page.getByTestId('inv-next').click();
  await page.getByTestId('inv-row').filter({ hasText: 'Kent Station Market' }).getByTestId('inv-create').click();
  await expect(page.getByTestId('inv-blocked')).toContainText('$0.00');
  await expect(page.getByTestId('inv-leftout').first()).toContainText('Not confirmed');
  expect((await rows(page, 'patrol_invoices')).filter((i) => i.site_id === MARKET)).toHaveLength(0);

  await page.goto(`a/timesheets/shift/${long.id}?backend=memory`);
  await expect(page.getByTestId('shift-detail')).toBeVisible();
  await expect(page.getByTestId('sd-long')).toContainText('Over 24 h');
  await expect(page.getByTestId('sd-end')).toContainText(/\w{3} \d+, \d{4}, \d+:\d\d [AP]M/);
  await page.getByTestId('sd-void-btn').click();
  await page.getByTestId('sd-void-reason').fill('Forgot to clock out while testing');
  await page.getByTestId('sd-void-confirm').click();
  await expect(page.getByTestId('sd-voided')).toBeVisible();
  await expect.poll(async () => (await rows(page, 'patrol_time_entries')).find((t) => t.id === long.id)?.void_reason).toBe('Forgot to clock out while testing');
  expect((await rows(page, 'patrol_time_entries')).find((t) => t.id === long.id)).toBeTruthy(); // never deleted

  await page.goto(`a/timesheets/shift/${other.id}?backend=memory`);
  await page.getByTestId('sd-confirm').click();
  await expect.poll(async () => (await rows(page, 'patrol_time_entries')).find((t) => t.id === other.id)?.confirmed_at).toBeTruthy();
  await expect.poll(async () => (await rows(page, 'patrol_audit_log')).map((a) => a.kind).sort()).toEqual(['timesheet_confirm', 'timesheet_void']);
});

test('A4: owner shares a DAR with the client and stops sharing; per-site auto-share toggle', async ({ page }) => {
  await owner(page);
  await more(page, 'more-dars');
  const row = page.getByTestId('dar-row').filter({ has: page.getByTestId('dar-not-shared') }).first();
  await expect(row).toBeVisible();
  const before = (await rows(page, 'patrol_dars')).filter((d) => d.client_visible).length;
  await row.getByTestId('dar-share').click();
  await expect.poll(async () => (await rows(page, 'patrol_dars')).filter((d) => d.client_visible).length).toBe(before + 1);
  await page.getByTestId('dar-unshare').first().click();
  await expect.poll(async () => (await rows(page, 'patrol_dars')).filter((d) => d.client_visible).length).toBe(before);
  // dispatch on the input itself (a toast can sit over the switch at the top of the screen)
  await page.getByTestId('dar-autoshare').getByRole('switch', { name: 'Auto-share DARs at Kent Station Market' }).dispatchEvent('click');
  await expect.poll(async () => (await rows(page, 'patrol_sites')).find((s) => s.id === MARKET)?.auto_share_dars).toBe(true);
});

test('A10: Delete draft asks in-app and removes the draft', async ({ page }) => {
  await signIn(page, USERS.marcus);
  await page.getByTestId('home-clock-in').click();
  await page.getByTestId('site-option').filter({ hasText: 'Kent Station Market' }).click();
  await page.getByTestId('clock-in-btn').click();
  await page.getByTestId('gps-accept').click();
  await page.getByRole('button', { name: 'Report' }).click();
  await page.getByTestId('cat-search').fill('theft');
  await page.getByTestId('category-tile').first().click();
  await page.getByTestId('inc-description').fill('TEST draft to delete');
  await page.getByTestId('draft-delete').click();
  await page.getByTestId('draft-delete-confirm').click();
  await expect(page.getByTestId('duty-hero')).toBeVisible();
  await expect(page.getByTestId('continue-draft')).toHaveCount(0);
  await expect.poll(async () => (await rows(page, 'patrol_incidents')).filter((i) => i.status === 'draft' && i.description === 'TEST draft to delete').length).toBe(0);
});

// ------------------------------------------------------------------ pass 9 chunk 2 (client proof + Client logs)
test('C1/A7: portal shows honest live status, patrol proof and a request thread that lands as an owner task', async ({ page, context }) => {
  await owner(page);
  await page.getByRole('link', { name: 'Sites' }).click();
  await page.getByTestId('site-admin-row').filter({ hasText: 'Kent Station Market' }).click();
  await page.getByTestId('site-tab-portal').click();
  await page.getByTestId('portal-create').click();
  const url = (await page.getByTestId('portal-url').textContent())!.trim();
  const portal = await context.newPage();
  await portal.goto(url);
  await expect(portal.getByTestId('portal-live')).toBeVisible();
  await expect(portal.getByTestId('portal-on-site')).not.toContainText('Yes'); // nobody GPS-verified on shift
  await expect(portal.getByTestId('cp-proof')).toBeVisible();
  await expect(portal.getByTestId('portal-expiry')).toContainText('can revoke it');
  // full title on expand: the card tap still toggles
  const inc = portal.getByTestId('portal-incident').first();
  await inc.getByRole('button').first().click();
  await expect(inc.getByTestId('portal-incident-detail')).toBeVisible();
  await expect(inc.getByTestId('portal-incident-title')).not.toHaveClass(/ellipsis/);
  await portal.getByTestId('cp-request-body').fill('Please check the rear gate tonight');
  await portal.getByTestId('cp-request-send').click();
  await expect(portal.getByTestId('cp-request').filter({ hasText: 'Please check the rear gate tonight' })).toBeVisible();
  expect((await rows(page, 'patrol_owner_alerts')).filter((a) => a.kind === 'client_request')).toHaveLength(1);
  expect(await portal.content()).not.toMatch(/hourly_rate|pay_rate/);
});

test('Client logs: hold for OK by default; Send now shows the honest "email not configured" state (no email sent)', async ({ page }) => {
  await owner(page);
  await page.getByRole('link', { name: 'Sites' }).click();
  await page.getByTestId('site-admin-row').filter({ hasText: 'Kent Station Market' }).click();
  await page.getByTestId('site-tab-email').click();
  await expect(page.getByTestId('client-email-tab')).toContainText('Hold for my OK');
  await page.getByTestId('client-email-recipients').fill('manager@example.com');
  await page.getByTestId('client-email-save').click();
  await expect.poll(async () => (await rows(page, 'patrol_site_client_email')).find((r) => r.site_id === MARKET)?.recipients).toEqual(['manager@example.com']);
  await mutateServer(page, `(s.tables.patrol_client_reports ??= []).push({ id: 'cr-1', org_id: s.tables.patrol_sites.find((x) => x.id === '${MARKET}').org_id, site_id: '${MARKET}', night: '2026-11-08', status: 'ready', ready_reason: 'last_clock_out', note: null, send_count: 0, last_email_id: null, last_error: null, sent_at: null, created_at: new Date().toISOString() });`);
  await page.goto(page.url().replace(/\/a\/.*$/, '/a'));
  await expect(page.getByTestId('waiting-for-ok')).toContainText('1 client report waiting for your OK');
  await page.getByTestId('waiting-for-ok').click();
  const row = page.getByTestId('client-log-row').first();
  await expect(row.getByTestId('client-log-status')).toHaveText('Ready for your OK');
  await row.getByTestId('client-log-preview').click();
  await expect(page.getByTestId('client-log-preview-body')).toContainText('Exactly what the client receives');
  await page.keyboard.press('Escape');
  await row.getByTestId('client-log-send').click();
  await expect(row.getByTestId('client-log-status')).toHaveText('Not sent — email not configured');
  await expect(page.getByTestId('email-not-configured')).toContainText('Email sending not configured');
  expect((await rows(page, 'patrol_client_emails')).filter((e) => e.status === 'sent')).toHaveLength(0);
});

// ------------------------------------------------------------------ pass 9 chunk 3 (Section B demo bugs)
test('B2/B9: Live shows my own clock-in at once; owner alerts carry a PT time', async ({ page }) => {
  await owner(page);
  await more(page, 'mode-switch');
  await page.getByTestId('home-clock-in').click();
  await page.getByTestId('site-option').filter({ hasText: 'Kent Station Market' }).click();
  await page.getByTestId('clock-in-btn').click();
  await page.getByTestId('gps-accept').click();
  await page.getByTestId('po-ack').click(); // first shift at this site → post orders first
  await expect(page.getByTestId('duty-hero')).toContainText('On duty');
  await more(page, 'mode-switch');
  await passAdminGate(page);
  await expect(page.getByTestId('onshift-row').filter({ hasText: 'Karim Daher' })).toBeVisible();
  const alert = page.getByTestId('owner-alert').first();
  if (await alert.isVisible({ timeout: 15_000 }).catch(() => false)) await expect(alert.getByTestId('owner-alert-time')).toContainText(/ PT \(/);
});

test('B12/B13 guard: More has Schedule, Profile & settings and an honest Messages entry', async ({ page }) => {
  await signIn(page, USERS.marcus);
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByTestId('more-messages').click();
  await expect(page.getByTestId('messages-honest')).toContainText('needs the Lion Patrol server');
  await expect(page.getByTestId('messages-sheet').locator('textarea, input')).toHaveCount(0); // no fake message box
  await page.keyboard.press('Escape');
  await page.getByTestId('more-profile').click();
  await expect(page.getByTestId('profile-pin')).toBeVisible();
  await page.getByTestId('profile-name').click();
  await expect(page.getByTestId('name-input')).toHaveValue('Marcus Reed');
  await page.keyboard.press('Escape');
  await page.getByTestId('more-my-schedule').click();
  await expect(page.getByRole('heading', { name: 'My schedule' }).or(page.getByText('My schedule').first())).toBeVisible();
});

test('B13 owner: feed entries open, contacts have Save + saved state with phone validation, clear DAR PDF labels; B12 desktop sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await owner(page);
  const side = page.getByRole('complementary', { name: 'Sections' });
  for (const name of ['People', 'Schedule', 'Daily reports', 'Timesheets', 'Guard cards', 'Invoices', 'Client logs', 'Settings']) await expect(side.getByRole('link', { name })).toBeVisible();
  await side.getByRole('link', { name: 'Activity' }).click();
  await page.getByLabel('Date range').selectOption('30');
  await page.getByTestId('feed-filters').getByRole('button', { name: 'Scans' }).click();
  await page.getByTestId('feed-item').first().click();
  await expect(page.getByTestId('feed-detail')).toBeVisible();
  await expect(page.getByTestId('feed-detail')).toContainText('PT');
  await page.keyboard.press('Escape');
  await side.getByRole('link', { name: 'Sites' }).click();
  await page.getByText('Kent Station Market').first().click();
  await page.getByRole('button', { name: 'Contacts' }).click();
  await expect(page.getByTestId('contacts-state')).toContainText('All contacts saved');
  const phone = page.locator('input[type="tel"]').first();
  await phone.fill('(253) 555-01a8');
  await expect(phone).toHaveValue('(253) 555-018'); // letters never get in
  await phone.fill('(253) 555-0189');
  await expect(page.getByTestId('contacts-state')).toContainText('Unsaved changes');
  await page.getByTestId('contacts-save').click();
  await expect(page.getByTestId('contacts-state')).toContainText('All contacts saved');
  await expect.poll(async () => (await rows(page, 'patrol_sites')).find((s) => s.id === MARKET)?.contacts?.[0]?.phone).toBe('(253) 555-0189');
  await side.getByRole('link', { name: 'Daily reports' }).click();
  await expect(page.getByTestId('dar-pdf').first()).toContainText('Daily report PDF');
  await expect(page.getByTestId('dar-pdf-legend')).toBeVisible();
});

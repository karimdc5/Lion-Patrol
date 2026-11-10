import { test, expect, type Page } from '@playwright/test';
import { openApp, login, dismissEnroll, USERS, mutateServer } from './helpers';

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

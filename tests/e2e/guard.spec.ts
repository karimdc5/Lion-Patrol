import { test, expect, type Page } from '@playwright/test';
import { openApp, login, dismissEnroll, USERS, setOffline } from './helpers';
import { fileURLToPath } from 'node:url';

const PHOTO = fileURLToPath(new URL('../fixtures/photo.jpg', import.meta.url));

type Server = { tables: Record<string, Array<Record<string, any>>>; objects: Record<string, { mime: string; size: number; head: string }> };
const server = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('lp-mock-server')!) as Server);
const rows = async (page: Page, table: string) => ((await server(page)).tables[table] ?? []);

async function signInGuard(page: Page) {
  await openApp(page);
  await login(page, USERS.marcus);
  await dismissEnroll(page);
  await expect(page.getByRole('heading', { name: 'Hi, Marcus' })).toBeVisible();
}

async function clockIn(page: Page, firstTime = true) {
  await page.getByTestId('home-clock-in').click();
  await page.getByTestId('site-option').filter({ hasText: 'Kent Station Market' }).click();
  await page.getByTestId('clock-in-btn').click();
  if (firstTime) {
    await expect(page.getByTestId('gps-notice')).toBeVisible();
    await expect(page.getByText('only while you’re clocked in')).toBeVisible();
    await page.getByTestId('gps-accept').click();
  }
  await expect(page.getByTestId('duty-hero')).toContainText('On duty');
}

test('clock in requires accepting the GPS notice; consent + time entry + DAR sync with a GPS stamp', async ({ page }) => {
  await signInGuard(page);
  await page.getByTestId('home-clock-in').click();
  await page.getByTestId('site-option').filter({ hasText: 'Kent Station Market' }).click();
  await page.getByTestId('clock-in-btn').click();
  await page.getByTestId('gps-decline').click();
  await expect(page.getByRole('heading', { name: 'Hi, Marcus' })).toHaveCount(0); // still on the clock-in screen
  await page.getByTestId('clock-in-btn').click();
  await page.getByTestId('gps-accept').click();
  await expect(page.getByTestId('duty-status')).toHaveText(/\d\d:\d\d:\d\d/);
  await expect.poll(async () => (await rows(page, 'patrol_time_entries')).filter((t) => !t.clock_out_at).length).toBe(1);
  const te = (await rows(page, 'patrol_time_entries')).find((t) => !t.clock_out_at)!;
  expect(te.clock_in_lat).toBeCloseTo(47.3826, 3);
  expect(te.gps_notice_accepted_at).toBeTruthy();
  expect((await rows(page, 'patrol_consents')).some((c) => c.kind === 'gps_notice')).toBe(true);
  expect((await rows(page, 'patrol_dars')).some((d) => d.time_entry_id === te.id && d.status === 'open')).toBe(true);
});

test('QR patrol via manual code entry records the scan and tour progress; out-of-order is flagged', async ({ page }) => {
  await signInGuard(page);
  await clockIn(page);
  await page.getByTestId('home-scan').click();
  await page.getByTestId('manual-entry').click();
  await page.getByTestId('manual-code').fill('ksm1-frnt');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('scan-result-name')).toHaveText('Front Entrance');
  await expect(page.getByTestId('scan-result')).toContainText('1 of 4');
  await page.getByTestId('scan-next').click();
  await page.getByTestId('manual-entry').click();
  await page.getByTestId('manual-code').fill('KSM3DOCK');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('scan-result')).toContainText('Out of order');
  await page.getByTestId('scan-done').click();
  await expect(page.getByTestId('tour-progress')).toHaveText('2/4');
  await expect.poll(async () => (await rows(page, 'patrol_scans')).filter((s) => s.method === 'manual').length).toBe(2);
  const scans = (await rows(page, 'patrol_scans')).filter((s) => s.method === 'manual');
  expect(scans.some((s) => s.flags.includes('out_of_order'))).toBe(true);
  expect(scans[0]!.lat).toBeCloseTo(47.3826, 3);
  // wrong code is rejected inline
  await page.getByTestId('patrol-scan').click();
  await page.getByTestId('manual-entry').click();
  await page.getByTestId('manual-code').fill('NOPE1234');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('manual-sheet')).toContainText('doesn’t match a checkpoint');
});

async function startTheftReport(page: Page) {
  await page.getByRole('button', { name: 'Report' }).click();
  await page.getByTestId('cat-search').fill('theft');
  await page.getByTestId('category-tile').first().click();
  await expect(page.getByTestId('incident-form')).toBeVisible();
  await page.getByTestId('subtype-chip').filter({ hasText: 'Shoplifting' }).click();
  await page.getByTestId('inc-description').fill('Adult male concealed two bottles in a backpack and left through the front doors without paying.');
}

test('incident with a photo: required fields enforced, then submitted, uploaded and compressed', async ({ page }) => {
  await signInGuard(page);
  await startTheftReport(page);
  await page.getByTestId('inc-submit').click();
  await expect(page.getByText('Add at least one person')).toBeVisible(); // Theft requires people
  await page.getByTestId('add-person').click();
  await page.getByTestId('person-name').fill('Unknown male, ~30, red hoodie');
  await page.getByTestId('att-library').setInputFiles(PHOTO);
  await expect(page.getByTestId('attachment')).toHaveCount(1);
  await page.getByTestId('inc-submit').click();
  await expect(page.getByRole('heading', { name: 'Hi, Marcus' })).toBeVisible();
  await expect.poll(async () => (await rows(page, 'patrol_incidents')).find((i) => i.subtype_name === 'Shoplifting')?.status, { timeout: 15_000 }).toBe('submitted');
  const inc = (await rows(page, 'patrol_incidents')).find((i) => i.subtype_name === 'Shoplifting')!;
  expect(inc.report_no).toMatch(/^LSS-KSM-\d{4}-\d{5}$/);
  expect(inc.people[0].name).toContain('red hoodie');
  await expect.poll(async () => (await rows(page, 'patrol_attachments')).find((a) => a.parent_id === inc.id)?.upload_status).toBe('uploaded');
  const att = (await rows(page, 'patrol_attachments')).find((a) => a.parent_id === inc.id)!;
  const obj = (await server(page)).objects[att.storage_path]!;
  expect(obj.head.startsWith('ffd8')).toBe(true);       // JPEG
  expect(obj.size).toBeLessThan(600_000);               // compressed
  expect(att.width).toBeLessThanOrEqual(2000);
  expect((await server(page)).objects[att.thumb_path]).toBeTruthy();
});

test('OFFLINE incident with media is kept and syncs when back online', async ({ page, context }) => {
  await signInGuard(page);
  await setOffline(context, page, true);
  await startTheftReport(page);
  await page.getByTestId('add-person').click();
  await page.getByTestId('person-name').fill('Offline subject');
  await page.getByTestId('att-library').setInputFiles(PHOTO);
  await expect(page.getByTestId('attachment')).toHaveCount(1);
  await page.getByTestId('inc-submit').click();
  await expect(page.getByRole('heading', { name: 'Hi, Marcus' })).toBeVisible();
  await expect(page.getByTestId('sync-pill')).toContainText('Offline');
  expect((await rows(page, 'patrol_incidents')).some((i) => i.people?.[0]?.name === 'Offline subject')).toBe(false);
  await setOffline(context, page, false);
  await expect.poll(async () => (await rows(page, 'patrol_incidents')).find((i) => i.people?.[0]?.name === 'Offline subject')?.status, { timeout: 20_000 }).toBe('submitted');
  const inc = (await rows(page, 'patrol_incidents')).find((i) => i.people?.[0]?.name === 'Offline subject')!;
  await expect.poll(async () => (await rows(page, 'patrol_attachments')).find((a) => a.parent_id === inc.id)?.upload_status, { timeout: 15_000 }).toBe('uploaded');
  await expect(page.getByTestId('sync-pill')).toContainText('Synced', { timeout: 15_000 });
});

test('killing/reloading mid-incident restores the draft and its photo with no loss', async ({ page, context }) => {
  await signInGuard(page);
  await startTheftReport(page);
  await page.getByTestId('inc-title').fill('Bottle theft at front doors');
  await page.getByTestId('add-person').click();
  await page.getByTestId('person-name').fill('Draft person');
  await page.getByTestId('att-library').setInputFiles(PHOTO);
  await expect(page.getByTestId('attachment')).toHaveCount(1);
  await expect(page.getByTestId('autosave')).toContainText('Saved');
  const url = page.url();
  await page.close();                                  // "kill" the app
  const page2 = await context.newPage();
  await page2.goto(url.replace(/\/g\/report\/.*/, '/'));
  await page2.getByTestId('continue-draft').click();
  await expect(page2.getByTestId('inc-title')).toHaveValue('Bottle theft at front doors');
  await expect(page2.getByTestId('inc-description')).toHaveValue(/concealed two bottles/);
  await expect(page2.getByTestId('person-name')).toHaveValue('Draft person');
  await expect(page2.getByTestId('attachment')).toHaveCount(1);
  await page2.getByTestId('inc-submit').click();
  await expect.poll(async () => (await rows(page2, 'patrol_incidents')).find((i) => i.title === 'Bottle theft at front doors')?.status, { timeout: 15_000 }).toBe('submitted');
});

test('SOS hold creates a high-priority alert with location; 911 is one tap away', async ({ page }) => {
  await signInGuard(page);
  const sos = page.getByTestId('home-sos');
  await sos.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = (await sos.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();                               // short press: nothing happens
  await expect(page.getByTestId('sos-screen')).toHaveCount(0);
  await page.mouse.down();
  await page.waitForTimeout(2400);
  await page.mouse.up();
  await expect(page.getByTestId('sos-screen')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Call 911' })).toHaveAttribute('href', 'tel:911');
  await expect(page.getByRole('heading', { name: 'Owners notified' })).toBeVisible({ timeout: 10_000 });
  const alert = (await rows(page, 'patrol_alerts'))[0]!;
  expect(alert.status).toBe('open');
  expect(alert.lat).toBeCloseTo(47.3826, 3);
  await page.getByTestId('sos-safe').click();
  await expect.poll(async () => (await rows(page, 'patrol_alerts'))[0]!.status).toBe('cancelled');
});

test('SOS is reachable from other guard screens (top-bar chip)', async ({ page }) => {
  await signInGuard(page);
  await page.getByRole('link', { name: 'Activity' }).click();
  await page.getByTestId('sos-chip').click();
  await expect(page.getByTestId('sos-sheet')).toBeVisible();
  await expect(page.getByTestId('sos-hold')).toBeVisible();
});

test('DAR: add log entries with a photo, clock out submits the DAR', async ({ page }) => {
  await signInGuard(page);
  await clockIn(page);
  await page.getByRole('button', { name: 'Log entry' }).click();
  await page.getByTestId('dar-text').fill('East fire exit checked and secured.');
  await page.getByTestId('dar-photo').setInputFiles(PHOTO);
  await expect(page.getByText('1 photo attached')).toBeVisible();
  await page.getByTestId('dar-add').click();
  await expect(page.getByTestId('dar-entry')).toHaveCount(1);
  await expect(page.getByTestId('dar-entry').getByTestId('attachment')).toHaveCount(1);
  await page.getByRole('link', { name: 'Home' }).click();
  await page.getByTestId('clock-out-btn').click();
  await page.getByTestId('clock-out-confirm').click();
  await expect(page.getByText('Add a short shift note')).toBeVisible();
  await page.getByTestId('shift-note').fill('Quiet night, all secure at 05:45.');
  await page.getByTestId('clock-out-confirm').click();
  await expect(page.getByTestId('duty-hero')).toContainText('Off duty');
  await expect.poll(async () => (await rows(page, 'patrol_dars')).find((d) => d.summary?.includes('Quiet night, all secure'))?.status, { timeout: 15_000 }).toBe('submitted');
  const dar = (await rows(page, 'patrol_dars')).find((d) => d.summary?.includes('Quiet night, all secure'))!;
  expect((await rows(page, 'patrol_dar_entries')).filter((e) => e.dar_id === dar.id)).toHaveLength(1);
  expect((await rows(page, 'patrol_time_entries')).find((t) => t.id === dar.time_entry_id)!.clock_out_at).toBeTruthy();
});

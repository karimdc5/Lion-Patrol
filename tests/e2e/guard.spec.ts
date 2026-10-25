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
  await expect.poll(async () => (await rows(page, 'patrol_time_entries')).filter((t) => !t.clock_out_at && t.device_id).length).toBe(1);
  const te = (await rows(page, 'patrol_time_entries')).find((t) => !t.clock_out_at && t.device_id)!;
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

test('one-tap Start/End patrol logs to the daily log with GPS, opens/closes a round, never creates an incident', async ({ page }) => {
  await signInGuard(page);
  await clockIn(page);
  const incidentsBefore = (await rows(page, 'patrol_incidents')).length;
  await page.getByTestId('start-patrol').click();
  await expect(page.getByTestId('end-patrol')).toBeVisible();
  await expect(page.getByTestId('incident-form')).toHaveCount(0); // no form
  await expect.poll(async () => (await rows(page, 'patrol_dar_entries')).filter((e) => e.body === 'Patrol started' && e.device_id).length).toBe(1);
  const started = (await rows(page, 'patrol_dar_entries')).find((e) => e.body === 'Patrol started' && e.device_id)!;
  expect(started.category_name).toBe('Shift Log');
  expect(started.lat).toBeCloseTo(47.3826, 3);
  await expect.poll(async () => (await rows(page, 'patrol_tour_runs')).filter((r) => r.device_id && !r.completed_at).length).toBe(1);
  // Patrol tab shows the same state; End is one tap
  await page.getByRole('link', { name: 'Patrol' }).click();
  await page.getByTestId('end-patrol').click();
  await expect(page.getByTestId('start-patrol')).toBeVisible();
  await expect.poll(async () => (await rows(page, 'patrol_dar_entries')).filter((e) => e.body === 'Patrol ended' && e.device_id).length).toBe(1);
  await expect.poll(async () => (await rows(page, 'patrol_tour_runs')).filter((r) => r.device_id && !r.completed_at).length).toBe(0);
  expect((await rows(page, 'patrol_incidents')).length).toBe(incidentsBefore);
});

test('incident form: picking a type hides sibling types; routine categories have no people/vehicle/police fields', async ({ page }) => {
  await signInGuard(page);
  await page.getByRole('button', { name: 'Report' }).click();
  await expect(page.getByTestId('category-tile').filter({ hasText: 'Patrol & Shift' })).toHaveCount(0);
  await page.getByTestId('cat-search').fill('maintenance');
  await page.getByTestId('category-tile').first().click();
  await expect(page.getByTestId('incident-form')).toBeVisible();
  await page.getByTestId('subtype-chip').filter({ hasText: 'Lights out' }).click();
  await expect(page.getByTestId('subtype-chip')).toHaveCount(0);
  await expect(page.getByTestId('subtype-selected')).toHaveText('Lights out');
  await expect(page.getByTestId('vehicles-section')).toHaveCount(0);
  await expect(page.getByTestId('police-section')).toHaveCount(0);
  await expect(page.getByTestId('people-section')).toHaveCount(0);
  await expect(page.getByTestId('extra-work_order')).toBeVisible(); // category-specific field
  await page.getByTestId('change-type').click();
  await expect(page.getByTestId('subtype-chip').first()).toBeVisible();
  // a category where they fit still shows them
  await page.getByRole('button', { name: 'Change category' }).click();
  await page.getByTestId('cat-search').fill('trespass');
  await page.getByTestId('category-tile').first().click();
  await expect(page.getByTestId('vehicles-section')).toBeVisible();
  await expect(page.getByTestId('police-section')).toBeVisible();
});

test('BOLO: pinned on Home and Post orders for the site; guard posts one with a photo', async ({ page }) => {
  await signInGuard(page);
  await clockIn(page);
  await expect(page.getByTestId('bolo-card').filter({ hasText: 'Grey hoodie, repeat warnings at dock' })).toBeVisible();
  await page.getByTestId('bolo-new').click();
  await page.getByTestId('bolo-title-input').fill('Silver sedan casing lot');
  await page.getByTestId('bolo-desc').fill('Circled the lot three times around 02:00.');
  await page.getByTestId('bolo-save').click();
  await expect(page.getByTestId('bolo-error')).toContainText('photo');
  await page.getByTestId('bolo-photo').setInputFiles(PHOTO);
  await expect(page.getByTestId('bolo-photo-count')).toBeVisible();
  await page.getByTestId('bolo-save').click();
  await expect(page.getByTestId('bolo-card').filter({ hasText: 'Silver sedan casing lot' })).toBeVisible();
  await expect.poll(async () => (await rows(page, 'patrol_bolos')).find((b) => b.title === 'Silver sedan casing lot')?.status).toBe('active');
  const b = (await rows(page, 'patrol_bolos')).find((x) => x.title === 'Silver sedan casing lot')!;
  expect(b.visible_to_client).toBe(false);
  await expect.poll(async () => (await rows(page, 'patrol_attachments')).filter((a) => a.parent_type === 'bolo' && a.parent_id === b.id).length).toBe(1);
  await page.getByTestId('site-row').filter({ hasText: 'Kent Station Market' }).click();
  await expect(page.getByTestId('bolo-card')).toHaveCount(2);
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
  const alert = (await rows(page, 'patrol_alerts')).find((a) => a.device_id)!;
  expect(alert.status).toBe('open');
  expect(alert.lat).toBeCloseTo(47.3826, 3);
  await page.getByTestId('sos-safe').click();
  await expect.poll(async () => (await rows(page, 'patrol_alerts')).find((a) => a.device_id)!.status).toBe('cancelled');
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

test('camera QR scan: injected fake camera stream is decoded and logged', async ({ page }) => {
  const { encode } = await import('uqr');
  const { data } = encode('https://karimdc5.github.io/Lion-Patrol/q/KSM2EAST', { border: 4 });
  await page.addInitScript((matrix: boolean[][]) => {
    const fake = async () => {
      const n = matrix.length, scale = 10;
      const c = document.createElement('canvas');
      c.width = c.height = n * scale;
      const ctx = c.getContext('2d')!;
      const draw = () => {
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = '#000';
        matrix.forEach((row, y) => row.forEach((on, x) => { if (on) ctx.fillRect(x * scale, y * scale, scale, scale); }));
      };
      draw(); setInterval(draw, 100);
      return (c as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(10);
    };
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: fake }, configurable: true });
  }, data);
  await signInGuard(page);
  await clockIn(page);
  await page.getByTestId('home-scan').click();
  await expect(page.getByTestId('scan-result-name')).toHaveText('East Side Fire Exit', { timeout: 15_000 });
  await expect.poll(async () => (await rows(page, 'patrol_scans')).filter((s) => s.method === 'qr' && s.device_id).length).toBe(1);
});

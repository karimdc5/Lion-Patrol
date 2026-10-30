// Renders PREVIEW PNGs of the toy avatar set (item 14) — never part of the app build.
// Usage: node scripts/avatar-previews.mjs [outDir]   (default /workspace/lion-patrol-shots/avatars)
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { AVATARS } from '../design/avatars/avatars.mjs';

const out = process.argv[2] ?? '/workspace/lion-patrol-shots/avatars';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 980, height: 760 } });
const cards = AVATARS.map((a) => `<figure><div class="av">${a.svg}</div><figcaption>${a.name}</figcaption></figure>`).join('');
await page.setContent(`<!doctype html><html><head><style>
  body { margin: 0; background: #0A0F1C; color: #E8ECF2; font: 600 15px -apple-system, system-ui, sans-serif; }
  header { padding: 28px 36px 6px; } h1 { margin: 0; font-size: 24px; } p { margin: 6px 0 0; color: #8A94A6; font-weight: 500; }
  .grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 22px; padding: 24px 36px 36px; }
  figure { margin: 0; text-align: center; } .av svg { width: 120px; height: 120px; display: block; margin: 0 auto 10px; filter: drop-shadow(0 6px 14px rgba(0,0,0,.45)); }
  .row { display: flex; gap: 18px; align-items: center; padding: 0 36px 28px; } .row svg { border-radius: 50%; }
  .chip { display: flex; align-items: center; gap: 10px; background: #141B2D; border-radius: 14px; padding: 8px 14px 8px 8px; }
</style></head><body><header><h1>Lion Patrol · toy avatars (preview)</h1><p>Original set for Karim’s approval — not enabled in the app.</p></header>
<div class="grid">${cards}</div>
<div class="row">${AVATARS.slice(0, 4).map((a, i) => `<div class="chip">${a.svg.replace('<svg ', '<svg width="40" height="40" ')}<span>${['Karim Daher', 'Marcus Reed', 'Tasha Greene', 'Dana Whitfield'][i]}</span></div>`).join('')}</div>
</body></html>`);
await page.screenshot({ path: `${out}/avatars-sheet.png`, fullPage: true });
const single = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 256, height: 256 } });
for (const a of AVATARS) {
  await single.setContent(`<html><body style="margin:0;background:transparent">${a.svg.replace('<svg ', '<svg width="256" height="256" ')}</body></html>`);
  await single.screenshot({ path: `${out}/avatar-${a.id}.png`, omitBackground: true });
  writeFileSync(`${out}/avatar-${a.id}.svg`, a.svg);
}
await browser.close();
console.log(`wrote ${AVATARS.length} avatars + sheet to ${out}`);

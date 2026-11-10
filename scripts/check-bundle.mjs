// Fails if the initial JS for first paint exceeds the budget (gzip). Initial = entry chunk +
// its static imports + the backend chunk that boot() always loads (supabase).
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const BUDGET_KB = 120;
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const manifest = JSON.parse(readFileSync(dist + '.vite/manifest.json', 'utf8'));
const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);
const seen = new Set();
const walk = (key) => {
  if (seen.has(key)) return;
  seen.add(key);
  for (const imp of manifest[key].imports ?? []) walk(imp);
};
walk(entryKey);
const backendKey = Object.keys(manifest).find((k) => k.endsWith('data/backend/supabase.ts'));
if (backendKey) walk(backendKey);

let total = 0;
const rows = [];
for (const key of seen) {
  const file = manifest[key].file;
  if (!file.endsWith('.js')) continue;
  const gz = gzipSync(readFileSync(dist + file)).length;
  total += gz;
  rows.push([file, (gz / 1024).toFixed(1)]);
}
for (const [f, kb] of rows) console.log(`  ${kb.padStart(6)} KB  ${f}`);
const kb = total / 1024;
console.log(`Initial JS: ${kb.toFixed(1)} KB gzip (budget ${BUDGET_KB} KB)`);
if (kb > BUDGET_KB) { console.error('✗ over budget'); process.exit(1); }
console.log('✓ within budget');

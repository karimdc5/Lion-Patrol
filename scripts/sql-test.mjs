// Runs the Supabase migrations + supabase/tests/rls_test.sql inside PGlite (Postgres in WASM)
// against a local Supabase shim. Also re-applies every migration a second time to prove the
// files are re-runnable. Usage: node scripts/sql-test.mjs
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const db = new PGlite({ extensions: { pgcrypto } });
const notices = [];
db.onNotice?.((n) => notices.push(n.message));

const run = async (label, sql) => {
  try {
    await db.exec(sql);
  } catch (e) {
    console.error(`\n✗ ${label}\n  ${e.message}${e.where ? `\n  where: ${e.where}` : ''}`);
    process.exit(1);
  }
};

await run('shim', readFileSync(root + 'supabase/tests/supabase_shim.sql', 'utf8'));
const files = readdirSync(root + 'supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
for (const pass of [1, 2]) {
  for (const f of files) await run(`${f} (pass ${pass})`, readFileSync(root + 'supabase/migrations/' + f, 'utf8'));
  console.log(`✓ migrations applied (pass ${pass}): ${files.length} files`);
}

const test = readFileSync(root + 'supabase/tests/rls_test.sql', 'utf8');
let results;
try {
  results = await db.exec(test);
} catch (e) {
  console.error(`\n✗ rls_test.sql\n  ${e.message}${e.where ? `\n  where: ${e.where}` : ''}`);
  process.exit(1);
}
const last = results.filter((r) => r.rows?.length).at(-1);
console.log('✓ rls_test.sql result:', last?.rows?.[0]);
const leftover = await db.query(`select (select count(*) from public.patrol_orgs) orgs, (select count(*) from auth.users) users`);
console.log('✓ rows left behind:', leftover.rows[0]);
if (Number(leftover.rows[0].orgs) !== 0 || Number(leftover.rows[0].users) !== 0) {
  console.error('✗ test left data behind'); process.exit(1);
}
if (last?.rows?.[0]?.result !== 'RLS TESTS PASSED') { console.error('✗ missing pass marker'); process.exit(1); }
console.log('RLS TESTS PASSED');

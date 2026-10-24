import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { uuidv7 } from '../../src/lib/uuid';
import { sanitizeHtml } from '../../src/lib/sanitize';
import { formatCode } from '../../src/screens/public/Join';
import { hms, initials } from '../../src/lib/format';
import { sql } from '../../scripts/gen-seed-sql.mjs';
import seed from '../../src/domain/categories.seed.json';

describe('uuidv7', () => {
  it('is RFC-shaped and time ordered', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    const many = new Set(Array.from({ length: 2000 }, () => uuidv7()));
    expect(many.size).toBe(2000);
  });
});

describe('sanitizeHtml', () => {
  it('keeps the allowlist and strips scripts, handlers and javascript: links', () => {
    const out = sanitizeHtml('<h2 onclick="x()">Hi</h2><script>alert(1)</script><p><a href="javascript:alert(1)">bad</a> <a href="tel:+12535550100">call</a></p><img src=x onerror=alert(1)><div><b>ok</b></div>');
    expect(out).toContain('<h2>Hi</h2>');
    expect(out).not.toMatch(/script|onerror|onclick|javascript:|<img|<div/);
    expect(out).toContain('href="tel:+12535550100"');
    expect(out).toContain('<b>ok</b>');
  });
});

describe('formatting', () => {
  it('formats invite codes', () => {
    expect(formatCode('7k4q9xw2')).toBe('LION-7K4Q-9XW2');
    expect(formatCode('lion 7k4q-9xw2')).toBe('LION-7K4Q-9XW2');
    expect(formatCode('7k')).toBe('LION-7K');
  });
  it('hms and initials', () => {
    expect(hms(3_723_000)).toBe('01:02:03');
    expect(initials('Abdinasir Elmi')).toBe('AE');
    expect(initials('karim')).toBe('K');
  });
});

describe('category seed parity', () => {
  it('SQL migration embeds exactly the JSON seed', () => {
    const migration = readFileSync('supabase/migrations/20261024000500_patrol_seed.sql', 'utf8');
    expect(migration).toBe(sql);
    expect(seed.length).toBeGreaterThanOrEqual(20);
    expect(seed.length).toBeLessThanOrEqual(30);
    const names = seed.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});

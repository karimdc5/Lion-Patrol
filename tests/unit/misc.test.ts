import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { uuidv7 } from '../../src/lib/uuid';
import { sanitizeHtml } from '../../src/lib/sanitize';
import { formatCode } from '../../src/screens/public/Join';
import { hms, initials } from '../../src/lib/format';
import { sql } from '../../scripts/gen-seed-sql.mjs';
import seed from '../../src/domain/categories.seed.json';
import { categoryFields } from '../../src/domain/incident';
import type { Category } from '../../src/data/types';

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
    const fn = sql.slice(sql.indexOf('create or replace function public.patrol_default_categories()'), sql.indexOf('$seed$;') + 7);
    expect(readFileSync('supabase/migrations/20261025000100_patrol_feedback.sql', 'utf8')).toContain(fn);
    expect(seed.some((c) => c.name === 'Patrol & Shift')).toBe(false);
    expect(seed.length).toBeGreaterThanOrEqual(20);
    expect(seed.length).toBeLessThanOrEqual(30);
    const names = seed.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('per-category field config', () => {
  const cat = (name: string) => {
    const c = (seed as Array<{ name: string; required_fields: string[]; field_config: unknown }>).find((x) => x.name === name)!;
    return { name: c.name, required_fields: c.required_fields, field_config: c.field_config } as unknown as Category;
  };
  it('every default category has a config', () => {
    for (const c of seed as Array<{ field_config?: { sections: string[]; extra: unknown[] } }>) expect(Array.isArray(c.field_config?.sections) && Array.isArray(c.field_config?.extra)).toBe(true);
  });
  it('routine categories have no vehicle/police/people fields, but their own fields', () => {
    for (const n of ['Maintenance & Facility', 'Weather', 'Lost & Found', 'Client / Resident Request']) {
      const f = categoryFields(cat(n));
      expect(f.sections.has('vehicles')).toBe(false);
      expect(f.sections.has('police')).toBe(false);
      expect(f.sections.has('people')).toBe(false);
      expect(f.extra.length).toBeGreaterThan(0);
    }
    expect(categoryFields(cat('Lost & Found')).extra.map((x) => x.key)).toEqual(['item', 'owner', 'disposition']);
  });
  it('incident categories keep people/vehicle/police; medical gets EMS + injury', () => {
    for (const n of ['Suspicious Activity', 'Trespass & Removal', 'Theft & Shoplifting', 'Vandalism, Graffiti & Damage', 'Disturbance & Noise', 'Police, Fire & EMS Contact']) {
      const f = categoryFields(cat(n));
      expect(['people', 'vehicles', 'police'].every((k) => f.sections.has(k as never))).toBe(true);
    }
    const m = categoryFields(cat('Medical & Injury'));
    expect(m.sections.has('ems') && m.sections.has('injury')).toBe(true);
    expect(m.sections.has('vehicles')).toBe(false);
  });
});

import { stampLines } from '../../src/media/compress';
describe('photo stamp (item 25)', () => {
  it('formats date/time (Pacific), site, GPS ± accuracy', () => {
    const [a, b] = stampLines({ at: new Date('2026-10-30T09:05:07Z'), lat: 47.382612, lng: -122.234601, accuracy: 11.6, site: 'Kent Station Market' });
    expect(a).toBe('Oct 30, 2026, 2:05:07 AM PDT · Kent Station Market');
    expect(b).toBe('GPS 47.38261, -122.23460 ±12 m · Lion Patrol');
    expect(stampLines({ at: new Date(), lat: null, lng: null, accuracy: null, site: 'X' })[1]).toBe('GPS unavailable · Lion Patrol');
  });
});

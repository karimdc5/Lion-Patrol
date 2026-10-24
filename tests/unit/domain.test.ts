import { describe, it, expect } from 'vitest';
import { evaluateScan, parseCheckpointCode } from '../../src/domain/tour';
import { validateIncident, emptyIncident } from '../../src/domain/incident';
import { distanceM } from '../../src/lib/geo';
import type { Category } from '../../src/data/types';

const cps = [1, 2, 3].map((seq) => ({ id: `c${seq}`, seq, lat: 47.38 + seq * 0.0001, lng: -122.23, radius_m: 40 }));
const base = { checkpoints: cps, runStartedAt: 0, now: 60_000, maxDurationMin: 30, distance: distanceM };

describe('evaluateScan', () => {
  it('in order, on site → no flags', () => {
    expect(evaluateScan({ ...base, checkpoint: cps[0]!, prior: [], fix: { lat: cps[0]!.lat, lng: -122.23, accuracy: 10 } }).flags).toEqual([]);
  });
  it('skipping ahead is out of order', () => {
    expect(evaluateScan({ ...base, checkpoint: cps[2]!, prior: [], fix: { lat: cps[2]!.lat, lng: -122.23, accuracy: 10 } }).flags).toContain('out_of_order');
  });
  it('repeat scan is a duplicate, not out of order', () => {
    const r = evaluateScan({ ...base, checkpoint: cps[0]!, prior: [{ checkpoint_id: 'c1', flags: [] }], fix: { lat: cps[0]!.lat, lng: -122.23, accuracy: 10 } });
    expect(r.flags).toEqual(['duplicate']);
  });
  it('late after max duration; off site when far; no_gps without fix', () => {
    expect(evaluateScan({ ...base, now: 31 * 60_000, checkpoint: cps[0]!, prior: [], fix: null }).flags).toEqual(['late', 'no_gps']);
    const far = evaluateScan({ ...base, checkpoint: cps[0]!, prior: [], fix: { lat: 47.39, lng: -122.23, accuracy: 10 } });
    expect(far.flags).toContain('off_site');
    expect(far.distance).toBeGreaterThan(900);
  });
  it('parses codes from URLs and human input', () => {
    expect(parseCheckpointCode('https://karimdc5.github.io/Lion-Patrol/q/7K4Q9XW2')).toBe('7K4Q9XW2');
    expect(parseCheckpointCode(' 7k4q-9xw2 ')).toBe('7K4Q9XW2');
    expect(parseCheckpointCode('KSM1FRNT')).toBe(parseCheckpointCode('ksm1-frnt'));
  });
});

describe('validateIncident', () => {
  const cat = (required: string[]): Category => ({ id: 'cat', org_id: 'o', name: 'X', color: '#fff', icon: 'note', sort: 0, hidden: false, required_fields: required, default_severity: 'low', use_for: 'both' });
  const valid = () => ({ ...emptyIncident('i', 'site', null), category_id: 'cat', description: 'Something happened at the dock.' });
  it('requires site, category and a real description', () => {
    expect(Object.keys(validateIncident(emptyIncident('i', null, null), cat([]), 0)).sort()).toEqual(['category', 'description', 'site']);
    expect(validateIncident(valid(), cat([]), 0)).toEqual({});
  });
  it('enforces per-category required fields', () => {
    const e = validateIncident(valid(), cat(['people', 'vehicles', 'police', 'photos']), 0);
    expect(Object.keys(e).sort()).toEqual(['people', 'photos', 'police', 'vehicles']);
    const f = { ...valid(), police_called: true };
    expect(validateIncident(f, cat(['police']), 0).police_case_no).toBeTruthy();
    expect(validateIncident({ ...f, police_case_no: '26-001234' }, cat(['police']), 0)).toEqual({});
    expect(validateIncident(valid(), cat(['photos']), 1)).toEqual({});
  });
  it('validates damage estimate format', () => {
    expect(validateIncident({ ...valid(), property_damage: true, damage_estimate_usd: 'lots' }, cat([]), 0).property_damage).toBeTruthy();
    expect(validateIncident({ ...valid(), property_damage: true, damage_estimate_usd: '$1,250.50' }, cat(['property_damage']), 0)).toEqual({});
  });
});

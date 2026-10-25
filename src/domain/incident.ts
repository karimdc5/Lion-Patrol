import type { Category } from '../data/types';
import seedCategories from './categories.seed.json';

export interface Person { role: 'subject' | 'witness' | 'victim' | 'reporting'; name: string; description: string; phone: string }
export interface Vehicle { plate: string; state: string; make: string; model: string; color: string; notes: string }
export interface IncidentForm {
  id: string;
  site_id: string | null;
  time_entry_id: string | null;
  category_id: string | null;
  subtype_id: string | null;
  title: string;
  occurred_at: string;
  location_text: string;
  lat: number | null; lng: number | null; accuracy_m: number | null;
  description: string;
  people: Person[];
  vehicles: Vehicle[];
  police_called: boolean | null;
  police_agency: string; police_case_no: string; officer_name: string;
  fire_called: boolean; ems_called: boolean;
  injury: boolean; injury_details: string;
  property_damage: boolean; damage_estimate_usd: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  client_rev: number;
  created_at: string;
}

export const REQUIRED_LABELS: Record<string, string> = {
  people: 'People involved', vehicles: 'Vehicles', police: 'Police contact', injury: 'Injury details',
  property_damage: 'Property damage', photos: 'Photos', witnesses: 'Witnesses',
};

export type FieldGroup = 'people' | 'vehicles' | 'police';
const SEED_FIELDS = new Map((seedCategories as Array<{ name: string; fields?: string[] }>).map((c) => [c.name.toLowerCase(), c.fields ?? []]));

/** Optional sections (people / vehicles / police) a category shows: per-category `fields` config in
 *  categories.seed.json, plus anything the category requires. Custom (non-default) categories show all. */
export function categoryFields(cat: Category | null | undefined): Set<FieldGroup> {
  if (!cat) return new Set();
  const seeded = SEED_FIELDS.get(cat.name.toLowerCase());
  const base = seeded ?? ['people', 'vehicles', 'police'];
  const req = cat.required_fields.flatMap((r) => (r === 'witnesses' ? ['people'] : [r]));
  return new Set([...base, ...req].filter((f): f is FieldGroup => f === 'people' || f === 'vehicles' || f === 'police'));
}

/** Returns field → message. Empty object means valid. */
export function validateIncident(f: IncidentForm, cat: Category | null | undefined, photoCount: number): Record<string, string> {
  const e: Record<string, string> = {};
  const req = new Set(cat?.required_fields ?? []);
  if (!f.site_id) e.site = 'Choose the site.';
  if (!f.category_id) e.category = 'Choose a category.';
  if (f.description.trim().length < 10) e.description = 'Describe what happened (at least a sentence).';
  if (!f.occurred_at) e.occurred_at = 'When did it happen?';
  if (req.has('people') && !f.people.some((p) => p.name.trim() || p.description.trim())) e.people = 'Add at least one person (name or description).';
  if (req.has('witnesses') && !f.people.some((p) => p.role === 'witness')) e.people = 'Add at least one witness.';
  if (req.has('vehicles') && !f.vehicles.some((v) => v.plate.trim() || v.make.trim() || v.color.trim())) e.vehicles = 'Add at least one vehicle.';
  if (req.has('police') && f.police_called === null) e.police = 'Say whether police were contacted.';
  if (f.police_called && !f.police_case_no.trim() && req.has('police')) e.police_case_no = 'Enter the police case/report number.';
  if (req.has('injury') && f.injury && !f.injury_details.trim()) e.injury = 'Describe the injury.';
  if (req.has('injury') && !f.injury && !f.injury_details.trim()) e.injury = 'Confirm whether anyone was injured and describe it.';
  if (req.has('property_damage') && f.property_damage && !f.damage_estimate_usd.trim()) e.property_damage = 'Enter a damage estimate (best guess is fine).';
  if (req.has('photos') && photoCount < 1) e.photos = 'Add at least one photo.';
  for (const p of f.people) if (p.phone && !/^[\d\s()+.-]{7,}$/.test(p.phone)) { e.people = 'Check the phone number format.'; break; }
  if (f.damage_estimate_usd && !/^\d+(\.\d{1,2})?$/.test(f.damage_estimate_usd.replace(/[$,]/g, ''))) e.property_damage = 'Enter the estimate as a number, e.g. 250.';
  return e;
}

export function emptyIncident(id: string, siteId: string | null, timeEntryId: string | null): IncidentForm {
  const now = new Date().toISOString();
  return {
    id, site_id: siteId, time_entry_id: timeEntryId, category_id: null, subtype_id: null, title: '', occurred_at: now,
    location_text: '', lat: null, lng: null, accuracy_m: null, description: '', people: [], vehicles: [],
    police_called: null, police_agency: '', police_case_no: '', officer_name: '', fire_called: false, ems_called: false,
    injury: false, injury_details: '', property_damage: false, damage_estimate_usd: '', severity: 'low', client_rev: 0, created_at: now,
  };
}

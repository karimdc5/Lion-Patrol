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
  /** Category-specific answers (ExtraField.key → value), stored in patrol_incidents.extra. */
  extra?: Record<string, string>;
  client_rev: number;
  created_at: string;
}

export const REQUIRED_LABELS: Record<string, string> = {
  people: 'People involved', vehicles: 'Vehicles', police: 'Police contact', injury: 'Injury details',
  property_damage: 'Property damage', photos: 'Photos', witnesses: 'Witnesses',
};

export type FieldGroup = 'people' | 'vehicles' | 'police' | 'ems' | 'injury' | 'damage';
export interface ExtraField { key: string; label: string; type: 'text' | 'yesno' | 'select'; options?: string[] }
export interface FieldConfig { sections: FieldGroup[]; extra: ExtraField[] }
const ALL: FieldGroup[] = ['people', 'vehicles', 'police', 'ems', 'injury', 'damage'];
const SEED = new Map((seedCategories as Array<{ name: string; field_config: FieldConfig }>).map((c) => [c.name.toLowerCase(), c.field_config]));
const REQ_TO_SECTION: Record<string, FieldGroup> = { people: 'people', witnesses: 'people', vehicles: 'vehicles', police: 'police', injury: 'injury', property_damage: 'damage' };

/** Which form sections and category-specific fields a category shows. Source: the category's
 *  `field_config` (seeded from categories.seed.json), else the default config by name; custom
 *  categories without one show every standard section. Required fields always show. */
export function categoryFields(cat: Category | null | undefined): { sections: Set<FieldGroup>; extra: ExtraField[] } {
  if (!cat) return { sections: new Set(), extra: [] };
  const cfg = cat.field_config ?? SEED.get(cat.name.toLowerCase()) ?? { sections: ALL, extra: [] };
  const req = cat.required_fields.map((r) => REQ_TO_SECTION[r]).filter((x): x is FieldGroup => !!x);
  return { sections: new Set([...cfg.sections, ...req]), extra: guardExtras(cfg.extra) };
}

/** Client visibility is the owner's call in admin review, never a field on the guard's form (item 11). */
const CLIENT_VISIBILITY_KEY = /^(client_notified|notify_client|client_visible|client_can_see|share_with_client)$/;
function guardExtras(extra: ExtraField[] | undefined): ExtraField[] {
  return (extra ?? []).filter((x) => !CLIENT_VISIBILITY_KEY.test(x.key));
}

const humanize = (k: string) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
/**
 * Category-specific answers (`incident.extra`) as label/value pairs for admin review, the client
 * portal and PDFs. Labels come from the category's field_config (or the seed by name); unknown keys
 * are humanized. Empty answers are skipped.
 */
export function extraDetails(incident: Record<string, unknown>, cat?: Pick<Category, 'name' | 'field_config'> | null): Array<[string, string]> {
  const extra = (incident.extra && typeof incident.extra === 'object' ? incident.extra : {}) as Record<string, unknown>;
  const cfg = (cat?.field_config ?? (incident.field_config as FieldConfig | null | undefined) ?? SEED.get(String(cat?.name ?? incident.category_name ?? '').toLowerCase())) as FieldConfig | null | undefined;
  const fields = cfg?.extra ?? [];
  const out: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const f of fields) {
    seen.add(f.key);
    const v = extra[f.key];
    if (v != null && String(v).trim() && !CLIENT_VISIBILITY_KEY.test(f.key)) out.push([f.label, String(v)]);
  }
  for (const [k, v] of Object.entries(extra)) if (!seen.has(k) && v != null && String(v).trim() && !CLIENT_VISIBILITY_KEY.test(k)) out.push([humanize(k), String(v)]);
  return out;
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

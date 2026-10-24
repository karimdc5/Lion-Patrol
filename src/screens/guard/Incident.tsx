import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Screen, TopBar, Button, Field, Empty, toast, Toggle, Segmented } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId, memberId, isStaff } from '../../auth/session';
import { categoriesFor, subtypesFor, sitesFor } from '../../data/repos/queries';
import { onShift, loadDraft, saveDraftLocal, syncDraft, submitIncident, discardDraft, listAttachments } from '../../data/guard';
import { emptyIncident, validateIncident, REQUIRED_LABELS, type IncidentForm, type Person, type Vehicle } from '../../domain/incident';
import { AttachmentTray } from '../../ui/Attachments';
import { getFix } from '../../lib/geo';
import { uuidv7 } from '../../lib/uuid';
import { navigate } from '../../router';
import { relTime } from '../../lib/format';
import { GuardRight } from './common';
import type { Category } from '../../data/types';

const RECENT_KEY = 'lp-recent-cats';
function recentCats(): string[] { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; } }
function pushRecent(id: string) { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentCats().filter((x) => x !== id)].slice(0, 6))); }

/** Step 1: big category grid with search; recent first. Picking one starts a draft. */
export function ReportStart() {
  const org = currentOrgId.value;
  const cats = useData(() => categoriesFor(org), [org]);
  const [q, setQ] = useState('');
  const recent = recentCats();
  const all = (cats.data ?? []).filter((c) => !c.hidden && c.use_for !== 'dar');
  const filtered = all.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  const ordered = q ? filtered : [...filtered.filter((c) => recent.includes(c.id)).sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id)), ...filtered.filter((c) => !recent.includes(c.id))];
  const start = async (c: Category) => {
    pushRecent(c.id);
    const te = onShift.value;
    const sites = await sitesFor(org, memberId.value, isStaff.value);
    const f = emptyIncident(uuidv7(), te?.site_id ?? sites[0]?.id ?? null, te?.id ?? null);
    f.category_id = c.id;
    f.severity = (c.default_severity as IncidentForm['severity']) ?? 'low';
    await saveDraftLocal(f);
    navigate(`/g/report/${f.id}`, { replace: false });
  };
  return (
    <Screen tabbar>
      <TopBar title="New incident" large right={<GuardRight />} sub="What happened?" />
      <div class="screen-body stack">
        <div style={{ position: 'relative' }}>
          <input class="input" placeholder="Search categories" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} style={{ paddingLeft: 42 }} aria-label="Search categories" data-testid="cat-search" />
          <span style={{ position: 'absolute', left: 14, top: 15, color: 'var(--text-3)' }}><Icon name="search" size={20} /></span>
        </div>
        {!q && recent.length > 0 && <div class="cap muted" style={{ padding: '4px 4px 0' }}>Recent first</div>}
        {ordered.length ? (
          <div class="grid-2" data-testid="category-grid">
            {ordered.map((c) => (
              <button key={c.id} class="cat-tile" onClick={() => void start(c)} data-testid="category-tile">
                <span class="list-icon" style={{ background: `${c.color}29`, color: c.color, width: 40, height: 40, borderRadius: 12 }}><Icon name={c.icon} /></span>
                <span class="cat-name">{c.name}</span>
              </button>
            ))}
          </div>
        ) : <Empty icon="search" title="No matching categories" />}
      </div>
    </Screen>
  );
}

/** Steps 2+: subtype → details → people/vehicles → contacts → attachments, autosaved on every change. */
export function IncidentEditor({ id }: { id: string }) {
  const org = currentOrgId.value;
  const [form, setForm] = useState<IncidentForm | null>(null);
  const [missing, setMissing] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const cats = useData(() => categoriesFor(org), [org]);
  const subs = useData(() => subtypesFor(org), [org]);
  const sites = useData(() => sitesFor(org, memberId.value, isStaff.value), [org]);
  const serverTimer = useRef<number>(0);
  const latest = useRef<IncidentForm | null>(null);
  const submitting = useRef(false); // double-tap guard (state updates are async)

  useEffect(() => { void loadDraft(id).then((d) => { if (d) { setForm(d); latest.current = d; } else setMissing(true); }); }, [id]);
  useEffect(() => {
    const flush = () => { if (latest.current) void saveDraftLocal(latest.current); };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', flush); clearTimeout(serverTimer.current); };
  }, []);

  const update = (patch: Partial<IncidentForm>) => {
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      latest.current = next;
      void saveDraftLocal(next).then(() => setSavedAt(Date.now()));
      clearTimeout(serverTimer.current);
      serverTimer.current = window.setTimeout(() => void syncDraft(next), 2500);
      return next;
    });
    if (Object.keys(errors).length) setErrors({});
  };

  const cat = useMemo(() => cats.data?.find((c) => c.id === form?.category_id) ?? null, [cats.data, form?.category_id]);
  if (missing) return (
    <Screen><TopBar title="Report" backTo="/g" /><div class="screen-body"><Empty icon="check-circle" title="This report was submitted" body="Submitted reports can’t be edited. Add an addendum from the dashboard." action={<Button onClick={() => navigate('/g')}>Back home</Button>} /></div></Screen>
  );
  if (!form) return <Screen><TopBar title="Report" backTo="/g" /><div class="screen-body" /></Screen>;
  const req = new Set(cat?.required_fields ?? []);
  const catSubs = (subs.data ?? []).filter((s) => s.category_id === form.category_id && !s.hidden);

  const submit = async () => {
    if (submitting.current) return;
    const photos = (await listAttachments(form.id)).filter((a) => a.kind === 'image').length;
    const e = validateIncident(form, cat, photos);
    setErrors(e);
    if (Object.keys(e).length) {
      toast('Fill in the highlighted fields.', 'error');
      const first = document.querySelector('[data-err="1"]');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true);
    submitting.current = true;
    try {
      clearTimeout(serverTimer.current);
      await submitIncident(latest.current ?? form);
      toast('Report submitted. Owners will be notified.');
      navigate('/g', { replace: true });
    } catch (er) { submitting.current = false; toast((er as Error).message, 'error'); } finally { setBusy(false); }
  };

  const dictate = () => {
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike; SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!SR) { toast('Tap the 🎤 on your keyboard to dictate.', 'info', 3500); return; }
    const r = new SR(); r.lang = 'en-US'; r.interimResults = false; r.continuous = false;
    r.onresult = (ev) => { const t = Array.from(ev.results).map((x) => x[0]!.transcript).join(' '); update({ description: (latest.current?.description ? latest.current.description + ' ' : '') + t }); };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    setListening(true); r.start();
  };

  const E = (k: string) => errors[k] ?? null;
  return (
    <Screen>
      <TopBar title={cat?.name ?? 'Incident'} backTo="/g" right={<GuardRight />} />
      <div class="screen-body stack-lg" style={{ paddingBottom: 120 }} data-testid="incident-form">
        <div class="row foot muted" style={{ justifyContent: 'space-between' }}>
          <span class="row" style={{ gap: 6 }}>{cat && <span class="list-icon" style={{ background: `${cat.color}29`, color: cat.color, width: 26, height: 26, borderRadius: 8 }}><Icon name={cat.icon} /></span>}
            <button class="link-btn" style={{ minHeight: 0 }} onClick={() => navigate('/g/report')}>Change category</button></span>
          <span data-testid="autosave">{savedAt ? `Saved · ${relTime(savedAt)}` : 'Draft saved on this phone'}</span>
        </div>

        {catSubs.length > 0 && (
          <div class="form-section">
            <div class="cap">Type</div>
            <div class="chip-row">{catSubs.map((s) => <button key={s.id} class={`chip ${form.subtype_id === s.id ? 'active' : ''}`} onClick={() => update({ subtype_id: form.subtype_id === s.id ? null : s.id, title: form.title || s.name })} data-testid="subtype-chip">{s.name}</button>)}</div>
          </div>
        )}

        <div class="form-section">
          <div class="cap">Details</div>
          {(sites.data?.length ?? 0) > 1 && (
            <Field label="Site" error={E('site')}>
              <select class="input" value={form.site_id ?? ''} onChange={(e) => update({ site_id: (e.target as HTMLSelectElement).value || null })} data-err={E('site') ? 1 : 0}>
                <option value="">Choose site…</option>
                {sites.data!.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Title"><input class="input" value={form.title} placeholder="Short summary" onInput={(e) => update({ title: (e.target as HTMLInputElement).value })} data-testid="inc-title" /></Field>
          <div class="grid-2">
            <Field label="When" error={E('occurred_at')}>
              <input class="input" type="datetime-local" value={toLocalInput(form.occurred_at)} onInput={(e) => { const v = (e.target as HTMLInputElement).value; if (v) update({ occurred_at: new Date(v).toISOString() }); }} />
            </Field>
            <Field label="Severity">
              <select class="input" value={form.severity} onChange={(e) => update({ severity: (e.target as HTMLSelectElement).value as IncidentForm['severity'] })} data-testid="inc-severity">
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
              </select>
            </Field>
          </div>
          <Field label="Where" hint={form.lat != null ? `GPS ${form.lat.toFixed(5)}, ${form.lng!.toFixed(5)} (±${Math.round(form.accuracy_m ?? 0)} m)` : undefined}>
            <div class="row">
              <input class="input grow" value={form.location_text} placeholder="e.g. Rear loading dock" onInput={(e) => update({ location_text: (e.target as HTMLInputElement).value })} />
              <Button icon="pin" aria-label="Use my location" onClick={async () => { const f = await getFix(8000); if (f) update({ lat: f.lat, lng: f.lng, accuracy_m: Math.round(f.accuracy) }); else toast('Location unavailable', 'error'); }}>GPS</Button>
            </div>
          </Field>
          <Field label="What happened" error={E('description')}>
            <div style={{ position: 'relative' }}>
              <textarea class={`input ${E('description') ? 'invalid' : ''}`} rows={6} value={form.description} data-err={E('description') ? 1 : 0}
                placeholder="Describe events in order: what you saw, what you did, who was involved, how it ended." onInput={(e) => update({ description: (e.target as HTMLTextAreaElement).value })} data-testid="inc-description" />
              <button type="button" class="icon-btn" style={{ position: 'absolute', right: 6, bottom: 6, background: listening ? 'var(--danger)' : 'var(--raised-2)' }} aria-label="Dictate" onClick={dictate}><Icon name="mic" /></button>
            </div>
          </Field>
        </div>

        <div class="form-section" data-err={E('people') ? 1 : 0}>
          <div class={`cap ${req.has('people') || req.has('witnesses') ? 'req' : ''}`}>People involved</div>
          {form.people.map((p, i) => <PersonCard key={i} p={p} onChange={(np) => update({ people: form.people.map((x, j) => (j === i ? np : x)) })} onRemove={() => update({ people: form.people.filter((_, j) => j !== i) })} />)}
          {E('people') && <div class="field-error">{E('people')}</div>}
          <Button icon="user-plus" onClick={() => update({ people: [...form.people, { role: 'subject', name: '', description: '', phone: '' }] })} data-testid="add-person">Add person</Button>
        </div>

        <div class="form-section" data-err={E('vehicles') ? 1 : 0}>
          <div class={`cap ${req.has('vehicles') ? 'req' : ''}`}>Vehicles</div>
          {form.vehicles.map((v, i) => <VehicleCard key={i} v={v} onChange={(nv) => update({ vehicles: form.vehicles.map((x, j) => (j === i ? nv : x)) })} onRemove={() => update({ vehicles: form.vehicles.filter((_, j) => j !== i) })} />)}
          {E('vehicles') && <div class="field-error">{E('vehicles')}</div>}
          <Button icon="car" onClick={() => update({ vehicles: [...form.vehicles, { plate: '', state: 'WA', make: '', model: '', color: '', notes: '' }] })} data-testid="add-vehicle">Add vehicle</Button>
        </div>

        <div class="form-section" data-err={E('police') || E('police_case_no') ? 1 : 0}>
          <div class={`cap ${req.has('police') ? 'req' : ''}`}>Police, fire & EMS</div>
          <div class="subform">
            <div class="foot muted">Were police contacted?</div>
            <div class="yn">
              <button class={form.police_called === true ? 'on' : ''} onClick={() => update({ police_called: true })} data-testid="police-yes">Yes</button>
              <button class={form.police_called === false ? 'on' : ''} onClick={() => update({ police_called: false })} data-testid="police-no">No</button>
            </div>
            {E('police') && <div class="field-error">{E('police')}</div>}
            {form.police_called && (
              <>
                <div class="grid-2">
                  <Field label="Agency"><input class="input" value={form.police_agency} placeholder="Kent PD" onInput={(e) => update({ police_agency: (e.target as HTMLInputElement).value })} /></Field>
                  <Field label="Case / report #" error={E('police_case_no')}><input class="input" value={form.police_case_no} onInput={(e) => update({ police_case_no: (e.target as HTMLInputElement).value })} data-testid="police-case" /></Field>
                </div>
                <Field label="Officer name / badge"><input class="input" value={form.officer_name} onInput={(e) => update({ officer_name: (e.target as HTMLInputElement).value })} /></Field>
              </>
            )}
            <div class="row-between"><span>Fire department contacted</span><Toggle label="Fire department contacted" checked={form.fire_called} onChange={(v) => update({ fire_called: v })} /></div>
            <div class="row-between"><span>EMS contacted</span><Toggle label="EMS contacted" checked={form.ems_called} onChange={(v) => update({ ems_called: v })} /></div>
          </div>
        </div>

        {(req.has('injury') || form.injury) && (
          <div class="form-section" data-err={E('injury') ? 1 : 0}>
            <div class="cap req">Injury</div>
            <div class="subform">
              <div class="row-between"><span>Someone was injured</span><Toggle label="Someone was injured" checked={form.injury} onChange={(v) => update({ injury: v })} /></div>
              <Field label={form.injury ? 'Describe injuries and care given' : 'Notes (e.g. “No injuries”)'} error={E('injury')}><textarea class="input" rows={2} value={form.injury_details} onInput={(e) => update({ injury_details: (e.target as HTMLTextAreaElement).value })} /></Field>
            </div>
          </div>
        )}
        <div class="form-section" data-err={E('property_damage') ? 1 : 0}>
          <div class={`cap ${req.has('property_damage') ? 'req' : ''}`}>Property damage</div>
          <div class="subform">
            <div class="row-between"><span>Property was damaged or stolen</span><Toggle label="Property damaged" checked={form.property_damage} onChange={(v) => update({ property_damage: v })} /></div>
            {form.property_damage && <Field label="Estimated value (USD)" error={E('property_damage')}><input class="input" inputMode="decimal" value={form.damage_estimate_usd} placeholder="250" onInput={(e) => update({ damage_estimate_usd: (e.target as HTMLInputElement).value })} /></Field>}
          </div>
          {!form.property_damage && E('property_damage') && <div class="field-error">{E('property_damage')}</div>}
        </div>

        <div class="form-section" data-err={E('photos') ? 1 : 0}>
          <div class={`cap ${req.has('photos') ? 'req' : ''}`}>Photos, video & files</div>
          <AttachmentTray parentType="incident" parentId={form.id} ensureParent={() => syncDraft(latest.current ?? form)} />
          {E('photos') && <div class="field-error">{E('photos')}</div>}
        </div>

        {req.size > 0 && <p class="foot faint">Required for {cat?.name}: {[...req].map((r) => REQUIRED_LABELS[r] ?? r).join(', ')}.</p>}
        <button class="link-btn" style={{ color: 'var(--text-3)', alignSelf: 'center' }} onClick={async () => { if (confirm('Delete this draft? This can’t be undone.')) { await discardDraft(form.id); navigate('/g', { replace: true }); } }}>Delete draft</button>
      </div>
      <div class="sticky-bar">
        <Button variant="primary" size="lg" block loading={busy} onClick={() => void submit()} data-testid="inc-submit">Submit report</Button>
      </div>
    </Screen>
  );
}

interface SpeechRecognitionLike { lang: string; interimResults: boolean; continuous: boolean; start(): void; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void }

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

function PersonCard({ p, onChange, onRemove }: { p: Person; onChange: (p: Person) => void; onRemove: () => void }) {
  return (
    <div class="subform" data-testid="person-card">
      <div class="row-between">
        <Segmented value={p.role} options={[['subject', 'Subject'], ['witness', 'Witness'], ['victim', 'Victim'], ['reporting', 'Reporter']]} onChange={(role) => onChange({ ...p, role })} />
        <button class="icon-btn" aria-label="Remove person" onClick={onRemove}><Icon name="trash" /></button>
      </div>
      <input class="input" placeholder="Name (or “Unknown”)" value={p.name} onInput={(e) => onChange({ ...p, name: (e.target as HTMLInputElement).value })} data-testid="person-name" />
      <input class="input" placeholder="Description: age, height, clothing" value={p.description} onInput={(e) => onChange({ ...p, description: (e.target as HTMLInputElement).value })} />
      <input class="input" type="tel" placeholder="Phone (optional)" value={p.phone} onInput={(e) => onChange({ ...p, phone: (e.target as HTMLInputElement).value })} />
    </div>
  );
}

function VehicleCard({ v, onChange, onRemove }: { v: Vehicle; onChange: (v: Vehicle) => void; onRemove: () => void }) {
  return (
    <div class="subform" data-testid="vehicle-card">
      <div class="row-between"><b>Vehicle</b><button class="icon-btn" aria-label="Remove vehicle" onClick={onRemove}><Icon name="trash" /></button></div>
      <div class="grid-2">
        <input class="input input-code" placeholder="Plate" value={v.plate} onInput={(e) => onChange({ ...v, plate: (e.target as HTMLInputElement).value.toUpperCase() })} data-testid="vehicle-plate" />
        <input class="input" placeholder="State" value={v.state} onInput={(e) => onChange({ ...v, state: (e.target as HTMLInputElement).value.toUpperCase() })} />
        <input class="input" placeholder="Make" value={v.make} onInput={(e) => onChange({ ...v, make: (e.target as HTMLInputElement).value })} />
        <input class="input" placeholder="Model" value={v.model} onInput={(e) => onChange({ ...v, model: (e.target as HTMLInputElement).value })} />
      </div>
      <input class="input" placeholder="Color / notes" value={v.color} onInput={(e) => onChange({ ...v, color: (e.target as HTMLInputElement).value })} />
    </div>
  );
}

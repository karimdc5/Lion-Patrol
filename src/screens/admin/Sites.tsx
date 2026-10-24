import { useEffect, useRef, useState } from 'preact/hooks';
import { Screen, TopBar, SyncPill, List, Row, Empty, SkeletonList, Button, Field, Toggle, Sheet, toast, SectionLabel, Avatar } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { lazyScreen } from '../../ui/lazy';
import { currentOrgId, isAdmin } from '../../auth/session';
import { sitesFor, checkpointsFor, membersFor } from '../../data/repos/queries';
import { getRecord, listRecords } from '../../data/repos/records';
import { newSite, saveSite, saveCheckpoint, reorderCheckpoints, genCode, setSiteAccess } from '../../data/admin';
import { getFix } from '../../lib/geo';
import { sanitizeHtml } from '../../lib/sanitize';
import { navigate } from '../../router';
import { uuidv7 } from '../../lib/uuid';
import { showPdf } from '../../ui/PdfReady';
import { roleLabel, fmtDate } from '../../lib/format';
import type { Checkpoint, Site, SiteAccess } from '../../data/types';

const MapView = lazyScreen(() => import('../../ui/MapView'), () => <div class="map-box skel" />);

export function SitesList() {
  const org = currentOrgId.value;
  const sites = useData(() => listRecords<Site>('patrol_sites', org), [org]);
  const cps = useData(() => checkpointsFor(org), [org]);
  const list = (sites.data ?? []).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  return (
    <Screen tabbar>
      <TopBar title="Sites" large right={<>{isAdmin.value && <Button variant="primary" icon="plus" onClick={() => navigate('/a/sites/new')} data-testid="add-site">Add</Button>}<SyncPill /></>} />
      <div class="screen-body">
        {sites.loading ? <SkeletonList /> : list.length ? (
          <List>
            {list.map((s) => (
              <Row key={s.id} testid="site-admin-row" icon={s.kind === 'apartment' ? 'building' : 'store'} iconBg="var(--gold-soft)" iconColor="var(--gold)" title={s.name}
                sub={`${[s.address, s.city].filter(Boolean).join(', ') || 'No address'} · ${(cps.data ?? []).filter((c) => c.site_id === s.id).length} checkpoints`}
                right={s.active ? undefined : <span class="pill pill-muted">Inactive</span>} chevron href={`/a/sites/${s.id}`} />
            ))}
          </List>
        ) : <Empty icon="building" title="No sites yet" body="Add your first client site to start patrols." action={isAdmin.value ? <Button variant="primary" onClick={() => navigate('/a/sites/new')}>Add site</Button> : undefined} />}
      </div>
    </Screen>
  );
}

type Tab = 'details' | 'orders' | 'checkpoints' | 'contacts' | 'access';

export function SiteEditor({ id }: { id: string }) {
  const isNew = id === 'new';
  const admin = isAdmin.value;
  const [site, setSite] = useState<Site | null>(null);
  const [tab, setTab] = useState<Tab>('details');
  const [dirty, setDirty] = useState(false);
  const [ordersChanged, setOrdersChanged] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void (async () => setSite(isNew ? newSite() : ((await getRecord<Site>('patrol_sites', id)) ?? null)))(); }, [id]);
  if (!site) return <Screen><TopBar title="Site" backTo="/a/sites" /><div class="screen-body"><SkeletonList rows={3} /></div></Screen>;
  const up = (p: Partial<Site>) => { setSite({ ...site, ...p }); setDirty(true); };
  const save = async () => {
    if (!site.name.trim()) { setErr('Give the site a name.'); setTab('details'); return; }
    await saveSite(site, ordersChanged);
    setDirty(false); setOrdersChanged(false);
    toast(isNew ? 'Site created' : 'Site saved');
    if (isNew) navigate(`/a/sites/${site.id}`, { replace: true });
  };
  return (
    <Screen>
      <TopBar title={isNew ? 'New site' : site.name} backTo="/a/sites" right={<SyncPill />} />
      <div class="screen-body stack" style={{ paddingBottom: 110 }}>
        {!isNew && (
          <div class="tabs" role="tablist">
            {([['details', 'Details'], ['orders', 'Post orders'], ['checkpoints', 'Checkpoints'], ['contacts', 'Contacts'], ['access', 'People']] as Array<[Tab, string]>).map(([k, l]) => (
              <button key={k} class={tab === k ? 'active' : ''} onClick={() => setTab(k)} data-testid={`site-tab-${k}`}>{l}</button>
            ))}
          </div>
        )}
        {tab === 'details' && (
          <div class="stack">
            <Field label="Site name" error={err}><input class="input" value={site.name} disabled={!admin} onInput={(e) => { up({ name: (e.target as HTMLInputElement).value }); setErr(null); }} placeholder="Kent Station Market" data-testid="site-name" /></Field>
            <div class="grid-2">
              <Field label="Short code" hint="Used in report numbers"><input class="input input-code" value={site.code ?? ''} disabled={!admin} maxLength={6} onInput={(e) => up({ code: (e.target as HTMLInputElement).value.toUpperCase() })} placeholder="KSM" data-testid="site-code" /></Field>
              <Field label="Type"><select class="input" value={site.kind} disabled={!admin} onChange={(e) => up({ kind: (e.target as HTMLSelectElement).value as Site['kind'] })}><option value="retail">Retail store</option><option value="apartment">Apartments</option><option value="other">Other</option></select></Field>
            </div>
            <Field label="Street address"><input class="input" value={site.address ?? ''} disabled={!admin} onInput={(e) => up({ address: (e.target as HTMLInputElement).value })} autoComplete="street-address" /></Field>
            <div class="grid-2">
              <Field label="City"><input class="input" value={site.city ?? ''} disabled={!admin} onInput={(e) => up({ city: (e.target as HTMLInputElement).value })} /></Field>
              <Field label="ZIP"><input class="input" inputMode="numeric" value={site.zip ?? ''} disabled={!admin} onInput={(e) => up({ zip: (e.target as HTMLInputElement).value })} /></Field>
            </div>
            <SectionLabel>Map pin & geofence</SectionLabel>
            <div class="card stack">
              <div class="row-between"><span class="foot muted">{site.lat != null ? `${site.lat.toFixed(5)}, ${site.lng!.toFixed(5)}` : 'No pin yet'}</span>
                {admin && <span class="row" style={{ gap: 6 }}>
                  <Button icon="pin" onClick={async () => { const f = await getFix(8000); if (f) up({ lat: f.lat, lng: f.lng }); else toast('Location unavailable', 'error'); }}>Here</Button>
                  <Button icon="map" onClick={() => setMapOpen(true)} data-testid="pick-map">Map</Button>
                </span>}
              </div>
              <Field label={`Geofence radius · ${site.geofence_m} m`}><input type="range" min={50} max={500} step={10} value={site.geofence_m} disabled={!admin} onInput={(e) => up({ geofence_m: Number((e.target as HTMLInputElement).value) })} /></Field>
            </div>
            <SectionLabel>Patrol tour</SectionLabel>
            <div class="grid-2">
              <Field label="Tour every (min)"><input class="input" inputMode="numeric" value={String(site.tour_interval_min ?? '')} disabled={!admin} onInput={(e) => up({ tour_interval_min: Number((e.target as HTMLInputElement).value) || null })} /></Field>
              <Field label="Finish within (min)"><input class="input" inputMode="numeric" value={String(site.tour_max_duration_min ?? '')} disabled={!admin} onInput={(e) => up({ tour_max_duration_min: Number((e.target as HTMLInputElement).value) || null })} /></Field>
            </div>
            {!isNew && <div class="card row-between"><span>Active site<div class="foot muted">Inactive sites are hidden from guards.</div></span><Toggle label="Active" checked={site.active} onChange={(v) => admin && up({ active: v })} /></div>}
          </div>
        )}
        {tab === 'orders' && <PostOrdersEditor html={site.post_orders_html} updated={site.post_orders_updated_at} disabled={!admin} onChange={(h) => { up({ post_orders_html: h }); setOrdersChanged(true); }} />}
        {tab === 'checkpoints' && <CheckpointsTab site={site} />}
        {tab === 'contacts' && <ContactsTab site={site} disabled={!admin} onChange={(contacts) => up({ contacts })} />}
        {tab === 'access' && <AccessTab site={site} disabled={!admin} />}
      </div>
      {admin && (tab === 'details' || tab === 'orders' || tab === 'contacts') && (
        <div class="sticky-bar"><Button variant="primary" size="lg" block onClick={() => void save()} disabled={!dirty && !isNew} data-testid="site-save">{isNew ? 'Create site' : 'Save changes'}</Button></div>
      )}
      <Sheet open={mapOpen} onClose={() => setMapOpen(false)} title="Tap to place the pin">
        <MapView center={{ lat: site.lat ?? 47.3809, lng: site.lng ?? -122.2348 }} zoom={site.lat ? 17 : 12} height={340} markers={site.lat != null ? [{ lat: site.lat, lng: site.lng!, label: site.name || 'Site' }] : []} onPick={(p) => up({ lat: p.lat, lng: p.lng })} />
        <Button variant="primary" block style={{ marginTop: 12 }} onClick={() => setMapOpen(false)}>Done</Button>
      </Sheet>
    </Screen>
  );
}

function PostOrdersEditor({ html, updated, disabled, onChange }: { html: string; updated: string | null; disabled: boolean; onChange: (h: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.innerHTML = sanitizeHtml(html || ''); }, []);
  const cmd = (c: string, v?: string) => { document.execCommand(c, false, v); ref.current?.focus(); emit(); };
  const emit = () => { if (ref.current) onChange(sanitizeHtml(ref.current.innerHTML)); };
  return (
    <div class="stack">
      <p class="foot muted">Guards read these at the post, even offline.{updated ? ` Last updated ${fmtDate(updated)}.` : ''}</p>
      {!disabled && (
        <div class="editor-bar">
          <button class="mini-btn" aria-label="Bold" onClick={() => cmd('bold')}><b>B</b></button>
          <button class="mini-btn" aria-label="Italic" onClick={() => cmd('italic')}><i>I</i></button>
          <button class="mini-btn" aria-label="Heading" onClick={() => cmd('formatBlock', 'h2')}>H</button>
          <button class="mini-btn" aria-label="Paragraph" onClick={() => cmd('formatBlock', 'p')}>¶</button>
          <button class="mini-btn" aria-label="Bulleted list" onClick={() => cmd('insertUnorderedList')}><Icon name="activity" /></button>
          <button class="mini-btn" aria-label="Numbered list" onClick={() => cmd('insertOrderedList')}>1.</button>
        </div>
      )}
      <div ref={ref} class="editor prose" contentEditable={!disabled} onInput={emit} data-testid="post-orders-editor" aria-label="Post orders" role="textbox" aria-multiline="true" />
    </div>
  );
}

function CheckpointsTab({ site }: { site: Site }) {
  const admin = isAdmin.value;
  const all = useData(() => listRecords<Checkpoint>('patrol_checkpoints', site.org_id), [site.id]);
  const list = (all.data ?? []).filter((c) => c.site_id === site.id).sort((a, b) => a.seq - b.seq);
  const active = list.filter((c) => c.active);
  const [edit, setEdit] = useState<Checkpoint | null>(null);
  const [busy, setBusy] = useState(false);
  const move = async (i: number, dir: -1 | 1) => {
    const arr = [...list]; const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    await reorderCheckpoints(arr);
  };
  return (
    <div class="stack">
      <div class="card row-between">
        <span><b>{active.length} active checkpoint{active.length === 1 ? '' : 's'}</b><div class="foot muted">Tour order is the list order. Tours every {site.tour_interval_min ?? 60} min.</div></span>
        <Button icon="qr" disabled={!active.length} loading={busy} data-testid="qr-sheet" onClick={async () => {
          setBusy(true);
          try { const { qrSheetPdf } = await import('../../pdf'); const r = await qrSheetPdf(site, active); showPdf(r.bytes, r.filename, r.pages); }
          catch (e) { toast(`PDF failed: ${(e as Error).message}`, 'error'); } finally { setBusy(false); }
        }}>QR sheet</Button>
      </div>
      {list.length ? (
        <List>
          {list.map((c, i) => (
            <div class="list-row" key={c.id} data-testid="cp-admin-row">
              <span class="list-icon" style={{ background: c.active ? 'var(--gold-soft)' : 'var(--raised-2)', color: c.active ? 'var(--gold)' : 'var(--text-3)' }}><b class="tnum" style={{ fontSize: 14 }}>{c.seq}</b></span>
              <button class="grow" style={{ textAlign: 'left', minWidth: 0 }} onClick={() => setEdit(c)}>
                <span class="ellipsis" style={{ display: 'block', fontWeight: 500, color: c.active ? undefined : 'var(--text-3)' }}>{c.name}</span>
                <span class="foot muted">{c.code.slice(0, 4)}-{c.code.slice(4)}{c.active ? '' : ' · disabled'}</span>
              </button>
              {admin && <><button class="mini-btn" aria-label="Move up" disabled={i === 0} onClick={() => void move(i, -1)}><Icon name="chevron-down" style={{ transform: 'rotate(180deg)' }} /></button>
                <button class="mini-btn" aria-label="Move down" disabled={i === list.length - 1} onClick={() => void move(i, 1)}><Icon name="chevron-down" /></button></>}
            </div>
          ))}
        </List>
      ) : <Empty icon="qr" title="No checkpoints yet" body="Add the spots guards must scan on each patrol." />}
      {admin && <Button icon="plus" block onClick={() => setEdit({ id: uuidv7(), org_id: site.org_id, site_id: site.id, name: '', seq: list.length + 1, code: genCode(), lat: null, lng: null, radius_m: 40, instructions: null, active: true })} data-testid="add-checkpoint">Add checkpoint</Button>}
      <CheckpointSheet cp={edit} onClose={() => setEdit(null)} disabled={!admin} />
    </div>
  );
}

function CheckpointSheet({ cp, onClose, disabled }: { cp: Checkpoint | null; onClose: () => void; disabled: boolean }) {
  const [c, setC] = useState<Checkpoint | null>(cp);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setC(cp); setErr(null); }, [cp?.id]);
  if (!c) return null;
  return (
    <Sheet open={!!cp} onClose={onClose} title={cp?.name ? 'Edit checkpoint' : 'New checkpoint'} testid="checkpoint-sheet"
      footer={!disabled && <Button variant="primary" size="lg" block data-testid="cp-save" onClick={async () => {
        if (!c.name.trim()) { setErr('Name the checkpoint, e.g. “Loading dock door”.'); return; }
        await saveCheckpoint(c); toast('Checkpoint saved'); onClose();
      }}>Save checkpoint</Button>}>
      <div class="stack">
        <Field label="Name" error={err}><input class="input" value={c.name} disabled={disabled} onInput={(e) => setC({ ...c, name: (e.target as HTMLInputElement).value })} placeholder="Loading dock door" data-testid="cp-name" /></Field>
        <Field label="Instructions for guards (optional)"><textarea class="input" rows={2} value={c.instructions ?? ''} disabled={disabled} onInput={(e) => setC({ ...c, instructions: (e.target as HTMLTextAreaElement).value })} placeholder="Check roll-up door is down and padlocked." /></Field>
        <div class="grid-2">
          <Field label="Code"><input class="input input-code" value={`${c.code.slice(0, 4)}-${c.code.slice(4)}`} disabled /></Field>
          <Field label="Radius (m)"><input class="input" inputMode="numeric" value={String(c.radius_m)} disabled={disabled} onInput={(e) => setC({ ...c, radius_m: Number((e.target as HTMLInputElement).value) || 40 })} /></Field>
        </div>
        {!disabled && <Button icon="pin" onClick={async () => { const f = await getFix(8000); if (f) { setC({ ...c, lat: f.lat, lng: f.lng }); toast('Location set'); } }}>{c.lat != null ? `Pin set (${c.lat.toFixed(4)}, ${c.lng!.toFixed(4)}) · update` : 'Set pin to my location'}</Button>}
        <div class="row-between"><span>Active<div class="foot muted">Disabled checkpoints are skipped on tours.</div></span><Toggle label="Active" checked={c.active} onChange={(v) => !disabled && setC({ ...c, active: v })} /></div>
      </div>
    </Sheet>
  );
}

function ContactsTab({ site, disabled, onChange }: { site: Site; disabled: boolean; onChange: (c: Site['contacts']) => void }) {
  const list = site.contacts ?? [];
  const set = (i: number, p: Partial<Site['contacts'][number]>) => onChange(list.map((c, j) => (j === i ? { ...c, ...p } : c)));
  return (
    <div class="stack">
      {list.map((c, i) => (
        <div class="subform" key={i}>
          <div class="row-between"><b>Contact {i + 1}</b>{!disabled && <button class="icon-btn" aria-label="Remove contact" onClick={() => onChange(list.filter((_, j) => j !== i))}><Icon name="trash" /></button>}</div>
          <div class="grid-2">
            <input class="input" placeholder="Name" value={c.name} disabled={disabled} onInput={(e) => set(i, { name: (e.target as HTMLInputElement).value })} />
            <input class="input" placeholder="Role" value={c.role ?? ''} disabled={disabled} onInput={(e) => set(i, { role: (e.target as HTMLInputElement).value })} />
            <input class="input" type="tel" placeholder="Phone" value={c.phone ?? ''} disabled={disabled} onInput={(e) => set(i, { phone: (e.target as HTMLInputElement).value })} />
            <input class="input" type="email" placeholder="Email" value={c.email ?? ''} disabled={disabled} onInput={(e) => set(i, { email: (e.target as HTMLInputElement).value })} />
          </div>
        </div>
      ))}
      {!list.length && <Empty icon="phone" title="No contacts" body="Add the store manager, property office and police non-emergency line." />}
      {!disabled && <Button icon="plus" block onClick={() => onChange([...list, { name: '', role: '', phone: '', email: '' }])}>Add contact</Button>}
    </div>
  );
}

function AccessTab({ site, disabled }: { site: Site; disabled: boolean }) {
  const members = useData(() => membersFor(site.org_id), [site.id]);
  const access = useData(() => listRecords<SiteAccess>('patrol_site_access', site.org_id), [site.id]);
  const has = (mid: string) => (access.data ?? []).some((a) => a.site_id === site.id && a.member_id === mid);
  const group = (roles: string[]) => (members.data ?? []).filter((m) => roles.includes(m.role) && m.status === 'active');
  return (
    <div class="stack">
      <p class="foot muted">Guards see this site’s post orders and checkpoints. Clients see only reports you share for this site. Owners, admins and supervisors already see every site.</p>
      {[['Guards', ['guard']], ['Clients', ['client']]].map(([label, roles]) => (
        <div key={label as string}>
          <SectionLabel>{label as string}</SectionLabel>
          {group(roles as string[]).length ? (
            <List>
              {group(roles as string[]).map((m) => (
                <div class="list-row" key={m.id}>
                  <Avatar name={m.display_name} />
                  <span class="grow"><span style={{ display: 'block', fontWeight: 500 }}>{m.display_name}</span><span class="foot muted">{roleLabel(m.role)}</span></span>
                  <Toggle label={`${m.display_name} assigned`} checked={has(m.id)} onChange={(v) => !disabled && void setSiteAccess(site.id, m.id, v)} />
                </div>
              ))}
            </List>
          ) : <p class="muted sub" style={{ padding: '0 4px' }}>No {String(label).toLowerCase()} yet. Invite them from People.</p>}
        </div>
      ))}
    </div>
  );
}

export { sitesFor };

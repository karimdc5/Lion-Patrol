import { useEffect, useRef, useState } from 'preact/hooks';
import { Screen, TopBar, SyncPill, List, Row, Empty, SkeletonList, Button, Field, Toggle, Sheet, toast, SectionLabel, Avatar } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { lazyScreen } from '../../ui/lazy';
import { currentOrgId, isAdmin } from '../../auth/session';
import { sitesFor, checkpointsFor, membersFor } from '../../data/repos/queries';
import { getRecord, listRecords } from '../../data/repos/records';
import { setSitePhoto, newSite, saveSite, saveCheckpoint, reorderCheckpoints, genCode, setSiteAccess, listPortalLinks, fetchPortalLinks, createPortalLink, revokePortalLink } from '../../data/admin';
import { PUBLIC_URL } from '../../config';
import { isNetworkError } from '../../data/backend/types';
import { getFix } from '../../lib/geo';
import { sanitizeHtml } from '../../lib/sanitize';
import { navigate } from '../../router';
import { uuidv7 } from '../../lib/uuid';
import { showPdf } from '../../ui/PdfReady';
import { roleLabel, fmtDate } from '../../lib/format';
import type { Bolo, Checkpoint, Site, SiteAccess } from '../../data/types';
import { setBoloStatus } from '../../data/guard';
import { BoloCard } from '../../ui/BoloCard';
import { AttachmentTray } from '../../ui/Attachments';
import { SiteThumb, SiteHeaderPhoto, siteCover } from '../../ui/SitePhoto';
import { siteCodes, saveSiteCodes, listAcks } from '../../data/postOrders';
import { fetchBilling, siteBilling, saveSiteBilling } from '../../data/owner';

const MapView = lazyScreen(() => import('../../ui/MapView'), () => <div class="map-box skel" />);

export function SitesList() {
  const org = currentOrgId.value;
  const sites = useData(() => listRecords<Site>('patrol_sites', org), [org]);
  const cps = useData(() => checkpointsFor(org), [org]);
  const list = (sites.data ?? []).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  return (
    <Screen tabbar>
      <TopBar title="Sites" large right={<SyncPill />} action={isAdmin.value ? <Button variant="primary" icon="plus" onClick={() => navigate('/a/sites/new')} data-testid="add-site">Add site</Button> : undefined} />
      <div class="screen-body">
        {sites.loading ? <SkeletonList /> : list.length ? (
          <List>
            {list.map((s) => (
              <Row key={s.id} testid="site-admin-row" media={<SiteThumb siteId={s.id} kind={s.kind} />} title={s.name}
                sub={`${[s.address, s.city].filter(Boolean).join(', ') || 'No address'} · ${(cps.data ?? []).filter((c) => c.site_id === s.id).length} checkpoints`}
                right={s.active ? undefined : <span class="pill pill-muted">Inactive</span>} chevron href={`/a/sites/${s.id}`} />
            ))}
          </List>
        ) : <Empty icon="building" title="No sites yet" body="Add your first client site to start patrols." action={isAdmin.value ? <Button variant="primary" onClick={() => navigate('/a/sites/new')}>Add site</Button> : undefined} />}
      </div>
    </Screen>
  );
}

type Tab = 'details' | 'orders' | 'checkpoints' | 'contacts' | 'access' | 'bolos' | 'portal';

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
        {!isNew && <SiteHeaderPhoto siteId={site.id} />}
        {!isNew && (
          <div class="tabs" role="tablist">
            {([['details', 'Details'], ['orders', 'Post orders'], ['checkpoints', 'Checkpoints'], ['contacts', 'Contacts'], ['access', 'People'], ['bolos', 'BOLOs'], ['portal', 'Client portal']] as Array<[Tab, string]>).map(([k, l]) => (
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
            {!isNew && <SitePhotoField siteId={site.id} admin={admin} />}
            {!isNew && admin && <SiteBillingField siteId={site.id} />}
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
        {tab === 'orders' && !isNew && <SiteCodesEditor siteId={site.id} admin={admin} />}
        {tab === 'orders' && !isNew && <AckList siteId={site.id} />}
        {tab === 'checkpoints' && <CheckpointsTab site={site} />}
        {tab === 'contacts' && <ContactsTab site={site} disabled={!admin} onChange={(contacts) => up({ contacts })} />}
        {tab === 'access' && <AccessTab site={site} disabled={!admin} />}
        {tab === 'bolos' && <BolosTab site={site} />}
        {tab === 'portal' && <PortalTab site={site} />}
      </div>
      {admin && (dirty || isNew) && (tab === 'details' || tab === 'orders' || tab === 'contacts') && (
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

function BolosTab({ site }: { site: Site }) {
  const org = currentOrgId.value;
  const list = useData(async () => (await listRecords<Bolo>('patrol_bolos', org)).filter((b) => b.site_id === site.id && b.status !== 'archived').sort((a, b) => b.created_at.localeCompare(a.created_at)), [org, site.id]);
  const rows = list.data ?? [];
  return (
    <div class="stack">
      <p class="foot muted">Be On the Lookout alerts guards post for this site. Active ones are pinned for guards (and on the client portal when shared).</p>
      {!rows.length ? <Empty icon="eye" title="No BOLOs" body="Guards post BOLOs from their Home screen." /> : rows.map((b) => (
        <div key={b.id} class="stack" data-testid="admin-bolo">
          <BoloCard b={b}><AttachmentTray parentType="bolo" parentId={b.id} editable={false} label="Photos" /></BoloCard>
          <div class="row" style={{ gap: 8 }}>
            <span class={`pill ${b.status === 'active' ? 'pill-danger' : 'pill-muted'}`}>{b.status === 'active' ? 'Active' : 'Resolved'}</span>
            {b.visible_to_client && <span class="pill pill-muted">On client portal</span>}
            <span class="grow" />
            {b.status === 'active' && <Button onClick={() => void setBoloStatus(b, 'resolved')} data-testid="bolo-resolve">Resolve</Button>}
            <Button variant="outline" onClick={() => void setBoloStatus(b, 'archived')} data-testid="bolo-archive">Archive</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function PortalTab({ site }: { site: Site }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { void fetchPortalLinks(site.id); }, [site.id, tick]);
  const links = useData(() => listPortalLinks(site.id), [site.id]);
  const [days, setDays] = useState(90);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? `${location.origin}${import.meta.env.BASE_URL}` : PUBLIC_URL;
  const url = fresh ? `${base}p/${fresh}` : '';
  const active = (links.data ?? []).filter((l) => !l.revoked_at && (!l.expires_at || Date.parse(String(l.expires_at)) > Date.now()));
  return (
    <div class="stack">
      <p class="foot muted">A read-only page for this site’s client: shared incident reports, daily reports and patrol proof, with PDF downloads. No login needed. Internal notes are never included. Copy or share it yourself; Lion Patrol never sends it.</p>
      {fresh ? (
        <div class="card stack" data-testid="portal-link-ready">
          <b>Link ready</b>
          <div class="foot" style={{ wordBreak: 'break-all', color: 'var(--gold)' }} data-testid="portal-url">{url}</div>
          <div class="grid-2">
            <Button icon="copy" onClick={async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast('Copy failed — select the link to copy', 'error'); } }}>Copy</Button>
            {typeof navigator.share === 'function' ? <Button variant="primary" icon="share" onClick={() => void navigator.share({ title: `${site.name} — security reports`, url }).catch(() => undefined)}>Share</Button> : <a class="btn" href={url} target="_blank" rel="noopener">Open</a>}
          </div>
          <p class="foot faint">This is the only time the full link is shown.</p>
        </div>
      ) : (
        <div class="card stack">
          <Field label="Link valid for"><select class="input" value={String(days)} onChange={(e) => setDays(Number((e.target as HTMLSelectElement).value))}><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option></select></Field>
          <Button variant="primary" block icon="share" loading={busy} data-testid="portal-create" onClick={async () => {
            setBusy(true);
            try { const r = await createPortalLink(site.id, days); setFresh(r.token); setTick((t) => t + 1); }
            catch (e) { toast(isNetworkError(e) ? 'Creating a link needs an internet connection.' : (e as Error).message, 'error'); }
            finally { setBusy(false); }
          }}>Create client portal link</Button>
        </div>
      )}
      <SectionLabel>Active links</SectionLabel>
      {active.length ? (
        <List>
          {active.map((l) => (
            <Row key={l.id} icon="share" testid="portal-link-row" title={`Created ${fmtDate(String(l.created_at))}`} sub={`${l.expires_at ? `Expires ${fmtDate(String(l.expires_at))}` : 'No expiry'} · ${Number(l.view_count ?? 0)} views`}
              right={<Button variant="ghost" data-testid="portal-revoke" onClick={async () => { await revokePortalLink(l.id); setFresh(null); setTick((t) => t + 1); toast('Link revoked'); }}>Revoke</Button>} />
          ))}
        </List>
      ) : <p class="muted sub" style={{ padding: '0 4px' }}>No active links.</p>}
    </div>
  );
}

export { sitesFor };

function SitePhotoField({ siteId, admin }: { siteId: string; admin: boolean }) {
  const cover = useData(() => siteCover(siteId), [siteId]);
  const [busy, setBusy] = useState(false);
  if (!admin && !cover.data) return null;
  return (
    <div class="card row-between" data-testid="site-photo-field">
      <span class="row" style={{ gap: 12 }}><SiteThumb siteId={siteId} kind="other" size={52} />
        <span><b style={{ display: 'block' }}>Site photo</b><span class="foot muted">{cover.data ? 'Shown on the site card and header.' : 'Helps guards and owners recognise the site.'}</span></span></span>
      {admin && (
        <label class={`btn btn-outline${busy ? ' loading' : ''}`} style={{ position: 'relative', overflow: 'hidden' }}>
          <Icon name="camera" /> {cover.data ? 'Replace' : 'Upload'}
          <input type="file" accept="image/*" style={{ position: 'absolute', inset: 0, opacity: 0 }} data-testid="site-photo-input" disabled={busy}
            onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              (e.target as HTMLInputElement).value = '';
              if (!f) return;
              setBusy(true);
              try { await setSitePhoto(siteId, f); toast('Site photo saved'); } catch (er) { toast((er as Error).message, 'error'); } finally { setBusy(false); }
            }} />
        </label>
      )}
    </div>
  );
}

/** Item 24: gate/alarm codes + guard notes (guards and staff only; never on the client's site row or portal). */
function SiteCodesEditor({ siteId, admin }: { siteId: string; admin: boolean }) {
  const cur = useData(() => siteCodes(siteId), [siteId]);
  const [codes, setCodes] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const c = codes ?? cur.data?.codes ?? '';
  const n = notes ?? cur.data?.guard_notes ?? '';
  const dirty = codes != null || notes != null;
  return (
    <div class="card stack" data-testid="site-codes-editor">
      <div class="row-between"><b>Codes & guard notes</b><span class="pill pill-muted"><Icon name="lock" size={14} /> Guards only</span></div>
      <Field label="Gate / door / alarm codes"><textarea class="input" rows={3} value={c} disabled={!admin} placeholder="Rear gate keypad: 4417#" onInput={(e) => setCodes((e.target as HTMLTextAreaElement).value)} data-testid="site-codes" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }} /></Field>
      <Field label="Notes for guards"><textarea class="input" rows={2} value={n} disabled={!admin} placeholder="Where the keys are, who to call after hours…" onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} data-testid="site-guard-notes" /></Field>
      <p class="foot muted">Never shown to clients (not in the portal or client app). Guards read and acknowledge post orders on their first shift here.</p>
      {admin && <Button disabled={!dirty} onClick={async () => { await saveSiteCodes(siteId, c, n); setCodes(null); setNotes(null); toast('Codes saved'); }} data-testid="site-codes-save">Save codes</Button>}
    </div>
  );
}

function AckList({ siteId }: { siteId: string }) {
  const org = currentOrgId.value;
  const acks = useData(async () => (await listAcks(org)).filter((a) => a.site_id === siteId), [org, siteId]);
  const members = useData(() => membersFor(org), [org]);
  if (!acks.data?.length) return <p class="foot faint" style={{ padding: '0 4px' }}>No guard has acknowledged these post orders yet.</p>;
  return (
    <div data-testid="po-ack-list">
      <SectionLabel>Acknowledged by</SectionLabel>
      <List>{acks.data.map((a) => <Row key={a.id} icon="check" iconColor="var(--success)" title={members.data?.find((m) => m.id === a.member_id)?.display_name ?? 'Guard'} sub={fmtDate(a.acked_at)} />)}</List>
    </div>
  );
}

/** Item 26: owner-only billing rate + bill-to for monthly invoices (RLS: owners/admins only; never on the client's site row). */
function SiteBillingField({ siteId }: { siteId: string }) {
  const org = currentOrgId.value;
  useEffect(() => { void fetchBilling(); }, [org]);
  const cur = useData(() => siteBilling(siteId), [siteId]);
  const [f, setF] = useState<{ rate: string; client: string; email: string; address: string } | null>(null);
  const v = f ?? { rate: cur.data?.hourly_rate != null ? String(cur.data.hourly_rate) : '', client: cur.data?.client_name ?? '', email: cur.data?.client_email ?? '', address: cur.data?.billing_address ?? '' };
  return (
    <div class="card stack" data-testid="site-billing">
      <div class="row-between"><b>Billing</b><span class="pill pill-muted"><Icon name="lock" size={14} /> Owners only</span></div>
      <div class="grid-2">
        <Field label="Rate per guard hour ($)"><input class="input" inputMode="decimal" value={v.rate} onInput={(e) => setF({ ...v, rate: (e.target as HTMLInputElement).value })} data-testid="site-rate" /></Field>
        <Field label="Client (bill to)"><input class="input" value={v.client} onInput={(e) => setF({ ...v, client: (e.target as HTMLInputElement).value })} data-testid="site-bill-client" /></Field>
      </div>
      <Field label="Billing address"><input class="input" value={v.address} onInput={(e) => setF({ ...v, address: (e.target as HTMLInputElement).value })} /></Field>
      <Field label="Accounts-payable email (reference only)" hint="Lion Patrol never emails clients."><input class="input" type="email" value={v.email} onInput={(e) => setF({ ...v, email: (e.target as HTMLInputElement).value })} /></Field>
      <Button disabled={!f} data-testid="site-billing-save" onClick={async () => {
        const rate = v.rate.trim() === '' ? null : Number(v.rate.replace(/[$,]/g, ''));
        if (rate != null && (Number.isNaN(rate) || rate < 0)) { toast('Enter the rate as a number, e.g. 38.00', 'error'); return; }
        await saveSiteBilling({ site_id: siteId, org_id: org!, hourly_rate: rate, client_name: v.client.trim() || null, client_email: v.email.trim() || null, billing_address: v.address.trim() || null });
        setF(null); toast('Billing saved');
      }}>Save billing</Button>
    </div>
  );
}

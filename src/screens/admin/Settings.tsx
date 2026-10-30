import { useEffect, useState } from 'preact/hooks';
import { Screen, TopBar, List, Row, SectionLabel, Button, Field, Toggle, Sheet, toast, SyncPill } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId, isAdmin, getBackend } from '../../auth/session';
import { categoriesFor, subtypesFor, orgSettings, orgById, membersFor } from '../../data/repos/queries';
import { EMAIL_TESTING_OWNERS_ONLY } from '../../config';
import { saveCategory, reorderCategories, saveSubtype, saveOrgSettings } from '../../data/admin';
import { uuidv7 } from '../../lib/uuid';
import { fmtBytes } from '../../lib/format';
import { navigate } from '../../router';
import { REQUIRED_LABELS } from '../../domain/incident';
import type { Category, OrgSettings, Subtype } from '../../data/types';

function EmailSettings() {
  const org = currentOrgId.value;
  const s = useData(() => orgSettings(org), [org]);
  const members = useData(() => membersFor(org), [org]);
  const [addr, setAddr] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const admin = isAdmin.value;
  const owners = (members.data ?? []).filter((m) => (m.role === 'owner' || m.role === 'admin') && m.status === 'active' && m.email).map((m) => String(m.email).toLowerCase());
  const list = s.data?.notify_emails ?? [];
  const save = async (patch: Partial<OrgSettings>) => { if (!s.data) return; await saveOrgSettings({ ...s.data, ...patch, id: s.data.org_id } as never); toast('Email settings saved'); };
  return (
    <div class="card stack" data-testid="email-settings">
      <div class="row-between"><span>Email owners about incidents & SOS<div class="foot muted">Sent from the guard’s phone through EmailJS.</div></span>
        <Toggle label="Email notifications" checked={!!s.data?.email_enabled} onChange={(v) => admin && void save({ email_enabled: v })} /></div>
      <Field label="Email incidents at or above"><select class="input" value={s.data?.email_min_severity ?? 'medium'} disabled={!admin} onChange={(e) => void save({ email_min_severity: (e.target as HTMLSelectElement).value })} data-testid="email-severity"><option value="low">Low (every incident)</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical only</option></select></Field>
      <div class="banner banner-warning" data-testid="testing-guard"><Icon name="lock" /><div><b>Testing: owners only.</b> Notifications can only go to owner or admin accounts. Client addresses can’t be added in this version. SOS alerts are always sent when email is on.</div></div>
      <div class="field"><span class="field-label">Recipients</span>
        {list.length ? <div class="chip-row">{list.map((e) => <span key={e} class="pill pill-gold" data-testid="recipient">{e}{admin && <button aria-label={`Remove ${e}`} onClick={() => void save({ notify_emails: list.filter((x) => x !== e) })}><Icon name="x" size={12} /></button>}</span>)}</div> : <p class="foot muted">No recipients yet.</p>}
      </div>
      {admin && (
        <Field label="Add owner/admin email" error={err}>
          <div class="row">
            <input class="input grow" type="email" value={addr} autoCapitalize="off" placeholder="owner@lionsecurity.com" onInput={(e) => { setAddr((e.target as HTMLInputElement).value); setErr(null); }} data-testid="recipient-input" />
            <Button data-testid="recipient-add" onClick={() => {
              const e = addr.trim().toLowerCase();
              if (!/.+@.+\..+/.test(e)) { setErr('Enter a valid email address.'); return; }
              if (EMAIL_TESTING_OWNERS_ONLY && !owners.includes(e)) { setErr('Testing mode: only owner or admin account emails can receive notifications.'); return; }
              if (list.includes(e)) { setErr('Already on the list.'); return; }
              setAddr(''); void save({ notify_emails: [...list, e] });
            }}>Add</Button>
          </div>
        </Field>
      )}
      <div class="row-between"><span>Client email notifications<div class="foot muted">Not available in this version.</div></span><Toggle label="Client notifications" checked={false} onChange={() => toast('Client emails are disabled in this version.', 'info')} /></div>
    </div>
  );
}

export function SettingsScreen() {
  const org = currentOrgId.value;
  const o = useData(() => orgById(org), [org]);
  const s = useData(() => orgSettings(org), [org]);
  const [usage, setUsage] = useState<number | null>(null);
  useEffect(() => { void getBackend().rpc<{ total_bytes: number } | null>('patrol_storage_usage', { p_org: org }).then((r) => setUsage(r?.total_bytes ?? 0)).catch(() => undefined); }, [org]);
  const save = async (patch: Partial<OrgSettings>) => {
    if (!s.data) return;
    await saveOrgSettings({ ...s.data, ...patch, id: s.data.org_id } as never);
    toast('Settings saved');
  };
  const pct = usage != null ? Math.min(100, (usage / (1024 ** 3)) * 100) : 0;
  return (
    <Screen tabbar>
      <TopBar title="Settings" large sub={o.data?.name} right={<SyncPill />} />
      <div class="screen-body">
        <SectionLabel>Report categories</SectionLabel>
        <List><Row icon="layers" iconBg="var(--gold-soft)" iconColor="var(--gold)" title="Manage categories" sub="Colors, icons, subtypes and required fields" chevron href="/a/settings/categories" testid="manage-categories" /></List>
        <SectionLabel>Email notifications</SectionLabel>
        <EmailSettings />
        <SectionLabel>Reports & tracking</SectionLabel>
        <div class="card stack">
          <div class="row-between"><span>Share submitted reports with clients automatically<div class="foot muted">Off: you choose per report.</div></span><Toggle label="Auto share" checked={!!s.data?.auto_share_with_client} onChange={(v) => isAdmin.value && void save({ auto_share_with_client: v })} /></div>
          <Field label="GPS update interval while on duty"><select class="input" value={String(s.data?.gps_ping_interval_s ?? 120)} disabled={!isAdmin.value} onChange={(e) => void save({ gps_ping_interval_s: Number((e.target as HTMLSelectElement).value) })}><option value="60">Every minute</option><option value="120">Every 2 minutes</option><option value="300">Every 5 minutes</option></select></Field>
          <Field label="Max video length"><select class="input" value={String(s.data?.max_video_s ?? 60)} disabled={!isAdmin.value} onChange={(e) => void save({ max_video_s: Number((e.target as HTMLSelectElement).value) })}><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="120">2 minutes</option></select></Field>
        </div>
        <SectionLabel>Storage</SectionLabel>
        <div class="card stack">
          <div class="row-between"><span>Photos, video & files</span><span class="tnum">{usage == null ? '—' : `${fmtBytes(usage)} of 1 GB`}</span></div>
          <div class="progress"><span style={{ width: `${pct}%`, background: pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--success)' }} /></div>
          <p class="foot muted">Photos are compressed on the phone. Long videos use the most space.</p>
        </div>
      </div>
    </Screen>
  );
}

const COLORS = ['#C9A23F', '#4F7CC4', '#3E9C8F', '#4E9F5D', '#C98A2E', '#C66B3D', '#C0504D', '#B85C7A', '#8467B5', '#5F6BC2', '#3F94B0', '#64748B'];
const ICONS = ['shield', 'door', 'bell', 'eye', 'user-x', 'bag', 'spray', 'volume', 'medical', 'flame', 'wrench', 'car', 'siren', 'user', 'package', 'heart', 'pill', 'paw', 'search', 'cloud', 'store', 'building', 'extinguisher', 'note', 'camera', 'key', 'alert', 'phone', 'lock', 'pin'];

export function CategoriesScreen() {
  const org = currentOrgId.value;
  const cats = useData(() => categoriesFor(org), [org]);
  const subs = useData(() => subtypesFor(org), [org]);
  const [edit, setEdit] = useState<Category | null>(null);
  const list = cats.data ?? [];
  const move = async (i: number, dir: -1 | 1) => {
    const ids = list.map((c) => c.id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await reorderCategories(ids);
  };
  return (
    <Screen>
      <TopBar title="Categories" backTo="/a/settings" action={<Button variant="primary" icon="plus" data-testid="add-category" onClick={() => setEdit({ id: uuidv7(), org_id: org!, name: '', color: COLORS[1]!, icon: 'note', sort: list.length, hidden: false, required_fields: [], default_severity: 'low', use_for: 'both' })}>Add</Button>} />
      <div class="screen-body">
        <p class="foot muted" style={{ padding: '4px 4px 10px' }}>Guards see visible categories in this order on the report screen. Hidden ones stay on old reports.</p>
        <List>
          {list.map((c, i) => (
            <div class="list-row" key={c.id} data-testid="category-row" style={{ gap: 10, paddingRight: 10 }}>
              <span class="list-icon" style={{ background: `${c.color}29`, color: c.color, opacity: c.hidden ? 0.45 : 1 }}><Icon name={c.icon} /></span>
              <button class="grow" style={{ textAlign: 'left', minWidth: 0 }} onClick={() => setEdit(c)} data-testid="category-edit">
                <span class="wrap2" style={{ display: '-webkit-box', fontWeight: 500, color: c.hidden ? 'var(--text-3)' : undefined }}>{c.name}</span>
                <span class="foot muted">{(subs.data ?? []).filter((s) => s.category_id === c.id && !s.hidden).length} subtypes{c.required_fields.length ? ` · ${c.required_fields.length} required` : ''}{c.hidden ? ' · hidden' : ''}</span>
              </button>
              <span class="row-ctrls">
                <button class="mini-btn" aria-label={c.hidden ? 'Show category' : 'Hide category'} onClick={() => void saveCategory({ ...c, hidden: !c.hidden })} data-testid="category-hide"><Icon name={c.hidden ? 'eye-off' : 'eye'} /></button>
                <button class="mini-btn" aria-label="Move up" disabled={i === 0} onClick={() => void move(i, -1)} data-testid="category-up"><Icon name="chevron-down" style={{ transform: 'rotate(180deg)' }} /></button>
                <button class="mini-btn" aria-label="Move down" disabled={i === list.length - 1} onClick={() => void move(i, 1)} data-testid="category-down"><Icon name="chevron-down" /></button>
              </span>
            </div>
          ))}
        </List>
      </div>
      <CategorySheet cat={edit} subs={(subs.data ?? []).filter((s) => s.category_id === edit?.id)} onClose={() => setEdit(null)} />
    </Screen>
  );
}

function CategorySheet({ cat, subs, onClose }: { cat: Category | null; subs: Subtype[]; onClose: () => void }) {
  const [c, setC] = useState<Category | null>(cat);
  const [newSub, setNewSub] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setC(cat); setErr(null); setNewSub(''); }, [cat?.id]);
  if (!c) return null;
  const toggleReq = (k: string) => setC({ ...c, required_fields: c.required_fields.includes(k) ? c.required_fields.filter((x) => x !== k) : [...c.required_fields, k] });
  return (
    <Sheet open={!!cat} onClose={onClose} title={cat?.name ? 'Edit category' : 'New category'} testid="category-sheet"
      footer={<Button variant="primary" size="lg" block data-testid="category-save" onClick={async () => {
        if (!c.name.trim()) { setErr('Name the category.'); return; }
        await saveCategory(c);
        if (newSub.trim()) await saveSubtype({ id: uuidv7(), org_id: c.org_id, category_id: c.id, name: newSub.trim(), sort: subs.length, hidden: false });
        toast('Category saved'); onClose();
      }}>Save</Button>}>
      <div class="stack">
        <div class="row"><span class="list-icon" style={{ background: `${c.color}29`, color: c.color, width: 48, height: 48, borderRadius: 14 }}><Icon name={c.icon} /></span>
          <Field label="Name" error={err}><input class="input" value={c.name} onInput={(e) => { setC({ ...c, name: (e.target as HTMLInputElement).value }); setErr(null); }} placeholder="e.g. Package theft" data-testid="category-name" /></Field></div>
        <div class="field"><span class="field-label">Color</span><div class="swatches">{COLORS.map((x) => <button key={x} class={`swatch ${c.color === x ? 'on' : ''}`} style={{ background: x }} aria-label={`Color ${x}`} onClick={() => setC({ ...c, color: x })} />)}</div></div>
        <div class="field"><span class="field-label">Icon</span><div class="icon-grid">{ICONS.map((x) => <button key={x} class={c.icon === x ? 'on' : ''} aria-label={`Icon ${x}`} onClick={() => setC({ ...c, icon: x })}><Icon name={x} /></button>)}</div></div>
        <div class="grid-2">
          <Field label="Used for"><select class="input" value={c.use_for} onChange={(e) => setC({ ...c, use_for: (e.target as HTMLSelectElement).value as Category['use_for'] })}><option value="both">Incidents & log</option><option value="incident">Incidents only</option><option value="dar">Daily log only</option></select></Field>
          <Field label="Default severity"><select class="input" value={c.default_severity} onChange={(e) => setC({ ...c, default_severity: (e.target as HTMLSelectElement).value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></Field>
        </div>
        <div class="field"><span class="field-label">Required on incident reports</span>
          <div class="list">{Object.entries(REQUIRED_LABELS).map(([k, l]) => <div class="list-row" key={k}><span class="grow">{l}</span><Toggle label={`Require ${l}`} checked={c.required_fields.includes(k)} onChange={() => toggleReq(k)} /></div>)}</div>
        </div>
        <div class="field"><span class="field-label">Subtypes</span>
          {subs.length > 0 && <div class="list">{[...subs].sort((a, b) => a.sort - b.sort).map((s) => (
            <div class="list-row" key={s.id}>
              <input class="input grow" style={{ height: 40 }} value={s.name} onChange={(e) => void saveSubtype({ ...s, name: (e.target as HTMLInputElement).value })} aria-label="Subtype name" />
              <button class="mini-btn" aria-label={s.hidden ? 'Show subtype' : 'Hide subtype'} onClick={() => void saveSubtype({ ...s, hidden: !s.hidden })}><Icon name={s.hidden ? 'eye-off' : 'eye'} /></button>
            </div>))}</div>}
          <div class="row" style={{ marginTop: 8 }}>
            <input class="input grow" value={newSub} placeholder="Add a subtype" onInput={(e) => setNewSub((e.target as HTMLInputElement).value)} data-testid="subtype-new" />
            <Button icon="plus" disabled={!newSub.trim()} onClick={async () => { await saveCategory(c); await saveSubtype({ id: uuidv7(), org_id: c.org_id, category_id: c.id, name: newSub.trim(), sort: subs.length, hidden: false }); setNewSub(''); }}>Add</Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

export { navigate };

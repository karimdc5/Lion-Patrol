import { useState } from 'preact/hooks';
import { Screen, TopBar, SyncPill, List, Row, SectionLabel, Avatar, Button, Sheet, Field, Toggle, toast, Empty } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId, isAdmin, role as myRole, memberId as myMemberId } from '../../auth/session';
import { membersFor, sitesFor } from '../../data/repos/queries';
import { listRecords, getRecord } from '../../data/repos/records';
import { createInvite, listInvites, revokeInvite, updateMember, setSiteAccess } from '../../data/admin';
import { roleLabel, relTime, fmtDate } from '../../lib/format';
import { PUBLIC_URL } from '../../config';
import type { Member, SiteAccess } from '../../data/types';
import { isNetworkError } from '../../data/backend/types';

const GROUPS: Array<[string, string[]]> = [['Owners & admins', ['owner', 'admin']], ['Supervisors', ['supervisor']], ['Guards', ['guard']], ['Clients', ['client']]];

export function PeopleList() {
  const org = currentOrgId.value;
  const members = useData(() => membersFor(org), [org]);
  const status = useData(() => listRecords<{ member_id: string; on_duty: boolean; last_ping_at: string | null }>('patrol_member_status', org), [org]);
  const invites = useData(() => listInvites(), [org]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const open = (invites.data ?? []).filter((i) => !i.revoked_at && Number(i.uses) < Number(i.max_uses) && Date.parse(i.expires_at as string) > Date.now());
  return (
    <Screen tabbar>
      <TopBar title="People" large right={<SyncPill />} action={isAdmin.value ? <Button variant="primary" icon="user-plus" onClick={() => setInviteOpen(true)} data-testid="invite-btn">Invite</Button> : undefined} />
      <div class="screen-body">
        {GROUPS.map(([label, roles]) => {
          const list = (members.data ?? []).filter((m) => roles.includes(m.role));
          if (!list.length) return null;
          return (
            <div key={label}>
              <SectionLabel>{label}</SectionLabel>
              <List>
                {list.map((m) => {
                  const st = status.data?.find((s) => s.member_id === m.id);
                  return <Row key={m.id} testid="member-row" title={<span class="row" style={{ gap: 10 }}><Avatar name={m.display_name} gold={st?.on_duty} />{m.display_name}</span>}
                    sub={`${roleLabel(m.role)}${m.status === 'disabled' ? ' · disabled' : st?.on_duty ? ' · on duty' : ''}`}
                    right={m.status === 'disabled' ? <span class="pill pill-muted">Disabled</span> : st?.on_duty ? <span class="pill pill-success">On duty</span> : undefined} chevron href={`/a/people/${m.id}`} />;
                })}
              </List>
            </div>
          );
        })}
        {isAdmin.value && (
          <>
            <SectionLabel>Open invites</SectionLabel>
            {open.length ? (
              <List>
                {open.map((i) => <Row key={i.id} icon="key" title={`LION-…${i.code_hint} · ${roleLabel(String(i.role))}`} sub={`${i.email ?? i.display_name ?? 'Anyone with the code'} · expires ${fmtDate(i.expires_at as string)}`}
                  right={<Button variant="ghost" onClick={async () => { await revokeInvite(i.id); toast('Invite revoked'); }}>Revoke</Button>} />)}
              </List>
            ) : <p class="muted sub" style={{ padding: '0 4px' }}>No open invites.</p>}
          </>
        )}
      </div>
      <InviteSheet open={inviteOpen} onClose={() => { setInviteOpen(false); void listInvites(); }} />
    </Screen>
  );
}

function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const org = currentOrgId.value;
  const sites = useData(() => sitesFor(org, null, true), [org]);
  const [role, setRole] = useState('guard');
  const [chosen, setChosen] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const close = () => { setCode(null); setChosen([]); setEmail(''); setName(''); setErr(null); onClose(); };
  const link = code ? `${PUBLIC_URL}join?code=${code}` : '';
  const message = code ? `You're invited to Lion Patrol (Lion Security Services). Install the app from ${PUBLIC_URL} then tap "Have an invite code?" and enter ${code}. Or open: ${link}` : '';
  return (
    <Sheet open={open} onClose={close} title={code ? 'Invite ready' : 'Invite someone'} testid="invite-sheet">
      {code ? (
        <div class="stack">
          <div class="code-big" data-testid="invite-code">{code}</div>
          <p class="muted sub" style={{ textAlign: 'center' }}>Valid for 7 days, one use. Share it yourself — Lion Patrol doesn’t send emails or texts.</p>
          {typeof navigator.share === 'function' && <Button variant="primary" size="lg" block icon="share" onClick={() => void navigator.share({ title: 'Lion Patrol invite', text: message }).catch(() => undefined)}>Share invite</Button>}
          <Button size="lg" block icon="copy" onClick={async () => { try { await navigator.clipboard.writeText(message); toast('Invite copied'); } catch { toast('Copy failed — long-press the code to copy', 'error'); } }}>Copy message</Button>
          <p class="foot faint" style={{ wordBreak: 'break-all' }}>{link}</p>
          <Button variant="ghost" block onClick={close}>Done</Button>
        </div>
      ) : (
        <div class="stack">
          <Field label="Role">
            <select class="input" value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value)} data-testid="invite-role">
              <option value="guard">Guard</option><option value="supervisor">Supervisor</option>{myRole.value === 'owner' || myRole.value === 'admin' ? <option value="admin">Admin</option> : null}<option value="client">Client (read-only)</option>
            </select>
          </Field>
          <div class="field"><span class="field-label">{role === 'client' ? 'Client’s site(s) — required' : 'Sites (recommended for guards)'}</span>
            <div class="chip-row">{(sites.data ?? []).map((s) => <button key={s.id} class={`chip ${chosen.includes(s.id) ? 'active' : ''}`} onClick={() => setChosen(chosen.includes(s.id) ? chosen.filter((x) => x !== s.id) : [...chosen, s.id])} data-testid="invite-site">{s.name}</button>)}</div>
          </div>
          <Field label="Name (optional)"><input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Jordan Ellis" /></Field>
          <Field label="Lock to email (optional)" hint="Only this email can redeem the code."><input class="input" type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} autoCapitalize="off" /></Field>
          {err && <div class="form-error">{err}</div>}
          <Button variant="primary" size="lg" block loading={busy} data-testid="invite-create" onClick={async () => {
            if (role === 'client' && !chosen.length) { setErr('Pick the client’s site.'); return; }
            setBusy(true); setErr(null);
            try { const r = await createInvite(role, chosen, email.trim() || null, name.trim() || null); setCode(r.code); }
            catch (e) { setErr(isNetworkError(e) ? 'Creating an invite needs an internet connection.' : (e as Error).message); }
            finally { setBusy(false); }
          }}>Create invite code</Button>
        </div>
      )}
    </Sheet>
  );
}

export function MemberDetail({ id }: { id: string }) {
  const org = currentOrgId.value;
  const admin = isAdmin.value;
  const m = useData(() => getRecord<Member>('patrol_members', id), [id]);
  const sites = useData(() => sitesFor(org, null, true), [org]);
  const access = useData(() => listRecords<SiteAccess>('patrol_site_access', org), [org]);
  if (!m.data) return <Screen><TopBar title="Person" backTo="/a/people" /><div class="screen-body" /></Screen>;
  const mem = m.data;
  const self = mem.id === myMemberId.value;
  const canEditRole = admin && !self && (mem.role !== 'owner' || myRole.value === 'owner');
  return (
    <Screen>
      <TopBar title={mem.display_name} backTo="/a/people" right={<SyncPill />} />
      <div class="screen-body stack-lg">
        <div class="card row"><Avatar name={mem.display_name} size="lg" gold /><div class="grow"><div class="headline">{mem.display_name}</div><div class="foot muted">{roleLabel(mem.role)} · {mem.email ?? 'no email'}{mem.phone ? ` · ${mem.phone}` : ''}</div></div></div>
        {canEditRole && (
          <Field label="Role">
            <select class="input" value={mem.role} onChange={async (e) => { await updateMember(mem, { role: (e.target as HTMLSelectElement).value as Member['role'] }); toast('Role updated'); }} data-testid="member-role">
              {myRole.value === 'owner' && <option value="owner">Owner</option>}<option value="admin">Admin</option><option value="supervisor">Supervisor</option><option value="guard">Guard</option><option value="client">Client</option>
            </select>
          </Field>
        )}
        {(mem.role === 'guard' || mem.role === 'client') && (
          <div>
            <SectionLabel>Sites</SectionLabel>
            <List>
              {(sites.data ?? []).map((s) => (
                <div class="list-row" key={s.id}>
                  <span class="grow">{s.name}</span>
                  <Toggle label={`${s.name} access`} checked={(access.data ?? []).some((a) => a.site_id === s.id && a.member_id === mem.id)} onChange={(v) => admin && void setSiteAccess(s.id, mem.id, v)} />
                </div>
              ))}
            </List>
          </div>
        )}
        <div class="card stack">
          <div class="row"><span class="list-icon" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}><Icon name="key" /></span><b>Quick unlock PIN</b></div>
          <p class="sub muted">PINs are set by each person on their own phone (More → Set a PIN). The PIN never leaves the device and nobody else can see it. After 10 wrong tries the saved login is erased. If a phone is lost, disable the account here; their saved login stops working immediately.</p>
        </div>
        {admin && !self && mem.role !== 'owner' && (
          mem.status === 'active'
            ? <Button variant="danger" block onClick={async () => { if (confirm(`Disable ${mem.display_name}? They lose access immediately.`)) { await updateMember(mem, { status: 'disabled' }); toast('Access disabled'); } }} data-testid="member-disable">Disable access</Button>
            : <Button block onClick={async () => { await updateMember(mem, { status: 'active' }); toast('Access restored'); }}>Restore access</Button>
        )}
        <p class="foot faint">Member since {relTime((mem as Member & { created_at?: string }).created_at ?? null)}</p>
      </div>
    </Screen>
  );
}

export { Empty };

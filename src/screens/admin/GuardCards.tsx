import { useEffect, useState } from 'preact/hooks';
import { Screen, TopBar, SyncPill, List, Row, SectionLabel, Empty, Button, Sheet, Field, Avatar, toast } from '../../ui/kit';
import { useData } from '../../ui/useData';
import { currentOrgId, isAdmin, role } from '../../auth/session';
import { membersFor } from '../../data/repos/queries';
import { fetchGuardCards, listGuardCards, saveGuardCard, cardStatus, cardDays, onboardingCards, type GuardCard, type OnboardingCard } from '../../data/owner';
import { fmtDate, roleLabel } from '../../lib/format';
import { isNetworkError } from '../../data/backend/types';
import type { Member } from '../../data/types';

const fmtDay = (d: string | null | undefined) => (d ? fmtDate(`${d}T12:00:00Z`) : '—');

/** Owner-editable WA guard card number + expiry for one member (owners/admins only; RLS-protected). */
export function GuardCardEditor({ member }: { member: Member }) {
  const org = currentOrgId.value;
  const cards = useData(() => listGuardCards(org), [org]);
  const card = cards.data?.find((c) => c.member_id === member.id);
  const [no, setNo] = useState<string | null>(null);
  const [exp, setExp] = useState<string | null>(null);
  useEffect(() => { void fetchGuardCards(); }, [org]);
  if (!isAdmin.value || member.role === 'client') return null;
  const st = cardStatus(card?.expires_on);
  const dirty = no != null || exp != null;
  return (
    <div class="card stack" data-testid="guard-card-editor">
      <div class="row-between"><b>WA guard card</b>{card && <span class={`pill pill-${st.tone}`} data-testid="guard-card-status">{st.label}</span>}</div>
      <div class="grid-2">
        <Field label="Card number"><input class="input input-code" value={no ?? card?.card_no ?? ''} placeholder="WA-SG-1234567" onInput={(e) => setNo((e.target as HTMLInputElement).value)} data-testid="guard-card-no" /></Field>
        <Field label="Expires"><input class="input" type="date" value={exp ?? card?.expires_on ?? ''} onInput={(e) => setExp((e.target as HTMLInputElement).value)} data-testid="guard-card-exp" /></Field>
      </div>
      {card?.source === 'onboarding' && <div class="foot muted">Imported from the onboarding app.</div>}
      <div class="foot faint">Owners and admins only — never shown to guards or clients. You’re alerted 30 days before it expires.</div>
      <Button disabled={!dirty} data-testid="guard-card-save" onClick={async () => {
        await saveGuardCard(member.id, no ?? card?.card_no ?? '', exp ?? card?.expires_on ?? null);
        setNo(null); setExp(null); toast('Guard card saved');
      }}>Save guard card</Button>
    </div>
  );
}

/** Item 23: every guard's card at a glance, soonest expiry first, plus import from the onboarding app. */
export function GuardCards() {
  const org = currentOrgId.value;
  const members = useData(() => membersFor(org), [org]);
  const cards = useData(() => listGuardCards(org), [org]);
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => { void fetchGuardCards(); }, [org]);
  const people = (members.data ?? []).filter((m) => m.role !== 'client' && m.status === 'active');
  const rows = people.map((m) => ({ m, c: cards.data?.find((c) => c.member_id === m.id) }))
    .sort((a, b) => (cardDays(a.c?.expires_on) ?? 99999) - (cardDays(b.c?.expires_on) ?? 99999) || a.m.display_name.localeCompare(b.m.display_name));
  return (
    <Screen tabbar>
      <TopBar title="Guard cards" large right={<SyncPill />} sub="WA security guard licenses · owners only"
        action={role.value === 'owner' ? <Button variant="primary" icon="download" onClick={() => setImportOpen(true)} data-testid="gc-import">Import</Button> : undefined} />
      <div class="screen-body">
        {rows.length ? (
          <List>
            {rows.map(({ m, c }) => {
              const st = c ? cardStatus(c.expires_on) : { tone: 'muted', label: 'No card on file' };
              return <Row key={m.id} testid="gc-row" title={<span class="row" style={{ gap: 10 }}><Avatar name={m.display_name} />{m.display_name}</span>}
                sub={`${roleLabel(m.role)} · ${c?.card_no ?? 'no number'} · expires ${fmtDay(c?.expires_on)}`}
                right={<span class={`pill pill-${st.tone}`}>{st.label}</span>} chevron href={`/a/people/${m.id}`} />;
            })}
          </List>
        ) : <Empty icon="users" title="No guards yet" />}
      </div>
      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} members={people} cards={cards.data ?? []} />
    </Screen>
  );
}

function ImportSheet({ open, onClose, members, cards }: { open: boolean; onClose: () => void; members: Member[]; cards: GuardCard[] }) {
  const [list, setList] = useState<OnboardingCard[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setList(null); setErr(null);
    onboardingCards().then(setList).catch((e) => setErr(isNetworkError(e) ? 'Importing needs an internet connection.' : /owners_only/.test((e as Error).message) ? 'Only owners on the Lion Security owners list can import from onboarding.' : (e as Error).message));
  }, [open]);
  const withCard = (list ?? []).filter((o) => o.card_no || o.expires_on);
  return (
    <Sheet open={open} onClose={onClose} title="Import from onboarding" testid="gc-import-sheet">
      <div class="stack">
        <p class="muted sub">From the onboarding app: name, email and guard card number + expiry only. Nothing else (SSN, bank, address…) is read.</p>
        {err && <div class="form-error">{err}</div>}
        {!list && !err && <p class="muted sub">Loading…</p>}
        {list && !withCard.length && <p class="muted sub">No onboarding submissions with a guard card.</p>}
        {withCard.map((o) => {
          const target = pick[o.link_id] ?? o.member_id ?? '';
          const existing = cards.find((c) => c.member_id === target);
          const same = existing && existing.card_no === (o.card_no ?? '').toUpperCase() && existing.expires_on === o.expires_on;
          return (
            <div key={o.link_id} class="card stack" data-testid="gc-onb-row" style={{ gap: 8 }}>
              <div class="row-between"><b>{[o.first_name, o.last_name].filter(Boolean).join(' ') || o.email || 'New hire'}</b><span class="foot muted">{fmtDate(o.submitted_at)}</span></div>
              <div class="foot muted">{o.email ?? 'no email'} · {o.card_no ?? 'no number'} · expires {fmtDay(o.expires_on)}</div>
              <div class="row" style={{ gap: 8 }}>
                <select class="input grow" value={target} onChange={(e) => setPick({ ...pick, [o.link_id]: (e.target as HTMLSelectElement).value })} data-testid="gc-onb-member">
                  <option value="">Match to a team member…</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                </select>
                <Button variant="primary" disabled={!target || !!same} data-testid="gc-onb-import" onClick={async () => {
                  await saveGuardCard(target, o.card_no ?? '', o.expires_on, 'onboarding', o.link_id);
                  toast('Guard card imported');
                }}>{same ? 'Imported' : 'Import'}</Button>
              </div>
            </div>
          );
        })}
        <Button variant="ghost" block onClick={onClose}>Done</Button>
      </div>
    </Sheet>
  );
}

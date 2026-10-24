import { useState } from 'preact/hooks';
import { Screen, TopBar, Button, Empty, toast } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId } from '../../auth/session';
import { categoriesFor } from '../../data/repos/queries';
import { listByParent } from '../../data/repos/records';
import { onShift, openDar, addDarEntry, addAttachment } from '../../data/guard';
import { prepareWithLimits, AttachmentTray } from '../../ui/Attachments';
import { fmtTime } from '../../lib/format';
import { navigate } from '../../router';
import { GuardRight } from './common';
import type { Prepared } from '../../media/compress';
import type { Row as R } from '../../data/db';

const PRESETS = ['All secure', 'Doors checked and locked', 'Patrol complete, no issues', 'Lights out noted', 'Spoke with client/resident'];

export function DarScreen() {
  const org = currentOrgId.value;
  const te = onShift.value;
  const dar = useData(() => openDar(), [te?.id]);
  const entries = useData(async () => (dar.data ? (await listByParent<R>('patrol_dar_entries', dar.data.id)).filter((e) => !e.deleted_at) : []), [dar.data?.id]);
  const cats = useData(() => categoriesFor(org), [org]);
  const [text, setText] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [staged, setStaged] = useState<Prepared[]>([]);
  const [busy, setBusy] = useState(false);
  const darCats = (cats.data ?? []).filter((c) => !c.hidden && c.use_for !== 'incident').slice(0, 10);

  if (!te) {
    return (
      <Screen tabbar>
        <TopBar title="Daily log" large right={<GuardRight />} />
        <div class="screen-body"><Empty icon="note" title="Not clocked in" body="Your daily activity report starts when you clock in." action={<Button variant="primary" onClick={() => navigate('/g/clock')}>Clock in</Button>} /></div>
      </Screen>
    );
  }

  const add = async () => {
    if (text.trim().length < 2) return;
    setBusy(true);
    try {
      const id = await addDarEntry(text, cat);
      for (const p of staged) await addAttachment('dar_entry', id, p);
      setText(''); setStaged([]); setCat(null);
      toast('Log entry saved');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };

  const list = [...(entries.data ?? [])].sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
  return (
    <Screen tabbar>
      <TopBar title="Daily log" large right={<GuardRight />} sub={`Shift started ${fmtTime(te.clock_in_at)} · submitted when you clock out`} />
      <div class="screen-body stack-lg">
        <div class="card stack">
          <textarea class="input" rows={3} placeholder="What happened? e.g. East gate checked, secured." value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} data-testid="dar-text" aria-label="Log entry" />
          <div class="chip-row">{PRESETS.map((p) => <button key={p} class="chip" onClick={() => setText(p)}>{p}</button>)}</div>
          <div class="chip-row" aria-label="Category">
            {darCats.map((c) => (
              <button key={c.id} class={`chip ${cat === c.id ? 'active' : ''}`} onClick={() => setCat(cat === c.id ? null : c.id)}>
                <span class="pill-dot" style={{ color: c.color }} />{c.name}
              </button>
            ))}
          </div>
          {staged.length > 0 && <div class="foot muted">{staged.length} photo{staged.length > 1 ? 's' : ''} attached</div>}
          <div class="row">
            <label class="btn btn-outline" style={{ position: 'relative', overflow: 'hidden' }}><Icon name="camera" /> Photo
              <input type="file" accept="image/*,video/*" capture="environment" style={{ position: 'absolute', inset: 0, opacity: 0 }} data-testid="dar-photo"
                onChange={async (e) => { const f = (e.target as HTMLInputElement).files; if (f?.length) { try { const p = await prepareWithLimits(f[0]!); setStaged((s) => [...s, p]); } catch (er) { toast((er as Error).message, 'error'); } } (e.target as HTMLInputElement).value = ''; }} />
            </label>
            <Button variant="primary" class="grow" onClick={() => void add()} loading={busy} disabled={text.trim().length < 2} data-testid="dar-add">Add entry</Button>
          </div>
        </div>

        {list.length ? (
          <div class="card" style={{ padding: '6px 14px' }} data-testid="dar-timeline">
            {list.map((e) => (
              <div class="tl-item" key={e.id} data-testid="dar-entry">
                <div class="tl-time">{fmtTime(e.occurred_at as string)}</div>
                <div class="tl-dot" style={{ background: (cats.data ?? []).find((c) => c.id === e.category_id)?.color ?? 'var(--gold)' }} />
                <div class="tl-body">
                  <div class="tl-title">{(e.category_name as string) || 'Log entry'} {e._pending ? <Icon name="clock" /> : <Icon name="check" />}</div>
                  <div class="tl-sub" style={{ WebkitLineClamp: 6 }}>{String(e.body)}</div>
                  <div style={{ marginTop: 8 }}><AttachmentTray parentType="dar_entry" parentId={e.id} editable={false} /></div>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty icon="note" title="No entries yet" body="Log patrols, observations and anything notable. Entries save instantly, even offline." />}
      </div>
    </Screen>
  );
}

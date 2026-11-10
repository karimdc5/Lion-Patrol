import { useState } from 'preact/hooks';
import { Screen, TopBar, List, Row, SectionLabel, SyncPill, Button, Empty, toast } from '../../ui/kit';
import { identity } from '../../auth/session';
import { opsForUser, retryOp, retryAll, discardOp } from '../../data/outbox/queue';
import { syncNow, refreshCounts } from '../../data/sync/engine';
import { lastSyncAt, net, syncState } from '../../data/sync/status';
import { useData } from '../../ui/useData';
import { relTime, fmtBytes } from '../../lib/format';
import type { OutboxOp } from '../../data/outbox/types';

export function SyncScreen({ base }: { base: string }) {
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const uid = identity.value?.userId ?? '';
  const ops = useData(() => opsForUser(uid), [uid, tick, syncState.value]);
  const est = useData(() => navigator.storage?.estimate?.() ?? Promise.resolve(undefined), []);
  const persisted = useData(() => navigator.storage?.persisted?.() ?? Promise.resolve(false), []);
  const live = (ops.data ?? []).filter((o) => o.status !== 'done');
  const dead = live.filter((o) => o.status === 'dead');
  const pending = live.filter((o) => o.status !== 'dead');
  const refresh = async () => { await refreshCounts(); setTick((t) => t + 1); };

  return (
    <Screen>
      <TopBar title="Sync" backTo={`${base}/more`} right={<SyncPill onClick={() => void 0} />} />
      <div class="screen-body">
        <div class="card stack">
          <div class="row-between"><span class="muted">Last synced</span><span class="tnum">{relTime(Math.max(lastSyncAt.value, net.value.lastSuccessAt) || null)}</span></div>
          <div class="row-between"><span class="muted">Connection</span><span>{net.value.online ? 'Online' : 'Offline'}</span></div>
          <div class="row-between"><span class="muted">Waiting to upload</span><span class="tnum">{pending.length}</span></div>
          {est.data?.usage != null && <div class="row-between"><span class="muted">Stored on device</span><span class="tnum">{fmtBytes(est.data.usage)}</span></div>}
          <div class="row-between"><span class="muted">Protected storage</span><span>{persisted.data ? 'On' : 'Standard'}</span></div>
          <Button variant="primary" block icon="refresh" loading={busy} data-testid="sync-now"
            onClick={async () => { setBusy(true); await syncNow({ bootstrap: true }); await refresh(); setBusy(false); toast(net.value.online ? 'Sync complete' : 'You’re offline. Items will upload automatically.', net.value.online ? 'success' : 'info'); }}>Sync now</Button>
        </div>

        {dead.length > 0 && (
          <>
            <SectionLabel>Needs attention</SectionLabel>
            <List>
              {dead.map((o) => <DeadRow key={o.id} op={o} onChange={refresh} />)}
            </List>
            <Button block style={{ marginTop: 10 }} onClick={async () => { await retryAll(uid); await syncNow(); await refresh(); }}>Retry all</Button>
          </>
        )}

        <SectionLabel>Waiting to upload</SectionLabel>
        {pending.length ? (
          <List>
            {pending.map((o) => (
              <Row key={o.id} icon={o.kind === 'upload' ? 'cloud-up' : 'clock'} iconBg="var(--warning-soft)" iconColor="var(--warning)" title={o.label}
                sub={o.lastError ? `Retrying · ${o.lastError.message.slice(0, 60)}` : o.status === 'inflight' ? 'Uploading…' : 'Queued'} />
            ))}
          </List>
        ) : (
          <Empty icon="cloud-check" title="All caught up" body="Everything on this device has been saved to the server." />
        )}
      </div>
    </Screen>
  );
}

function DeadRow({ op, onChange }: { op: OutboxOp; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Row icon="alert" iconBg="var(--danger-soft)" iconColor="var(--danger)" title={op.label} sub={op.lastError?.message ?? 'Failed'} chevron onClick={() => setOpen(!open)} testid="dead-op" />
      {open && (
        <div class="row" style={{ padding: '0 16px 12px', flexWrap: 'wrap', gap: 8 }}>
          <Button icon="refresh" onClick={async () => { await retryOp(op.id); await syncNow(); onChange(); }}>Retry</Button>
          <Button icon="copy" onClick={async () => { await navigator.clipboard?.writeText(JSON.stringify(op, null, 2)); toast('Details copied'); }}>Copy details</Button>
          <Button variant="outline" icon="trash" onClick={async () => { if (confirm('Discard this item? It will not be uploaded.')) { await discardOp(op.id); onChange(); } }}>Discard</Button>
        </div>
      )}
    </div>
  );
}

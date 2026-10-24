import { useState } from 'preact/hooks';
import { Screen, TopBar, SyncPill, List, Empty, SkeletonList, toast, Button } from '../../ui/kit';
import { useData } from '../../ui/useData';
import { currentOrgId } from '../../auth/session';
import { listRecords } from '../../data/repos/records';
import { setDarStatus } from '../../data/admin';
import { PdfButton } from '../../ui/PdfButton';
import { fmtDate } from '../../lib/format';
import type { Row as R } from '../../data/db';

const LABEL: Record<string, [string, string]> = { open: ['In progress', 'pill-info'], submitted: ['New', 'pill-warning'], reviewed: ['Reviewed', 'pill-muted'], sent_to_client: ['Sent to client', 'pill-success'] };

export function DarsList() {
  const org = currentOrgId.value;
  const dars = useData(() => listRecords<R>('patrol_dars', org), [org]);
  const sites = useData(() => listRecords<R>('patrol_sites', org), [org]);
  const [busy, setBusy] = useState<string | null>(null);
  const list = (dars.data ?? []).sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)) || String(b.created_at).localeCompare(String(a.created_at)));
  return (
    <Screen tabbar>
      <TopBar title="Daily reports" large right={<SyncPill />} sub="One report per guard shift. Share with the client when reviewed." />
      <div class="screen-body">
        {dars.loading ? <SkeletonList /> : list.length ? (
          <List>
            {list.map((d) => (
              <div class="list-row" key={d.id} data-testid="dar-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 10 }}>
                <div class="row-between" style={{ width: '100%' }}>
                  <span style={{ minWidth: 0 }}>
                    <b class="ellipsis" style={{ display: 'block' }}>{String(sites.data?.find((s) => s.id === d.site_id)?.name ?? 'Site')}</b>
                    <span class="foot muted">{fmtDate(`${d.report_date}T12:00:00Z`)} · {String(d.author_name)}{d.report_no ? ` · ${d.report_no}` : ''}</span>
                  </span>
                  <span class={`pill ${LABEL[String(d.status)]?.[1] ?? 'pill-muted'}`}>{LABEL[String(d.status)]?.[0] ?? String(d.status)}</span>
                </div>
                <div class="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <PdfButton label="PDF" testid="dar-pdf" make={() => import('../../pdf').then((m) => m.darPdf(d.id))} />
                  {d.status === 'submitted' && <Button loading={busy === d.id} onClick={async () => { setBusy(d.id); await setDarStatus(d.id, 'reviewed'); setBusy(null); toast('Marked reviewed'); }}>Mark reviewed</Button>}
                  {(d.status === 'submitted' || d.status === 'reviewed') && <Button variant="outline" onClick={async () => { await setDarStatus(d.id, 'sent_to_client'); toast('Shared with client'); }} data-testid="dar-share">Share with client</Button>}
                </div>
              </div>
            ))}
          </List>
        ) : <Empty icon="activity" title="No daily reports yet" body="Guards’ daily reports appear here when they clock out." />}
      </div>
    </Screen>
  );
}

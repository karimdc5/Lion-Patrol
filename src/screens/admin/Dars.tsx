import { useEffect, useState } from 'preact/hooks';
import { Screen, TopBar, SyncPill, List, Empty, SkeletonList, toast, Button, Toggle, SectionLabel } from '../../ui/kit';
import { useData } from '../../ui/useData';
import { currentOrgId } from '../../auth/session';
import { listRecords } from '../../data/repos/records';
import { setDarStatus, setDarShared, setSiteAutoShareDars, refreshDashboard } from '../../data/admin';
import type { Site } from '../../data/types';
import { PdfButton } from '../../ui/PdfButton';
import { fmtDate } from '../../lib/format';
import type { Row as R } from '../../data/db';

const LABEL: Record<string, [string, string]> = { open: ['In progress', 'pill-info'], submitted: ['New', 'pill-warning'], reviewed: ['Reviewed', 'pill-muted'], sent_to_client: ['Sent to client', 'pill-success'] };

export function DarsList() {
  const org = currentOrgId.value;
  const dars = useData(() => listRecords<R>('patrol_dars', org), [org]);
  const sites = useData(() => listRecords<Site>('patrol_sites', org), [org]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { void refreshDashboard(); }, [org]);
  const share = async (d: R, on: boolean) => {
    setBusy(`${d.id}:share`);
    try { await setDarShared(d.id, on); toast(on ? 'Shared with client — visible in the client portal' : 'No longer shared with the client'); }
    catch (e) { toast((e as Error).message, 'error', 5000); } finally { setBusy(null); }
  };
  const list = (dars.data ?? []).sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)) || String(b.created_at).localeCompare(String(a.created_at)));
  return (
    <Screen tabbar>
      <TopBar title="Daily reports" large right={<SyncPill />} sub="One report per guard shift. Share with the client when reviewed." />
      <div class="screen-body stack-lg">
        {(sites.data ?? []).filter((s) => s.active !== false).length > 0 && (
          // A4: per-site auto-share — DARs submitted at this site go to the client portal automatically.
          <div data-testid="dar-autoshare">
            <SectionLabel>Auto-share with client</SectionLabel>
            <List>
              {sites.data!.filter((s) => s.active !== false).map((s) => (
                <div class="list-row row-between" key={s.id}>
                  <span><b>{s.name}</b><div class="foot muted">{s.auto_share_dars ? 'New DARs are shared to the client portal when submitted' : 'Off — share each DAR by hand'}</div></span>
                  <Toggle label={`Auto-share DARs at ${s.name}`} checked={!!s.auto_share_dars} onChange={(v) => void setSiteAutoShareDars(s, v).then(() => toast(v ? `Auto-share on for ${s.name}` : `Auto-share off for ${s.name}`))} />
                </div>
              ))}
            </List>
            <p class="foot faint" style={{ padding: '6px 4px' }}>Clients see shared DARs (log entries and patrol rounds) for their own site only — never codes, pay, internal notes or internal-only incidents.</p>
          </div>
        )}
        <div>
        {dars.loading ? <SkeletonList /> : list.length ? (
          <List>
            {list.map((d) => (
              <div class="list-row" key={d.id} data-testid="dar-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 10 }}>
                <div class="row-between" style={{ width: '100%' }}>
                  <span style={{ minWidth: 0 }}>
                    <b class="ellipsis" style={{ display: 'block' }}>{String(sites.data?.find((s) => s.id === d.site_id)?.name ?? 'Site')}</b>
                    <span class="foot muted">{fmtDate(`${d.report_date}T12:00:00Z`)} · {String(d.author_name)}{d.report_no ? ` · ${d.report_no}` : ''}</span>
                  </span>
                  <span class="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
                    <span class={`pill ${LABEL[String(d.status)]?.[1] ?? 'pill-muted'}`}>{LABEL[String(d.status)]?.[0] ?? String(d.status)}</span>
                    {d.status !== 'open' && (d.client_visible
                      ? <span class="pill pill-success" data-testid="dar-shared">Shared with client</span>
                      : <span class="pill pill-muted" data-testid="dar-not-shared">Not shared</span>)}
                  </span>
                </div>
                <div class="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <PdfButton label="PDF" testid="dar-pdf" make={() => import('../../pdf').then((m) => m.darPdf(d.id))} />
                  {d.time_entry_id ? <PdfButton label="Shift PDF" testid="shift-pdf" make={() => import('../../pdf').then((m) => m.endOfShiftPdf(String(d.time_entry_id), { preferSaved: true }))} /> : null}
                  {d.status === 'submitted' && <Button loading={busy === d.id} onClick={async () => { setBusy(d.id); await setDarStatus(d.id, 'reviewed'); setBusy(null); toast('Marked reviewed'); }}>Mark reviewed</Button>}
                  {d.status !== 'open' && !d.client_visible && <Button variant="outline" loading={busy === `${d.id}:share`} onClick={() => void share(d, true)} data-testid="dar-share">Share with client</Button>}
                  {d.status !== 'open' && !!d.client_visible && <Button variant="ghost" loading={busy === `${d.id}:share`} onClick={() => void share(d, false)} data-testid="dar-unshare">Stop sharing</Button>}
                </div>
              </div>
            ))}
          </List>
        ) : <Empty icon="activity" title="No daily reports yet" body="Guards’ daily reports appear here when they clock out." />}
        </div>
      </div>
    </Screen>
  );
}

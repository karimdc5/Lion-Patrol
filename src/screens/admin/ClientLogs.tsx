import { useEffect, useState } from 'preact/hooks';
import { Screen, TopBar, SyncPill, List, Empty, SkeletonList, Button, Sheet, toast, SectionLabel, Segmented } from '../../ui/kit';
import { useData } from '../../ui/useData';
import { currentOrgId } from '../../auth/session';
import { sitesFor } from '../../data/repos/queries';
import { listClientReports, listClientEmails, listSiteClientEmail, previewReport, sendReport, emailSetupState, isNotInstalled, REPORT_STATUS,
  type ClientReport, type KickResult } from '../../data/clientLogs';
import { fmtNight, fmtTimePT, type MergedReport } from '../../../supabase/functions/_shared/client-logs';
import { fmtDateTime } from '../../lib/format';
import { navigate } from '../../router';

/**
 * Pass 9 chunk 2 — Client logs (owners/admins): one combined report per site per night. A report is
 * "Waiting on guards" until the last scheduled guard clocks out (or the 8 AM PT fallback), then
 * "Ready for your OK" (default: hold for the owner) or queued straight away when the site is set to
 * auto-send. Send now is the OK. Sending happens on the server only; this screen shows what really happened.
 */
export function ClientLogs() {
  const org = currentOrgId.value;
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<'ok' | 'all'>('ok');
  const sites = useData(() => sitesFor(org, null, true), [org]);
  const data = useData(async () => {
    if (!org) return null;
    try {
      const [reports, emails, settings] = await Promise.all([listClientReports(org), listClientEmails(org), listSiteClientEmail(org)]);
      return { reports, emails, settings, installed: true as const };
    } catch (e) {
      if (isNotInstalled(e)) return { reports: [], emails: [], settings: [], installed: false as const };
      throw e;
    }
  }, [org, tick]);
  const [preview, setPreview] = useState<ClientReport | null>(null);
  const siteName = (id: string) => (sites.data ?? []).find((s) => s.id === id)?.name ?? 'Site';
  const d = data.data;
  const waiting = (d?.reports ?? []).filter((r) => r.status === 'ready');
  const shown = (d?.reports ?? []).filter((r) => filter === 'all' || ['ready', 'waiting', 'not_configured', 'failed', 'no_recipients'].includes(r.status));
  const email = emailSetupState(d?.emails ?? []);
  const refresh = () => setTick((t) => t + 1);
  return (
    <Screen tabbar>
      <TopBar title="Client logs" backTo="/a/more" right={<SyncPill />} />
      <div class="screen-body stack-lg" data-testid="client-logs">
        <p class="foot muted">One combined report per site per night: every guard’s patrols, checkpoint scans, log entries, incidents and photos in time order. Internal-only incidents are never included; guard names are replaced with “Officer 1, 2…”.</p>
        {d && !d.installed && (
          <div class="card" data-testid="client-logs-not-installed"><b>Needs the server update</b><p class="foot muted">Client logs need migration 20261110000200_patrol_client_proof.sql on the server. Nothing is collected or sent until then. See docs/PASS9-backend-setup.md.</p></div>
        )}
        {d?.installed && <EmailBanner state={email} />}
        {d?.installed && (
          <div class="row-between">
            <b data-testid="client-logs-waiting">{waiting.length} waiting for your OK</b>
            <Segmented value={filter} options={[['ok', 'To do'], ['all', 'All']]} onChange={setFilter} />
          </div>
        )}
        {data.loading && !d ? <SkeletonList rows={3} /> : d?.installed ? (shown.length ? (
          <List>
            {shown.map((r) => {
              const st = REPORT_STATUS[r.status] ?? { label: r.status, tone: 'pill-muted' };
              const set = d.settings.find((x) => x.site_id === r.site_id);
              return (
                <div key={r.id} class="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }} data-testid="client-log-row">
                  <div class="row-between">
                    <span><b>{siteName(r.site_id)}</b><span class="foot muted" style={{ display: 'block' }}>Night of {fmtNight(r.night)}</span></span>
                    <span class={`pill ${st.tone}`} data-testid="client-log-status">{st.label}</span>
                  </div>
                  {r.note && <p class="foot" data-testid="client-log-note">{r.note}</p>}
                  {r.last_error && r.status !== 'sent' && <p class="foot" style={{ color: 'var(--danger)' }}>{r.last_error}</p>}
                  <p class="foot muted">
                    {set?.recipients?.length ? `To: ${set.recipients.join(', ')}` : 'No client email for this site — add one under Sites → Client email.'}
                    {' · '}{set?.auto_send_logs ? 'Auto-send' : 'Hold for your OK'}
                    {r.sent_at ? ` · Sent ${fmtDateTime(r.sent_at)}` : ''}{r.send_count > 1 ? ` · ${r.send_count} sends` : ''}
                  </p>
                  <div class="row" style={{ gap: 8 }}>
                    <Button onClick={() => setPreview(r)} data-testid="client-log-preview">Preview</Button>
                    {!['waiting', 'queued', 'sending'].includes(r.status) && <SendButton r={r} onDone={refresh} />}
                  </div>
                </div>
              );
            })}
          </List>
        ) : <Empty icon="file" title={filter === 'ok' ? 'Nothing waiting' : 'No nightly reports yet'} body="A report appears for each site and night with guard activity. It is ready when the last scheduled guard clocks out (or at 8:00 AM PT)." />) : null}
        <Button variant="ghost" onClick={() => navigate('/a/sites')}>Client email settings are on each site (Sites → Client email)</Button>
      </div>
      <Sheet open={!!preview} onClose={() => setPreview(null)} title={preview ? `${siteName(preview.site_id)} · ${fmtNight(preview.night)}` : ''} testid="client-log-sheet">
        {preview && <Preview id={preview.id} />}
      </Sheet>
    </Screen>
  );
}

export function kickMessage(r: KickResult): { text: string; kind: 'success' | 'error' } {
  if (r.state === 'not_deployed') return { text: 'Email sending not configured — nothing was emailed.', kind: 'error' };
  if (r.state === 'queued') return { text: 'Queued — the server will send it on its next run.', kind: 'success' };
  if (r.notConfigured) return { text: 'Email sending not configured — nothing was emailed.', kind: 'error' };
  return { text: r.sent ? 'Sent.' : 'Queued — check the status in a moment.', kind: 'success' };
}

function SendButton({ r, onDone }: { r: ClientReport; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const resend = r.status === 'sent' || r.send_count > 0;
  return (
    <Button variant={r.status === 'ready' ? 'primary' : 'default'} loading={busy} data-testid={resend ? 'client-log-resend' : 'client-log-send'} onClick={async () => {
      setBusy(true);
      try { const k = kickMessage(await sendReport(r.id)); toast(k.text, k.kind, 4000); }
      catch (e) { toast((e as Error).message === 'report_not_ready' ? 'This report is not ready yet.' : (e as Error).message, 'error'); }
      finally { setBusy(false); onDone(); }
    }}>{resend ? 'Resend' : 'Send now'}</Button>
  );
}

function EmailBanner({ state }: { state: ReturnType<typeof emailSetupState> }) {
  if (state === 'working') return null;
  const text = {
    not_configured: 'Email sending not configured. Reports are kept here but nothing is emailed to clients until the email function and its sender secrets are set up.',
    dry_run: 'Email is in dry-run mode: reports are processed but not emailed.',
    failing: 'The last email failed to send. Check the error on the report and the email provider settings.',
    unknown: 'No client email has been sent yet. If email sending is not set up, a send will show “Email sending not configured”.',
  }[state];
  return <div class="card" data-testid="email-not-configured" style={{ borderColor: state === 'unknown' ? undefined : 'var(--warning)' }}><b>{{ not_configured: 'Email sending not configured', dry_run: 'Email in dry-run mode', failing: 'Email sending failing', unknown: 'Client email' }[state]}</b><p class="foot muted">{text}</p></div>;
}

function Preview({ id }: { id: string }) {
  const [r, setR] = useState<MergedReport | null | undefined>(undefined);
  useEffect(() => { void previewReport(id).then(setR).catch(() => setR(null)); }, [id]);
  if (r === undefined) return <SkeletonList rows={4} />;
  if (r === null) return <p class="muted">Could not load this report.</p>;
  const c = r.counts;
  return (
    <div class="stack" data-testid="client-log-preview-body">
      <p class="foot muted">Exactly what the client receives. All times Pacific.</p>
      <div class="foot"><b>{c.officers}</b> officer{c.officers === 1 ? '' : 's'} · <b>{c.patrols}</b> patrols · <b>{c.scans}</b> scans · <b>{c.logs}</b> log entries · <b>{c.incidents}</b> incidents · <b>{c.photos}</b> photos</div>
      {r.note && <p class="foot"><i>{r.note}</i></p>}
      <SectionLabel>Timeline</SectionLabel>
      {r.lines.length ? r.lines.map((l, i) => (
        <div key={i} class="row" style={{ gap: 10, alignItems: 'flex-start' }} data-testid="client-log-line">
          <span class="foot tnum muted" style={{ minWidth: 64 }}>{fmtTimePT(l.at)}</span>
          <span class="grow"><b class="foot">{l.title}</b><div class="sub" style={{ whiteSpace: 'pre-wrap' }}>{l.text}</div>{l.photos.length > 0 && <div class="foot muted">{l.photos.length} photo{l.photos.length > 1 ? 's' : ''}</div>}</span>
        </div>
      )) : <p class="muted">No activity recorded.</p>}
    </div>
  );
}

import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { SectionLabel, Empty } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { PdfButton } from '../../ui/PdfButton';
import { BoloCard, type BoloView } from '../../ui/BoloCard';
import { RemotePhotos, type RemotePhoto } from '../../ui/RemotePhotos';
import { extraDetails } from '../../domain/incident';
import { fmtDate, fmtDateTime, relTime } from '../../lib/format';
import type { Row } from '../../data/db';

type PdfMaker = () => Promise<{ bytes: Uint8Array; pages: number; filename: string }>;
export interface PortalModel {
  orgName: string; orgPhone?: string | null; orgEmail?: string | null;
  siteName: string; siteAddress?: string;
  incidents: Row[]; dars: Row[]; runs: Row[]; bolos: Row[];
  expiresAt?: string | null;
}

/**
 * Item 7: client-facing portal (shared by the no-login /p/ link and the signed-in client app).
 * Light theme, summary first: site status, pinned BOLOs, recent reports with PDF downloads,
 * patrol proof. No guard/admin chrome.
 */
export function PortalView({ m, incidentPdf, darPdf, openIncident, openDar, headerRight, kind }: {
  m: PortalModel; incidentPdf: (id: string) => PdfMaker; darPdf: (id: string) => PdfMaker;
  openIncident?: (id: string) => void; openDar?: (id: string) => void; headerRight?: ComponentChildren; kind: 'portal' | 'client';
}) {
  const [filter, setFilter] = useState<'all' | 'incident' | 'dar'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const now = Date.now();
  const recentInc = m.incidents.filter((i) => now - Date.parse(String(i.occurred_at)) < 7 * 864e5);
  const serious = recentInc.filter((i) => i.severity === 'high' || i.severity === 'critical');
  const lastRun = [...m.runs].sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0];
  const week = m.runs.filter((r) => now - Date.parse(String(r.started_at)) < 7 * 864e5);
  const exp = week.reduce((n, r) => n + Number(r.expected_count ?? 0), 0);
  const got = week.reduce((n, r) => n + Math.min(Number(r.scanned_count ?? 0), Number(r.expected_count ?? 0)), 0);
  const pct = exp ? Math.round((got / exp) * 100) : null;
  const status = serious.length ? { tone: 'warning', label: `${serious.length} serious incident${serious.length > 1 ? 's' : ''} this week` } : recentInc.length ? { tone: 'info', label: `${recentInc.length} report${recentInc.length > 1 ? 's' : ''} this week` } : { tone: 'success', label: 'All clear this week' };

  const items = [
    ...m.incidents.map((i) => ({ kind: 'incident' as const, id: i.id, at: String(i.occurred_at), row: i })),
    ...m.dars.map((d) => ({ kind: 'dar' as const, id: d.id, at: `${d.report_date}T12:00:00Z`, row: d })),
  ].filter((x) => filter === 'all' || x.kind === filter).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);

  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i)); return d; });
  const perDay = days.map((d) => {
    const rs = m.runs.filter((r) => { const t = Date.parse(String(r.started_at)); return t >= d.getTime() - 12 * 3600e3 && t < d.getTime() + 12 * 3600e3; });
    const e = rs.reduce((n, r) => n + Number(r.expected_count ?? 0), 0);
    const g = rs.reduce((n, r) => n + Math.min(Number(r.scanned_count ?? 0), Number(r.expected_count ?? 0)), 0);
    return { d, pct: e ? Math.round((g / e) * 100) : null };
  });

  return (
    <div class="client-theme cp" data-testid={kind === 'client' ? 'client-home' : 'portal'}>
      <div class="cp-inner stack-lg">
        <header class="row-between cp-head">
          <span class="row" style={{ gap: 10 }}>
            <img src={`${import.meta.env.BASE_URL}brand/logo-mark.svg`} alt="" style={{ width: 36 }} />
            <span><b class="cp-org">{m.orgName}</b><span class="foot muted" style={{ display: 'block' }}>Client portal</span></span>
          </span>
          {headerRight}
        </header>

        <section class="cp-hero" data-testid="cp-status">
          <div class="cap muted">Your site</div>
          <h1 class="cp-site" data-testid={kind === 'portal' ? 'portal-site' : 'client-site'}>{m.siteName}</h1>
          {m.siteAddress && <div class="muted sub">{m.siteAddress}</div>}
          <div class={`cp-status cp-${status.tone}`}><Icon name={status.tone === 'success' ? 'shield-check' : 'alert'} size={18} /> {status.label}</div>
          <div class="cp-stats">
            <div><b class="tnum">{lastRun ? relTime(String(lastRun.started_at)) : '—'}</b><span>Last patrol</span></div>
            <div><b class="tnum">{pct == null ? '—' : `${pct}%`}</b><span>Checkpoints, 7 days</span></div>
            <div><b class="tnum">{m.incidents.length + m.dars.length}</b><span>Reports shared</span></div>
          </div>
        </section>

        {m.bolos.length > 0 && (
          <section data-testid={kind === 'portal' ? 'portal-bolos' : 'client-bolos'}>
            <SectionLabel>Be on the lookout</SectionLabel>
            <div class="stack">{m.bolos.map((b) => <BoloCard key={b.id} b={b as unknown as BoloView}><RemotePhotos photos={(b.photos as RemotePhoto[] | undefined) ?? []} /></BoloCard>)}</div>
          </section>
        )}

        <section>
          <div class="row-between"><SectionLabel>Recent reports</SectionLabel>
            <div class="seg cp-seg">
              {([['all', 'All'], ['incident', 'Incidents'], ['dar', 'Daily']] as const).map(([k, l]) => <button key={k} class={filter === k ? 'active' : ''} onClick={() => setFilter(k)} data-testid={`cp-filter-${k}`}>{l}</button>)}
            </div>
          </div>
          {items.length ? (
            <div class="list">
              {items.map((x) => x.kind === 'incident' ? (
                <div key={x.id} class="list-row cp-row" data-testid={kind === 'portal' ? 'portal-incident' : 'client-incident'}>
                  <div class="row" style={{ width: '100%', gap: 12 }}>
                    <button class="row grow" style={{ textAlign: 'left', gap: 12, minWidth: 0 }} onClick={() => (openIncident ? openIncident(x.id) : setOpen(open === x.id ? null : x.id))}>
                      <span class="list-icon" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}><Icon name="file" /></span>
                      <span class="grow" style={{ minWidth: 0 }}><b class="ellipsis" style={{ display: 'block' }}>{String(x.row.title || x.row.category_name || 'Incident report')}</b>
                        <span class="foot muted">{x.row.report_no ? `${x.row.report_no} · ` : ''}{fmtDateTime(x.at)}</span></span>
                      {(x.row.severity === 'high' || x.row.severity === 'critical') && <span class="pill pill-danger">{String(x.row.severity)}</span>}
                    </button>
                    <PdfButton label="PDF" testid={kind === 'portal' ? 'portal-incident-pdf' : 'client-incident-row-pdf'} make={incidentPdf(x.id)} />
                  </div>
                  {open === x.id && !openIncident && (
                    <div class="stack" style={{ gap: 10, width: '100%' }}>
                      {extraDetails(x.row).length > 0 && <div class="card kv" data-testid="portal-extra">{extraDetails(x.row).map(([k, v]) => <div key={k}><span>{k}</span>{v}</div>)}</div>}
                      <div class="sub" style={{ whiteSpace: 'pre-wrap' }}>{String(x.row.description ?? '')}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div key={x.id} class="list-row cp-row" data-testid={kind === 'portal' ? 'portal-dar' : 'client-dar'}>
                  <div class="row" style={{ width: '100%', gap: 12 }}>
                    <button class="row grow" style={{ textAlign: 'left', gap: 12, minWidth: 0 }} onClick={() => openDar?.(x.id)} disabled={!openDar}>
                      <span class="list-icon" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}><Icon name="activity" /></span>
                      <span class="grow" style={{ minWidth: 0 }}><b class="ellipsis" style={{ display: 'block' }}>Daily report · {new Date(x.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</b>
                        <span class="foot muted">{String(x.row.author_name ?? '')}{Array.isArray(x.row.entries) ? ` · ${(x.row.entries as Row[]).length} entries` : x.row.report_no ? ` · ${x.row.report_no}` : ''}</span></span>
                    </button>
                    <PdfButton label="PDF" testid={kind === 'portal' ? 'portal-dar-pdf' : 'client-dar-row-pdf'} make={darPdf(x.id)} />
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty icon="file" title="No reports shared yet" body={`Reports appear here when ${m.orgName} shares them.`} />}
        </section>

        <section>
          <SectionLabel>Patrol proof · last 7 nights</SectionLabel>
          <div class="card">
            <div class="cp-bars" aria-label="Patrol completion by night">
              {perDay.map((x) => (
                <div key={x.d.toISOString()}>
                  <span class="foot tnum" style={{ color: x.pct == null ? 'var(--text-3)' : 'var(--text)' }}>{x.pct == null ? '—' : `${x.pct}%`}</span>
                  <span class="cp-bar" style={{ height: `${Math.max(4, (x.pct ?? 0) * 0.7)}px`, background: x.pct == null ? 'var(--raised-2)' : x.pct < 80 ? 'var(--warning)' : 'var(--success)' }} />
                  <span class="foot muted">{x.d.toLocaleDateString('en-US', { weekday: 'narrow' })}</span>
                </div>
              ))}
            </div>
            <p class="foot muted" style={{ marginTop: 10 }}>Every patrol is verified with timestamped QR checkpoint scans.</p>
          </div>
        </section>

        <footer class="cp-foot">
          <div class="row" style={{ gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            {m.orgPhone && <a class="btn" href={`tel:${String(m.orgPhone).replace(/[^\d+]/g, '')}`}><Icon name="phone" /> Call us</a>}
            {m.orgEmail && <a class="btn" href={`mailto:${m.orgEmail}`}><Icon name="mail" /> Email</a>}
          </div>
          <p class="foot faint" style={{ textAlign: 'center' }}>Read-only portal provided by {m.orgName}.{m.expiresAt ? ` This link expires ${fmtDate(m.expiresAt)}.` : ''}</p>
        </footer>
      </div>
    </div>
  );
}

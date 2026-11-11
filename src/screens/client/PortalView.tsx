import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { SectionLabel, Empty, Button } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { PdfButton } from '../../ui/PdfButton';
import { BoloCard, type BoloView } from '../../ui/BoloCard';
import { RemotePhotos, type RemotePhoto } from '../../ui/RemotePhotos';
import { extraDetails } from '../../domain/incident';
import { invoiceState, monthLabel } from '../../domain/invoice';
import { fmtDate, fmtDateTime, fmtTime, relTime, siteLocalDate } from '../../lib/format';
import type { Row } from '../../data/db';

type PdfMaker = () => Promise<{ bytes: Uint8Array; pages: number; filename: string }>;

/** Payload of patrol_site_proof (supabase/migrations/20261110000200_patrol_client_proof.sql). No guard names, pay or schedules. */
export interface ClientProof {
  checkpoint_count: number;
  live: { on_site: 'yes' | 'no' | 'unverified'; since: string | null; last_scan: { checkpoint: string; at: string } | null; next_patrol_due: string | null; today: { expected: number; scanned: number } };
  last_shift_at: string | null;
  scans: Array<{ checkpoint: string; at: string }>;
  nights: Array<{ night: string; shifts: number; scans: number; logs: number; expected: number; scanned: number }>;
  incident_media: Array<{ incident_id: string; photos: RemotePhoto[]; photos_pending: number; follow_up: Array<{ at: string; status: string }> }>;
  invoices: Array<{ id: string; invoice_no: string; status: string; issue_date: string; due_date: string; period_month: string; total: number; rate: number; sent_at: string | null; paid_at: string | null; hours: number; days: Array<{ date: string; hours: number }> }>;
  pay_url: string | null;
  requests: Array<{ id: string; body: string; created_at: string; status: string; reply: string | null; replied_at: string | null; contact_name: string | null }>;
}

export interface PortalModel {
  orgName: string; orgPhone?: string | null; orgEmail?: string | null;
  siteName: string; siteAddress?: string;
  incidents: Row[]; dars: Row[]; runs: Row[]; bolos: Row[];
  expiresAt?: string | null;
  /** Missing until the pass 9 chunk 2 migration is applied on the server. */
  proof?: ClientProof | null;
}

const STATUS_LABEL: Record<string, string> = { submitted: 'Received', reviewed: 'Reviewed', sent_to_client: 'Sent to you', closed: 'Closed' };
export const clientStatus = (s: unknown) => STATUS_LABEL[String(s)] ?? String(s ?? '');
const sevTone = (s: unknown) => (s === 'high' || s === 'critical' ? 'pill-danger' : s === 'medium' ? 'pill-warning' : '');
const pct = (got: number, exp: number) => (exp ? Math.round((got / exp) * 100) : null);
const money = (n: number) => `$${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Item 7 / pass 9 A7 + C1: client-facing portal (shared by the no-login /p/ link and the signed-in client app).
 * Light theme, summary first: live guard status (on site only with a GPS-verified clock-in, never a guard
 * name), patrol proof (shifts + checkpoint scans + log entries), shared reports readable in-portal, invoices
 * and the request thread. No guard/admin chrome, no pay, no schedules, no internal notes.
 */
export function PortalView({ m, incidentPdf, darPdf, openIncident, openDar, headerRight, kind, onRequest }: {
  m: PortalModel; incidentPdf: (id: string) => PdfMaker; darPdf: (id: string) => PdfMaker;
  openIncident?: (id: string) => void; openDar?: (id: string) => void; headerRight?: ComponentChildren; kind: 'portal' | 'client';
  onRequest?: (body: string, name: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<'all' | 'incident' | 'dar'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const p = m.proof ?? null;
  const tid = (s: string) => `${kind === 'portal' ? 'portal' : 'client'}-${s}`;
  const now = Date.now();
  const recentInc = m.incidents.filter((i) => now - Date.parse(String(i.occurred_at)) < 7 * 864e5);
  const serious = recentInc.filter((i) => i.severity === 'high' || i.severity === 'critical');
  const lastRun = [...m.runs].sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0];
  const week = p ? p.nights.reduce((a, n) => ({ e: a.e + n.expected, g: a.g + n.scanned }), { e: 0, g: 0 })
    : m.runs.filter((r) => now - Date.parse(String(r.started_at)) < 7 * 864e5).reduce((a, r) => ({ e: a.e + Number(r.expected_count ?? 0), g: a.g + Math.min(Number(r.scanned_count ?? 0), Number(r.expected_count ?? 0)) }), { e: 0, g: 0 });
  const weekPct = pct(week.g, week.e);
  const status = serious.length ? { tone: 'warning', label: `${serious.length} serious incident${serious.length > 1 ? 's' : ''} this week` } : recentInc.length ? { tone: 'info', label: `${recentInc.length} report${recentInc.length > 1 ? 's' : ''} this week` } : { tone: 'success', label: 'All clear this week' };
  const media = new Map((p?.incident_media ?? []).map((x) => [x.incident_id, x]));

  const items = [
    ...m.incidents.map((i) => ({ kind: 'incident' as const, id: i.id, at: String(i.occurred_at), row: i })),
    ...m.dars.map((d) => ({ kind: 'dar' as const, id: d.id, at: `${d.report_date}T20:00:00Z`, row: d })),
  ].filter((x) => filter === 'all' || x.kind === filter).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);

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
            <div data-testid={tid('last-shift')}><b class="tnum">{p ? (p.last_shift_at ? fmtDate(p.last_shift_at) : '—') : lastRun ? relTime(String(lastRun.started_at)) : '—'}</b><span>{p ? 'Last shift' : 'Last patrol'}</span></div>
            <div><b class="tnum">{weekPct == null ? '—' : `${weekPct}%`}</b><span>Checkpoints, 7 days</span></div>
            <div><b class="tnum">{m.incidents.length + m.dars.length}</b><span>Reports shared</span></div>
          </div>
        </section>

        {p ? <LiveCard p={p} tid={tid} /> : (
          <p class="foot muted" data-testid={tid('live-unavailable')}>Live guard status and checkpoint proof are not available on this portal yet.</p>
        )}

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
              {items.map((x) => {
                const expanded = open === x.id;
                const toggle = () => setOpen(expanded ? null : x.id);
                if (x.kind === 'incident') {
                  const md = media.get(x.id);
                  const photos = md?.photos ?? (x.row.photos as RemotePhoto[] | undefined) ?? [];
                  const title = String(x.row.title || x.row.category_name || 'Incident report');
                  return (
                    <div key={x.id} class="list-row cp-row" data-testid={tid('incident')}>
                      <div class="row" style={{ width: '100%', gap: 12 }}>
                        <button class="row grow" style={{ textAlign: 'left', gap: 12, minWidth: 0 }} aria-expanded={openIncident ? undefined : expanded} onClick={() => (openIncident ? openIncident(x.id) : toggle())}>
                          <span class="list-icon" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}><Icon name="file" /></span>
                          <span class="grow" style={{ minWidth: 0 }}><b class={expanded ? '' : 'ellipsis'} style={{ display: 'block', overflowWrap: 'anywhere' }} data-testid={tid('incident-title')}>{title}</b>
                            <span class="foot muted">{x.row.report_no ? `${x.row.report_no} · ` : ''}{fmtDateTime(x.at)}{x.row.status ? ` · ${clientStatus(x.row.status)}` : ''}</span></span>
                          {x.row.severity ? <span class={`pill ${sevTone(x.row.severity)}`}>{String(x.row.severity)}</span> : null}
                        </button>
                        <PdfButton label="PDF" testid={kind === 'portal' ? 'portal-incident-pdf' : 'client-incident-row-pdf'} make={incidentPdf(x.id)} />
                      </div>
                      {expanded && !openIncident && (
                        <div class="stack" style={{ gap: 10, width: '100%' }} data-testid={tid('incident-detail')}>
                          <div class="card kv">
                            <div><span>Severity</span>{String(x.row.severity ?? '—')}</div>
                            <div><span>Status</span>{clientStatus(x.row.status)}</div>
                            {x.row.location_text ? <div><span>Location</span>{String(x.row.location_text)}</div> : null}
                            <div><span>Police</span>{x.row.police_called ? `${x.row.police_agency ?? 'Contacted'}${x.row.police_case_no ? ` · case ${x.row.police_case_no}` : ''}` : 'Not contacted'}</div>
                          </div>
                          {extraDetails(x.row).length > 0 && <div class="card kv" data-testid="portal-extra">{extraDetails(x.row).map(([k, v]) => <div key={k}><span>{k}</span>{v}</div>)}</div>}
                          <div class="sub" style={{ whiteSpace: 'pre-wrap' }}>{String(x.row.description ?? '')}</div>
                          <IncidentExtras photos={photos} pending={md?.photos_pending ?? 0} followUp={md?.follow_up ?? []} />
                        </div>
                      )}
                    </div>
                  );
                }
                const entries = Array.isArray(x.row.entries) ? (x.row.entries as Row[]) : null;
                return (
                  <div key={x.id} class="list-row cp-row" data-testid={tid('dar')}>
                    <div class="row" style={{ width: '100%', gap: 12 }}>
                      <button class="row grow" style={{ textAlign: 'left', gap: 12, minWidth: 0 }} aria-expanded={openDar ? undefined : expanded} onClick={() => (openDar ? openDar(x.id) : toggle())}>
                        <span class="list-icon" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}><Icon name="activity" /></span>
                        <span class="grow" style={{ minWidth: 0 }}><b class="ellipsis" style={{ display: 'block' }}>Daily report · {fmtDate(x.at)}</b>
                          <span class="foot muted">{[x.row.report_no, entries ? `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}` : null].filter(Boolean).join(' · ')}</span></span>
                      </button>
                      <PdfButton label="PDF" testid={kind === 'portal' ? 'portal-dar-pdf' : 'client-dar-row-pdf'} make={darPdf(x.id)} />
                    </div>
                    {expanded && !openDar && <DarBody row={x.row} entries={entries ?? []} testid={tid('dar-detail')} />}
                  </div>
                );
              })}
            </div>
          ) : <Empty icon="file" title="No reports shared yet" body={`Reports appear here when ${m.orgName} shares them.`} />}
        </section>

        <PatrolProof p={p} runs={m.runs} />

        {p && <ScanList scans={p.scans} cps={p.checkpoint_count} tid={tid} />}

        {p && <Billing p={p} orgName={m.orgName} tid={tid} />}

        {p && onRequest && <Requests p={p} orgName={m.orgName} portal={kind === 'portal'} onRequest={onRequest} tid={tid} />}

        <footer class="cp-foot">
          <div class="row" style={{ gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            {m.orgPhone && <a class="btn" href={`tel:${String(m.orgPhone).replace(/[^\d+]/g, '')}`}><Icon name="phone" /> Call us</a>}
            {m.orgEmail && <a class="btn" href={`mailto:${m.orgEmail}`}><Icon name="mail" /> Email</a>}
          </div>
          <p class="foot faint" style={{ textAlign: 'center' }} data-testid={tid('expiry')}>
            {kind === 'portal' ? `Private link provided by ${m.orgName}. ${m.expiresAt ? `It expires ${fmtDate(m.expiresAt)}` : 'It has no expiry date'} and ${m.orgName} can revoke it at any time.` : `Provided by ${m.orgName}.`}
            {' '}All times Pacific.
          </p>
        </footer>
      </div>
    </div>
  );
}

function LiveCard({ p, tid }: { p: ClientProof; tid: (s: string) => string }) {
  const l = p.live;
  const todayPct = pct(l.today.scanned, l.today.expected);
  return (
    <section data-testid={tid('live')}>
      <SectionLabel>Right now</SectionLabel>
      <div class="card kv">
        <div data-testid={tid('on-site')}><span>Guard on site now</span>
          {l.on_site === 'yes' ? <b style={{ color: 'var(--success)' }}>Yes · since {fmtTime(l.since)}</b>
            : l.on_site === 'unverified' ? <span>Not confirmed — clocked in {fmtTime(l.since)} without a GPS-verified location</span>
            : <span>No</span>}
        </div>
        {p.checkpoint_count > 0 ? (
          <>
            <div data-testid={tid('last-checkpoint')}><span>Last checkpoint</span>{l.last_scan ? `${l.last_scan.checkpoint} · ${fmtDateTime(l.last_scan.at)}` : 'No scans yet'}</div>
            <div data-testid={tid('next-patrol')}><span>Next patrol due</span>{l.next_patrol_due ? fmtTime(l.next_patrol_due) : 'No guard on shift'}</div>
            <div data-testid={tid('patrol-today')}><span>Patrol today</span>{l.today.expected ? `${l.today.scanned}/${l.today.expected} checkpoints (${todayPct}%)` : 'No patrol rounds yet'}</div>
          </>
        ) : null}
      </div>
      {p.checkpoint_count === 0 && (
        <p class="foot muted" style={{ marginTop: 8 }} data-testid={tid('no-checkpoints')}>No checkpoints configured for this site — add checkpoints to enable patrol proof.</p>
      )}
    </section>
  );
}

function IncidentExtras({ photos, pending, followUp }: { photos: RemotePhoto[]; pending: number; followUp: Array<{ at: string; status: string }> }) {
  return (
    <>
      {photos.length > 0 && <div data-testid="cp-incident-photos"><RemotePhotos photos={photos} /></div>}
      {pending > 0 && <p class="foot muted">{pending} photo{pending > 1 ? 's are' : ' is'} still uploading from the officer's phone.</p>}
      {followUp.length > 0 && (
        <div data-testid="cp-follow-up"><div class="cap muted">Follow-up</div>
          {followUp.map((f) => <div class="foot" key={f.at + f.status}>{fmtDateTime(f.at)} · {clientStatus(f.status)}</div>)}
        </div>
      )}
    </>
  );
}
export { IncidentExtras };

function DarBody({ row, entries, testid }: { row: Row; entries: Row[]; testid: string }) {
  const tours = Array.isArray(row.tours) ? (row.tours as Row[]) : [];
  return (
    <div class="stack" style={{ gap: 8, width: '100%' }} data-testid={testid}>
      {row.summary ? <div class="sub" style={{ whiteSpace: 'pre-wrap' }}>{String(row.summary)}</div> : null}
      {tours.length > 0 && <div class="foot muted">{tours.length} patrol round{tours.length > 1 ? 's' : ''} · {tours.reduce((n, t) => n + Math.min(Number(t.scanned_count ?? 0), Number(t.expected_count ?? 0)), 0)}/{tours.reduce((n, t) => n + Number(t.expected_count ?? 0), 0)} checkpoints</div>}
      {entries.map((e, i) => (
        <div key={i} class="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span class="foot tnum muted" style={{ minWidth: 64 }}>{fmtTime(e.occurred_at as string)}</span>
          <span class="grow"><b class="foot">{String(e.category_name ?? 'Log')}</b><div class="sub" style={{ whiteSpace: 'pre-wrap' }}>{String(e.body ?? '')}</div></span>
        </div>
      ))}
      {!entries.length && <p class="foot muted">No log entries in this report.</p>}
    </div>
  );
}

function PatrolProof({ p, runs }: { p: ClientProof | null; runs: Row[] }) {
  const nights = p ? p.nights : Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 864e5);
    const night = siteLocalDate(d.toISOString());
    const rs = runs.filter((r) => siteLocalDate(String(r.started_at)) === night);
    return { night, shifts: 0, scans: 0, logs: 0, expected: rs.reduce((n, r) => n + Number(r.expected_count ?? 0), 0), scanned: rs.reduce((n, r) => n + Math.min(Number(r.scanned_count ?? 0), Number(r.expected_count ?? 0)), 0) };
  });
  return (
    <section data-testid="cp-proof">
      <SectionLabel>Patrol proof · last 7 nights</SectionLabel>
      <div class="card">
        <div class="cp-bars" aria-label="Patrol completion by night">
          {nights.map((n) => {
            const v = pct(n.scanned, n.expected);
            const active = n.shifts + n.scans + n.logs > 0;
            return (
              <div key={n.night}>
                <span class="foot tnum" style={{ color: v == null && !active ? 'var(--text-3)' : 'var(--text)' }}>{v != null ? `${v}%` : active ? '✓' : '—'}</span>
                <span class="cp-bar" style={{ height: `${v != null ? Math.max(4, v * 0.7) : active ? 40 : 4}px`, background: v == null ? (active ? 'var(--info)' : 'var(--raised-2)') : v < 80 ? 'var(--warning)' : 'var(--success)' }} />
                <span class="foot muted">{new Date(`${n.night}T20:00:00Z`).toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'America/Los_Angeles' })}</span>
              </div>
            );
          })}
        </div>
        {p && (
          <div class="stack" style={{ gap: 2, marginTop: 10 }} data-testid="cp-proof-nights">
            {[...nights].reverse().filter((n) => n.shifts + n.scans + n.logs > 0).map((n) => (
              <div class="foot" key={n.night}><b>{fmtDate(`${n.night}T20:00:00Z`)}</b> · {n.shifts} shift{n.shifts === 1 ? '' : 's'} · {n.scans} checkpoint scan{n.scans === 1 ? '' : 's'} · {n.logs} log entr{n.logs === 1 ? 'y' : 'ies'}</div>
            ))}
          </div>
        )}
        <p class="foot muted" style={{ marginTop: 10 }}>
          {p ? 'A night counts when a guard worked a shift, scanned a checkpoint or logged activity. Percentages come from timestamped QR checkpoint scans.' : 'Percentages come from timestamped QR checkpoint scans.'}
        </p>
      </div>
    </section>
  );
}

function ScanList({ scans, cps, tid }: { scans: ClientProof['scans']; cps: number; tid: (s: string) => string }) {
  const [all, setAll] = useState(false);
  if (!cps) return null;
  const shown = all ? scans : scans.slice(0, 15);
  return (
    <section data-testid={tid('scans')}>
      <SectionLabel>Checkpoint scans · last 7 days</SectionLabel>
      {scans.length ? (
        <div class="card" style={{ padding: '6px 14px' }}>
          {shown.map((s, i) => <div key={i} class="row-between foot" style={{ padding: '6px 0' }} data-testid={tid('scan-row')}><span>{s.checkpoint}</span><span class="tnum muted">{fmtDateTime(s.at)}</span></div>)}
          {scans.length > shown.length && <Button variant="ghost" onClick={() => setAll(true)}>Show all {scans.length}</Button>}
        </div>
      ) : <p class="foot muted">No checkpoint scans in the last 7 days.</p>}
    </section>
  );
}

function Billing({ p, orgName, tid }: { p: ClientProof; orgName: string; tid: (s: string) => string }) {
  const [open, setOpen] = useState<string | null>(null);
  const today = siteLocalDate(new Date().toISOString());
  return (
    <section data-testid={tid('billing')}>
      <SectionLabel>Invoices</SectionLabel>
      {p.invoices.length ? (
        <div class="list">
          {p.invoices.map((v) => {
            const st = invoiceState(v, today);
            return (
              <div key={v.id} class="list-row cp-row" data-testid={tid('invoice')}>
                <button class="row-between" style={{ width: '100%', textAlign: 'left' }} onClick={() => setOpen(open === v.id ? null : v.id)}>
                  <span><b>{v.invoice_no}</b><span class="foot muted" style={{ display: 'block' }}>{monthLabel(String(v.period_month).slice(0, 7))} · {Number(v.hours).toFixed(1)} h · due {fmtDate(`${v.due_date}T20:00:00Z`)}</span></span>
                  <span style={{ textAlign: 'right' }}><b class="tnum">{money(v.total)}</b>
                    <span class={`pill ${st === 'paid' ? 'pill-success' : st === 'overdue' ? 'pill-danger' : 'pill-warning'}`} style={{ display: 'block' }}>{st === 'paid' ? 'Paid' : st === 'overdue' ? 'Overdue' : 'Unpaid'}</span></span>
                </button>
                {open === v.id && (
                  <div class="foot" style={{ width: '100%' }} data-testid={tid('invoice-hours')}>
                    <div class="muted">Billed from confirmed guard hours:</div>
                    {v.days.map((d) => <div class="row-between" key={d.date}><span>{fmtDate(`${d.date}T20:00:00Z`)}</span><span class="tnum">{Number(d.hours).toFixed(2)} h</span></div>)}
                  </div>
                )}
                {st !== 'paid' && (p.pay_url
                  ? <a class="btn btn-primary" href={p.pay_url} target="_blank" rel="noopener" data-testid={tid('pay-link')}>Pay online</a>
                  : <p class="foot muted" data-testid={tid('no-pay-link')}>Online payment isn't set up — contact {orgName} to pay.</p>)}
              </div>
            );
          })}
        </div>
      ) : <p class="foot muted">No invoices sent yet.</p>}
    </section>
  );
}

function Requests({ p, orgName, portal, onRequest, tid }: { p: ClientProof; orgName: string; portal: boolean; onRequest: (body: string, name: string) => Promise<void>; tid: (s: string) => string }) {
  const [body, setBody] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    if (body.trim().length < 3) { setErr('Write a few words first.'); return; }
    setBusy(true); setErr(null);
    try { await onRequest(body.trim(), name.trim()); setBody(''); } catch (e) { setErr(/too_many/.test(String(e)) ? 'Too many requests today — please call us.' : 'Could not send. Check your connection and try again.'); }
    setBusy(false);
  };
  return (
    <section data-testid={tid('requests')}>
      <SectionLabel>Requests</SectionLabel>
      <div class="card stack" style={{ gap: 8 }}>
        {portal && <input class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Your name (optional)" maxLength={80} data-testid="cp-request-name" />}
        <textarea class="input" rows={3} value={body} onInput={(e) => setBody(e.currentTarget.value)} placeholder="Ask for something or send a message" maxLength={2000} data-testid="cp-request-body" />
        {err && <p class="foot" style={{ color: 'var(--danger)' }}>{err}</p>}
        <Button variant="primary" loading={busy} onClick={() => void send()} data-testid="cp-request-send">Send request</Button>
        <p class="foot muted">Goes to {orgName} as a task. Replies appear here — you are not emailed or texted about replies.</p>
      </div>
      {p.requests.length > 0 && (
        <div class="list" style={{ marginTop: 8 }}>
          {p.requests.map((q) => (
            <div key={q.id} class="list-row cp-row" data-testid="cp-request">
              <div class="row-between"><span class="foot muted">{fmtDateTime(q.created_at)}{q.contact_name ? ` · ${q.contact_name}` : ''}</span>
                <span class="pill">{q.status === 'done' ? 'Done' : q.status === 'in_progress' ? 'In progress' : 'Open'}</span></div>
              <div class="sub" style={{ whiteSpace: 'pre-wrap' }}>{q.body}</div>
              {q.reply && <div class="foot" style={{ whiteSpace: 'pre-wrap' }}><b>{orgName}:</b> {q.reply}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

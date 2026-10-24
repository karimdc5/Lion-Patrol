import { useEffect, useState } from 'preact/hooks';
import { Empty, SectionLabel, List, Skeleton } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { PdfButton } from '../../ui/PdfButton';
import { getBackend, phase } from '../../auth/session';
import { fmtDateTime, fmtDate } from '../../lib/format';
import type { Row } from '../../data/db';

interface PortalData { org: Row; site: Row; incidents: Row[]; dars: Row[]; runs: Row[]; expires_at: string | null }

/** Read-only, no-login client portal for one site (opened from an admin-generated link). */
export default function PortalPage({ token }: { token: string }) {
  const [data, setData] = useState<PortalData | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const ready = phase.value !== 'booting';
  useEffect(() => {
    if (!ready) return;
    void getBackend().rpc<PortalData | null>('patrol_get_portal', { p_token: token }).then((d) => setData(d ?? null)).catch(() => setData(null));
  }, [ready, token]);

  if (data === undefined) return <div class="portal"><div class="portal-inner stack"><Skeleton h={80} r={16} /><Skeleton h={160} r={16} /><Skeleton h={220} r={16} /></div></div>;
  if (data === null) return (
    <div class="portal"><div class="portal-inner">
      <PortalHeader orgName="Lion Security Services" />
      <Empty icon="lock" title="This link is no longer active" body="Ask Lion Security Services for a new client portal link." />
    </div></div>
  );
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i)); return d; });
  const perDay = days.map((d) => {
    const rs = data.runs.filter((r) => { const t = Date.parse(String(r.started_at)); return t >= d.getTime() - 12 * 3600e3 && t < d.getTime() + 12 * 3600e3; });
    const exp = rs.reduce((n, r) => n + Number(r.expected_count ?? 0), 0);
    const got = rs.reduce((n, r) => n + Math.min(Number(r.scanned_count ?? 0), Number(r.expected_count ?? 0)), 0);
    return { d, pct: exp ? Math.round((got / exp) * 100) : null };
  });
  const make = (kind: 'incident' | 'dar', id: string) => () => import('../../pdf/portal').then((m) => m.buildFromPortal(kind, data, id));
  return (
    <div class="portal" data-testid="portal">
      <div class="portal-inner stack-lg">
        <PortalHeader orgName={String(data.org.name)} />
        <div>
          <h1 class="large-title" style={{ fontSize: 30, lineHeight: '36px' }} data-testid="portal-site">{String(data.site.name)}</h1>
          <div class="muted sub">{[data.site.address, data.site.city, data.site.state].filter(Boolean).join(', ')}</div>
        </div>
        <div>
          <SectionLabel>Patrol proof · last 7 nights</SectionLabel>
          <div class="card">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, alignItems: 'end', height: 120 }}>
              {perDay.map((x) => (
                <div key={x.d.toISOString()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                  <span class="foot tnum" style={{ color: x.pct == null ? 'var(--text-3)' : 'var(--text)' }}>{x.pct == null ? '—' : `${x.pct}%`}</span>
                  <span style={{ width: '70%', borderRadius: 6, height: `${Math.max(4, (x.pct ?? 0) * 0.7)}px`, background: x.pct == null ? 'var(--raised-2)' : x.pct < 80 ? 'var(--warning)' : 'var(--success)' }} />
                  <span class="foot muted">{x.d.toLocaleDateString('en-US', { weekday: 'narrow' })}</span>
                </div>
              ))}
            </div>
            <p class="foot muted" style={{ marginTop: 10 }}>{data.runs.length} patrol tours in the last 14 days, each verified by timestamped QR checkpoint scans.</p>
          </div>
        </div>
        <div>
          <SectionLabel>Incident reports</SectionLabel>
          {data.incidents.length ? (
            <List>
              {data.incidents.map((i) => (
                <div key={i.id} class="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }} data-testid="portal-incident">
                  <button class="row" style={{ textAlign: 'left', width: '100%' }} onClick={() => setOpen(open === i.id ? null : i.id)}>
                    <span class="list-icon" style={{ background: 'var(--raised-2)' }}><Icon name="file" /></span>
                    <span class="grow" style={{ minWidth: 0 }}><b style={{ display: 'block' }}>{String(i.title || i.category_name)}</b><span class="foot muted">{String(i.report_no ?? '')} · {fmtDateTime(i.occurred_at as string)}</span></span>
                    <Icon name={open === i.id ? 'chevron-down' : 'chevron-right'} class="chev" />
                  </button>
                  {open === i.id && <div class="sub" style={{ whiteSpace: 'pre-wrap', color: '#DCE1E8' }}>{String(i.description)}</div>}
                  <PdfButton label="Download PDF" testid="portal-incident-pdf" make={make('incident', i.id)} />
                </div>
              ))}
            </List>
          ) : <Empty icon="file" title="No incident reports shared" body="Reports appear here when Lion Security Services shares them." />}
        </div>
        <div>
          <SectionLabel>Daily activity reports</SectionLabel>
          {data.dars.length ? (
            <List>
              {data.dars.map((d) => (
                <div key={d.id} class="list-row" data-testid="portal-dar">
                  <span class="list-icon" style={{ background: 'var(--raised-2)' }}><Icon name="activity" /></span>
                  <span class="grow" style={{ minWidth: 0 }}><b style={{ display: 'block' }}>{fmtDate(`${d.report_date}T12:00:00Z`)}</b><span class="foot muted">{String(d.author_name)} · {((d.entries as Row[]) ?? []).length} entries</span></span>
                  <PdfButton label="PDF" testid="portal-dar-pdf" make={make('dar', d.id)} />
                </div>
              ))}
            </List>
          ) : <Empty icon="activity" title="No daily reports shared" />}
        </div>
        <p class="foot faint" style={{ textAlign: 'center' }}>Read-only client portal provided by {String(data.org.name)}.{data.expires_at ? ` This link expires ${fmtDate(data.expires_at)}.` : ''}<br />{[data.org.phone, data.org.email].filter(Boolean).join(' · ')}</p>
      </div>
    </div>
  );
}

function PortalHeader({ orgName }: { orgName: string }) {
  return (
    <div class="row" style={{ gap: 12, paddingTop: 8 }}>
      <img src={`${import.meta.env.BASE_URL}brand/logo-mark.svg`} alt="" style={{ width: 44 }} />
      <div><div class="brand-name" style={{ fontSize: 13 }}>{orgName.toUpperCase()}</div><div class="foot gold" style={{ fontWeight: 600, letterSpacing: '.06em' }}>CLIENT PORTAL · LICENSED & INSURED</div></div>
    </div>
  );
}

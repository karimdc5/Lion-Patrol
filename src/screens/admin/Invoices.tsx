import { useEffect, useState } from 'preact/hooks';
import { Screen, TopBar, SyncPill, List, Row, SectionLabel, Empty, Button, Sheet, Field, Toggle, toast } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { useData } from '../../ui/useData';
import { currentOrgId, memberId, getBackend } from '../../auth/session';
import { listRecords, getRecord, putServerRows, scopeOf } from '../../data/repos/records';
import { membersFor } from '../../data/repos/queries';
import { fetchBilling, listInvoices, listSiteBilling, orgBilling, saveInvoice, saveOrgBilling, newInvoiceId, type Invoice, type OrgBilling } from '../../data/owner';
import { buildInvoiceLines, invoiceNumber, invoiceDates, invoiceTotal, invoiceHours, monthLabel, usd, type InvoiceTimeRow, type InvoiceLine } from '../../domain/invoice';
import { PdfButton } from '../../ui/PdfButton';
import { navigate } from '../../router';
import type { Site } from '../../data/types';
import type { Row as R } from '../../data/db';
import type { SelectQuery } from '../../data/backend/types';

const STATUS: Record<string, [string, string]> = { draft: ['Draft', 'pill-muted'], sent: ['Sent', 'pill-info'], paid: ['Paid', 'pill-success'], void: ['Void', 'pill-danger'] };
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y!, mo! - 1 + n, 1)); return d.toISOString().slice(0, 10); };

/** Pull a month of time entries (staff RLS) so the draft uses the server's confirmed hours. */
async function fetchMonth(org: string, month: string) {
  const from = new Date(Date.parse(`${month}T00:00:00Z`) - 864e5).toISOString();
  const to = new Date(Date.parse(`${shiftMonth(month, 1)}T00:00:00Z`) + 864e5).toISOString();
  const q: SelectQuery = { eq: { org_id: org }, gte: { clock_in_at: from }, order: ['clock_in_at', 'asc'], limit: 3000 };
  try {
    const startedAt = Date.now();
    const rows = (await getBackend().select<R>('patrol_time_entries', q)).filter((r) => String(r.clock_in_at) < to);
    const sc = scopeOf(q, rows, startedAt);
    await putServerRows('patrol_time_entries', rows, { scope: { ...sc, match: (r) => sc.match(r) && String(r.clock_in_at) < to } });
  } catch { /* offline: cached */ }
}

/**
 * Item 26: monthly client invoices = guard-confirmed clocked hours × the site's hourly rate.
 * Owners review/edit drafts, mark Sent/Paid by hand and download the PDF. Nothing is ever emailed.
 */
export function InvoicesList() {
  const org = currentOrgId.value;
  const [month, setMonth] = useState(() => shiftMonth(thisMonth(), -1));
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { void fetchBilling(); }, [org]);
  const data = useData(async () => ({
    sites: (await listRecords<Site>('patrol_sites', org)).sort((a, b) => a.name.localeCompare(b.name)),
    billing: await listSiteBilling(org), invoices: await listInvoices(org),
  }), [org]);
  const d = data.data;
  const monthInv = (d?.invoices ?? []).filter((i) => i.period_month === month);

  const createDraft = async (site: Site) => {
    if (!org) return;
    setBusy(site.id);
    try {
      await fetchMonth(org, month);
      const b = d?.billing.find((x) => x.site_id === site.id);
      if (b?.hourly_rate == null) { toast('Set the site’s billing rate first (Sites → site → Billing).', 'error', 4000); return; }
      const pay = await orgBilling(org);
      const names = Object.fromEntries((await membersFor(org)).map((m) => [m.id, m.display_name]));
      const rows = await listRecords<InvoiceTimeRow & R>('patrol_time_entries', org);
      const { lines, excluded } = buildInvoiceLines(rows, { siteId: site.id, month, rate: Number(b.hourly_rate), names, onlyConfirmed: true });
      const dates = invoiceDates(month, pay.terms_days);
      const inv = { id: newInvoiceId(), org_id: org, site_id: site.id, period_month: month, invoice_no: invoiceNumber(pay.invoice_prefix, month, site.code, site.name), status: 'draft',
        issue_date: dates.issue, due_date: dates.due, client_name: b.client_name, bill_to: b.billing_address, rate: Number(b.hourly_rate), lines,
        notes: excluded ? null : null, total: invoiceTotal(lines), sent_at: null, paid_at: null, created_by: memberId.value } as unknown as Invoice;
      await saveInvoice(inv);
      toast(excluded ? `Draft created. ${excluded} unconfirmed shift${excluded > 1 ? 's' : ''} left out — review them in Timesheets.` : 'Draft created', 'info', 4500);
      navigate(`/a/invoices/${inv.id}`);
    } finally { setBusy(null); }
  };

  return (
    <Screen tabbar>
      <TopBar title="Invoices" large right={<SyncPill />} sub="Owners only · never emailed automatically"
        action={<Button icon="settings" onClick={() => setPayOpen(true)} data-testid="inv-payment">Payment details</Button>} />
      <div class="screen-body stack-lg" data-testid="invoices">
        <div class="card row-between">
          <Button variant="ghost" icon="chevron-left" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} data-testid="inv-prev" />
          <div class="headline" data-testid="inv-month">{monthLabel(month)}</div>
          <Button variant="ghost" icon="chevron-right" aria-label="Next month" disabled={month >= thisMonth()} onClick={() => setMonth(shiftMonth(month, 1))} data-testid="inv-next" />
        </div>
        <div>
          <SectionLabel>Sites</SectionLabel>
          {(d?.sites ?? []).length ? (
            <List>
              {d!.sites.map((s) => {
                const inv = monthInv.find((i) => i.site_id === s.id);
                const b = d!.billing.find((x) => x.site_id === s.id);
                return inv ? (
                  <Row key={s.id} testid="inv-row" icon="file" title={`${s.name}${s.active === false ? ' (inactive)' : ''}`} sub={`${inv.invoice_no} · ${usd(Number(inv.total))} · due ${inv.due_date}`}
                    right={<span class={`pill ${STATUS[inv.status]![1]}`}>{STATUS[inv.status]![0]}</span>} chevron href={`/a/invoices/${inv.id}`} />
                ) : (
                  <Row key={s.id} testid="inv-row" icon="building" title={`${s.name}${s.active === false ? ' (inactive)' : ''}`} sub={b?.hourly_rate != null ? `${usd(Number(b.hourly_rate))}/hr · ${b.client_name ?? 'no client name'}` : 'No billing rate set'}
                    right={<Button loading={busy === s.id} onClick={() => void createDraft(s)} data-testid="inv-create">Create draft</Button>} />
                );
              })}
            </List>
          ) : <Empty icon="building" title="No sites" />}
        </div>
        <p class="foot faint">Hours come from guard-confirmed clock-ins (Timesheets). Invoices are never sent by Lion Patrol — download the PDF and send it yourself, then mark it Sent.</p>
      </div>
      <PaymentSheet open={payOpen} onClose={() => setPayOpen(false)} />
    </Screen>
  );
}

function PaymentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const org = currentOrgId.value;
  const [b, setB] = useState<OrgBilling | null>(null);
  useEffect(() => { if (open) void orgBilling(org).then(setB); }, [open, org]);
  return (
    <Sheet open={open} onClose={onClose} title="Payment details" testid="inv-payment-sheet"
      footer={<Button variant="primary" size="lg" block data-testid="inv-payment-save" onClick={async () => { if (b) { await saveOrgBilling(b); toast('Payment details saved'); onClose(); } }}>Save</Button>}>
      {b && (
        <div class="stack">
          <Field label="Payment line"><input class="input" value={b.payment_note} onInput={(e) => setB({ ...b, payment_note: (e.target as HTMLInputElement).value })} data-testid="inv-pay-note" /></Field>
          <Field label="Payment details (printed on invoices)" hint="e.g. account name and the routing/account numbers you share with clients. Stored only in your org settings."><textarea class="input" rows={3} value={b.payment_details} onInput={(e) => setB({ ...b, payment_details: (e.target as HTMLTextAreaElement).value })} data-testid="inv-pay-details" /></Field>
          <div class="grid-2">
            <Field label="Terms (days)"><input class="input" inputMode="numeric" value={String(b.terms_days)} onInput={(e) => setB({ ...b, terms_days: Math.max(0, Math.min(120, Number((e.target as HTMLInputElement).value) || 0)) })} /></Field>
            <Field label="Invoice prefix"><input class="input input-code" value={b.invoice_prefix} onInput={(e) => setB({ ...b, invoice_prefix: (e.target as HTMLInputElement).value.toUpperCase() })} /></Field>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function InvoiceEditor({ id }: { id: string }) {
  const saved = useData(() => getRecord<Invoice>('patrol_invoices', id), [id]);
  const site = useData(async () => (saved.data ? getRecord<Site>('patrol_sites', saved.data.site_id) : undefined), [saved.data?.site_id]);
  const [inv, setInv] = useState<Invoice | null>(null);
  useEffect(() => { if (saved.data && !inv) setInv({ ...saved.data, lines: [...(saved.data.lines ?? [])] }); }, [saved.data?.id]);
  if (!inv) return <Screen><TopBar title="Invoice" backTo="/a/invoices" /><div class="screen-body" /></Screen>;
  const draft = inv.status === 'draft';
  const up = (p: Partial<Invoice>) => setInv({ ...inv, ...p });
  const setLine = (i: number, p: Partial<InvoiceLine>) => up({ lines: inv.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const persist = async (p: Partial<Invoice> = {}, msg = 'Invoice saved') => { const next = { ...inv, ...p }; setInv(next); await saveInvoice(next); toast(msg); };
  return (
    <Screen>
      <TopBar title={inv.invoice_no} backTo="/a/invoices" right={<SyncPill />} />
      <div class="screen-body stack-lg" style={{ paddingBottom: 120 }} data-testid="invoice-editor">
        <div class="row" style={{ gap: 8 }}><span class={`pill ${STATUS[inv.status]![1]}`} data-testid="inv-status">{STATUS[inv.status]![0]}</span><span class="muted sub">{site.data?.name} · {monthLabel(inv.period_month)}</span></div>
        <div class="card stack">
          <Field label="Client"><input class="input" value={inv.client_name ?? ''} disabled={!draft} onInput={(e) => up({ client_name: (e.target as HTMLInputElement).value })} /></Field>
          <Field label="Bill to (address)"><input class="input" value={inv.bill_to ?? ''} disabled={!draft} onInput={(e) => up({ bill_to: (e.target as HTMLInputElement).value })} /></Field>
          <div class="grid-2">
            <Field label="Invoice date"><input class="input" type="date" value={inv.issue_date} disabled={!draft} onInput={(e) => up({ issue_date: (e.target as HTMLInputElement).value })} /></Field>
            <Field label="Due date"><input class="input" type="date" value={inv.due_date} disabled={!draft} onInput={(e) => up({ due_date: (e.target as HTMLInputElement).value })} data-testid="inv-due" /></Field>
          </div>
        </div>
        <div>
          <SectionLabel>Line items · {invoiceHours(inv.lines).toFixed(2)} h</SectionLabel>
          <div class="card stack" style={{ gap: 10 }}>
            {inv.lines.length ? inv.lines.map((l, i) => (
              <div key={i} class="inv-line" data-testid="inv-line">
                <div class="grow" style={{ minWidth: 0 }}><b>{l.date}</b><div class="foot muted ellipsis">{l.guard}</div></div>
                <input class="input tnum" inputMode="decimal" aria-label="Hours" value={String(l.hours)} disabled={!draft} onInput={(e) => setLine(i, { hours: Number((e.target as HTMLInputElement).value) || 0 })} data-testid="inv-line-hours" />
                <input class="input tnum" inputMode="decimal" aria-label="Rate" value={String(l.rate)} disabled={!draft} onInput={(e) => setLine(i, { rate: Number((e.target as HTMLInputElement).value) || 0 })} />
                <span class="tnum" style={{ minWidth: 76, textAlign: 'right' }}>{usd(l.hours * l.rate)}</span>
                {draft && <button class="icon-btn" aria-label="Remove line" onClick={() => up({ lines: inv.lines.filter((_, j) => j !== i) })}><Icon name="trash" /></button>}
              </div>
            )) : <p class="muted sub">No confirmed hours this month.</p>}
            {draft && <Button icon="plus" onClick={() => up({ lines: [...inv.lines, { date: inv.period_month, guard: 'Additional service', hours: 1, rate: Number(inv.rate ?? 0), description: 'Additional service' }] })}>Add line</Button>}
            <div class="row-between" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 10 }}><b>Total</b><b class="gold tnum" data-testid="inv-total">{usd(invoiceTotal(inv.lines))}</b></div>
          </div>
        </div>
        <Field label="Notes on the invoice"><textarea class="input" rows={2} value={inv.notes ?? ''} disabled={!draft} onInput={(e) => up({ notes: (e.target as HTMLTextAreaElement).value })} /></Field>
        <PdfButton block label="Download PDF" testid="inv-pdf" make={() => import('../../pdf').then((m) => m.invoicePdf(inv))} />
        <div class="card stack">
          <div class="headline">Status</div>
          <div class="foot muted">Lion Patrol never emails invoices. Send the PDF yourself, then mark it here.</div>
          <div class="row-between"><span>Sent to client</span><Toggle label="Sent to client" checked={inv.status === 'sent' || inv.status === 'paid'} onChange={(v) => void persist({ status: v ? 'sent' : 'draft', sent_at: v ? new Date().toISOString() : null, paid_at: null }, v ? 'Marked sent' : 'Back to draft')} /></div>
          <div class="row-between"><span>Paid</span><Toggle label="Paid" checked={inv.status === 'paid'} onChange={(v) => void persist({ status: v ? 'paid' : 'sent', paid_at: v ? new Date().toISOString() : null }, v ? 'Marked paid' : 'Marked unpaid')} /></div>
        </div>
      </div>
      {draft && <div class="sticky-bar"><Button variant="primary" size="lg" block onClick={() => void persist()} data-testid="inv-save">Save draft</Button></div>}
    </Screen>
  );
}

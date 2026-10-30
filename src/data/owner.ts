import { enqueue } from './outbox/queue';
import { kick } from './sync/engine';
import { putServerRows, listRecords, scopeOf, withLocalId, bumpData, getRecord } from './repos/records';
import type { Row } from './db';
import { identity, currentOrgId, memberId, getBackend } from '../auth/session';
import type { SelectQuery } from './backend/types';
import { uuidv7 } from '../lib/uuid';

/** Owner-only data (items 23 + 26): guard cards, site billing, org payment details, invoices. RLS: owners/admins. */
function ctx() {
  const userId = identity.value?.userId, orgId = currentOrgId.value;
  if (!userId || !orgId) throw new Error('Not signed in');
  return { userId, orgId };
}
async function pull(table: string, extra: SelectQuery = {}) {
  const { orgId } = ctx();
  const q: SelectQuery = { ...extra, eq: { org_id: orgId, ...(extra.eq ?? {}) }, limit: extra.limit ?? 1000 };
  try {
    const startedAt = Date.now();
    const rows = (await getBackend().select<Record<string, unknown>>(table, q)).map((r) => withLocalId(table, r));
    await putServerRows(table, rows, { scope: scopeOf(q, rows, startedAt) });
  } catch { /* offline or migration not applied yet: keep cache */ }
}
/** Upsert keyed by a natural key: the payload never carries the local-only `id`. */
async function save(table: string, row: Row, label: string) {
  const { userId, orgId } = ctx();
  const keepId = table === 'patrol_invoices';
  const { id: _local, updated_at: _u, created_at: _c, _pending: _p, ...payload } = row as Row & { updated_at?: string; created_at?: string; _pending?: boolean };
  const body = keepId ? { id: row.id, ...payload } : payload;
  const { _pending: _lp, ...local } = row as Row & { _pending?: boolean };
  await enqueue({ userId, orgId, kind: 'upsert', table, payload: body, entityKey: `${table}:${row.id}`, label }, [{ table, row: local as Row, orgId }]);
  bumpData(); void kick();
}

// ---------------------------------------------------------------- 23: guard cards
export interface GuardCard extends Row { member_id: string; org_id: string; card_no: string | null; expires_on: string | null; source: 'manual' | 'onboarding'; onboarding_link_id?: string | null }
export const fetchGuardCards = () => pull('patrol_guard_cards');
export const listGuardCards = async (org: string | null) => listRecords<GuardCard>('patrol_guard_cards', org);
export async function saveGuardCard(memberIdArg: string, card_no: string, expires_on: string | null, source: 'manual' | 'onboarding' = 'manual', link?: string | null) {
  const { orgId } = ctx();
  await save('patrol_guard_cards', { id: memberIdArg, member_id: memberIdArg, org_id: orgId, card_no: card_no.trim().toUpperCase() || null, expires_on: expires_on || null, source, onboarding_link_id: link ?? null, updated_by: memberId.value } as Row, 'Guard card');
}
/** Days until expiry (negative = expired), null when unknown. */
export function cardDays(expires: string | null | undefined, now = new Date()): number | null {
  if (!expires) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = expires.split('-').map(Number);
  return Math.round((Date.UTC(y!, m! - 1, d!) - today) / 864e5);
}
export function cardStatus(expires: string | null | undefined): { tone: 'success' | 'warning' | 'danger' | 'muted'; label: string } {
  const d = cardDays(expires);
  if (d == null) return { tone: 'muted', label: 'No expiry on file' };
  if (d < 0) return { tone: 'danger', label: `Expired ${-d} day${d === -1 ? '' : 's'} ago` };
  if (d <= 30) return { tone: 'warning', label: d === 0 ? 'Expires today' : `Expires in ${d} day${d === 1 ? '' : 's'}` };
  return { tone: 'success', label: `Valid · ${d} days left` };
}

/** Onboarding-app submissions (owner-only RPC; name, email, card number + expiry only). */
export interface OnboardingCard { link_id: string; first_name: string | null; last_name: string | null; email: string | null; has_card: string | null; card_no: string | null; expires_on: string | null; submitted_at: string; member_id: string | null }
export async function onboardingCards(): Promise<OnboardingCard[]> {
  const { orgId } = ctx();
  return (await getBackend().rpc<OnboardingCard[] | null>('patrol_onboarding_guard_cards', { p_org: orgId })) ?? [];
}

// ---------------------------------------------------------------- 26: billing + invoices
export interface SiteBilling extends Row { site_id: string; org_id: string; hourly_rate: number | null; client_name: string | null; client_email: string | null; billing_address: string | null }
export interface OrgBilling extends Row { org_id: string; payment_note: string; payment_details: string; terms_days: number; invoice_prefix: string }
export interface InvoiceLine { date: string; guard: string; hours: number; rate: number; description?: string }
export interface Invoice extends Row { org_id: string; site_id: string; period_month: string; invoice_no: string; status: 'draft' | 'sent' | 'paid' | 'void'; issue_date: string; due_date: string; client_name: string | null; bill_to: string | null; rate: number | null; lines: InvoiceLine[]; notes: string | null; total: number; sent_at: string | null; paid_at: string | null }

export const fetchBilling = async () => { await Promise.all([pull('patrol_site_billing'), pull('patrol_org_billing'), pull('patrol_invoices', { order: ['period_month', 'desc'], limit: 500 })]); };
export const siteBilling = async (siteId: string) => getRecord<SiteBilling>('patrol_site_billing', siteId);
export const listSiteBilling = async (org: string | null) => listRecords<SiteBilling>('patrol_site_billing', org);
export async function orgBilling(org: string | null): Promise<OrgBilling> {
  const r = org ? await getRecord<OrgBilling>('patrol_org_billing', org) : undefined;
  return r ?? ({ id: org ?? '', org_id: org ?? '', payment_note: 'Pay by ACH — WaFd Bank', payment_details: '', terms_days: 15, invoice_prefix: 'LSS-INV' } as OrgBilling);
}
export async function saveSiteBilling(b: Omit<SiteBilling, 'id'>) {
  await save('patrol_site_billing', { ...b, id: b.site_id, hourly_rate: b.hourly_rate == null || Number.isNaN(Number(b.hourly_rate)) ? null : Number(b.hourly_rate) } as Row, 'Site billing');
}
export async function saveOrgBilling(b: OrgBilling) { await save('patrol_org_billing', { ...b, id: b.org_id } as Row, 'Payment details'); }
export const listInvoices = async (org: string | null) => (await listRecords<Invoice>('patrol_invoices', org)).sort((a, b) => b.period_month.localeCompare(a.period_month) || a.invoice_no.localeCompare(b.invoice_no));
export async function saveInvoice(inv: Invoice) {
  const total = Math.round(inv.lines.reduce((n, l) => n + l.hours * l.rate, 0) * 100) / 100;
  await save('patrol_invoices', { ...inv, total } as Row, `Invoice ${inv.invoice_no}`);
}
export const newInvoiceId = () => uuidv7();

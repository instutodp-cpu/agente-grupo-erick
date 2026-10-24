'use strict';

// Pure, fail-closed reconciliation of already-authorized, normalized sources.
// No provider calls, credentials, customer/card data, payments or bookkeeping.

const ID = /^[a-zA-Z0-9:_-]{1,80}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SCOPES = ['tenant_id', 'workspace_type', 'company_id', 'user_id', 'store_ids', 'permission'];
const BATCH_FIELDS = ['kind', 'tenant_id', 'company_id', 'provider_id', 'source_ref', 'observed_at', 'period', 'complete', 'records'];
const ROW_FIELDS = ['tenant_id', 'company_id', 'store_id', 'merchant_id', 'transaction_ref', 'installment', 'gross_cents'];

function deny(code) { throw new Error('card_reconciliation_' + code); }
function exactKeys(value, names) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(k => names.includes(k)) &&
    names.every(k => Object.hasOwn(value, k));
}
function id(s) { return typeof s === 'string' && ID.test(s); }
function iso(s, now) { return typeof s === 'string' && DATETIME.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString() === s && Date.parse(s) <= now; }
function date(s) { return typeof s === 'string' && DATE.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s; }
function cents(n) { return Number.isSafeInteger(n) && n >= 0 && n <= 1e12; }
function key(row, provider) {
  return [provider, row.store_id, row.merchant_id, row.transaction_ref, row.installment].join('\0');
}

function compareCardAcquirerSources({ authorized_scope, batches, now = new Date().toISOString() } = {}) {
  // Scope must be created by a trusted Maestro ingress after real authentication;
  // this pure function validates its shape, not the caller's JWT or membership.
  if (!exactKeys(authorized_scope, SCOPES) ||
      !id(authorized_scope.tenant_id) || !id(authorized_scope.company_id) ||
      !id(authorized_scope.user_id) ||
      !['grupo_erick', 'external_client'].includes(authorized_scope.workspace_type) ||
      (authorized_scope.workspace_type === 'grupo_erick' && authorized_scope.tenant_id !== 'grupo_erick') ||
      (authorized_scope.workspace_type === 'external_client' && !authorized_scope.tenant_id.startsWith('client::')) ||
      authorized_scope.permission !== 'financeiro.receivables.read' ||
      !Array.isArray(authorized_scope.store_ids) ||
      authorized_scope.store_ids.length < 1 || authorized_scope.store_ids.length > 100 ||
      authorized_scope.store_ids.some(s => !id(s)) ||
      new Set(authorized_scope.store_ids).size !== authorized_scope.store_ids.length)
    deny('scope_blocked');
  if (!DATETIME.test(now) || Number.isNaN(Date.parse(now)) || new Date(now).toISOString() !== now)
    deny('clock_invalid');
  if (!Array.isArray(batches) || batches.length < 2 || batches.length > 30)
    deny('batches_invalid');

  const groups = new Map();
  const observed = Date.parse(now);
  let totalRows = 0;
  for (const batch of batches) {
    if (!exactKeys(batch, BATCH_FIELDS) || !['pos', 'acquirer'].includes(batch.kind) ||
        batch.tenant_id !== authorized_scope.tenant_id || batch.company_id !== authorized_scope.company_id ||
        !id(batch.provider_id) || !id(batch.source_ref) || !iso(batch.observed_at, observed) ||
        typeof batch.complete !== 'boolean' || !exactKeys(batch.period, ['from', 'to']) ||
        !date(batch.period.from) || !date(batch.period.to) || batch.period.from > batch.period.to ||
        !Array.isArray(batch.records) || batch.records.length > 500)
      deny('source_invalid');
    totalRows += batch.records.length;
    if (totalRows > 3000) deny('rows_limit');
    const groupId = [batch.provider_id, batch.period.from, batch.period.to].join('\0');
    const group = groups.get(groupId) || { provider_id: batch.provider_id, period: batch.period, byKind: new Map() };
    if (group.byKind.has(batch.kind)) deny('duplicate_source');
    const rows = new Map();
    for (const row of batch.records) {
      if (!exactKeys(row, ROW_FIELDS) || row.tenant_id !== authorized_scope.tenant_id ||
          row.company_id !== authorized_scope.company_id ||
          !authorized_scope.store_ids.includes(row.store_id) || !id(row.merchant_id) ||
          !id(row.transaction_ref) || !Number.isSafeInteger(row.installment) ||
          row.installment < 1 || row.installment > 120 || !cents(row.gross_cents))
        deny('record_scope_or_shape_invalid');
      const k = key(row, batch.provider_id);
      if (rows.has(k)) deny('duplicate_transaction');
      rows.set(k, row.gross_cents);
    }
    group.byKind.set(batch.kind, { rows, complete: batch.complete, source_ref: batch.source_ref, observed_at: batch.observed_at });
    groups.set(groupId, group);
  }

  const reports = [];
  const totals = { matched: 0, amount_mismatch: 0, missing_at_pos: 0, missing_at_acquirer: 0, coverage_unconfirmed: 0 };
  for (const group of groups.values()) {
    const pos = group.byKind.get('pos');
    const acquirer = group.byKind.get('acquirer');
    if (!pos || !acquirer) deny('source_pair_missing');
    const summary = { ...Object.fromEntries(Object.keys(totals).map(k => [k, 0])) };
    const issueRefs = [];
    const keys = new Set([...pos.rows.keys(), ...acquirer.rows.keys()]);
    for (const k of [...keys].sort()) {
      const p = pos.rows.get(k); const a = acquirer.rows.get(k);
      let status;
      if (p !== undefined && a !== undefined) status = p === a ? 'matched' : 'amount_mismatch';
      else if (!pos.complete || !acquirer.complete) status = 'coverage_unconfirmed';
      else status = p === undefined ? 'missing_at_pos' : 'missing_at_acquirer';
      summary[status]++;
      totals[status]++;
      // Per-report case ordinals; no raw transaction or merchant references leave this boundary.
      if (status !== 'matched' && issueRefs.length < 10)
        issueRefs.push({ issue_ref: 'case_' + String(issueRefs.length + 1).padStart(3, '0'), status });
    }
    reports.push({ provider_id: group.provider_id, period: group.period,
      sources: [{ kind: 'pos', source_ref: pos.source_ref, observed_at: pos.observed_at, complete: pos.complete },
        { kind: 'acquirer', source_ref: acquirer.source_ref, observed_at: acquirer.observed_at, complete: acquirer.complete }],
      summary, issue_references: issueRefs });
  }
  reports.sort((a, b) => a.provider_id.localeCompare(b.provider_id) || a.period.from.localeCompare(b.period.from));
  return {
    status: totals.coverage_unconfirmed || reports.some(r => r.sources.some(s => !s.complete)) ? 'partial_evidence' : 'comparison_complete',
    tenant_id: authorized_scope.tenant_id, company_id: authorized_scope.company_id,
    as_of: now, scope: 'authorized_stores_only', currency: 'BRL', unit: 'installment_gross_cents',
    summary: totals, reports, requires_human_review: true,
    readonly: true, executed: false, real_provider_called: false, payment_recorded: false,
    erp_linx_conciliated: false, bank_settlement_conciliated: false
  };
}

module.exports = { compareCardAcquirerSources };

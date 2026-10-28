'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareCardAcquirerSources } = require('../src/core/financeiro-card-acquirer-read-only');
const now = '2026-10-24T15:00:00.000Z';
const scope = { tenant_id: 'grupo_erick', workspace_type: 'grupo_erick', company_id: 'erick_calcados', user_id: 'owner1', store_ids: ['barreiros'], permission: 'financeiro.receivables.read' };
const record = (transaction_ref, gross_cents, overrides = {}) => ({ tenant_id: scope.tenant_id, company_id: scope.company_id, store_id: 'barreiros', merchant_id: 'estab_01', transaction_ref, installment: 1, gross_cents, ...overrides });
const batch = (kind, records, overrides = {}) => ({ kind, tenant_id: scope.tenant_id, company_id: scope.company_id, provider_id: 'rede', source_ref: kind + '_202610', observed_at: '2026-10-24T12:00:00.000Z', period: { from: '2026-10-01', to: '2026-10-24' }, complete: true, records, ...overrides });
const run = (batches, authorized_scope = scope) => compareCardAcquirerSources({ authorized_scope, batches, now });
const pair = (pos, acquirer, a = {}, b = {}) => [batch('pos', pos, a), batch('acquirer', acquirer, b)];

test('read-only same-company transaction matches with no payment or provider calls', () => {
  const result = run(pair([record('tx1', 12345)], [record('tx1', 12345)]));
  assert.equal(result.status, 'comparison_complete');
  assert.equal(result.summary.matched, 1);
  assert.equal(result.summary.amount_mismatch, 0);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.payment_recorded, false);
  assert.equal(result.erp_linx_conciliated, false);
  assert.equal(result.bank_settlement_conciliated, false);
});
test('amount differences and complete-source absence yield review cases with opaque references only', () => {
  const result = run(pair([record('tx1', 10000), record('tx2', 5000)], [record('tx1', 9900), record('tx3', 1200)]));
  assert.deepEqual(result.summary, { matched: 0, amount_mismatch: 1, missing_at_pos: 1, missing_at_acquirer: 1, coverage_unconfirmed: 0 });
  assert.equal(result.reports[0].issue_references.length, 3);
  assert.deepEqual(result.reports[0].issue_references.map(x => x.issue_ref), ['case_001', 'case_002', 'case_003']);
  assert.ok(!JSON.stringify(result).includes('tx1'));
  assert.ok(!JSON.stringify(result).includes('estab_01'));
});
test('incomplete sources must never infer a missing transaction', () => {
  const result = run(pair([record('tx1', 100)], [], { complete: false }));
  assert.equal(result.status, 'partial_evidence');
  assert.equal(result.summary.coverage_unconfirmed, 1);
  assert.equal(result.summary.missing_at_acquirer, 0);
});
test('supports another isolated SaaS client with the same global comparator', () => {
  const tenant = 'client::abc'; const company = 'company_b';
  const b = pair([record('tx1', 100)], [record('tx1', 100)]).map(x => ({ ...x, tenant_id: tenant, company_id: company, records: x.records.map(r => ({ ...r, tenant_id: tenant, company_id: company })) }));
  const result = run(b, { ...scope, tenant_id: tenant, workspace_type: 'external_client', company_id: company });
  assert.equal(result.summary.matched, 1);
  assert.equal(result.tenant_id, tenant);
});
test('cannot mix clients or companies, even in an otherwise valid pair', () => {
  assert.throws(() => run(pair([record('tx1', 100, { tenant_id: 'client::other' })], [record('tx1', 100)])), /record_scope_or_shape_invalid/);
  assert.throws(() => run(pair([record('tx1', 100)], [record('tx1', 100)], {}, { company_id: 'other_company' })), /source_invalid/);
});
test('cannot read an unauthorized store', () => {
  assert.throws(() => run(pair([record('tx1', 100, { store_id: 'sirinhaem' })], [record('tx1', 100)])), /record_scope_or_shape_invalid/);
});
test('rejects personal context, denied permissions and malformed scope', () => {
  const b = pair([], []);
  assert.throws(() => run(b, { ...scope, workspace_type: 'personal', tenant_id: 'personal::owner1' }), /scope_blocked/);
  assert.throws(() => run(b, { ...scope, permission: 'financeiro.payments.write' }), /scope_blocked/);
  assert.throws(() => run(b, { ...scope, store_ids: [] }), /scope_blocked/);
  assert.throws(() => run(b, { ...scope, extra_access: true }), /scope_blocked/);
});
test('rejects duplicate transaction, missing pair and inconsistent dates', () => {
  assert.throws(() => run(pair([record('tx1', 100), record('tx1', 100)], [])), /duplicate_transaction/);
  assert.throws(() => run([batch('pos', []), batch('pos', [], { provider_id: 'senff' })]), /source_pair_missing/);
  assert.throws(() => run(pair([], [], { period: { from: '2026-02-30', to: '2026-10-24' } })), /source_invalid/);
  assert.throws(() => run(pair([], [], { observed_at: '2026-11-01T12:00:00.000Z' })), /source_invalid/);
});
test('rejects cardholder/PAN or extra fields and unbounded batches', () => {
  assert.throws(() => run(pair([record('tx1', 100, { card_number: 'not_allowed' })], [])), /record_scope_or_shape_invalid/);
  assert.throws(() => run(pair([], [], { secret: 'not_allowed' })), /source_invalid/);
  assert.throws(() => run(pair(Array.from({length: 501}, (_, i) => record('tx' + i, 10)), [])), /source_invalid/);
});
test('does not coalesce different providers or instalments', () => {
  const p = pair([record('tx1', 100)], [record('tx1', 100)], { provider_id: 'senff' }, { provider_id: 'senff' });
  const q = pair([record('tx1', 200, { installment: 2 })], [record('tx1', 200, { installment: 2 })]);
  const result = run([...p, ...q]);
  assert.equal(result.summary.matched, 2);
  assert.equal(result.reports.length, 2);
});

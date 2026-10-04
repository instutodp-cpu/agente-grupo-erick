'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFinancialSummary } = require('../src/core/financeiro-financial-summary');

const rows = [
  { category: 'receita', amount: 1000.25 },
  { category: 'despesa', amount: -300.10 },
  { category: 'receita', amount: 200 }
];

test('financial summary creates deterministic high-sensitivity review candidate without execution', () => {
  const result = buildFinancialSummary({ workspace_type: 'grupo_erick', tenant_id: 'grupo_erick', query_type: 'financial_summary', authorized_role: true, rows });
  assert.equal(result.status, 'business_api_requires_human_review');
  assert.equal(result.sensitivity_level, 'high');
  assert.equal(result.human_review_required, true);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.can_trigger_real_execution, false);
  assert.equal(result.write_allowed, false);
  assert.equal(result.action_allowed, false);
  assert.deepEqual(result.review_candidate, {
    total_amount: 900.15,
    by_category: [
      { category: 'despesa', amount: -300.1 },
      { category: 'receita', amount: 1200.25 }
    ]
  });
});

test('financial summary requires an authorized role before exposing a review candidate', () => {
  const result = buildFinancialSummary({ workspace_type: 'grupo_erick', tenant_id: 'grupo_erick', query_type: 'financial_summary', authorized_role: false, rows });
  assert.equal(result.status, 'business_api_role_blocked');
  assert.equal(result.review_candidate, null);
  assert.equal(result.executed, false);
});

test('financial summary fails closed across tenant boundaries', () => {
  const result = buildFinancialSummary({ workspace_type: 'external_client', tenant_id: 'client::demo', query_type: 'financial_summary', authorized_role: true, rows });
  assert.equal(result.status, 'business_api_tenant_scope_blocked');
  assert.equal(result.review_candidate, null);
});

test('financial summary rejects payment or mutation queries', () => {
  const result = buildFinancialSummary({ workspace_type: 'grupo_erick', tenant_id: 'grupo_erick', query_type: 'pay_invoice', authorized_role: true, rows });
  assert.equal(result.status, 'business_api_not_supported');
  assert.equal(result.review_candidate, null);
  assert.equal(result.write_allowed, false);
  assert.equal(result.action_allowed, false);
});

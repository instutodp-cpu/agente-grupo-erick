'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPurchaseSummary } = require('../src/core/compras-purchase-summary');

const rows = [
  { supplier_id: 'f2', supplier_name: 'Fornecedor B', store_id: 'barreiros', total_value: 250.5, order_count: 2 },
  { supplier_id: 'f1', supplier_name: 'Fornecedor A', store_id: 'barreiros', total_value: 100, order_count: 1 },
  { supplier_id: 'f1', supplier_name: 'Fornecedor A', store_id: 'sirinhaem', total_value: 75.25, order_count: 1 }
];

test('purchase summary aggregates deterministic simulation rows without real execution', () => {
  const result = buildPurchaseSummary({
    workspace_type: 'grupo_erick',
    tenant_id: 'grupo_erick',
    query_type: 'purchase_summary',
    rows
  });

  assert.equal(result.status, 'business_api_mock_success');
  assert.equal(result.simulated, true);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.can_trigger_real_execution, false);
  assert.equal(result.write_allowed, false);
  assert.equal(result.action_allowed, false);
  assert.deepEqual(result.purchase_summary, {
    supplier_count: 2,
    order_count: 4,
    total_value: 425.75,
    by_supplier: [
      { supplier_id: 'f2', supplier_name: 'Fornecedor B', total_value: 250.5, order_count: 2 },
      { supplier_id: 'f1', supplier_name: 'Fornecedor A', total_value: 175.25, order_count: 2 }
    ]
  });
});

test('purchase summary fails closed outside Grupo Erick tenant scope', () => {
  const result = buildPurchaseSummary({
    workspace_type: 'external_client',
    tenant_id: 'client::demo',
    query_type: 'purchase_summary',
    rows
  });

  assert.equal(result.status, 'business_api_tenant_scope_blocked');
  assert.equal(result.purchase_summary, null);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
});

test('purchase summary rejects unsupported query types and never exposes write authority', () => {
  const result = buildPurchaseSummary({
    workspace_type: 'grupo_erick',
    tenant_id: 'grupo_erick',
    query_type: 'create_purchase',
    rows
  });

  assert.equal(result.status, 'business_api_not_supported');
  assert.equal(result.purchase_summary, null);
  assert.equal(result.write_allowed, false);
  assert.equal(result.action_allowed, false);
  assert.equal(result.executed, false);
});

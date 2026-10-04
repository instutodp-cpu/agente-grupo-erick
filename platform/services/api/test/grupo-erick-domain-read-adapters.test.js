'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadOnlyAdapterRegistry } = require('../src/core/read-only-adapter-registry');
const { executeReadOnlyAdapter } = require('../src/core/read-only-adapter-runtime');
const { createGrupoErickDomainReadAdapters } = require('../src/adapters/internal-business/grupo-erick-domain-read-adapters');

const adapters = createGrupoErickDomainReadAdapters();
const registry = createReadOnlyAdapterRegistry(adapters);

function request(domain, capability, operation, role, rows) {
  return {
    trace_id: `trace_${domain}`,
    request_id: `request_${domain}`,
    adapter_id: `mock-grupo-erick-${domain}-datastore`,
    provider_id: 'grupo_erick_simulation_datastore',
    provider_class: 'internal_business_api',
    workspace_type: 'grupo_erick',
    tenant_id: 'grupo_erick',
    user_id: 'synthetic_user',
    role,
    company_id: 'grupo_erick',
    store_id: '',
    client_id: '',
    domain,
    capability,
    operation,
    input: { rows },
    input_classification: 'synthetic',
    requested_at: '2026-10-04T12:00:00.000Z',
    simulated: true,
    executed: false,
    real_provider_called: false,
    write_allowed: false,
    action_allowed: false,
    send_allowed: false,
    publish_allowed: false,
    delete_allowed: false
  };
}

const options = {
  registry,
  featureFlagResolver: () => true,
  killSwitchResolver: () => false,
  clock: () => 10
};

test('Compras executes only the local simulation DataStore path', async () => {
  const result = await executeReadOnlyAdapter(request('compras', 'purchase_summary', 'summarize_procurement_data', 'comprador', [
    { supplier_id: 'A', supplier_name: 'Fornecedor A', store_id: 'loja-1', total_value: 10, order_count: 1 },
    { supplier_id: 'A', supplier_name: 'Fornecedor A', store_id: 'loja-1', total_value: 15, order_count: 1 }
  ]), options);
  assert.equal(result.status, 'adapter_mock_success');
  assert.equal(result.real_provider_called, false);
  assert.equal(result.can_trigger_real_execution, false);
  assert.equal(result.data.status, 'business_api_mock_success');
  assert.equal(result.data.purchase_summary.total_value, 25);
});

test('Financeiro keeps high-review result behind an authorized role', async () => {
  const allowed = await executeReadOnlyAdapter(request('financeiro', 'financial_summary', 'summarize_financial_data', 'financeiro', [
    { category: 'receita', amount: 100 },
    { category: 'despesa', amount: -40 }
  ]), options);
  assert.equal(allowed.status, 'adapter_mock_success');
  assert.equal(allowed.real_provider_called, false);
  assert.equal(allowed.data.status, 'business_api_requires_human_review');
  assert.equal(allowed.data.human_review_required, true);
  assert.equal(allowed.data.review_candidate.total_amount, 60);

  const blocked = await executeReadOnlyAdapter(request('financeiro', 'financial_summary', 'summarize_financial_data', 'vendedor', [
    { category: 'receita', amount: 100 }
  ]), options);
  assert.equal(blocked.data.status, 'business_api_role_blocked');
  assert.equal(blocked.data.review_candidate, null);
});

test('Treinamento executes deterministic simulation without progress mutation', async () => {
  const result = await executeReadOnlyAdapter(request('treinamento', 'training_progress_summary', 'summarize_training_progress', 'gerente', [
    { user_id: 'u1', module_id: 'm1', progress_percent: 100 },
    { user_id: 'u2', module_id: 'm1', progress_percent: 50 }
  ]), options);
  assert.equal(result.status, 'adapter_mock_success');
  assert.equal(result.real_provider_called, false);
  assert.equal(result.data.status, 'business_api_mock_success');
  assert.equal(result.data.summary.average_progress_percent, 75);
});

test('runtime fails closed on cross-tenant and write-like operations before adapter execution', async () => {
  const crossTenant = request('compras', 'purchase_summary', 'summarize_procurement_data', 'comprador', []);
  crossTenant.tenant_id = 'client::other';
  const blockedTenant = await executeReadOnlyAdapter(crossTenant, options);
  assert.equal(blockedTenant.status, 'adapter_tenant_blocked');
  assert.equal(blockedTenant.executed, false);

  const write = request('compras', 'purchase_summary', 'create_purchase', 'comprador', []);
  const blockedWrite = await executeReadOnlyAdapter(write, options);
  assert.notEqual(blockedWrite.status, 'adapter_mock_success');
  assert.equal(blockedWrite.executed, false);
  assert.equal(blockedWrite.real_provider_called, false);
});

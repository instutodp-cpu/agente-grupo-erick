'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadOnlyAdapterRegistry } = require('../src/core/read-only-adapter-registry');
const { executeReadOnlyAdapter } = require('../src/core/read-only-adapter-runtime');
const { createGrupoErickDomainReadAdapters } = require('../src/adapters/internal-business/grupo-erick-domain-read-adapters');

function request({ domain, capability, operation, role, rows }) {
  return {
    trace_id: `e2e_trace_${domain}`,
    request_id: `e2e_request_${domain}`,
    adapter_id: `mock-grupo-erick-${domain}-datastore`,
    provider_id: 'grupo_erick_simulation_datastore',
    provider_class: 'internal_business_api',
    workspace_type: 'grupo_erick',
    tenant_id: 'grupo_erick',
    user_id: 'e2e_synthetic_user',
    role,
    company_id: 'grupo_erick',
    store_id: 'synthetic_store',
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

test('bounded E2E simulation crosses registry, runtime, adapter and read model for all three business domains', async () => {
  const registry = createReadOnlyAdapterRegistry(createGrupoErickDomainReadAdapters());
  const options = {
    registry,
    featureFlagResolver: () => true,
    killSwitchResolver: () => false,
    clock: () => 42
  };

  const cases = [
    {
      domain: 'compras',
      capability: 'purchase_summary',
      operation: 'summarize_procurement_data',
      role: 'comprador',
      rows: [{ supplier_id: 's1', supplier_name: 'Fornecedor 1', store_id: 'loja-1', total_value: 250, order_count: 2 }],
      verify: (result) => {
        assert.equal(result.data.purchase_summary.total_value, 250);
        assert.equal(result.data.purchase_summary.order_count, 2);
      }
    },
    {
      domain: 'financeiro',
      capability: 'financial_summary',
      operation: 'summarize_financial_data',
      role: 'financeiro',
      rows: [{ category: 'receita', amount: 1000 }, { category: 'despesa', amount: -400 }],
      verify: (result) => {
        assert.equal(result.data.status, 'business_api_requires_human_review');
        assert.equal(result.data.review_candidate.total_amount, 600);
        assert.equal(result.data.human_review_required, true);
      }
    },
    {
      domain: 'treinamento',
      capability: 'training_progress_summary',
      operation: 'summarize_training_progress',
      role: 'gerente',
      rows: [{ user_id: 'u1', module_id: 'm1', progress_percent: 100 }, { user_id: 'u2', module_id: 'm1', progress_percent: 60 }],
      verify: (result) => {
        assert.equal(result.data.summary.average_progress_percent, 80);
        assert.equal(result.data.summary.learner_count, 2);
      }
    }
  ];

  for (const entry of cases) {
    const result = await executeReadOnlyAdapter(request(entry), options);
    assert.equal(result.status, 'adapter_mock_success', entry.domain);
    assert.equal(result.adapter_kind, 'mock', entry.domain);
    assert.equal(result.simulated, true, entry.domain);
    assert.equal(result.real_provider_called, false, entry.domain);
    assert.equal(result.can_trigger_real_execution, false, entry.domain);
    assert.equal(result.audit_event_candidate.executed, true, entry.domain);
    entry.verify(result);
  }
});

test('bounded E2E simulation stops before protected authority and cross-tenant execution', async () => {
  const registry = createReadOnlyAdapterRegistry(createGrupoErickDomainReadAdapters());
  const options = { registry, featureFlagResolver: () => true, killSwitchResolver: () => false, clock: () => 42 };

  const writeLike = request({
    domain: 'financeiro',
    capability: 'financial_summary',
    operation: 'pay_invoice',
    role: 'financeiro',
    rows: []
  });
  const blockedWrite = await executeReadOnlyAdapter(writeLike, options);
  assert.notEqual(blockedWrite.status, 'adapter_mock_success');
  assert.equal(blockedWrite.executed, false);
  assert.equal(blockedWrite.real_provider_called, false);

  const crossTenant = request({
    domain: 'treinamento',
    capability: 'training_progress_summary',
    operation: 'summarize_training_progress',
    role: 'gerente',
    rows: []
  });
  crossTenant.tenant_id = 'client::other';
  const blockedTenant = await executeReadOnlyAdapter(crossTenant, options);
  assert.equal(blockedTenant.status, 'adapter_tenant_blocked');
  assert.equal(blockedTenant.executed, false);
  assert.equal(blockedTenant.real_provider_called, false);
});

'use strict';

const { buildPurchaseSummary } = require('../../core/compras-purchase-summary');
const { buildFinancialSummary } = require('../../core/financeiro-financial-summary');
const { buildTrainingProgressSummary } = require('../../core/treinamento-training-progress-summary');

const FINANCIAL_ROLES = new Set(['admin', 'diretor', 'financeiro']);

function metadata(domain, capability, operation, classification) {
  return {
    adapter_id: `mock-grupo-erick-${domain}-datastore`,
    provider_id: 'grupo_erick_simulation_datastore',
    provider_type: 'internal_business_api',
    provider_class: 'internal_business_api',
    adapter_kind: 'mock',
    version: '1.0.0',
    supported_workspace_types: ['grupo_erick'],
    supported_domains: [domain],
    supported_capabilities: [capability],
    supported_operations: [operation],
    readiness_candidate_id: `grupo-erick-${domain}-datastore-read-only`,
    feature_flag_key: `hermes.${domain}.simulation_datastore`,
    timeout_ms: 1000,
    retry_policy: { strategy: 'none', max_attempts: 1, unbounded: false },
    cost_risk: 'none',
    rate_limit_risk: 'none',
    data_classification: classification,
    deprecated: false,
    enabled: true,
    tenant_strategy: 'corporate_grupo_erick'
  };
}

function response(safe_summary, data) {
  return {
    status: 'adapter_mock_success',
    safe_summary,
    data,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false
  };
}

const compras = {
  metadata: metadata('compras', 'purchase_summary', 'summarize_procurement_data', 'sensitive'),
  execute(request) {
    const result = buildPurchaseSummary({
      workspace_type: request.workspace_type,
      tenant_id: request.tenant_id,
      query_type: 'purchase_summary',
      rows: request.input.rows
    });
    return response(result.safe_summary || 'Purchase summary blocked safely.', result);
  }
};

const financeiro = {
  metadata: metadata('financeiro', 'financial_summary', 'summarize_financial_data', 'high'),
  execute(request) {
    const result = buildFinancialSummary({
      workspace_type: request.workspace_type,
      tenant_id: request.tenant_id,
      query_type: 'financial_summary',
      authorized_role: FINANCIAL_ROLES.has(request.role),
      rows: request.input.rows
    });
    return response(result.safe_summary || 'Financial summary blocked safely.', result);
  }
};

const treinamento = {
  metadata: metadata('treinamento', 'training_progress_summary', 'summarize_training_progress', 'medium'),
  execute(request) {
    const result = buildTrainingProgressSummary({
      workspace_type: request.workspace_type,
      tenant_id: request.tenant_id,
      query_type: 'training_progress_summary',
      rows: request.input.rows
    });
    return response(result.safe_summary || 'Training progress summary blocked safely.', result);
  }
};

function createGrupoErickDomainReadAdapters() {
  return [compras, financeiro, treinamento];
}

module.exports = { createGrupoErickDomainReadAdapters };

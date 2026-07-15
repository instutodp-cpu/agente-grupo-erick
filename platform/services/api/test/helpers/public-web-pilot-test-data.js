'use strict';

const {
  ADAPTER_ID,
  ALLOWED_OPERATIONS,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID,
  REQUEST_LIMITS
} = require('../../src/core/public-web-transport-contract');
const {
  createReadOnlyAdapterRegistry
} = require('../../src/core/read-only-adapter-registry');
const publicWebAdapter = require('../../src/adapters/public-web/public-web-read-only-adapter');
const {
  createLocalTestSecretResolver
} = require('../../src/core/provider-secret-resolver');

function validRequest(overrides = {}) {
  return {
    trace_id: 'trace_public_web_pilot',
    request_id: 'request_public_web_pilot',
    connector_id: CONNECTOR_ID,
    configuration_id: CONFIGURATION_ID,
    adapter_id: ADAPTER_ID,
    provider_id: PROVIDER_ID,
    readiness_candidate_id: READINESS_CANDIDATE_ID,
    workspace_type: 'corporate',
    tenant_id: 'grupo_erick',
    user_id: 'user_public_web_synthetic',
    organization_id: 'grupo_erick',
    client_id: '',
    domain: 'marketing',
    capability: 'public_web_search',
    operation: 'fetch_public_page_summary',
    target: 'https://public-example.test/produto',
    source_type: 'public_product_page',
    query: 'consulta sintetica',
    max_results: 3,
    requested_content_types: ['text/html', 'text/plain'],
    freshness_requirement: 'best_effort',
    timeout_ms: REQUEST_LIMITS.default_timeout_ms,
    max_response_bytes: REQUEST_LIMITS.default_response_bytes,
    redirect_policy: {
      max_redirects: 0,
      follow_redirects: false
    },
    requested_at: '2026-07-14T12:00:00.000Z',
    simulated: true,
    executed: false,
    real_provider_called: false,
    write_allowed: false,
    action_allowed: false,
    send_allowed: false,
    publish_allowed: false,
    delete_allowed: false,
    ...overrides
  };
}

function validAdapterRegistry() {
  const registry = createReadOnlyAdapterRegistry();
  const result = registry.registerAdapter(publicWebAdapter);
  if (!result.ok) throw new Error(`adapter registry setup failed: ${JSON.stringify(result)}`);
  return registry;
}

function validConnector(overrides = {}) {
  return {
    connector_id: CONNECTOR_ID,
    connector_type: 'public_web_read_only',
    provider_id: PROVIDER_ID,
    provider_type: 'public_web',
    adapter_id: ADAPTER_ID,
    adapter_kind: 'real_read_only_candidate',
    readiness_candidate_id: READINESS_CANDIDATE_ID,
    lifecycle_state: 'feature_flag_off',
    lifecycle_version: 4,
    workspace_types: ['corporate'],
    tenant_strategy: 'tenant_id_required',
    domains: ['marketing'],
    capabilities: ['public_web_search'],
    operations: ALLOWED_OPERATIONS,
    owner_id: 'owner_public_web_synthetic',
    reviewer_ids: ['reviewer_public_web_synthetic'],
    feature_flag_key: 'HERMES_PUBLIC_WEB_READ_ONLY_ENABLED',
    feature_flag_default: false,
    kill_switch_key: 'HERMES_PUBLIC_WEB_READ_ONLY_KILL_SWITCH',
    runtime_enabled: false,
    real_provider_enabled: false,
    execution_mode: 'contract_only',
    rollout_stage: 'contract',
    risk_level: 'medium',
    cost_risk: 'known_low_bounded',
    rate_limit_risk: 'known_low_bounded',
    data_classification: 'public_external_untrusted',
    created_at: '2026-07-14T12:00:00.000Z',
    updated_at: '2026-07-14T12:00:00.000Z',
    deprecated: false,
    retired: false,
    metadata: {
      synthetic: true
    },
    contract_refs: ['PUBLIC_WEB_READ_ONLY_ADAPTER_PILOT.md'],
    ...overrides
  };
}

function validLifecycleRegistry(connector = validConnector()) {
  return Object.freeze({
    getConnector(connectorId) {
      return connectorId === connector.connector_id ? JSON.parse(JSON.stringify(connector)) : null;
    }
  });
}

function validConfiguration(overrides = {}) {
  return {
    configuration_id: CONFIGURATION_ID,
    connector_id: CONNECTOR_ID,
    provider_id: PROVIDER_ID,
    provider_type: 'public_web',
    adapter_id: ADAPTER_ID,
    readiness_candidate_id: READINESS_CANDIDATE_ID,
    workspace_type: 'corporate',
    tenant_id: 'grupo_erick',
    organization_id: 'grupo_erick',
    client_id: '',
    user_id: 'user_public_web_synthetic',
    environment: 'local_test',
    owner_id: 'owner_public_web_synthetic',
    configuration_status: 'structurally_ready',
    readiness_status: 'configuration_structurally_ready',
    configuration_version: 3,
    feature_flag_key: 'HERMES_PUBLIC_WEB_READ_ONLY_ENABLED',
    feature_flag_default: false,
    kill_switch_key: 'HERMES_PUBLIC_WEB_READ_ONLY_KILL_SWITCH',
    kill_switch_required: true,
    disabled: false,
    deprecated: false,
    tenant_policy: 'tenant_id_required',
    secret_reference_descriptors: [{
      reference_id: 'public_web_local_reference',
      reference_type: 'local_test_double_reference'
    }],
    required_secret_names: ['public_web_test_handle'],
    required_scopes: ['read_public_web'],
    allowed_operations: ALLOWED_OPERATIONS,
    rotation_policy: { rotation_required: false },
    expiration_policy: { expires_at: '2027-07-14T12:00:00.000Z' },
    revocation_policy: { revocable: true },
    risk_level: 'medium',
    cost_risk: 'known_low_bounded',
    rate_limit_risk: 'known_low_bounded',
    data_classification: 'public_external_untrusted',
    contract_refs: ['PUBLIC_WEB_READ_ONLY_ADAPTER_PILOT.md'],
    ...overrides
  };
}

function validConfigurationRegistry(configuration = validConfiguration()) {
  return Object.freeze({
    getConfiguration(configurationId) {
      return configurationId === configuration.configuration_id ? JSON.parse(JSON.stringify(configuration)) : null;
    }
  });
}

function validSecretReference(overrides = {}) {
  return {
    reference_id: 'public_web_local_reference',
    reference_type: 'local_test_double_reference',
    provider_id: PROVIDER_ID,
    workspace_type: 'corporate',
    tenant_id: 'grupo_erick',
    environment: 'local_test',
    status: 'reference_registered',
    reference_version: 1,
    synthetic: true,
    disabled: false,
    revoked: false,
    created_at: '2026-07-14T12:00:00.000Z',
    updated_at: '2026-07-14T12:00:00.000Z',
    last_rotated_at: '2026-07-14T12:00:00.000Z',
    expires_at: '2027-07-14T12:00:00.000Z',
    rotation_due_at: '2027-01-14T12:00:00.000Z',
    required_secret_names: ['public_web_test_handle'],
    metadata: {
      label: 'synthetic public web local reference'
    },
    ...overrides
  };
}

function validSecretReferenceRegistry(reference = validSecretReference()) {
  return Object.freeze({
    getSecretReference(referenceId) {
      return referenceId === reference.reference_id ? JSON.parse(JSON.stringify(reference)) : null;
    }
  });
}

function validLocalSecretResolver() {
  return createLocalTestSecretResolver({
    now: '2026-07-14T12:00:00.000Z'
  });
}

function validReadinessEvidence(overrides = {}) {
  return {
    candidate_id: READINESS_CANDIDATE_ID,
    provider_id: PROVIDER_ID,
    adapter_id: ADAPTER_ID,
    status: 'ready_for_real_read_only_pr',
    verdict: 'allow_future_read_only_pr',
    ready: true,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    blocking_requirements: [],
    blocking_reasons: [],
    ...overrides
  };
}

function fakeDnsResolver(overrides = {}) {
  return (hostname) => {
    if (Object.prototype.hasOwnProperty.call(overrides, hostname)) return overrides[hostname];
    return ['93.184.216.34'];
  };
}

function fakeHttpClient(responseOverrides = {}) {
  return async () => ({
    status_code: 200,
    content_type: 'text/html',
    content: '<html><head><title>Fake HTTP</title></head><body><p>Conteudo publico sintetico R$ 42,00.</p></body></html>',
    redirects: [],
    ...responseOverrides
  });
}

function fakeAbortControllerFactory() {
  return {
    signal: {
      aborted: false
    },
    abort() {
      this.signal.aborted = true;
    }
  };
}

function validPilotContext(overrides = {}) {
  const secretReference = validSecretReference();
  return {
    adapterRegistry: validAdapterRegistry(),
    lifecycleRegistry: validLifecycleRegistry(),
    configurationRegistry: validConfigurationRegistry(),
    secretReferenceRegistry: validSecretReferenceRegistry(secretReference),
    secretResolver: validLocalSecretResolver(),
    secretReference,
    secretAccessContext: {
      trace_id: 'trace_public_web_secret_access',
      request_id: 'request_public_web_secret_access',
      configuration_id: CONFIGURATION_ID,
      connector_id: CONNECTOR_ID,
      provider_id: PROVIDER_ID,
      adapter_id: ADAPTER_ID,
      workspace_type: 'corporate',
      tenant_id: 'grupo_erick',
      environment: 'local_test',
      purpose: 'local_test_readiness_validation',
      requested_by: 'user_public_web_synthetic',
      simulated: true,
      executed: false,
      real_provider_called: false
    },
    readinessResult: validReadinessEvidence(),
    dnsResolver: fakeDnsResolver(),
    costBudget: { check: () => ({ allowed: true }) },
    rateLimitBudget: { check: () => ({ allowed: true }) },
    audit_available: true,
    environment: 'development',
    production: false,
    feature_flag: true,
    kill_switch: false,
    canary_authorized: true,
    rollout_percentage: 1,
    allowed_tenants: ['grupo_erick'],
    allowed_workspaces: ['corporate'],
    allowed_users: ['user_public_web_synthetic'],
    clock: () => '2026-07-14T12:00:00.000Z',
    ...overrides
  };
}

module.exports = {
  validRequest,
  validAdapterRegistry,
  validConnector,
  validLifecycleRegistry,
  validConfiguration,
  validConfigurationRegistry,
  validSecretReference,
  validSecretReferenceRegistry,
  validLocalSecretResolver,
  validReadinessEvidence,
  validPilotContext,
  fakeDnsResolver,
  fakeHttpClient,
  fakeAbortControllerFactory
};

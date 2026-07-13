'use strict';

const {
  buildConfigurationAuditEventCandidate,
  buildSafeConfigurationError,
  isNonEmptyString,
  isPlainObject,
  sanitizeConfigurationData,
  uniqueSorted,
  validateProviderConfiguration
} = require('./provider-configuration-contract');
const {
  validateAdapterMetadata
} = require('./read-only-adapter-contract');

const ELIGIBLE_LIFECYCLE_STATES = [
  'readiness_passed',
  'configuration_pending',
  'feature_flag_off',
  'runtime_disabled'
];

function getFromRegistry(registry, method, id) {
  return registry && typeof registry[method] === 'function' ? registry[method](id) : null;
}

function validateLifecycleBinding(configuration, context = {}) {
  const errors = [];
  const connector = getFromRegistry(context.lifecycleRegistry, 'getConnector', configuration.connector_id);
  if (!connector) return ['lifecycle_connector_not_found'];
  if (connector.connector_id !== configuration.connector_id) errors.push('lifecycle_connector_id_mismatch');
  if (connector.provider_id !== configuration.provider_id) errors.push('lifecycle_provider_id_mismatch');
  if (connector.adapter_id !== configuration.adapter_id) errors.push('lifecycle_adapter_id_mismatch');
  if (connector.readiness_candidate_id !== configuration.readiness_candidate_id) errors.push('lifecycle_readiness_candidate_id_mismatch');
  if (!Array.isArray(connector.workspace_types) || !connector.workspace_types.includes(configuration.workspace_type)) errors.push('lifecycle_workspace_mismatch');
  if (configuration.tenant_id !== 'grupo_erick' && connector.tenant_strategy === 'corporate_grupo_erick') errors.push('lifecycle_tenant_mismatch');
  if (!ELIGIBLE_LIFECYCLE_STATES.includes(connector.lifecycle_state)) errors.push(`lifecycle_state_not_eligible::${connector.lifecycle_state}`);
  if (connector.real_provider_enabled !== false) errors.push('lifecycle_real_provider_enabled_must_be_false');
  if (connector.feature_flag_default !== false) errors.push('lifecycle_feature_flag_default_must_be_false');
  if (!isNonEmptyString(connector.kill_switch_key)) errors.push('lifecycle_kill_switch_missing');
  return uniqueSorted(errors);
}

function validateAdapterBinding(configuration, context = {}) {
  const errors = [];
  const adapter = getFromRegistry(context.adapterRegistry, 'getAdapter', configuration.adapter_id);
  if (!adapter || !adapter.metadata) return ['adapter_not_registered'];
  const metadataValidation = validateAdapterMetadata(adapter.metadata);
  if (!metadataValidation.valid) errors.push('adapter_metadata_invalid');
  if (adapter.metadata.provider_id !== configuration.provider_id) errors.push('adapter_provider_id_mismatch');
  if (adapter.metadata.adapter_id !== configuration.adapter_id) errors.push('adapter_id_mismatch');
  if (adapter.metadata.readiness_candidate_id !== configuration.readiness_candidate_id) errors.push('adapter_readiness_candidate_id_mismatch');
  if (!['real_read_only_candidate', 'mock'].includes(adapter.metadata.adapter_kind)) errors.push('adapter_kind_not_allowed');
  if (adapter.metadata.adapter_kind === 'real_read_only') errors.push('real_read_only_blocked');
  return uniqueSorted(errors);
}

function validateSecretReferenceBinding(configuration, context = {}) {
  const errors = [];
  const registry = context.secretReferenceRegistry;
  const resolver = context.secretResolver;
  if (!Array.isArray(configuration.secret_reference_descriptors) || configuration.secret_reference_descriptors.length === 0) {
    return ['secret_reference_descriptor_missing'];
  }
  for (const descriptor of configuration.secret_reference_descriptors) {
    if (!isPlainObject(descriptor) || !isNonEmptyString(descriptor.reference_id)) {
      errors.push('secret_reference_descriptor_invalid');
      continue;
    }
    const reference = getFromRegistry(registry, 'getSecretReference', descriptor.reference_id);
    if (!reference) {
      errors.push(`secret_reference_not_registered::${descriptor.reference_id}`);
      continue;
    }
    if (reference.reference_id !== descriptor.reference_id) errors.push('secret_reference_id_mismatch');
    if (reference.reference_type !== descriptor.reference_type) errors.push('secret_reference_type_mismatch');
    if (reference.provider_id !== configuration.provider_id) errors.push('secret_reference_provider_mismatch');
    if (reference.tenant_id !== configuration.tenant_id) errors.push('secret_reference_tenant_mismatch');
    if (reference.workspace_type !== configuration.workspace_type) errors.push('secret_reference_workspace_mismatch');
    if (reference.environment !== configuration.environment) errors.push('secret_reference_environment_mismatch');
    if (reference.synthetic !== true) errors.push('secret_reference_must_be_synthetic');
    if (reference.reference_type !== 'local_test_double_reference') errors.push('unsupported_in_current_phase');
    if (reference.revoked !== false || reference.status === 'revoked') errors.push('secret_reference_revoked');
    if (reference.disabled !== false || reference.status === 'disabled') errors.push('secret_reference_disabled');
    if (reference.status === 'expired') errors.push('secret_reference_expired');
    if (reference.status === 'rotation_required') errors.push('secret_reference_rotation_required');
    if (!resolver || typeof resolver.canResolve !== 'function' || resolver.canResolve(reference) !== true) {
      errors.push('secret_reference_not_resolvable');
    }
  }
  return uniqueSorted(errors);
}

function collectConfigurationBlockingReasons(configuration, context = {}) {
  const reasons = [];
  const validation = validateProviderConfiguration(configuration, context);
  if (!validation.valid) reasons.push(...validation.errors);
  reasons.push(...validateLifecycleBinding(configuration, context));
  reasons.push(...validateAdapterBinding(configuration, context));
  reasons.push(...validateSecretReferenceBinding(configuration, context));
  return uniqueSorted(reasons);
}

function buildConfigurationReadinessResult(configuration, fields = {}) {
  const blockingReasons = uniqueSorted(fields.blockingReasons || []);
  const ready = blockingReasons.length === 0;
  return sanitizeConfigurationData({
    trace_id: fields.trace_id || 'trace_not_available',
    configuration_id: configuration && configuration.configuration_id ? configuration.configuration_id : 'configuration_not_available',
    connector_id: configuration && configuration.connector_id ? configuration.connector_id : 'connector_not_available',
    provider_id: configuration && configuration.provider_id ? configuration.provider_id : 'provider_not_available',
    adapter_id: configuration && configuration.adapter_id ? configuration.adapter_id : 'adapter_not_available',
    readiness_candidate_id: configuration && configuration.readiness_candidate_id ? configuration.readiness_candidate_id : 'candidate_not_available',
    status: ready ? 'configuration_structurally_ready' : 'configuration_readiness_blocked',
    readiness_status: ready ? 'configuration_structurally_ready' : 'not_ready',
    ready,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    secret_resolution_performed: false,
    secret_value_exposed: false,
    blocking_reasons: blockingReasons,
    warnings: [],
    error: ready ? null : buildSafeConfigurationError('CONFIGURATION_INCOMPLETE', 'Configuration readiness blocked safely.', {
      blocked_reason: blockingReasons[0] || 'configuration_not_ready'
    }),
    audit_event_candidate: buildConfigurationAuditEventCandidate({
      trace_id: fields.trace_id,
      change_id: fields.change_id || 'readiness_evaluation',
      configuration_id: configuration && configuration.configuration_id,
      connector_id: configuration && configuration.connector_id,
      provider_id: configuration && configuration.provider_id,
      adapter_id: configuration && configuration.adapter_id,
      previous_status: configuration && configuration.configuration_status,
      current_status: ready ? 'structurally_ready' : configuration && configuration.configuration_status,
      operation: 'evaluate_readiness',
      applied: false,
      error_code: ready ? null : 'CONFIGURATION_INCOMPLETE',
      blocked_reason: blockingReasons[0] || null,
      occurred_at: fields.occurred_at
    })
  });
}

function evaluateProviderConfigurationReadiness(configuration, context = {}) {
  try {
    const blockingReasons = collectConfigurationBlockingReasons(configuration, context);
    return buildConfigurationReadinessResult(configuration, {
      blockingReasons,
      trace_id: context.trace_id,
      change_id: context.change_id,
      occurred_at: typeof context.clock === 'function' ? context.clock() : new Date(0).toISOString()
    });
  } catch (_error) {
    return buildConfigurationReadinessResult(configuration, {
      blockingReasons: ['configuration_readiness_internal_error'],
      trace_id: context.trace_id,
      occurred_at: new Date(0).toISOString()
    });
  }
}

module.exports = {
  evaluateProviderConfigurationReadiness,
  validateLifecycleBinding,
  validateAdapterBinding,
  validateSecretReferenceBinding,
  collectConfigurationBlockingReasons,
  buildConfigurationReadinessResult
};

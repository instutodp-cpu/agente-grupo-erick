'use strict';

const {
  RESOLVABLE_SECRET_REFERENCE_TYPES,
  buildSafeConfigurationError,
  findConfigurationForbiddenFields,
  isNonEmptyString,
  isPlainObject,
  validateSecretReference
} = require('./provider-configuration-contract');

const SECRET_ACCESS_CONTEXT_FIELDS = [
  'trace_id',
  'request_id',
  'configuration_id',
  'connector_id',
  'provider_id',
  'adapter_id',
  'workspace_type',
  'tenant_id',
  'environment',
  'purpose',
  'requested_by',
  'simulated',
  'executed',
  'real_provider_called'
];

const ALLOWED_SECRET_ACCESS_PURPOSES = [
  'configuration_structure_validation',
  'local_test_readiness_validation',
  'synthetic_contract_test'
];

const RESOLVABLE_SECRET_REFERENCE_STATUSES = [
  'reference_registered',
  'structurally_ready'
];

function safeBlocked(reason, code = 'SECRET_REFERENCE_TYPE_UNSUPPORTED') {
  return {
    resolved: false,
    ready: false,
    error: buildSafeConfigurationError(code, 'Secret reference cannot be resolved in this phase.', {
      blocked_reason: reason
    }),
    blocked_reason: reason,
    exportable: false,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false
  };
}

function validateSecretAccessContext(reference, context) {
  const errors = [];
  if (!isPlainObject(context)) return { valid: false, errors: ['secret_access_context_must_be_object'] };
  for (const field of SECRET_ACCESS_CONTEXT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(context, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['trace_id', 'request_id', 'configuration_id', 'connector_id', 'provider_id', 'adapter_id', 'workspace_type', 'tenant_id', 'environment', 'purpose', 'requested_by']) {
    if (!isNonEmptyString(context[field])) errors.push(`invalid_${field}`);
  }
  if (reference && context.provider_id !== reference.provider_id) errors.push('secret_access_provider_mismatch');
  if (reference && context.workspace_type !== reference.workspace_type) errors.push('secret_access_workspace_mismatch');
  if (reference && context.tenant_id !== reference.tenant_id) errors.push('secret_access_tenant_mismatch');
  if (reference && context.environment !== reference.environment) errors.push('secret_access_environment_mismatch');
  if (context.environment !== 'local_test') errors.push('secret_access_environment_must_be_local_test');
  if (!ALLOWED_SECRET_ACCESS_PURPOSES.includes(context.purpose)) errors.push('secret_access_purpose_not_allowed');
  if (context.simulated !== true) errors.push('simulated_must_be_true');
  if (context.executed !== false) errors.push('executed_must_be_false');
  if (context.real_provider_called !== false) errors.push('real_provider_called_must_be_false');
  errors.push(...findConfigurationForbiddenFields(context));
  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() };
}

function createLocalTestSecretResolver(options = {}) {
  const allowedEnvironment = options.environment || 'local_test';
  const revoked = new Set();

  function canResolve(reference) {
    const validation = validateSecretReference(reference, { now: options.now || '2026-07-13T12:00:00.000Z' });
    if (!validation.valid) return false;
    return reference.reference_type === 'local_test_double_reference' &&
      RESOLVABLE_SECRET_REFERENCE_TYPES.includes(reference.reference_type) &&
      reference.environment === allowedEnvironment &&
      reference.synthetic === true &&
      reference.disabled === false &&
      reference.revoked === false &&
      RESOLVABLE_SECRET_REFERENCE_STATUSES.includes(reference.status) &&
      !revoked.has(reference.reference_id);
  }

  function resolveReference(reference, context = {}) {
    if (!reference || reference.reference_type !== 'local_test_double_reference') {
      return safeBlocked('unsupported_in_current_phase');
    }
    if (!canResolve(reference)) {
      return safeBlocked('secret_reference_not_resolvable', 'INVALID_SECRET_REFERENCE');
    }
    const accessValidation = validateSecretAccessContext(reference, context);
    if (!accessValidation.valid) {
      return safeBlocked(accessValidation.errors[0] || 'secret_access_context_invalid', 'INVALID_SECRET_REFERENCE');
    }
    return {
      resolved: true,
      secret_handle: `opaque_test_handle::${reference.reference_id}`,
      synthetic: true,
      exportable: false,
      simulated: true,
      executed: false,
      real_provider_called: false,
      can_trigger_real_execution: false
    };
  }

  function describeReference(reference) {
    return {
      reference_id: reference && isNonEmptyString(reference.reference_id) ? reference.reference_id : 'reference_not_available',
      reference_type: reference && isNonEmptyString(reference.reference_type) ? reference.reference_type : 'unknown',
      environment: reference && isNonEmptyString(reference.environment) ? reference.environment : 'unknown',
      synthetic: reference && reference.synthetic === true,
      resolvable: canResolve(reference),
      exportable: false,
      simulated: true,
      executed: false,
      real_provider_called: false,
      can_trigger_real_execution: false
    };
  }

  function revokeReference(referenceId) {
    if (isNonEmptyString(referenceId)) revoked.add(referenceId);
    return {
      revoked: isNonEmptyString(referenceId),
      reference_id: isNonEmptyString(referenceId) ? referenceId : 'reference_not_available',
      simulated: true,
      executed: false,
      real_provider_called: false,
      can_trigger_real_execution: false
    };
  }

  function healthCheck() {
    return {
      status: 'ok',
      resolver_type: 'local_test_secret_resolver',
      provider_calls_allowed: false,
      process_env_allowed: false,
      synthetic_only: true,
      simulated: true,
      executed: false,
      real_provider_called: false,
      can_trigger_real_execution: false
    };
  }

  return Object.freeze({
    canResolve,
    resolveReference,
    describeReference,
    revokeReference,
    healthCheck
  });
}

module.exports = {
  createLocalTestSecretResolver,
  validateSecretAccessContext,
  SECRET_ACCESS_CONTEXT_FIELDS,
  ALLOWED_SECRET_ACCESS_PURPOSES,
  RESOLVABLE_SECRET_REFERENCE_STATUSES
};

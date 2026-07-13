'use strict';

const {
  RESOLVABLE_SECRET_REFERENCE_TYPES,
  buildSafeConfigurationError,
  isNonEmptyString,
  validateSecretReference
} = require('./provider-configuration-contract');

function safeBlocked(reason, code = 'SECRET_REFERENCE_TYPE_UNSUPPORTED') {
  return {
    resolved: false,
    ready: false,
    error: buildSafeConfigurationError(code, 'Secret reference cannot be resolved in this phase.', {
      blocked_reason: reason
    }),
    blocked_reason: reason,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false
  };
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
      !revoked.has(reference.reference_id);
  }

  function resolveReference(reference, context = {}) {
    if (!reference || reference.reference_type !== 'local_test_double_reference') {
      return safeBlocked('unsupported_in_current_phase');
    }
    if (context.environment && context.environment !== 'local_test') {
      return safeBlocked('production_resolution_blocked', 'INVALID_SECRET_REFERENCE');
    }
    if (!canResolve(reference)) {
      return safeBlocked('secret_reference_not_resolvable', 'INVALID_SECRET_REFERENCE');
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
  createLocalTestSecretResolver
};

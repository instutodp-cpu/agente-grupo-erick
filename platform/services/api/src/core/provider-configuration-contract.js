'use strict';

const {
  FORBIDDEN_FIELDS: ADAPTER_FORBIDDEN_FIELDS,
  TENANT_STRATEGIES,
  deepClone,
  isNonEmptyString,
  isNonEmptyStringArray,
  isPlainObject,
  uniqueSorted
} = require('./read-only-adapter-contract');

const CONFIGURATION_STATUSES = [
  'configuration_registered',
  'configuration_incomplete',
  'configuration_invalid',
  'configuration_ready',
  'configuration_blocked',
  'configuration_rotation_required',
  'configuration_expired',
  'configuration_deprecated'
];

const CONFIGURATION_READINESS_STATUSES = [
  'not_ready',
  'configuration_ready_for_mock_binding',
  'blocked_by_secret_policy',
  'blocked_by_environment_policy',
  'blocked_by_tenant_policy',
  'blocked_by_workspace_policy',
  'blocked_by_rotation',
  'blocked_by_expiration',
  'blocked_by_feature_flag',
  'blocked_by_kill_switch'
];

const SECRET_REFERENCE_TYPES = [
  'secret_ref',
  'vault_ref',
  'manual_fixture_ref'
];

const ENVIRONMENT_POLICIES = [
  'explicit_secret_reference_only',
  'no_plaintext_secret',
  'no_runtime_environment_provider_secret',
  'no_provider_sdk_configuration'
];

const TENANT_CONFIGURATION_POLICIES = TENANT_STRATEGIES;
const WORKSPACE_CONFIGURATION_POLICIES = ['personal', 'corporate', 'external_client'];

const ROTATION_STATUSES = ['rotation_not_due', 'rotation_due', 'rotation_overdue'];
const EXPIRATION_STATUSES = ['active', 'expired'];

const ERROR_CODES = [
  'INVALID_PROVIDER_CONFIGURATION',
  'PROVIDER_NOT_REGISTERED',
  'INVALID_SECRET_REFERENCE',
  'TENANT_CONFIGURATION_INVALID',
  'WORKSPACE_CONFIGURATION_INVALID',
  'FEATURE_FLAG_POLICY_INVALID',
  'KILL_SWITCH_POLICY_INVALID',
  'ROTATION_EXPIRED',
  'CONFIGURATION_EXPIRED',
  'CONFIGURATION_INCOMPLETE',
  'FORBIDDEN_FIELD_DETECTED',
  'REPLAYED_CONFIGURATION_CHANGE',
  'VERSION_CONFLICT',
  'DUPLICATE_CONFIGURATION',
  'CONFIGURATION_NOT_FOUND',
  'INTERNAL_CONFIGURATION_ERROR'
];

const REQUIRED_PROVIDER_CONFIGURATION_FIELDS = [
  'configuration_id',
  'provider_id',
  'provider_type',
  'adapter_id',
  'connector_id',
  'workspace_type',
  'tenant_id',
  'environment',
  'configuration_status',
  'configuration_version',
  'readiness_status',
  'secret_refs',
  'feature_flag_key',
  'feature_flag_default',
  'kill_switch_key',
  'rotation',
  'expiration',
  'tenant_policy',
  'workspace_policy',
  'environment_policy',
  'secret_policy',
  'owner_id',
  'reviewer_ids',
  'created_at',
  'updated_at',
  'deprecated',
  'simulated',
  'executed',
  'real_provider_called',
  'metadata'
];

const REQUIRED_SECRET_REFERENCE_FIELDS = [
  'secret_ref_id',
  'secret_ref_type',
  'provider_id',
  'workspace_type',
  'tenant_id',
  'scope',
  'status',
  'created_at',
  'last_rotated_at',
  'rotation_due_at',
  'expires_at',
  'metadata'
];

const REQUIRED_CONFIGURATION_CHANGE_FIELDS = [
  'trace_id',
  'change_id',
  'configuration_id',
  'expected_version',
  'actor_id',
  'actor_role',
  'reason',
  'requested_at',
  'simulated',
  'executed',
  'real_provider_called'
];

const REQUIRED_AUDIT_FIELDS = [
  'event_name',
  'trace_id',
  'change_id',
  'configuration_id',
  'provider_id',
  'adapter_id',
  'connector_id',
  'workspace_type',
  'tenant_id',
  'status',
  'applied',
  'previous_version',
  'new_version',
  'actor_id',
  'actor_role',
  'simulated',
  'executed',
  'real_provider_called',
  'can_trigger_real_execution',
  'error_code',
  'blocked_reason',
  'occurred_at'
];

const FORBIDDEN_FIELDS = uniqueSorted([
  ...ADAPTER_FORBIDDEN_FIELDS,
  'plaintextSecret',
  'secretValue',
  'clientSecret',
  'oauthCode',
  'privateKey',
  'sessionCookie',
  'providerCredential',
  'rawConfig',
  'rawSecret',
  'rawProviderConfig',
  'rawCredential'
]);

function isIsoLikeString(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function nowMs(context = {}) {
  const value = typeof context.clock === 'function' ? context.clock() : context.now;
  if (isIsoLikeString(value)) return Date.parse(value);
  return Date.now();
}

function isPast(value, context = {}) {
  if (!isIsoLikeString(value)) return true;
  return Date.parse(value) <= nowMs(context);
}

function findConfigurationForbiddenFields(value) {
  const forbidden = new Set(FORBIDDEN_FIELDS);
  const found = [];
  const seen = new WeakSet();

  function visit(entry) {
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }
    if (!isPlainObject(entry)) return;
    if (seen.has(entry)) {
      found.push('forbidden_field::cyclic_reference');
      return;
    }
    seen.add(entry);

    for (const [key, nested] of Object.entries(entry)) {
      if (forbidden.has(key)) {
        found.push(`forbidden_field::${key}`);
        continue;
      }
      visit(nested);
    }
    seen.delete(entry);
  }

  visit(value);
  return uniqueSorted(found);
}

function sanitizeConfigurationData(value) {
  const forbidden = new Set(FORBIDDEN_FIELDS);
  const seen = new WeakSet();

  function sanitize(entry) {
    if (entry === null || entry === undefined) return entry;
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') return entry;
    if (Array.isArray(entry)) return entry.map(sanitize);
    if (!isPlainObject(entry)) return undefined;
    if (seen.has(entry)) {
      return {
        blocked_reason: 'cycle_removed'
      };
    }
    seen.add(entry);

    const output = {};
    for (const [key, nested] of Object.entries(entry)) {
      if (forbidden.has(key)) continue;
      const sanitized = sanitize(nested);
      if (sanitized !== undefined) output[key] = sanitized;
    }
    seen.delete(entry);
    return output;
  }

  return sanitize(value);
}

function validateSecretReference(ref, config = {}, context = {}) {
  const errors = [];
  if (!isPlainObject(ref)) return { valid: false, errors: ['secret_reference_must_be_object'] };

  for (const field of REQUIRED_SECRET_REFERENCE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(ref, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['secret_ref_id', 'secret_ref_type', 'provider_id', 'workspace_type', 'tenant_id', 'scope', 'status', 'created_at', 'last_rotated_at', 'rotation_due_at', 'expires_at']) {
    if (!isNonEmptyString(ref[field])) errors.push(`invalid_${field}`);
  }
  if (!SECRET_REFERENCE_TYPES.includes(ref.secret_ref_type)) errors.push('secret_ref_type_not_allowed');
  if (ref.provider_id !== config.provider_id) errors.push('secret_ref_provider_mismatch');
  if (ref.workspace_type !== config.workspace_type) errors.push('secret_ref_workspace_mismatch');
  if (ref.tenant_id !== config.tenant_id) errors.push('secret_ref_tenant_mismatch');
  if (!isPlainObject(ref.metadata)) errors.push('secret_ref_metadata_must_be_object');
  if (isPast(ref.rotation_due_at, context)) errors.push('secret_ref_rotation_due');
  if (isPast(ref.expires_at, context)) errors.push('secret_ref_expired');
  errors.push(...findConfigurationForbiddenFields(ref));

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateTenantPolicy(config) {
  const errors = [];
  const policy = config.tenant_policy;
  if (!TENANT_CONFIGURATION_POLICIES.includes(policy)) {
    errors.push('tenant_policy_not_allowed');
    return errors;
  }
  if (!isNonEmptyString(config.tenant_id)) errors.push('tenant_id_required');
  if (policy === 'corporate_grupo_erick') {
    if (config.workspace_type !== 'corporate') errors.push('corporate_workspace_required');
    if (config.tenant_id !== 'grupo_erick') errors.push('corporate_tenant_required');
  }
  if (policy === 'personal_user_tenant') {
    if (config.workspace_type !== 'personal') errors.push('personal_workspace_required');
    if (!isNonEmptyString(config.user_id)) errors.push('personal_user_id_required');
    if (isNonEmptyString(config.user_id) && config.tenant_id !== `personal::${config.user_id}`) {
      errors.push('personal_tenant_mismatch');
    }
  }
  if (policy === 'external_client_tenant') {
    if (config.workspace_type !== 'external_client') errors.push('external_client_workspace_required');
    if (!isNonEmptyString(config.client_id)) errors.push('external_client_id_required');
    if (isNonEmptyString(config.client_id) && config.tenant_id !== `client::${config.client_id}`) {
      errors.push('external_client_tenant_mismatch');
    }
  }
  return errors;
}

function validateWorkspacePolicy(config) {
  const errors = [];
  if (!WORKSPACE_CONFIGURATION_POLICIES.includes(config.workspace_type)) {
    errors.push('workspace_type_not_allowed');
  }
  if (!isPlainObject(config.workspace_policy)) {
    errors.push('workspace_policy_must_be_object');
    return errors;
  }
  if (!isNonEmptyStringArray(config.workspace_policy.allowed_workspace_types)) {
    errors.push('workspace_policy_allowed_workspaces_required');
  } else if (!config.workspace_policy.allowed_workspace_types.includes(config.workspace_type)) {
    errors.push('workspace_policy_mismatch');
  }
  return errors;
}

function validateEnvironmentPolicy(config) {
  const errors = [];
  if (!isPlainObject(config.environment_policy)) {
    errors.push('environment_policy_must_be_object');
    return errors;
  }
  if (config.environment_policy.provider_calls_allowed !== false) errors.push('provider_calls_must_be_disabled');
  if (config.environment_policy.provider_sdk_allowed !== false) errors.push('provider_sdk_must_be_disabled');
  if (config.environment_policy.runtime_environment_secret_allowed !== false) {
    errors.push('runtime_environment_secret_must_be_disabled');
  }
  if (config.environment_policy.secret_references_only !== true) errors.push('secret_references_only_required');
  return errors;
}

function validateSecretPolicy(config) {
  const errors = [];
  if (!isPlainObject(config.secret_policy)) {
    errors.push('secret_policy_must_be_object');
    return errors;
  }
  if (config.secret_policy.plaintext_secrets_allowed !== false) errors.push('plaintext_secrets_must_be_disabled');
  if (config.secret_policy.secret_creation_allowed !== false) errors.push('secret_creation_must_be_disabled');
  if (config.secret_policy.secret_values_allowed !== false) errors.push('secret_values_must_be_disabled');
  if (config.secret_policy.secret_references_only !== true) errors.push('secret_policy_references_only_required');
  return errors;
}

function validateProviderConfiguration(config, context = {}) {
  const errors = [];
  if (!isPlainObject(config)) return { valid: false, errors: ['configuration_must_be_object'] };

  for (const field of REQUIRED_PROVIDER_CONFIGURATION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(config, field)) errors.push(`missing_${field}`);
  }
  for (const field of [
    'configuration_id',
    'provider_id',
    'provider_type',
    'adapter_id',
    'connector_id',
    'workspace_type',
    'tenant_id',
    'environment',
    'configuration_status',
    'readiness_status',
    'feature_flag_key',
    'kill_switch_key',
    'tenant_policy',
    'owner_id',
    'created_at',
    'updated_at'
  ]) {
    if (!isNonEmptyString(config[field])) errors.push(`invalid_${field}`);
  }
  if (!CONFIGURATION_STATUSES.includes(config.configuration_status)) errors.push('configuration_status_not_allowed');
  if (!CONFIGURATION_READINESS_STATUSES.includes(config.readiness_status)) errors.push('readiness_status_not_allowed');
  if (!Number.isInteger(config.configuration_version) || config.configuration_version < 1) errors.push('invalid_configuration_version');
  if (!isNonEmptyStringArray(config.reviewer_ids)) errors.push('invalid_reviewer_ids');
  if (!Array.isArray(config.secret_refs) || config.secret_refs.length === 0) errors.push('secret_refs_required');
  if (config.feature_flag_default !== false) errors.push('feature_flag_default_must_be_false');
  if (config.simulated !== true) errors.push('simulated_must_be_true');
  if (config.executed !== false) errors.push('executed_must_be_false');
  if (config.real_provider_called !== false) errors.push('real_provider_called_must_be_false');
  if (typeof config.deprecated !== 'boolean') errors.push('invalid_deprecated');
  if (!isPlainObject(config.metadata)) errors.push('metadata_must_be_object');
  if (!isPlainObject(config.rotation)) errors.push('rotation_must_be_object');
  if (!isPlainObject(config.expiration)) errors.push('expiration_must_be_object');
  if (isPlainObject(config.rotation)) {
    if (!isIsoLikeString(config.rotation.next_rotation_due_at)) errors.push('rotation_due_at_required');
    if (isPast(config.rotation.next_rotation_due_at, context)) errors.push('rotation_due_or_expired');
  }
  if (isPlainObject(config.expiration)) {
    if (!isIsoLikeString(config.expiration.expires_at)) errors.push('expiration_required');
    if (isPast(config.expiration.expires_at, context)) errors.push('configuration_expired');
  }
  if (isPlainObject(context.providerRegistry) && typeof context.providerRegistry.hasProvider === 'function' && !context.providerRegistry.hasProvider(config.provider_id)) {
    errors.push('provider_not_registered');
  }
  if (Array.isArray(config.secret_refs)) {
    for (const ref of config.secret_refs) {
      errors.push(...validateSecretReference(ref, config, context).errors);
    }
  }

  errors.push(...validateTenantPolicy(config));
  errors.push(...validateWorkspacePolicy(config));
  errors.push(...validateEnvironmentPolicy(config));
  errors.push(...validateSecretPolicy(config));
  errors.push(...findConfigurationForbiddenFields(config));

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateConfigurationChangeRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['configuration_change_must_be_object'] };
  for (const field of REQUIRED_CONFIGURATION_CHANGE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(request, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['trace_id', 'change_id', 'configuration_id', 'actor_id', 'actor_role', 'reason', 'requested_at']) {
    if (!isNonEmptyString(request[field])) errors.push(`invalid_${field}`);
  }
  if (!Number.isInteger(request.expected_version) || request.expected_version < 1) errors.push('invalid_expected_version');
  if (request.simulated !== true) errors.push('simulated_must_be_true');
  if (request.executed !== false) errors.push('executed_must_be_false');
  if (request.real_provider_called !== false) errors.push('real_provider_called_must_be_false');
  errors.push(...findConfigurationForbiddenFields(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateConfigurationReadiness(config, context = {}) {
  const validation = validateProviderConfiguration(config, context);
  if (!validation.valid) {
    return {
      ready: false,
      readiness_status: 'not_ready',
      blocking_reasons: validation.errors
    };
  }
  return {
    ready: true,
    readiness_status: 'configuration_ready_for_mock_binding',
    blocking_reasons: []
  };
}

function buildSafeConfigurationError(code, message, context = {}) {
  const safeCode = ERROR_CODES.includes(code) ? code : 'INTERNAL_CONFIGURATION_ERROR';
  return {
    error_code: safeCode,
    message: isNonEmptyString(message) ? message : 'Provider configuration operation blocked safely.',
    blocked_reason: isNonEmptyString(context.blocked_reason) ? context.blocked_reason : safeCode
  };
}

function buildConfigurationAuditEventCandidate(context = {}) {
  return {
    event_name: 'provider_configuration_change_evaluated',
    trace_id: isNonEmptyString(context.trace_id) ? context.trace_id : 'trace_not_available',
    change_id: isNonEmptyString(context.change_id) ? context.change_id : 'change_not_available',
    configuration_id: isNonEmptyString(context.configuration_id) ? context.configuration_id : 'configuration_not_available',
    provider_id: isNonEmptyString(context.provider_id) ? context.provider_id : 'provider_not_available',
    adapter_id: isNonEmptyString(context.adapter_id) ? context.adapter_id : 'adapter_not_available',
    connector_id: isNonEmptyString(context.connector_id) ? context.connector_id : 'connector_not_available',
    workspace_type: isNonEmptyString(context.workspace_type) ? context.workspace_type : 'workspace_not_available',
    tenant_id: isNonEmptyString(context.tenant_id) ? context.tenant_id : 'tenant_not_available',
    status: isNonEmptyString(context.status) ? context.status : 'configuration_blocked',
    applied: context.applied === true,
    previous_version: Number.isInteger(context.previous_version) ? context.previous_version : 0,
    new_version: Number.isInteger(context.new_version) ? context.new_version : 0,
    actor_id: isNonEmptyString(context.actor_id) ? context.actor_id : 'actor_not_available',
    actor_role: isNonEmptyString(context.actor_role) ? context.actor_role : 'actor_role_not_available',
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    error_code: isNonEmptyString(context.error_code) ? context.error_code : null,
    blocked_reason: isNonEmptyString(context.blocked_reason) ? context.blocked_reason : null,
    occurred_at: isNonEmptyString(context.occurred_at) ? context.occurred_at : new Date(0).toISOString()
  };
}

module.exports = {
  CONFIGURATION_STATUSES,
  CONFIGURATION_READINESS_STATUSES,
  SECRET_REFERENCE_TYPES,
  ENVIRONMENT_POLICIES,
  TENANT_CONFIGURATION_POLICIES,
  WORKSPACE_CONFIGURATION_POLICIES,
  ROTATION_STATUSES,
  EXPIRATION_STATUSES,
  ERROR_CODES,
  REQUIRED_PROVIDER_CONFIGURATION_FIELDS,
  REQUIRED_SECRET_REFERENCE_FIELDS,
  REQUIRED_CONFIGURATION_CHANGE_FIELDS,
  REQUIRED_AUDIT_FIELDS,
  FORBIDDEN_FIELDS,
  validateProviderConfiguration,
  validateSecretReference,
  validateConfigurationChangeRequest,
  validateConfigurationReadiness,
  findConfigurationForbiddenFields,
  sanitizeConfigurationData,
  buildSafeConfigurationError,
  buildConfigurationAuditEventCandidate,
  deepClone,
  isNonEmptyString,
  isPlainObject,
  uniqueSorted
};

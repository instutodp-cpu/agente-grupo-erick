'use strict';

const {
  FORBIDDEN_FIELDS: ADAPTER_FORBIDDEN_FIELDS,
  deepClone,
  isBlockedOperation,
  isNonEmptyString,
  isNonEmptyStringArray,
  isPlainObject,
  uniqueSorted
} = require('./read-only-adapter-contract');

const CONFIGURATION_STATUSES = [
  'unconfigured',
  'descriptor_registered',
  'reference_pending',
  'reference_registered',
  'validation_pending',
  'validation_blocked',
  'structurally_ready',
  'rotation_required',
  'expired',
  'revoked',
  'disabled',
  'deprecated'
];

const INITIAL_CONFIGURATION_STATUS = 'descriptor_registered';
const INITIAL_READINESS_STATUS = 'not_ready';

const CONFIGURATION_READINESS_STATUSES = [
  'not_ready',
  'configuration_structurally_ready',
  'blocked_by_lifecycle_binding',
  'blocked_by_adapter_binding',
  'blocked_by_secret_reference_binding',
  'blocked_by_secret_policy',
  'blocked_by_environment_policy',
  'blocked_by_tenant_policy',
  'blocked_by_workspace_policy',
  'blocked_by_rotation',
  'blocked_by_expiration',
  'blocked_by_feature_flag',
  'blocked_by_kill_switch'
];

const SECRET_REFERENCE_STATUSES = [
  'reference_pending',
  'reference_registered',
  'structurally_ready',
  'rotation_required',
  'expired',
  'revoked',
  'disabled'
];

const INITIAL_SECRET_REFERENCE_STATUSES = ['reference_pending', 'reference_registered'];

const SECRET_REFERENCE_TYPES = [
  'local_test_double_reference',
  'railway_variable_reference',
  'aws_secrets_manager_reference',
  'gcp_secret_manager_reference',
  'azure_key_vault_reference',
  'hashicorp_vault_reference',
  'supabase_vault_reference',
  'github_actions_secret_reference',
  'kubernetes_secret_reference'
];

const RESOLVABLE_SECRET_REFERENCE_TYPES = ['local_test_double_reference'];

const CONFIGURATION_OPERATIONS = [
  'register_synthetic_reference',
  'validate_structure',
  'evaluate_readiness',
  'mark_rotation_required',
  'mark_revoked',
  'disable_configuration',
  'deprecate_configuration'
];

const CONFIGURATION_TRANSITIONS = Object.freeze({
  descriptor_registered: {
    register_synthetic_reference: 'reference_pending',
    disable_configuration: 'disabled',
    deprecate_configuration: 'deprecated'
  },
  reference_pending: {
    register_synthetic_reference: 'reference_registered',
    validate_structure: 'validation_blocked',
    mark_revoked: 'revoked',
    disable_configuration: 'disabled'
  },
  reference_registered: {
    validate_structure: 'validation_pending',
    mark_revoked: 'revoked',
    disable_configuration: 'disabled'
  },
  validation_pending: {
    validate_structure: 'validation_blocked',
    evaluate_readiness: 'structurally_ready',
    disable_configuration: 'disabled'
  },
  validation_blocked: {
    validate_structure: 'validation_pending',
    disable_configuration: 'disabled'
  },
  structurally_ready: {
    mark_rotation_required: 'rotation_required',
    mark_revoked: 'revoked',
    disable_configuration: 'disabled',
    deprecate_configuration: 'deprecated'
  },
  rotation_required: {
    disable_configuration: 'disabled',
    mark_revoked: 'revoked',
    deprecate_configuration: 'deprecated'
  },
  expired: {
    mark_revoked: 'revoked',
    disable_configuration: 'disabled',
    deprecate_configuration: 'deprecated'
  },
  revoked: {
    deprecate_configuration: 'deprecated'
  },
  disabled: {
    deprecate_configuration: 'deprecated'
  },
  deprecated: {}
});

const ALLOWED_SECRET_REFERENCE_FIELDS = [
  'reference_id',
  'reference_type',
  'provider_id',
  'workspace_type',
  'tenant_id',
  'environment',
  'synthetic',
  'status',
  'reference_version',
  'created_at',
  'updated_at',
  'last_rotated_at',
  'rotation_due_at',
  'expires_at',
  'disabled',
  'revoked',
  'required_secret_names',
  'secret_names',
  'metadata'
];

const ALLOWED_SECRET_REFERENCE_METADATA_FIELDS = [
  'label',
  'purpose',
  'classification',
  'synthetic_note'
];

const REQUIRED_PROVIDER_CONFIGURATION_FIELDS = [
  'configuration_id',
  'connector_id',
  'provider_id',
  'provider_type',
  'adapter_id',
  'readiness_candidate_id',
  'workspace_type',
  'tenant_id',
  'environment',
  'configuration_status',
  'configuration_version',
  'readiness_status',
  'secret_reference_descriptors',
  'secret_reference_type',
  'required_secret_names',
  'required_scopes',
  'allowed_operations',
  'rotation_policy',
  'expiration_policy',
  'revocation_policy',
  'risk_level',
  'cost_risk',
  'rate_limit_risk',
  'data_classification',
  'contract_refs',
  'feature_flag_key',
  'feature_flag_default',
  'kill_switch_key',
  'kill_switch_required',
  'owner_id',
  'created_at',
  'updated_at',
  'deprecated',
  'disabled',
  'simulated',
  'executed',
  'real_provider_called',
  'metadata'
];

const REQUIRED_SECRET_REFERENCE_FIELDS = [
  'reference_id',
  'reference_type',
  'provider_id',
  'workspace_type',
  'tenant_id',
  'environment',
  'synthetic',
  'status',
  'reference_version',
  'created_at',
  'updated_at',
  'last_rotated_at',
  'rotation_due_at',
  'expires_at',
  'disabled',
  'revoked',
  'required_secret_names',
  'metadata'
];

const REQUIRED_CONFIGURATION_CHANGE_FIELDS = [
  'trace_id',
  'change_id',
  'configuration_id',
  'operation',
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
  'connector_id',
  'provider_id',
  'adapter_id',
  'previous_status',
  'current_status',
  'operation',
  'applied',
  'error_code',
  'blocked_reason',
  'occurred_at',
  'simulated',
  'executed',
  'real_provider_called'
];

const IMMUTABLE_CONFIGURATION_FIELDS = [
  'configuration_id',
  'connector_id',
  'provider_id',
  'provider_type',
  'adapter_id',
  'readiness_candidate_id',
  'workspace_type',
  'tenant_id',
  'organization_id',
  'client_id',
  'environment',
  'secret_reference_type',
  'owner_id'
];

const BLOCKED_SCOPE_TERMS = ['*', 'all', 'admin', 'full_access', 'write', 'repo', 'root'];

const ERROR_CODES = [
  'INVALID_PROVIDER_CONFIGURATION',
  'PROVIDER_NOT_REGISTERED',
  'INVALID_SECRET_REFERENCE',
  'SECRET_REFERENCE_TYPE_UNSUPPORTED',
  'DUPLICATE_SECRET_REFERENCE',
  'INVALID_INITIAL_SECRET_REFERENCE',
  'TENANT_CONFIGURATION_INVALID',
  'WORKSPACE_CONFIGURATION_INVALID',
  'FEATURE_FLAG_POLICY_INVALID',
  'KILL_SWITCH_POLICY_INVALID',
  'ROTATION_EXPIRED',
  'CONFIGURATION_EXPIRED',
  'CONFIGURATION_INCOMPLETE',
  'FORBIDDEN_FIELD_DETECTED',
  'REPLAYED_CONFIGURATION_REQUEST',
  'VERSION_CONFLICT',
  'DUPLICATE_CONFIGURATION',
  'CONFIGURATION_NOT_FOUND',
  'INITIAL_CONFIGURATION_STATE_NOT_ALLOWED',
  'CONFIGURATION_IDENTITY_MUTATION_BLOCKED',
  'INVALID_CONFIGURATION_TRANSITION',
  'UNSAFE_OPERATION',
  'INTERNAL_CONFIGURATION_ERROR'
];

const FORBIDDEN_FIELDS = uniqueSorted([
  ...ADAPTER_FORBIDDEN_FIELDS,
  'secretValue',
  'secret_value',
  'plaintext',
  'rawValue',
  'rawSecret',
  'passwordValue',
  'apiKeyValue',
  'access_token_value',
  'refresh_token_value',
  'clientSecret',
  'client_secret_value',
  'privateKey',
  'private_key_value',
  'certificateValue',
  'connectionString',
  'databaseUrl',
  'webhookSecret',
  'vaultPath',
  'secretArn',
  'secretResourceName',
  'environmentVariableName',
  'secret_handle',
  'rawConfig',
  'rawProviderConfig',
  'providerCredential'
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
    if (seen.has(entry)) return { blocked_reason: 'cycle_removed' };
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

function validateAllowedKeys(value, allowedFields, prefix) {
  if (!isPlainObject(value)) return [];
  return Object.keys(value)
    .filter((key) => !allowedFields.includes(key))
    .map((key) => `${prefix}_unknown_field::${key}`);
}

function validateSecretReference(reference, context = {}) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['secret_reference_must_be_object'] };
  errors.push(...validateAllowedKeys(reference, ALLOWED_SECRET_REFERENCE_FIELDS, 'secret_reference'));
  for (const field of REQUIRED_SECRET_REFERENCE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(reference, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['reference_id', 'reference_type', 'provider_id', 'workspace_type', 'tenant_id', 'environment', 'status', 'created_at', 'updated_at', 'last_rotated_at', 'rotation_due_at', 'expires_at']) {
    if (!isNonEmptyString(reference[field])) errors.push(`invalid_${field}`);
  }
  if (!SECRET_REFERENCE_TYPES.includes(reference.reference_type)) errors.push('secret_reference_type_not_allowed');
  if (!RESOLVABLE_SECRET_REFERENCE_TYPES.includes(reference.reference_type)) errors.push('unsupported_in_current_phase');
  if (!SECRET_REFERENCE_STATUSES.includes(reference.status)) errors.push('secret_reference_status_not_allowed');
  if (!Number.isInteger(reference.reference_version) || reference.reference_version < 1) errors.push('invalid_reference_version');
  if (reference.synthetic !== true) errors.push('secret_reference_must_be_synthetic');
  if (reference.environment !== 'local_test') errors.push('secret_reference_environment_must_be_local_test');
  if (reference.disabled !== false) errors.push('secret_reference_disabled_must_be_false');
  if (reference.revoked !== false) errors.push('secret_reference_revoked_must_be_false');
  if (!isNonEmptyStringArray(reference.required_secret_names)) errors.push('required_secret_names_required');
  if (reference.secret_names !== undefined && !isNonEmptyStringArray(reference.secret_names)) errors.push('invalid_secret_names');
  if (!isPlainObject(reference.metadata)) {
    errors.push('secret_reference_metadata_must_be_object');
  } else {
    errors.push(...validateAllowedKeys(reference.metadata, ALLOWED_SECRET_REFERENCE_METADATA_FIELDS, 'secret_reference_metadata'));
  }
  if (isPast(reference.rotation_due_at, context)) errors.push('secret_reference_rotation_due');
  if (isPast(reference.expires_at, context)) errors.push('secret_reference_expired');
  errors.push(...findConfigurationForbiddenFields(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateInitialSecretReferenceState(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return ['secret_reference_must_be_object'];
  if (!INITIAL_SECRET_REFERENCE_STATUSES.includes(reference.status)) errors.push('initial_secret_reference_state_not_allowed');
  if (reference.reference_version !== 1) errors.push('initial_reference_version_must_be_1');
  if (reference.disabled !== false) errors.push('initial_reference_disabled_must_be_false');
  if (reference.revoked !== false) errors.push('initial_reference_revoked_must_be_false');
  return uniqueSorted(errors);
}

function validateScopeList(scopes) {
  const errors = [];
  if (!isNonEmptyStringArray(scopes)) return ['required_scopes_required'];
  for (const scope of scopes) {
    const normalized = scope.toLowerCase();
    if (BLOCKED_SCOPE_TERMS.includes(normalized)) errors.push(`blocked_scope::${scope}`);
  }
  return errors;
}

function validateReadOnlyOperationList(operations) {
  const errors = [];
  if (!isNonEmptyStringArray(operations)) return ['allowed_operations_required'];
  for (const operation of operations) {
    if (isBlockedOperation(operation)) errors.push(`unsafe_operation::${operation}`);
  }
  return errors;
}

function validateProviderConfiguration(config, context = {}) {
  const errors = [];
  if (!isPlainObject(config)) return { valid: false, errors: ['configuration_must_be_object'] };
  for (const field of REQUIRED_PROVIDER_CONFIGURATION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(config, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['configuration_id', 'connector_id', 'provider_id', 'provider_type', 'adapter_id', 'readiness_candidate_id', 'workspace_type', 'tenant_id', 'environment', 'configuration_status', 'readiness_status', 'secret_reference_type', 'feature_flag_key', 'kill_switch_key', 'owner_id', 'created_at', 'updated_at']) {
    if (!isNonEmptyString(config[field])) errors.push(`invalid_${field}`);
  }
  if (!CONFIGURATION_STATUSES.includes(config.configuration_status)) errors.push('configuration_status_not_allowed');
  if (!CONFIGURATION_READINESS_STATUSES.includes(config.readiness_status)) errors.push('readiness_status_not_allowed');
  if (!Number.isInteger(config.configuration_version) || config.configuration_version < 1) errors.push('invalid_configuration_version');
  if (!Array.isArray(config.secret_reference_descriptors) || config.secret_reference_descriptors.length === 0) errors.push('secret_reference_descriptors_required');
  if (config.secret_reference_type !== 'local_test_double_reference') errors.push('unsupported_in_current_phase');
  if (!isNonEmptyStringArray(config.required_secret_names)) errors.push('required_secret_names_required');
  errors.push(...validateScopeList(config.required_scopes));
  errors.push(...validateReadOnlyOperationList(config.allowed_operations));
  for (const field of ['rotation_policy', 'expiration_policy', 'revocation_policy', 'metadata']) {
    if (!isPlainObject(config[field])) errors.push(`${field}_must_be_object`);
  }
  if (isPlainObject(config.rotation_policy)) {
    if (!isIsoLikeString(config.rotation_policy.next_rotation_due_at)) errors.push('rotation_due_at_required');
    if (isPast(config.rotation_policy.next_rotation_due_at, context)) errors.push('rotation_due_or_expired');
  }
  if (isPlainObject(config.expiration_policy)) {
    if (!isIsoLikeString(config.expiration_policy.expires_at)) errors.push('expiration_required');
    if (isPast(config.expiration_policy.expires_at, context)) errors.push('configuration_expired');
  }
  if (config.risk_level === 'unknown') errors.push('risk_level_unknown');
  if (config.cost_risk === 'unknown') errors.push('cost_risk_unknown');
  if (config.rate_limit_risk === 'unknown') errors.push('rate_limit_risk_unknown');
  if (!isNonEmptyString(config.data_classification)) errors.push('invalid_data_classification');
  if (!isNonEmptyStringArray(config.contract_refs)) errors.push('contract_refs_required');
  if (config.feature_flag_default !== false) errors.push('feature_flag_default_must_be_false');
  if (config.kill_switch_required !== true) errors.push('kill_switch_required_must_be_true');
  if (config.deprecated !== false && config.configuration_status !== 'deprecated') errors.push('deprecated_flag_invalid');
  if (config.disabled !== false && !['disabled', 'deprecated'].includes(config.configuration_status)) errors.push('disabled_flag_invalid');
  if (config.simulated !== true) errors.push('simulated_must_be_true');
  if (config.executed !== false) errors.push('executed_must_be_false');
  if (config.real_provider_called !== false) errors.push('real_provider_called_must_be_false');
  if (isPlainObject(context.providerRegistry) && typeof context.providerRegistry.hasProvider === 'function' && !context.providerRegistry.hasProvider(config.provider_id)) {
    errors.push('provider_not_registered');
  }
  errors.push(...findConfigurationForbiddenFields(config));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateInitialConfigurationState(config) {
  const errors = [];
  if (!isPlainObject(config)) return ['configuration_must_be_object'];
  if (config.configuration_status !== INITIAL_CONFIGURATION_STATUS) errors.push('initial_configuration_status_must_be_descriptor_registered');
  if (config.readiness_status !== INITIAL_READINESS_STATUS) errors.push('initial_readiness_status_must_be_not_ready');
  if (config.configuration_version !== 1) errors.push('initial_configuration_version_must_be_1');
  if (config.deprecated !== false) errors.push('initial_deprecated_must_be_false');
  if (config.disabled !== false) errors.push('initial_disabled_must_be_false');
  if (config.feature_flag_default !== false) errors.push('initial_feature_flag_default_must_be_false');
  if (config.kill_switch_required !== true) errors.push('initial_kill_switch_required_must_be_true');
  if (!['local_test', 'contract_only'].includes(config.environment)) errors.push('initial_environment_not_allowed');
  return uniqueSorted(errors);
}

function validateConfigurationChangeRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['configuration_change_must_be_object'] };
  for (const field of REQUIRED_CONFIGURATION_CHANGE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(request, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['trace_id', 'change_id', 'configuration_id', 'operation', 'actor_id', 'actor_role', 'reason', 'requested_at']) {
    if (!isNonEmptyString(request[field])) errors.push(`invalid_${field}`);
  }
  if (!CONFIGURATION_OPERATIONS.includes(request.operation)) errors.push('configuration_operation_not_allowed');
  if (!Number.isInteger(request.expected_version) || request.expected_version < 1) errors.push('invalid_expected_version');
  if (request.simulated !== true) errors.push('simulated_must_be_true');
  if (request.executed !== false) errors.push('executed_must_be_false');
  if (request.real_provider_called !== false) errors.push('real_provider_called_must_be_false');
  errors.push(...findConfigurationForbiddenFields(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function getConfigurationTargetStatus(currentStatus, operation) {
  return CONFIGURATION_TRANSITIONS[currentStatus] && CONFIGURATION_TRANSITIONS[currentStatus][operation]
    ? CONFIGURATION_TRANSITIONS[currentStatus][operation]
    : null;
}

function detectConfigurationIdentityMutation(current, patch = {}) {
  const mutations = [];
  if (!isPlainObject(current) || !isPlainObject(patch)) return mutations;
  for (const field of IMMUTABLE_CONFIGURATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field) && patch[field] !== current[field]) {
      mutations.push(`identity_mutation::${field}`);
    }
  }
  return uniqueSorted(mutations);
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
    connector_id: isNonEmptyString(context.connector_id) ? context.connector_id : 'connector_not_available',
    provider_id: isNonEmptyString(context.provider_id) ? context.provider_id : 'provider_not_available',
    adapter_id: isNonEmptyString(context.adapter_id) ? context.adapter_id : 'adapter_not_available',
    previous_status: isNonEmptyString(context.previous_status) ? context.previous_status : 'unknown',
    current_status: isNonEmptyString(context.current_status) ? context.current_status : 'unknown',
    operation: isNonEmptyString(context.operation) ? context.operation : 'unknown',
    applied: context.applied === true,
    error_code: isNonEmptyString(context.error_code) ? context.error_code : null,
    blocked_reason: isNonEmptyString(context.blocked_reason) ? context.blocked_reason : null,
    occurred_at: isNonEmptyString(context.occurred_at) ? context.occurred_at : new Date(0).toISOString(),
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false
  };
}

module.exports = {
  CONFIGURATION_STATUSES,
  INITIAL_CONFIGURATION_STATUS,
  INITIAL_READINESS_STATUS,
  CONFIGURATION_READINESS_STATUSES,
  SECRET_REFERENCE_STATUSES,
  INITIAL_SECRET_REFERENCE_STATUSES,
  SECRET_REFERENCE_TYPES,
  RESOLVABLE_SECRET_REFERENCE_TYPES,
  CONFIGURATION_OPERATIONS,
  CONFIGURATION_TRANSITIONS,
  REQUIRED_PROVIDER_CONFIGURATION_FIELDS,
  REQUIRED_SECRET_REFERENCE_FIELDS,
  REQUIRED_CONFIGURATION_CHANGE_FIELDS,
  REQUIRED_AUDIT_FIELDS,
  IMMUTABLE_CONFIGURATION_FIELDS,
  BLOCKED_SCOPE_TERMS,
  ERROR_CODES,
  FORBIDDEN_FIELDS,
  ALLOWED_SECRET_REFERENCE_FIELDS,
  validateProviderConfiguration,
  validateInitialConfigurationState,
  validateSecretReference,
  validateInitialSecretReferenceState,
  validateConfigurationChangeRequest,
  getConfigurationTargetStatus,
  detectConfigurationIdentityMutation,
  findConfigurationForbiddenFields,
  sanitizeConfigurationData,
  buildSafeConfigurationError,
  buildConfigurationAuditEventCandidate,
  deepClone,
  isNonEmptyString,
  isPlainObject,
  uniqueSorted
};

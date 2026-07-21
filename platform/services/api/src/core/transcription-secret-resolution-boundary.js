'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { ALLOWED_CAPABILITY_PROVIDER_SLUGS } = require('./transcription-provider-capability-matrix');
const { deepFreeze } = require('./transcription-provider-adapter-interface');
const { stableCanonicalize, stablePayload } = require('./transcription-provider-contract-registry');
const {
  ALLOWED_PURPOSES,
  TRANSCRIPTION_SECRET_ACCESS_POLICY_VERSION,
  evaluateSecretAccessPolicy,
  validateAccessContext
} = require('./transcription-secret-access-policy');
const { buildSecretResolutionAudit } = require('./transcription-secret-resolution-audit');
const {
  SECRET_RESOLUTION_SAFE_FLAGS,
  buildSecretResolutionResult,
  cloneFrozen
} = require('./transcription-secret-resolution-result');

const TRANSCRIPTION_SECRET_RESOLUTION_BOUNDARY_VALIDATOR_VERSION = 'transcription_secret_resolution_boundary_validator_v1';
const RESOLUTION_REQUEST_FIELDS = Object.freeze([
  'resolution_request_id',
  'resolution_request_version',
  'tenant_id',
  'conversation_id',
  'provider_slug',
  'adapter_id',
  'secret_reference',
  'requested_scope',
  'requested_purpose',
  'access_context',
  'simulation_context',
  'metadata',
  'validator_version'
]);
const SECRET_REFERENCE_FIELDS = Object.freeze([
  'secret_ref_id',
  'secret_ref_version',
  'secret_alias',
  'secret_type',
  'provider_slug',
  'tenant_id',
  'environment',
  'scope',
  'rotation_version',
  'active',
  'revoked',
  'simulation',
  'production_blocked',
  'network_enabled',
  'runtime_enabled',
  'validator_version'
]);
const SECRET_TYPES = Object.freeze([
  'API_KEY_REFERENCE',
  'OAUTH_REFERENCE',
  'SERVICE_ACCOUNT_REFERENCE',
  'SIGNING_KEY_REFERENCE',
  'WEBHOOK_SECRET_REFERENCE',
  'CUSTOM_REFERENCE'
]);
const SECRET_ENVIRONMENTS = Object.freeze(['DEVELOPMENT', 'STAGING', 'PRODUCTION']);
const SECRET_SCOPES = Object.freeze(['TRANSCRIPTION_PROVIDER', 'TRANSPORT', 'WEBHOOK', 'INTERNAL_SERVICE']);
const SENSITIVE_FIELD_PATTERNS = Object.freeze([
  /(^|_)value$/i,
  /secret/i,
  /token/i,
  /password/i,
  /credential/i,
  /api[_-]?key/i,
  /apikey/i,
  /private[_-]?key/i,
  /client[_-]?secret/i,
  /authorization/i,
  /bearer/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /^headers$/i,
  /^raw$/i,
  /^payload$/i,
  /plaintext/i,
  /ciphertext/i
]);
const ALLOWED_SECRET_REFERENCE_SENSITIVE_NAMES = Object.freeze(new Set([
  'secret_reference',
  'secret_ref_id',
  'secret_ref_version',
  'secret_alias',
  'secret_type',
  'secret_reference_fingerprint',
  'secret_resolved'
]));

function exactFields(value, fields, prefix, errors) {
  const allowed = new Set(fields);
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_${field}`);
  for (const field of Object.keys(value)) if (!allowed.has(field)) errors.push(`${prefix}_unexpected_field::${field}`);
}

function shouldInspectSensitiveValue(path) {
  const key = String(path || '').split('.').pop().replace(/\[\d+\]$/, '');
  if (ALLOWED_SECRET_REFERENCE_SENSITIVE_NAMES.has(key)) return false;
  if (/(_id|_version|_alias|validator_version|policy_version|fixture_version|provider_slug|tenant_id|conversation_id|adapter_id)$/i.test(key)) return false;
  return true;
}

function looksSensitiveValue(value, path) {
  if (typeof value !== 'string') return null;
  if (!shouldInspectSensitiveValue(path)) return null;
  if (/^Bearer\s+[A-Za-z0-9._~+/-]{12,}$/i.test(value)) return 'suspicious_bearer_value';
  if (/^Basic\s+[A-Za-z0-9+/=]{12,}$/i.test(value)) return 'suspicious_basic_auth_value';
  if (/-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE KEY-----/i.test(value)) return 'suspicious_pem_private_key_value';
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return 'suspicious_jwt_value';
  if (/^(sk|pk|key|api)[_-]?[A-Za-z0-9]{24,}$/i.test(value)) return 'suspicious_api_key_value';
  if (value.length >= 48 && /^[A-Za-z0-9+/=_-]+$/.test(value)) return 'suspicious_long_secret_value';
  return null;
}

function findSecretMaterial(value) {
  const found = [];
  const seen = new WeakSet();
  function visit(entry, path) {
    if (entry === null) return;
    const type = typeof entry;
    if (type === 'string') {
      const reason = looksSensitiveValue(entry, path);
      if (reason) found.push(`${reason}::${path || 'value'}`);
      return;
    }
    if (type === 'number' || type === 'boolean') return;
    if (type === 'bigint') {
      found.push(`forbidden_bigint::${path || 'value'}`);
      return;
    }
    if (type === 'symbol') {
      found.push(`forbidden_symbol::${path || 'value'}`);
      return;
    }
    if (type === 'function') {
      found.push(`forbidden_function::${path || 'value'}`);
      return;
    }
    if (entry === undefined) {
      found.push(`forbidden_undefined::${path || 'value'}`);
      return;
    }
    if (Buffer.isBuffer(entry) || entry instanceof ArrayBuffer || ArrayBuffer.isView(entry)) {
      found.push(`forbidden_binary::${path || 'value'}`);
      return;
    }
    if (Array.isArray(entry)) {
      if (seen.has(entry)) {
        found.push('forbidden_cycle::array');
        return;
      }
      seen.add(entry);
      entry.forEach((item, index) => visit(item, `${path}[${index}]`));
      seen.delete(entry);
      return;
    }
    if (!isPlainObject(entry)) {
      found.push(`forbidden_non_plain_object::${path || 'value'}`);
      return;
    }
    if (seen.has(entry)) {
      found.push('forbidden_cycle::object');
      return;
    }
    seen.add(entry);
    for (const [key, nested] of Object.entries(entry)) {
      const nestedPath = path ? `${path}.${key}` : key;
      if (!ALLOWED_SECRET_REFERENCE_SENSITIVE_NAMES.has(key) && SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(key))) {
        found.push(`forbidden_sensitive_field::${nestedPath}`);
        continue;
      }
      visit(nested, nestedPath);
    }
    seen.delete(entry);
  }
  visit(value, '');
  return uniqueSorted(found);
}

function validateSimulationContext(context) {
  const errors = [];
  if (!isPlainObject(context)) return ['simulation_context_must_be_object'];
  if (context.simulation !== true) errors.push('simulation_context_simulation_must_be_true');
  if (context.production_blocked !== true) errors.push('simulation_context_production_blocked_must_be_true');
  if (context.network_used !== false) errors.push('simulation_context_network_used_must_be_false');
  if (context.provider_called !== false) errors.push('simulation_context_provider_called_must_be_false');
  if (context.executed !== false) errors.push('simulation_context_executed_must_be_false');
  if (context.secret_resolved !== false) errors.push('simulation_context_secret_resolved_must_be_false');
  if (context.runtime_enabled !== false) errors.push('simulation_context_runtime_enabled_must_be_false');
  if (context.rollout_percentage !== 0) errors.push('simulation_context_rollout_percentage_must_be_zero');
  return errors;
}

function validateSecretReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['secret_reference_must_be_object'] };
  exactFields(reference, SECRET_REFERENCE_FIELDS, 'secret_reference', errors);
  for (const field of ['secret_ref_id', 'secret_alias', 'secret_type', 'provider_slug', 'tenant_id', 'environment', 'scope', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ['secret_ref_version', 'rotation_version']) {
    if (!Number.isInteger(reference[field]) || reference[field] < 1) errors.push(`${field}_invalid`);
  }
  if (!SECRET_TYPES.includes(reference.secret_type)) errors.push(`secret_type_not_allowed::${reference.secret_type}`);
  if (!SECRET_ENVIRONMENTS.includes(reference.environment)) errors.push(`environment_not_allowed::${reference.environment}`);
  if (!SECRET_SCOPES.includes(reference.scope)) errors.push(`scope_not_allowed::${reference.scope}`);
  if (!ALLOWED_CAPABILITY_PROVIDER_SLUGS.includes(reference.provider_slug)) errors.push(`provider_slug_not_allowed::${reference.provider_slug}`);
  if (reference.active !== false) errors.push('active_must_be_false');
  if (reference.revoked !== false) errors.push('revoked_must_be_false');
  if (reference.simulation !== true) errors.push('simulation_must_be_true');
  if (reference.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (reference.network_enabled !== false) errors.push('network_enabled_must_be_false');
  if (reference.runtime_enabled !== false) errors.push('runtime_enabled_must_be_false');
  if (reference.validator_version !== TRANSCRIPTION_SECRET_RESOLUTION_BOUNDARY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findSecretMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateSecretResolutionRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['resolution_request_must_be_object'] };
  exactFields(request, RESOLUTION_REQUEST_FIELDS, 'resolution_request', errors);
  for (const field of ['resolution_request_id', 'tenant_id', 'conversation_id', 'provider_slug', 'adapter_id', 'requested_scope', 'requested_purpose', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.resolution_request_version) || request.resolution_request_version < 1) errors.push('resolution_request_version_invalid');
  if (!ALLOWED_CAPABILITY_PROVIDER_SLUGS.includes(request.provider_slug)) errors.push(`provider_slug_not_allowed::${request.provider_slug}`);
  if (!SECRET_SCOPES.includes(request.requested_scope)) errors.push(`requested_scope_not_allowed::${request.requested_scope}`);
  if (!ALLOWED_PURPOSES.includes(request.requested_purpose)) errors.push(`requested_purpose_not_allowed::${request.requested_purpose}`);
  if (!isPlainObject(request.metadata)) errors.push('metadata_must_be_object');
  errors.push(...validateSimulationContext(request.simulation_context));
  const referenceValidation = validateSecretReference(request.secret_reference);
  errors.push(...referenceValidation.errors);
  const accessValidation = validateAccessContext(request.access_context);
  errors.push(...accessValidation.errors);
  if (request.secret_reference?.provider_slug && request.provider_slug !== request.secret_reference.provider_slug) errors.push('provider_mismatch');
  if (request.secret_reference?.tenant_id && request.tenant_id !== request.secret_reference.tenant_id) errors.push('tenant_mismatch');
  if (request.secret_reference?.scope && request.requested_scope !== request.secret_reference.scope) errors.push('scope_mismatch');
  if (request.validator_version !== TRANSCRIPTION_SECRET_RESOLUTION_BOUNDARY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findSecretMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function statusFromErrors(errors) {
  if (errors.some((error) => String(error).includes('tenant_mismatch'))) return 'TENANT_MISMATCH';
  if (errors.some((error) => String(error).includes('provider_mismatch'))) return 'PROVIDER_MISMATCH';
  if (errors.some((error) => String(error).includes('scope_mismatch'))) return 'SCOPE_MISMATCH';
  if (errors.some((error) => String(error).includes('revoked_must_be_false'))) return 'REVOKED_REFERENCE';
  if (errors.some((error) => String(error).includes('active_must_be_false'))) return 'INACTIVE_REFERENCE';
  if (errors.some((error) => String(error).includes('ACCESS') || String(error).includes('approval'))) return 'ACCESS_DENIED';
  if (errors.length > 0) return 'INVALID_REFERENCE';
  return 'REFERENCE_VALID_SIMULATION';
}

function resolveTranscriptionSecretReference(request = {}) {
  const validation = validateSecretResolutionRequest(request);
  const policy = evaluateSecretAccessPolicy(request, request.secret_reference || {});
  const blockers = uniqueSorted([...(validation.errors || []), ...(policy.blocking_reasons || [])]);
  const reference = request.secret_reference || {};
  const ok = validation.valid && policy.allowed === true;
  const status = ok ? 'REFERENCE_VALID_SIMULATION' : (policy.status === 'ACCESS_POLICY_BLOCKED' ? 'POLICY_BLOCKED' : statusFromErrors(blockers));
  const result = buildSecretResolutionResult({
    resolution_request_id: request.resolution_request_id,
    provider_slug: request.provider_slug,
    adapter_id: request.adapter_id,
    secret_ref_id: reference.secret_ref_id,
    secret_alias: reference.secret_alias,
    secret_type: reference.secret_type,
    environment: reference.environment,
    scope: reference.scope,
    status,
    decision: status,
    decision_reason: ok ? 'reference_valid_simulation_only' : blockers[0] || 'secret_resolution_blocked',
    access_policy_status: policy.status,
    reference_valid: ok
  });
  const audit = buildSecretResolutionAudit({ request, policy, blockers, logical_sequence: 1 });
  return cloneFrozen({
    result,
    audit,
    policy,
    request_fingerprint: validation.valid ? stablePayload(request) : 'invalid_request',
    secret_reference_fingerprint: validation.valid ? stablePayload(reference) : 'invalid_reference',
    errors: blockers,
    ...SECRET_RESOLUTION_SAFE_FLAGS
  });
}

function createTranscriptionSecretReferenceRegistry() {
  const records = new Map();
  const hashes = new Map();
  const versions = new Map();
  const history = new Map();
  function safe(payload) {
    return cloneFrozen({ ...payload, ...SECRET_RESOLUTION_SAFE_FLAGS });
  }
  function registerSecretReference(reference, options = {}) {
    const validation = validateSecretReference(reference);
    if (!validation.valid) return safe({ ok: false, errors: validation.errors });
    let payload;
    try {
      payload = JSON.stringify(stableCanonicalize(reference));
    } catch (error) {
      return safe({ ok: false, errors: [`secret_reference_fingerprint_invalid::${error.message}`] });
    }
    const id = reference.secret_ref_id;
    if (records.has(id)) {
      if (hashes.get(id) === payload) return safe({ ok: false, errors: ['secret_reference_replay_duplicate'] });
      return safe({ ok: false, errors: ['secret_reference_replay_payload_mismatch'] });
    }
    const key = `${reference.tenant_id}:${reference.provider_slug}:${reference.scope}`;
    const previousVersion = versions.get(key) || 0;
    const expectedVersion = options.expected_version;
    if (expectedVersion !== undefined && expectedVersion !== previousVersion) return safe({ ok: false, errors: ['secret_reference_optimistic_conflict'] });
    if (reference.secret_ref_version <= previousVersion) return safe({ ok: false, errors: ['secret_reference_version_downgrade'] });
    const stored = cloneFrozen(reference);
    records.set(id, stored);
    hashes.set(id, payload);
    versions.set(key, reference.secret_ref_version);
    history.set(key, [...(history.get(key) || []), stored].slice(-20));
    return safe({ ok: true, secret_ref_id: id, secret_ref_version: reference.secret_ref_version, fingerprint: payload });
  }
  return Object.freeze({
    registerSecretReference,
    getSecretReference(id) {
      return records.has(id) ? cloneFrozen(records.get(id)) : null;
    },
    getHistory(key) {
      return cloneFrozen(history.get(key) || []);
    }
  });
}

module.exports = {
  RESOLUTION_REQUEST_FIELDS,
  SECRET_ENVIRONMENTS,
  SECRET_REFERENCE_FIELDS,
  SECRET_SCOPES,
  SECRET_TYPES,
  TRANSCRIPTION_SECRET_RESOLUTION_BOUNDARY_VALIDATOR_VERSION,
  createTranscriptionSecretReferenceRegistry,
  findSecretMaterial,
  resolveTranscriptionSecretReference,
  validateSecretReference,
  validateSecretResolutionRequest
};

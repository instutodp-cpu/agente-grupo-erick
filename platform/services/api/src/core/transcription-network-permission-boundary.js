'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { ALLOWED_CAPABILITY_PROVIDER_SLUGS } = require('./transcription-provider-capability-matrix');
const { stableCanonicalize, stablePayload } = require('./transcription-provider-contract-registry');
const { SECRET_RESOLUTION_SAFE_FLAGS } = require('./transcription-secret-resolution-result');
const {
  ALLOWED_NETWORK_PURPOSES,
  evaluateNetworkAccessPolicy,
  validatePolicyContext
} = require('./transcription-network-access-policy');
const { buildNetworkPermissionAudit } = require('./transcription-network-permission-audit');
const {
  NETWORK_PERMISSION_SAFE_FLAGS,
  buildNetworkPermissionResult,
  cloneFrozen
} = require('./transcription-network-permission-result');

const TRANSCRIPTION_NETWORK_PERMISSION_BOUNDARY_VALIDATOR_VERSION = 'transcription_network_permission_boundary_validator_v1';
const NETWORK_REQUEST_FIELDS = Object.freeze([
  'network_request_id',
  'network_request_version',
  'tenant_id',
  'conversation_id',
  'provider_slug',
  'adapter_id',
  'transport_id',
  'destination_reference',
  'operation',
  'protocol',
  'data_classification',
  'requested_scope',
  'requested_purpose',
  'secret_resolution_context',
  'policy_context',
  'simulation_context',
  'metadata',
  'validator_version'
]);
const DESTINATION_REFERENCE_FIELDS = Object.freeze([
  'destination_ref_id',
  'destination_ref_version',
  'destination_alias',
  'provider_slug',
  'transport_id',
  'protocol',
  'environment',
  'scope',
  'region_class',
  'endpoint_present',
  'hostname_present',
  'ip_present',
  'port_present',
  'url_present',
  'dns_required',
  'tls_required',
  'streaming_requested',
  'active',
  'approved',
  'simulation',
  'production_blocked',
  'network_enabled',
  'runtime_enabled',
  'validator_version'
]);
const NETWORK_PROTOCOLS = Object.freeze([
  'HTTP_REFERENCE',
  'HTTPS_REFERENCE',
  'WEBSOCKET_REFERENCE',
  'GRPC_REFERENCE',
  'STREAM_REFERENCE',
  'INTERNAL_REFERENCE'
]);
const NETWORK_OPERATIONS = Object.freeze([
  'TRANSCRIPTION_BATCH_REQUEST',
  'TRANSCRIPTION_STREAM_REQUEST',
  'PROVIDER_HEALTHCHECK',
  'PROVIDER_METADATA_REQUEST',
  'WEBHOOK_DELIVERY',
  'INTERNAL_SERVICE_REQUEST'
]);
const DATA_CLASSIFICATIONS = Object.freeze([
  'PUBLIC_METADATA',
  'INTERNAL_METADATA',
  'SENSITIVE_AUDIO',
  'SENSITIVE_TRANSCRIPT',
  'RESTRICTED_CREDENTIAL_METADATA',
  'PII',
  'PHI'
]);
const DESTINATION_ENVIRONMENTS = Object.freeze(['DEVELOPMENT', 'STAGING', 'PRODUCTION']);
const DESTINATION_SCOPES = Object.freeze(['TRANSCRIPTION_PROVIDER', 'TRANSPORT', 'WEBHOOK', 'INTERNAL_SERVICE']);
const REGION_CLASSES = Object.freeze(['SYNTHETIC_LOCAL', 'SYNTHETIC_NON_PRODUCTION', 'UNKNOWN_REVIEW_ONLY']);
const FORBIDDEN_NETWORK_FIELD_PATTERNS = Object.freeze([
  /url/i,
  /uri/i,
  /endpoint/i,
  /hostname/i,
  /^host$/i,
  /domain/i,
  /^ip$/i,
  /ipv4/i,
  /ipv6/i,
  /port/i,
  /socket/i,
  /proxy/i,
  /tunnel/i,
  /address/i,
  /dns_server/i,
  /base_url/i,
  /websocket_url/i,
  /callback_url/i,
  /redirect_url/i,
  /authorization/i,
  /^headers?$/i,
  /token/i,
  /secret/i,
  /credential/i,
  /api[_-]?key/i,
  /password/i
]);
const ALLOWED_NETWORK_FIELD_NAMES = Object.freeze(new Set([
  'destination_reference',
  'destination_ref_id',
  'destination_ref_version',
  'destination_alias',
  'destination_reference_fingerprint',
  'endpoint_present',
  'hostname_present',
  'ip_present',
  'port_present',
  'url_present',
  'dns_required',
  'tls_required',
  'secret_resolution_context',
  'secret_resolution_status',
  'secret_reference_fingerprint',
  'secret_material_present',
  'secret_material_returned',
  'secret_loaded',
  'secret_resolved',
  'network_request_id',
  'network_request_version',
  'transport_id',
  'socket_created',
  'security_review_state'
]));

function exactFields(value, fields, prefix, errors) {
  const allowed = new Set(fields);
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_${field}`);
  for (const field of Object.keys(value)) if (!allowed.has(field)) errors.push(`${prefix}_unexpected_field::${field}`);
}

function shouldInspectNetworkValue(path) {
  const key = String(path || '').split('.').pop().replace(/\[\d+\]$/, '');
  if (ALLOWED_NETWORK_FIELD_NAMES.has(key)) return false;
  if (/(_id|_version|_alias|validator_version|policy_version|fixture_version|provider_slug|tenant_id|conversation_id|adapter_id|transport_id)$/i.test(key)) return false;
  return true;
}

function looksOperationalAddress(value, path) {
  if (typeof value !== 'string') return null;
  if (!shouldInspectNetworkValue(path)) return null;
  if (/(mongodb|postgres|mysql|redis):\/\//i.test(value)) return 'connection_string_value';
  if (/^[a-z0-9.-]+:\d{2,5}$/i.test(value)) return 'host_port_value';
  if (/^(https?|wss?|grpc):\/\//i.test(value)) return 'operational_url_value';
  if (/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|::1)\b/i.test(value)) return 'local_address_value';
  if (/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(value)) return 'ipv4_value';
  if (/(?:^|:)(?:[a-f0-9]{0,4}:){2,}[a-f0-9]{0,4}(?:$|:)/i.test(value)) return 'ipv6_value';
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?::\d{2,5})?$/i.test(value)) return 'domain_value';
  if (/^arn:aws:/i.test(value)) return 'arn_value';
  return null;
}

function findNetworkOperationalMaterial(value) {
  const found = [];
  const seen = new WeakSet();
  function visit(entry, path) {
    if (entry === null) return;
    const type = typeof entry;
    if (type === 'string') {
      const reason = looksOperationalAddress(entry, path);
      if (reason) found.push(`${reason}::${path || 'value'}`);
      return;
    }
    if (type === 'number' || type === 'boolean') {
      if (typeof entry === 'number' && !Number.isFinite(entry)) found.push(`non_finite_number::${path || 'value'}`);
      return;
    }
    if (type === 'bigint') return found.push(`forbidden_bigint::${path || 'value'}`);
    if (type === 'symbol') return found.push(`forbidden_symbol::${path || 'value'}`);
    if (type === 'function') return found.push(`forbidden_function::${path || 'value'}`);
    if (entry === undefined) return found.push(`forbidden_undefined::${path || 'value'}`);
    if (Buffer.isBuffer(entry) || entry instanceof ArrayBuffer || ArrayBuffer.isView(entry)) return found.push(`forbidden_binary::${path || 'value'}`);
    if (Array.isArray(entry)) {
      if (seen.has(entry)) return found.push('forbidden_cycle::array');
      seen.add(entry);
      entry.forEach((item, index) => visit(item, `${path}[${index}]`));
      seen.delete(entry);
      return;
    }
    if (!isPlainObject(entry)) return found.push(`forbidden_non_plain_object::${path || 'value'}`);
    if (seen.has(entry)) return found.push('forbidden_cycle::object');
    seen.add(entry);
    for (const [key, nested] of Object.entries(entry)) {
      const nestedPath = path ? `${path}.${key}` : key;
      if (!ALLOWED_NETWORK_FIELD_NAMES.has(key) && FORBIDDEN_NETWORK_FIELD_PATTERNS.some((pattern) => pattern.test(key))) {
        found.push(`forbidden_network_field::${nestedPath}`);
        continue;
      }
      visit(nested, nestedPath);
    }
    seen.delete(entry);
  }
  visit(value, '');
  return uniqueSorted(found);
}

function validateSecretResolutionContext(context) {
  const fields = Object.freeze([
    'secret_resolution_status',
    'secret_reference_fingerprint',
    'secret_material_present',
    'secret_material_returned',
    'secret_loaded',
    'secret_resolved',
    'simulation',
    'production_blocked'
  ]);
  const errors = [];
  if (!isPlainObject(context)) return { valid: false, errors: ['secret_resolution_context_must_be_object'] };
  exactFields(context, fields, 'secret_resolution_context', errors);
  if (!isNonEmptyString(context.secret_resolution_status)) errors.push('secret_resolution_status_invalid');
  if (!isNonEmptyString(context.secret_reference_fingerprint)) errors.push('secret_reference_fingerprint_invalid');
  for (const field of ['secret_material_present', 'secret_material_returned', 'secret_loaded', 'secret_resolved']) {
    if (context[field] !== false) errors.push(`${field}_must_be_false`);
  }
  if (context.simulation !== true) errors.push('secret_context_simulation_must_be_true');
  if (context.production_blocked !== true) errors.push('secret_context_production_blocked_must_be_true');
  if (context.secret_resolution_status !== 'REFERENCE_VALID_SIMULATION') errors.push('secret_resolution_status_not_simulated');
  try {
    stablePayload(context);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findNetworkOperationalMaterial(context));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateSimulationContext(context) {
  const errors = [];
  if (!isPlainObject(context)) return ['simulation_context_must_be_object'];
  if (context.simulation !== true) errors.push('simulation_context_simulation_must_be_true');
  if (context.production_blocked !== true) errors.push('simulation_context_production_blocked_must_be_true');
  for (const field of ['network_allowed', 'dns_attempted', 'socket_created', 'connection_opened', 'tls_attempted', 'request_sent', 'stream_opened', 'response_received', 'network_used', 'provider_called', 'executed', 'runtime_enabled']) {
    if (context[field] !== false) errors.push(`simulation_context_${field}_must_be_false`);
  }
  if (context.rollout_percentage !== 0) errors.push('simulation_context_rollout_percentage_must_be_zero');
  return errors;
}

function validateDestinationReference(destination) {
  const errors = [];
  if (!isPlainObject(destination)) return { valid: false, errors: ['destination_reference_must_be_object'] };
  exactFields(destination, DESTINATION_REFERENCE_FIELDS, 'destination_reference', errors);
  for (const field of ['destination_ref_id', 'destination_alias', 'provider_slug', 'transport_id', 'protocol', 'environment', 'scope', 'region_class', 'validator_version']) {
    if (!isNonEmptyString(destination[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(destination.destination_ref_version) || destination.destination_ref_version < 1) errors.push('destination_ref_version_invalid');
  if (!ALLOWED_CAPABILITY_PROVIDER_SLUGS.includes(destination.provider_slug)) errors.push(`provider_slug_not_allowed::${destination.provider_slug}`);
  if (!NETWORK_PROTOCOLS.includes(destination.protocol)) errors.push(`protocol_not_allowed::${destination.protocol}`);
  if (!DESTINATION_ENVIRONMENTS.includes(destination.environment)) errors.push(`environment_not_allowed::${destination.environment}`);
  if (!DESTINATION_SCOPES.includes(destination.scope)) errors.push(`scope_not_allowed::${destination.scope}`);
  if (!REGION_CLASSES.includes(destination.region_class)) errors.push(`region_class_not_allowed::${destination.region_class}`);
  for (const field of ['endpoint_present', 'hostname_present', 'ip_present', 'port_present', 'url_present', 'active', 'approved', 'network_enabled', 'runtime_enabled']) {
    if (destination[field] !== false) errors.push(`${field}_must_be_false`);
  }
  for (const field of ['dns_required', 'tls_required', 'streaming_requested']) {
    if (typeof destination[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (destination.simulation !== true) errors.push('simulation_must_be_true');
  if (destination.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (destination.validator_version !== TRANSCRIPTION_NETWORK_PERMISSION_BOUNDARY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(destination);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findNetworkOperationalMaterial(destination));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateNetworkPermissionRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['network_request_must_be_object'] };
  exactFields(request, NETWORK_REQUEST_FIELDS, 'network_request', errors);
  for (const field of ['network_request_id', 'tenant_id', 'conversation_id', 'provider_slug', 'adapter_id', 'transport_id', 'operation', 'protocol', 'data_classification', 'requested_scope', 'requested_purpose', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.network_request_version) || request.network_request_version < 1) errors.push('network_request_version_invalid');
  if (!ALLOWED_CAPABILITY_PROVIDER_SLUGS.includes(request.provider_slug)) errors.push(`provider_slug_not_allowed::${request.provider_slug}`);
  if (!NETWORK_OPERATIONS.includes(request.operation)) errors.push(`operation_not_allowed::${request.operation}`);
  if (!NETWORK_PROTOCOLS.includes(request.protocol)) errors.push(`protocol_not_allowed::${request.protocol}`);
  if (!DATA_CLASSIFICATIONS.includes(request.data_classification)) errors.push(`data_classification_not_allowed::${request.data_classification}`);
  if (!DESTINATION_SCOPES.includes(request.requested_scope)) errors.push(`requested_scope_not_allowed::${request.requested_scope}`);
  if (!ALLOWED_NETWORK_PURPOSES.includes(request.requested_purpose)) errors.push(`requested_purpose_not_allowed::${request.requested_purpose}`);
  if (!isPlainObject(request.metadata)) errors.push('metadata_must_be_object');
  errors.push(...validateSimulationContext(request.simulation_context));
  const destinationValidation = validateDestinationReference(request.destination_reference);
  errors.push(...destinationValidation.errors);
  const policyValidation = validatePolicyContext(request.policy_context);
  errors.push(...policyValidation.errors);
  const secretValidation = validateSecretResolutionContext(request.secret_resolution_context);
  errors.push(...secretValidation.errors);
  if (request.destination_reference?.provider_slug && request.provider_slug !== request.destination_reference.provider_slug) errors.push('provider_mismatch');
  if (request.destination_reference?.transport_id && request.transport_id !== request.destination_reference.transport_id) errors.push('transport_mismatch');
  if (request.destination_reference?.protocol && request.protocol !== request.destination_reference.protocol) errors.push('protocol_mismatch');
  if (request.destination_reference?.scope && request.requested_scope !== request.destination_reference.scope) errors.push('scope_mismatch');
  if (request.policy_context?.tenant_id && request.tenant_id !== request.policy_context.tenant_id) errors.push('tenant_mismatch');
  if (request.metadata?.adapter_id && request.adapter_id !== request.metadata.adapter_id) errors.push('adapter_mismatch');
  if (request.validator_version !== TRANSCRIPTION_NETWORK_PERMISSION_BOUNDARY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findNetworkOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function statusFromErrors(errors) {
  if (errors.some((error) => String(error).includes('tenant_mismatch'))) return 'TENANT_MISMATCH';
  if (errors.some((error) => String(error).includes('provider_mismatch'))) return 'PROVIDER_MISMATCH';
  if (errors.some((error) => String(error).includes('adapter_mismatch'))) return 'ADAPTER_MISMATCH';
  if (errors.some((error) => String(error).includes('transport_mismatch'))) return 'TRANSPORT_MISMATCH';
  if (errors.some((error) => String(error).includes('protocol_mismatch'))) return 'PROTOCOL_MISMATCH';
  if (errors.some((error) => String(error).includes('scope_mismatch'))) return 'SCOPE_MISMATCH';
  if (errors.some((error) => String(error).includes('secret_'))) return 'SECRET_CONTEXT_INVALID';
  if (errors.some((error) => String(error).includes('policy_') || String(error).includes('approval_') || String(error).includes('review_state'))) return 'POLICY_BLOCKED';
  if (errors.length > 0) return 'INVALID_DESTINATION_REFERENCE';
  return 'NETWORK_REVIEWED_SIMULATION';
}

function evaluateNetworkPermission(request = {}) {
  const validation = validateNetworkPermissionRequest(request);
  const policy = evaluateNetworkAccessPolicy(request, request.destination_reference || {});
  const blockers = uniqueSorted([...(validation.errors || []), ...(policy.blocking_reasons || [])]);
  const destination = request.destination_reference || {};
  const ok = validation.valid && policy.reviewed === true;
  const status = ok ? 'NETWORK_REVIEWED_SIMULATION' : statusFromErrors(blockers);
  const result = buildNetworkPermissionResult({
    network_request_id: request.network_request_id,
    provider_slug: request.provider_slug,
    adapter_id: request.adapter_id,
    transport_id: request.transport_id,
    destination_ref_id: destination.destination_ref_id,
    operation: request.operation,
    protocol: request.protocol,
    status,
    decision: status,
    decision_reason: ok ? 'network_reviewed_simulation_only' : blockers[0] || 'network_permission_blocked',
    policy_status: policy.status,
    destination_valid: validation.valid,
    provider_binding_valid: !blockers.includes('provider_mismatch'),
    transport_binding_valid: !blockers.includes('transport_mismatch'),
    tenant_binding_valid: !blockers.includes('tenant_mismatch'),
    secret_context_valid: !blockers.some((error) => String(error).includes('secret_'))
  });
  const audit = buildNetworkPermissionAudit({ request, policy, blockers, decision: status, logical_sequence: 1 });
  return cloneFrozen({
    result,
    audit,
    policy,
    request_fingerprint: validation.valid ? stablePayload(request) : 'invalid_request',
    destination_reference_fingerprint: validation.valid ? stablePayload(destination) : 'invalid_destination',
    errors: blockers,
    ...NETWORK_PERMISSION_SAFE_FLAGS
  });
}

function createTranscriptionNetworkDestinationRegistry() {
  const records = new Map();
  const hashes = new Map();
  const versions = new Map();
  const history = new Map();
  function safe(payload) {
    return cloneFrozen({ ...payload, ...NETWORK_PERMISSION_SAFE_FLAGS });
  }
  function registerDestinationReference(destination, options = {}) {
    const validation = validateDestinationReference(destination);
    if (!validation.valid) return safe({ ok: false, errors: validation.errors });
    let payload;
    try {
      payload = JSON.stringify(stableCanonicalize(destination));
    } catch (error) {
      return safe({ ok: false, errors: [`destination_reference_fingerprint_invalid::${error.message}`] });
    }
    const id = destination.destination_ref_id;
    if (records.has(id)) {
      if (hashes.get(id) === payload) return safe({ ok: false, errors: ['destination_reference_replay_duplicate'] });
      return safe({ ok: false, errors: ['destination_reference_replay_payload_mismatch'] });
    }
    const key = `${destination.provider_slug}:${destination.transport_id}:${destination.scope}`;
    const previousVersion = versions.get(key) || 0;
    if (options.expected_version !== undefined && options.expected_version !== previousVersion) return safe({ ok: false, errors: ['destination_reference_optimistic_conflict'] });
    if (destination.destination_ref_version <= previousVersion) return safe({ ok: false, errors: ['destination_reference_version_downgrade'] });
    const stored = cloneFrozen(destination);
    records.set(id, stored);
    hashes.set(id, payload);
    versions.set(key, destination.destination_ref_version);
    history.set(key, [...(history.get(key) || []), stored].slice(-20));
    return safe({ ok: true, destination_ref_id: id, destination_ref_version: destination.destination_ref_version, fingerprint: payload });
  }
  return Object.freeze({
    registerDestinationReference,
    getDestinationReference(id) {
      return records.has(id) ? cloneFrozen(records.get(id)) : null;
    },
    getHistory(key) {
      return cloneFrozen(history.get(key) || []);
    }
  });
}

module.exports = {
  DATA_CLASSIFICATIONS,
  DESTINATION_ENVIRONMENTS,
  DESTINATION_REFERENCE_FIELDS,
  DESTINATION_SCOPES,
  NETWORK_OPERATIONS,
  NETWORK_PROTOCOLS,
  NETWORK_REQUEST_FIELDS,
  REGION_CLASSES,
  TRANSCRIPTION_NETWORK_PERMISSION_BOUNDARY_VALIDATOR_VERSION,
  createTranscriptionNetworkDestinationRegistry,
  evaluateNetworkPermission,
  findNetworkOperationalMaterial,
  validateDestinationReference,
  validateNetworkPermissionRequest,
  validateSecretResolutionContext
};

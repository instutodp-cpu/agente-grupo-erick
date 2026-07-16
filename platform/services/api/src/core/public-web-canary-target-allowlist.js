'use strict';

const {
  ALLOWED_CONTENT_TYPES,
  ALLOWED_OPERATIONS,
  ALLOWED_SOURCE_TYPES,
  REQUEST_LIMITS,
  buildSafeTransportError,
  deepClone,
  hashValue,
  isNonEmptyString,
  isPlainObject,
  sanitizeObject,
  uniqueSorted,
  validatePublicWebTarget
} = require('./public-web-transport-contract');

function normalizePathPrefix(prefix) {
  if (!isNonEmptyString(prefix)) return null;
  const normalized = prefix.startsWith('/') ? prefix : `/${prefix}`;
  return normalized.replace(/\/{2,}/g, '/');
}

function validateTargetPolicy(policy, options = {}) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['policy_must_be_object'] };
  for (const field of ['target_policy_id', 'environment', 'origin', 'allowed_path_prefixes', 'allowed_operations', 'allowed_source_types', 'allowed_content_types', 'maximum_requests', 'maximum_response_bytes', 'timeout_ms', 'redirects_allowed', 'enabled', 'revoked', 'expires_at', 'approved_by', 'created_at', 'version']) {
    if (!Object.prototype.hasOwnProperty.call(policy, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['target_policy_id', 'environment', 'origin', 'expires_at', 'approved_by', 'created_at']) {
    if (!isNonEmptyString(policy[field])) errors.push(`invalid_${field}`);
  }
  if (!['development', 'staging'].includes(policy.environment)) errors.push('environment_not_allowed');
  if (policy.environment === 'production') errors.push('production_blocked');
  if (!Array.isArray(policy.allowed_path_prefixes) || policy.allowed_path_prefixes.length === 0) errors.push('allowed_path_prefixes_missing');
  if (!Array.isArray(policy.allowed_operations) || policy.allowed_operations.some((operation) => !ALLOWED_OPERATIONS.includes(operation))) errors.push('allowed_operations_invalid');
  if (!Array.isArray(policy.allowed_source_types) || policy.allowed_source_types.some((sourceType) => !ALLOWED_SOURCE_TYPES.includes(sourceType))) errors.push('allowed_source_types_invalid');
  if (!Array.isArray(policy.allowed_content_types) || policy.allowed_content_types.some((type) => !ALLOWED_CONTENT_TYPES.includes(type))) errors.push('allowed_content_types_invalid');
  if (!Number.isInteger(policy.maximum_requests) || policy.maximum_requests < 1 || policy.maximum_requests > 5) errors.push('maximum_requests_out_of_bounds');
  if (!Number.isInteger(policy.maximum_response_bytes) || policy.maximum_response_bytes < 1 || policy.maximum_response_bytes > REQUEST_LIMITS.maximum_response_bytes) errors.push('maximum_response_bytes_out_of_bounds');
  if (!Number.isInteger(policy.timeout_ms) || policy.timeout_ms < 1 || policy.timeout_ms > REQUEST_LIMITS.maximum_timeout_ms) errors.push('timeout_ms_out_of_bounds');
  if (policy.redirects_allowed !== false) errors.push('redirects_must_be_disabled');
  if (policy.enabled !== true) errors.push('policy_must_be_enabled');
  if (policy.revoked !== false) errors.push('policy_revoked');
  if (!Number.isInteger(policy.version) || policy.version < 1) errors.push('invalid_version');
  const dnsResolver = options.dnsResolver;
  const targetValidation = validatePublicWebTarget(policy.origin, {
    transport_kind: 'real_candidate',
    dnsResolver
  });
  if (!targetValidation.valid) errors.push(...targetValidation.errors);
  try {
    const url = new URL(policy.origin);
    if (url.pathname !== '/' || url.search || url.hash) errors.push('origin_must_not_include_path_query_or_hash');
    if (url.protocol !== 'https:') errors.push('https_only');
    if (url.port) errors.push('custom_port_blocked');
  } catch (_error) {
    errors.push('origin_invalid');
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors), target: targetValidation };
}

function createPublicWebCanaryTargetAllowlist(options = {}) {
  const policies = new Map();
  const history = new Map();
  const processed = new Set();
  const maxHistory = Number.isInteger(options.maxHistory) && options.maxHistory > 0 ? Math.min(options.maxHistory, 1000) : 100;
  const dnsResolver = options.dnsResolver;
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date(0).toISOString();

  function appendHistory(policyId, event) {
    const list = history.get(policyId) || [];
    list.push(sanitizeObject(event));
    while (list.length > maxHistory) list.shift();
    history.set(policyId, list);
  }

  function registerTargetPolicy(policy) {
    const validation = validateTargetPolicy(policy, { dnsResolver });
    if (!validation.valid) {
      return { ok: false, error: buildSafeTransportError('PUBLIC_WEB_TARGET_INVALID', 'Target policy blocked.', { blocked_reason: validation.errors[0] }), errors: validation.errors };
    }
    if (policies.has(policy.target_policy_id)) {
      return { ok: false, error: buildSafeTransportError('PUBLIC_WEB_TARGET_INVALID', 'Target policy duplicate.', { blocked_reason: 'duplicate_target_policy' }) };
    }
    policies.set(policy.target_policy_id, deepClone(policy));
    appendHistory(policy.target_policy_id, {
      event_name: 'public_web_canary_target_policy_registered',
      target_policy_id: policy.target_policy_id,
      origin_hash: hashValue(policy.origin),
      applied: true,
      occurred_at: clock()
    });
    return { ok: true, target_policy_id: policy.target_policy_id };
  }

  function getTargetPolicy(policyId) {
    return policies.has(policyId) ? deepClone(policies.get(policyId)) : null;
  }

  function listTargetPolicies(filters = {}) {
    return [...policies.values()]
      .filter((policy) => !filters.environment || policy.environment === filters.environment)
      .map(deepClone)
      .sort((a, b) => a.target_policy_id.localeCompare(b.target_policy_id));
  }

  function isTargetAllowed(request = {}) {
    const policy = [...policies.values()].find((candidate) => candidate.environment === request.environment && candidate.origin === request.target_origin);
    if (!policy) return { allowed: false, reason: 'target_policy_missing' };
    if (policy.revoked || !policy.enabled) return { allowed: false, reason: policy.revoked ? 'target_policy_revoked' : 'target_policy_disabled' };
    if (String(clock()) > policy.expires_at) return { allowed: false, reason: 'target_policy_expired' };
    const path = isNonEmptyString(request.target_path) ? request.target_path : '/';
    const normalizedPath = normalizePathPrefix(path);
    const allowedPrefix = policy.allowed_path_prefixes.some((prefix) => {
      const normalizedPrefix = normalizePathPrefix(prefix);
      return normalizedPrefix && normalizedPath.startsWith(normalizedPrefix);
    });
    if (!allowedPrefix) return { allowed: false, reason: 'target_path_not_allowlisted' };
    if (!policy.allowed_operations.includes(request.operation)) return { allowed: false, reason: 'target_operation_not_allowlisted' };
    if (!policy.allowed_source_types.includes(request.source_type)) return { allowed: false, reason: 'target_source_type_not_allowlisted' };
    return {
      allowed: true,
      reason: null,
      policy: deepClone(policy),
      target_url: `${policy.origin}${normalizedPath}`
    };
  }

  function changePolicy(request = {}, status) {
    if (!isNonEmptyString(request.change_id)) return { ok: false, error: buildSafeTransportError('PUBLIC_WEB_TARGET_INVALID', 'Missing change id.', { blocked_reason: 'change_id_missing' }) };
    if (processed.has(request.change_id)) return { ok: false, error: buildSafeTransportError('PUBLIC_WEB_TARGET_INVALID', 'Replay blocked.', { blocked_reason: 'replay_detected' }) };
    processed.add(request.change_id);
    const policy = policies.get(request.target_policy_id);
    if (!policy) return { ok: false, error: buildSafeTransportError('PUBLIC_WEB_TARGET_INVALID', 'Policy missing.', { blocked_reason: 'target_policy_missing' }) };
    if (status === 'disabled') policy.enabled = false;
    if (status === 'revoked') policy.revoked = true;
    policy.version += 1;
    policies.set(policy.target_policy_id, deepClone(policy));
    appendHistory(policy.target_policy_id, {
      event_name: `public_web_canary_target_policy_${status}`,
      target_policy_id: policy.target_policy_id,
      applied: true,
      occurred_at: clock()
    });
    return { ok: true, policy: deepClone(policy) };
  }

  return Object.freeze({
    registerTargetPolicy,
    getTargetPolicy,
    listTargetPolicies,
    isTargetAllowed,
    disableTargetPolicy: (request) => changePolicy(request, 'disabled'),
    revokeTargetPolicy: (request) => changePolicy(request, 'revoked'),
    getTargetHistory: (policyId) => (history.get(policyId) || []).map(deepClone)
  });
}

module.exports = {
  createPublicWebCanaryTargetAllowlist,
  validateTargetPolicy
};

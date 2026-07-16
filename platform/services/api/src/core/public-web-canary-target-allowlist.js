'use strict';

const { hashValue } = require('./public-web-transport-contract');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

function normalizeCanaryTargetPath(pathValue) {
  if (typeof pathValue !== 'string' || !pathValue.startsWith('/')) return { valid: false, reason: 'invalid_target_path' };
  if (/[\u0000-\u001f\u007f\\?#]/.test(pathValue)) return { valid: false, reason: 'unsafe_target_path' };
  const lower = pathValue.toLowerCase();
  if (lower.includes('%2e') || lower.includes('%2f') || lower.includes('%5c') || lower.includes('%252e') || lower.includes('%252f') || lower.includes('%255c')) {
    return { valid: false, reason: 'encoded_path_traversal_blocked' };
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathValue);
  } catch (_error) {
    return { valid: false, reason: 'invalid_path_encoding' };
  }
  if (decoded.includes('..') || decoded.includes('\\') || decoded.split('/').includes('..')) return { valid: false, reason: 'path_traversal_blocked' };
  const normalized = new URL(`https://canary-path.invalid${pathValue}`).pathname;
  if (!normalized.startsWith('/') || normalized.includes('..')) return { valid: false, reason: 'path_normalization_blocked' };
  return { valid: true, path: normalized };
}

function pathMatchesCanaryPrefix(pathValue, prefixValue) {
  const path = normalizeCanaryTargetPath(pathValue);
  const prefix = normalizeCanaryTargetPath(prefixValue);
  if (!path.valid || !prefix.valid) return false;
  return path.path === prefix.path || path.path.startsWith(`${prefix.path}/`);
}

function validateOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch (_error) {
    return { valid: false, reason: 'invalid_target_origin' };
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    return { valid: false, reason: 'unsafe_target_origin' };
  }
  if (url.hostname === 'localhost' || url.hostname.includes('*') || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.includes(':')) {
    return { valid: false, reason: 'unsafe_target_host' };
  }
  return { valid: true, origin: url.origin };
}

function createPublicWebCanaryTargetAllowlist(options = {}) {
  const policies = new Map();
  const history = new Map();
  const processed = new Set();
  const maxHistory = Number.isInteger(options.maxHistoryPerTarget) ? options.maxHistoryPerTarget : 100;
  const clock = options.clock || (() => new Date().toISOString());

  function nowIso() {
    const value = clock();
    return value instanceof Date ? value.toISOString() : String(value);
  }

  function appendHistory(policyId, event) {
    const events = history.get(policyId) || [];
    events.push(Object.freeze(clone(event)));
    while (events.length > maxHistory) events.shift();
    history.set(policyId, events);
  }

  function validateTargetPolicy(policy) {
    const required = [
      'target_policy_id',
      'environment',
      'origin',
      'allowed_path_prefixes',
      'allowed_operations',
      'allowed_source_types',
      'allowed_content_types',
      'maximum_requests',
      'maximum_response_bytes',
      'timeout_ms',
      'redirects_allowed',
      'enabled',
      'revoked',
      'expires_at',
      'approved_by',
      'created_at',
      'version'
    ];
    if (!policy || required.some((field) => !Object.prototype.hasOwnProperty.call(policy, field))) return { valid: false, reason: 'invalid_target_policy' };
    const origin = validateOrigin(policy.origin);
    if (!origin.valid) return origin;
    if (!['development', 'staging'].includes(policy.environment)) return { valid: false, reason: 'canary_environment_blocked' };
    if (!Array.isArray(policy.allowed_path_prefixes) || policy.allowed_path_prefixes.length === 0) return { valid: false, reason: 'missing_path_prefixes' };
    if (!policy.allowed_path_prefixes.every((prefix) => normalizeCanaryTargetPath(prefix).valid)) return { valid: false, reason: 'invalid_path_prefix' };
    if (!Array.isArray(policy.allowed_operations) || policy.allowed_operations.length === 0) return { valid: false, reason: 'missing_allowed_operations' };
    if (!Array.isArray(policy.allowed_source_types) || policy.allowed_source_types.length === 0) return { valid: false, reason: 'missing_allowed_source_types' };
    if (!Array.isArray(policy.allowed_content_types) || policy.allowed_content_types.length === 0) return { valid: false, reason: 'missing_allowed_content_types' };
    if (policy.redirects_allowed !== false || policy.enabled !== true || policy.revoked !== false) return { valid: false, reason: 'invalid_target_policy_flags' };
    if (!Number.isInteger(policy.maximum_requests) || policy.maximum_requests < 1 || policy.maximum_requests > 5) return { valid: false, reason: 'invalid_target_request_limit' };
    if (!Number.isInteger(policy.maximum_response_bytes) || policy.maximum_response_bytes < 1 || policy.maximum_response_bytes > 2097152) return { valid: false, reason: 'invalid_target_response_limit' };
    if (!Number.isInteger(policy.timeout_ms) || policy.timeout_ms < 1 || policy.timeout_ms > 15000) return { valid: false, reason: 'invalid_target_timeout' };
    const createdAt = parseTimestamp(policy.created_at);
    const expiresAt = parseTimestamp(policy.expires_at);
    const now = parseTimestamp(nowIso());
    if (!createdAt || !expiresAt || !now || createdAt.getTime() >= expiresAt.getTime() || now.getTime() >= expiresAt.getTime()) return { valid: false, reason: 'target_policy_expired' };
    return { valid: true };
  }

  function registerTargetPolicy(policy) {
    const validation = validateTargetPolicy(policy);
    if (!validation.valid) return { ok: false, error_code: 'CANARY_TARGET_POLICY_BLOCKED', blocked_reason: validation.reason };
    if (policies.has(policy.target_policy_id)) return { ok: false, error_code: 'CANARY_REPLAY_DETECTED', blocked_reason: 'duplicate_target_policy' };
    const normalized = Object.freeze(clone(policy));
    policies.set(policy.target_policy_id, normalized);
    appendHistory(policy.target_policy_id, { operation: 'register_target_policy', applied: true, occurred_at: nowIso() });
    return { ok: true, target_policy: clone(normalized) };
  }

  function getTargetPolicy(policyId) {
    return clone(policies.get(policyId)) || null;
  }

  function listTargetPolicies(filters = {}) {
    return [...policies.values()]
      .filter((policy) => !filters.environment || policy.environment === filters.environment)
      .map(clone)
      .sort((a, b) => a.target_policy_id.localeCompare(b.target_policy_id));
  }

  function isTargetAllowed(input = {}) {
    const origin = validateOrigin(input.target_origin);
    if (!origin.valid) return { allowed: false, error_code: 'CANARY_TARGET_NOT_ALLOWLISTED', blocked_reason: origin.reason };
    const path = normalizeCanaryTargetPath(input.target_path || '/');
    if (!path.valid) return { allowed: false, error_code: 'CANARY_TARGET_NOT_ALLOWLISTED', blocked_reason: path.reason };
    const now = parseTimestamp(nowIso());
    const matches = [...policies.values()].filter((policy) => (
      policy.environment === input.environment &&
      policy.origin === origin.origin &&
      policy.enabled === true &&
      policy.revoked === false &&
      parseTimestamp(policy.expires_at).getTime() > now.getTime() &&
      policy.allowed_operations.includes(input.operation) &&
      policy.allowed_source_types.includes(input.source_type) &&
      policy.allowed_path_prefixes.some((prefix) => pathMatchesCanaryPrefix(path.path, prefix))
    ));
    if (matches.length === 0) {
      return { allowed: false, error_code: 'CANARY_TARGET_NOT_ALLOWLISTED', blocked_reason: 'target_not_allowlisted' };
    }
    const policy = clone(matches[0]);
    return {
      allowed: true,
      target_policy: policy,
      target_policy_id: policy.target_policy_id,
      target_origin_hash: hashValue(origin.origin),
      target_path: path.path,
      target_url: `${origin.origin}${path.path}`
    };
  }

  function changePolicy(request, next) {
    const changeId = request && request.change_id;
    if (typeof changeId !== 'string' || changeId.trim() === '' || processed.has(changeId)) return { ok: false, error_code: 'CANARY_REPLAY_DETECTED', blocked_reason: 'target_policy_replay' };
    processed.add(changeId);
    const current = policies.get(request.target_policy_id);
    if (!current) return { ok: false, error_code: 'CANARY_TARGET_NOT_ALLOWLISTED', blocked_reason: 'target_policy_not_found' };
    const updated = Object.freeze({ ...clone(current), ...next, version: current.version + 1 });
    policies.set(current.target_policy_id, updated);
    appendHistory(current.target_policy_id, { operation: request.operation, applied: true, occurred_at: nowIso() });
    return { ok: true, target_policy: clone(updated) };
  }

  return Object.freeze({
    registerTargetPolicy,
    getTargetPolicy,
    isTargetAllowed,
    disableTargetPolicy(request) { return changePolicy({ ...request, operation: 'disable_target_policy' }, { enabled: false }); },
    revokeTargetPolicy(request) { return changePolicy({ ...request, operation: 'revoke_target_policy' }, { revoked: true, enabled: false }); },
    listTargetPolicies,
    getTargetHistory(policyId) { return (history.get(policyId) || []).map(clone); }
  });
}

module.exports = {
  createPublicWebCanaryTargetAllowlist,
  normalizeCanaryTargetPath,
  pathMatchesCanaryPrefix,
  validateOrigin
};

'use strict';

const {
  MAX_DURATION_MS,
  MAX_SIZE_BYTES,
  buildSafeTranscriptionError,
  deepClone,
  findTranscriptionForbiddenFields,
  sanitizeTranscriptionBlockedReason,
  sanitizeTranscriptionData
} = require('./transcription-contract');
const {
  isNonEmptyString,
  isPlainObject,
  uniqueSorted
} = require('./read-only-adapter-contract');

const ALLOWED_BUDGET_ENVIRONMENTS = Object.freeze(['local_test', 'non_production']);
const MAX_MONTHLY_BUDGET_MINOR = 1000000;
const MAX_DAILY_BUDGET_MINOR = 100000;
const MAX_COST_PER_REQUEST_MINOR = 10000;
const MAX_DAILY_REQUEST_LIMIT = 100;
const MAX_MONTHLY_REQUEST_LIMIT = 1000;

const REQUIRED_BUDGET_FIELDS = Object.freeze([
  'budget_policy_id',
  'tenant_id',
  'workspace_type',
  'currency',
  'monthly_budget_minor',
  'daily_budget_minor',
  'max_cost_per_request_minor',
  'max_duration_ms',
  'max_size_bytes',
  'daily_request_limit',
  'monthly_request_limit',
  'concurrent_request_limit',
  'rollout_percentage',
  'environment',
  'simulated'
]);

const REGISTRY_STORAGE = new WeakMap();

function isUnlimited(value) {
  return value === Infinity || value === null || value === undefined ||
    (typeof value === 'string' && /^(unlimited|infinite|none)$/i.test(value));
}

function validateIntegerRange(policy, field, max, errors) {
  const value = policy[field];
  if (isUnlimited(value)) {
    errors.push(`${field}_unlimited_blocked`);
    return;
  }
  if (!Number.isInteger(value)) {
    errors.push(`${field}_must_be_integer`);
    return;
  }
  if (value < 0) errors.push(`${field}_negative`);
  if (value > max) errors.push(`${field}_exceeds_limit`);
}

function validateTranscriptionBudgetPolicy(policy, context = {}) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['budget_policy_missing'] };
  for (const field of REQUIRED_BUDGET_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(policy, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['budget_policy_id', 'tenant_id', 'workspace_type', 'currency', 'environment']) {
    if (!isNonEmptyString(policy[field])) errors.push(`invalid_${field}`);
  }
  if (policy.currency !== 'BRL') errors.push('currency_must_be_brl');
  if (!ALLOWED_BUDGET_ENVIRONMENTS.includes(policy.environment)) errors.push('budget_environment_not_allowed');
  if (policy.environment === 'production' || context.environment === 'production') errors.push('production_blocked');
  validateIntegerRange(policy, 'monthly_budget_minor', MAX_MONTHLY_BUDGET_MINOR, errors);
  validateIntegerRange(policy, 'daily_budget_minor', MAX_DAILY_BUDGET_MINOR, errors);
  validateIntegerRange(policy, 'max_cost_per_request_minor', MAX_COST_PER_REQUEST_MINOR, errors);
  validateIntegerRange(policy, 'max_duration_ms', MAX_DURATION_MS, errors);
  validateIntegerRange(policy, 'max_size_bytes', MAX_SIZE_BYTES, errors);
  validateIntegerRange(policy, 'daily_request_limit', MAX_DAILY_REQUEST_LIMIT, errors);
  validateIntegerRange(policy, 'monthly_request_limit', MAX_MONTHLY_REQUEST_LIMIT, errors);
  if (policy.concurrent_request_limit !== 1) errors.push('concurrent_request_limit_must_be_one');
  if (policy.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (policy.billing_enabled === true || policy.real_cost_lookup_enabled === true || policy.counter_storage_enabled === true) {
    errors.push('budget_runtime_side_effects_blocked');
  }
  if (context.tenant_id && policy.tenant_id !== context.tenant_id) errors.push('budget_tenant_mismatch');
  if (context.workspace_type && policy.workspace_type !== context.workspace_type) errors.push('budget_workspace_mismatch');
  if (policy.simulated !== true) errors.push('simulated_must_be_true');
  errors.push(...findTranscriptionForbiddenFields(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function evaluateTranscriptionBudgetPolicy(policy, context = {}) {
  const validation = validateTranscriptionBudgetPolicy(policy, context);
  const blockingReasons = validation.valid ? [] : validation.errors;
  return sanitizeTranscriptionData({
    budget_policy_id: policy && policy.budget_policy_id ? policy.budget_policy_id : 'budget_policy_not_available',
    tenant_id: policy && policy.tenant_id ? policy.tenant_id : context.tenant_id || 'tenant_not_available',
    status: validation.valid ? 'transcription_budget_policy_allowed' : 'transcription_budget_policy_blocked',
    allowed: validation.valid,
    rollout_percentage: Number.isInteger(policy && policy.rollout_percentage) ? policy.rollout_percentage : null,
    concurrent_request_limit: Number.isInteger(policy && policy.concurrent_request_limit) ? policy.concurrent_request_limit : null,
    environment: policy && policy.environment ? policy.environment : 'environment_not_available',
    blocking_reasons: blockingReasons,
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    audit_event_candidate: buildTranscriptionBudgetAuditEvent({
      policy,
      blocked_reason: blockingReasons[0] || null,
      occurred_at: context.now
    }),
    error: validation.valid ? null : buildSafeTranscriptionError('INVALID_ADAPTER_REQUEST', blockingReasons[0] || 'budget_policy_blocked')
  });
}

function buildTranscriptionBudgetAuditEvent(input = {}) {
  const policy = input.policy || {};
  return sanitizeTranscriptionData({
    event_name: 'transcription_budget_policy_evaluated',
    budget_policy_id: policy.budget_policy_id || 'budget_policy_not_available',
    tenant_id: policy.tenant_id || 'tenant_not_available',
    workspace_type: policy.workspace_type || 'workspace_not_available',
    currency: policy.currency || 'currency_not_available',
    rollout_percentage: Number.isInteger(policy.rollout_percentage) ? policy.rollout_percentage : null,
    concurrent_request_limit: Number.isInteger(policy.concurrent_request_limit) ? policy.concurrent_request_limit : null,
    environment: policy.environment || 'environment_not_available',
    blocked_reason: sanitizeTranscriptionBlockedReason(input.blocked_reason) || null,
    occurred_at: input.occurred_at || new Date(0).toISOString(),
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false
  });
}

function createTranscriptionBudgetPolicyRegistry() {
  const policies = new Map();
  function registerPolicy(policy, context = {}) {
    const validation = validateTranscriptionBudgetPolicy(policy, context);
    if (!validation.valid) return { ok: false, blocked_reason: validation.errors[0], errors: validation.errors, simulated: true, executed: false, real_provider_called: false };
    const current = policies.get(policy.budget_policy_id);
    if (current && current.tenant_id !== policy.tenant_id) return { ok: false, blocked_reason: 'budget_tenant_mutation_blocked', simulated: true, executed: false, real_provider_called: false };
    policies.set(policy.budget_policy_id, sanitizeTranscriptionData(policy));
    return Object.freeze({ ok: true, budget_policy_id: policy.budget_policy_id, simulated: true, executed: false, real_provider_called: false });
  }
  function getPolicy(policyId) {
    return policies.has(policyId) ? deepClone(policies.get(policyId)) : null;
  }
  const registry = { registerPolicy, getPolicy };
  REGISTRY_STORAGE.set(registry, { policies });
  return Object.freeze(registry);
}

module.exports = {
  ALLOWED_BUDGET_ENVIRONMENTS,
  buildTranscriptionBudgetAuditEvent,
  createTranscriptionBudgetPolicyRegistry,
  evaluateTranscriptionBudgetPolicy,
  validateTranscriptionBudgetPolicy
};

'use strict';

const {
  buildSafeTrialError,
  hashTrialEvidence,
  hashTrialPlan,
  sanitizeTrialData,
  validateTrialPlan
} = require('../core/public-web-canary-trial-contract');
const {
  ELIGIBLE_LIFECYCLE_STATES
} = require('../core/public-web-canary-session-registry');
const {
  hashCanaryEvidence
} = require('../core/public-web-canary-session-contract');

function isFunction(value) {
  return typeof value === 'function';
}

function createPublicWebCanaryTrialPreflight(options = {}) {
  return Object.freeze({
    runTrialPreflight(plan, context = {}) {
      return runTrialPreflight(plan, { ...options, ...context });
    }
  });
}

function readRegistry(registry, method, id) {
  return registry && isFunction(registry[method]) ? registry[method](id) : null;
}

function listIncludes(authority, value, payload) {
  if (!authority) return false;
  if (Array.isArray(authority)) return authority.includes(value);
  if (typeof authority.has === 'function') return authority.has(value);
  if (typeof authority.includes === 'function') return authority.includes(value);
  if (typeof authority.isAllowed === 'function') return authority.isAllowed(value, payload) === true;
  if (typeof authority.isTenantAllowed === 'function') return authority.isTenantAllowed(value, payload) === true;
  if (typeof authority.isWorkspaceAllowed === 'function') return authority.isWorkspaceAllowed(value, payload) === true;
  if (typeof authority.isUserAllowed === 'function') return authority.isUserAllowed(value, payload) === true;
  return false;
}

function getSecretReferenceId(configuration, plan) {
  if (plan.secret_reference_id) return plan.secret_reference_id;
  if (configuration && configuration.secret_reference_id) return configuration.secret_reference_id;
  const descriptors = configuration && Array.isArray(configuration.secret_reference_descriptors)
    ? configuration.secret_reference_descriptors
    : [];
  return descriptors[0] && descriptors[0].reference_id;
}

function validateTargetPolicy(plan, target) {
  const errors = [];
  const policy = target && target.target_policy;
  if (!target || target.allowed !== true) errors.push(target && target.blocked_reason || 'target_policy_missing');
  if (!policy) errors.push('target_policy_missing');
  if (target && target.target_policy_id !== plan.target_policy_id) errors.push('target_policy_id_mismatch');
  if (policy && policy.target_policy_id !== plan.target_policy_id) errors.push('target_policy_id_mismatch');
  if (policy && policy.enabled !== true) errors.push('target_policy_disabled');
  if (policy && policy.revoked === true) errors.push('target_policy_revoked');
  if (policy && policy.redirects_allowed !== false) errors.push('redirects_not_allowed');
  if (policy && plan.timeout_ms > policy.timeout_ms) errors.push('timeout_exceeds_policy');
  if (policy && plan.maximum_response_bytes > policy.maximum_response_bytes) errors.push('response_limit_exceeds_policy');
  if (policy && plan.maximum_requests > policy.maximum_requests) errors.push('request_limit_exceeds_policy');
  const allowedTypes = policy && Array.isArray(policy.allowed_content_types) ? policy.allowed_content_types : [];
  if (!Array.isArray(plan.requested_content_types) || plan.requested_content_types.some((type) => !allowedTypes.includes(type))) {
    errors.push('content_type_outside_policy');
  }
  return errors;
}

function runTrialPreflight(plan, context = {}) {
  const blocking = [];
  const validation = validateTrialPlan(plan);
  if (!validation.valid) blocking.push(...validation.errors);
  if (plan.environment === 'production') blocking.push('production_blocked');
  if (!isFunction(context.featureFlagResolver) || context.featureFlagResolver(plan.feature_flag_key) !== true) blocking.push('feature_flag_off');
  if (!isFunction(context.killSwitchResolver) || context.killSwitchResolver(plan.kill_switch_key) !== false) blocking.push('kill_switch_active');

  const adapter = readRegistry(context.adapterRegistry, 'getAdapter', plan.adapter_id);
  const metadata = adapter && adapter.metadata;
  if (!metadata || metadata.adapter_id !== plan.adapter_id || metadata.provider_id !== plan.provider_id || metadata.readiness_candidate_id !== plan.readiness_candidate_id) {
    blocking.push('adapter_binding_invalid');
  }

  const connector = readRegistry(context.lifecycleRegistry, 'getConnector', plan.connector_id);
  if (!connector || connector.connector_id !== plan.connector_id || connector.provider_id !== plan.provider_id || connector.adapter_id !== plan.adapter_id) {
    blocking.push('lifecycle_binding_invalid');
  } else {
    if (!ELIGIBLE_LIFECYCLE_STATES.includes(connector.lifecycle_state)) blocking.push('lifecycle_state_invalid');
    if (!Number.isInteger(connector.lifecycle_version)) blocking.push('lifecycle_version_invalid');
    if (plan.lifecycle_version && connector.lifecycle_version !== plan.lifecycle_version) blocking.push('lifecycle_version_mismatch');
  }

  const configuration = readRegistry(context.configurationRegistry, 'getConfiguration', plan.configuration_id);
  if (!configuration || configuration.configuration_id !== plan.configuration_id || configuration.provider_id !== plan.provider_id || configuration.adapter_id !== plan.adapter_id) {
    blocking.push('configuration_binding_invalid');
  } else {
    if (configuration.configuration_status !== 'structurally_ready') blocking.push('configuration_not_structurally_ready');
    if (!Number.isInteger(configuration.configuration_version)) blocking.push('configuration_version_invalid');
    if (plan.configuration_version && configuration.configuration_version !== plan.configuration_version) blocking.push('configuration_version_mismatch');
    if (configuration.readiness_candidate_id && configuration.readiness_candidate_id !== plan.readiness_candidate_id) blocking.push('configuration_readiness_candidate_mismatch');
    if (configuration.tenant_id && configuration.tenant_id !== plan.tenant_id) blocking.push('configuration_tenant_mismatch');
    if (configuration.workspace_type && configuration.workspace_type !== plan.workspace_type) blocking.push('configuration_workspace_mismatch');
  }

  const readinessEvidenceId = context.readiness_evidence_id || (context.readinessResult ? hashCanaryEvidence(context.readinessResult) : null);
  if (!context.readinessResult || context.readinessResult.ready !== true) blocking.push('readiness_missing');
  if (!readinessEvidenceId) blocking.push('readiness_evidence_missing');
  if (plan.readiness_evidence_id && readinessEvidenceId && plan.readiness_evidence_id !== readinessEvidenceId) blocking.push('readiness_hash_mismatch');

  const secretReferenceId = getSecretReferenceId(configuration, plan);
  const secretReference = readRegistry(context.secretReferenceRegistry, 'getSecretReference', secretReferenceId);
  if (!secretReferenceId || !secretReference) {
    blocking.push('secret_reference_missing');
  } else {
    if (secretReference.provider_id !== plan.provider_id) blocking.push('secret_reference_provider_mismatch');
    if (secretReference.tenant_id !== plan.tenant_id) blocking.push('secret_reference_tenant_mismatch');
    if (secretReference.workspace_type !== plan.workspace_type) blocking.push('secret_reference_workspace_mismatch');
    if (secretReference.revoked === true || secretReference.disabled === true || ['revoked', 'disabled', 'expired', 'rotation_required', 'reference_pending'].includes(secretReference.status)) {
      blocking.push('secret_reference_not_resolvable');
    }
    if (!context.secretResolver || !isFunction(context.secretResolver.canResolve) || context.secretResolver.canResolve(secretReference) !== true) {
      blocking.push('secret_resolver_blocked');
    }
  }

  let target = null;
  if (!context.targetAllowlist || !isFunction(context.targetAllowlist.isTargetAllowed)) {
    blocking.push('target_policy_missing');
  } else {
    target = context.targetAllowlist.isTargetAllowed({
      environment: plan.environment,
      target_origin: plan.target_origin,
      target_path: plan.target_path,
      operation: plan.operation,
      source_type: plan.source_type
    });
    blocking.push(...validateTargetPolicy(plan, target));
  }

  if (!listIncludes(context.tenantAllowlist, plan.tenant_id, plan)) blocking.push('tenant_not_allowlisted');
  if (!listIncludes(context.workspaceAllowlist, plan.workspace_type, plan)) blocking.push('workspace_not_allowlisted');
  if (!listIncludes(context.userAllowlist, plan.user_id, plan)) blocking.push('user_not_allowlisted');
  const requestPolicy = context.operatorPolicy && isFunction(context.operatorPolicy.canRequest)
    ? context.operatorPolicy.canRequest({ operator_id: plan.operator_id, operator_role: plan.operator_role })
    : null;
  if (!requestPolicy || requestPolicy.allowed !== true) blocking.push('operator_not_authorized');
  const approvePolicy = context.operatorPolicy && isFunction(context.operatorPolicy.canApprove)
    ? context.operatorPolicy.canApprove({ approved_by: plan.approver_id, approver_role: plan.approver_role }, { operator_id: plan.operator_id })
    : null;
  if (!approvePolicy || approvePolicy.allowed !== true) blocking.push('approver_not_authorized');
  if (!context.rateLimitBudget || !isFunction(context.rateLimitBudget.check) || context.rateLimitBudget.check(plan).allowed !== true) blocking.push('rate_budget_blocked');
  if (!context.costBudget || !isFunction(context.costBudget.check) || context.costBudget.check(plan).allowed !== true) blocking.push('cost_budget_blocked');
  if (!context.auditSink || !isFunction(context.auditSink.append)) blocking.push('audit_sink_missing');
  if (!context.dnsResolver || !isFunction(context.dnsResolver.resolve)) blocking.push('dns_resolver_missing');
  if (!context.nodeHttpsClient && !context.canaryRunner) blocking.push('https_client_or_runner_missing');
  if (plan.maximum_requests !== 1) blocking.push('maximum_requests_must_be_one');
  const bindingSnapshot = sanitizeTrialData({
    lifecycle_version: connector && connector.lifecycle_version,
    configuration_version: configuration && configuration.configuration_version,
    readiness_evidence_id: readinessEvidenceId,
    secret_reference_id: secretReferenceId,
    target_policy_id: target && target.target_policy_id,
    target_policy_version: target && target.target_policy && target.target_policy.version
  });
  const result = sanitizeTrialData({
    status: blocking.length === 0 ? 'preflight_passed' : 'preflight_blocked',
    passed: blocking.length === 0,
    blocking_reasons: [...new Set(blocking)].sort(),
    warnings: [],
    binding_snapshot: bindingSnapshot,
    plan_hash: plan.plan_hash || hashTrialPlan(plan),
    evidence_hash: hashTrialEvidence({ plan_hash: plan.plan_hash || hashTrialPlan(plan), blocking, bindingSnapshot }),
    checked_at: context.now || (isFunction(context.clock) ? context.clock() : new Date(0).toISOString()),
    executed: false,
    real_provider_called: false,
    error: blocking.length === 0 ? null : buildSafeTrialError('TRIAL_PREFLIGHT_BLOCKED', blocking[0])
  });
  if (context.auditSink && isFunction(context.auditSink.append)) context.auditSink.append({ event_name: 'public_web_canary_trial_preflight', ...result, trial_id: plan.trial_id });
  return result;
}

module.exports = {
  createPublicWebCanaryTrialPreflight,
  runTrialPreflight
};

'use strict';

const {
  buildSafeTrialError,
  hashTrialEvidence,
  hashTrialPlan,
  sanitizeTrialData,
  validateTrialPlan
} = require('../core/public-web-canary-trial-contract');

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

function runTrialPreflight(plan, context = {}) {
  const blocking = [];
  const validation = validateTrialPlan(plan);
  if (!validation.valid) blocking.push(...validation.errors);
  if (plan.environment === 'production') blocking.push('production_blocked');
  if (!isFunction(context.featureFlagResolver) || context.featureFlagResolver(plan.feature_flag_key) !== true) blocking.push('feature_flag_off');
  if (!isFunction(context.killSwitchResolver) || context.killSwitchResolver(plan.kill_switch_key) !== false) blocking.push('kill_switch_active');
  if (!context.adapterRegistry || !isFunction(context.adapterRegistry.getAdapter) || !context.adapterRegistry.getAdapter(plan.adapter_id)) blocking.push('adapter_missing');
  if (!context.lifecycleRegistry || !isFunction(context.lifecycleRegistry.getConnector) || !context.lifecycleRegistry.getConnector(plan.connector_id)) blocking.push('lifecycle_missing');
  if (!context.configurationRegistry || !isFunction(context.configurationRegistry.getConfiguration) || !context.configurationRegistry.getConfiguration(plan.configuration_id)) blocking.push('configuration_missing');
  if (!context.secretReferenceRegistry || !context.secretResolver) blocking.push('secret_reference_missing');
  if (!context.readinessResult || context.readinessResult.ready !== true) blocking.push('readiness_missing');
  if (!context.targetAllowlist || !isFunction(context.targetAllowlist.isTargetAllowed) || !context.targetAllowlist.isTargetAllowed(plan.target_origin, plan.target_path, plan).allowed) blocking.push('target_policy_missing');
  if (!context.tenantAllowlist || !context.tenantAllowlist.includes(plan.tenant_id)) blocking.push('tenant_not_allowlisted');
  if (!context.workspaceAllowlist || !context.workspaceAllowlist.includes(plan.workspace_type)) blocking.push('workspace_not_allowlisted');
  if (!context.userAllowlist || !context.userAllowlist.includes(plan.user_id)) blocking.push('user_not_allowlisted');
  if (!context.operatorPolicy || !isFunction(context.operatorPolicy.canRequest) || context.operatorPolicy.canRequest({ actor_role: plan.operator_role, actor_id: plan.operator_id }) !== true) blocking.push('operator_not_authorized');
  if (!context.operatorPolicy || !isFunction(context.operatorPolicy.canApprove) || context.operatorPolicy.canApprove({ actor_role: plan.approver_role, actor_id: plan.approver_id }) !== true) blocking.push('approver_not_authorized');
  if (!context.rateLimitBudget || !isFunction(context.rateLimitBudget.check) || context.rateLimitBudget.check(plan).allowed !== true) blocking.push('rate_budget_blocked');
  if (!context.costBudget || !isFunction(context.costBudget.check) || context.costBudget.check(plan).allowed !== true) blocking.push('cost_budget_blocked');
  if (!context.auditSink || !isFunction(context.auditSink.append)) blocking.push('audit_sink_missing');
  if (!context.dnsResolver || !isFunction(context.dnsResolver.resolve)) blocking.push('dns_resolver_missing');
  if (!context.nodeHttpsClient && !context.canaryRunner) blocking.push('https_client_or_runner_missing');
  if (plan.maximum_requests !== 1) blocking.push('maximum_requests_must_be_one');
  const result = sanitizeTrialData({
    status: blocking.length === 0 ? 'preflight_passed' : 'preflight_blocked',
    passed: blocking.length === 0,
    blocking_reasons: [...new Set(blocking)].sort(),
    warnings: [],
    plan_hash: plan.plan_hash || hashTrialPlan(plan),
    evidence_hash: hashTrialEvidence({ plan_hash: plan.plan_hash || hashTrialPlan(plan), blocking }),
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

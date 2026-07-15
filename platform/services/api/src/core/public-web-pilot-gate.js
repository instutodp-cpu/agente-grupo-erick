'use strict';

const {
  ADAPTER_ID,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID,
  REQUEST_LIMITS,
  buildPublicWebAuditEvent,
  buildSafeTransportError,
  hashValue,
  isBlockedOperation,
  isNonEmptyString,
  isPlainObject,
  sanitizeObject,
  uniqueSorted,
  validatePublicWebTarget
} = require('./public-web-transport-contract');

const ELIGIBLE_LIFECYCLE_STATES = [
  'readiness_passed',
  'configuration_pending',
  'feature_flag_off',
  'runtime_disabled'
];

const PILOT_ENVIRONMENTS = ['development', 'staging', 'local_test'];
const MAX_PILOT_ROLLOUT_PERCENTAGE = 1;
const MAX_PILOT_TENANTS = 1;
const MAX_PILOT_WORKSPACES = 1;
const MAX_PILOT_USERS = 1;

function getFromRegistry(registry, method, id) {
  return registry && typeof registry[method] === 'function' ? registry[method](id) : null;
}

function validateReadinessBinding(readiness, request) {
  const errors = [];
  if (!isPlainObject(readiness)) return ['readiness_missing'];
  if (readiness.candidate_id !== READINESS_CANDIDATE_ID) errors.push('readiness_candidate_id_mismatch');
  if (readiness.provider_id !== PROVIDER_ID) errors.push('readiness_provider_id_mismatch');
  if (readiness.adapter_id !== ADAPTER_ID) errors.push('readiness_adapter_id_mismatch');
  if (request && readiness.candidate_id !== request.readiness_candidate_id) errors.push('request_readiness_candidate_id_mismatch');
  if (readiness.status !== 'ready_for_real_read_only_pr') errors.push('readiness_status_not_ready');
  if (readiness.verdict !== 'allow_future_read_only_pr') errors.push('readiness_verdict_not_allow');
  if (readiness.ready !== true) errors.push('readiness_ready_not_true');
  if (readiness.simulated !== true) errors.push('readiness_simulated_not_true');
  if (readiness.executed !== false) errors.push('readiness_executed_not_false');
  if (readiness.real_provider_called !== false) errors.push('readiness_real_provider_called_not_false');
  if (readiness.can_trigger_real_execution !== false) errors.push('readiness_can_trigger_real_execution_not_false');
  if (!Array.isArray(readiness.blocking_requirements) || readiness.blocking_requirements.length !== 0) errors.push('readiness_blocking_requirements_present');
  if (!Array.isArray(readiness.blocking_reasons) || readiness.blocking_reasons.length !== 0) errors.push('readiness_blocking_reasons_present');
  return uniqueSorted(errors);
}

function validateConfigurationBinding(configuration, request) {
  const errors = [];
  if (!configuration) return ['configuration_missing'];
  if (configuration.configuration_id !== CONFIGURATION_ID) errors.push('configuration_id_mismatch');
  if (configuration.connector_id !== CONNECTOR_ID) errors.push('configuration_connector_id_mismatch');
  if (configuration.provider_id !== PROVIDER_ID) errors.push('configuration_provider_id_mismatch');
  if (configuration.adapter_id !== ADAPTER_ID) errors.push('configuration_adapter_id_mismatch');
  if (configuration.readiness_candidate_id !== READINESS_CANDIDATE_ID) errors.push('configuration_readiness_candidate_id_mismatch');
  if (request && configuration.workspace_type !== request.workspace_type) errors.push('configuration_workspace_mismatch');
  if (request && configuration.tenant_id !== request.tenant_id) errors.push('configuration_tenant_mismatch');
  if (configuration.configuration_status !== 'structurally_ready') errors.push('configuration_not_structurally_ready');
  if (configuration.readiness_status !== 'configuration_structurally_ready') errors.push('configuration_readiness_not_ready');
  if (configuration.feature_flag_default !== false) errors.push('configuration_feature_flag_default_must_be_false');
  if (configuration.disabled === true) errors.push('configuration_disabled');
  if (configuration.deprecated === true) errors.push('configuration_deprecated');
  return uniqueSorted(errors);
}

function validateLifecycleBinding(connector, request) {
  const errors = [];
  if (!connector) return ['lifecycle_connector_missing'];
  if (connector.connector_id !== CONNECTOR_ID) errors.push('lifecycle_connector_id_mismatch');
  if (connector.provider_id !== PROVIDER_ID) errors.push('lifecycle_provider_id_mismatch');
  if (connector.adapter_id !== ADAPTER_ID) errors.push('lifecycle_adapter_id_mismatch');
  if (connector.readiness_candidate_id !== READINESS_CANDIDATE_ID) errors.push('lifecycle_readiness_candidate_id_mismatch');
  if (!ELIGIBLE_LIFECYCLE_STATES.includes(connector.lifecycle_state)) errors.push(`lifecycle_state_not_eligible::${connector.lifecycle_state}`);
  if (connector.real_provider_enabled !== false) errors.push('lifecycle_real_provider_enabled_must_be_false');
  if (connector.feature_flag_default !== false) errors.push('lifecycle_feature_flag_default_must_be_false');
  if (!isNonEmptyString(connector.kill_switch_key)) errors.push('lifecycle_kill_switch_missing');
  if (request && Array.isArray(connector.workspace_types) && !connector.workspace_types.includes(request.workspace_type)) errors.push('lifecycle_workspace_mismatch');
  if (request && Array.isArray(connector.operations) && !connector.operations.includes(request.operation)) errors.push('lifecycle_operation_mismatch');
  return uniqueSorted(errors);
}

function validateAdapterBinding(adapter) {
  const errors = [];
  if (!adapter || !adapter.metadata) return ['adapter_missing'];
  if (adapter.metadata.adapter_id !== ADAPTER_ID) errors.push('adapter_id_mismatch');
  if (adapter.metadata.provider_id !== PROVIDER_ID) errors.push('adapter_provider_id_mismatch');
  if (adapter.metadata.readiness_candidate_id !== READINESS_CANDIDATE_ID) errors.push('adapter_readiness_candidate_id_mismatch');
  if (adapter.metadata.adapter_kind !== 'real_read_only_candidate') errors.push('adapter_kind_not_allowed');
  if (adapter.metadata.enabled !== false) errors.push('adapter_candidate_must_remain_disabled');
  return uniqueSorted(errors);
}

function validateSecretBinding(configuration, context) {
  const errors = [];
  const descriptors = configuration && Array.isArray(configuration.secret_reference_descriptors)
    ? configuration.secret_reference_descriptors
    : [];
  if (descriptors.length === 0) return ['secret_reference_descriptor_missing'];
  const registry = context.secretReferenceRegistry;
  const resolver = context.secretResolver;
  for (const descriptor of descriptors) {
    const reference = getFromRegistry(registry, 'getSecretReference', descriptor.reference_id);
    if (!reference) {
      errors.push('secret_reference_missing');
      continue;
    }
    if (reference.provider_id !== PROVIDER_ID) errors.push('secret_reference_provider_mismatch');
    if (reference.tenant_id !== configuration.tenant_id) errors.push('secret_reference_tenant_mismatch');
    if (reference.workspace_type !== configuration.workspace_type) errors.push('secret_reference_workspace_mismatch');
    if (reference.environment !== configuration.environment) errors.push('secret_reference_environment_mismatch');
    if (reference.synthetic !== true) errors.push('secret_reference_must_be_synthetic');
    if (!resolver || typeof resolver.canResolve !== 'function' || resolver.canResolve(reference) !== true) {
      errors.push('secret_reference_not_resolvable');
    }
  }
  return uniqueSorted(errors);
}

function validateAllowlists(request, context) {
  const errors = [];
  const tenants = Array.isArray(context.allowed_tenants) ? context.allowed_tenants : [];
  const workspaces = Array.isArray(context.allowed_workspaces) ? context.allowed_workspaces : [];
  const users = Array.isArray(context.allowed_users) ? context.allowed_users : [];
  if (tenants.length !== 1 || tenants.length > MAX_PILOT_TENANTS) errors.push('pilot_tenant_allowlist_invalid');
  if (workspaces.length !== 1 || workspaces.length > MAX_PILOT_WORKSPACES) errors.push('pilot_workspace_allowlist_invalid');
  if (users.length !== 1 || users.length > MAX_PILOT_USERS) errors.push('pilot_user_allowlist_invalid');
  if (!tenants.includes(request.tenant_id)) errors.push('tenant_not_allowlisted');
  if (!workspaces.includes(request.workspace_type)) errors.push('workspace_not_allowlisted');
  if (!users.includes(request.user_id)) errors.push('user_not_allowlisted');
  return uniqueSorted(errors);
}

function createPublicWebPilotBudget(options = {}) {
  const hourlyLimit = Number.isInteger(options.hourlyLimit) ? options.hourlyLimit : 5;
  const dailyLimit = Number.isInteger(options.dailyLimit) ? options.dailyLimit : 20;
  const maxConcurrency = Number.isInteger(options.maxConcurrency) ? options.maxConcurrency : 1;
  const state = {
    hourly: 0,
    daily: 0,
    inFlight: 0,
    providerErrors: 0,
    retries: 0
  };
  return Object.freeze({
    check() {
      if (state.inFlight >= maxConcurrency) return { allowed: false, reason: 'concurrency_limit_exceeded' };
      if (state.hourly >= hourlyLimit) return { allowed: false, reason: 'hourly_rate_limit_exceeded' };
      if (state.daily >= dailyLimit) return { allowed: false, reason: 'daily_rate_limit_exceeded' };
      return { allowed: true, reason: null };
    },
    reserve() {
      const check = this.check();
      if (!check.allowed) return check;
      state.inFlight += 1;
      state.hourly += 1;
      state.daily += 1;
      return { allowed: true, reason: null };
    },
    release(fields = {}) {
      state.inFlight = Math.max(0, state.inFlight - 1);
      if (fields.status_code === 429 || fields.timeout === true || fields.provider_error === true) {
        state.retries += 0;
        if (fields.provider_error === true) state.providerErrors += 1;
      }
      return this.snapshot();
    },
    snapshot() {
      return { ...state, hourlyLimit, dailyLimit, maxConcurrency, retry_performed: false, fallback_performed: false };
    }
  });
}

function buildGateResult(request, fields = {}) {
  const blockingReasons = uniqueSorted(fields.blocking_reasons || []);
  const allowed = fields.allowed === true && blockingReasons.length === 0;
  let targetForHash = 'target_not_available';
  try {
    targetForHash = request && request.target ? new URL(request.target).origin : 'target_not_available';
  } catch (_error) {
    targetForHash = 'target_invalid';
  }
  const targetHash = hashValue(targetForHash);
  const status = allowed ? 'public_web_candidate_success' : (fields.status || 'public_web_validation_blocked');
  return sanitizeObject({
    allowed,
    blocked: !allowed,
    status,
    blocking_reasons: blockingReasons,
    warnings: uniqueSorted(fields.warnings || []),
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    error: allowed ? null : buildSafeTransportError(fields.error_code || 'INVALID_PUBLIC_WEB_REQUEST', 'Public web pilot gate blocked safely.', {
      blocked_reason: blockingReasons[0] || 'pilot_gate_blocked'
    }),
    audit_event_candidate: buildPublicWebAuditEvent({
      ...(request || {}),
      status,
      blocked_reason: blockingReasons[0] || null,
      environment: fields.environment,
      feature_flag_state: fields.feature_flag_state === true,
      kill_switch_state: fields.kill_switch_state === true,
      lifecycle_state: fields.lifecycle_state,
      readiness_state: fields.readiness_state,
      configuration_state: fields.configuration_state,
      canary_state: allowed ? 'canary_allowed' : 'canary_blocked',
      rollout_percentage: fields.rollout_percentage || 0,
      target_origin_hash: targetHash,
      occurred_at: fields.occurred_at
    })
  });
}

function evaluatePublicWebPilotGate(request, context = {}) {
  try {
    const blocking = [];
    if (!isPlainObject(request)) {
      return buildGateResult(request, {
        blocking_reasons: ['request_must_be_object'],
        error_code: 'INVALID_PUBLIC_WEB_REQUEST'
      });
    }
    if (request.provider_id !== PROVIDER_ID || request.adapter_id !== ADAPTER_ID || request.connector_id !== CONNECTOR_ID || request.configuration_id !== CONFIGURATION_ID) {
      blocking.push('public_web_identity_mismatch');
    }
    if (isBlockedOperation(request.operation)) blocking.push('operation_blocked');
    const environment = context.environment || 'production';
    const production = context.production === true || environment === 'production';
    if (!PILOT_ENVIRONMENTS.includes(environment)) blocking.push('environment_not_allowed');
    if (production) blocking.push('production_blocked');
    const featureFlagState = context.feature_flag === true;
    if (!featureFlagState) blocking.push('feature_flag_off');
    const killSwitchState = context.kill_switch === true;
    if (killSwitchState) blocking.push('kill_switch_active');
    if (context.canary_authorized !== true) blocking.push('canary_not_authorized');
    const rollout = Number(context.rollout_percentage || 0);
    if (!(rollout > 0 && rollout <= MAX_PILOT_ROLLOUT_PERCENTAGE)) blocking.push('rollout_percentage_blocked');
    blocking.push(...validateAllowlists(request, context));

    const adapter = getFromRegistry(context.adapterRegistry, 'getAdapter', request.adapter_id);
    blocking.push(...validateAdapterBinding(adapter));
    const connector = getFromRegistry(context.lifecycleRegistry, 'getConnector', request.connector_id);
    blocking.push(...validateLifecycleBinding(connector, request));
    const configuration = getFromRegistry(context.configurationRegistry, 'getConfiguration', request.configuration_id);
    blocking.push(...validateConfigurationBinding(configuration, request));
    if (configuration) blocking.push(...validateSecretBinding(configuration, context));
    blocking.push(...validateReadinessBinding(context.readinessResult, request));

    const target = validatePublicWebTarget(request.target, {
      transport_kind: 'real_candidate',
      dnsResolver: context.dnsResolver
    });
    if (!target.valid) blocking.push(...target.errors);

    if (!context.costBudget || typeof context.costBudget.check !== 'function') {
      blocking.push('cost_budget_missing');
    } else {
      const cost = context.costBudget.check();
      if (!cost.allowed) blocking.push(cost.reason || 'cost_budget_blocked');
    }
    if (!context.rateLimitBudget || typeof context.rateLimitBudget.check !== 'function') {
      blocking.push('rate_limit_budget_missing');
    } else {
      const rate = context.rateLimitBudget.check();
      if (!rate.allowed) blocking.push(rate.reason || 'rate_limit_blocked');
    }
    if (context.audit_available !== true) blocking.push('audit_not_available');

    return buildGateResult(request, {
      allowed: blocking.length === 0,
      blocking_reasons: blocking,
      status: blocking.includes('production_blocked') ? 'public_web_production_blocked' : 'public_web_validation_blocked',
      error_code: blocking.includes('production_blocked') ? 'PUBLIC_WEB_PRODUCTION_BLOCKED' : 'INVALID_PUBLIC_WEB_REQUEST',
      environment,
      feature_flag_state: featureFlagState,
      kill_switch_state: killSwitchState,
      lifecycle_state: connector && connector.lifecycle_state,
      readiness_state: context.readinessResult && context.readinessResult.status,
      configuration_state: configuration && configuration.configuration_status,
      rollout_percentage: rollout,
      occurred_at: typeof context.clock === 'function' ? context.clock() : new Date(0).toISOString()
    });
  } catch (_error) {
    return buildGateResult(request, {
      blocking_reasons: ['public_web_pilot_gate_internal_error'],
      status: 'public_web_internal_error_safe',
      error_code: 'PUBLIC_WEB_INTERNAL_ERROR'
    });
  }
}

module.exports = {
  ELIGIBLE_LIFECYCLE_STATES,
  MAX_PILOT_ROLLOUT_PERCENTAGE,
  MAX_PILOT_TENANTS,
  MAX_PILOT_WORKSPACES,
  MAX_PILOT_USERS,
  createPublicWebPilotBudget,
  evaluatePublicWebPilotGate,
  validateReadinessBinding,
  validateConfigurationBinding,
  validateLifecycleBinding,
  validateAdapterBinding,
  buildGateResult
};

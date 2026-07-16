'use strict';

const {
  ADAPTER_ID,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID
} = require('../core/public-web-transport-contract');
const {
  buildSafeCanaryError,
  hashValue,
  sanitizeCanaryData,
  validateCanaryExecutionResult
} = require('../core/public-web-canary-session-contract');
const {
  buildPublicWebCanaryReport
} = require('../core/public-web-canary-report');
const {
  createPublicWebRealTransportCandidate
} = require('../adapters/public-web/public-web-real-transport-candidate');

const REQUIRED_RUNNER_DEPS = [
  'canarySessionRegistry',
  'targetAllowlist',
  'adapterRegistry',
  'lifecycleRegistry',
  'configurationRegistry',
  'secretReferenceRegistry',
  'secretResolver',
  'readinessResult',
  'nodeHttpsClient',
  'dnsResolver',
  'rateLimitBudget',
  'costBudget',
  'featureFlagResolver',
  'killSwitchResolver',
  'operatorPolicy',
  'auditSink',
  'clock'
];

function missingDeps(options) {
  return REQUIRED_RUNNER_DEPS.filter((key) => !options[key]);
}

function blockedResult(input, code, reason) {
  return sanitizeCanaryData({
    canary_session_id: input && input.canary_session_id || 'session_not_available',
    canary_execution_id: input && input.canary_execution_id || 'execution_not_available',
    trace_id: input && input.trace_id || 'trace_not_available',
    request_id: input && input.request_id || 'request_not_available',
    status: 'public_web_canary_blocked',
    target_origin_hash: hashValue(input && input.target_origin),
    source_type: input && input.source_type || 'source_not_available',
    operation: input && input.operation || 'operation_not_available',
    result_count: 0,
    safe_summary: 'Public web canary blocked safely.',
    structured_results: [],
    warnings: [],
    duration_ms: 0,
    bytes_received: 0,
    redirects_followed: 0,
    http_status_class: 'blocked',
    rate_limit_metadata: { retry_performed: false },
    cost_metadata: { cost_units: 0 },
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    audit_event_candidate: {
      event_name: 'public_web_canary_request_failed_safe',
      blocked_reason: reason,
      simulated: true,
      executed: false,
      real_provider_called: false
    },
    error: buildSafeCanaryError(code, 'Public web canary blocked safely.', { blocked_reason: reason })
  });
}

function createPublicWebCanaryRunner(options = {}) {
  const deps = { ...options };

  function requireDeps(input) {
    const missing = missingDeps(deps);
    if (missing.length > 0) return blockedResult(input, 'CANARY_INTERNAL_ERROR', `missing_dependency::${missing[0]}`);
    return null;
  }

  function buildPublicWebRequest(input, session, target) {
    return {
      trace_id: input.trace_id,
      request_id: input.request_id,
      connector_id: CONNECTOR_ID,
      configuration_id: CONFIGURATION_ID,
      adapter_id: ADAPTER_ID,
      provider_id: PROVIDER_ID,
      readiness_candidate_id: READINESS_CANDIDATE_ID,
      workspace_type: session.workspace_type,
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      organization_id: session.workspace_type === 'corporate' ? session.tenant_id : '',
      client_id: session.workspace_type === 'external_client' ? session.tenant_id.replace(/^client::/, '') : '',
      domain: 'marketing',
      capability: 'public_web_read',
      operation: session.operation,
      target,
      source_type: session.source_type,
      query: 'sanitized_canary_query',
      max_results: 1,
      requested_content_types: ['text/html', 'text/plain', 'application/json'],
      freshness_requirement: 'best_effort',
      timeout_ms: input.timeout_ms || 8000,
      max_response_bytes: input.max_response_bytes || 1048576,
      redirect_policy: { max_redirects: 0, follow_redirects: false },
      requested_at: input.requested_at,
      simulated: true,
      executed: false,
      real_provider_called: false,
      write_allowed: false,
      action_allowed: false,
      send_allowed: false,
      publish_allowed: false,
      delete_allowed: false
    };
  }

  async function runCanaryRequest(input = {}) {
    const depError = requireDeps(input);
    if (depError) return depError;
    const session = deps.canarySessionRegistry.getCanarySession(input.canary_session_id);
    if (!session) return blockedResult(input, 'CANARY_SESSION_NOT_FOUND', 'session_missing');
    if (session.canary_state !== 'active') return blockedResult(input, 'CANARY_SESSION_NOT_ACTIVE', 'session_not_active');
    if (String(deps.clock()) > session.expires_at) return blockedResult(input, 'CANARY_SESSION_EXPIRED', 'session_expired');
    if (deps.killSwitchResolver() === true) {
      deps.canarySessionRegistry.terminateByKillSwitch({ ...input, reason: 'kill_switch_active' });
      return blockedResult(input, 'CANARY_KILL_SWITCH_ACTIVE', 'kill_switch_active');
    }
    if (deps.featureFlagResolver() !== true) return blockedResult(input, 'CANARY_FEATURE_FLAG_OFF', 'feature_flag_off');
    const allowedTarget = deps.targetAllowlist.isTargetAllowed({
      environment: session.environment,
      target_origin: session.target_origin,
      target_path: input.target_path || '/',
      operation: session.operation,
      source_type: session.source_type
    });
    if (!allowedTarget.allowed) return blockedResult(input, 'CANARY_TARGET_NOT_ALLOWLISTED', allowedTarget.reason);

    const publicWebRequest = buildPublicWebRequest(input, session, allowedTarget.target_url);
    const transport = createPublicWebRealTransportCandidate({
      enabled: true,
      httpClient: (request) => deps.nodeHttpsClient.execute(request),
      dnsResolver: (hostname) => {
        const resolved = deps.dnsResolver.resolveSyncForPolicy
          ? deps.dnsResolver.resolveSyncForPolicy(hostname)
          : [];
        return resolved;
      },
      secretResolver: deps.secretResolver,
      clock: deps.clock,
      abortControllerFactory: input.abortControllerFactory || (() => new AbortController())
    });

    deps.auditSink.append({
      event_name: 'public_web_canary_request_started',
      trace_id: input.trace_id,
      request_id: input.request_id,
      change_id: input.change_id,
      canary_session_id: session.canary_session_id,
      environment: session.environment,
      target_origin_hash: hashValue(session.target_origin),
      operation: session.operation,
      applied: true,
      occurred_at: deps.clock()
    });

    const response = await transport.execute(publicWebRequest, {
      adapterRegistry: deps.adapterRegistry,
      lifecycleRegistry: deps.lifecycleRegistry,
      configurationRegistry: deps.configurationRegistry,
      secretReferenceRegistry: deps.secretReferenceRegistry,
      secretResolver: deps.secretResolver,
      readinessResult: deps.readinessResult,
      dnsResolver: (hostname) => deps.dnsResolver.resolveSyncForPolicy(hostname),
      rateLimitBudget: deps.rateLimitBudget,
      costBudget: deps.costBudget,
      audit_available: true,
      environment: session.environment,
      production: false,
      feature_flag: deps.featureFlagResolver() === true,
      kill_switch: deps.killSwitchResolver() === true,
      canary_authorized: true,
      rollout_percentage: session.rollout_percentage,
      allowed_tenants: [session.tenant_id],
      allowed_workspaces: [session.workspace_type],
      allowed_users: [session.user_id],
      secretReference: input.secretReference,
      secretAccessContext: input.secretAccessContext,
      clock: deps.clock
    });

    deps.canarySessionRegistry.executeCanaryRequest(input, {
      succeeded: response.status === 'public_web_candidate_success',
      executed: response.executed === true,
      real_provider_called: response.real_provider_called === true
    });
    deps.auditSink.append({
      event_name: response.status === 'public_web_candidate_success' ? 'public_web_canary_request_succeeded' : 'public_web_canary_request_failed_safe',
      trace_id: input.trace_id,
      request_id: input.request_id,
      change_id: input.change_id,
      canary_session_id: session.canary_session_id,
      environment: session.environment,
      target_origin_hash: hashValue(session.target_origin),
      operation: session.operation,
      status: response.status,
      blocked_reason: response.error && response.error.blocked_reason,
      applied: true,
      executed: response.executed === true,
      real_provider_called: response.real_provider_called === true,
      occurred_at: deps.clock()
    });

    const result = sanitizeCanaryData({
      canary_session_id: session.canary_session_id,
      canary_execution_id: input.canary_execution_id || input.change_id,
      trace_id: input.trace_id,
      request_id: input.request_id,
      status: response.status,
      target_origin_hash: hashValue(session.target_origin),
      source_type: session.source_type,
      operation: session.operation,
      result_count: response.result_count,
      safe_summary: response.safe_summary,
      structured_results: response.structured_results,
      warnings: response.warnings,
      duration_ms: response.duration_ms,
      bytes_received: response.bytes_received,
      redirects_followed: response.redirects_followed,
      http_status_class: response.http_status_class,
      rate_limit_metadata: response.rate_limit_metadata,
      cost_metadata: response.cost_metadata,
      executed: response.executed === true,
      real_provider_called: response.real_provider_called === true,
      can_trigger_real_execution: false,
      audit_event_candidate: response.audit_event_candidate,
      error: response.error
    });
    const validation = validateCanaryExecutionResult(result);
    if (!validation.valid) return blockedResult(input, 'CANARY_INTERNAL_ERROR', validation.errors[0]);
    return result;
  }

  async function runCanarySession(input = {}) {
    const requested = deps.canarySessionRegistry.requestCanary(input.request);
    if (!requested.ok) return requested;
    return deps.canarySessionRegistry.getCanarySession(input.request.canary_session_id);
  }

  function terminateCanary(input = {}) {
    return deps.canarySessionRegistry.terminateByKillSwitch(input);
  }

  function getCanaryReport(sessionId) {
    const session = deps.canarySessionRegistry.getCanarySession(sessionId);
    const events = deps.auditSink.getBySession(sessionId);
    return buildPublicWebCanaryReport(session, events);
  }

  return Object.freeze({
    runCanarySession,
    runCanaryRequest,
    terminateCanary,
    getCanaryReport
  });
}

module.exports = {
  createPublicWebCanaryRunner,
  runCanarySession: (input, options) => createPublicWebCanaryRunner(options).runCanarySession(input),
  runCanaryRequest: (input, options) => createPublicWebCanaryRunner(options).runCanaryRequest(input),
  terminateCanary: (input, options) => createPublicWebCanaryRunner(options).terminateCanary(input),
  getCanaryReport: (sessionId, options) => createPublicWebCanaryRunner(options).getCanaryReport(sessionId)
};

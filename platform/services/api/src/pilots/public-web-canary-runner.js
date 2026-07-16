'use strict';

const { createPublicWebRealTransportCandidate } = require('../adapters/public-web/public-web-real-transport-candidate');
const {
  buildCanaryAuditEventCandidate,
  buildSafeCanaryError,
  hashCanaryEvidence,
  isSessionExpired,
  sanitizeCanaryData
} = require('../core/public-web-canary-session-contract');
const {
  validateCanaryExecutionBindings
} = require('../core/public-web-canary-session-registry');
const {
  REQUEST_LIMITS
} = require('../core/public-web-transport-contract');

const REQUIRED_DEPS = Object.freeze([
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
]);

function hasAllDeps(deps) {
  return REQUIRED_DEPS.every((key) => deps[key]);
}

function nowIso(deps) {
  const value = typeof deps.clock === 'function' ? deps.clock() : new Date().toISOString();
  return value instanceof Date ? value.toISOString() : String(value);
}

function appendAudit(deps, event) {
  if (deps.auditSink && typeof deps.auditSink.append === 'function') deps.auditSink.append(event);
}

function baseAudit(input, session, fields = {}) {
  return buildCanaryAuditEventCandidate({
    ...(session || {}),
    ...(input || {}),
    event_name: fields.event_name || 'public_web_canary_request_failed_safe',
    status: fields.status || 'public_web_canary_request_failed_safe',
    applied: fields.applied === true,
    error_code: fields.error_code || null,
    blocked_reason: fields.blocked_reason || null,
    executed: fields.executed === true,
    real_provider_called: fields.real_provider_called === true,
    occurred_at: fields.occurred_at || new Date(0).toISOString()
  });
}

function buildBlockedBeforeNetworkResult(input, session, code, reason, deps = {}) {
  const audit = baseAudit(input, session, {
    event_name: 'public_web_canary_request_failed_safe',
    status: 'public_web_canary_request_failed_safe',
    applied: false,
    error_code: code,
    blocked_reason: reason,
    executed: false,
    real_provider_called: false,
    occurred_at: hasAllDeps(deps) ? nowIso(deps) : new Date(0).toISOString()
  });
  appendAudit(deps, audit);
  return sanitizeCanaryData({
    canary_session_id: session && session.canary_session_id || input && input.canary_session_id,
    canary_execution_id: input && (input.canary_execution_id || input.change_id),
    trace_id: input && input.trace_id,
    request_id: input && input.request_id,
    status: 'public_web_canary_request_failed_safe',
    target_origin_hash: session && session.target_origin ? hashCanaryEvidence({ target_origin: session.target_origin }) : 'target_not_available',
    source_type: session && session.source_type,
    operation: session && session.operation,
    result_count: 0,
    safe_summary: 'Public web canary blocked before network.',
    structured_results: [],
    warnings: [],
    duration_ms: 0,
    bytes_received: 0,
    redirects_followed: 0,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    audit_event_candidate: audit,
    error: buildSafeCanaryError(code, reason)
  });
}

function buildFailedAfterNetworkResult(input, session, code, reason, deps = {}) {
  const audit = baseAudit(input, session, {
    event_name: 'public_web_canary_request_failed_safe',
    status: 'public_web_canary_request_failed_safe',
    applied: true,
    error_code: code,
    blocked_reason: reason,
    executed: true,
    real_provider_called: true,
    occurred_at: nowIso(deps)
  });
  appendAudit(deps, audit);
  return sanitizeCanaryData({
    canary_session_id: session.canary_session_id,
    canary_execution_id: input.canary_execution_id || input.change_id,
    trace_id: input.trace_id,
    request_id: input.request_id,
    status: 'public_web_provider_error_safe',
    target_origin_hash: hashCanaryEvidence({ target_origin: session.target_origin }),
    source_type: session.source_type,
    operation: session.operation,
    result_count: 0,
    safe_summary: 'Public web canary failed after network started.',
    structured_results: [],
    warnings: [],
    duration_ms: 0,
    bytes_received: 0,
    redirects_followed: 0,
    executed: true,
    real_provider_called: true,
    can_trigger_real_execution: false,
    audit_event_candidate: audit,
    error: buildSafeCanaryError(code, reason)
  });
}

function exactPathApproved(input, session) {
  const requested = input.target_path == null ? session.target_path : input.target_path;
  if (requested !== session.target_path) return { valid: false, reason: 'target_path_mismatch' };
  if (hashCanaryEvidence({ target_path: requested }) !== session.target_path_hash) return { valid: false, reason: 'target_path_hash_mismatch' };
  return { valid: true, path: requested };
}

function validateTargetPolicyLimits(input, session, policy) {
  if (!policy || policy.enabled !== true || policy.revoked === true) return { valid: false, reason: 'target_policy_inactive' };
  if (policy.redirects_allowed !== false) return { valid: false, reason: 'redirects_not_allowed' };
  if (session.maximum_requests > policy.maximum_requests) return { valid: false, reason: 'session_requests_exceed_policy' };
  if (input.timeout_ms && input.timeout_ms > policy.timeout_ms) return { valid: false, reason: 'timeout_exceeds_policy' };
  if (input.max_response_bytes && input.max_response_bytes > policy.maximum_response_bytes) return { valid: false, reason: 'response_limit_exceeds_policy' };
  const requestedContentTypes = Array.isArray(input.requested_content_types) ? input.requested_content_types : [];
  if (requestedContentTypes.some((type) => !policy.allowed_content_types.includes(type))) return { valid: false, reason: 'content_type_outside_policy' };
  return {
    valid: true,
    timeout_ms: Math.min(input.timeout_ms || policy.timeout_ms, policy.timeout_ms, REQUEST_LIMITS.maximum_timeout_ms),
    max_response_bytes: Math.min(input.max_response_bytes || policy.maximum_response_bytes, policy.maximum_response_bytes, REQUEST_LIMITS.maximum_response_bytes)
  };
}

function buildPublicWebRequest(input, session, targetUrl, limits) {
  return {
    trace_id: input.trace_id,
    request_id: input.request_id,
    connector_id: session.connector_id,
    configuration_id: session.configuration_id,
    adapter_id: session.adapter_id,
    provider_id: session.provider_id,
    readiness_candidate_id: session.readiness_candidate_id,
    workspace_type: session.workspace_type,
    tenant_id: session.tenant_id,
    user_id: session.user_id,
    organization_id: session.tenant_id === 'grupo_erick' ? 'grupo_erick' : '',
    client_id: '',
    domain: 'pesquisa',
    capability: 'public_web_read',
    operation: session.operation,
    target: targetUrl,
    source_type: session.source_type,
    query: '',
    max_results: 1,
    requested_content_types: input.requested_content_types || [],
    freshness_requirement: 'canary_current',
    timeout_ms: limits.timeout_ms,
    max_response_bytes: limits.max_response_bytes,
    redirect_policy: { max_redirects: 0 },
    requested_at: input.requested_at || nowIso({ clock: () => new Date(0).toISOString() }),
    simulated: true,
    executed: false,
    real_provider_called: false,
    write_allowed: false,
    action_allowed: false,
    send_allowed: false,
    publish_allowed: false,
    delete_allowed: false,
    secretReference: input.secretReference,
    secretAccessContext: input.secretAccessContext
  };
}

function normalizeNetworkResult(result, input, session, networkStarted, deps) {
  if (!networkStarted) return result;
  const normalized = {
    ...result,
    executed: true,
    real_provider_called: true,
    can_trigger_real_execution: false
  };
  normalized.audit_event_candidate = {
    ...(result.audit_event_candidate || {}),
    event_name: result.status === 'public_web_candidate_success' ? 'public_web_canary_request_succeeded' : 'public_web_canary_request_failed_safe',
    trace_id: input.trace_id,
    request_id: input.request_id,
    canary_session_id: session.canary_session_id,
    executed: true,
    real_provider_called: true,
    can_trigger_real_execution: false,
    occurred_at: nowIso(deps)
  };
  return sanitizeCanaryData(normalized);
}

function createPublicWebCanaryRunner(deps = {}) {
  async function runCanaryRequest(input = {}) {
    if (!hasAllDeps(deps)) return buildBlockedBeforeNetworkResult(input, null, 'CANARY_INTERNAL_ERROR', 'missing_canary_dependency', deps);
    const session = deps.canarySessionRegistry.getCanarySession(input.canary_session_id);
    if (!session) return buildBlockedBeforeNetworkResult(input, null, 'CANARY_SESSION_NOT_FOUND', 'canary_session_not_found', deps);
    if (session.canary_state !== 'active') return buildBlockedBeforeNetworkResult(input, session, 'CANARY_SESSION_NOT_ACTIVE', 'canary_session_not_active', deps);
    if (isSessionExpired(session, deps.clock)) return buildBlockedBeforeNetworkResult(input, session, 'CANARY_SESSION_EXPIRED', 'canary_session_expired', deps);

    const path = exactPathApproved(input, session);
    if (!path.valid) return buildBlockedBeforeNetworkResult(input, session, 'CANARY_TARGET_NOT_ALLOWLISTED', path.reason, deps);

    const binding = validateCanaryExecutionBindings(session, deps, input, { requireApproval: true });
    if (binding.code === 'CANARY_KILL_SWITCH_ACTIVE') {
      deps.canarySessionRegistry.terminateByKillSwitch({
        canary_session_id: session.canary_session_id,
        change_id: `${input.change_id || input.request_id}:kill_switch`,
        trace_id: input.trace_id,
        request_id: input.request_id,
        expected_version: session.version,
        reason: 'kill_switch_active'
      });
    }
    if (!binding.valid) return buildBlockedBeforeNetworkResult(input, session, binding.code, binding.reason, deps);

    const limits = validateTargetPolicyLimits(input, session, binding.target_policy);
    if (!limits.valid) return buildBlockedBeforeNetworkResult(input, session, 'CANARY_TARGET_POLICY_BLOCKED', limits.reason, deps);

    if (!deps.dnsResolver || typeof deps.dnsResolver.resolve !== 'function') return buildBlockedBeforeNetworkResult(input, session, 'CANARY_TARGET_POLICY_BLOCKED', 'async_dns_resolver_required', deps);
    const targetUrl = new URL(`${session.target_origin}${session.target_path}`);
    const dns = await deps.dnsResolver.resolve(targetUrl.hostname, {
      trace_id: input.trace_id,
      request_id: input.request_id,
      canary_session_id: session.canary_session_id,
      environment: session.environment,
      tenant_id: session.tenant_id
    });
    if (!dns || dns.allowed !== true || typeof dns.approved_ip !== 'string' || !Array.isArray(dns.approved_ips) || dns.approved_ips.length === 0) {
      return buildBlockedBeforeNetworkResult(input, session, 'CANARY_TARGET_POLICY_BLOCKED', dns && dns.blocked_reason || 'dns_policy_blocked', deps);
    }

    let networkStarted = false;
    const transport = createPublicWebRealTransportCandidate({
      enabled: true,
      environment: session.environment,
      production: false,
      featureFlagResolver: () => true,
      killSwitchResolver: () => false,
      dnsResolver: typeof deps.dnsResolver.resolveSyncForPolicy === 'function'
        ? deps.dnsResolver.resolveSyncForPolicy
        : () => dns.approved_ips,
      httpClient: async (transportRequest) => {
        networkStarted = true;
        return deps.nodeHttpsClient.execute({
          ...transportRequest,
          approved_ip: dns.approved_ip,
          approved_ips: dns.approved_ips,
          hostname: targetUrl.hostname,
          port: 443,
          protocol: 'https',
          server_name: targetUrl.hostname,
          host_header: targetUrl.hostname,
          redirect_mode: 'manual'
        });
      },
      secretResolver: deps.secretResolver,
      clock: deps.clock,
      abortControllerFactory: () => new AbortController()
    });

    try {
      const result = await transport.execute(buildPublicWebRequest(input, session, targetUrl.toString(), limits), {
        adapterRegistry: deps.adapterRegistry,
        lifecycleRegistry: deps.lifecycleRegistry,
        configurationRegistry: deps.configurationRegistry,
        secretReferenceRegistry: deps.secretReferenceRegistry,
        secretResolver: deps.secretResolver,
        readinessResult: deps.readinessResult,
        dnsResolver: typeof deps.dnsResolver.resolveSyncForPolicy === 'function' ? deps.dnsResolver.resolveSyncForPolicy : () => dns.approved_ips,
        rateLimitBudget: deps.rateLimitBudget,
        costBudget: deps.costBudget,
        audit_available: true,
        environment: session.environment,
        production: false,
        feature_flag: true,
        kill_switch: false,
        canary_authorized: true,
        rollout_percentage: session.rollout_percentage,
        allowed_tenants: Array.isArray(deps.tenantAllowlist) ? deps.tenantAllowlist : undefined,
        allowed_workspaces: Array.isArray(deps.workspaceAllowlist) ? deps.workspaceAllowlist : undefined,
        allowed_users: Array.isArray(deps.userAllowlist) ? deps.userAllowlist : undefined,
        secretReference: input.secretReference,
        secretAccessContext: input.secretAccessContext,
        clock: deps.clock
      });
      const normalized = normalizeNetworkResult(result, input, session, networkStarted, deps);
      const latest = deps.canarySessionRegistry.getCanarySession(session.canary_session_id);
      deps.canarySessionRegistry.executeCanaryRequest({
        canary_session_id: session.canary_session_id,
        change_id: input.change_id,
        trace_id: input.trace_id,
        request_id: input.request_id,
        expected_version: latest.version
      }, normalized);
      appendAudit(deps, normalized.audit_event_candidate || baseAudit(input, session, { executed: networkStarted, real_provider_called: networkStarted }));
      return normalized;
    } catch (_error) {
      if (!networkStarted) return buildBlockedBeforeNetworkResult(input, session, 'CANARY_INTERNAL_ERROR', 'canary_request_failed_before_network', deps);
      const failed = buildFailedAfterNetworkResult(input, session, 'CANARY_INTERNAL_ERROR', 'canary_request_failed_after_network', deps);
      const latest = deps.canarySessionRegistry.getCanarySession(session.canary_session_id);
      deps.canarySessionRegistry.executeCanaryRequest({
        canary_session_id: session.canary_session_id,
        change_id: input.change_id,
        trace_id: input.trace_id,
        request_id: input.request_id,
        expected_version: latest.version
      }, failed);
      return failed;
    }
  }

  return Object.freeze({
    runCanaryRequest,
    async runCanarySession(input) { return runCanaryRequest(input); },
    async terminateCanary(input) { return deps.canarySessionRegistry.terminateByKillSwitch(input); },
    getCanaryReport(sessionId) {
      const { buildPublicWebCanaryReport } = require('../core/public-web-canary-report');
      return buildPublicWebCanaryReport(
        deps.canarySessionRegistry.getCanarySession(sessionId),
        deps.auditSink && deps.auditSink.list ? deps.auditSink.list({ canary_session_id: sessionId }) : []
      );
    }
  });
}

module.exports = {
  buildBlockedBeforeNetworkResult,
  buildFailedAfterNetworkResult,
  createPublicWebCanaryRunner
};

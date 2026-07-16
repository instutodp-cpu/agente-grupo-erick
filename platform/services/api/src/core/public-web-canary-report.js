'use strict';

const {
  deepClone,
  hashValue,
  sanitizeCanaryData
} = require('./public-web-canary-session-contract');

const CANARY_RECOMMENDATIONS = [
  'remain_disabled',
  'fix_before_next_canary',
  'eligible_for_second_canary',
  'terminate_candidate'
];

function buildPublicWebCanaryReport(session, events = []) {
  const safeSession = sanitizeCanaryData(session || {});
  const safeEvents = Array.isArray(events) ? events.map(sanitizeCanaryData) : [];
  const requestsSucceeded = safeEvents.filter((event) => event.event_name === 'public_web_canary_request_succeeded').length;
  const requestsFailedSafe = safeEvents.filter((event) => event.event_name === 'public_web_canary_request_failed_safe').length;
  const killSwitchTerminations = safeEvents.filter((event) => event.event_name === 'public_web_canary_kill_switch_terminated').length;
  const providerCalls = safeEvents.filter((event) => event.real_provider_called === true).length;
  const ssrfBlocks = safeEvents.filter((event) => String(event.blocked_reason || '').includes('ssrf')).length;
  const dnsRebindingBlocks = safeEvents.filter((event) => String(event.blocked_reason || '').includes('rebind')).length;
  const rateLimitBlocks = safeEvents.filter((event) => String(event.blocked_reason || '').includes('rate')).length;
  const costBlocks = safeEvents.filter((event) => String(event.blocked_reason || '').includes('cost')).length;
  const responseTooLargeBlocks = safeEvents.filter((event) => String(event.blocked_reason || '').includes('large')).length;
  const timeouts = safeEvents.filter((event) => String(event.blocked_reason || '').includes('timeout')).length;
  let recommendation = 'remain_disabled';
  if (killSwitchTerminations > 0 || ssrfBlocks > 0 || dnsRebindingBlocks > 0) recommendation = 'terminate_candidate';
  else if (requestsFailedSafe > 0 || timeouts > 0 || responseTooLargeBlocks > 0) recommendation = 'fix_before_next_canary';
  else if (requestsSucceeded > 0 && providerCalls === requestsSucceeded) recommendation = 'eligible_for_second_canary';

  return sanitizeCanaryData({
    canary_session_id: safeSession.canary_session_id || 'session_not_available',
    state: safeSession.canary_state || 'unknown',
    environment: safeSession.environment || 'unknown',
    tenant_id: safeSession.tenant_id || 'tenant_not_available',
    workspace_type: safeSession.workspace_type || 'workspace_not_available',
    operator_id: safeSession.operator_id || 'operator_not_available',
    approved_by: safeSession.approved_by || null,
    target_origin_hash: hashValue(safeSession.target_origin),
    operation: safeSession.operation || 'operation_not_available',
    source_type: safeSession.source_type || 'source_not_available',
    requests_authorized: safeSession.maximum_requests || 0,
    requests_attempted: safeSession.requests_used || 0,
    requests_succeeded: requestsSucceeded,
    requests_failed_safe: requestsFailedSafe,
    provider_calls: providerCalls,
    total_bytes: safeEvents.reduce((total, event) => total + (Number.isInteger(event.bytes_received) ? event.bytes_received : 0), 0),
    total_duration_ms: safeEvents.reduce((total, event) => total + (Number.isInteger(event.duration_ms) ? event.duration_ms : 0), 0),
    redirects_followed: 0,
    timeouts,
    response_too_large_blocks: responseTooLargeBlocks,
    ssrf_blocks: ssrfBlocks,
    dns_rebinding_blocks: dnsRebindingBlocks,
    rate_limit_blocks: rateLimitBlocks,
    cost_blocks: costBlocks,
    kill_switch_terminations: killSwitchTerminations,
    feature_flag_blocks: safeEvents.filter((event) => String(event.blocked_reason || '').includes('feature_flag')).length,
    started_at: safeSession.started_at || null,
    completed_at: safeEvents.length ? safeEvents[safeEvents.length - 1].occurred_at : null,
    expires_at: safeSession.expires_at || null,
    warnings: [],
    recommendation: CANARY_RECOMMENDATIONS.includes(recommendation) ? recommendation : 'remain_disabled',
    simulated: true,
    executed: providerCalls > 0,
    real_provider_called: providerCalls > 0
  });
}

module.exports = {
  CANARY_RECOMMENDATIONS,
  buildPublicWebCanaryReport
};

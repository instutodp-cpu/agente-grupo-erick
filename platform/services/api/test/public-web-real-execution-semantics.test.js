'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildTransportEnvelope,
  validatePublicWebTransportResponse
} = require('../src/core/public-web-transport-contract');
const { sanitizeResponse } = require('../src/adapters/public-web/public-web-read-only-adapter');
const { buildCanaryAuditEventCandidate } = require('../src/core/public-web-canary-session-contract');

function request() {
  return {
    trace_id:'trace-real', request_id:'request-real', connector_id:'public_web_read_only_connector_v1',
    configuration_id:'public_web_read_only_configuration_v1', adapter_id:'public_web_read_only_adapter_v1',
    provider_id:'public_web_provider_candidate', source_type:'public_documentation_page', target:'https://example.com/docs'
  };
}

const realFlags = {
  executed:true,
  real_provider_called:true,
  provider_invoked:true,
  transport_invoked:true,
  external_network_called:true
};

test('real network execution is represented as simulated=false end-to-end', () => {
  const response = buildTransportEnvelope(request(), {
    status:'public_web_candidate_success',
    content_type:'text/plain',
    safe_summary:'ok',
    structured_results:[],
    ...realFlags,
    environment:'staging'
  });
  assert.equal(response.simulated, false);
  assert.equal(response.audit_event_candidate.simulated, false);
  assert.deepEqual(validatePublicWebTransportResponse(response).errors, []);
  const sanitized = sanitizeResponse(response, request(), { environment:'staging' });
  assert.equal(sanitized.simulated, false);
  assert.equal(sanitized.executed, true);
  assert.equal(sanitized.real_provider_called, true);
});

test('pre-network and synthetic results remain simulated=true', () => {
  const response = buildTransportEnvelope(request(), {
    status:'public_web_validation_blocked',
    content_type:'text/plain',
    error_code:'INVALID_PUBLIC_WEB_REQUEST',
    blocked_reason:'test',
    executed:false,
    real_provider_called:false,
    provider_invoked:false,
    transport_invoked:false,
    external_network_called:false
  });
  assert.equal(response.simulated, true);
  assert.equal(response.audit_event_candidate.simulated, true);
});

test('response validation rejects false simulated flag without complete real execution evidence', () => {
  const response = buildTransportEnvelope(request(), { status:'public_web_candidate_success', content_type:'text/plain' });
  const incoherent = { ...response, simulated:false };
  assert.ok(validatePublicWebTransportResponse(incoherent).errors.includes('real_execution_evidence_required_when_not_simulated'));
});

test('durable canary audit candidate marks only complete real evidence as non-simulated', () => {
  const real = buildCanaryAuditEventCandidate({
    event_name:'public_web_canary_request_succeeded', trace_id:'t', request_id:'r', change_id:'c', canary_session_id:'s',
    ...realFlags
  });
  const before = buildCanaryAuditEventCandidate({ event_name:'public_web_canary_request_started', trace_id:'t', request_id:'r', change_id:'c', canary_session_id:'s' });
  assert.equal(real.simulated, false);
  assert.equal(before.simulated, true);
});

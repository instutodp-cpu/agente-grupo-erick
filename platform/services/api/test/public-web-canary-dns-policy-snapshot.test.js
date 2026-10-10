'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPublicWebCanaryRunner } = require('../src/pilots/public-web-canary-runner');
const { validCanaryContext, validCanaryRequest, validApproval } = require('./helpers/public-web-canary-test-data');

function createApprovedActiveSession(context) {
  const request = validCanaryRequest();
  const created = context.canarySessionRegistry.requestCanary(request);
  assert.equal(created.ok, true);
  const validated = context.canarySessionRegistry.validateCanary({
    canary_session_id: request.canary_session_id,
    change_id: 'dns_snapshot_validate',
    request_id: 'dns_snapshot_validate_request',
    expected_version: created.session.version
  }, context);
  assert.equal(validated.ok, true);
  const approved = context.canarySessionRegistry.approveCanary(validApproval(validated.session), context);
  assert.equal(approved.ok, true);
  const active = context.canarySessionRegistry.activateCanary({
    canary_session_id: request.canary_session_id,
    change_id: 'dns_snapshot_activate',
    request_id: 'dns_snapshot_activate_request',
    expected_version: approved.session.version
  }, context);
  assert.equal(active.ok, true);
  return active.session;
}

test('runner reuses async-approved DNS snapshot when sync policy resolver is empty', async () => {
  const context = validCanaryContext({
    dnsResolver: {
      async resolve(hostname) {
        return {
          allowed: true,
          reason: null,
          hostname,
          approved_ip: '93.184.216.34',
          approved_ips: ['93.184.216.34']
        };
      },
      resolveSyncForPolicy() { return []; }
    }
  });
  const session = createApprovedActiveSession(context);
  const result = await createPublicWebCanaryRunner(context).runCanaryRequest({
    trace_id: 'trace_async_dns_snapshot',
    request_id: 'request_async_dns_snapshot',
    change_id: 'change_async_dns_snapshot',
    canary_execution_id: 'execution_async_dns_snapshot',
    canary_session_id: session.canary_session_id,
    target_path: session.target_path,
    expected_version: session.version,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
  assert.equal(result.status, 'public_web_candidate_success');
  assert.equal(result.executed, true);
  assert.equal(result.real_provider_called, true);
  assert.equal(context.nodeHttpsClient.calls(), 1);
});

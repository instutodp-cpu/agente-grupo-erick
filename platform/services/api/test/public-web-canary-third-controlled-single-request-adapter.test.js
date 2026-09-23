'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const { executePublicWebThirdCanarySingleRequest } =
  require('../src/core/public-web-canary-third-controlled-single-request-adapter');

function command() {
  return {
    trial_id: 'trial-3', official_authorization_id: 'official-3', preparatory_authorization_id: 'prep-3',
    grant_id: 'grant-3', reservation_id: 'reservation-3', environment: 'staging',
    target_origin: 'https://example.com', target_path: '/', method: 'GET', port: 443,
    maximum_requests: 1, rollout_percentage: 1, redirects_allowed: false, production_allowed: false,
    confirmed_at: '2026-09-23T00:00:00.000Z', confirmation_maximum_age_ms: 120000,
    single_use: true, execution_started: false, external_network_called: false
  };
}
function commandDigest(c) {
  return computeCanonicalContentDigest([
    c.trial_id, c.official_authorization_id, c.preparatory_authorization_id,
    c.grant_id, c.reservation_id, c.environment, c.target_origin,
    c.target_path, c.method, c.port, c.maximum_requests,
    c.rollout_percentage, c.redirects_allowed, c.production_allowed,
    c.confirmed_at, c.confirmation_maximum_age_ms, c.single_use
  ]);
}
function input() {
  const c=command();
  return {
    side_effect_boundary:{ok:true,status:'THIRD_CANARY_SIDE_EFFECT_BOUNDARY_READY_COMMAND_PREPARED_NOT_EXECUTED',side_effect_boundary_ready:true,execution_command_prepared:true,execution_started:false,external_network_called:false,production_allowed:false,execution_command:c},
    execution_claim:{ok:true,status:'THIRD_CANARY_DURABLE_EXECUTION_CLAIMED_NOT_STARTED_NOT_EXECUTED',execution_claimed:true,execution_started:false,provider_invoked:false,transport_invoked:false,external_network_called:false,production_allowed:false,trial_id:c.trial_id,reservation_id:c.reservation_id,command_fingerprint:commandDigest(c)},
    runtime_binding:{canary_session_id:'session-3',canary_execution_id:'reservation-3',change_id:'change-3',trace_id:'trace-3',request_id:'request-3'},
    production_allowed:false
  };
}
const options={clock:()=> '2026-09-23T00:01:00.000Z'};

test('invokes injected runner exactly once with exact bounded runtime request', async()=>{
  let calls=0, seen;
  const runner={runCanaryRequest:async(x)=>{calls++;seen=x;return {status:'public_web_candidate_success',provider_invoked:true,transport_invoked:true,external_network_called:true};}};
  const r=await executePublicWebThirdCanarySingleRequest(input(),{runner},options);
  assert.equal(r.ok,true); assert.equal(calls,1); assert.equal(seen.target_path,'/');
  assert.equal(seen.canary_execution_id,'reservation-3'); assert.equal(r.external_network_called,true);
});

test('stale confirmation blocks before runner',async()=>{
  let calls=0; const i=input(); i.side_effect_boundary.execution_command.confirmed_at='2026-09-22T23:57:00.000Z';
  const r=await executePublicWebThirdCanarySingleRequest(i,{runner:{runCanaryRequest:async()=>{calls++;}}},options);
  assert.equal(r.ok,false); assert.equal(r.reason,'fresh_human_confirmation_expired_before_runner'); assert.equal(calls,0);
});

test('claim fingerprint or reservation drift blocks before runner',async()=>{
  let calls=0; const runner={runCanaryRequest:async()=>{calls++;}};
  const a=input(); a.execution_claim.command_fingerprint='bad';
  assert.equal((await executePublicWebThirdCanarySingleRequest(a,{runner},options)).ok,false);
  const b=input(); b.runtime_binding.canary_execution_id='other';
  assert.equal((await executePublicWebThirdCanarySingleRequest(b,{runner},options)).ok,false);
  assert.equal(calls,0);
});

test('production, missing runner, and invalid scope fail closed',async()=>{
  const a=input(); a.production_allowed=true;
  assert.equal((await executePublicWebThirdCanarySingleRequest(a,{runner:{runCanaryRequest:async()=>{}}},options)).ok,false);
  assert.equal((await executePublicWebThirdCanarySingleRequest(input(),{},options)).ok,false);
  const c=input(); c.side_effect_boundary.execution_command.maximum_requests=2;
  assert.equal((await executePublicWebThirdCanarySingleRequest(c,{runner:{runCanaryRequest:async()=>{}}},options)).ok,false);
});

test('runner exception is reported without retry',async()=>{
  let calls=0;
  const r=await executePublicWebThirdCanarySingleRequest(input(),{runner:{runCanaryRequest:async()=>{calls++;throw new Error('boom');}}},options);
  assert.equal(r.ok,false); assert.equal(r.runner_invoked,true); assert.equal(calls,1);
});

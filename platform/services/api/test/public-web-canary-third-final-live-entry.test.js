'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const { executePublicWebThirdCanaryFinalLiveEntry } =
  require('../src/core/public-web-canary-third-final-live-entry');

function digest(c) {
  return computeCanonicalContentDigest([
    c.trial_id,c.official_authorization_id,c.preparatory_authorization_id,c.grant_id,c.reservation_id,
    c.environment,c.target_origin,c.target_path,c.method,c.port,c.maximum_requests,c.rollout_percentage,
    c.redirects_allowed,c.production_allowed,c.confirmed_at,c.confirmation_maximum_age_ms,c.single_use
  ]);
}
function fixture() {
  const c={trial_id:'trial-249',official_authorization_id:'official-249',preparatory_authorization_id:'prep-249',
    grant_id:'grant-249',reservation_id:'reservation-249',environment:'staging',
    target_origin:'https://example.com',target_path:'/',method:'GET',port:443,maximum_requests:1,
    rollout_percentage:1,redirects_allowed:false,production_allowed:false,
    confirmed_at:'2026-09-23T18:00:00.000Z',confirmation_maximum_age_ms:120000,single_use:true,
    execution_started:false,external_network_called:false};
  return {execute:true,production_allowed:false,maximum_requests:1,
    side_effect_boundary:{ok:true,status:'THIRD_CANARY_SIDE_EFFECT_BOUNDARY_READY_COMMAND_PREPARED_NOT_EXECUTED',
      side_effect_boundary_ready:true,execution_command_prepared:true,execution_started:false,
      external_network_called:false,production_allowed:false,execution_command:c},
    execution_claim:{ok:true,status:'THIRD_CANARY_DURABLE_EXECUTION_CLAIMED_NOT_STARTED_NOT_EXECUTED',
      execution_claimed:true,execution_started:false,provider_invoked:false,transport_invoked:false,
      external_network_called:false,production_allowed:false,trial_id:c.trial_id,reservation_id:c.reservation_id,
      command_fingerprint:digest(c)},
    runtime_binding:{canary_session_id:'session-249',canary_execution_id:'reservation-249',
      change_id:'change-249',trace_id:'trace-249',request_id:'request-249'}};
}
function runtime(i,counters={verify:0,runner:0}) {
  const c=i.side_effect_boundary.execution_command;
  return {official:true,production_allowed:false,maximum_requests:1,
    secretAccessContract:{environment:'staging',purpose:'public_web_canary_execution',
      production_allowed:false,exportable:false,single_request:true},
    featureFlagResolver:async()=>true,killSwitchResolver:async()=>false,
    claimVerifier:{verifyClaim:async()=>{counters.verify++;return {ok:true,trial_id:c.trial_id,
      reservation_id:c.reservation_id,command_fingerprint:digest(c),state:'CLAIMED',production_allowed:false};}},
    runner:{runCanaryRequest:async()=>{counters.runner++;return {status:'public_web_candidate_success',
      provider_invoked:true,transport_invoked:true,external_network_called:true};}}};
}
const options={clock:()=> '2026-09-23T18:01:00.000Z'};

test('final entry composes exact controlled runtime once',async()=>{
  const i=fixture(), counters={verify:0,runner:0};
  const r=await executePublicWebThirdCanaryFinalLiveEntry(i,runtime(i,counters),options);
  assert.equal(r.ok,true); assert.equal(counters.verify,1); assert.equal(counters.runner,1);
  assert.equal(r.production_allowed,false); assert.equal(r.reservation_id,'reservation-249');
});

test('missing official runtime wiring fails closed before verifier or runner',async()=>{
  const i=fixture();
  for (const r of [{}, {...runtime(i),official:false}, {...runtime(i),featureFlagResolver:null},
    {...runtime(i),killSwitchResolver:null}, {...runtime(i),secretAccessContract:null}]) {
    const result=await executePublicWebThirdCanaryFinalLiveEntry(i,r,options);
    assert.equal(result.ok,false); assert.equal(result.execution_started,false);
    assert.equal(result.external_network_called,false);
  }
});

test('staging secret access contract is exact and fail closed',async()=>{
  const i=fixture();
  for (const patch of [{environment:'local_test'},{purpose:'local_test_readiness_validation'},
    {production_allowed:true},{exportable:true},{single_request:false}]) {
    const r=runtime(i); r.secretAccessContract={...r.secretAccessContract,...patch};
    const result=await executePublicWebThirdCanaryFinalLiveEntry(i,r,options);
    assert.equal(result.ok,false); assert.equal(result.reason,'official_runtime_wiring_required');
  }
});

test('scope drift and production fail closed before controlled runtime',async()=>{
  const a=fixture(); a.side_effect_boundary.execution_command.target_origin='https://other.example';
  assert.equal((await executePublicWebThirdCanaryFinalLiveEntry(a,runtime(a),options)).reason,'exact_third_canary_scope_required');
  const b=fixture(); b.production_allowed=true;
  assert.equal((await executePublicWebThirdCanaryFinalLiveEntry(b,runtime(b),options)).ok,false);
});

test('durable claim rejection never invokes runner',async()=>{
  const i=fixture(); let runnerCalls=0; const r=runtime(i);
  r.claimVerifier={verifyClaim:async()=>({ok:false})};
  r.runner={runCanaryRequest:async()=>{runnerCalls++;}};
  const result=await executePublicWebThirdCanaryFinalLiveEntry(i,r,options);
  assert.equal(result.ok,false); assert.equal(runnerCalls,0); assert.equal(result.external_network_called,false);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const { executePublicWebThirdCanaryControlledRuntime } =
  require('../src/core/public-web-canary-third-controlled-runtime-composition');

function command() {
  return {
    trial_id:'trial-3',official_authorization_id:'official-3',preparatory_authorization_id:'prep-3',
    grant_id:'grant-3',reservation_id:'reservation-3',environment:'staging',
    target_origin:'https://example.com',target_path:'/',method:'GET',port:443,
    maximum_requests:1,rollout_percentage:1,redirects_allowed:false,production_allowed:false,
    confirmed_at:'2026-09-23T00:00:00.000Z',confirmation_maximum_age_ms:120000,
    single_use:true,execution_started:false,external_network_called:false
  };
}
function digest(c) {
  return computeCanonicalContentDigest([
    c.trial_id,c.official_authorization_id,c.preparatory_authorization_id,c.grant_id,c.reservation_id,
    c.environment,c.target_origin,c.target_path,c.method,c.port,c.maximum_requests,c.rollout_percentage,
    c.redirects_allowed,c.production_allowed,c.confirmed_at,c.confirmation_maximum_age_ms,c.single_use
  ]);
}
function fixture() {
  const c=command();
  return {
    production_allowed:false,maximum_requests:1,execute:true,
    side_effect_boundary:{ok:true,status:'THIRD_CANARY_SIDE_EFFECT_BOUNDARY_READY_COMMAND_PREPARED_NOT_EXECUTED',side_effect_boundary_ready:true,execution_command_prepared:true,execution_started:false,external_network_called:false,production_allowed:false,execution_command:c},
    execution_claim:{ok:true,status:'THIRD_CANARY_DURABLE_EXECUTION_CLAIMED_NOT_STARTED_NOT_EXECUTED',execution_claimed:true,execution_started:false,provider_invoked:false,transport_invoked:false,external_network_called:false,production_allowed:false,trial_id:c.trial_id,reservation_id:c.reservation_id,command_fingerprint:digest(c)},
    runtime_binding:{canary_session_id:'session-3',canary_execution_id:'reservation-3',change_id:'change-3',trace_id:'trace-3',request_id:'request-3'}
  };
}
function dependencies(i, counters) {
  return {
    claimVerifier:{verifyClaim:async()=>{counters.verify++;const c=i.side_effect_boundary.execution_command;return {ok:true,trial_id:c.trial_id,reservation_id:c.reservation_id,command_fingerprint:digest(c),state:'CLAIMED',production_allowed:false};}},
    runner:{runCanaryRequest:async()=>{counters.runner++;return {status:'public_web_candidate_success',provider_invoked:true,transport_invoked:true,external_network_called:true};}}
  };
}
const options={clock:()=> '2026-09-23T00:01:00.000Z'};

test('composes exact durable claim and controlled runner once',async()=>{
  const i=fixture(), counters={verify:0,runner:0};
  const r=await executePublicWebThirdCanaryControlledRuntime(i,dependencies(i,counters),options);
  assert.equal(r.ok,true); assert.equal(counters.verify,1); assert.equal(counters.runner,1);
  assert.equal(r.trial_id,'trial-3'); assert.equal(r.reservation_id,'reservation-3');
});

test('identity drift blocks before claim verifier and runner',async()=>{
  const i=fixture(); i.runtime_binding.canary_execution_id='other';
  const counters={verify:0,runner:0};
  const r=await executePublicWebThirdCanaryControlledRuntime(i,dependencies(i,counters),options);
  assert.equal(r.ok,false); assert.equal(counters.verify,0); assert.equal(counters.runner,0);
  assert.equal(r.external_network_called,false);
});

test('missing dependencies fail closed before runner',async()=>{
  const i=fixture();
  assert.equal((await executePublicWebThirdCanaryControlledRuntime(i,{},options)).ok,false);
  assert.equal((await executePublicWebThirdCanaryControlledRuntime(i,{claimVerifier:{verifyClaim:async()=>({ok:true})}},options)).ok,false);
});

test('invalid production or request count never reaches verifier or runner',async()=>{
  for (const mutate of [x=>{x.production_allowed=true;},x=>{x.maximum_requests=2;},x=>{x.execute=false;}]) {
    const i=fixture(); mutate(i); const counters={verify:0,runner:0};
    const r=await executePublicWebThirdCanaryControlledRuntime(i,dependencies(i,counters),options);
    assert.equal(r.ok,false); assert.equal(counters.verify,0); assert.equal(counters.runner,0);
  }
});

test('durable verifier rejection blocks controlled runner',async()=>{
  const i=fixture(); let runner=0;
  const r=await executePublicWebThirdCanaryControlledRuntime(i,{
    claimVerifier:{verifyClaim:async()=>({ok:false})},
    runner:{runCanaryRequest:async()=>{runner++;}}
  },options);
  assert.equal(r.ok,false); assert.equal(runner,0); assert.equal(r.external_network_called,false);
});

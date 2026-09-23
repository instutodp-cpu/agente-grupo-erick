'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { preparePublicWebThirdCanaryFinalLiveEntry } =
  require('../src/core/public-web-canary-third-final-live-entry');

function input() {
  return {
    production_allowed:false,maximum_requests:1,execution_started:false,external_network_called:false,
    side_effect_boundary:{ok:true,status:'THIRD_CANARY_SIDE_EFFECT_BOUNDARY_READY_COMMAND_PREPARED_NOT_EXECUTED',
      execution_started:false,external_network_called:false,
      execution_command:{trial_id:'trial-249',reservation_id:'reservation-249',environment:'staging',
        target_origin:'https://example.com',target_path:'/',method:'GET',port:443,maximum_requests:1,
        rollout_percentage:1,redirects_allowed:false,production_allowed:false,single_use:true}}
  };
}
function wiring() {
  return {official:true,production_allowed:false,maximum_requests:1,
    runner_factory_id:'public_web_canary_runner',
    claim_verifier_id:'durable_execution_claim_verifier',
    feature_flag_resolver_id:'public_web_dynamic_feature_flag',
    kill_switch_resolver_id:'public_web_dynamic_kill_switch',
    secret_access_contract:{environment:'staging',purpose:'public_web_canary_execution',
      production_allowed:false,exportable:false,single_request:true}};
}

test('prepares exact final live-entry wiring without starting execution',()=>{
  const r=preparePublicWebThirdCanaryFinalLiveEntry(input(),wiring());
  assert.equal(r.ok,true);
  assert.equal(r.status,'THIRD_CANARY_FINAL_LIVE_ENTRY_WIRING_READY_NOT_STARTED');
  assert.equal(r.execution_started,false); assert.equal(r.provider_invoked,false);
  assert.equal(r.transport_invoked,false); assert.equal(r.external_network_called,false);
  assert.equal(r.requires_fresh_human_authorization_at_side_effect_boundary,true);
});

test('missing or unofficial wiring fails closed',()=>{
  for (const w of [{},{...wiring(),official:false},{...wiring(),runner_factory_id:'fake'},
    {...wiring(),claim_verifier_id:'fake'},{...wiring(),feature_flag_resolver_id:'fake'},
    {...wiring(),kill_switch_resolver_id:'fake'}]) {
    const r=preparePublicWebThirdCanaryFinalLiveEntry(input(),w);
    assert.equal(r.ok,false); assert.equal(r.execution_started,false); assert.equal(r.external_network_called,false);
  }
});

test('staging secret access contract is exact and fail closed',()=>{
  for (const patch of [{environment:'local_test'},{purpose:'local_test_readiness_validation'},
    {production_allowed:true},{exportable:true},{single_request:false}]) {
    const w=wiring(); w.secret_access_contract={...w.secret_access_contract,...patch};
    const r=preparePublicWebThirdCanaryFinalLiveEntry(input(),w);
    assert.equal(r.ok,false); assert.equal(r.reason,'official_runtime_wiring_contract_required');
  }
});

test('scope drift fails closed',()=>{
  for (const mutate of [
    x=>{x.side_effect_boundary.execution_command.target_origin='https://other.example';},
    x=>{x.side_effect_boundary.execution_command.target_path='/other';},
    x=>{x.side_effect_boundary.execution_command.maximum_requests=2;},
    x=>{x.side_effect_boundary.execution_command.production_allowed=true;},
    x=>{x.side_effect_boundary.execution_command.redirects_allowed=true;}
  ]) {
    const i=input(); mutate(i);
    const r=preparePublicWebThirdCanaryFinalLiveEntry(i,wiring());
    assert.equal(r.ok,false); assert.equal(r.external_network_called,false);
  }
});

test('readiness input cannot claim execution already started',()=>{
  const i=input(); i.execution_started=true;
  const r=preparePublicWebThirdCanaryFinalLiveEntry(i,wiring());
  assert.equal(r.ok,false); assert.equal(r.reason,'non_executing_single_request_readiness_input_required');
});

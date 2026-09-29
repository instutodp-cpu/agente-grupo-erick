'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSecretAccessContext } = require('../src/pilots/public-web-canary-runner');

function input() { return { trace_id:'trace-250', request_id:'request-250' }; }
function session(environment='staging') {
  return {
    configuration_id:'configuration-250', connector_id:'connector-250', provider_id:'provider-250',
    adapter_id:'adapter-250', workspace_type:'organization', tenant_id:'grupo_erick',
    operator_id:'operator-250', environment
  };
}
function contract() {
  return {
    environment:'staging', purpose:'public_web_canary_execution',
    production_allowed:false, exportable:false, single_request:true
  };
}

test('staging secret access requires exact explicit contract',()=>{
  const result=buildSecretAccessContext(input(),session(),{secretAccessContract:contract()});
  assert.equal(result.environment,'staging');
  assert.equal(result.purpose,'public_web_canary_execution');
  assert.equal(result.production_allowed,false);
  assert.equal(result.exportable,false);
  assert.equal(result.single_request,true);
  assert.equal(result.executed,false);
  assert.equal(result.real_provider_called,false);
});

test('staging fails closed when secret access contract is missing or drifts',()=>{
  assert.equal(buildSecretAccessContext(input(),session(),{}),null);
  for (const patch of [
    {environment:'local_test'},
    {purpose:'local_test_readiness_validation'},
    {production_allowed:true},
    {exportable:true},
    {single_request:false}
  ]) {
    assert.equal(buildSecretAccessContext(input(),session(),{
      secretAccessContract:{...contract(),...patch}
    }),null);
  }
});

test('legacy local_test readiness context remains unchanged',()=>{
  const result=buildSecretAccessContext(input(),session('local_test'),{});
  assert.equal(result.environment,'local_test');
  assert.equal(result.purpose,'local_test_readiness_validation');
  assert.equal(result.executed,false);
  assert.equal(result.real_provider_called,false);
});

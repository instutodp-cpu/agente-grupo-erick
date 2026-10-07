'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { parseArgs, preflightOperationalCanary, executeOperationalCanary } = require('../scripts/public-web-canary-real-non-production');

function blockedRuntime(overrides={}) {
  return { operationalBootstrapConfigured:true, stagingRealTransportOptIn:true, environment:'staging', production:false,
    production_allowed:false, maximum_requests:1, rollout_percentage:1,
    featureFlagResolver: async()=>false, killSwitchResolver: async()=>false,
    ...Object.fromEntries(['canarySessionRegistry','targetAllowlist','adapterRegistry','lifecycleRegistry','configurationRegistry','secretReferenceRegistry','secretResolver','readinessResult','rateLimitBudget','costBudget','operatorPolicy','auditSink'].map(k=>[k,{}])),
    clock:()=>new Date('2026-09-18T15:02:00.000Z'), ...overrides };
}

test('CLI accepts only a bootstrap path and no authority overrides',()=>{
  assert.equal(parseArgs([]).ok,true);
  assert.equal(parseArgs(['--bootstrap','./x.js']).ok,true);
  assert.equal(parseArgs(['--preflight']).preflight,true);
  assert.equal(parseArgs(['--bootstrap','./x.js','--preflight']).preflight,true);
  for (const args of [['--url','https://example.com'],['--token','x'],['--production'],['--yes'],['--bootstrap']]) assert.equal(parseArgs(args).ok,false);
});

test('missing bootstrap is dormant and cannot execute',async()=>{
  const r=await executeOperationalCanary({bootstrap:null,confirmationReader:async()=>{throw new Error('must not ask');}});
  assert.equal(r.ok,false); assert.equal(r.status,'operational_bootstrap_not_configured'); assert.equal(r.executed,false);
});

test('feature flag defaults closed before confirmation or bridge',async()=>{
  let confirmed=false;
  const r=await executeOperationalCanary({bootstrap:{runtime:blockedRuntime()},confirmationReader:async()=>{confirmed=true;return 'EXECUTAR CANARY PUBLIC WEB';}});
  assert.equal(r.status,'feature_flag_disabled'); assert.equal(confirmed,false); assert.equal(r.executed,false);
});

test('kill switch blocks before human confirmation or bridge',async()=>{
  let confirmed=false;
  const r=await executeOperationalCanary({bootstrap:{runtime:blockedRuntime({featureFlagResolver:async()=>true,killSwitchResolver:async()=>true})},confirmationReader:async()=>{confirmed=true;return 'EXECUTAR CANARY PUBLIC WEB';}});
  assert.equal(r.status,'kill_switch_active'); assert.equal(confirmed,false); assert.equal(r.executed,false);
});

test('wrong human phrase blocks before bridge',async()=>{
  const r=await executeOperationalCanary({bootstrap:{runtime:blockedRuntime({featureFlagResolver:async()=>true})},confirmationReader:async()=> 'NAO'});
  assert.equal(r.status,'exact_human_confirmation_required'); assert.equal(r.executed,false);
});


test('preflight proves controls without confirmation, secret resolution, or network',async()=>{
  let auditReady=0, resolved=0;
  const runtime=blockedRuntime({featureFlagResolver:async()=>true,killSwitchResolver:async()=>false,requireDurableAudit:true,
    auditSink:{durable:true,appendDurably:async()=>({ok:true}),ensureReady:async()=>{auditReady++;return {ok:true};}},
    secretResolver:{resolve:async()=>{resolved++;throw new Error('must not resolve');}}});
  const r=await preflightOperationalCanary({bootstrap:{runtime}});
  assert.equal(r.ok,true); assert.equal(r.ready,true); assert.equal(auditReady,1); assert.equal(resolved,0);
  assert.equal(r.network_called,false); assert.equal(r.secret_resolved,false); assert.equal(r.execution_started,false);
});

test('preflight blocks when durable audit is not operationally ready',async()=>{
  const runtime=blockedRuntime({featureFlagResolver:async()=>true,requireDurableAudit:true,
    auditSink:{durable:true,appendDurably:async()=>({ok:true}),ensureReady:async()=>{throw new Error('db unavailable');}},
    secretResolver:{resolve:async()=> 'never'} });
  const r=await preflightOperationalCanary({bootstrap:{runtime}});
  assert.equal(r.ok,false); assert.equal(r.status,'OPERATIONAL_CANARY_PREFLIGHT_BLOCKED');
  assert.equal(r.checks.find(x=>x.check==='durable_audit_ready').ok,false);
});

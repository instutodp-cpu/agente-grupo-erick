'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function load({runtime, readiness}) {
  const original = Module._load;
  Module._load = function(request,parent,isMain) {
    if (request.endsWith('hermes-maintainer-trusted-e2e-runtime-composition')) return {createHermesMaintainerTrustedE2eRuntimeComposition:()=>runtime};
    if (request.endsWith('hermes-maintainer-final-e2e-readiness')) return {deriveHermesMaintainerFinalE2eReadiness:()=>readiness};
    return original(request,parent,isMain);
  };
  try {
    const path=require.resolve('../src/runtime/hermes-maintainer-trusted-e2e-staging-canary-entry');
    delete require.cache[path];
    return require(path);
  } finally { Module._load=original; }
}

const safeRuntime = overrides => ({
  environment:'staging', production_allowed:false, merge_authority:false, human_merge_required:true,
  async execute(workflow){ return {completed:true,workflow}; }, ...overrides
});

test('requires explicit trusted E2E canary confirmation', async()=>{
  const m=load({runtime:safeRuntime(),readiness:{execution_ready:true,trusted_runtime_ready:true}});
  await assert.rejects(()=>m.runHermesMaintainerTrustedE2eStagingCanary({input:{workflow:{}}}),/explicit_canary_confirmation_required/);
});

test('runs only a ready trusted staging runtime and preserves human-only merge', async()=>{
  const m=load({runtime:safeRuntime(),readiness:{execution_ready:true,trusted_runtime_ready:true}});
  const result=await m.runHermesMaintainerTrustedE2eStagingCanary({input:{confirmation:m.CONFIRMATION,workflow:{marker:'canary'}}});
  assert.equal(result.status,'TRUSTED_E2E_STAGING_CANARY_COMPLETED');
  assert.equal(result.completed,true);
  assert.equal(result.production_used,false);
  assert.equal(result.merge_authority,false);
  assert.equal(result.human_merge_required,true);
  assert.deepEqual(result.workflow_outcome.workflow,{marker:'canary'});
});

test('fails closed when final readiness is not ready', async()=>{
  const runtime=safeRuntime({execute:async()=>{throw new Error('must_not_execute');}});
  const m=load({runtime,readiness:{execution_ready:false,trusted_runtime_ready:false}});
  await assert.rejects(()=>m.runHermesMaintainerTrustedE2eStagingCanary({input:{confirmation:m.CONFIRMATION,workflow:{}}}),/trusted_e2e_runtime_not_ready/);
});

for (const override of [{environment:'production'},{production_allowed:true},{merge_authority:true},{human_merge_required:false}]) {
  test('fails closed for unsafe runtime boundary '+JSON.stringify(override), async()=>{
    const runtime=safeRuntime({...override,execute:async()=>{throw new Error('must_not_execute');}});
    const m=load({runtime,readiness:{execution_ready:true,trusted_runtime_ready:true}});
    await assert.rejects(()=>m.runHermesMaintainerTrustedE2eStagingCanary({input:{confirmation:m.CONFIRMATION,workflow:{}}}),/trusted_e2e_canary_boundary_invalid/);
  });
}

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

const entryPath=require.resolve('../src/runtime/hermes-maintainer-github-write-e2e-operational-entry');
const gatePath=require.resolve('../src/runtime/hermes-maintainer-github-write-operational-acceptance-gate');

function loadGate(result,onArgs=()=>{}){
 const savedEntry=require.cache[entryPath],savedGate=require.cache[gatePath];
 require.cache[entryPath]={id:entryPath,filename:entryPath,loaded:true,exports:{executeHermesMaintainerGithubWriteE2eOperationalEntry:async(...args)=>{onArgs(args);return result;}}};
 delete require.cache[gatePath];
 const loaded=require(gatePath);
 return {loaded,restore(){if(savedEntry)require.cache[entryPath]=savedEntry;else delete require.cache[entryPath];if(savedGate)require.cache[gatePath]=savedGate;else delete require.cache[gatePath];}};
}

const accepted={status:'E2E_DURABLE_WRITE_CLOSURE_CONFIRMED',closure_valid:true,durable:true,execution:{status:'GITHUB_DURABLE_WRITE_EXECUTION_SUCCEEDED'},receipt:{status:'GITHUB_WRITE_DURABLE_FINALIZATION_CONFIRMED',receipt_valid:true},network_call_performed:true,write_performed:true,production_used:false};

test('acceptance gate preserves inputs and certifies real durable closure shape',async()=>{
 const grant={},canary={},input={},options={};const h=loadGate(accepted,args=>assert.deepEqual(args,[grant,canary,input,options]));
 try{const r=await h.loaded.executeHermesMaintainerGithubWriteOperationalAcceptanceGate(grant,canary,input,options);assert.equal(r.status,'OPERATIONAL_ACCEPTANCE_CONFIRMED');assert.equal(r.execution_status,accepted.execution.status);assert.equal(r.receipt_status,accepted.receipt.status);}finally{h.restore();}
});

for(const [name,patch] of [
 ['invalid closure',{closure_valid:false}],
 ['invalid execution',{execution:{status:'OTHER'}}],
 ['invalid receipt',{receipt:{status:'OTHER',receipt_valid:true}}],
 ['invalid receipt validity',{receipt:{status:'GITHUB_WRITE_DURABLE_FINALIZATION_CONFIRMED',receipt_valid:false}}],
 ['missing network write',{network_call_performed:false}],
 ['missing provider write',{write_performed:false}],
 ['production result',{production_used:true}]
]){
 test('acceptance gate fails closed on '+name,async()=>{
  const h=loadGate({...accepted,...patch});
  try{await assert.rejects(()=>h.loaded.executeHermesMaintainerGithubWriteOperationalAcceptanceGate({},{},{}),/operational_acceptance_failed/);}finally{h.restore();}
 });
}

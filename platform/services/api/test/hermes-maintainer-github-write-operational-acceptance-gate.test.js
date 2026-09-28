'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

const entryPath=require.resolve('../src/runtime/hermes-maintainer-github-write-e2e-operational-entry');
const gatePath=require.resolve('../src/runtime/hermes-maintainer-github-write-operational-acceptance-gate');

function loadGate(result){
 const savedEntry=require.cache[entryPath],savedGate=require.cache[gatePath];
 require.cache[entryPath]={id:entryPath,filename:entryPath,loaded:true,exports:{executeHermesMaintainerGithubWriteE2eOperationalEntry:async()=>result}};
 delete require.cache[gatePath];
 const loaded=require(gatePath);
 return {loaded,restore(){if(savedEntry)require.cache[entryPath]=savedEntry;else delete require.cache[entryPath];if(savedGate)require.cache[gatePath]=savedGate;else delete require.cache[gatePath];}};
}

const accepted={status:'E2E_DURABLE_WRITE_CLOSURE_CONFIRMED',closure_valid:true,durable:true,execution_status:'GITHUB_DURABLE_WRITE_EXECUTION_SUCCEEDED',receipt_status:'GITHUB_WRITE_DURABLE_FINALIZATION_CONFIRMED',receipt_valid:true,network_call_performed:true,write_performed:true,production_used:false};

test('acceptance gate certifies exact durable operational result',async()=>{
 const h=loadGate(accepted);
 try{const r=await h.loaded.executeHermesMaintainerGithubWriteOperationalAcceptanceGate({});assert.equal(r.status,'OPERATIONAL_ACCEPTANCE_CONFIRMED');assert.equal(r.accepted,true);assert.equal(r.durable,true);assert.equal(r.production_used,false);}finally{h.restore();}
});

test('acceptance gate fails closed on invalid closure',async()=>{
 const h=loadGate({...accepted,closure_valid:false});
 try{await assert.rejects(()=>h.loaded.executeHermesMaintainerGithubWriteOperationalAcceptanceGate({}),/operational_acceptance_failed/);}finally{h.restore();}
});

test('acceptance gate fails closed on production result',async()=>{
 const h=loadGate({...accepted,production_used:true});
 try{await assert.rejects(()=>h.loaded.executeHermesMaintainerGithubWriteOperationalAcceptanceGate({}),/operational_acceptance_failed/);}finally{h.restore();}
});

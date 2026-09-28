'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');

function loadEntry({readiness,runtime}){
 const readinessPath=require.resolve('../src/runtime/hermes-maintainer-github-write-e2e-runtime-readiness');
 const runtimePath=require.resolve('../src/runtime/hermes-maintainer-github-write-e2e-process-runtime');
 const entryPath=require.resolve('../src/runtime/hermes-maintainer-github-write-e2e-operational-entry');
 const savedReadiness=require.cache[readinessPath],savedRuntime=require.cache[runtimePath],savedEntry=require.cache[entryPath];
 require.cache[readinessPath]={id:readinessPath,filename:readinessPath,loaded:true,exports:{checkHermesMaintainerGithubWriteE2eRuntimeReadiness:readiness}};
 require.cache[runtimePath]={id:runtimePath,filename:runtimePath,loaded:true,exports:{createHermesMaintainerGithubWriteE2eProcessRuntime:runtime}};
 delete require.cache[entryPath];
 const loaded=require(entryPath);
 return {loaded,restore(){if(savedReadiness)require.cache[readinessPath]=savedReadiness;else delete require.cache[readinessPath];if(savedRuntime)require.cache[runtimePath]=savedRuntime;else delete require.cache[runtimePath];if(savedEntry)require.cache[entryPath]=savedEntry;else delete require.cache[entryPath];}};
}

test('operational entry blocks before runtime execution when readiness is blocked',async()=>{
 let created=0;
 const h=loadEntry({readiness:async()=>({status:'BLOCKED',ready:false}),runtime:()=>{created++;}});
 try{await assert.rejects(()=>h.loaded.executeHermesMaintainerGithubWriteE2eOperationalEntry({}),/e2e_runtime_not_ready/);assert.equal(created,0);}finally{h.restore();}
});

test('operational entry executes official runtime and closes it',async()=>{
 let closed=0;const input={authorized:true};const result={status:'ok'};
 const h=loadEntry({readiness:async()=>({status:'READY',ready:true}),runtime:()=>({execute:async value=>{assert.equal(value,input);return result;},close:async()=>{closed++;}})});
 try{assert.equal(await h.loaded.executeHermesMaintainerGithubWriteE2eOperationalEntry(input),result);assert.equal(closed,1);}finally{h.restore();}
});

test('operational entry closes runtime when execution fails',async()=>{
 let closed=0;
 const h=loadEntry({readiness:async()=>({status:'READY',ready:true}),runtime:()=>({execute:async()=>{throw new Error('execution_failed');},close:async()=>{closed++;}})});
 try{await assert.rejects(()=>h.loaded.executeHermesMaintainerGithubWriteE2eOperationalEntry({}),/execution_failed/);assert.equal(closed,1);}finally{h.restore();}
});

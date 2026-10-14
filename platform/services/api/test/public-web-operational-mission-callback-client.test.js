'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const { createPublicWebOperationalMissionCallbackClient }=require('../src/adapters/public-web/public-web-operational-mission-callback-client');

function envelope(){return {version:'hermes_operational_mission_callback_v1',provider:'hermes_public_web_staging',environment:'staging',production_effect:'ZERO',simulated:false,mission_id:'m1',mission_run_id:'r1',contract_hash:`sha256:${'a'.repeat(64)}`,inbox_id:'i1',execution_id:'e1',request_id:'q1',status:'concluida',result_summary:'ok',error_code:null,cost_units:0,occurred_at:'2026-10-14T22:40:00.000Z'};}
function tokenFile(t,mode=0o600){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-callback-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'token');fs.writeFileSync(file,'x'.repeat(48),{mode});fs.chmodSync(file,mode);return file;}

test('callback client uses protected bearer, blocks redirects, and validates bound acknowledgement',async t=>{
  const file=tokenFile(t);let options;
  const client=createPublicWebOperationalMissionCallbackClient({endpoint:'https://maestro.example.test/functions/missionHermesCallback',tokenFile:file,fetchImpl:async(_url,o)=>{options=o;return {status:200,json:async()=>({ok:true,status:'HERMES_OPERATIONAL_MISSION_CALLBACK_APPLIED',acknowledged:true,idempotent:false,production_allowed:false,mission_id:'m1',mission_run_id:'r1',contract_hash:`sha256:${'a'.repeat(64)}`,execution_id:'e1'})};}});
  const result=await client.send(envelope());
  assert.equal(result.ok,true);assert.equal(result.acknowledged,true);assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.match(options.headers.Authorization,/^Bearer /);assert.equal(options.body.includes('x'.repeat(32)),false);
});

test('callback client fails closed on permissive token file without calling network',async t=>{
  const file=tokenFile(t,0o644);let calls=0;
  const client=createPublicWebOperationalMissionCallbackClient({endpoint:'https://maestro.example.test/functions/missionHermesCallback',tokenFile:file,fetchImpl:async()=>{calls+=1;throw new Error('must not call');}});
  const result=await client.send(envelope());assert.equal(result.ok,false);assert.equal(result.reason,'callback_credential_unavailable');assert.equal(calls,0);
});

test('callback client rejects identity drift in acknowledgement',async t=>{
  const file=tokenFile(t);
  const client=createPublicWebOperationalMissionCallbackClient({endpoint:'https://maestro.example.test/functions/missionHermesCallback',tokenFile:file,fetchImpl:async()=>({status:200,json:async()=>({ok:true,status:'HERMES_OPERATIONAL_MISSION_CALLBACK_APPLIED',acknowledged:true,production_allowed:false,mission_id:'m1',mission_run_id:'other',contract_hash:`sha256:${'a'.repeat(64)}`,execution_id:'e1'})})});
  const result=await client.send(envelope());assert.equal(result.ok,false);assert.equal(result.reason,'callback_acknowledgement_invalid');
});

test('callback endpoint must be exact safe https configuration and never comes from mission payload',()=>{
  assert.throws(()=>createPublicWebOperationalMissionCallbackClient({endpoint:'http://maestro.example.test/callback',tokenFile:'/tmp/x'}),/callback_endpoint_invalid/);
  assert.throws(()=>createPublicWebOperationalMissionCallbackClient({endpoint:'https://user:pass@maestro.example.test/callback',tokenFile:'/tmp/x'}),/callback_endpoint_invalid/);
  assert.throws(()=>createPublicWebOperationalMissionCallbackClient({endpoint:'https://maestro.example.test/callback?q=1',tokenFile:'/tmp/x'}),/callback_endpoint_invalid/);
});

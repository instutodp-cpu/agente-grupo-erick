'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildUpdateA3,buildPullA3}=require('./helpers/a3-maintenance-operation-test-data');
const {recordFor}=require('./helpers/a3-mission-origin-test-evidence');
const {createHermesMaintainerMaestroMissionRunReader,VERIFY_A3_OPERATION}=require('../src/runtime/hermes-maintainer-maestro-missionrun-reader');
const {createHermesMaintainerA3MissionSourceVerifier}=require('../src/core/hermes-maintainer-a3-mission-source-verification');
const HASH='sha256:'+'c'.repeat(64);
const getQuery=d=>{
 const i=d.eligibilityInput,a=i.source_evidence.single_use_authorization,g=i.source_evidence.authorization_grant;
 return {mission_id:a.mission_id,operation:i.operation,repository:'instutodp-cpu/agente-grupo-erick',environment:'staging',
  target_digest:i.target_reference.target_digest,intent_digest:i.action_intent_digest,
  approval_reference:i.source_evidence.approval_binding.approval_reference,
  authorization_reference:g.authorization_reference,single_use_authorization_id:a.authorization_id};
};
const run=q=>{
 const issued='2026-10-20T11:30:00.000Z';
 const contract={contract_version:'1.0',mission_id:q.mission_id,workspace_id:'workspace-unit-1',
  idempotency_key:'official-test-key',requested_by:{tipo:'usuario',id:'human-test'},
  metadata:{tipo:'desenvolver',emitted_by:'human-test',issued_at:issued},
  approval_policy:'requer_aprovacao',allowed_tools:['github_api'],
  denied_actions:['merge','publish','production'],callback:null};
 return {id:'mission-run-unit-1',espaco_id:'workspace-unit-1',mission_id:q.mission_id,
  status:'em_execucao',dispatch_simulado:false,contract_hash:HASH,
  issued_at:'2026-10-20T11:30:25.000Z',idempotency_key:'official-test-key',emitted_by:'dispatch-actor-test',
  contrato_json:JSON.stringify(contract)};
};
function gateway(d,override={}){
 const query=getQuery(d),r=run(query),record=recordFor(d.eligibilityInput);
 const calls=[];
 const proof=recordFor(d.eligibilityInput,{mission_run_id:r.id});
 return{calls,query,r,proof,invokeMissionGateway:async body=>{
  calls.push(body.operation);
  if(body.operation==='list_runs')return {runs:override.runs??[r]};
  if(body.operation==='verify_integrity')return override.integrity??{ok:true,expected:HASH,actual:HASH};
  if(body.operation===VERIFY_A3_OPERATION){
   if(override.noAttestation)return {error:'Operação inválida'};
   return override.proof??{verified:true,source:'MISSION_GATEWAY_DURABLE',mission_run_id:r.id,
    operation:query.operation,record:proof};
  }
  return null;
 }};
}
for(const make of [buildUpdateA3,buildPullA3]){
 const d=make(),op=d.eligibilityInput.operation;
 test(op+' accepts only an independently verified, exact gateway attestation',async()=>{
  const gw=gateway(d),reader=createHermesMaintainerMaestroMissionRunReader(gw);
  assert.equal(reader.configured,true);
  const record=await reader.readMissionRun(gw.query);
  assert.equal(record.mission_run_id,gw.r.id);
  const sourceEnvelope=await reader.readMissionRunEvidence(gw.query);
  assert.equal(sourceEnvelope?.workspace_id,gw.r.espaco_id);
  assert.equal(sourceEnvelope?.record?.mission_run_id,gw.r.id);
  assert.equal(Object.keys(sourceEnvelope).sort().join('|'),'record|workspace_id');
  assert.deepEqual(gw.calls,Array(2).fill(['list_runs','verify_integrity',VERIFY_A3_OPERATION]).flat());
  const result=await createHermesMaintainerA3MissionSourceVerifier({readMissionRun:reader.readMissionRun}).verify(d.eligibilityInput);
  assert.equal(result.verified,true);
 });

 test(op+' accepts completed simulation only after authenticated official A3 gateway attestation',async()=>{
  const d=make(),q=getQuery(d);
  const simulated={...run(q),status:'concluida',dispatch_simulado:true,dispatch_token:'official-dispatch-token'};
  const gw=gateway(d,{runs:[simulated]});
  const reader=createHermesMaintainerMaestroMissionRunReader(gw);
  const signedGatewayRecord=await reader.readMissionRun(q);
  assert.equal(signedGatewayRecord?.mission_run_id,simulated.id);
  assert.deepEqual(gw.calls,['list_runs','verify_integrity',VERIFY_A3_OPERATION]);
  const invalid=gateway(d,{runs:[simulated],noAttestation:true});
  assert.equal(await createHermesMaintainerMaestroMissionRunReader(invalid).readMissionRun(q),null);
  assert.deepEqual(invalid.calls,['list_runs','verify_integrity',VERIFY_A3_OPERATION]);
 });
 test(op+' fails closed if A3 endpoint does not exist despite valid dispatch hash',async()=>{
  const gw=gateway(d,{noAttestation:true}),reader=createHermesMaintainerMaestroMissionRunReader(gw);
  assert.equal(await reader.readMissionRun(gw.query),null);
  assert.equal(await reader.readMissionRunEvidence(gw.query),null);
  assert.deepEqual(gw.calls,Array(2).fill(['list_runs','verify_integrity',VERIFY_A3_OPERATION]).flat());
  assert.equal((await createHermesMaintainerA3MissionSourceVerifier({readMissionRun:reader.readMissionRun}).verify(d.eligibilityInput)).verified,false);
 });
 test(op+' rejects missing privileges, ambiguous missions, hash mismatch or forged proof',async()=>{
  const q=getQuery(d);
  assert.equal(await createHermesMaintainerMaestroMissionRunReader().readMissionRun(q),null);
  assert.equal(await createHermesMaintainerMaestroMissionRunReader({invokeMissionGateway:async()=>({})}).readMissionRun(q),null);
  const invalid=[
   {runs:[]},{runs:[run(q),run(q)]},
   {runs:[{...run(q),mission_id:'different'}]},
   {runs:[{...run(q),dispatch_simulado:true}]},
   {runs:[{...run(q),dispatch_simulado:true,status:'concluida'}]},
   {runs:[{...run(q),dispatch_simulado:true,status:'concluida',dispatch_token:''}]},
   {runs:[{...run(q),emitted_by:''}]},
   {runs:[{...run(q),issued_at:'2026-10-20T11:29:59.000Z'}]},
   {runs:[{...run(q),issued_at:'2026-10-20T11:35:01.000Z'}]},
   {runs:[{...run(q),issued_at:'not-iso'}]},
   {runs:[{...run(q),espaco_id:'different-workspace'}]},
   {runs:[{...run(q),contrato_json:JSON.stringify({
    ...JSON.parse(run(q).contrato_json),metadata:{tipo:'pesquisar',emitted_by:'human-test',
     issued_at:run(q).issued_at},allowed_tools:['public_web_read']})}]},
   {runs:[{...run(q),contrato_json:JSON.stringify({
    ...JSON.parse(run(q).contrato_json),denied_actions:['merge','publish']})}]},
   {runs:[{...run(q),contrato_json:JSON.stringify({
    ...JSON.parse(run(q).contrato_json),approval_policy:'automatica'})}]},
   {integrity:{ok:false,expected:HASH,actual:HASH}},
   {integrity:{ok:true,expected:'sha256:'+'a'.repeat(64),actual:HASH}},
   {proof:{verified:true,source:'LOCAL_RUNNER',mission_run_id:'mission-run-unit-1',operation:q.operation,record:{}}},
   {proof:{verified:true,source:'MISSION_GATEWAY_DURABLE',mission_run_id:'wrong',operation:q.operation,record:{}}}
  ];
  for(const opt of invalid){
   const gw=gateway(d,opt);
   assert.equal(await createHermesMaintainerMaestroMissionRunReader(gw).readMissionRun(q),null,JSON.stringify(Object.keys(opt)));
  }
  let reads=0;
  const reader=createHermesMaintainerMaestroMissionRunReader({invokeMissionGateway:async()=>{reads++;return{}}});
  assert.equal(await reader.readMissionRun({...q,environment:'production'}),null);
  assert.equal(await reader.readMissionRun({...q,target_digest:'invalid'}),null);
  assert.equal(reads,0);
 });
}

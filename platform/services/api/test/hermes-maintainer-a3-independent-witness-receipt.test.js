'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {computeCanonicalContentDigest}=require('../src/core/canonical-content-digest');
const {stablePayload}=require('../src/core/agent-identity-contract');
const {VERSION,PURPOSE,verifyIndependentWitnessReceipt:verify}=
 require('../src/runtime/hermes-maintainer-a3-independent-witness-receipt');
const kid='independent-staging-witness-qa';
const privateKey=crypto.generateKeyPairSync('ed25519');
const pub=privateKey.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64url');
const image='sha256:'+'8'.repeat(64),hash='sha256:'+'d'.repeat(64),rev='9'.repeat(40);
const digest='sha256:'+'3'.repeat(64);
const when='2026-10-20T23:48:18.000Z';
const controls=()=>({
 network_mode:'none',read_only_rootfs:true,read_only_source:true,
 cap_drop_all:true,no_new_privileges:true,privileged:false,
 docker_socket_mounted:false,secrets_mounted:false,
 host_network:false,host_pid:false,unprivileged_user:'65534:65534'
});
const official=()=>({
 workspace_id:'official-workspace',mission_id:'official-mission',
 mission_run_id:'official-run',official_outbox_id:'official-outbox',
 contract_hash:hash,revision_sha:rev,docker_image_id:image,
 operation:'update_file',repository:'instutodp-cpu/agente-grupo-erick',
 source:'MAESTRO_MISSION_GATEWAY_AUTHENTICATED',
 verified_contract_integrity:true,run_status:'na_fila',dispatch_simulado:true,
 outbox_status:'pending',outbox_provider:'mock',execution_authorized:false
});
const evidence=()=>({
 observation_type:'isolated_test_process_only',
 subprocess_passed:true,simulation_receipt_durable:false,
 independent_issuer_verified:false
});
const observation=()=>{
 const obs=evidence();return {
 ...official(),state:'process_observed',
 observation_evidence:obs,observation_digest:computeCanonicalContentDigest(obs),
 reserved_at:when,finished_at:'2026-10-20T23:48:20.000Z'
 };
};
const record=()=>({
 version:VERSION,issuer_id:kid,environment:'staging',
 ...Object.fromEntries(['workspace_id','mission_id','mission_run_id',
 'official_outbox_id','contract_hash','revision_sha','docker_image_id',
 'operation','repository'].map(k=>[k,official()[k]])),
 test_id:'hermes_core_smoke',
 process_observation_digest:observation().observation_digest,
 container_id:'a'.repeat(64),
 witness_started_at:'2026-10-20T23:48:18.500Z',
 witness_finished_at:'2026-10-20T23:48:19.500Z',
 issued_at:'2026-10-20T23:48:20.500Z',test_exit_code:0,
 scope:'isolated_test_container_only',controls:controls()
});
const sign=r=>({record:r,signature:crypto.sign(null,
 Buffer.from(PURPOSE+'\n'+stablePayload(r)),privateKey.privateKey).toString('base64url')});
const check=(r=record(),obs=observation(),source=official(),key=pub,issuer=kid)=>
 verify({envelope:sign(r),observation:obs,official:source,
 publicKeyB64Url:key,issuerId:issuer,now:()=>Date.parse('2026-10-20T23:48:21.000Z')});
test('independently signed bounded receipt verifies source and observation, but never grants authority',()=>{
 const res=check();
 assert.equal(res.verified,true);assert.equal(res.independent_issuer_verified,true);
 assert.match(res.receipt_digest,/^sha256:[a-f0-9]{64}$/);
 assert.equal(res.simulation_receipt_durable,false);
 assert.equal(res.execution_authorized,false);
 assert.equal(res.outbox_acknowledged,false);
 assert.equal(res.network_call_performed,null);
 assert.equal(res.scm_write_performed,null);
});
test('a signed statement cannot be backfilled later for a previously observed run',()=>{
 const r=record();r.issued_at='2026-10-20T23:59:00.000Z';
 assert.equal(check(r).verified,false);
});
test('enforces signed observation and exact MissionRun/outbox/contract/revision binding',()=>{
 const inputs=[
  ()=>[record(),{...observation(),state:'reserved'},official()],
  ()=>[record(),{...observation(),state:'failed_safe'},official()],
  ()=>[record(),{...observation(),observation_digest:digest},official()],
  ()=>[record(),{...observation(),observation_evidence:{...evidence(),subprocess_passed:false}},official()],
  ()=>[record(),observation(),{...official(),mission_run_id:'other-run'}],
  ()=>[record(),observation(),{...official(),contract_hash:'sha256:'+'1'.repeat(64)}],
  ()=>[{...record(),official_outbox_id:'wrong'},observation(),official()],
  ()=>[{...record(),revision_sha:'b'.repeat(40)},observation(),official()],
  ()=>[{...record(),docker_image_id:'sha256:'+'1'.repeat(64)},observation(),official()]
 ];
 for(const build of inputs){const [r,o,s]=build();assert.equal(check(r,o,s).verified,false);}
});
test('requires all independent supervisor isolation controls, no self-signed unpinned issuer',()=>{
 for(const patch of [
  {network_mode:'bridge'},{read_only_rootfs:false},
  {read_only_source:false},{cap_drop_all:false},
  {no_new_privileges:false},{privileged:true},
  {docker_socket_mounted:true},{secrets_mounted:true},
  {host_network:true},{host_pid:true},{unprivileged_user:'0:0'}
 ]){const r=record();r.controls={...r.controls,...patch};
  assert.equal(check(r).verified,false,JSON.stringify(patch));}
 const rogue=crypto.generateKeyPairSync('ed25519');
 const roguePub=rogue.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64url');
 assert.equal(check(record(),observation(),official(),roguePub).verified,false);
 assert.equal(check(record(),observation(),official(),pub,'untrusted-witness').verified,false);
});
test('witness must overlap reserved execution and signed receipt must follow execution',()=>{
 const changes=[
  {witness_started_at:'2026-10-20T23:48:17.000Z'},
  {witness_finished_at:'2026-10-20T23:48:16.000Z'},
  {witness_finished_at:'2026-10-20T23:48:45.000Z'},
  {issued_at:'2026-10-20T23:48:18.000Z'},
  {witness_started_at:'2026-10-20T23:48:18.500+00:00'}
 ];
 for(const patch of changes){assert.equal(check({...record(),...patch}).verified,false);}
});
test('signature and format mutation fail closed',()=>{
 const e=sign(record());
 for(const bad of [
  {...e,signature:(e.signature[0]==='A'?'B':'A')+e.signature.slice(1)},
  {...e,record:{...e.record,test_exit_code:1}},
  {...e,record:{...e.record,execution_authorized:true}}
 ])assert.equal(verify({envelope:bad,observation:observation(),
  official:official(),publicKeyB64Url:pub,issuerId:kid}).verified,false);
});

test('signed receipt remains verifiable after PostgreSQL JSONB key-order changes',()=>{
 const r=record(),original=sign(r);
 const reorder=v=>{
  if(Array.isArray(v))return v.map(reorder);
  if(v&&typeof v==='object')return Object.fromEntries(
   Object.keys(v).reverse().map(k=>[k,reorder(v[k])]));
  return v;
 };
 const sqlRoundtrip={...original,record:reorder(r)};
 const out=verify({
  envelope:sqlRoundtrip,observation:observation(),official:official(),
  publicKeyB64Url:pub,issuerId:kid,
  now:()=>Date.parse('2026-10-20T23:48:21.000Z')
 });
 assert.equal(out.verified,true);
 assert.equal(out.receipt_digest,computeCanonicalContentDigest(r));
});

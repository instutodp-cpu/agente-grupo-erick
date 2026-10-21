'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {computeCanonicalContentDigest}=require('../src/core/canonical-content-digest');
const {stablePayload}=require('../src/core/agent-identity-contract');
const {VERSION,PURPOSE,verifyIndependentWitnessReceipt}=require('../src/runtime/hermes-maintainer-a3-independent-witness-receipt');
const {READ_OBS,READ_WIT,READ_ATTEMPT,createHermesMaintainerA3IndependentWitnessReadAdmission}=
 require('../src/core/hermes-maintainer-a3-independent-witness-read-admission');
const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
const key=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64url');
const hash='sha256:'+'d'.repeat(64),image='sha256:'+'8'.repeat(64),sha='9'.repeat(40);
const env={
 HERMES_DEPLOYMENT_STAGE:'staging',
 HERMES_A3_INDEPENDENT_WITNESS_READ_ENABLED:'true',
 HERMES_EXECUTION_ENABLED:'false',
 HERMES_EXECUTION_KILL_SWITCH:'true',
 HERMES_MISSION_INGRESS_ENABLED:'false'
};
const official=()=>({
 workspace_id:'w',mission_id:'m',mission_run_id:'run',official_outbox_id:'o',
 contract_hash:hash,revision_sha:sha,docker_image_id:image,
 repository:'instutodp-cpu/agente-grupo-erick',operation:'update_file',
 source:'MAESTRO_MISSION_GATEWAY_AUTHENTICATED',
 verified_contract_integrity:true,run_status:'na_fila',dispatch_simulado:true,
 outbox_status:'pending',outbox_provider:'mock',execution_authorized:false
});
const observation=()=>{
 const evidence={observation_type:'isolated_test_process_only',
  subprocess_passed:true,simulation_receipt_durable:false,
  independent_issuer_verified:false};
 return {...official(),state:'process_observed',observation_evidence:evidence,
  observation_digest:computeCanonicalContentDigest(evidence),
  reserved_at:new Date('2026-10-20T23:48:18.000Z'),
  finished_at:new Date('2026-10-20T23:48:20.000Z')};
};
const receipt=(obs=observation())=>{
 const r={version:VERSION,issuer_id:'independent-witness',
  environment:'staging',...Object.fromEntries([
   'workspace_id','mission_id','mission_run_id','official_outbox_id',
   'contract_hash','revision_sha','docker_image_id','operation','repository'
  ].map(k=>[k,official()[k]])),
  test_id:'hermes_core_smoke',process_observation_digest:obs.observation_digest,
  container_id:'a'.repeat(64),witness_started_at:'2026-10-20T23:48:18.500Z',
  witness_finished_at:'2026-10-20T23:48:19.500Z',
  issued_at:'2026-10-20T23:48:20.500Z',test_exit_code:0,
  scope:'isolated_test_container_only',
  controls:{network_mode:'none',read_only_rootfs:true,read_only_source:true,
   cap_drop_all:true,no_new_privileges:true,privileged:false,
   docker_socket_mounted:false,secrets_mounted:false,host_network:false,
   host_pid:false,unprivileged_user:'65534:65534'}
 };
 const envelope={record:r,signature:crypto.sign(null,
  Buffer.from(PURPOSE+'\n'+stablePayload(r)),privateKey).toString('base64url')};
 return {...official(),issuer_id:'independent-witness',
  process_observation_digest:obs.observation_digest,
  receipt_digest:computeCanonicalContentDigest(r),
  receipt_envelope:envelope,
  witnessed_started_at:new Date(r.witness_started_at),
  witnessed_finished_at:new Date(r.witness_finished_at),
  issued_at:new Date(r.issued_at),
  committed_at:new Date('2026-10-20T23:48:21.000Z')};
};
function fixture(patches={}){
 const obs=patches.obs||observation(),wit=patches.wit||receipt(obs);
 const attempt=patches.attempt||{
  mission_run_id:'run',mission_id:'m',workspace_id:'w',
  official_outbox_id:'o',contract_hash:hash,revision_sha:sha,
  docker_image_id:image,environment:'staging',
  reserved_at:new Date('2026-10-20T23:48:18.250Z')
 };
 const calls=[],pool={query:async(sql,args)=>{
  calls.push([sql,args]);
  if(patches.failDb)throw Error('db unavailable');
  return {rows:sql===READ_OBS?patches.missingObs?[]:[obs]:
   sql===READ_WIT?patches.missingWitness?[]:[wit]:
   sql===READ_ATTEMPT?patches.missingAttempt?[]:[attempt]:[]};
 }};
 const reader=createHermesMaintainerA3IndependentWitnessReadAdmission({
  pool,verifyIndependentWitnessReceipt,publicKeyB64Url:patches.key||key,issuerId:'independent-witness',
  readOfficialMissionRun:async()=>{if(patches.failGateway)throw Error('outage');
   return patches.official||official()},
  environment:patches.env||env,
  now:()=>Date.parse('2026-10-20T23:48:21.000Z')});
 return {reader,calls};
}
test('durable, contemporaneous signed receipt is read-only and never authorizes effects',async()=>{
 const f=fixture(),r=await f.reader.readVerified('run');
 assert.equal(r.independently_attested,true);
 assert.equal(r.receipt_durable,true);
 assert.equal(r.execution_authorized,false);
 assert.equal(r.outbox_acknowledged,false);
 assert.equal(r.merge_authority,false);
 assert.equal(r.scm_write_performed,null);
 assert.deepEqual(f.calls.map(x=>x[0]),[READ_OBS,READ_WIT,READ_ATTEMPT]);
 assert.deepEqual(f.calls.map(x=>x[1]),[['run'],['run'],['run']]);
});
test('missing witness, official data, revoked scope and outages deny',async()=>{
 for(const patches of [{missingObs:true},{missingWitness:true},{missingAttempt:true},{failDb:true},
  {failGateway:true},{official:{...official(),official_outbox_id:'different'}},
  {official:{...official(),verified_contract_integrity:false}},
  {official:{...official(),run_status:'concluida'}},
  {official:{...official(),outbox_status:'acknowledged'}},
  {env:{...env,HERMES_EXECUTION_ENABLED:'true'}},{env:{}},
  {key:'A'.repeat(43)}]){
  const f=fixture(patches),r=await f.reader.readVerified('run');
  assert.equal(r.receipt_durable,false,JSON.stringify(patches));
  assert.equal(r.execution_authorized,false);
 }
});
test('ledger digest, issuer identity, chronological fields, and signed contents are exact',async()=>{
 for(const change of [
  w=>({...w,receipt_digest:'sha256:'+'1'.repeat(64)}),
  w=>({...w,issuer_id:'hermes'}),
  w=>({...w,witnessed_started_at:new Date('2026-10-20T23:48:18.999Z')}),
  w=>({...w,committed_at:new Date('2026-10-21T00:00:00.000Z')}),
  w=>({...w,receipt_envelope:{...w.receipt_envelope,
   record:{...w.receipt_envelope.record,mission_run_id:'other'}}})
 ]){
  const f=fixture({wit:change(receipt())}),r=await f.reader.readVerified('run');
  assert.equal(r.receipt_durable,false);
 }
});
test('migration 036 requires unique sealed receipts, staging-only permissions and a preexisting observed run',()=>{
 const ddl=fs.readFileSync(path.resolve(__dirname,
  '../../../migrations/hermes/036_create_maintainer_a3_independent_witness_receipts.sql'),'utf8');
 for(const s of ['mission_run_id TEXT PRIMARY KEY REFERENCES',
  'maintainer_a3_process_observations(mission_run_id)',
  'mission_id TEXT NOT NULL UNIQUE','official_outbox_id TEXT NOT NULL UNIQUE',
  'process_observation_digest TEXT NOT NULL UNIQUE',
  'receipt_digest TEXT NOT NULL UNIQUE','ENABLE ROW LEVEL SECURITY',
  'REVOKE ALL','witnessed_started_at<=witnessed_finished_at'])
  assert.ok(ddl.includes(s),s);
});

test('witness attempt readback must bind exact source and precede signed container creation',async()=>{
 const baseline=fixture();
 assert.equal((await baseline.reader.readVerified('run')).receipt_durable,true);
 const base={
  mission_run_id:'run',mission_id:'m',workspace_id:'w',
  official_outbox_id:'o',contract_hash:hash,revision_sha:sha,
  docker_image_id:image,environment:'staging',
  reserved_at:new Date('2026-10-20T23:48:18.250Z')
 };
 for(const mutation of [
  {contract_hash:'sha256:'+'a'.repeat(64)}, {revision_sha:'a'.repeat(40)},
  {official_outbox_id:'other'}, {docker_image_id:'sha256:'+'1'.repeat(64)},
  {workspace_id:'other'}, {environment:'production'},
  {reserved_at:new Date('2026-10-20T23:48:19.000Z')},
  {reserved_at:new Date('2026-10-20T23:40:18.250Z')},
  {reserved_at:new Date('2026-10-20T23:48:17.250Z')}
 ]){
  const x=fixture({attempt:{...base,...mutation}});
  assert.equal((await x.reader.readVerified('run')).receipt_durable,false,
   JSON.stringify(mutation));
 }
});

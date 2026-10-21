'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {FIELDS:SOURCE_FIELDS,VERSION:SOURCE_VERSION,KID}=
 require('../src/runtime/hermes-maintainer-maestro-signed-queue-snapshot');
const {computeCanonicalContentDigest}=require('../src/core/canonical-content-digest');
const {createIndependentA3Supervisor,inspectIsolation}=
 require('../../../independent-witness/supervisor');
const {createIndependentDockerDriver}=require('../../../independent-witness/docker-driver');
const {stablePayload}=require('../src/core/agent-identity-contract');
const {PURPOSE}=require('../src/runtime/hermes-maintainer-a3-independent-witness-receipt');
const sigKey=()=>crypto.generateKeyPairSync('ed25519');
const rawPub=k=>k.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64url');
const maestro=sigKey(),issuer=sigKey();
const q={environment:'staging',mission_id:'mission-fixture',operation:'update_file',
 repository:'instutodp-cpu/agente-grupo-erick',run_id:'run-fixture'};
const imageId='sha256:'+'8'.repeat(64),revision='9'.repeat(40),containerId='a'.repeat(64);
const sourceRoot='/opt/independent-witness/source/platform/services/api';
const baseTime=Date.parse('2026-10-20T23:48:18.000Z');
const evidence=()=>({
 observation_type:'isolated_test_process_only',
 subprocess_passed:true,simulation_receipt_durable:false,
 independent_issuer_verified:false,network_call_performed:null,scm_write_performed:null
});
function queueEnvelope(now=baseTime){
 const source={
 version:SOURCE_VERSION,source:'MAESTRO_MISSION_GATEWAY_AUTHENTICATED',
 environment:'staging',mission_run_id:q.run_id,mission_id:q.mission_id,
 workspace_id:'workspace-fixture',operation:'update_file',repository:q.repository,
 revision_sha:revision,contract_hash:'sha256:'+'d'.repeat(64),
 test_id:'hermes_core_smoke',run_status:'na_fila',dispatch_simulado:true,
 official_pre_run_approval_id:'pre-approval-fixture',
 official_outbox_id:'outbox-fixture',outbox_status:'pending',outbox_provider:'mock',
 verified_contract_integrity:true,simulated_run_queued:true,simulation_observed:false,
 receipt_durable:false,outbox_acknowledged:false,issuer_verified:false,
 approval_verified:false,execution_authorized:false,production_allowed:false,
 merge_authority:false
 };
 assert.deepEqual(Object.keys(source),SOURCE_FIELDS);
 const canonical_record_json=JSON.stringify(source);
 const issued_at=new Date(now-10000).toISOString();
 return {issued:true,signature_version:SOURCE_VERSION,key_id:KID,
  issued_at,canonical_record_json,
  ed25519_signature:crypto.sign(null,Buffer.from([
   'HERMES_A3_AUTHENTICATED_QUEUE_SOURCE_V1',KID,issued_at,canonical_record_json
  ].join('\n')),maestro.privateKey).toString('base64url'),
  public_key_b64url:rawPub(maestro),execution_authorized:false,
  simulation_receipt_durable:false,production_allowed:false
 };
}
const inspect=(status='created')=>({
 Id:containerId,Image:imageId,
 State:{Status:status,ExitCode:status==='exited'?0:null},
 HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,
  CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],PidMode:'',
  IpcMode:'private',UsernsMode:'',PortBindings:{},Binds:null,VolumesFrom:null,
  Devices:[],DeviceRequests:null,Tmpfs:{'/tmp':'rw,nosuid,nodev,size=32m'}},
 Config:{User:'65534:65534',WorkingDir:'/a3',Entrypoint:['node'],
  Cmd:['--test','test/hermes-maintainer-e2e-workflow-contract.test.js',
   'test/hermes-maintainer-test-execution-boundary.test.js'],
  Env:['NODE_ENV=test']},
 Mounts:[{Type:'bind',Source:sourceRoot,Destination:'/a3',RW:false}]
});
function fixture(patch={}){
 let clock=baseTime,obs={
  mission_run_id:q.run_id,mission_id:q.mission_id,
  workspace_id:'workspace-fixture',contract_hash:'sha256:'+'d'.repeat(64),
  revision_sha:revision,docker_image_id:imageId,operation:'update_file',
  repository:q.repository,state:'reserved',
  reserved_at:new Date(clock-1000).toISOString()
 };
 let created=0,started=0,removed=0,finalized=0,stored=0,signed=0,claimed=0;
 const docker={
  async create(){created++;clock+=100;return containerId;},
  async inspect(){return inspect(started?'exited':'created');},
  async start(){started++;clock+=100;},
  async wait(){clock+=500;return 0;},
  async remove(){removed++;}
 };
 const env={
  A3_INDEPENDENT_WITNESS_EXECUTION_ENABLED:'true',
  HERMES_DEPLOYMENT_STAGE:'staging',
  HERMES_EXECUTION_ENABLED:'false',
  HERMES_EXECUTION_KILL_SWITCH:'true',
  HERMES_MISSION_INGRESS_ENABLED:'false'
 };
 const config={
  environment:env,maestroPublicKey:rawPub(maestro),issuerPublicKey:rawPub(issuer),
  issuerId:'separate-witness-fixture',imageId,sourceRoot,
  readRevision:async()=>revision,readClean:async()=>true,
  readSnapshot:async()=>queueEnvelope(),
  readObservation:async()=>obs,
  reserveWitnessAttempt:async data=>{claimed++;return {...data,environment:'staging'};},
  docker,
  finalizeObservation:async()=>{
   finalized++;clock+=100;
   obs={...obs,state:'process_observed',finished_at:new Date(clock).toISOString(),
    observation_evidence:evidence()};
   obs.observation_digest=computeCanonicalContentDigest(obs.observation_evidence);
  },
  sign:async payload=>{
   signed++;
   return crypto.sign(null,payload,issuer.privateKey).toString('base64url');
  },
  persistAndReadReceipt:async row=>{stored++;return row;},
  now:()=>clock
 };
 const op=createIndependentA3Supervisor({...config,...patch});
 return {op,config,docker,stats:()=>({created,started,removed,finalized,stored,signed,claimed}),
  markObserved:()=>{
   obs={...obs,state:'process_observed',observation_evidence:evidence(),
    finished_at:new Date(clock).toISOString()};
   obs.observation_digest=computeCanonicalContentDigest(obs.observation_evidence);
  }};
}
test('independent supervisor can sign only one freshly reserved, inspected container execution',async()=>{
 const f=fixture(),r=await f.op.superviseOnce(q);
 assert.equal(r.status,'A3_INDEPENDENT_WITNESS_DURABLE_NO_AUTHORITY');
 assert.equal(r.receipt_durable,true);
 assert.equal(r.receipt_emitted,true);
 assert.equal(r.outbox_acknowledged,false);
 assert.equal(r.execution_authorized,false);
 assert.equal(r.network_call_performed,null);
 assert.equal(r.scm_write_performed,null);
 assert.deepEqual(f.stats(),{created:1,started:1,removed:1,finalized:1,stored:1,signed:1,claimed:1});
 const replay=await f.op.superviseOnce(q);
 assert.equal(replay.receipt_durable,false);
 assert.equal(f.stats().created,1);
});
test('old already-observed run is rejected before Docker create or signing',async()=>{
 const f=fixture();f.markObserved();
 assert.equal((await f.op.superviseOnce(q)).receipt_durable,false);
 assert.equal(f.stats().created,0);
 assert.equal(f.stats().signed,0);
});
test('default disabled, untrusted Maestro snapshot and dirty source fail closed',async()=>{
 const f=fixture({environment:{}});
 assert.equal((await f.op.superviseOnce(q)).receipt_durable,false);
 assert.equal(f.stats().created,0);
 const corrupt=fixture({readSnapshot:async()=>{
  const s=queueEnvelope();return {...s,canonical_record_json:'{}'};
 }});
 assert.equal((await corrupt.op.superviseOnce(q)).receipt_durable,false);
 assert.equal(corrupt.stats().created,0);
 const dirty=fixture({readClean:async()=>false});
 assert.equal((await dirty.op.superviseOnce(q)).receipt_durable,false);
 assert.equal(dirty.stats().created,0);
});
test('Docker before-start and after-exit inspection must match no network and no write',async()=>{
 const bad=[
  d=>({...d,HostConfig:{...d.HostConfig,NetworkMode:'bridge'}}),
  d=>({...d,HostConfig:{...d.HostConfig,ReadonlyRootfs:false}}),
  d=>({...d,HostConfig:{...d.HostConfig,Privileged:true}}),
  d=>({...d,HostConfig:{...d.HostConfig,Devices:[{PathOnHost:'/dev/null'}]}}),
  d=>({...d,Config:{...d.Config,User:'0:0'}}),
  d=>({...d,Config:{...d.Config,Env:['SERVICE_TOKEN=secret']}}),
  d=>({...d,Mounts:[{...d.Mounts[0],RW:true}]}),
  d=>({...d,Mounts:[...d.Mounts[0]?[d.Mounts[0]]:[],{
   Type:'bind',Source:'/var/run/docker.sock',Destination:'/var/run/docker.sock',RW:true}]}),
  d=>({...d,Image:'sha256:'+'f'.repeat(64)})
 ];
 for(const update of bad){
  const d=update(inspect());
  assert.equal(inspectIsolation(d,{containerId,imageId,sourceRoot}),null);
 }
 const f=fixture({docker:{create:async()=>containerId,
  inspect:async()=>({...inspect(),HostConfig:{...inspect().HostConfig,NetworkMode:'bridge'}}),
  start:async()=>{throw Error('must not run');},
  wait:async()=>0,remove:async()=>{}}});
 assert.equal((await f.op.superviseOnce(q)).receipt_durable,false);
 assert.equal(f.stats().signed,0);
});
test('issuer must reject uncertain finalization, invalid signature and commit uncertainty',async()=>{
 for(const patch of [
  {finalizeObservation:async()=>{throw Error('postgres unavailable');}},
  {sign:async()=> 'A'.repeat(86)},
  {persistAndReadReceipt:async()=>{throw Error('timeout after commit');}}
 ]){
  const f=fixture(patch),r=await f.op.superviseOnce(q);
  assert.equal(r.receipt_durable,false,JSON.stringify(patch));
  assert.equal(r.execution_authorized,false);
 }
});
test('independent Docker driver never accepts caller command, network or image tag',async()=>{
 const history=[],driver=createIndependentDockerDriver({
  runCommand:async args=>{
   history.push(args);
   if(args[0]==='create')return containerId;
   if(args[0]==='inspect')return JSON.stringify([inspect()]);
   if(args[0]==='wait')return '0';
   return '';
  }
 });
 const id=await driver.create({imageId,sourceRoot,revisionSha:revision,runId:q.run_id});
 assert.equal(id,containerId);
 assert.equal(history[0].includes('--network=none'),true);
 assert.equal(history[0].includes('--read-only'),true);
 assert.equal(history[0].includes('--pull=never'),true);
 assert.equal(history[0].includes('--cap-drop=ALL'),true);
 assert.deepEqual((await driver.inspect(containerId)).Id,containerId);
 await driver.start(containerId);assert.equal(await driver.wait(containerId),0);
 await driver.remove(containerId);
 await assert.rejects(driver.create({imageId:'node:20',sourceRoot,revisionSha:revision,
  runId:q.run_id}),/immutable_scope_invalid/);
 assert.equal(history.filter(a=>a[0]==='create').length,1);
});

test('failed global witness attempt claim and same-run concurrent entry cannot launch Docker',async()=>{
 const f=fixture({reserveWitnessAttempt:async()=>null});
 assert.equal((await f.op.superviseOnce(q)).receipt_durable,false);
 assert.equal(f.stats().created,0);
 const g=fixture();
 const results=await Promise.all([g.op.superviseOnce(q),g.op.superviseOnce(q)]);
 assert.equal(results.filter(x=>x.receipt_durable).length,1);
 assert.equal(g.stats().created,1);
 assert.equal(g.stats().claimed,1);
});
test('witness attempt migration has independent global replay constraint',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const sql=fs.readFileSync(path.resolve(__dirname,
  '../../../migrations/hermes/037_create_maintainer_a3_witness_attempts.sql'),'utf8');
 for(const required of [
  'mission_run_id TEXT PRIMARY KEY REFERENCES',
  'mission_id TEXT NOT NULL UNIQUE','official_outbox_id TEXT NOT NULL UNIQUE',
  'ENABLE ROW LEVEL SECURITY','REVOKE ALL',
  "CHECK (environment='staging')"
 ])assert.ok(sql.includes(required),required);
});

test('rejects stale reserved observations before persistent claim or Docker',async()=>{
 const f=fixture({readObservation:async()=>({
  mission_run_id:q.run_id,mission_id:q.mission_id,
  workspace_id:'workspace-fixture',contract_hash:'sha256:'+'d'.repeat(64),
  revision_sha:revision,docker_image_id:imageId,operation:'update_file',
  repository:q.repository,state:'reserved',
  reserved_at:new Date(baseTime-180000).toISOString()
 })});
 const result=await f.op.superviseOnce(q);
 assert.equal(result.status,'A3_INDEPENDENT_SUPERVISOR_NOT_FRESHLY_RESERVED');
 assert.equal(f.stats().claimed,0);assert.equal(f.stats().created,0);
});
test('requires exact independently persisted witness attempt identity',async()=>{
 for(const drift of [{workspace_id:'different'},{
   contract_hash:'sha256:'+'1'.repeat(64)},{revision_sha:'a'.repeat(40)},
   {docker_image_id:'sha256:'+'a'.repeat(64)},{environment:'production'}]){
  const f=fixture({reserveWitnessAttempt:async input=>({...input,environment:'staging',...drift})});
  const result=await f.op.superviseOnce(q);
  assert.equal(result.receipt_durable,false);
  assert.equal(f.stats().created,0);
 }
});
test('failed Docker cleanup and source drift during process forbid signing',async()=>{
 const badCleanup=fixture({docker:{
  async create(){return containerId;},
  async inspect(){return inspect('created');},
  async start(){},async wait(){return 0;},
  async remove(){throw Error('rm failed')}
 }});
 assert.equal((await badCleanup.op.superviseOnce(q)).receipt_durable,false);
 assert.equal(badCleanup.stats().signed,0);
 let checks=0;
 const changed=fixture({readRevision:async()=>++checks===1?revision:'a'.repeat(40)});
 assert.equal((await changed.op.superviseOnce(q)).receipt_durable,false);
 assert.equal(changed.stats().signed,0);
});
test('inspector rejects added container capabilities',()=>{
 const d=inspect();d.HostConfig.CapAdd=['SYS_ADMIN'];
 assert.equal(inspectIsolation(d,{containerId,imageId,sourceRoot}),null);
});

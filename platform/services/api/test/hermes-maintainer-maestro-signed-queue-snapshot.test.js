'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {VERSION,KID,createVerifier,createVerifierFromServerEnv}=
 require('../src/runtime/hermes-maintainer-maestro-signed-queue-snapshot');
const mid='6ad7e310737fee5ec40456e6',rid='6ad7f24438f9d9c3f10d93dc';
const REPO='instutodp-cpu/agente-grupo-erick';
const query=()=>({environment:'staging',mission_id:mid,run_id:rid,
 operation:'update_file',repository:REPO});
function seal(recordOverride={},time='2026-10-20T23:00:00.000Z'){
 const pair=crypto.generateKeyPairSync('ed25519');
 const pk=pair.publicKey.export({format:'jwk'}).x;
 const r={version:VERSION,source:'MAESTRO_MISSION_GATEWAY_AUTHENTICATED',
 environment:'staging',mission_run_id:rid,mission_id:mid,
 workspace_id:'official-workspace',operation:'update_file',repository:REPO,
 revision_sha:'9aef9cc4a2bbd0ebc97ea3826663642541716c59',
 contract_hash:'sha256:'+'a'.repeat(64),test_id:'hermes_core_smoke',
 run_status:'na_fila',dispatch_simulado:true,
 official_pre_run_approval_id:'official-approved-before-run',
 official_outbox_id:'official-outbox',
 outbox_status:'pending',outbox_provider:'mock',
 verified_contract_integrity:true,simulated_run_queued:true,
 simulation_observed:false,receipt_durable:false,outbox_acknowledged:false,
 issuer_verified:false,approval_verified:false,execution_authorized:false,
 production_allowed:false,merge_authority:false,...recordOverride};
 const canonical=JSON.stringify(r);
 const bytes=['HERMES_A3_AUTHENTICATED_QUEUE_SOURCE_V1',KID,time,canonical].join('\n');
 return{publicKey:pk,
  envelope:{issued:true,signature_version:VERSION,key_id:KID,
   issued_at:time,canonical_record_json:canonical,
   ed25519_signature:crypto.sign(null,Buffer.from(bytes),pair.privateKey).toString('base64url'),
   public_key_b64url:pk,
   execution_authorized:false,simulation_receipt_durable:false,production_allowed:false}
 };
}
const NOW=Date.parse('2026-10-20T23:01:00.000Z');
test('valid Ed25519 source snapshot only grants a NON-authoritative process candidate',()=>{
 const f=seal(),v=createVerifier({publicKeyB64Url:f.publicKey,now:()=>NOW});
 assert.equal(v.configured,true);
 const candidate=v.verifySnapshot(f.envelope,query());
 assert.equal(candidate.mission_run_id,rid);
 assert.equal(candidate.source,'MAESTRO_MISSION_GATEWAY_OFFICIAL_QUEUE_CANDIDATE');
 assert.equal(candidate.revision_sha,'9aef9cc4a2bbd0ebc97ea3826663642541716c59');
 for(const field of ['execution_authorized','issuer_verified','approval_verified',
  'receipt_durable','outbox_acknowledged','simulation_observed','production_allowed',
  'merge_authority'])assert.equal(candidate[field],false,field);
 assert.equal(createVerifier({}).verifySnapshot(f.envelope,query()),null);
 assert.equal(createVerifierFromServerEnv({env:{
  HERMES_DEPLOYMENT_STAGE:'production',
  MAESTRO_A3_QUEUED_PUBLIC_KEY_B64URL:f.publicKey
 }}).configured,false);
});
test('fail closed on expired/future, tampered record or signature, wrong run or key',()=>{
 const f=seal(),v=createVerifier({publicKeyB64Url:f.publicKey,now:()=>NOW});
 assert.equal(v.verifySnapshot({...f.envelope,ed25519_signature:'A'.repeat(86)},query()),null);
 assert.equal(v.verifySnapshot({...f.envelope,canonical_record_json:f.envelope.canonical_record_json+' '},query()),null);
 assert.equal(v.verifySnapshot({...f.envelope,issued_at:'2026-10-20T23:00:01.000Z'},query()),null);
 assert.equal(v.verifySnapshot({...f.envelope,production_allowed:true},query()),null);
 assert.equal(v.verifySnapshot({...f.envelope,key_id:'other-issuer'},query()),null);
 assert.equal(v.verifySnapshot(f.envelope,{...query(),run_id:'other-run'}),null);
 assert.equal(v.verifySnapshot(f.envelope,{...query(),environment:'production'}),null);
 assert.equal(v.verifySnapshot(f.envelope,{...query(),extra:true}),null);
 assert.equal(v.verifySnapshot(f.envelope,{...query(),operation:'create_pull_request'}),null);
 assert.equal(v.verifySnapshot(f.envelope,{...query(),repository:'other/repo'}),null);
 assert.equal(createVerifier({publicKeyB64Url:f.publicKey,now:()=>NOW+300001})
  .verifySnapshot(f.envelope,query()),null);
 assert.equal(createVerifier({publicKeyB64Url:f.publicKey,now:()=>NOW-90000})
  .verifySnapshot(f.envelope,query()),null);
 const alt=seal();assert.equal(createVerifier({publicKeyB64Url:alt.publicKey,now:()=>NOW})
  .verifySnapshot(f.envelope,query()),null);
});
test('signed incorrect scope or claimed authorization does not bypass validation',()=>{
 const overrides=[
  {outbox_status:'acknowledged'},{outbox_provider:'operational'},
  {issuer_verified:true},{approval_verified:true},{receipt_durable:true},
  {simulation_observed:true},{merge_authority:true},{execution_authorized:true},
  {verified_contract_integrity:false},{run_status:'concluida'},
  {dispatch_simulado:false},{revision_sha:'invalid'},
  {official_pre_run_approval_id:''},{official_outbox_id:''},
  {contract_hash:'unverified'},{source:'UNTRUSTED'},
  {test_id:'arbitrary_test'}
 ];
 for(const over of overrides){
  const f=seal(over),v=createVerifier({publicKeyB64Url:f.publicKey,now:()=>NOW});
  assert.equal(v.verifySnapshot(f.envelope,query()),null,JSON.stringify(over));
 }
});

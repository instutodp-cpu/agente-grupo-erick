'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs');
const {
 ATTEMPT_INSERT,ATTEMPT_READ,RECEIPT_INSERT,RECEIPT_READ,
 FIELDS,RECEIPT_FIELDS,createIndependentWitnessLedger
}=require('../../../independent-witness/postgres-ledger');
function db(){
 const rows=new Map(),receipts=new Map();let pending=null,failCommit=false,readFail=false;
 const conn={
  async query(sql,args=[]){
   if(sql==='BEGIN'){pending=null;return {rows:[]};}
   if(sql==='ROLLBACK'){pending=null;return {rows:[]};}
   if(sql==='COMMIT'){
    if(failCommit)throw Error('commit status ambiguous');
    if(pending){const target=pending.receipt?receipts:rows;
     target.set(pending.row.mission_run_id,pending.row);}
    pending=null;return {rows:[]};
   }
   if(sql===ATTEMPT_INSERT||sql===RECEIPT_INSERT){
    const isReceipt=sql===RECEIPT_INSERT,fields=isReceipt?RECEIPT_FIELDS:FIELDS;
    const target=isReceipt?receipts:rows;
    const row=Object.fromEntries(fields.map((k,i)=>
     [k,k==='receipt_envelope'?JSON.parse(args[i]):args[i]]));
    if(target.has(row.mission_run_id)||[...target.values()].some(r=>
       r.mission_id===row.mission_id||r.official_outbox_id===row.official_outbox_id))
     return {rows:[]};
    pending={receipt:isReceipt,row};return {rows:[{mission_run_id:row.mission_run_id}]};
   }
   throw Error('unexpected SQL');
  },release(){}
 };
 const pool={connect:async()=>conn,query:async(sql,args)=>{
  if(readFail)throw Error('read failed');
  const target=sql===ATTEMPT_READ?rows:sql===RECEIPT_READ?receipts:null;
  if(!target)throw Error('unexpected read');
  const row=target.get(args[0]);return {rows:row?[row]:[]};
 }};
 return {pool,rows,receipts,breakCommit:()=>{failCommit=true},
  breakRead:()=>{readFail=true}};
}
const scope=()=>({mission_run_id:'run-a',mission_id:'mission-a',
 workspace_id:'workspace-a',official_outbox_id:'outbox-a',
 contract_hash:'sha256:'+'d'.repeat(64),revision_sha:'9'.repeat(40),
 docker_image_id:'sha256:'+'8'.repeat(64)});
const proof=()=>({...scope(),issuer_id:'external-issuer',
 process_observation_digest:'sha256:'+'a'.repeat(64),
 receipt_digest:'sha256:'+'f'.repeat(64),
 receipt_envelope:{record:{foo:'bar'},signature:'test'},
 witnessed_started_at:'2026-10-20T23:48:18.000Z',
 witnessed_finished_at:'2026-10-20T23:48:19.000Z',
 issued_at:'2026-10-20T23:48:20.000Z'});
test('independent attempt global lock rejects replay, preserves first claim',async()=>{
 const d=db(),ledger=createIndependentWitnessLedger({pool:d.pool});
 const first=await ledger.reserveAttempt(scope());
 assert.equal(first.mission_run_id,scope().mission_run_id);
 assert.equal((await ledger.reserveAttempt(scope())),null);
 assert.equal(d.rows.size,1);
 assert.equal((await ledger.reserveAttempt({...scope(),mission_run_id:'run-b'})),null);
 assert.equal(d.rows.size,1);
});
test('distinct receipt insert commits once and reads back JSONB equivalently',async()=>{
 const d=db(),ledger=createIndependentWitnessLedger({pool:d.pool});
 const r=await ledger.persistAndReadReceipt(proof());
 assert.equal(r.receipt_digest,proof().receipt_digest);
 assert.equal((await ledger.persistAndReadReceipt(proof())),null);
 assert.equal(d.receipts.size,1);
});
test('missing confirmations, uncertain commit and readback fail closed with no retries',async()=>{
 for(const mode of ['commit','read']){
  const d=db(),ledger=createIndependentWitnessLedger({pool:d.pool});
  if(mode==='commit')d.breakCommit();else d.breakRead();
  const r=await ledger.reserveAttempt(scope());
  assert.equal(r,null);
 }
});
test('migration 037 preserves single-use PK and requires independent-role provisioning',()=>{
 const sql=fs.readFileSync(path.resolve(__dirname,
  '../../../migrations/hermes/037_create_maintainer_a3_witness_attempts.sql'),'utf8');
 for(const word of ['mission_run_id TEXT PRIMARY KEY REFERENCES',
  'mission_id TEXT NOT NULL UNIQUE',
  'official_outbox_id TEXT NOT NULL UNIQUE',
  'ENABLE ROW LEVEL SECURITY','REVOKE ALL','CHECK (environment='])
  assert.equal(sql.includes(word),true,word);
});

test('global witness SQL cannot claim an already observed or stale 035 row',()=>{
 for(const required of [
  'FROM hermes.maintainer_a3_process_observations o',
  'o.mission_run_id=$1','o.mission_id=$2','o.workspace_id=$3',
  'o.contract_hash=$5','o.revision_sha=$6','o.docker_image_id=$7',
  "o.state='reserved'", "INTERVAL '120 seconds'",
  'FOR UPDATE OF o','ON CONFLICT DO NOTHING RETURNING mission_run_id'
 ])assert.ok(ATTEMPT_INSERT.includes(required),required);
});

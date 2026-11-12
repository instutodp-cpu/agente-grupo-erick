'use strict';
// Must connect with a distinct issuer-owned DB role. NOT Hermes API pool.
// Keep schema RLS fail-closed until independent DBA policy/grant provisioning.
const DIGEST=/^sha256:[a-f0-9]{64}$/,SHA=/^[a-f0-9]{40}$/;
const ID=/^[^\x00-\x20\x7f]{1,255}$/;
const ATTEMPTS='hermes.maintainer_a3_witness_attempts';
const RECEIPTS='hermes.maintainer_a3_independent_witness_receipts';
const FIELDS=Object.freeze([
 'mission_run_id','mission_id','workspace_id','official_outbox_id',
 'contract_hash','revision_sha','docker_image_id','environment'
]);
const RECEIPT_FIELDS=Object.freeze([
 'mission_run_id','mission_id','workspace_id','official_outbox_id','issuer_id',
 'process_observation_digest','receipt_digest','receipt_envelope',
 'witnessed_started_at','witnessed_finished_at','issued_at'
]);
const insert=(table,fields)=>
 'INSERT INTO '+table+' ('+fields.join(',')+') VALUES ('+
 fields.map((_,i)=>'$'+(i+1)+(i===7&&table===RECEIPTS?'::jsonb':'')).join(',')+
 ') ON CONFLICT DO NOTHING RETURNING mission_run_id';
// Lock the official 035 reservation in the SAME transaction as the witness
// reservation INSERT. A previously observed/failed/stale run must not be
// resurrected by a racing or untrusted caller.
const ATTEMPT_INSERT='INSERT INTO '+ATTEMPTS+' ('+FIELDS.join(',')+') '+
 'SELECT '+FIELDS.map((_,i)=>'$'+(i+1)).join(',')+
 ' FROM (SELECT mission_run_id FROM hermes.maintainer_a3_process_observations o '+
 'WHERE o.mission_run_id=$1 AND o.mission_id=$2 AND o.workspace_id=$3 '+
 'AND o.contract_hash=$5 AND o.revision_sha=$6 AND o.docker_image_id=$7 '+
 "AND o.state='reserved' AND o.reserved_at >= CURRENT_TIMESTAMP - INTERVAL '120 seconds' "+
 'AND o.reserved_at <= CURRENT_TIMESTAMP FOR UPDATE OF o) eligible '+
 'WHERE TRUE ON CONFLICT DO NOTHING RETURNING mission_run_id';
const RECEIPT_INSERT=insert(RECEIPTS,RECEIPT_FIELDS);
const ATTEMPT_READ='SELECT '+FIELDS.join(',')+' FROM '+ATTEMPTS+' WHERE mission_run_id=$1';
const RECEIPT_READ='SELECT '+RECEIPT_FIELDS.join(',')+' FROM '+RECEIPTS+' WHERE mission_run_id=$1';
function createIndependentWitnessLedger({pool}={}){
 if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function')
  throw TypeError('independent_postgres_issuer_pool_required');
 const validateAttempt=r=>r&&FIELDS.every(k=>r[k]!==undefined)&&
  ['mission_run_id','mission_id','workspace_id','official_outbox_id'].every(k=>ID.test(r[k]))&&
  r.environment==='staging'&&DIGEST.test(r.contract_hash)&&
  DIGEST.test(r.docker_image_id)&&SHA.test(r.revision_sha);
 const validateReceipt=r=>r&&RECEIPT_FIELDS.every(k=>r[k]!==undefined)&&
  ['mission_run_id','mission_id','workspace_id','official_outbox_id','issuer_id'].every(k=>ID.test(r[k]))&&
  DIGEST.test(r.process_observation_digest)&&DIGEST.test(r.receipt_digest)&&
  r.receipt_envelope&&typeof r.receipt_envelope==='object'&&
  ['witnessed_started_at','witnessed_finished_at','issued_at'].every(k=>
   typeof r[k]==='string'&&Number.isFinite(Date.parse(r[k])));
 async function oneWrite(table,fields,sql,read,row,valid){
  if(!valid(row))return null;
  let client,open=false;
  try{
   client=await pool.connect();
   await client.query('BEGIN');open=true;
   const input=fields.map(k=>k==='receipt_envelope'?
    JSON.stringify(row[k]):row[k]);
   const saved=await client.query(sql,input);
   if(saved?.rows?.length!==1||
      saved.rows[0].mission_run_id!==row.mission_run_id){
    await client.query('ROLLBACK');open=false;return null;
   }
   await client.query('COMMIT');open=false;
   const x=await pool.query(read,[row.mission_run_id]);
   if(x?.rows?.length!==1)return null;
   const actual=x.rows[0];
   const same=fields.every(k=>{
    if(k==='receipt_envelope'){
     const {computeCanonicalContentDigest}=require('../services/api/src/core/canonical-content-digest');
     return computeCanonicalContentDigest(actual[k])===
       computeCanonicalContentDigest(row[k]);
    }
    if(k.endsWith('_at'))return new Date(actual[k]).toISOString()===row[k];
    return actual[k]===row[k];
   });
   return same?actual:null;
  }catch{
   if(client&&open){try{await client.query('ROLLBACK');}catch{}}
   return null;
  }finally{if(client){try{client.release();}catch{}}}
 }
 const reserveAttempt=async data=>oneWrite(ATTEMPTS,FIELDS,ATTEMPT_INSERT,
  ATTEMPT_READ,{...data,environment:'staging'},validateAttempt);
 const persistAndReadReceipt=async data=>oneWrite(RECEIPTS,RECEIPT_FIELDS,
  RECEIPT_INSERT,RECEIPT_READ,data,validateReceipt);
 return Object.freeze({reserveAttempt,persistAndReadReceipt});
}
module.exports={ATTEMPTS,RECEIPTS,ATTEMPT_INSERT,RECEIPT_INSERT,
 ATTEMPT_READ,RECEIPT_READ,FIELDS,RECEIPT_FIELDS,createIndependentWitnessLedger};

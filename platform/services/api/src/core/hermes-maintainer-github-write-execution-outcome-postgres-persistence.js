'use strict';

const TABLE='hermes.maintainer_github_write_execution_outcome';
const INSERT_SQL=`INSERT INTO ${TABLE} (outcome_key,outcome_digest,intent_digest,attempt_reference,admission_reference,repository,operation,ref,sha,provider_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (outcome_key) DO NOTHING RETURNING outcome_key`;
const SELECT_SQL=`SELECT outcome_key,outcome_digest,intent_digest,attempt_reference,admission_reference,repository,operation,ref,sha,provider_status FROM ${TABLE} WHERE outcome_key=$1`;

function nonEmpty(value){return typeof value==='string'&&value.trim()!=='';}
function validInput(input){
 return input&&nonEmpty(input.key)&&input.key===input.outcome_digest+'::execution-outcome'&&/^sha256:[a-f0-9]{64}$/.test(input.outcome_digest)&&/^sha256:[a-f0-9]{64}$/.test(input.intent_digest)&&nonEmpty(input.attempt_reference)&&nonEmpty(input.admission_reference)&&input.repository==='instutodp-cpu/agente-grupo-erick'&&input.operation==='create_branch'&&/^refs\/heads\/hermes\/[a-z0-9][a-z0-9._/-]{0,79}$/.test(input.ref)&&!input.ref.includes('..')&&/^[a-f0-9]{40}$/.test(input.sha)&&input.provider_status===201;
}

function createHermesMaintainerGithubWriteExecutionOutcomePostgresPersistence({pool}={}){
 if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function')throw new TypeError('postgres_pool_required');
 async function createIfAbsent(input){
  if(!validInput(input))return Object.freeze({status:'INVALID',durable:false});
  let client,began=false;
  try{
   client=await pool.connect();
   await client.query('BEGIN');began=true;
   const values=[input.key,input.outcome_digest,input.intent_digest,input.attempt_reference,input.admission_reference,input.repository,input.operation,input.ref,input.sha,input.provider_status];
   const inserted=await client.query(INSERT_SQL,values);
   if(!inserted||!Array.isArray(inserted.rows))throw new Error('malformed_insert_result');
   if(inserted.rows.length===0){await client.query('ROLLBACK');began=false;return Object.freeze({status:'EXISTS',durable:false});}
   await client.query('COMMIT');began=false;
   const confirmed=await client.query(SELECT_SQL,[input.key]);
   const row=confirmed?.rows?.[0];
   const matches=confirmed?.rows?.length===1&&row.outcome_key===input.key&&row.outcome_digest===input.outcome_digest&&row.intent_digest===input.intent_digest&&row.attempt_reference===input.attempt_reference&&row.admission_reference===input.admission_reference&&row.repository===input.repository&&row.operation===input.operation&&row.ref===input.ref&&row.sha===input.sha&&Number(row.provider_status)===input.provider_status;
   return Object.freeze({status:matches?'CREATED':'UNCONFIRMED',durable:matches});
  }catch{
   if(client&&began){try{await client.query('ROLLBACK');}catch{}}
   return Object.freeze({status:'FAILED',durable:false});
  }finally{if(client){try{client.release();}catch{}}}
 }
 return Object.freeze({createIfAbsent});
}
module.exports={INSERT_SQL,SELECT_SQL,TABLE,createHermesMaintainerGithubWriteExecutionOutcomePostgresPersistence};

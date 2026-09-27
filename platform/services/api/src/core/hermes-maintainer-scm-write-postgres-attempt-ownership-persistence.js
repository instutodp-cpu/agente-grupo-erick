'use strict';

const TABLE='hermes.maintainer_scm_write_attempt_ownership';
const INSERT_SQL=`INSERT INTO ${TABLE} (ownership_key,persistence_key,intent_digest,authorization_reference,consumption_reference,attempt_reference) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (ownership_key) DO NOTHING RETURNING ownership_key`;
const SELECT_SQL=`SELECT ownership_key,persistence_key,intent_digest,authorization_reference,consumption_reference,attempt_reference FROM ${TABLE} WHERE ownership_key=$1`;

function nonEmpty(value){return typeof value==='string'&&value.trim()!=='';}
function validInput(input){return input&&nonEmpty(input.key)&&nonEmpty(input.persistence_key)&&input.key===input.persistence_key+'::attempt-ownership'&&nonEmpty(input.intent_digest)&&input.intent_digest.startsWith('sha256:')&&nonEmpty(input.attempt_reference);}

function createHermesMaintainerScmWritePostgresAttemptOwnershipPersistence({pool}={}){
 if(!pool||typeof pool.connect!=='function')throw new TypeError('postgres_pool_required');
 async function createIfAbsent(input){
  if(!validInput(input))return Object.freeze({status:'INVALID',durable:false});
  let client,began=false;
  try{
   client=await pool.connect();
   await client.query('BEGIN');began=true;
   const inserted=await client.query(INSERT_SQL,[input.key,input.persistence_key,input.intent_digest,input.authorization_reference||null,input.consumption_reference||null,input.attempt_reference]);
   if(!inserted||!Array.isArray(inserted.rows))throw new Error('malformed_insert_result');
   if(inserted.rows.length===0){await client.query('ROLLBACK');began=false;return Object.freeze({status:'EXISTS',durable:false});}
   await client.query('COMMIT');began=false;
   const confirmed=await pool.query(SELECT_SQL,[input.key]);
   const row=confirmed?.rows?.[0];
   const matches=confirmed?.rows?.length===1&&row.ownership_key===input.key&&row.persistence_key===input.persistence_key&&row.intent_digest===input.intent_digest&&row.attempt_reference===input.attempt_reference;
   return Object.freeze({status:matches?'CREATED':'UNCONFIRMED',durable:matches});
  }catch{
   if(client&&began){try{await client.query('ROLLBACK');}catch{}}
   return Object.freeze({status:'FAILED',durable:false});
  }finally{if(client){try{client.release();}catch{}}}
 }
 return Object.freeze({createIfAbsent});
}
module.exports={INSERT_SQL,SELECT_SQL,TABLE,createHermesMaintainerScmWritePostgresAttemptOwnershipPersistence};

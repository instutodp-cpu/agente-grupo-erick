'use strict';

const TABLE='hermes.maintainer_scm_write_consumption';
const INSERT_SQL=`INSERT INTO ${TABLE} (persistence_key,intent_digest,authorization_reference,consumption_reference) VALUES ($1,$2,$3,$4) ON CONFLICT (persistence_key) DO NOTHING RETURNING persistence_key`;
const SELECT_SQL=`SELECT persistence_key,intent_digest,authorization_reference,consumption_reference FROM ${TABLE} WHERE persistence_key=$1`;

function nonEmpty(value){return typeof value==='string'&&value.trim()!=='';}
function validInput(input){
 return input&&nonEmpty(input.key)&&nonEmpty(input.intent_digest)&&/^sha256:[a-f0-9]{64}$/.test(input.intent_digest)&&nonEmpty(input.authorization_reference)&&nonEmpty(input.consumption_reference);
}

function createHermesMaintainerScmWritePostgresPersistence({pool}={}){
 if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function')throw new TypeError('postgres_pool_required');
 async function createIfAbsent(input){
  if(!validInput(input))return Object.freeze({status:'INVALID',durable:false});
  let client,began=false;
  try{
   client=await pool.connect();
   await client.query('BEGIN');began=true;
   const inserted=await client.query(INSERT_SQL,[input.key,input.intent_digest,input.authorization_reference,input.consumption_reference]);
   if(!inserted||!Array.isArray(inserted.rows))throw new Error('malformed_insert_result');
   if(inserted.rows.length===0){await client.query('ROLLBACK');began=false;return Object.freeze({status:'EXISTS',durable:false});}
   await client.query('COMMIT');began=false;
   const confirmed=await pool.query(SELECT_SQL,[input.key]);
   const row=confirmed?.rows?.[0];
   const matches=confirmed?.rows?.length===1&&row.persistence_key===input.key&&row.intent_digest===input.intent_digest&&row.authorization_reference===input.authorization_reference&&row.consumption_reference===input.consumption_reference;
   return Object.freeze({status:matches?'CREATED':'UNCONFIRMED',durable:matches});
  }catch{
   if(client&&began){try{await client.query('ROLLBACK');}catch{}}
   return Object.freeze({status:'FAILED',durable:false});
  }finally{if(client){try{client.release();}catch{}}}
 }
 return Object.freeze({createIfAbsent});
}
module.exports={INSERT_SQL,SELECT_SQL,TABLE,createHermesMaintainerScmWritePostgresPersistence};

'use strict';

// Internal staging-only PRE-SCM proof ownership. Not a public endpoint,
// Ed25519 issuer, human approval mechanism, simulator, or SCM consumption.
// An authorized server composition must supply verifyOfficialSource that
// authenticates the issuer, official MissionRun, zero-effect receipt and
// post-run human decision. Nothing calls this adapter by default.
const TABLE='hermes.maintainer_a3_source_authorization_claims';
const FIELDS=Object.freeze([
 'single_use_authorization_id','workspace_id','mission_id','mission_run_id',
 'approval_reference','authorization_reference','operation','repository',
 'environment','target_digest','intent_digest','simulation_receipt_digest',
 'staging_gate_fingerprint','source_record_digest'
]);
const INSERT_SQL='INSERT INTO '+TABLE+' ('+FIELDS.join(',')+') VALUES ('+
 FIELDS.map((_,i)=>'$'+(i+1)).join(',')+
 ') ON CONFLICT DO NOTHING RETURNING single_use_authorization_id';
const SELECT_SQL='SELECT '+FIELDS.join(',')+' FROM '+TABLE+
 ' WHERE single_use_authorization_id=$1';
const ID=/^[^\x00-\x20\x7f]{1,255}$/;
const DIGEST=/^sha256:[0-9a-f]{64}$/;
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const denied=(status)=>Object.freeze({status,durable:false,claim_created:false,
 execution_authorized:false,network_call_performed:false,write_performed:false,
 production_allowed:false,merge_authority:false});
function validClaim(claim){
 if(!claim||typeof claim!=='object'||Array.isArray(claim)||
    Object.keys(claim).sort().join('|')!==[...FIELDS].sort().join('|'))return false;
 const ids=['single_use_authorization_id','workspace_id','mission_id','mission_run_id',
  'approval_reference','authorization_reference'];
 const digests=['target_digest','intent_digest','simulation_receipt_digest',
  'staging_gate_fingerprint','source_record_digest'];
 return ids.every(k=>ID.test(claim[k]||''))&&digests.every(k=>DIGEST.test(claim[k]||''))&&
  claim.environment==='staging'&&claim.repository===REPOSITORY&&
  ['update_file','create_pull_request'].includes(claim.operation);
}
function exactScope(claim,input){
 if(!input||typeof input!=='object'||Array.isArray(input))return false;
 // Never accept a trusted verifier returning a different single-use scope
 // from the originally requested operation.
 for(const field of FIELDS)
  if(claim[field]!==input[field])return false;
 return true;
}
function createHermesMaintainerA3SourceClaimPostgresPersistence({
 pool,verifyOfficialSource,environment=process.env
}={}){
 if(!pool||typeof pool.connect!=='function')throw new TypeError('postgres_pool_required');
 if(typeof verifyOfficialSource!=='function')throw new TypeError('independent_source_verifier_required');
 function stagingEnabled(){
  return environment?.HERMES_DEPLOYMENT_STAGE==='staging'&&
    environment?.HERMES_A3_SOURCE_CLAIMS_ENABLED==='true';
 }
 // A database row does not establish an unrevoked human approval, a valid
 // issuer signature or a durable zero-effect simulation. These are rechecked
 // on EVERY ownership read, without falling back to caller-provided flags.
 async function verifiedClaim(input){
  let source;
  try{source=await verifyOfficialSource(input);}
  catch{return null;}
  if(source?.verified!==true||
     source.source!=='MISSION_GATEWAY_DURABLE'||
     source.simulation_effect!=='ZERO'||
     source.durably_confirmed!==true||
     source.executed!==false||
     source.production_used!==false||
     source.merge_authority!==false||
     source.human_merge_required!==true||
     source.approval_verified!==true||
     source.issuer_verified!==true||
     !validClaim(source.claim)||
     !exactScope(source.claim,input))return null;
  return source.claim;
 }
 async function verifyOwned(input){
  if(!stagingEnabled())return denied('A3_SOURCE_CLAIM_STAGING_DISABLED');
  const claim=await verifiedClaim(input);
  if(!claim)return denied('A3_OFFICIAL_SOURCE_UNVERIFIED');
  let result;
  try{result=await pool.query(SELECT_SQL,[claim.single_use_authorization_id]);}
  catch{return denied('A3_SOURCE_CLAIM_READ_UNAVAILABLE');}
  if(!result||!Array.isArray(result.rows)||result.rows.length!==1||
     FIELDS.some(k=>result.rows[0][k]!==claim[k]))
    return denied('A3_SOURCE_CLAIM_ABSENT_OR_SCOPE_DRIFT');
  return Object.freeze({...denied('A3_SOURCE_CLAIM_VERIFIED_CURRENT'),
    durable:true});
 }
 async function createIfVerified(input){
  if(!stagingEnabled())return denied('A3_SOURCE_CLAIM_STAGING_DISABLED');
  const claim=await verifiedClaim(input);
  if(!claim)return denied('A3_OFFICIAL_SOURCE_UNVERIFIED');
  let client,began=false;
  try{
   client=await pool.connect();
   await client.query('BEGIN');began=true;
   const inserted=await client.query(INSERT_SQL,FIELDS.map(k=>claim[k]));
   if(!inserted||!Array.isArray(inserted.rows))throw Error('malformed_insert');
   if(inserted.rows.length!==1||
      inserted.rows[0].single_use_authorization_id!==claim.single_use_authorization_id){
    await client.query('ROLLBACK');began=false;
    return denied('A3_SOURCE_CLAIM_ALREADY_OWNED');
   }
   await client.query('COMMIT');began=false;
   // After uncertain COMMIT or missing verification we never retry INSERT.
   const checked=await pool.query(SELECT_SQL,[claim.single_use_authorization_id]);
   if(!checked||!Array.isArray(checked.rows)||checked.rows.length!==1||
      FIELDS.some(k=>checked.rows[0][k]!==claim[k]))
    return denied('A3_SOURCE_CLAIM_PERSISTENCE_UNCONFIRMED');
   return Object.freeze({...denied('A3_SOURCE_CLAIM_DURABLY_OWNED'),
    durable:true,claim_created:true});
  }catch{
   if(client&&began){try{await client.query('ROLLBACK');}catch{}}
   return denied('A3_SOURCE_CLAIM_DB_UNAVAILABLE_OR_UNCONFIRMED');
  }finally{if(client){try{client.release();}catch{}}}
 }
 return Object.freeze({createIfVerified,verifyOwned});
}
module.exports={TABLE,FIELDS,INSERT_SQL,SELECT_SQL,validClaim,
 createHermesMaintainerA3SourceClaimPostgresPersistence};

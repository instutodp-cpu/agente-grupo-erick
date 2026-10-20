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
 async function createIfVerified(input){
  if(environment?.HERMES_DEPLOYMENT_STAGE!=='staging'||
     environment?.HERMES_A3_SOURCE_CLAIMS_ENABLED!=='true')
    return denied('A3_SOURCE_CLAIM_STAGING_DISABLED');
  // Only privileged callback may supply the authoritative, fully scoped
  // claim; request-provided verified flags or signatures are never accepted.
  let verified;
  try{verified=await verifyOfficialSource(input);}
  catch{return denied('A3_OFFICIAL_SOURCE_UNAVAILABLE');}
  if(verified?.verified!==true||
     verified.source!=='MISSION_GATEWAY_DURABLE'||
     verified.simulation_effect!=='ZERO'||
     verified.durably_confirmed!==true||
     verified.executed!==false||
     verified.production_used!==false||
     verified.merge_authority!==false||
     verified.human_merge_required!==true||
     verified.approval_verified!==true||
     verified.issuer_verified!==true||
     !validClaim(verified.claim)||
     !exactScope(verified.claim,input))
    return denied('A3_OFFICIAL_SOURCE_UNVERIFIED');
  const claim=verified.claim;
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
 return Object.freeze({createIfVerified});
}
module.exports={TABLE,FIELDS,INSERT_SQL,SELECT_SQL,validClaim,
 createHermesMaintainerA3SourceClaimPostgresPersistence};

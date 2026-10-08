#!/usr/bin/env node
'use strict';
const {Pool}=require('pg');
const {prepareStrongHumanReauthEmail}=require('../src/core/strong-human-reauth-email-contract');
const {createStrongHumanReauthEmailPostgres}=require('../src/adapters/postgres/strong-human-reauth-email-postgres');
const {prepareEmailProviderHandoff}=require('../src/core/strong-human-reauth-email-provider-handoff');
const {computeCanonicalContentDigest}=require('../src/core/canonical-content-digest');
const {validateOrigin,normalizeCanaryTargetPath}=require('../src/core/public-web-canary-target-allowlist');
async function createChallenge({PoolClass=Pool,env=process.env,clock}={}){
 const required=['POSTGRES_PORT','POSTGRES_USER','POSTGRES_PASSWORD','POSTGRES_DB'];for(const k of required)if(!env[k])throw new Error('postgres_configuration_missing');
 const origin=validateOrigin(env.HERMES_REAUTH_TARGET_ORIGIN);const path=normalizeCanaryTargetPath(env.HERMES_REAUTH_TARGET_PATH);
 if(!origin.valid||!path.valid||origin.origin==='https://example.com')throw new Error('explicit_valid_non_placeholder_canary_target_required');
 const digest=computeCanonicalContentDigest({environment:'staging',target_origin:origin.origin,target_path:path.path,method:'GET',port:443,maximum_requests:1,redirects_allowed:false,production_allowed:false});
 if(!/^sha256:[0-9a-f]{64}$/.test(digest))throw new Error('canonical_digest_invalid');
 const challenge=prepareStrongHumanReauthEmail({subject_id:'human:owner',action_digest:digest,email_identity_reference:'owner-primary-email',ttl_seconds:600,production_allowed:false},{clock});
 if(!challenge.ok)throw new Error(challenge.reason||challenge.status);
 const pool=new PoolClass({host:'127.0.0.1',port:Number(env.POSTGRES_PORT),user:env.POSTGRES_USER,password:env.POSTGRES_PASSWORD,database:env.POSTGRES_DB});
 try{const saved=await createStrongHumanReauthEmailPostgres({pool}).createChallenge(challenge);if(!saved.ok)throw new Error(saved.status);const handoff=prepareEmailProviderHandoff(challenge,{provider:'google',identity_alias:'owner-primary-email',email_identity_reference:'owner-primary-email'});if(!handoff.ok)throw new Error(handoff.reason);return Object.freeze({ok:true,status:'EMAIL_REAUTH_OPERATIONAL_CHALLENGE_READY',challenge_id:challenge.challenge_id,action_digest:challenge.action_digest,issued_at:challenge.issued_at,ttl_seconds:challenge.ttl_seconds,delivery_reference:handoff.delivery_reference,identity_alias:handoff.identity_alias,production_allowed:false,execution_authorized:false});}finally{await pool.end();}
}
if(require.main===module)createChallenge().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(JSON.stringify({ok:false,status:'EMAIL_REAUTH_OPERATIONAL_CHALLENGE_BLOCKED',reason:e.message}));process.exitCode=1});
module.exports={createChallenge};

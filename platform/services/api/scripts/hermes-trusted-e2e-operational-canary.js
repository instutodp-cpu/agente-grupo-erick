#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const {Pool}=require('pg');
const {createHermesMaintainerStagingRuntimeEntry}=require('../src/runtime/hermes-maintainer-staging-runtime-entry');
const {createHermesMaintainerTrustedE2eOperationalCanary}=require('../src/runtime/hermes-maintainer-trusted-e2e-operational-canary');
const CONFIRMATION='EXECUTE_TRUSTED_E2E_STAGING_CANARY';

async function main({argv=process.argv,environment=process.env,fetchImpl=globalThis.fetch,readFile=fs.readFileSync}={}){
 if(argv[2]!==CONFIRMATION)throw new TypeError('explicit_canary_confirmation_required');
 if(typeof argv[3]!=='string'||argv[3].length<1)throw new TypeError('operational_input_path_required');
 const operational=JSON.parse(readFile(argv[3],'utf8'));
 const runtimeEntry=createHermesMaintainerStagingRuntimeEntry({environment});
 const pool=new Pool({host:'127.0.0.1',port:Number(environment.POSTGRES_PORT),database:environment.POSTGRES_DB,user:environment.POSTGRES_USER,password:environment.POSTGRES_PASSWORD,max:1});
 try{
  return await createHermesMaintainerTrustedE2eOperationalCanary({
   pool,environment,fetchImpl,createTimeoutSignal:ms=>AbortSignal.timeout(ms),
   resolveReadAuthorization:runtimeEntry.resolveAuthorization
  }).execute({confirmation:CONFIRMATION,operational});
 }finally{await pool.end();}
}
if(require.main===module)main().then(result=>{process.stdout.write(JSON.stringify(result,null,2)+'\n');process.exitCode=result?.completed===true?0:2;}).catch(error=>{process.stdout.write(JSON.stringify({status:'TRUSTED_E2E_OPERATIONAL_CANARY_FAILED_SAFE',completed:false,reason:error?.message||'unknown_error',production_used:false,merge_authority:false,human_merge_required:true})+'\n');process.exitCode=3;});
module.exports={CONFIRMATION,main};

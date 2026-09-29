#!/usr/bin/env node
'use strict';
const {Pool}=require('pg');
const {runHermesMaintainerGithubUpdateFileStagingCanary}=require('../src/runtime/hermes-maintainer-github-update-file-staging-canary-entry');
async function main(){let pool;try{
 pool=new Pool({host:'127.0.0.1',port:Number(process.env.POSTGRES_PORT),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,max:1});
 const result=await runHermesMaintainerGithubUpdateFileStagingCanary({pool,environment:process.env,fetchImpl:globalThis.fetch,createTimeoutSignal:ms=>AbortSignal.timeout(ms),input:{
 confirmation:'EXECUTE_UPDATE_FILE_STAGING_CANARY',branch:'hermes/update-file-real-canary-20260929',approval_reference:'human-update-file-real-canary-20260929',authorization_reference:'authorization-update-file-real-canary-20260929',consumption_reference:'consumption-update-file-real-canary-20260929',attempt_reference:'attempt-update-file-real-canary-20260929',capability_reference:'github_update_file_hermes_branch_staging',admission_reference:'admission-update-file-real-canary-20260929',path:'docs/hermes-update-file-real-canary.md',current_blob_sha:'27a5f024036cb69f3f059b0631e449fd2828a89e',content:'Hermes update_file staging canary\nstate: after\n',message:'test(hermes): execute update-file staging canary'}});
 process.stdout.write(JSON.stringify(result,null,2)+'\n');process.exitCode=result&&result.accepted===true?0:2;
 }catch(e){process.stdout.write(JSON.stringify({status:'UPDATE_FILE_STAGING_CANARY_FAILED_SAFE',accepted:false,reason:e&&e.message?e.message:'unknown_error'})+'\n');process.exitCode=3;}finally{if(pool)await pool.end();}}
if(require.main===module)main();

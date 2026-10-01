#!/usr/bin/env node
'use strict';
const {Pool}=require('pg');
const {runHermesMaintainerGithubCreatePullRequestStagingCanary}=require('../src/runtime/hermes-maintainer-github-create-pull-request-staging-canary-entry');
async function main(){let pool;try{
 pool=new Pool({host:'127.0.0.1',port:Number(process.env.POSTGRES_PORT),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,max:1});
 const result=await runHermesMaintainerGithubCreatePullRequestStagingCanary({pool,environment:process.env,fetchImpl:globalThis.fetch,createTimeoutSignal:ms=>AbortSignal.timeout(ms),input:{
 confirmation:'EXECUTE_CREATE_PULL_REQUEST_STAGING_CANARY',head:'hermes/create-pull-request-real-canary-20260930',approval_reference:'human-create-pull-request-real-canary-20260930-attempt-2',authorization_reference:'authorization-create-pull-request-real-canary-20260930-attempt-2',consumption_reference:'consumption-create-pull-request-real-canary-20260930-attempt-2',attempt_reference:'attempt-create-pull-request-real-canary-20260930-attempt-2',capability_reference:'github_create_pull_request_hermes_branch_staging',admission_reference:'admission-create-pull-request-real-canary-20260930-attempt-2',title:'test(hermes): create_pull_request staging canary',body:'Hermes create_pull_request staging canary. Disposable Draft PR for operational acceptance.'}});
 process.stdout.write(JSON.stringify(result,null,2)+'\n');process.exitCode=result&&result.accepted===true?0:2;
 }catch(e){process.stdout.write(JSON.stringify({status:'CREATE_PULL_REQUEST_STAGING_CANARY_FAILED_SAFE',accepted:false,reason:e&&e.message?e.message:'unknown_error'})+'\n');process.exitCode=3;}finally{if(pool)await pool.end();}}
if(require.main===module)main();

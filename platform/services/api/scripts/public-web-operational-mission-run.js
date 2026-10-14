#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const { createPublicWebCanaryStagingPostgresPool } = require('../src/adapters/postgres/public-web-canary-staging-postgres-pool');
const { createPublicWebOperationalMissionInboxPostgres } = require('../src/adapters/postgres/public-web-operational-mission-inbox-postgres');
const { createPublicWebOperationalMissionCallbackClient } = require('../src/adapters/public-web/public-web-operational-mission-callback-client');
const { createPublicWebCanaryOperationalPostgresBootstrap } = require('../src/pilots/public-web-canary-operational-postgres-bootstrap');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const { buildTrialPlanFromConfig } = require('../src/pilots/public-web-canary-trial-config-loader');
const { preflightOperationalCanary, executeOperationalCanary } = require('./public-web-canary-real-non-production');
const { runReadyOperationalMission } = require('../src/core/public-web-operational-mission-runner');

function required(env,key){const value=env?.[key];if(typeof value!=='string'||!value.trim())throw new Error(`${key.toLowerCase()}_required`);return value.trim();}

async function main({
  environment=process.env,
  PoolClass=Pool,
  callbackClientFactory=createPublicWebOperationalMissionCallbackClient,
  operationalBootstrapFactory=createPublicWebCanaryOperationalPostgresBootstrap,
  executeCanary=executeOperationalCanary,
  clock=()=>new Date().toISOString()
}={}) {
  if (process.argv.slice(2).length !== 0) throw new Error('arguments_not_allowed');
  const missionRunId=required(environment,'HERMES_OPERATIONAL_MISSION_RUN_ID');
  const callbackEndpoint=required(environment,'HERMES_MAESTRO_CALLBACK_URL');
  const callbackTokenFile=required(environment,'HERMES_MAESTRO_CALLBACK_TOKEN_FILE');
  const pool=createPublicWebCanaryStagingPostgresPool({environment,PoolClass});
  const inbox=createPublicWebOperationalMissionInboxPostgres({pool});
  const composition=operationalBootstrapFactory({
    environment,PoolClass,
    runtime:{operationalBootstrapConfigured:true,stagingRealTransportOptIn:true,environment:'staging',production:false,production_allowed:false,maximum_requests:1,rollout_percentage:1,clock}
  });
  try {
    const found=await inbox.getByRun(missionRunId);
    if(!found?.ok||!found.record) throw new Error(found?.reason||'mission_not_found');
    const record=found.record;
    if(record.status!=='ready_for_tty') throw new Error(`mission_not_ready_for_tty:${record.status}`);
    if(!record.evidence_key) throw new Error('mission_evidence_key_missing');

    const preflight=await preflightOperationalCanary({bootstrap:{runtime:composition.bootstrap}});
    if(!preflight.ok) throw new Error('operational_preflight_blocked');

    const durable=await composition.resumeEmailReauthDurableComposition({
      evidence_key:record.evidence_key,
      authorizationInput:{
        operator_id:record.trial_config.operator_id,
        tenant_id:record.tenant_id,
        environment:'staging',
        authorization_scope:'PUBLIC_WEB_CANARY_SINGLE_EXECUTION_NON_PRODUCTION',
        target_origin:record.target_origin,
        target_path:record.target_path,
        method:'GET',port:443,maximum_requests:1,redirects_allowed:false,production_allowed:false
      }
    });
    if(!durable.ok) throw new Error(`durable_resume_blocked:${durable.reason||durable.status}`);

    const binding=durable.runtimeBinding;
    const requestedAt=String(clock());
    if(Number.isNaN(Date.parse(requestedAt))) throw new Error('clock_invalid');
    const canarySessionId='public_web_email_canary_session:'+computeCanonicalContentDigest(['session',binding.tenant_id,binding.trial_id,binding.plan_hash]);
    const cfg={...record.trial_config,trial_id:binding.trial_id,target_origin:record.target_origin,target_path:record.target_path,maximum_requests:1,rollout_percentage:1};
    const planned=buildTrialPlanFromConfig(cfg,{
      now:new Date(Date.parse(requestedAt)).toISOString(),
      canary_session_id:canarySessionId,
      feature_flag_key:'HERMES_PUBLIC_WEB_REAL_CANARY_ENABLED',
      kill_switch_key:'HERMES_PUBLIC_WEB_REAL_CANARY_KILL_SWITCH'
    });
    if(!planned.ok) throw new Error(`mission_plan_blocked:${planned.blocked_reason||planned.error?.blocked_reason||'unknown'}`);
    const prepared=composition.prepareEmailReauthExecution({durableComposition:durable,plan:planned.plan,requested_at:new Date(Date.parse(requestedAt)).toISOString()});
    if(!prepared?.ok||prepared.status!=='PUBLIC_WEB_CANARY_EMAIL_REAUTH_OPERATIONAL_PREPARED_ACTIVE_NOT_EXECUTED') throw new Error(`mission_execution_preparation_blocked:${prepared?.reason||prepared?.status||'unknown'}`);

    const bridge=prepared.operationalComposition?.bridgeInput;
    const executionId=bridge?.execution_id;
    const requestId=bridge?.runner_request?.request_id;
    if(!executionId||!requestId) throw new Error('prepared_execution_identity_missing');
    const callbackSender=callbackClientFactory({endpoint:callbackEndpoint,tokenFile:callbackTokenFile});
    const executionRuntime=Object.freeze({
      ...composition.bootstrap,
      tenantAllowlist:[record.tenant_id],
      workspaceAllowlist:[record.workspace_type],
      userAllowlist:[record.trial_config.user_id]
    });
    return await runReadyOperationalMission({
      inbox,mission_run_id:missionRunId,execution_id:executionId,request_id:requestId,callbackSender,clock,
      execute:()=>executeCanary({bootstrap:{runtime:executionRuntime,preparedExecution:prepared}})
    });
  } finally {
    try { await composition.close(); } finally { await pool.end(); }
  }
}

if(require.main===module){
  main().then(result=>{console.log(JSON.stringify(result,null,2));process.exitCode=result?.ok?0:2;}).catch(error=>{
    console.error(JSON.stringify({ok:false,status:'PUBLIC_WEB_OPERATIONAL_MISSION_RUN_CLI_BLOCKED',reason:String(error?.message||error),execution_started:false,external_network_called:false,production_allowed:false}));
    process.exitCode=1;
  });
}

module.exports={main};

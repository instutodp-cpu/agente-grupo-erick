#!/usr/bin/env node
'use strict';

const { createPublicWebCanaryStagingPostgresPool } = require('../src/adapters/postgres/public-web-canary-staging-postgres-pool');
const { createPublicWebOperationalMissionInboxPostgres } = require('../src/adapters/postgres/public-web-operational-mission-inbox-postgres');
const { createStrongHumanReauthEmailEvidencePostgres } = require('../src/adapters/postgres/strong-human-reauth-email-evidence-postgres');
const { refreshOperationalMissionReauth } = require('../src/core/public-web-operational-mission-preparation');

async function main({
  environment=process.env,
  PoolClass=null,
  argv=process.argv.slice(2),
  inboxFactory=createPublicWebOperationalMissionInboxPostgres,
  evidenceStoreFactory=createStrongHumanReauthEmailEvidencePostgres,
  challengeFactory=null,
  clock=()=>new Date().toISOString()
}={}) {
  if (!Array.isArray(argv) || argv.length !== 0) throw new Error('arguments_not_allowed');
  const missionRunId=environment.HERMES_OPERATIONAL_MISSION_RUN_ID;
  if (typeof missionRunId !== 'string' || !missionRunId.trim()) throw new Error('mission_run_id_required');
  const EffectivePoolClass=PoolClass || require('pg').Pool;
  const effectiveChallengeFactory=challengeFactory || require('./public-web-canary-email-reauth-challenge').createChallenge;
  const pool=createPublicWebCanaryStagingPostgresPool({environment,PoolClass:EffectivePoolClass});
  const inbox=inboxFactory({pool});
  const evidenceStore=evidenceStoreFactory({pool});
  try {
    return await refreshOperationalMissionReauth({
      inbox,
      evidenceStore,
      mission_run_id:missionRunId,
      clock,
      challengeFactory:({target_origin,target_path,mission_id,mission_run_id,contract_hash})=>effectiveChallengeFactory({
        PoolClass:EffectivePoolClass,
        env:{
          ...environment,
          HERMES_REAUTH_TARGET_ORIGIN:target_origin,
          HERMES_REAUTH_TARGET_PATH:target_path
        },
        mission_id,
        mission_run_id,
        contract_hash,
        clock
      })
    });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().then((result)=>{
    console.log(JSON.stringify(result));
    if (!result?.ok) process.exitCode=2;
  }).catch((error)=>{
    console.error(JSON.stringify({
      ok:false,
      status:'PUBLIC_WEB_OPERATIONAL_MISSION_REAUTH_REFRESH_CLI_BLOCKED',
      reason:String(error?.message || error),
      execution_authorized:false,
      execution_started:false,
      external_network_called:false,
      production_allowed:false
    }));
    process.exitCode=1;
  });
}

module.exports={main};

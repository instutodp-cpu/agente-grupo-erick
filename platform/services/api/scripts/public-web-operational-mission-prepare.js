#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const { createPublicWebCanaryStagingPostgresPool } = require('../src/adapters/postgres/public-web-canary-staging-postgres-pool');
const { createPublicWebOperationalMissionInboxPostgres } = require('../src/adapters/postgres/public-web-operational-mission-inbox-postgres');
const { prepareOperationalMissionReauth } = require('../src/core/public-web-operational-mission-preparation');
const { createChallenge } = require('./public-web-canary-email-reauth-challenge');

async function main({ environment=process.env, PoolClass=Pool } = {}) {
  if (process.argv.slice(2).length !== 0) throw new Error('arguments_not_allowed');
  const missionRunId = environment.HERMES_OPERATIONAL_MISSION_RUN_ID;
  if (typeof missionRunId !== 'string' || !missionRunId.trim()) throw new Error('mission_run_id_required');
  const pool = createPublicWebCanaryStagingPostgresPool({ environment, PoolClass });
  const inbox = createPublicWebOperationalMissionInboxPostgres({ pool });
  try {
    return await prepareOperationalMissionReauth({
      inbox,
      mission_run_id:missionRunId,
      challengeFactory:({target_origin,target_path})=>createChallenge({
        PoolClass,
        env:{
          ...environment,
          HERMES_REAUTH_TARGET_ORIGIN:target_origin,
          HERMES_REAUTH_TARGET_PATH:target_path
        }
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
      status:'PUBLIC_WEB_OPERATIONAL_MISSION_PREPARE_CLI_BLOCKED',
      reason:String(error?.message || error),
      execution_authorized:false,
      execution_started:false,
      external_network_called:false,
      production_allowed:false
    }));
    process.exitCode=1;
  });
}

module.exports = { main };

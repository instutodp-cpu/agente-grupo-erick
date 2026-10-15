#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const { createPublicWebCanaryStagingPostgresPool } = require('../src/adapters/postgres/public-web-canary-staging-postgres-pool');
const { createPublicWebOperationalMissionInboxPostgres } = require('../src/adapters/postgres/public-web-operational-mission-inbox-postgres');
const { createPostgresPublicWebCanaryAuditPersistence } = require('../src/adapters/postgres/public-web-canary-audit-persistence-postgres');
const { reconcileOperationalMissionRealSuccess } = require('../src/core/public-web-operational-mission-reconciliation');

function required(env,key){const value=env?.[key];if(typeof value!=='string'||!value.trim())throw new Error(`${key.toLowerCase()}_required`);return value.trim();}

async function main({ environment=process.env, PoolClass=Pool } = {}) {
  if (process.argv.slice(2).length !== 0) throw new Error('arguments_not_allowed');
  const missionRunId = required(environment,'HERMES_OPERATIONAL_MISSION_RUN_ID');
  const pool = createPublicWebCanaryStagingPostgresPool({ environment, PoolClass });
  const inbox = createPublicWebOperationalMissionInboxPostgres({ pool });
  const auditStore = createPostgresPublicWebCanaryAuditPersistence({ pool });
  try {
    return await reconcileOperationalMissionRealSuccess({ inbox, auditStore, mission_run_id:missionRunId });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().then((result)=>{
    console.log(JSON.stringify(result,null,2));
    process.exitCode=result?.ok?0:2;
  }).catch((error)=>{
    console.error(JSON.stringify({
      ok:false,
      status:'PUBLIC_WEB_OPERATIONAL_MISSION_RECONCILIATION_CLI_BLOCKED',
      reason:String(error?.message||error),
      public_web_execution_repeated:false,
      external_public_web_called:false,
      production_allowed:false
    }));
    process.exitCode=1;
  });
}

module.exports = { main };

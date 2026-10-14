#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const { createPublicWebCanaryStagingPostgresPool } = require('../src/adapters/postgres/public-web-canary-staging-postgres-pool');
const { createPublicWebOperationalMissionInboxPostgres } = require('../src/adapters/postgres/public-web-operational-mission-inbox-postgres');
const { createStrongHumanReauthEmailEvidencePostgres } = require('../src/adapters/postgres/strong-human-reauth-email-evidence-postgres');
const { bindOperationalMissionEvidence } = require('../src/core/public-web-operational-mission-preparation');

async function main({ environment=process.env, PoolClass=Pool } = {}) {
  if (process.argv.slice(2).length !== 0) throw new Error('arguments_not_allowed');
  const missionRunId = environment.HERMES_OPERATIONAL_MISSION_RUN_ID;
  const evidenceKey = environment.HERMES_OPERATIONAL_MISSION_EVIDENCE_KEY;
  if (typeof missionRunId !== 'string' || !missionRunId.trim()) throw new Error('mission_run_id_required');
  if (!/^sha256:[0-9a-f]{64}$/.test(String(evidenceKey || ''))) throw new Error('evidence_key_invalid');
  const pool = createPublicWebCanaryStagingPostgresPool({ environment, PoolClass });
  const inbox = createPublicWebOperationalMissionInboxPostgres({ pool });
  const evidenceStore = createStrongHumanReauthEmailEvidencePostgres({ pool });
  try {
    return await bindOperationalMissionEvidence({
      inbox,
      evidenceStore,
      mission_run_id:missionRunId,
      evidence_key:evidenceKey
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
      status:'PUBLIC_WEB_OPERATIONAL_MISSION_BIND_EVIDENCE_CLI_BLOCKED',
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

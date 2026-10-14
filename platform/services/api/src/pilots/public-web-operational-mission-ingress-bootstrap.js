'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createMachineIdentityRegistry } = require('../core/machine-identity-registry');
const { createOperationalMissionIngress } = require('../core/public-web-operational-mission-ingress');
const { createPublicWebCanaryStagingPostgresPool } = require('../adapters/postgres/public-web-canary-staging-postgres-pool');
const { createPublicWebOperationalMissionInboxPostgres } = require('../adapters/postgres/public-web-operational-mission-inbox-postgres');

const VERSION = 'public_web_operational_mission_ingress_bootstrap_v1';
const IDENTITY_ENV = 'HERMES_MISSION_INGRESS_IDENTITY_FILE';
const POLICY_ENV = 'HERMES_MISSION_INGRESS_POLICY_FILE';

function readProtectedJson(environment, key) {
  const value = environment?.[key];
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) throw new TypeError('mission_ingress_configuration_path_invalid');
  const st = fs.statSync(value);
  if ((st.mode & 0o777) !== 0o600) throw new TypeError('mission_ingress_configuration_permissions_invalid');
  const parsed = JSON.parse(fs.readFileSync(value, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('mission_ingress_configuration_invalid');
  return parsed;
}

function disabled() {
  return Object.freeze({ version:VERSION, enabled:false, machineIdentityRegistry:null, missionIngress:null, async close(){} });
}

function createPublicWebOperationalMissionIngressBootstrap({ environment=process.env, PoolClass=null, clock } = {}) {
  if (environment.HERMES_MISSION_INGRESS_ENABLED !== 'true') return disabled();
  const ResolvedPoolClass = PoolClass || require('pg').Pool;
  const identity = readProtectedJson(environment, IDENTITY_ENV);
  const policy = readProtectedJson(environment, POLICY_ENV);
  const machineIdentityRegistry = createMachineIdentityRegistry(identity);
  if (machineIdentityRegistry.size < 1) throw new TypeError('mission_ingress_identity_registry_empty');
  const pool = createPublicWebCanaryStagingPostgresPool({ environment, PoolClass: ResolvedPoolClass });
  const inbox = createPublicWebOperationalMissionInboxPostgres({ pool });
  const missionIngress = createOperationalMissionIngress({ inbox, policy, clock });
  let closed=false;
  return Object.freeze({
    version:VERSION,
    enabled:true,
    machineIdentityRegistry,
    missionIngress,
    async close(){ if (!closed) { closed=true; await pool.end(); } }
  });
}

module.exports = { VERSION, IDENTITY_ENV, POLICY_ENV, createPublicWebOperationalMissionIngressBootstrap };

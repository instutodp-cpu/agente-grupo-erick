#!/usr/bin/env node
'use strict';
// Staging-only PostgreSQL audit probe. Never sends HTTP requests or commits.
const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { buildDurableAuditRecord } = require('../src/core/public-web-canary-durable-audit-contract');
const { INSERT_SQL, READINESS_SQL } = require('../src/adapters/postgres/public-web-canary-audit-persistence-postgres');

async function run({ env = process.env, PoolClass = Pool, readCA = readFileSync } = {}) {
  const STAGING_HOST = 'db.vvzvqinbzdqzcwrfoomd.supabase.co';
  const required = ['POSTGRES_PORT', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'];
  if (required.some(k => !env[k]) || env.HERMES_ENVIRONMENT !== 'staging' || env.NODE_ENV === 'production' || env.HERMES_AUDIT_PROBE_CONFIRM_STAGING !== 'YES')
    return { ok: false, reason: 'staging_configuration_required', external_network_called: false };
  const port = Number(env.POSTGRES_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return { ok: false, reason: 'postgres_port_invalid', external_network_called: false };
  if (env.POSTGRES_HOST !== STAGING_HOST || env.POSTGRES_DB !== 'postgres' || port !== 5432)
    return { ok: false, reason: 'staging_database_target_required', external_network_called: false };
  let ca;
  try {
    if (env.HERMES_STAGING_CA_FILE !== '/home/hermesadmin/supabase-staging-root-ca.pem') throw new Error('staging_ca_required');
    ca = readCA(env.HERMES_STAGING_CA_FILE, 'utf8');
    if (!ca.includes('-----BEGIN CERTIFICATE-----')) throw new Error('staging_ca_invalid');
  } catch { return { ok: false, reason: 'staging_ca_unavailable', external_network_called: false }; }
  const pool = new PoolClass({ host: STAGING_HOST, port, user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB, ssl: { ca, rejectUnauthorized: true, servername: STAGING_HOST }, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
  let client;
  let begun = false;
  try {
    client = await pool.connect();
    const identity = await client.query("SELECT current_database() AS db, current_setting('server_version') AS server_version, to_regclass('hermes.public_web_canary_audit_events') IS NOT NULL AS audit_exists");
    if (!identity.rows[0]?.audit_exists) throw new Error('audit_table_missing');
    if (identity.rows[0]?.db !== 'postgres' || !String(identity.rows[0]?.server_version || '').startsWith('17.')) throw new Error('database_staging_identity_unverified');
    const readiness = await client.query(READINESS_SQL);
    if (!readiness.rows[0]?.schema_exists || !readiness.rows[0]?.table_exists || !readiness.rows[0]?.columns_exist) throw new Error('audit_schema_incompatible');
    await client.query('BEGIN READ WRITE');
    begun = true;
    const id = randomUUID();
    const event = buildDurableAuditRecord({
      event_name: 'public_web_canary_validation_blocked',
      trace_id: id, request_id: id, change_id: id, canary_session_id: id,
      tenant_id: 'staging_probe', workspace_type: 'staging', operator_id: 'operational_probe',
      occurred_at: new Date().toISOString(), event_sequence: 0,
      simulated: true, executed: false, real_provider_called: false
    });
    if (!event.valid) throw new Error('audit_event_invalid');
    const e = event.event;
    const params = [event.event_id,event.event_digest,event.contract_version,e.canary_session_id,e.trace_id,e.request_id,e.change_id,e.tenant_id,e.workspace_type,e.user_id||null,e.operator_id,e.approved_by||null,e.event_name,e.event_sequence,e.occurred_at,event.serialized];
    const result = await client.query(INSERT_SQL,params);
    if (result.rows.length !== 1) throw new Error('audit_insert_not_confirmed');
    await client.query('ROLLBACK');
    begun = false;
    return { ok: true, status: 'STAGING_AUDIT_TRANSACTION_PROBE_PASSED', rollback_confirmed: true, external_network_called: false, production_effect: 'ZERO', connection_role: '<redacted>', database: '<redacted>' };
  } catch (error) {
    return { ok: false, status: 'STAGING_AUDIT_TRANSACTION_PROBE_BLOCKED', reason: ['audit_table_missing','database_staging_identity_unverified','audit_schema_incompatible','audit_event_invalid','audit_insert_not_confirmed'].includes(error.message) ? error.message : 'connection_or_persistence_failed', code: error.code || null, external_network_called: false };
  } finally {
    if (client) { if (begun) { try { await client.query('ROLLBACK'); } catch {} } client.release(); }
    await pool.end();
  }
}
if (require.main === module) run().then(result => { process.stdout.write(JSON.stringify(result)+'\n'); process.exitCode=result.ok?0:2; }).catch(() => { process.stdout.write('{"ok":false,"reason":"probe_failed_closed"}\n');process.exitCode=2; });
module.exports = { run };

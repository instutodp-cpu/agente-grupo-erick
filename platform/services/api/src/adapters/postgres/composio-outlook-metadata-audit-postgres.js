'use strict';
// Atomic PostgreSQL quota reservation + append-only audit for the shared
// Grupo Erick Outlook metadata canary. No provider calls or production wiring.
const {randomUUID} = require('node:crypto');

const TABLE = 'hermes.composio_outlook_metadata_audit';
// A dedicated login must be granted SET on this NOLOGIN role; otherwise
// every transaction fails closed before touching the audit table.
const ROLE_SQL = 'SET LOCAL ROLE hermes_outlook_audit_writer';
const LOCK_SQL = 'SELECT pg_advisory_xact_lock(2071, 565)';
const COUNT_SQL = "SELECT count(*)::int AS attempts FROM " + TABLE +
  " WHERE tenant_id = 'grupo_erick' AND scope_type = 'group_shared'" +
  " AND event_type = 'attempt' AND occurred_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'";
const INSERT_ATTEMPT_SQL = "INSERT INTO " + TABLE +
  " (event_id, trace_id, tenant_id, scope_type, user_id, event_type)" +
  " VALUES ($1::uuid, $2::uuid, 'grupo_erick', 'group_shared', $3, 'attempt')" +
  " ON CONFLICT DO NOTHING RETURNING event_id";
const INSERT_RESULT_SQL = "INSERT INTO " + TABLE +
  " (event_id, trace_id, tenant_id, scope_type, user_id, event_type, outcome, sampled_messages)" +
  " SELECT $1::uuid, $2::uuid, 'grupo_erick', 'group_shared', $3, 'result', $4, $5" +
  " FROM " + TABLE + " WHERE trace_id = $2::uuid AND user_id = $3" +
  " AND event_type = 'attempt'" +
  " ON CONFLICT DO NOTHING RETURNING event_id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

function createPostgresComposioOutlookAudit({pool}={}) {
  if (!pool || typeof pool.connect !== 'function')
    throw TypeError('outlook_audit_pool_required');

  async function reserveAttempt({trace_id, user_id, max_requests=10}={}) {
    if (!UUID.test(trace_id) || !USER_ID.test(user_id) ||
        !Number.isInteger(max_requests) || max_requests < 1 || max_requests > 20)
      throw TypeError('outlook_audit_reservation_invalid');
    let client, began=false;
    try {
      client=await pool.connect();
      await client.query('BEGIN'); began=true;
      await client.query(ROLE_SQL);
      // Serializes quota checks across ALL worker processes using this DB.
      await client.query(LOCK_SQL);
      const counted=await client.query(COUNT_SQL);
      const attempts=counted?.rows?.[0]?.attempts;
      if (!Number.isInteger(attempts) || attempts < 0)
        throw Error('outlook_audit_count_invalid');
      if (attempts >= max_requests) {
        await client.query('ROLLBACK'); began=false;
        return Object.freeze({reserved:false,reason:'request_budget_exhausted'});
      }
      const inserted=await client.query(INSERT_ATTEMPT_SQL,
        [randomUUID(),trace_id,user_id]);
      if (inserted?.rowCount !== 1)
        throw Error('outlook_audit_reservation_conflict');
      await client.query('COMMIT'); began=false;
      return Object.freeze({reserved:true,trace_id});
    } catch {
      if (began && client) {
        try { await client.query('ROLLBACK'); } catch { /* fail closed */ }
      }
      throw Error('outlook_audit_reservation_failed');
    } finally {
      if (client) client.release();
    }
  }

  async function appendOutcome({trace_id,user_id,outcome,sampled_messages=null}={}) {
    if (!UUID.test(trace_id) || !USER_ID.test(user_id) ||
        !['SUCCEEDED','FAILED'].includes(outcome) ||
        (outcome === 'SUCCEEDED' &&
          (!Number.isInteger(sampled_messages) || sampled_messages < 0 || sampled_messages > 10)) ||
        (outcome === 'FAILED' && sampled_messages !== null))
      throw TypeError('outlook_audit_outcome_invalid');
    let client, began=false;
    try {
      client=await pool.connect();
      await client.query('BEGIN'); began=true;
      await client.query(ROLE_SQL);
      const inserted=await client.query(INSERT_RESULT_SQL,
        [randomUUID(),trace_id,user_id,outcome,sampled_messages]);
      if (inserted?.rowCount !== 1) throw Error('outlook_audit_outcome_conflict');
      await client.query('COMMIT'); began=false;
      return Object.freeze({persisted:true,trace_id});
    } catch {
      if (began && client) {
        try { await client.query('ROLLBACK'); } catch { /* fail closed */ }
      }
      throw Error('outlook_audit_outcome_failed');
    } finally {
      if (client) client.release();
    }
  }
  return Object.freeze({reserveAttempt,appendOutcome});
}

module.exports = {createPostgresComposioOutlookAudit,
  TABLE, ROLE_SQL, LOCK_SQL, COUNT_SQL, INSERT_ATTEMPT_SQL, INSERT_RESULT_SQL};

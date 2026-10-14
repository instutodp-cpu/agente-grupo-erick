'use strict';

const TABLE = 'hermes.public_web_operational_mission_inbox';
const PATCH_COLUMNS = Object.freeze(new Set([
  'reauth_challenge_id', 'reauth_action_digest', 'evidence_key',
  'execution_id', 'request_id', 'result_digest', 'result_summary', 'error_code',
  'callback_state', 'callback_attempts', 'callback_last_error',
  'completed_at', 'acknowledged_at'
]));
const STATUS_VALUES = Object.freeze(new Set([
  'accepted','preparing','awaiting_human_reauth','ready_for_tty','executing','succeeded','failed_safe','acknowledged'
]));

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') throw new TypeError('mission_inbox_pool_invalid');
}

function identityMatches(row, record) {
  return row
    && row.inbox_id === record.inbox_id
    && row.mission_id === record.mission_id
    && row.mission_run_id === record.mission_run_id
    && row.tenant_id === record.tenant_id
    && row.workspace_id === record.workspace_id
    && row.principal_id === record.principal_id
    && row.idempotency_key === record.idempotency_key
    && row.correlation_id === record.correlation_id
    && row.contract_hash === record.contract_hash
    && row.dispatch_token_digest === record.dispatch_token_digest;
}

function safePatch(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('mission_inbox_patch_invalid');
  const entries = Object.entries(patch);
  for (const [key] of entries) if (!PATCH_COLUMNS.has(key)) throw new TypeError(`mission_inbox_patch_field_forbidden:${key}`);
  return entries;
}

function createPublicWebOperationalMissionInboxPostgres({ pool } = {}) {
  requirePool(pool);
  const insert = `INSERT INTO ${TABLE} (
    inbox_id, contract_version, mission_id, mission_run_id, tenant_id, workspace_id, workspace_type,
    principal_id, idempotency_key, correlation_id, contract_hash, dispatch_token_digest,
    target_origin, target_path, mission_payload, trial_config, status, received_at
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18)
  ON CONFLICT DO NOTHING RETURNING *`;
  const selectIdentity = `SELECT * FROM ${TABLE} WHERE mission_run_id=$1 OR idempotency_key=$2 FOR SHARE`;
  const selectRun = `SELECT * FROM ${TABLE} WHERE mission_run_id=$1`;
  const readiness = `SELECT to_regclass('${TABLE}') IS NOT NULL AS table_exists`;

  async function ensureReady() {
    const result = await pool.query(readiness);
    return Object.freeze({ ok: result?.rows?.[0]?.table_exists === true, status: result?.rows?.[0]?.table_exists === true ? 'READY' : 'SCHEMA_MISSING' });
  }

  async function admit(record) {
    const ready = await ensureReady();
    if (!ready.ok) return Object.freeze({ ok:false, status:'NOT_READY', reason:ready.status });
    let client; let began=false;
    try {
      client=await pool.connect(); await client.query('BEGIN'); began=true;
      const values = [
        record.inbox_id,record.contract_version,record.mission_id,record.mission_run_id,record.tenant_id,record.workspace_id,record.workspace_type,
        record.principal_id,record.idempotency_key,record.correlation_id,record.contract_hash,record.dispatch_token_digest,
        record.target_origin,record.target_path,JSON.stringify(record.mission_payload),JSON.stringify(record.trial_config),record.status,record.received_at
      ];
      const created=await client.query(insert, values);
      if (created?.rows?.length===1) {
        await client.query('COMMIT'); began=false; client.release();
        return Object.freeze({ok:true,status:'INSERTED',inbox_id:record.inbox_id});
      }
      const existing=await client.query(selectIdentity,[record.mission_run_id,record.idempotency_key]);
      if (!existing?.rows?.length) throw new Error('mission_inbox_conflict_identity_missing');
      if (existing.rows.length !== 1 || !identityMatches(existing.rows[0],record)) {
        await client.query('ROLLBACK'); began=false; client.release();
        return Object.freeze({ok:false,status:'CONFLICT',reason:'mission_identity_or_contract_conflict'});
      }
      await client.query('COMMIT'); began=false; client.release();
      return Object.freeze({ok:true,status:'IDEMPOTENT_REPLAY',inbox_id:record.inbox_id});
    } catch (_error) {
      if (client && began) { try { await client.query('ROLLBACK'); } catch {} }
      if (client) { try { client.release(); } catch {} }
      return Object.freeze({ok:false,status:'PERSISTENCE_FAILED',reason:'mission_inbox_persistence_failed'});
    }
  }

  async function getByRun(missionRunId) {
    const ready = await ensureReady();
    if (!ready.ok) return Object.freeze({ok:false,status:'NOT_READY',reason:ready.status});
    if (typeof missionRunId !== 'string' || !missionRunId.trim()) return Object.freeze({ok:false,status:'INVALID',reason:'mission_run_id_required'});
    try {
      const result = await pool.query(selectRun,[missionRunId]);
      if (!result?.rows?.length) return Object.freeze({ok:false,status:'NOT_FOUND',reason:'mission_not_found'});
      if (result.rows.length !== 1) return Object.freeze({ok:false,status:'CONFLICT',reason:'mission_run_identity_not_unique'});
      return Object.freeze({ok:true,status:'FOUND',record:Object.freeze({...result.rows[0]})});
    } catch (_error) {
      return Object.freeze({ok:false,status:'PERSISTENCE_FAILED',reason:'mission_inbox_persistence_failed'});
    }
  }

  async function transition({ mission_run_id, expected_status, next_status, patch = {} } = {}) {
    const ready = await ensureReady();
    if (!ready.ok) return Object.freeze({ok:false,status:'NOT_READY',reason:ready.status});
    if (typeof mission_run_id !== 'string' || !mission_run_id.trim()) return Object.freeze({ok:false,status:'INVALID',reason:'mission_run_id_required'});
    if (!STATUS_VALUES.has(expected_status) || !STATUS_VALUES.has(next_status)) return Object.freeze({ok:false,status:'INVALID',reason:'mission_status_invalid'});
    let entries;
    try { entries = safePatch(patch); }
    catch (error) { return Object.freeze({ok:false,status:'INVALID',reason:error.message}); }
    const assignments = ['status=$3'];
    const values = [mission_run_id, expected_status, next_status];
    for (const [key,value] of entries) {
      values.push(value);
      assignments.push(`${key}=$${values.length}`);
    }
    assignments.push('updated_at=CURRENT_TIMESTAMP');
    const sql = `UPDATE ${TABLE} SET ${assignments.join(', ')} WHERE mission_run_id=$1 AND status=$2 RETURNING *`;
    try {
      const updated = await pool.query(sql, values);
      if (updated?.rows?.length === 1) return Object.freeze({ok:true,status:'TRANSITIONED',record:Object.freeze({...updated.rows[0]})});
      const current = await pool.query(selectRun,[mission_run_id]);
      if (!current?.rows?.length) return Object.freeze({ok:false,status:'NOT_FOUND',reason:'mission_not_found'});
      return Object.freeze({ok:false,status:'CONFLICT',reason:'mission_status_changed',current_status:current.rows[0].status});
    } catch (_error) {
      return Object.freeze({ok:false,status:'PERSISTENCE_FAILED',reason:'mission_inbox_persistence_failed'});
    }
  }

  return Object.freeze({ ensureReady, admit, getByRun, transition });
}

module.exports = { TABLE, PATCH_COLUMNS, STATUS_VALUES, createPublicWebOperationalMissionInboxPostgres };

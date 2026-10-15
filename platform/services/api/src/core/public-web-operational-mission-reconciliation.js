'use strict';

const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { hashCanaryEvidence } = require('./public-web-canary-session-contract');
const { VERSION: RESULT_VERSION } = require('./public-web-operational-mission-result');

const VERSION = 'public_web_operational_mission_reconciliation_v1';
const MISCLASSIFIED_SUCCESS_ERROR = 'PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_COMPLETED';
const RECONCILED_SUCCESS_SUMMARY = 'Public web metadata request completed successfully; reconciled from durable audit.';
const RECONCILABLE_OPERATIONS = Object.freeze(new Set(['fetch_public_page_summary','fetch_public_metadata']));

function blocked(reason, extra = {}) {
  return Object.freeze({
    ok:false,
    status:'PUBLIC_WEB_OPERATIONAL_MISSION_RECONCILIATION_BLOCKED',
    reason,
    ...extra,
    public_web_execution_repeated:false,
    external_public_web_called:false,
    production_allowed:false
  });
}

function nonEmpty(value) { return typeof value === 'string' && value.trim() !== ''; }
function canonicalIso(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
function eventOf(record) { return record && record.event && typeof record.event === 'object' ? record.event : record; }

function validateAuditChain(record, auditRecords) {
  if (!Array.isArray(auditRecords) || auditRecords.length !== 2) return blocked('durable_audit_request_cardinality_mismatch', { audit_event_count:Array.isArray(auditRecords) ? auditRecords.length : null });
  const started = eventOf(auditRecords[0]);
  const succeeded = eventOf(auditRecords[1]);
  if (!started || !succeeded) return blocked('durable_audit_event_invalid');
  if (started.event_name !== 'public_web_canary_request_started' || succeeded.event_name !== 'public_web_canary_request_succeeded') return blocked('durable_audit_event_sequence_invalid');
  if (started.request_id !== record.request_id || succeeded.request_id !== record.request_id) return blocked('durable_audit_request_identity_mismatch');
  if (!nonEmpty(started.canary_session_id) || started.canary_session_id !== succeeded.canary_session_id) return blocked('durable_audit_session_identity_mismatch');
  if (!nonEmpty(started.trace_id) || started.trace_id !== succeeded.trace_id) return blocked('durable_audit_trace_identity_mismatch');
  const startedAt = canonicalIso(started.occurred_at);
  const succeededAt = canonicalIso(succeeded.occurred_at);
  const completedAt = canonicalIso(record.completed_at);
  if (!startedAt || !succeededAt || !completedAt || Date.parse(startedAt) > Date.parse(succeededAt) || Date.parse(succeededAt) > Date.parse(completedAt)) return blocked('durable_audit_time_order_invalid');

  const expected = {
    tenant_id:record.tenant_id,
    workspace_type:record.workspace_type,
    user_id:record.trial_config?.user_id,
    operation:record.trial_config?.operation,
    environment:'staging',
    target_origin_hash:hashCanaryEvidence({ target_origin:record.target_origin })
  };
  for (const event of [started,succeeded]) {
    for (const [field,value] of Object.entries(expected)) {
      if (event[field] !== value) return blocked(`durable_audit_scope_mismatch:${field}`);
    }
  }

  if (started.status !== 'public_web_canary_request_started'
    || started.executed !== false
    || started.real_provider_called !== false
    || started.provider_invoked !== false
    || started.transport_invoked !== false
    || started.external_network_called !== false
    || started.simulated !== true
    || started.operator_id !== record.trial_config?.operator_id
    || started.approved_by !== record.trial_config?.operator_id) {
    return blocked('durable_audit_start_evidence_invalid');
  }

  if (succeeded.status !== 'public_web_candidate_success'
    || succeeded.executed !== true
    || succeeded.real_provider_called !== true
    || succeeded.provider_invoked !== true
    || succeeded.transport_invoked !== true
    || succeeded.external_network_called !== true
    || succeeded.simulated !== false
    || succeeded.current_state !== 'canary_allowed'
    || succeeded.can_trigger_real_execution !== false) {
    return blocked('durable_audit_success_evidence_invalid');
  }

  return Object.freeze({ ok:true, started, succeeded, completed_at:completedAt });
}

async function reconcileOperationalMissionRealSuccess({ inbox, auditStore, mission_run_id } = {}) {
  if (!inbox || typeof inbox.getByRun !== 'function' || typeof inbox.transition !== 'function') return blocked('durable_inbox_required');
  if (!auditStore || typeof auditStore.list !== 'function') return blocked('durable_audit_store_required');
  if (!nonEmpty(mission_run_id)) return blocked('mission_run_id_required');

  const found = await inbox.getByRun(mission_run_id);
  if (!found?.ok || !found.record) return blocked(found?.reason || 'mission_not_found');
  const record = found.record;
  if (record.status !== 'failed_safe') return blocked('mission_must_be_failed_safe', { current_status:record.status });
  if (record.error_code !== MISCLASSIFIED_SUCCESS_ERROR) return blocked('misclassified_success_signature_required');
  if (record.callback_state !== 'not_ready' || Number(record.callback_attempts || 0) !== 0) return blocked('callback_must_be_unattempted');
  if (Number(record.cost_units || 0) !== 0) return blocked('mission_cost_must_be_zero');
  if (!nonEmpty(record.execution_id) || !nonEmpty(record.request_id) || !/^sha256:[0-9a-f]{64}$/.test(String(record.result_digest || ''))) return blocked('terminal_execution_identity_invalid');
  if (!canonicalIso(record.completed_at)) return blocked('mission_completed_at_invalid');
  if (record.trial_config?.environment !== 'staging' || record.trial_config?.maximum_requests !== 1) return blocked('mission_trial_config_invalid');
  if (!RECONCILABLE_OPERATIONS.has(record.trial_config?.operation)) return blocked('mission_operation_not_reconcilable');
  if (!nonEmpty(record.target_origin) || !nonEmpty(record.target_path)) return blocked('mission_target_invalid');

  let allRecords;
  try { allRecords = await auditStore.list({ tenant_id:record.tenant_id }); }
  catch (_error) { return blocked('durable_audit_read_failed'); }
  if (!Array.isArray(allRecords)) return blocked('durable_audit_read_invalid');
  const requestRecords = allRecords.filter((entry)=>eventOf(entry)?.request_id === record.request_id);
  const proof = validateAuditChain(record, requestRecords);
  if (!proof.ok) return proof;

  const material = {
    version:RESULT_VERSION,
    mission_id:record.mission_id,
    mission_run_id:record.mission_run_id,
    contract_hash:record.contract_hash,
    execution_id:record.execution_id,
    request_id:record.request_id,
    status:'succeeded',
    real_execution:true,
    success:true,
    result_summary:RECONCILED_SUCCESS_SUMMARY,
    error_code:null,
    cost_units:0,
    completed_at:proof.completed_at
  };
  const resultDigest = computeCanonicalContentDigest(material);
  const updated = await inbox.transition({
    mission_run_id,
    expected_status:'failed_safe',
    next_status:'succeeded',
    patch:{
      result_digest:resultDigest,
      result_summary:RECONCILED_SUCCESS_SUMMARY,
      error_code:null,
      cost_units:0,
      callback_state:'pending',
      callback_attempts:0,
      callback_last_error:null,
      completed_at:proof.completed_at
    }
  });
  if (!updated?.ok) return blocked(updated?.reason || 'mission_reconciliation_persistence_failed', { current_status:updated?.current_status || null });

  return Object.freeze({
    ok:true,
    status:'PUBLIC_WEB_OPERATIONAL_MISSION_REAL_SUCCESS_RECONCILED',
    version:VERSION,
    mission_id:record.mission_id,
    mission_run_id:record.mission_run_id,
    execution_id:record.execution_id,
    request_id:record.request_id,
    result_digest:resultDigest,
    audit_event_count:requestRecords.length,
    callback_state:'pending',
    public_web_execution_repeated:false,
    external_public_web_called:false,
    production_allowed:false,
    record:updated.record
  });
}

module.exports = {
  VERSION,
  MISCLASSIFIED_SUCCESS_ERROR,
  RECONCILED_SUCCESS_SUMMARY,
  validateAuditChain,
  reconcileOperationalMissionRealSuccess
};

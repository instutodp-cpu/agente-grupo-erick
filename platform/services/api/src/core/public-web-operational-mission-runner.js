'use strict';

const {
  classifyOperationalMissionExecution,
  buildOperationalMissionCallbackEnvelope
} = require('./public-web-operational-mission-result');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { hashValue } = require('./public-web-transport-contract');

const VERSION = 'public_web_operational_mission_runner_v1';
const MAX_CALLBACK_ATTEMPTS = 10;
const RECONCILIATION_VERSION = 'public_web_operational_mission_real_success_reconciliation_v1';

function blocked(reason, extra = {}) {
  return Object.freeze({ ok:false, status:'PUBLIC_WEB_OPERATIONAL_MISSION_RUNNER_BLOCKED', reason, ...extra, execution_started:false, external_network_called:false, production_allowed:false });
}
function nonEmpty(value) { return typeof value === 'string' && value.trim() !== ''; }
function safeError(value) { return String(value || 'callback_failed_safe').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 500); }
function timestampMillis(value) {
  if (value instanceof Date) return value.getTime();
  return Date.parse(String(value));
}
function timestampIso(value) {
  const milliseconds = timestampMillis(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}
function nowIso(clock) {
  const value = timestampIso(clock());
  if (!value) throw new TypeError('clock_invalid');
  return value;
}

async function applyCallback({ inbox, record, callbackSender, clock }) {
  if (!callbackSender || typeof callbackSender.send !== 'function') return Object.freeze({ ok:true, status:'CALLBACK_PENDING', record });
  const currentAttempts = Number(record.callback_attempts || 0);
  const attempts = currentAttempts + 1;
  if (currentAttempts >= MAX_CALLBACK_ATTEMPTS) {
    const dead = await inbox.transition({
      mission_run_id:record.mission_run_id,
      expected_status:record.status,
      next_status:record.status,
      patch:{ callback_state:'dead_letter', callback_attempts:MAX_CALLBACK_ATTEMPTS, callback_last_error:'maximum_callback_attempts_exceeded' }
    });
    return Object.freeze({ ok:false, status:'CALLBACK_DEAD_LETTER', record:dead.record || record });
  }

  let envelope;
  try { envelope = buildOperationalMissionCallbackEnvelope(record); }
  catch (_error) { return Object.freeze({ ok:false, status:'CALLBACK_BUILD_BLOCKED', record }); }
  const sending = await inbox.transition({
    mission_run_id:record.mission_run_id,
    expected_status:record.status,
    next_status:record.status,
    patch:{ callback_state:'sending', callback_attempts:attempts, callback_last_error:null }
  });
  if (!sending.ok) return Object.freeze({ ok:false, status:'CALLBACK_STATE_CONFLICT', record });

  let delivery;
  try { delivery = await callbackSender.send(envelope); }
  catch (_error) { delivery = { ok:false, reason:'callback_transport_failed' }; }
  if (delivery?.ok === true && delivery.acknowledged === true) {
    const acknowledgedAt = nowIso(clock);
    const acknowledged = await inbox.transition({
      mission_run_id:record.mission_run_id,
      expected_status:record.status,
      next_status:'acknowledged',
      patch:{ callback_state:'acknowledged', callback_attempts:attempts, callback_last_error:null, acknowledged_at:acknowledgedAt }
    });
    return Object.freeze({ ok:acknowledged.ok === true, status:acknowledged.ok ? 'CALLBACK_ACKNOWLEDGED' : 'CALLBACK_ACK_PERSISTENCE_FAILED', record:acknowledged.record || sending.record, delivery });
  }

  const terminal = attempts >= MAX_CALLBACK_ATTEMPTS;
  const retry = await inbox.transition({
    mission_run_id:record.mission_run_id,
    expected_status:record.status,
    next_status:record.status,
    patch:{ callback_state:terminal ? 'dead_letter' : 'retry', callback_attempts:attempts, callback_last_error:safeError(delivery?.reason || delivery?.status) }
  });
  return Object.freeze({ ok:false, status:terminal ? 'CALLBACK_DEAD_LETTER' : 'CALLBACK_RETRY', record:retry.record || sending.record, delivery });
}

async function runReadyOperationalMission({ inbox, mission_run_id, execution_id, request_id, execute, callbackSender = null, clock = () => new Date().toISOString() } = {}) {
  if (!inbox || typeof inbox.getByRun !== 'function' || typeof inbox.transition !== 'function') return blocked('durable_inbox_required');
  if (!nonEmpty(mission_run_id) || !nonEmpty(execution_id) || !nonEmpty(request_id)) return blocked('execution_identity_required');
  if (typeof execute !== 'function') return blocked('execution_function_required');

  const found = await inbox.getByRun(mission_run_id);
  if (!found?.ok || !found.record) return blocked(found?.reason || 'mission_not_found');
  const record = found.record;
  if (record.status !== 'ready_for_tty') return blocked('mission_must_be_ready_for_tty', { current_status:record.status });
  if (record.trial_config?.environment !== 'staging' || record.trial_config?.maximum_requests !== 1 || !nonEmpty(record.evidence_key)) {
    return blocked('mission_execution_binding_invalid');
  }

  const reserved = await inbox.transition({
    mission_run_id,
    expected_status:'ready_for_tty',
    next_status:'executing',
    patch:{ execution_id, request_id, error_code:null, callback_state:'not_ready' }
  });
  if (!reserved?.ok) return blocked(reserved?.reason || 'execution_reservation_conflict', { current_status:reserved?.current_status || null });

  let result;
  try { result = await execute({ record:reserved.record, execution_id, request_id }); }
  catch (_error) { result = { ok:false, status:'operational_mission_execution_threw', executed:false, real_provider_called:false, production_effect:'ZERO' }; }

  let outcome;
  try { outcome = classifyOperationalMissionExecution({ result, record:reserved.record, execution_id, request_id, clock }); }
  catch (_error) { outcome = classifyOperationalMissionExecution({ result:{ ok:false, status:'operational_mission_result_invalid' }, record:reserved.record, execution_id, request_id, clock }); }
  const terminal = await inbox.transition({
    mission_run_id,
    expected_status:'executing',
    next_status:outcome.status,
    patch:{
      execution_id,
      request_id,
      result_digest:outcome.result_digest,
      result_summary:outcome.result_summary,
      error_code:outcome.error_code,
      cost_units:outcome.cost_units,
      callback_state:outcome.callback_state,
      callback_attempts:0,
      callback_last_error:null,
      completed_at:outcome.completed_at
    }
  });
  if (!terminal?.ok) return Object.freeze({ ok:false, status:'PUBLIC_WEB_OPERATIONAL_MISSION_RESULT_PERSISTENCE_FAILED', outcome, production_allowed:false });

  if (!outcome.callback_ready) {
    return Object.freeze({ ok:false, status:'PUBLIC_WEB_OPERATIONAL_MISSION_FAILED_SAFE_NO_REAL_CALLBACK', outcome, record:terminal.record, callback_attempted:false, production_allowed:false });
  }
  const callback = await applyCallback({ inbox, record:terminal.record, callbackSender, clock });
  return Object.freeze({
    ok:outcome.status === 'succeeded',
    status:outcome.status === 'succeeded' ? 'PUBLIC_WEB_OPERATIONAL_MISSION_EXECUTION_SUCCEEDED' : 'PUBLIC_WEB_OPERATIONAL_MISSION_EXECUTION_FAILED_SAFE',
    outcome,
    record:callback.record || terminal.record,
    callback,
    external_network_called:true,
    public_web_execution_repeated:false,
    production_allowed:false
  });
}


function eventRecord(entry) {
  return entry && entry.event && typeof entry.event === 'object' ? entry.event : null;
}

function validateDurableRealSuccessProof(record, entries) {
  if (!record || !Array.isArray(entries) || entries.length !== 2) {
    return Object.freeze({ ok:false, reason:'durable_audit_exact_request_pair_required' });
  }
  const pairs = entries.map((entry) => ({ entry, event:eventRecord(entry) }));
  if (pairs.some(({ event }) => !event)) return Object.freeze({ ok:false, reason:'durable_audit_event_invalid' });
  const startedMatches = pairs.filter(({ event }) => event.event_name === 'public_web_canary_request_started');
  const succeededMatches = pairs.filter(({ event }) => event.event_name === 'public_web_canary_request_succeeded');
  if (startedMatches.length !== 1 || succeededMatches.length !== 1) {
    return Object.freeze({ ok:false, reason:'durable_audit_started_succeeded_pair_required' });
  }
  const started = startedMatches[0];
  const succeeded = succeededMatches[0];
  const start = started.event;
  const success = succeeded.event;
  const trial = record.trial_config && typeof record.trial_config === 'object' ? record.trial_config : {};
  const targetHash = hashValue(record.target_origin);
  const common = (event) => event.request_id === record.request_id
    && event.tenant_id === record.tenant_id
    && event.workspace_type === record.workspace_type
    && event.user_id === trial.user_id
    && event.operation === trial.operation
    && event.target_origin_hash === targetHash;
  if (!common(start) || !common(success)) return Object.freeze({ ok:false, reason:'durable_audit_mission_binding_mismatch' });
  if (!nonEmpty(start.canary_session_id) || start.canary_session_id !== success.canary_session_id) {
    return Object.freeze({ ok:false, reason:'durable_audit_session_mismatch' });
  }
  if (!nonEmpty(start.trace_id) || start.trace_id !== success.trace_id) {
    return Object.freeze({ ok:false, reason:'durable_audit_trace_mismatch' });
  }
  if (start.operator_id !== trial.operator_id) return Object.freeze({ ok:false, reason:'durable_audit_operator_mismatch' });
  if (![trial.operator_id, 'operator_not_available'].includes(success.operator_id)) {
    return Object.freeze({ ok:false, reason:'durable_audit_success_operator_mismatch' });
  }
  const startedAt = timestampMillis(start.occurred_at);
  const succeededAt = timestampMillis(success.occurred_at);
  const completedAt = timestampMillis(record.completed_at);
  if (![startedAt, succeededAt, completedAt].every(Number.isFinite) || startedAt > succeededAt || succeededAt > completedAt) {
    return Object.freeze({ ok:false, reason:'durable_audit_timeline_invalid' });
  }
  if (start.status !== 'public_web_canary_request_started'
    || start.simulated !== true
    || start.executed !== false
    || start.real_provider_called !== false
    || start.provider_invoked !== false
    || start.transport_invoked !== false
    || start.external_network_called !== false
    || start.error_code != null
    || start.blocked_reason != null) {
    return Object.freeze({ ok:false, reason:'durable_audit_started_event_invalid' });
  }
  if (success.status !== 'public_web_candidate_success'
    || success.simulated !== false
    || success.executed !== true
    || success.real_provider_called !== true
    || success.provider_invoked !== true
    || success.transport_invoked !== true
    || success.external_network_called !== true
    || success.error_code != null
    || success.blocked_reason != null) {
    return Object.freeze({ ok:false, reason:'durable_audit_success_event_invalid' });
  }
  const digests = [started.entry.event_digest, succeeded.entry.event_digest];
  if (digests.some((value) => !/^sha256:[0-9a-f]{64}$/.test(String(value || '')))) {
    return Object.freeze({ ok:false, reason:'durable_audit_digest_invalid' });
  }
  return Object.freeze({
    ok:true,
    started_event_digest:digests[0],
    succeeded_event_digest:digests[1],
    canary_session_id:start.canary_session_id,
    trace_id:start.trace_id,
    started_at:new Date(startedAt).toISOString(),
    succeeded_at:new Date(succeededAt).toISOString()
  });
}

async function reconcileOperationalMissionRealSuccess({ inbox, auditPersistence, mission_run_id, callbackSender = null, clock = () => new Date().toISOString() } = {}) {
  if (!inbox || typeof inbox.getByRun !== 'function' || typeof inbox.transition !== 'function') return blocked('durable_inbox_required');
  if (!auditPersistence || typeof auditPersistence.listByRequest !== 'function') return blocked('durable_audit_request_reader_required');
  if (!nonEmpty(mission_run_id)) return blocked('mission_run_id_required');
  const found = await inbox.getByRun(mission_run_id);
  if (!found?.ok || !found.record) return blocked(found?.reason || 'mission_not_found');
  const record = found.record;
  const trial = record.trial_config && typeof record.trial_config === 'object' ? record.trial_config : {};
  if (record.status !== 'failed_safe'
    || record.callback_state !== 'not_ready'
    || Number(record.callback_attempts || 0) !== 0
    || record.error_code !== 'PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_COMPLETED'
    || !nonEmpty(record.execution_id)
    || !nonEmpty(record.request_id)
    || !/^sha256:[0-9a-f]{64}$/.test(String(record.result_digest || ''))
    || !timestampIso(record.completed_at)
    || record.acknowledged_at != null
    || Number(record.cost_units || 0) !== 0
    || trial.environment !== 'staging'
    || trial.maximum_requests !== 1
    || !nonEmpty(trial.operation)
    || !nonEmpty(trial.operator_id)
    || !nonEmpty(trial.user_id)
    || trial.tenant_id !== record.tenant_id
    || trial.workspace_type !== record.workspace_type
    || trial.target_origin !== record.target_origin
    || trial.target_path !== record.target_path
    || typeof record.target_origin !== 'string'
    || !record.target_origin.startsWith('https://')) {
    return blocked('mission_not_eligible_for_real_success_reconciliation', { current_status:record.status, callback_state:record.callback_state });
  }
  let entries;
  try {
    entries = await auditPersistence.listByRequest({ request_id:record.request_id, tenant_id:record.tenant_id });
  } catch (_error) {
    return blocked('durable_audit_request_read_failed');
  }
  const proof = validateDurableRealSuccessProof(record, entries);
  if (!proof.ok) return blocked(proof.reason);
  const resultSummary = 'Durable audit confirms the reserved single public-web request completed successfully; no public-web replay was performed.';
  const reconciliationMaterial = {
    version:RECONCILIATION_VERSION,
    mission_id:record.mission_id,
    mission_run_id:record.mission_run_id,
    contract_hash:record.contract_hash,
    execution_id:record.execution_id,
    request_id:record.request_id,
    prior_status:'failed_safe',
    status:'succeeded',
    result_summary:resultSummary,
    error_code:null,
    cost_units:0,
    completed_at:timestampIso(record.completed_at),
    audit_proof:{
      started_event_digest:proof.started_event_digest,
      succeeded_event_digest:proof.succeeded_event_digest,
      canary_session_id:proof.canary_session_id,
      trace_id:proof.trace_id
    }
  };
  const corrected = await inbox.transition({
    mission_run_id:record.mission_run_id,
    expected_status:'failed_safe',
    next_status:'succeeded',
    patch:{
      result_digest:computeCanonicalContentDigest(reconciliationMaterial),
      result_summary:resultSummary,
      error_code:null,
      cost_units:0,
      callback_state:'pending',
      callback_attempts:0,
      callback_last_error:null,
      completed_at:reconciliationMaterial.completed_at
    }
  });
  if (!corrected?.ok) return blocked(corrected?.reason || 'mission_reconciliation_persistence_conflict', { current_status:corrected?.current_status || null });
  const callback = await applyCallback({ inbox, record:corrected.record, callbackSender, clock });
  return Object.freeze({
    ok:true,
    status:'PUBLIC_WEB_OPERATIONAL_MISSION_REAL_SUCCESS_RECONCILED',
    record:callback.record || corrected.record,
    callback,
    proof,
    reconciled_from_durable_audit:true,
    public_web_execution_repeated:false,
    external_public_web_called:false,
    production_allowed:false
  });
}

async function retryOperationalMissionCallback({ inbox, mission_run_id, callbackSender, clock = () => new Date().toISOString() } = {}) {
  if (!inbox || typeof inbox.getByRun !== 'function' || typeof inbox.transition !== 'function') return blocked('durable_inbox_required');
  if (!callbackSender || typeof callbackSender.send !== 'function') return blocked('callback_sender_required');
  const found = await inbox.getByRun(mission_run_id);
  if (!found?.ok || !found.record) return blocked(found?.reason || 'mission_not_found');
  const record = found.record;
  if (!['succeeded','failed_safe'].includes(record.status) || !['pending','retry'].includes(record.callback_state)) {
    return blocked('callback_retry_not_allowed', { current_status:record.status, callback_state:record.callback_state });
  }
  const callback = await applyCallback({ inbox, record, callbackSender, clock });
  return Object.freeze({ ok:callback.ok === true, status:'PUBLIC_WEB_OPERATIONAL_MISSION_CALLBACK_RETRY_COMPLETED', callback, public_web_execution_repeated:false, external_public_web_called:false, production_allowed:false });
}

module.exports = { VERSION, MAX_CALLBACK_ATTEMPTS, RECONCILIATION_VERSION, runReadyOperationalMission, retryOperationalMissionCallback, validateDurableRealSuccessProof, reconcileOperationalMissionRealSuccess };

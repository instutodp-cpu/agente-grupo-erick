'use strict';

const {
  classifyOperationalMissionExecution,
  buildOperationalMissionCallbackEnvelope
} = require('./public-web-operational-mission-result');

const VERSION = 'public_web_operational_mission_runner_v1';
const MAX_CALLBACK_ATTEMPTS = 10;

function blocked(reason, extra = {}) {
  return Object.freeze({ ok:false, status:'PUBLIC_WEB_OPERATIONAL_MISSION_RUNNER_BLOCKED', reason, ...extra, execution_started:false, external_network_called:false, production_allowed:false });
}
function nonEmpty(value) { return typeof value === 'string' && value.trim() !== ''; }
function safeError(value) { return String(value || 'callback_failed_safe').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 500); }
function nowIso(clock) {
  const value = String(clock());
  if (Number.isNaN(Date.parse(value))) throw new TypeError('clock_invalid');
  return new Date(Date.parse(value)).toISOString();
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

module.exports = { VERSION, MAX_CALLBACK_ATTEMPTS, runReadyOperationalMission, retryOperationalMissionCallback };

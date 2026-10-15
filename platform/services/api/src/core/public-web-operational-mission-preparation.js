'use strict';

const VERSION = 'public_web_operational_mission_preparation_v1';

function blocked(reason, extra = {}) {
  return Object.freeze({
    ok:false,
    status:'PUBLIC_WEB_OPERATIONAL_MISSION_PREPARATION_BLOCKED',
    reason,
    ...extra,
    execution_authorized:false,
    execution_started:false,
    external_network_called:false,
    production_allowed:false
  });
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function storedOperatorId(record) {
  const config = record?.trial_config;
  if (!config || config.environment !== 'staging' || config.maximum_requests !== 1 || !nonEmpty(config.operator_id)) return null;
  return config.operator_id.trim();
}

function pristinePreExecution(record) {
  return record?.callback_state === 'not_ready'
    && !nonEmpty(record.execution_id)
    && !nonEmpty(record.request_id)
    && !nonEmpty(record.result_digest)
    && !record.completed_at
    && !record.acknowledged_at
    && Number(record.cost_units || 0) === 0;
}

async function prepareReservedMissionReauth({
  inbox,
  record,
  mission_run_id,
  challengeFactory,
  clock,
  expected_status,
  reserve_patch = {}
}) {
  const operatorId = storedOperatorId(record);
  if (!operatorId) return blocked('stored_trial_config_invalid');

  const preparing = await inbox.transition({
    mission_run_id,
    expected_status,
    next_status:'preparing',
    patch:reserve_patch
  });
  if (!preparing?.ok) return blocked(preparing?.reason || 'mission_preparation_reservation_failed', { current_status:preparing?.current_status || null });

  let challenge;
  try {
    challenge = await challengeFactory({
      target_origin:record.target_origin,
      target_path:record.target_path,
      mission_id:record.mission_id,
      mission_run_id,
      contract_hash:record.contract_hash,
      subject_id:operatorId
    });
  } catch (_error) {
    const completedAt = String(clock());
    await inbox.transition({
      mission_run_id,
      expected_status:'preparing',
      next_status:'failed_safe',
      patch:{ error_code:'reauth_challenge_preparation_failed', completed_at:completedAt }
    });
    return blocked('reauth_challenge_preparation_failed');
  }

  if (!challenge || challenge.ok !== true || challenge.status !== 'EMAIL_REAUTH_OPERATIONAL_CHALLENGE_READY'
    || !nonEmpty(challenge.challenge_id) || !nonEmpty(challenge.action_digest)
    || !nonEmpty(challenge.delivery_reference) || challenge.subject_id !== operatorId
    || challenge.execution_authorized !== false || challenge.production_allowed !== false) {
    const completedAt = String(clock());
    await inbox.transition({
      mission_run_id,
      expected_status:'preparing',
      next_status:'failed_safe',
      patch:{ error_code:'reauth_challenge_invalid', completed_at:completedAt }
    });
    return blocked('reauth_challenge_invalid');
  }

  const waiting = await inbox.transition({
    mission_run_id,
    expected_status:'preparing',
    next_status:'awaiting_human_reauth',
    patch:{
      reauth_challenge_id:challenge.challenge_id,
      reauth_action_digest:challenge.action_digest,
      error_code:null
    }
  });
  if (!waiting?.ok) return blocked(waiting?.reason || 'reauth_state_persistence_failed');

  return Object.freeze({
    ok:true,
    status:'PUBLIC_WEB_OPERATIONAL_MISSION_AWAITING_HUMAN_REAUTH',
    version:VERSION,
    mission_id:record.mission_id,
    mission_run_id,
    contract_hash:record.contract_hash,
    target_origin:record.target_origin,
    target_path:record.target_path,
    subject_id:operatorId,
    challenge_id:challenge.challenge_id,
    action_digest:challenge.action_digest,
    delivery_reference:challenge.delivery_reference,
    identity_alias:challenge.identity_alias,
    issued_at:challenge.issued_at,
    ttl_seconds:challenge.ttl_seconds,
    execution_authorized:false,
    execution_started:false,
    external_network_called:false,
    production_allowed:false
  });
}

async function prepareOperationalMissionReauth({ inbox, mission_run_id, challengeFactory, clock = () => new Date().toISOString() } = {}) {
  if (!inbox || typeof inbox.getByRun !== 'function' || typeof inbox.transition !== 'function') return blocked('durable_inbox_required');
  if (!nonEmpty(mission_run_id)) return blocked('mission_run_id_required');
  if (typeof challengeFactory !== 'function') return blocked('challenge_factory_required');

  const found = await inbox.getByRun(mission_run_id);
  if (!found?.ok || !found.record) return blocked(found?.reason || 'mission_not_found');
  if (found.record.status !== 'accepted') return blocked('mission_must_be_accepted', { current_status:found.record.status });
  if (!storedOperatorId(found.record)) return blocked('stored_trial_config_invalid');

  return prepareReservedMissionReauth({
    inbox,
    record:found.record,
    mission_run_id,
    challengeFactory,
    clock,
    expected_status:'accepted'
  });
}

async function reissueOperationalMissionReauth({ inbox, mission_run_id, challengeFactory, clock = () => new Date().toISOString() } = {}) {
  if (!inbox || typeof inbox.getByRun !== 'function' || typeof inbox.transition !== 'function') return blocked('durable_inbox_required');
  if (!nonEmpty(mission_run_id)) return blocked('mission_run_id_required');
  if (typeof challengeFactory !== 'function') return blocked('challenge_factory_required');

  const found = await inbox.getByRun(mission_run_id);
  if (!found?.ok || !found.record) return blocked(found?.reason || 'mission_not_found');
  const record = found.record;
  if (record.status !== 'ready_for_tty') return blocked('mission_must_be_ready_for_tty', { current_status:record.status });
  if (!storedOperatorId(record)) return blocked('stored_trial_config_invalid');
  if (!pristinePreExecution(record)) return blocked('mission_reauth_reissue_requires_pristine_pre_execution_state');

  return prepareReservedMissionReauth({
    inbox,
    record,
    mission_run_id,
    challengeFactory,
    clock,
    expected_status:'ready_for_tty',
    reserve_patch:{
      reauth_challenge_id:null,
      reauth_action_digest:null,
      evidence_key:null,
      error_code:null
    }
  });
}

async function bindOperationalMissionEvidence({ inbox, evidenceStore, mission_run_id, evidence_key } = {}) {
  if (!inbox || typeof inbox.getByRun !== 'function' || typeof inbox.transition !== 'function') return blocked('durable_inbox_required');
  if (!evidenceStore || typeof evidenceStore.readVerified !== 'function') return blocked('durable_evidence_store_required');
  if (!nonEmpty(mission_run_id)) return blocked('mission_run_id_required');
  if (!/^sha256:[0-9a-f]{64}$/.test(String(evidence_key || ''))) return blocked('evidence_key_invalid');

  const found = await inbox.getByRun(mission_run_id);
  if (!found?.ok || !found.record) return blocked(found?.reason || 'mission_not_found');
  const record = found.record;
  if (record.status !== 'awaiting_human_reauth') return blocked('mission_must_be_awaiting_human_reauth', { current_status:record.status });
  if (!nonEmpty(record.reauth_challenge_id) || !nonEmpty(record.reauth_action_digest)) return blocked('mission_reauth_binding_missing');
  const operatorId = storedOperatorId(record);
  if (!operatorId) return blocked('stored_trial_config_invalid');

  let evidence;
  try { evidence = await evidenceStore.readVerified(evidence_key); }
  catch (_error) { return blocked('verified_durable_evidence_required'); }
  if (!evidence || evidence.ok !== true || evidence.durable !== true || evidence.single_use !== true
    || evidence.challenge_id !== record.reauth_challenge_id || evidence.action_digest !== record.reauth_action_digest
    || evidence.subject_id !== operatorId) {
    return blocked('mission_reauth_evidence_binding_mismatch');
  }

  const ready = await inbox.transition({
    mission_run_id,
    expected_status:'awaiting_human_reauth',
    next_status:'ready_for_tty',
    patch:{ evidence_key, error_code:null }
  });
  if (!ready?.ok) return blocked(ready?.reason || 'mission_evidence_state_persistence_failed', { current_status:ready?.current_status || null });

  return Object.freeze({
    ok:true,
    status:'PUBLIC_WEB_OPERATIONAL_MISSION_READY_FOR_TTY',
    version:VERSION,
    mission_id:record.mission_id,
    mission_run_id,
    contract_hash:record.contract_hash,
    evidence_key,
    verified_at:evidence.verified_at || null,
    execution_authorized:false,
    execution_started:false,
    external_network_called:false,
    production_allowed:false
  });
}

module.exports = {
  VERSION,
  prepareOperationalMissionReauth,
  reissueOperationalMissionReauth,
  bindOperationalMissionEvidence
};

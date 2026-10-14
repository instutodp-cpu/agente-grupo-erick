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

async function prepareOperationalMissionReauth({ inbox, mission_run_id, challengeFactory, clock = () => new Date().toISOString() } = {}) {
  if (!inbox || typeof inbox.getByRun !== 'function' || typeof inbox.transition !== 'function') return blocked('durable_inbox_required');
  if (!nonEmpty(mission_run_id)) return blocked('mission_run_id_required');
  if (typeof challengeFactory !== 'function') return blocked('challenge_factory_required');

  const found = await inbox.getByRun(mission_run_id);
  if (!found?.ok || !found.record) return blocked(found?.reason || 'mission_not_found');
  if (found.record.status !== 'accepted') return blocked('mission_must_be_accepted', { current_status:found.record.status });
  if (found.record.trial_config?.environment !== 'staging' || found.record.trial_config?.maximum_requests !== 1) {
    return blocked('stored_trial_config_invalid');
  }

  const preparing = await inbox.transition({ mission_run_id, expected_status:'accepted', next_status:'preparing' });
  if (!preparing?.ok) return blocked(preparing?.reason || 'mission_preparation_reservation_failed', { current_status:preparing?.current_status || null });

  let challenge;
  try {
    challenge = await challengeFactory({
      target_origin: found.record.target_origin,
      target_path: found.record.target_path,
      mission_id: found.record.mission_id,
      mission_run_id,
      contract_hash: found.record.contract_hash
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
    || !nonEmpty(challenge.delivery_reference) || challenge.execution_authorized !== false
    || challenge.production_allowed !== false) {
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
    mission_id:found.record.mission_id,
    mission_run_id,
    contract_hash:found.record.contract_hash,
    target_origin:found.record.target_origin,
    target_path:found.record.target_path,
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

module.exports = { VERSION, prepareOperationalMissionReauth };

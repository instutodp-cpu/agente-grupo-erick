'use strict';

const { computeCanonicalContentDigest } = require('./canonical-content-digest');

const VERSION = 'public_web_operational_mission_result_v1';
const CALLBACK_VERSION = 'hermes_operational_mission_callback_v1';
const CALLBACK_PROVIDER = 'hermes_public_web_staging';

function nonEmpty(value) { return typeof value === 'string' && value.trim() !== ''; }
function boundedText(value, max) {
  const text = typeof value === 'string' ? value : '';
  return Buffer.byteLength(text, 'utf8') <= max ? text : text.slice(0, max);
}
function safeCost(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

function hasCompleteRealEvidence(result, expectedRequestId) {
  const runner = result?.runner_result;
  return Boolean(
    result && runner
    && result.executed === true
    && result.real_provider_called === true
    && result.environment === 'staging'
    && result.production_effect === 'ZERO'
    && runner.executed === true
    && runner.real_provider_called === true
    && runner.provider_invoked === true
    && runner.transport_invoked === true
    && runner.external_network_called === true
    && runner.simulated === false
    && runner.redirects_followed === 0
    && nonEmpty(runner.request_id)
    && runner.request_id === expectedRequestId
  );
}

function classifyOperationalMissionExecution({ result, record, execution_id, request_id, clock = () => new Date().toISOString() } = {}) {
  if (!record || !nonEmpty(record.mission_id) || !nonEmpty(record.mission_run_id) || !nonEmpty(record.contract_hash)) {
    throw new TypeError('mission_record_invalid');
  }
  if (!nonEmpty(execution_id) || !nonEmpty(request_id)) throw new TypeError('execution_identity_required');
  const completedAt = String(clock());
  if (Number.isNaN(Date.parse(completedAt))) throw new TypeError('clock_invalid');
  const real = hasCompleteRealEvidence(result, request_id);
  const success = real
    && result.ok === true
    && result.status === 'PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_COMPLETED'
    && result.runner_result?.status === 'public_web_candidate_success';
  const networkFailure = real && !success;
  const status = success ? 'succeeded' : 'failed_safe';
  const resultSummary = success
    ? boundedText(result.runner_result?.safe_summary || '', 8000)
    : real ? boundedText(result.runner_result?.error?.message || result.status || 'public_web_execution_failed_safe', 8000) : '';
  const errorCode = success ? null : boundedText(
    real ? (result.runner_result?.error?.code || result.runner_result?.status || result.status || 'public_web_execution_failed_safe')
      : (result?.status || 'public_web_execution_pre_network_blocked'),
    200
  );
  const costUnits = real ? safeCost(result.runner_result?.cost_metadata?.cost_units) : 0;
  const material = {
    version: VERSION,
    mission_id: record.mission_id,
    mission_run_id: record.mission_run_id,
    contract_hash: record.contract_hash,
    execution_id,
    request_id,
    status,
    real_execution: real,
    success,
    result_summary: resultSummary,
    error_code: errorCode,
    cost_units: costUnits,
    completed_at: new Date(Date.parse(completedAt)).toISOString()
  };
  return Object.freeze({
    ...material,
    result_digest: computeCanonicalContentDigest(material),
    callback_ready: real,
    callback_state: real ? 'pending' : 'not_ready',
    external_network_called: real,
    production_effect: 'ZERO',
    simulated: !real,
    network_failure: networkFailure
  });
}

function buildOperationalMissionCallbackEnvelope(record = {}) {
  if (!record || !['succeeded','failed_safe','acknowledged'].includes(record.status)) throw new TypeError('terminal_mission_record_required');
  if (!nonEmpty(record.execution_id) || !nonEmpty(record.request_id) || !nonEmpty(record.completed_at)) throw new TypeError('terminal_execution_identity_required');
  if (!/^sha256:[0-9a-f]{64}$/.test(String(record.contract_hash || ''))) throw new TypeError('contract_hash_invalid');
  if (!/^sha256:[0-9a-f]{64}$/.test(String(record.result_digest || ''))) throw new TypeError('result_digest_invalid');
  if (!['pending','sending','retry','acknowledged'].includes(record.callback_state)) throw new TypeError('callback_not_ready');
  const failed = nonEmpty(record.error_code);
  const costUnits = Number(record.cost_units || 0);
  if (!Number.isFinite(costUnits) || costUnits < 0 || costUnits > 1) throw new TypeError('cost_units_invalid');
  return Object.freeze({
    version: CALLBACK_VERSION,
    provider: CALLBACK_PROVIDER,
    environment: 'staging',
    production_effect: 'ZERO',
    simulated: false,
    mission_id: record.mission_id,
    mission_run_id: record.mission_run_id,
    contract_hash: record.contract_hash,
    inbox_id: record.inbox_id,
    execution_id: record.execution_id,
    request_id: record.request_id,
    status: failed ? 'falhou' : 'concluida',
    result_summary: typeof record.result_summary === 'string' ? record.result_summary : '',
    error_code: failed ? record.error_code : null,
    cost_units: costUnits,
    occurred_at: new Date(Date.parse(record.completed_at)).toISOString()
  });
}

module.exports = {
  VERSION,
  CALLBACK_VERSION,
  CALLBACK_PROVIDER,
  hasCompleteRealEvidence,
  classifyOperationalMissionExecution,
  buildOperationalMissionCallbackEnvelope
};

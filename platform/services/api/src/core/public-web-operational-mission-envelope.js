'use strict';

const {
  computeCanonicalContentDigest,
  isCanonicalContentDigest
} = require('./canonical-content-digest');
const {
  normalizeCanaryTargetPath,
  validateOrigin
} = require('./public-web-canary-target-allowlist');
const {
  ALLOWED_CONTENT_TYPES,
  ALLOWED_OPERATIONS,
  ALLOWED_SOURCE_TYPES,
  REQUEST_LIMITS
} = require('./public-web-transport-contract');

const VERSION = 'public_web_operational_mission_envelope_v1';
const MAESTRO_CONTRACT_VERSION = '1.0';
const PROVIDER = 'hermes_public_web_staging';
const REQUIRED_TOOL = 'public_web_read';
const REQUIRED_DENIED_ACTIONS = Object.freeze([
  'authenticate',
  'book',
  'checkout',
  'delete',
  'login',
  'pay',
  'publish',
  'purchase',
  'send',
  'submit_form',
  'update',
  'write'
]);
const ENVELOPE_FIELDS = Object.freeze([
  'version', 'provider', 'environment', 'production_allowed', 'dispatch_simulated',
  'mission_run_id', 'dispatch_token', 'idempotency_key', 'correlation_id',
  'contract_hash', 'contract'
]);
const CONTRACT_FIELDS = Object.freeze([
  'contract_version', 'mission_id', 'run_id', 'workspace_id', 'project_id',
  'objective', 'context', 'expected_outputs', 'acceptance_criteria', 'priority',
  'approval_policy', 'allowed_tools', 'denied_actions', 'budget', 'deadline',
  'requested_by', 'correlation_id', 'idempotency_key', 'callback', 'metadata'
]);
const PUBLIC_WEB_FIELDS = Object.freeze([
  'target_url', 'operation', 'source_type', 'requested_content_types',
  'maximum_requests', 'redirects_allowed', 'timeout_ms', 'maximum_response_bytes'
]);

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(value, fields) {
  if (!plainObject(value)) return false;
  const expected = [...fields].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function parseOperationalContext(value) {
  if (!nonEmpty(value)) return { ok: false, reason: 'mission_context_json_required' };
  let parsed;
  try { parsed = JSON.parse(value); } catch { return { ok: false, reason: 'mission_context_json_invalid' }; }
  if (!exactFields(parsed, ['public_web'])) return { ok: false, reason: 'mission_context_shape_invalid' };
  if (!exactFields(parsed.public_web, PUBLIC_WEB_FIELDS)) return { ok: false, reason: 'public_web_context_shape_invalid' };
  return { ok: true, public_web: parsed.public_web };
}

function validatePublicWebInput(input, errors) {
  if (!plainObject(input)) { errors.push('public_web_input_required'); return null; }
  if (!nonEmpty(input.target_url)) errors.push('target_url_required');
  let url = null;
  try { url = new URL(input.target_url); } catch { errors.push('target_url_invalid'); }
  if (url) {
    const origin = validateOrigin(url.origin);
    const path = normalizeCanaryTargetPath(url.pathname || '/');
    if (!origin.valid) errors.push(origin.reason);
    if (!path.valid) errors.push(path.reason);
    if (url.search || url.hash) errors.push('target_query_or_fragment_forbidden');
  }
  if (!ALLOWED_OPERATIONS.includes(input.operation)) errors.push('operation_not_allowed');
  if (!ALLOWED_SOURCE_TYPES.includes(input.source_type)) errors.push('source_type_not_allowed');
  if (!Array.isArray(input.requested_content_types) || input.requested_content_types.length === 0
    || input.requested_content_types.some((type) => !ALLOWED_CONTENT_TYPES.includes(type))) {
    errors.push('requested_content_types_invalid');
  }
  if (input.maximum_requests !== 1) errors.push('maximum_requests_must_equal_one');
  if (input.redirects_allowed !== false) errors.push('redirects_must_be_disabled');
  if (!Number.isInteger(input.timeout_ms) || input.timeout_ms < 1 || input.timeout_ms > 5000) errors.push('timeout_out_of_bounds');
  if (!Number.isInteger(input.maximum_response_bytes) || input.maximum_response_bytes < 1
    || input.maximum_response_bytes > 100000 || input.maximum_response_bytes > REQUEST_LIMITS.maximum_response_bytes) {
    errors.push('response_limit_out_of_bounds');
  }
  return url;
}

function validateOperationalMissionEnvelope(envelope = {}) {
  const errors = [];
  if (!exactFields(envelope, ENVELOPE_FIELDS)) return { valid: false, errors: ['mission_envelope_shape_invalid'] };
  if (envelope.version !== VERSION) errors.push('mission_envelope_version_invalid');
  if (envelope.provider !== PROVIDER) errors.push('mission_provider_invalid');
  if (envelope.environment !== 'staging') errors.push('mission_environment_must_be_staging');
  if (envelope.production_allowed !== false) errors.push('mission_production_must_be_blocked');
  if (envelope.dispatch_simulated !== false) errors.push('mission_dispatch_must_be_real');
  for (const field of ['mission_run_id', 'dispatch_token', 'idempotency_key', 'correlation_id']) {
    if (!nonEmpty(envelope[field])) errors.push(`${field}_required`);
  }
  if (!isCanonicalContentDigest(envelope.contract_hash)) errors.push('contract_hash_invalid');

  const contract = envelope.contract;
  if (!exactFields(contract, CONTRACT_FIELDS)) {
    errors.push('mission_contract_shape_invalid');
    return { valid: false, errors: [...new Set(errors)].sort() };
  }
  if (contract.contract_version !== MAESTRO_CONTRACT_VERSION) errors.push('mission_contract_version_invalid');
  for (const field of ['mission_id', 'workspace_id', 'objective', 'correlation_id', 'idempotency_key']) {
    if (!nonEmpty(contract[field])) errors.push(`contract_${field}_required`);
  }
  if (contract.run_id !== null && contract.run_id !== envelope.mission_run_id) errors.push('mission_run_binding_mismatch');
  if (contract.idempotency_key !== envelope.idempotency_key) errors.push('mission_idempotency_binding_mismatch');
  if (contract.correlation_id !== envelope.correlation_id) errors.push('mission_correlation_binding_mismatch');
  if (contract.callback !== null) errors.push('mission_callback_must_be_null');
  if (!Array.isArray(contract.expected_outputs) || !Array.isArray(contract.acceptance_criteria)) errors.push('mission_outputs_or_criteria_invalid');
  if (!Array.isArray(contract.allowed_tools) || contract.allowed_tools.length !== 1 || contract.allowed_tools[0] !== REQUIRED_TOOL) {
    errors.push('mission_allowed_tools_must_be_public_web_read_only');
  }
  if (!Array.isArray(contract.denied_actions)) {
    errors.push('mission_denied_actions_invalid');
  } else {
    for (const action of REQUIRED_DENIED_ACTIONS) if (!contract.denied_actions.includes(action)) errors.push(`mission_denied_action_missing::${action}`);
  }
  if (contract.approval_policy !== 'requer_aprovacao') errors.push('mission_explicit_approval_policy_required');
  if (typeof contract.budget !== 'number' || contract.budget < 0 || contract.budget > 1) errors.push('mission_budget_out_of_bounds');
  if (!plainObject(contract.requested_by) || !nonEmpty(contract.requested_by.id) || contract.requested_by.tipo !== 'usuario') {
    errors.push('mission_requested_by_invalid');
  }
  if (!plainObject(contract.metadata) || contract.metadata.tipo !== 'pesquisar'
    || !nonEmpty(contract.metadata.issued_at) || Number.isNaN(Date.parse(contract.metadata.issued_at))
    || contract.metadata.emitted_by !== contract.requested_by?.id) {
    errors.push('mission_metadata_invalid');
  }

  const expectedHash = computeCanonicalContentDigest(contract);
  if (envelope.contract_hash !== expectedHash) errors.push('mission_contract_hash_mismatch');

  const parsed = parseOperationalContext(contract.context);
  let targetUrl = null;
  if (!parsed.ok) errors.push(parsed.reason);
  else targetUrl = validatePublicWebInput(parsed.public_web, errors);

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)].sort(),
    contract_hash: expectedHash,
    mission_id: contract.mission_id,
    mission_run_id: envelope.mission_run_id,
    workspace_id: contract.workspace_id,
    public_web: parsed.ok ? parsed.public_web : null,
    target_origin: targetUrl ? targetUrl.origin : null,
    target_path: targetUrl ? targetUrl.pathname : null
  };
}

function buildOperationalMissionTrialConfig(envelope, trustedBinding = {}) {
  const validation = validateOperationalMissionEnvelope(envelope);
  if (!validation.valid) {
    return Object.freeze({
      ok: false,
      status: 'PUBLIC_WEB_OPERATIONAL_MISSION_BINDING_BLOCKED',
      errors: validation.errors,
      execution_authorized: false,
      external_network_called: false,
      production_allowed: false
    });
  }
  for (const field of ['tenant_id', 'workspace_type', 'workspace_id', 'user_id', 'operator_id', 'approver_id']) {
    if (!nonEmpty(trustedBinding[field])) {
      return Object.freeze({ ok:false, status:'PUBLIC_WEB_OPERATIONAL_MISSION_BINDING_BLOCKED', errors:[`trusted_${field}_required`], execution_authorized:false, external_network_called:false, production_allowed:false });
    }
  }
  if (trustedBinding.workspace_id !== validation.workspace_id || trustedBinding.production_allowed === true) {
    return Object.freeze({ ok:false, status:'PUBLIC_WEB_OPERATIONAL_MISSION_BINDING_BLOCKED', errors:['trusted_workspace_or_environment_binding_invalid'], execution_authorized:false, external_network_called:false, production_allowed:false });
  }
  const web = validation.public_web;
  const missionDigest = computeCanonicalContentDigest([
    VERSION,
    validation.mission_id,
    validation.mission_run_id,
    envelope.contract_hash,
    validation.target_origin,
    validation.target_path
  ]);
  const config = Object.freeze({
    trial_id: `public_web_operational_mission_trial:${missionDigest}`,
    environment: 'staging',
    target_policy_id: `public_web_operational_mission_target:${missionDigest}`,
    target_origin: validation.target_origin,
    target_path: validation.target_path,
    source_type: web.source_type,
    operation: web.operation,
    requested_content_types: Object.freeze([...web.requested_content_types]),
    maximum_requests: 1,
    rollout_percentage: 1,
    timeout_ms: web.timeout_ms,
    maximum_response_bytes: web.maximum_response_bytes,
    workspace_type: trustedBinding.workspace_type,
    tenant_id: trustedBinding.tenant_id,
    user_id: trustedBinding.user_id,
    operator_id: trustedBinding.operator_id,
    operator_role: 'integration_operator',
    approver_id: trustedBinding.approver_id,
    approver_role: 'integration_operator',
    reason: `mission:${validation.mission_id}:run:${validation.mission_run_id}`
  });
  return Object.freeze({
    ok: true,
    status: 'PUBLIC_WEB_OPERATIONAL_MISSION_BOUND_NOT_EXECUTED',
    version: VERSION,
    mission_id: validation.mission_id,
    mission_run_id: validation.mission_run_id,
    contract_hash: envelope.contract_hash,
    config,
    execution_authorized: false,
    execution_started: false,
    external_network_called: false,
    production_allowed: false
  });
}

module.exports = {
  VERSION,
  MAESTRO_CONTRACT_VERSION,
  PROVIDER,
  REQUIRED_TOOL,
  REQUIRED_DENIED_ACTIONS,
  validateOperationalMissionEnvelope,
  buildOperationalMissionTrialConfig
};

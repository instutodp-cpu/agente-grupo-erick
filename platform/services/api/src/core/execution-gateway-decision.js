'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const EXECUTION_GATEWAY_DECISION_VALIDATOR_VERSION = 'execution_gateway_decision_validator_v1';

const GATEWAY_STATUSES = Object.freeze([
  'GATEWAY_ACCEPTED_SIMULATION', 'VALIDATION_FAILED', 'POLICY_BLOCKED', 'EXECUTION_PLAN_BLOCKED',
  'EXECUTION_PLAN_RESULT_BLOCKED', 'PACKAGE_REFERENCE_BLOCKED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED',
  'PROJECT_BLOCKED', 'SESSION_BLOCKED', 'AGENT_BLOCKED', 'ACTOR_BLOCKED', 'AUTHORIZATION_BLOCKED',
  'AUTHORIZATION_PROVENANCE_BLOCKED', 'AUTHORIZATION_SCOPE_BLOCKED', 'REGISTRY_SNAPSHOT_BLOCKED',
  'STAGE_MANIFEST_BLOCKED', 'DEPENDENCY_BLOCKED', 'REFERENCE_BINDING_BLOCKED', 'VALIDATION_LEDGER_BLOCKED',
  'ARCHITECTURE_GATE_EVIDENCE_BLOCKED', 'PACKAGE_FINGERPRINT_BLOCKED', 'PACKAGE_DIGEST_BLOCKED', 'FRESHNESS_BLOCKED',
  'REPLAY_BLOCKED', 'VERSION_BLOCKED', 'FINGERPRINT_BLOCKED', 'CONFLICT_BLOCKED', 'UNKNOWN_STATUS_BLOCKED'
]);

// The real order execution-gateway-boundary.js evaluates gates in -- "Nenhum score pode alterar a
// precedência." Mirrors validation-taxonomy.js's own PRECEDENCE_ORDER/declaration-order split.
const GATEWAY_PRECEDENCE_ORDER = Object.freeze([
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED',
  'AGENT_BLOCKED', 'ACTOR_BLOCKED', 'POLICY_BLOCKED', 'EXECUTION_PLAN_BLOCKED', 'EXECUTION_PLAN_RESULT_BLOCKED',
  'PACKAGE_REFERENCE_BLOCKED', 'AUTHORIZATION_BLOCKED', 'AUTHORIZATION_PROVENANCE_BLOCKED',
  'AUTHORIZATION_SCOPE_BLOCKED', 'REGISTRY_SNAPSHOT_BLOCKED', 'STAGE_MANIFEST_BLOCKED', 'DEPENDENCY_BLOCKED',
  'REFERENCE_BINDING_BLOCKED', 'VALIDATION_LEDGER_BLOCKED', 'ARCHITECTURE_GATE_EVIDENCE_BLOCKED',
  'PACKAGE_FINGERPRINT_BLOCKED', 'PACKAGE_DIGEST_BLOCKED', 'FRESHNESS_BLOCKED', 'REPLAY_BLOCKED', 'VERSION_BLOCKED',
  'FINGERPRINT_BLOCKED', 'CONFLICT_BLOCKED', 'UNKNOWN_STATUS_BLOCKED', 'GATEWAY_ACCEPTED_SIMULATION'
]);

const GATEWAY_DECISIONS = Object.freeze([
  'ACCEPT_PACKAGE_REFERENCE_SIMULATION', 'REQUEST_PLAN_REBUILD', 'REQUEST_AUTHORIZATION_REFRESH',
  'REQUEST_SCOPE_REVIEW', 'REQUEST_REGISTRY_REFRESH', 'REQUEST_VALIDATION_REBUILD',
  'REQUEST_ARCHITECTURE_GATE_EVIDENCE', 'REQUEST_FRESHNESS_REFRESH', 'REQUEST_REPLAY_REVIEW', 'BLOCKED'
]);

const GATEWAY_NEXT_STATES = Object.freeze([
  'GATEWAY_PACKAGE_ACCEPTED_REFERENCE_SIMULATION', 'WAITING_PLAN_REBUILD_REFERENCE',
  'WAITING_AUTHORIZATION_REFRESH_REFERENCE', 'WAITING_SCOPE_REVIEW_REFERENCE', 'WAITING_REGISTRY_REFRESH_REFERENCE',
  'WAITING_VALIDATION_REBUILD_REFERENCE', 'WAITING_ARCHITECTURE_GATE_EVIDENCE_REFERENCE',
  'WAITING_FRESHNESS_REFRESH_REFERENCE', 'WAITING_REPLAY_REVIEW_REFERENCE', 'BLOCKED_REFERENCE'
]);

const DEFAULT_OUTCOME = Object.freeze({ decision: 'BLOCKED', next_state: 'BLOCKED_REFERENCE' });

const STATUS_OUTCOME_MAP = Object.freeze({
  GATEWAY_ACCEPTED_SIMULATION: { decision: 'ACCEPT_PACKAGE_REFERENCE_SIMULATION', next_state: 'GATEWAY_PACKAGE_ACCEPTED_REFERENCE_SIMULATION' },
  EXECUTION_PLAN_BLOCKED: { decision: 'REQUEST_PLAN_REBUILD', next_state: 'WAITING_PLAN_REBUILD_REFERENCE' },
  EXECUTION_PLAN_RESULT_BLOCKED: { decision: 'REQUEST_PLAN_REBUILD', next_state: 'WAITING_PLAN_REBUILD_REFERENCE' },
  STAGE_MANIFEST_BLOCKED: { decision: 'REQUEST_PLAN_REBUILD', next_state: 'WAITING_PLAN_REBUILD_REFERENCE' },
  DEPENDENCY_BLOCKED: { decision: 'REQUEST_PLAN_REBUILD', next_state: 'WAITING_PLAN_REBUILD_REFERENCE' },
  REFERENCE_BINDING_BLOCKED: { decision: 'REQUEST_PLAN_REBUILD', next_state: 'WAITING_PLAN_REBUILD_REFERENCE' },
  AUTHORIZATION_BLOCKED: { decision: 'REQUEST_AUTHORIZATION_REFRESH', next_state: 'WAITING_AUTHORIZATION_REFRESH_REFERENCE' },
  AUTHORIZATION_PROVENANCE_BLOCKED: { decision: 'REQUEST_AUTHORIZATION_REFRESH', next_state: 'WAITING_AUTHORIZATION_REFRESH_REFERENCE' },
  AUTHORIZATION_SCOPE_BLOCKED: { decision: 'REQUEST_SCOPE_REVIEW', next_state: 'WAITING_SCOPE_REVIEW_REFERENCE' },
  REGISTRY_SNAPSHOT_BLOCKED: { decision: 'REQUEST_REGISTRY_REFRESH', next_state: 'WAITING_REGISTRY_REFRESH_REFERENCE' },
  VALIDATION_LEDGER_BLOCKED: { decision: 'REQUEST_VALIDATION_REBUILD', next_state: 'WAITING_VALIDATION_REBUILD_REFERENCE' },
  ARCHITECTURE_GATE_EVIDENCE_BLOCKED: { decision: 'REQUEST_ARCHITECTURE_GATE_EVIDENCE', next_state: 'WAITING_ARCHITECTURE_GATE_EVIDENCE_REFERENCE' },
  FRESHNESS_BLOCKED: { decision: 'REQUEST_FRESHNESS_REFRESH', next_state: 'WAITING_FRESHNESS_REFRESH_REFERENCE' },
  REPLAY_BLOCKED: { decision: 'REQUEST_REPLAY_REVIEW', next_state: 'WAITING_REPLAY_REVIEW_REFERENCE' }
});

const EXECUTION_GATEWAY_DECISION_FIELDS = Object.freeze([
  'gateway_decision_id', 'gateway_request_id', 'gateway_package_reference_id', 'execution_plan_id',
  'execution_plan_result_id', 'authorization_decision_id', 'authorization_provenance_reference_id',
  'authorization_scope_reference_id', 'registry_snapshot_reference_id', 'stage_manifest_reference_id',
  'dependency_graph_reference_id', 'binding_ledger_id', 'validation_ledger_id',
  'architecture_gate_evidence_reference_id', 'freshness_reference_id', 'replay_reference_id', 'tenant_id',
  'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id', 'status', 'decision',
  'next_state', 'gateway_request_fingerprint', 'gateway_package_fingerprint', 'execution_plan_fingerprint',
  'execution_plan_result_fingerprint', 'authorization_fingerprint', 'authorization_provenance_fingerprint',
  'authorization_scope_fingerprint', 'registry_snapshot_fingerprint', 'stage_manifest_fingerprint',
  'dependency_graph_fingerprint', 'binding_ledger_fingerprint', 'validation_ledger_fingerprint',
  'architecture_gate_evidence_fingerprint', 'freshness_fingerprint', 'replay_fingerprint', 'package_digest',
  'gateway_registry_version', 'blockers', 'reason_codes', 'request_validated', 'policy_validated',
  'execution_plan_validated', 'execution_plan_result_validated', 'package_reference_validated',
  'identity_validated', 'authorization_validated', 'authorization_provenance_validated',
  'authorization_scope_validated', 'registry_snapshot_validated', 'stage_manifest_validated',
  'dependency_graph_validated', 'binding_ledger_validated', 'validation_ledger_validated',
  'architecture_gate_evidence_validated', 'package_fingerprint_validated', 'package_digest_validated',
  'freshness_validated', 'replay_validated', 'non_execution_invariants_validated', 'gateway_evaluated',
  'gateway_accepted_in_simulation', 'runtime_enabled', 'execution_authorized', 'execution_started',
  'stage_started', 'stage_completed', 'agent_executed', 'tool_called', 'workflow_executed', 'provider_called',
  'model_called', 'network_used', 'memory_read', 'memory_written', 'tokens_consumed', 'cost_consumed',
  'job_created', 'queue_used', 'worker_started', 'executed', 'simulation', 'production_blocked',
  'rollout_percentage', 'validator_version'
]);

const VALIDATION_FLAG_FIELDS = Object.freeze([
  'request_validated', 'policy_validated', 'execution_plan_validated', 'execution_plan_result_validated',
  'package_reference_validated', 'identity_validated', 'authorization_validated',
  'authorization_provenance_validated', 'authorization_scope_validated', 'registry_snapshot_validated',
  'stage_manifest_validated', 'dependency_graph_validated', 'binding_ledger_validated', 'validation_ledger_validated',
  'architecture_gate_evidence_validated', 'package_fingerprint_validated', 'package_digest_validated',
  'freshness_validated', 'replay_validated', 'non_execution_invariants_validated'
]);

// "Somente para GATEWAY_ACCEPTED_SIMULATION: gateway_accepted_in_simulation=true. Para todos os
// demais: gateway_accepted_in_simulation=false." -- every one of these 20 operational flags is
// forced false for every status this contract can ever represent, acceptance included.
const OPERATIONAL_SAFE_FLAGS = Object.freeze({
  runtime_enabled: false,
  execution_authorized: false,
  execution_started: false,
  stage_started: false,
  stage_completed: false,
  agent_executed: false,
  tool_called: false,
  workflow_executed: false,
  provider_called: false,
  model_called: false,
  network_used: false,
  memory_read: false,
  memory_written: false,
  tokens_consumed: false,
  cost_consumed: false,
  job_created: false,
  queue_used: false,
  worker_started: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

const MAX_BLOCKERS = 50;
const MAX_REASON_CODES = 50;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateExecutionGatewayDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['execution_gateway_decision_must_be_object'] };
  exactFields(decision, EXECUTION_GATEWAY_DECISION_FIELDS, 'execution_gateway_decision', errors);
  for (const field of [
    'gateway_decision_id', 'gateway_request_id', 'gateway_package_reference_id', 'execution_plan_id',
    'execution_plan_result_id', 'authorization_decision_id', 'authorization_provenance_reference_id',
    'authorization_scope_reference_id', 'registry_snapshot_reference_id', 'stage_manifest_reference_id',
    'dependency_graph_reference_id', 'binding_ledger_id', 'validation_ledger_id',
    'architecture_gate_evidence_reference_id', 'freshness_reference_id', 'replay_reference_id', 'tenant_id',
    'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id', 'gateway_request_fingerprint',
    'gateway_package_fingerprint', 'execution_plan_fingerprint', 'execution_plan_result_fingerprint',
    'authorization_fingerprint', 'authorization_provenance_fingerprint', 'authorization_scope_fingerprint',
    'registry_snapshot_fingerprint', 'stage_manifest_fingerprint', 'dependency_graph_fingerprint',
    'binding_ledger_fingerprint', 'validation_ledger_fingerprint', 'architecture_gate_evidence_fingerprint',
    'freshness_fingerprint', 'replay_fingerprint', 'package_digest', 'gateway_registry_version', 'validator_version'
  ]) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!GATEWAY_STATUSES.includes(decision.status)) errors.push('status_invalid');
  if (!GATEWAY_DECISIONS.includes(decision.decision)) errors.push('decision_invalid');
  if (!GATEWAY_NEXT_STATES.includes(decision.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = STATUS_OUTCOME_MAP[decision.status] || DEFAULT_OUTCOME;
  if (decision.decision !== expectedOutcome.decision) errors.push('decision_does_not_match_status');
  if (decision.next_state !== expectedOutcome.next_state) errors.push('next_state_does_not_match_status');

  if (!isSanitizedList(decision.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isSanitizedList(decision.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');

  for (const field of VALIDATION_FLAG_FIELDS) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof decision.gateway_evaluated !== 'boolean') errors.push('gateway_evaluated_must_be_boolean');
  if (decision.gateway_evaluated !== true) errors.push('gateway_evaluated_must_be_true');
  if (typeof decision.gateway_accepted_in_simulation !== 'boolean') errors.push('gateway_accepted_in_simulation_must_be_boolean');
  const expectedAccepted = decision.status === 'GATEWAY_ACCEPTED_SIMULATION';
  if (decision.gateway_accepted_in_simulation !== expectedAccepted) errors.push('gateway_accepted_in_simulation_does_not_match_status');

  for (const [field, expected] of Object.entries(OPERATIONAL_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (decision.validator_version !== EXECUTION_GATEWAY_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(decision));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildExecutionGatewayDecision(input = {}) {
  const status = GATEWAY_STATUSES.includes(input.status) ? input.status : 'UNKNOWN_STATUS_BLOCKED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;

  const decision = {
    gateway_decision_id: input.gateway_decision_id,
    gateway_request_id: input.gateway_request_id,
    gateway_package_reference_id: input.gateway_package_reference_id,
    execution_plan_id: input.execution_plan_id,
    execution_plan_result_id: input.execution_plan_result_id,
    authorization_decision_id: input.authorization_decision_id,
    authorization_provenance_reference_id: input.authorization_provenance_reference_id,
    authorization_scope_reference_id: input.authorization_scope_reference_id,
    registry_snapshot_reference_id: input.registry_snapshot_reference_id,
    stage_manifest_reference_id: input.stage_manifest_reference_id,
    dependency_graph_reference_id: input.dependency_graph_reference_id,
    binding_ledger_id: input.binding_ledger_id,
    validation_ledger_id: input.validation_ledger_id,
    architecture_gate_evidence_reference_id: input.architecture_gate_evidence_reference_id,
    freshness_reference_id: input.freshness_reference_id,
    replay_reference_id: input.replay_reference_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    actor_id: input.actor_id,
    status,
    decision: outcome.decision,
    next_state: outcome.next_state,
    gateway_request_fingerprint: input.gateway_request_fingerprint || 'fingerprint_not_available',
    gateway_package_fingerprint: input.gateway_package_fingerprint || 'fingerprint_not_available',
    execution_plan_fingerprint: input.execution_plan_fingerprint || 'fingerprint_not_available',
    execution_plan_result_fingerprint: input.execution_plan_result_fingerprint || 'fingerprint_not_available',
    authorization_fingerprint: input.authorization_fingerprint || 'fingerprint_not_available',
    authorization_provenance_fingerprint: input.authorization_provenance_fingerprint || 'fingerprint_not_available',
    authorization_scope_fingerprint: input.authorization_scope_fingerprint || 'fingerprint_not_available',
    registry_snapshot_fingerprint: input.registry_snapshot_fingerprint || 'fingerprint_not_available',
    stage_manifest_fingerprint: input.stage_manifest_fingerprint || 'fingerprint_not_available',
    dependency_graph_fingerprint: input.dependency_graph_fingerprint || 'fingerprint_not_available',
    binding_ledger_fingerprint: input.binding_ledger_fingerprint || 'fingerprint_not_available',
    validation_ledger_fingerprint: input.validation_ledger_fingerprint || 'fingerprint_not_available',
    architecture_gate_evidence_fingerprint: input.architecture_gate_evidence_fingerprint || 'fingerprint_not_available',
    freshness_fingerprint: input.freshness_fingerprint || 'fingerprint_not_available',
    replay_fingerprint: input.replay_fingerprint || 'fingerprint_not_available',
    package_digest: input.package_digest || 'digest_not_available',
    gateway_registry_version: input.gateway_registry_version || 'registry_version_not_available',
    blockers: Array.isArray(input.blockers) ? uniqueSorted(input.blockers) : [],
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    gateway_evaluated: true,
    gateway_accepted_in_simulation: status === 'GATEWAY_ACCEPTED_SIMULATION',
    rollout_percentage: 0,
    ...OPERATIONAL_SAFE_FLAGS,
    validator_version: EXECUTION_GATEWAY_DECISION_VALIDATOR_VERSION
  };
  for (const field of VALIDATION_FLAG_FIELDS) {
    decision[field] = input[field] === true;
  }

  const validation = validateExecutionGatewayDecision(decision);
  if (!validation.valid) {
    throw new Error(`execution_gateway_decision_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(decision);
}

module.exports = {
  DEFAULT_OUTCOME,
  EXECUTION_GATEWAY_DECISION_FIELDS,
  EXECUTION_GATEWAY_DECISION_VALIDATOR_VERSION,
  GATEWAY_DECISIONS,
  GATEWAY_NEXT_STATES,
  GATEWAY_PRECEDENCE_ORDER,
  GATEWAY_STATUSES,
  MAX_BLOCKERS,
  MAX_REASON_CODES,
  OPERATIONAL_SAFE_FLAGS,
  STATUS_OUTCOME_MAP,
  VALIDATION_FLAG_FIELDS,
  buildExecutionGatewayDecision,
  validateExecutionGatewayDecision
};

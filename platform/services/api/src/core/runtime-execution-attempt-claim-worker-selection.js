'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  validatePersistedClaimIdentity
} = require('./runtime-execution-attempt-durable-claim-contract');
const { ELIGIBLE_STATUS } = require('./runtime-execution-attempt-claim-eligibility-decision-simulation');
const {
  RUNTIME_STAGE_SIMULATION_REFERENCE_FIELDS,
  validateRuntimeStageSimulationReference
} = require('./runtime-stage-simulation-reference');
const {
  FIELDS: WORKER_FIELDS,
  validateWorkerRegistration
} = require('./runtime-worker-registry-contract');

const CONTRACT_NAME = 'RUNTIME_EXECUTION_ATTEMPT_CLAIM_WORKER_SELECTION_AUTHORITY';
const CONTRACT_VERSION = 'runtime_execution_attempt_claim_worker_selection_authority_contract_v1';
const SELECTION_POLICY = 'STATIC_CANONICAL_WORKER_ID_LEXICAL';
const SELECTION_POLICY_VERSION = 1;
const SELECTION_ORDINAL = 1;
const SELECTION_ID_PREFIX = 'runtime-execution-attempt-claim-worker-selection-';
const SELECTION_FIELDS = Object.freeze([
  'selection_id', 'claim_id', 'attempt_durable_record_id', 'claim_digest',
  'runtime_stage_reference_id', 'runtime_stage_reference_version', 'stage_fingerprint', 'stage_digest', 'attempt_ordinal',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
  'selection_ordinal', 'selected_worker_id', 'selected_worker_digest', 'candidate_worker_ids',
  'candidate_set', 'candidate_set_digest', 'selection_policy', 'selection_policy_version',
  'selection_fingerprint', 'selection_digest', 'stage_reference', 'selection_artifact', 'created_at'
]);
const IDENTITY_FIELDS = Object.freeze([
  'contract_name', 'contract_version', 'claim_id', 'attempt_durable_record_id', 'claim_digest',
  'runtime_stage_reference_id', 'runtime_stage_reference_version', 'stage_fingerprint', 'stage_digest', 'attempt_ordinal',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
  'selection_ordinal', 'selected_worker_id', 'selected_worker_digest', 'candidate_set',
  'candidate_set_digest', 'selection_policy', 'selection_policy_version'
]);
const STAGE_REQUIREMENT_FIELDS = Object.freeze([
  'stage_type', 'required_capabilities', 'required_modalities'
]);
const SELECTION_SAFE_FLAGS = Object.freeze({
  selection_creates_binding: false,
  selection_grants_ownership: false,
  selection_reserves_capacity: false,
  selection_creates_lease: false,
  selection_creates_fencing: false,
  selection_authorizes_execution: false,
  execution_started: false,
  execution_performed: false,
  simulation: false,
  production_blocked: true
});

function requireString(value, name) {
  if (!isNonEmptyString(value)) throw new TypeError(`${name}_invalid`);
}

function validateClaimAuthority(claim) {
  const errors = [];
  if (!isPlainObject(claim)) return { valid: false, errors: ['claim_must_be_object'] };
  const identity = validatePersistedClaimIdentity(claim);
  if (!identity.valid) errors.push(...identity.errors.map((error) => `claim_${error}`));
  if (claim.claim_state !== 'ACTIVE') errors.push('claim_not_active');
  if (claim.claim_eligibility_decision_status !== ELIGIBLE_STATUS) errors.push('claim_not_eligible');
  if (claim.attempt_state !== 'ADMITTED' || Number(claim.attempt_revision) !== 2) errors.push('claim_attempt_lifecycle_invalid');
  if (!isPlainObject(claim.claim_artifact) || !isPlainObject(claim.claim_receipt)) errors.push('claim_artifact_invalid');
  return { valid: errors.length === 0, errors: uniqueSorted(errors), identity: identity.identity };
}

function validateStageReference(stage) {
  if (!isPlainObject(stage)) return { valid: false, errors: ['stage_reference_must_be_object'] };
  const validation = validateRuntimeStageSimulationReference(stage);
  const errors = validation.errors.map((error) => `stage_${error}`);
  if (!stage.runtime_stage_reference_id) errors.push('stage_reference_id_invalid');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateWorkerSet(workers) {
  const errors = [];
  if (!Array.isArray(workers)) return { valid: false, errors: ['workers_must_be_array'] };
  const ids = new Set();
  workers.forEach((worker, index) => {
    const validation = validateWorkerRegistration(worker);
    if (!validation.valid) errors.push(...validation.errors.map((error) => `workers[${index}]_${error}`));
    if (worker?.worker_id && ids.has(worker.worker_id)) errors.push(`workers[${index}]_duplicate_worker_id`);
    if (worker?.worker_id) ids.add(worker.worker_id);
  });
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function scopeFromClaim(claim) {
  return {
    tenant_id: claim.tenant_id,
    organization_id: claim.organization_id,
    project_id: claim.project_id,
    session_reference_id: claim.session_reference_id,
    agent_id: claim.agent_id,
    actor_id: claim.actor_id
  };
}

function staticWorkerMatches(worker, stage, scope) {
  return worker.lifecycle_state === 'ACTIVE'
    && worker.tenant_id === scope.tenant_id
    && worker.organization_id === scope.organization_id
    && worker.project_id === scope.project_id
    && worker.supported_stage_types.includes(stage.stage_type)
    && stage.required_modalities.every((modality) => worker.supported_modalities.includes(modality));
}

function candidateSetFor(workers, stage, scope) {
  return workers
    .filter((worker) => staticWorkerMatches(worker, stage, scope))
    .sort((left, right) => left.worker_id.localeCompare(right.worker_id))
    .map((worker) => Object.freeze({ worker_id: worker.worker_id, canonical_digest: worker.canonical_digest }));
}

function stageRequirementMaterial(stage) {
  return Object.freeze(Object.fromEntries(STAGE_REQUIREMENT_FIELDS.map((field) => [field, stage[field]])));
}

function canonicalStageFingerprint(stage) {
  return isNonEmptyString(stage.stage_fingerprint) ? stage.stage_fingerprint : stablePayload(stage);
}

function buildIdentity({ claim, stage, scope, candidates, selectedWorker }) {
  const stageDigest = computeCanonicalContentDigest(stage);
  const candidateSetDigest = computeCanonicalContentDigest(candidates);
  return Object.freeze({
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    claim_id: claim.claim_id,
    attempt_durable_record_id: claim.attempt_durable_record_id,
    claim_digest: claim.claim_digest,
    runtime_stage_reference_id: stage.runtime_stage_reference_id,
    runtime_stage_reference_version: stage.runtime_stage_reference_version,
    stage_fingerprint: canonicalStageFingerprint(stage),
    stage_digest: stageDigest,
    attempt_ordinal: claim.attempt_ordinal,
    ...scope,
    selection_ordinal: SELECTION_ORDINAL,
    selected_worker_id: selectedWorker.worker_id,
    selected_worker_digest: selectedWorker.canonical_digest,
    candidate_set: candidates,
    candidate_set_digest: candidateSetDigest,
    selection_policy: SELECTION_POLICY,
    selection_policy_version: SELECTION_POLICY_VERSION
  });
}

function buildSelectionPlan({ claim, stage_reference: stage, workers } = {}) {
  const claimValidation = validateClaimAuthority(claim);
  const stageValidation = validateStageReference(stage);
  const workersValidation = validateWorkerSet(workers);
  const errors = uniqueSorted([...claimValidation.errors, ...stageValidation.errors, ...workersValidation.errors]);
  if (errors.length > 0) return Object.freeze({ outcome: 'INVALID', reason_code: 'invalid_selection_predecessor', errors });

  const scope = scopeFromClaim(claim);
  const candidates = candidateSetFor(workers, stage, scope);
  if (candidates.length === 0) {
    return Object.freeze({
      outcome: 'NO_ELIGIBLE_WORKER',
      reason_code: 'no_static_eligible_worker',
      claim_id: claim.claim_id,
      attempt_durable_record_id: claim.attempt_durable_record_id,
      runtime_stage_reference_id: stage.runtime_stage_reference_id,
      candidate_set: Object.freeze([]),
      selection_creates_binding: false,
      selection_grants_ownership: false,
      selection_reserves_capacity: false,
      selection_creates_lease: false,
      selection_creates_fencing: false,
      selection_authorizes_execution: false
    });
  }

  const selectedWorker = candidates[0];
  const identity = buildIdentity({ claim, stage, scope, candidates, selectedWorker });
  const selectionFingerprint = stablePayload(identity);
  const selectionDigest = computeCanonicalContentDigest(identity);
  const selectionId = `${SELECTION_ID_PREFIX}${selectionDigest.slice('sha256:'.length)}`;
  const artifact = {
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    selection_id: selectionId,
    claim_id: claim.claim_id,
    attempt_durable_record_id: claim.attempt_durable_record_id,
    runtime_stage_reference_id: stage.runtime_stage_reference_id,
    selected_worker_id: selectedWorker.worker_id,
    selected_worker_digest: selectedWorker.canonical_digest,
    candidate_set_digest: identity.candidate_set_digest,
    selection_fingerprint: selectionFingerprint,
    selection_digest: selectionDigest,
    ...SELECTION_SAFE_FLAGS
  };
  return cloneFrozen({
    outcome: 'READY',
    claim_id: claim.claim_id,
    attempt_durable_record_id: claim.attempt_durable_record_id,
    selection_id: selectionId,
    selection_fingerprint: selectionFingerprint,
    selection_digest: selectionDigest,
    selection_ordinal: SELECTION_ORDINAL,
    identity,
    stage_reference: stage,
    stage_requirements: stageRequirementMaterial(stage),
    selected_worker_id: selectedWorker.worker_id,
    selected_worker_digest: selectedWorker.canonical_digest,
    candidate_set: candidates,
    artifact,
    selection_creates_binding: false,
    selection_grants_ownership: false,
    selection_reserves_capacity: false,
    selection_creates_lease: false,
    selection_creates_fencing: false,
    selection_authorizes_execution: false,
    simulation: false,
    production_blocked: true
  });
}

function planToInsertRow(plan) {
  if (!plan || plan.outcome !== 'READY') throw new TypeError('selection_plan_not_ready');
  const scope = plan.identity;
  return {
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    selection_id: plan.selection_id,
    claim_id: scope.claim_id,
    attempt_durable_record_id: scope.attempt_durable_record_id,
    claim_digest: scope.claim_digest,
    runtime_stage_reference_id: scope.runtime_stage_reference_id,
    runtime_stage_reference_version: scope.runtime_stage_reference_version,
    stage_fingerprint: scope.stage_fingerprint,
    stage_digest: scope.stage_digest,
    attempt_ordinal: scope.attempt_ordinal,
    tenant_id: scope.tenant_id,
    organization_id: scope.organization_id,
    project_id: scope.project_id,
    session_reference_id: scope.session_reference_id,
    agent_id: scope.agent_id,
    actor_id: scope.actor_id,
    selection_ordinal: scope.selection_ordinal,
    selected_worker_id: scope.selected_worker_id,
    selected_worker_digest: scope.selected_worker_digest,
    candidate_worker_ids: scope.candidate_set.map((candidate) => candidate.worker_id),
    candidate_set: scope.candidate_set,
    candidate_set_digest: scope.candidate_set_digest,
    selection_policy: scope.selection_policy,
    selection_policy_version: scope.selection_policy_version,
    selection_fingerprint: plan.selection_fingerprint,
    selection_digest: plan.selection_digest,
    stage_reference: plan.stage_reference,
    selection_artifact: plan.artifact
  };
}

function identityFromPersistedRow(row) {
  return Object.freeze(Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, row[field]])));
}

function validatePersistedSelection(row) {
  const errors = [];
  if (!isPlainObject(row)) return { valid: false, errors: ['persisted_selection_must_be_object'] };
  for (const field of SELECTION_FIELDS.filter((field) => !['created_at'].includes(field))) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) errors.push(`persisted_selection_missing_${field}`);
  }
  for (const field of ['selection_id', 'claim_id', 'attempt_durable_record_id', 'claim_digest', 'runtime_stage_reference_id',
    'stage_fingerprint', 'stage_digest', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id',
    'actor_id', 'selected_worker_id', 'selected_worker_digest', 'candidate_set_digest', 'selection_policy',
    'selection_fingerprint', 'selection_digest']) requireString(row[field], `persisted_selection_${field}`);
  if (!Number.isInteger(Number(row.runtime_stage_reference_version)) || Number(row.runtime_stage_reference_version) < 1) errors.push('persisted_stage_reference_version_invalid');
  if (!Number.isInteger(Number(row.attempt_ordinal)) || Number(row.attempt_ordinal) < 1) errors.push('persisted_attempt_ordinal_invalid');
  if (!Number.isInteger(Number(row.selection_ordinal)) || Number(row.selection_ordinal) < 1) errors.push('persisted_selection_ordinal_invalid');
  if (!isCanonicalContentDigest(row.claim_digest) || !isCanonicalContentDigest(row.stage_digest)
    || !isCanonicalContentDigest(row.selected_worker_digest) || !isCanonicalContentDigest(row.candidate_set_digest)
    || !isCanonicalContentDigest(row.selection_digest)) errors.push('persisted_selection_digest_invalid');
  if (!Array.isArray(row.candidate_worker_ids) || !Array.isArray(row.candidate_set)) errors.push('persisted_candidate_set_invalid');
  if (!isPlainObject(row.stage_reference) || !isPlainObject(row.selection_artifact)) errors.push('persisted_selection_artifact_invalid');
  try {
    const identity = identityFromPersistedRow({
      ...row,
      runtime_stage_reference_version: Number(row.runtime_stage_reference_version),
      attempt_ordinal: Number(row.attempt_ordinal),
      selection_ordinal: Number(row.selection_ordinal)
    });
    if (stablePayload(identity) !== row.selection_fingerprint) errors.push('persisted_selection_fingerprint_mismatch');
    if (computeCanonicalContentDigest(identity) !== row.selection_digest) errors.push('persisted_selection_digest_mismatch');
    if (computeCanonicalContentDigest(row.candidate_set) !== row.candidate_set_digest) errors.push('persisted_candidate_set_digest_mismatch');
    if (computeCanonicalContentDigest(row.stage_reference) !== row.stage_digest) errors.push('persisted_stage_digest_mismatch');
    if (canonicalStageFingerprint(row.stage_reference) !== row.stage_fingerprint) errors.push('persisted_stage_fingerprint_mismatch');
    if (!row.candidate_set.some((candidate) => candidate.worker_id === row.selected_worker_id
      && candidate.canonical_digest === row.selected_worker_digest)) errors.push('persisted_selected_worker_not_in_candidate_set');
    if (row.selection_id !== `${SELECTION_ID_PREFIX}${row.selection_digest.slice('sha256:'.length)}`) errors.push('persisted_selection_id_mismatch');
    if (stablePayload(row.candidate_worker_ids) !== stablePayload(row.candidate_set.map((candidate) => candidate.worker_id))) errors.push('persisted_candidate_worker_ids_mismatch');
    if (row.selection_artifact.selection_id !== row.selection_id
      || row.selection_artifact.selected_worker_id !== row.selected_worker_id
      || row.selection_artifact.selection_digest !== row.selection_digest) errors.push('persisted_selection_artifact_binding_invalid');
  } catch (error) {
    errors.push(`persisted_selection_integrity_invalid::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function classifyPersistedSelection(row, plan) {
  if (!plan || plan.outcome !== 'READY') return { outcome: 'INVALID', reason_code: 'selection_plan_not_ready' };
  const persisted = validatePersistedSelection(row);
  if (!persisted.valid) return { outcome: 'TECHNICAL_FAILURE', reason_code: 'persisted_selection_invalid', validation_errors: persisted.errors };
  const requestedIdentity = plan.identity;
  const persistedIdentity = identityFromPersistedRow({
    ...row,
    runtime_stage_reference_version: Number(row.runtime_stage_reference_version),
    attempt_ordinal: Number(row.attempt_ordinal),
    selection_ordinal: Number(row.selection_ordinal)
  });
  return stablePayload(persistedIdentity) === stablePayload(requestedIdentity)
    ? { outcome: 'EXISTING_IDENTICAL', reason_code: 'selection_replay' }
    : { outcome: 'CONFLICT', reason_code: 'selection_slot_conflict' };
}

module.exports = {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  IDENTITY_FIELDS,
  SELECTION_FIELDS,
  SELECTION_ID_PREFIX,
  SELECTION_ORDINAL,
  SELECTION_POLICY,
  SELECTION_POLICY_VERSION,
  STAGE_REQUIREMENT_FIELDS,
  WORKER_FIELDS,
  buildSelectionPlan,
  classifyPersistedSelection,
  planToInsertRow,
  validateClaimAuthority,
  validatePersistedSelection,
  validateStageReference,
  validateWorkerSet
};

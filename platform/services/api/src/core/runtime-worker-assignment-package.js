'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { WORKER_ASSIGNMENT_STATUSES } = require('./runtime-worker-assignment-decision');

// pr106: the final, immutable envelope runtime-worker-assignment-boundary.js produces --
// "WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION significa apenas que workers declarativos
// compatíveis foram avaliados e, quando possível, recomendados. Nenhum worker foi reservado,
// iniciado ou contatado." A declarative snapshot of every worker/compatibility/candidate-set/
// assignment id and fingerprint this evaluation touched, with every operational flag forced false
// regardless of `worker_assignment_status`.
const RUNTIME_WORKER_ASSIGNMENT_PACKAGE_VALIDATOR_VERSION = 'runtime_worker_assignment_package_validator_v1';

const UPSTREAM_ID_FIELDS = Object.freeze([
  'runtime_worker_assignment_request_id', 'runtime_scheduler_request_id', 'runtime_scheduler_decision_id',
  'runtime_scheduler_result_id', 'runtime_scheduler_package_id', 'runtime_execution_package_id'
]);

const IDENTITY_FIELDS = Object.freeze(['tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id']);

const DERIVED_ID_LIST_FIELDS = Object.freeze([
  'worker_reference_ids', 'worker_compatibility_reference_ids', 'worker_candidate_set_reference_ids',
  'worker_stage_assignment_reference_ids'
]);

const COUNT_FIELDS = Object.freeze([
  'stage_count', 'worker_count', 'compatibility_count', 'candidate_set_count', 'assignment_count',
  'recommended_assignment_count', 'waiting_dependency_assignment_count', 'waiting_approval_assignment_count',
  'no_candidate_assignment_count', 'blocked_assignment_count'
]);

const UPSTREAM_FINGERPRINT_FIELDS = Object.freeze([
  'scheduler_package_fingerprint', 'scheduler_package_digest', 'runtime_execution_package_fingerprint',
  'runtime_execution_package_digest', 'capacity_snapshot_fingerprint', 'concurrency_fingerprint',
  'freshness_fingerprint', 'replay_fingerprint', 'idempotency_fingerprint'
]);

const DERIVED_FINGERPRINT_LIST_FIELDS = Object.freeze([
  'worker_fingerprints', 'worker_capability_fingerprints', 'worker_capacity_fingerprints',
  'worker_health_fingerprints', 'worker_network_policy_fingerprints', 'worker_secret_policy_fingerprints',
  // pr106fix4: package integrity -- official policy/requirement/source fingerprints now participate
  // in the package fingerprint/digest, never just the minimized worker-level bindings.
  'official_network_policy_fingerprints', 'official_secret_policy_fingerprints',
  'stage_policy_requirement_fingerprints', 'stage_policy_requirement_source_fingerprints',
  'compatibility_fingerprints', 'candidate_set_fingerprints', 'assignment_fingerprints'
]);

const RUNTIME_WORKER_ASSIGNMENT_PACKAGE_FIELDS = Object.freeze([
  'runtime_worker_assignment_package_id', 'runtime_worker_assignment_package_version',
  ...UPSTREAM_ID_FIELDS,
  ...IDENTITY_FIELDS,
  ...DERIVED_ID_LIST_FIELDS,
  ...COUNT_FIELDS,
  ...UPSTREAM_FINGERPRINT_FIELDS,
  ...DERIVED_FINGERPRINT_LIST_FIELDS,
  'worker_assignment_status',
  'worker_assignment_package_fingerprint', 'worker_assignment_package_digest',
  'worker_assignment_evaluated', 'worker_assignment_package_prepared_in_simulation',
  'worker_assignment_applied', 'worker_reserved', 'worker_started', 'stage_dispatched', 'stage_started', 'executed',
  'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const RUNTIME_WORKER_ASSIGNMENT_PACKAGE_SAFE_FLAGS = Object.freeze({
  worker_assignment_applied: false,
  worker_reserved: false,
  worker_started: false,
  stage_dispatched: false,
  stage_started: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 500;
const MAX_COUNT = 100000;

function isSortedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeWorkerAssignmentPackageFingerprint(pkg) {
  const { worker_assignment_package_fingerprint, worker_assignment_package_digest, ...rest } = pkg;
  return stablePayload(rest);
}

function computeWorkerAssignmentPackageDigest(pkg) {
  const { worker_assignment_package_digest, ...rest } = pkg;
  return computeCanonicalContentDigest(rest);
}

function validateRuntimeWorkerAssignmentPackage(pkg) {
  const errors = [];
  if (!isPlainObject(pkg)) return { valid: false, errors: ['runtime_worker_assignment_package_must_be_object'] };
  exactFields(pkg, RUNTIME_WORKER_ASSIGNMENT_PACKAGE_FIELDS, 'runtime_worker_assignment_package', errors);
  for (const field of [
    'runtime_worker_assignment_package_id', ...UPSTREAM_ID_FIELDS, ...IDENTITY_FIELDS, ...UPSTREAM_FINGERPRINT_FIELDS,
    'worker_assignment_package_fingerprint', 'worker_assignment_package_digest', 'validator_version'
  ]) {
    if (!isNonEmptyString(pkg[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(pkg.runtime_worker_assignment_package_version) || pkg.runtime_worker_assignment_package_version < 1) {
    errors.push('runtime_worker_assignment_package_version_invalid');
  }
  if (!WORKER_ASSIGNMENT_STATUSES.includes(pkg.worker_assignment_status)) errors.push('worker_assignment_status_invalid');
  for (const field of [...DERIVED_ID_LIST_FIELDS, ...DERIVED_FINGERPRINT_LIST_FIELDS]) {
    if (!isSortedUniqueStringList(pkg[field])) errors.push(`${field}_invalid`);
  }
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(pkg[field]) || pkg[field] < 0 || pkg[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (Number.isInteger(pkg.worker_count) && Array.isArray(pkg.worker_reference_ids) && pkg.worker_count !== pkg.worker_reference_ids.length) {
    errors.push('worker_count_inconsistent');
  }
  if (Number.isInteger(pkg.compatibility_count) && Array.isArray(pkg.worker_compatibility_reference_ids) && pkg.compatibility_count !== pkg.worker_compatibility_reference_ids.length) {
    errors.push('compatibility_count_inconsistent');
  }
  if (Number.isInteger(pkg.candidate_set_count) && Array.isArray(pkg.worker_candidate_set_reference_ids) && pkg.candidate_set_count !== pkg.worker_candidate_set_reference_ids.length) {
    errors.push('candidate_set_count_inconsistent');
  }
  if (Number.isInteger(pkg.assignment_count) && Array.isArray(pkg.worker_stage_assignment_reference_ids) && pkg.assignment_count !== pkg.worker_stage_assignment_reference_ids.length) {
    errors.push('assignment_count_inconsistent');
  }
  if (typeof pkg.worker_assignment_package_prepared_in_simulation !== 'boolean') errors.push('worker_assignment_package_prepared_in_simulation_must_be_boolean');
  else if (pkg.worker_assignment_package_prepared_in_simulation !== (pkg.worker_assignment_status === 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION')) {
    errors.push('worker_assignment_package_prepared_in_simulation_does_not_match_status');
  }
  for (const [field, expected] of Object.entries(RUNTIME_WORKER_ASSIGNMENT_PACKAGE_SAFE_FLAGS)) {
    if (pkg[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (pkg.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (pkg.validator_version !== RUNTIME_WORKER_ASSIGNMENT_PACKAGE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(pkg);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeWorkerAssignmentPackageFingerprint(pkg) !== pkg.worker_assignment_package_fingerprint) errors.push('worker_assignment_package_fingerprint_mismatch');
  } catch (error) {
    errors.push('worker_assignment_package_fingerprint_mismatch');
  }
  try {
    if (computeWorkerAssignmentPackageDigest(pkg) !== pkg.worker_assignment_package_digest) errors.push('worker_assignment_package_digest_mismatch');
  } catch (error) {
    errors.push('worker_assignment_package_digest_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(pkg));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeWorkerAssignmentPackage(input = {}) {
  const status = WORKER_ASSIGNMENT_STATUSES.includes(input.worker_assignment_status) ? input.worker_assignment_status : 'WORKER_ASSIGNMENT_VALIDATION_FAILED';
  const pkg = {
    runtime_worker_assignment_package_id: input.runtime_worker_assignment_package_id,
    runtime_worker_assignment_package_version: Number.isInteger(input.runtime_worker_assignment_package_version) ? input.runtime_worker_assignment_package_version : 1,
    worker_assignment_status: status,
    worker_assignment_package_fingerprint: 'pending',
    worker_assignment_package_digest: 'pending',
    rollout_percentage: 0,
    ...RUNTIME_WORKER_ASSIGNMENT_PACKAGE_SAFE_FLAGS,
    validator_version: RUNTIME_WORKER_ASSIGNMENT_PACKAGE_VALIDATOR_VERSION
  };
  for (const field of UPSTREAM_ID_FIELDS) pkg[field] = input[field];
  for (const field of IDENTITY_FIELDS) pkg[field] = input[field];
  for (const field of UPSTREAM_FINGERPRINT_FIELDS) pkg[field] = input[field];
  for (const field of DERIVED_ID_LIST_FIELDS) pkg[field] = uniqueSorted(input[field] || []);
  for (const field of DERIVED_FINGERPRINT_LIST_FIELDS) pkg[field] = uniqueSorted(input[field] || []);
  for (const field of COUNT_FIELDS) pkg[field] = Number.isInteger(input[field]) ? input[field] : 0;

  pkg.worker_assignment_evaluated = true;
  pkg.worker_assignment_package_prepared_in_simulation = status === 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION';
  pkg.worker_assignment_package_fingerprint = computeWorkerAssignmentPackageFingerprint(pkg);
  pkg.worker_assignment_package_digest = computeWorkerAssignmentPackageDigest(pkg);

  const validation = validateRuntimeWorkerAssignmentPackage(pkg);
  if (!validation.valid) {
    throw new Error(`runtime_worker_assignment_package_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(pkg);
}

module.exports = {
  COUNT_FIELDS,
  DERIVED_FINGERPRINT_LIST_FIELDS,
  DERIVED_ID_LIST_FIELDS,
  IDENTITY_FIELDS,
  MAX_COUNT,
  MAX_LIST_ITEMS,
  RUNTIME_WORKER_ASSIGNMENT_PACKAGE_FIELDS,
  RUNTIME_WORKER_ASSIGNMENT_PACKAGE_SAFE_FLAGS,
  RUNTIME_WORKER_ASSIGNMENT_PACKAGE_VALIDATOR_VERSION,
  UPSTREAM_FINGERPRINT_FIELDS,
  UPSTREAM_ID_FIELDS,
  buildRuntimeWorkerAssignmentPackage,
  computeWorkerAssignmentPackageDigest,
  computeWorkerAssignmentPackageFingerprint,
  isSortedUniqueStringList,
  validateRuntimeWorkerAssignmentPackage
};

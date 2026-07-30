'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { RUNTIME_SCHEDULER_STATUSES } = require('./runtime-scheduler-decision');

// pr105: the final, immutable envelope runtime-scheduler-boundary.js produces -- a declarative
// snapshot of every id/fingerprint this scheduling pass touched, the derived scheduling plan (stage
// eligibility partitions, parallel groups, approval waits, capacity/queue plans), and every
// operational flag forced false regardless of `scheduler_status`. "Mesmo quando o scheduler package
// for preparado... nenhum scheduler é iniciado" -- SCHEDULER_PACKAGE_PREPARED_SIMULATION means only
// that a declarative representation of stage order/eligibility was prepared, never that any of it
// runs.
const RUNTIME_SCHEDULER_PACKAGE_VALIDATOR_VERSION = 'runtime_scheduler_package_validator_v1';

const UPSTREAM_ID_FIELDS = Object.freeze([
  'runtime_scheduler_request_id', 'runtime_admission_request_id', 'runtime_admission_decision_id',
  'runtime_admission_result_id', 'runtime_readiness_decision_id', 'runtime_execution_package_id',
  'runtime_stage_manifest_id', 'runtime_dependency_manifest_id', 'runtime_budget_reference_id',
  'runtime_capacity_snapshot_reference_id', 'runtime_concurrency_reference_id', 'runtime_freshness_reference_id',
  'runtime_replay_reference_id', 'idempotency_reference_id'
]);

const DERIVED_ID_LIST_FIELDS = Object.freeze([
  'scheduler_stage_reference_ids', 'scheduler_dependency_reference_ids', 'parallel_group_reference_ids',
  'approval_wait_reference_ids'
]);

const IDENTITY_FIELDS = Object.freeze(['tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id']);

const PARTITION_LIST_FIELDS = Object.freeze([
  'ordered_scheduler_stage_reference_ids', 'eligible_scheduler_stage_reference_ids',
  'waiting_dependency_stage_reference_ids', 'waiting_approval_stage_reference_ids', 'optional_stage_reference_ids',
  'blocked_stage_reference_ids'
]);

const COUNT_FIELDS = Object.freeze([
  'scheduler_stage_count', 'scheduler_dependency_count', 'parallel_group_count', 'approval_wait_count',
  'model_stage_count', 'tool_stage_count', 'workflow_stage_count', 'parallel_stage_count', 'optional_stage_count',
  'approval_stage_count', 'estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens',
  'estimated_total_cost_minor_units'
]);

const UPSTREAM_FINGERPRINT_FIELDS = Object.freeze([
  'runtime_admission_decision_fingerprint', 'runtime_admission_result_fingerprint',
  'runtime_execution_package_fingerprint', 'runtime_execution_package_digest', 'runtime_stage_manifest_fingerprint',
  'runtime_dependency_manifest_fingerprint', 'runtime_budget_fingerprint', 'runtime_capacity_snapshot_fingerprint',
  'runtime_concurrency_fingerprint', 'runtime_freshness_fingerprint', 'runtime_replay_fingerprint',
  'idempotency_fingerprint'
]);

const DERIVED_FINGERPRINT_LIST_FIELDS = Object.freeze([
  'scheduler_stage_fingerprints', 'scheduler_dependency_fingerprints', 'parallel_group_fingerprints',
  'approval_wait_fingerprints'
]);

const PLAN_FINGERPRINT_FIELDS = Object.freeze(['scheduler_capacity_plan_fingerprint', 'scheduler_queue_plan_fingerprint']);

const RUNTIME_SCHEDULER_PACKAGE_FIELDS = Object.freeze([
  'runtime_scheduler_package_id', 'runtime_scheduler_package_version',
  ...UPSTREAM_ID_FIELDS,
  ...DERIVED_ID_LIST_FIELDS,
  'scheduler_capacity_plan_reference_id', 'scheduler_queue_plan_reference_id',
  ...IDENTITY_FIELDS,
  'scheduler_status',
  ...PARTITION_LIST_FIELDS,
  ...COUNT_FIELDS,
  ...UPSTREAM_FINGERPRINT_FIELDS,
  ...DERIVED_FINGERPRINT_LIST_FIELDS,
  ...PLAN_FINGERPRINT_FIELDS,
  'scheduler_package_fingerprint', 'scheduler_package_digest',
  'scheduler_package_prepared_in_simulation',
  'scheduler_started', 'runtime_enabled', 'execution_authorized', 'execution_started', 'job_created',
  'queue_created', 'queue_used', 'worker_started', 'stage_dispatched', 'stage_started', 'stage_completed', 'executed',
  'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const RUNTIME_SCHEDULER_PACKAGE_SAFE_FLAGS = Object.freeze({
  scheduler_started: false,
  runtime_enabled: false,
  execution_authorized: false,
  execution_started: false,
  job_created: false,
  queue_created: false,
  queue_used: false,
  worker_started: false,
  stage_dispatched: false,
  stage_started: false,
  stage_completed: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 200;
const MAX_COUNT = 100000;

function isSortedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeSchedulerPackageFingerprint(pkg) {
  const { scheduler_package_fingerprint, scheduler_package_digest, ...rest } = pkg;
  return stablePayload(rest);
}

function computeSchedulerPackageDigest(pkg) {
  const { scheduler_package_digest, ...rest } = pkg;
  return computeCanonicalContentDigest(rest);
}

function validateRuntimeSchedulerPackage(pkg) {
  const errors = [];
  if (!isPlainObject(pkg)) return { valid: false, errors: ['runtime_scheduler_package_must_be_object'] };
  exactFields(pkg, RUNTIME_SCHEDULER_PACKAGE_FIELDS, 'runtime_scheduler_package', errors);
  for (const field of [
    'runtime_scheduler_package_id', ...UPSTREAM_ID_FIELDS, 'scheduler_capacity_plan_reference_id',
    'scheduler_queue_plan_reference_id', ...IDENTITY_FIELDS, ...UPSTREAM_FINGERPRINT_FIELDS, ...PLAN_FINGERPRINT_FIELDS,
    'scheduler_package_fingerprint', 'scheduler_package_digest', 'validator_version'
  ]) {
    if (!isNonEmptyString(pkg[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(pkg.runtime_scheduler_package_version) || pkg.runtime_scheduler_package_version < 1) {
    errors.push('runtime_scheduler_package_version_invalid');
  }
  if (!RUNTIME_SCHEDULER_STATUSES.includes(pkg.scheduler_status)) errors.push('scheduler_status_invalid');
  for (const field of DERIVED_ID_LIST_FIELDS) {
    if (!isSortedUniqueStringList(pkg[field])) errors.push(`${field}_invalid`);
  }
  for (const field of PARTITION_LIST_FIELDS) {
    if (!Array.isArray(pkg[field]) || pkg[field].length > MAX_LIST_ITEMS || !pkg[field].every(isNonEmptyString)) {
      errors.push(`${field}_invalid`);
    }
  }
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(pkg[field]) || pkg[field] < 0 || pkg[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(pkg.scheduler_stage_count) && Array.isArray(pkg.scheduler_stage_reference_ids)
    && pkg.scheduler_stage_count !== pkg.scheduler_stage_reference_ids.length
  ) {
    errors.push('scheduler_stage_count_inconsistent');
  }
  if (
    Number.isInteger(pkg.scheduler_dependency_count) && Array.isArray(pkg.scheduler_dependency_reference_ids)
    && pkg.scheduler_dependency_count !== pkg.scheduler_dependency_reference_ids.length
  ) {
    errors.push('scheduler_dependency_count_inconsistent');
  }
  if (
    Number.isInteger(pkg.parallel_group_count) && Array.isArray(pkg.parallel_group_reference_ids)
    && pkg.parallel_group_count !== pkg.parallel_group_reference_ids.length
  ) {
    errors.push('parallel_group_count_inconsistent');
  }
  if (
    Number.isInteger(pkg.approval_wait_count) && Array.isArray(pkg.approval_wait_reference_ids)
    && pkg.approval_wait_count !== pkg.approval_wait_reference_ids.length
  ) {
    errors.push('approval_wait_count_inconsistent');
  }
  for (const field of DERIVED_FINGERPRINT_LIST_FIELDS) {
    if (!Array.isArray(pkg[field]) || pkg[field].length > MAX_LIST_ITEMS || !pkg[field].every(isNonEmptyString)) {
      errors.push(`${field}_invalid`);
    }
  }
  if (typeof pkg.scheduler_package_prepared_in_simulation !== 'boolean') errors.push('scheduler_package_prepared_in_simulation_must_be_boolean');
  else if (pkg.scheduler_package_prepared_in_simulation !== (pkg.scheduler_status === 'SCHEDULER_PACKAGE_PREPARED_SIMULATION')) {
    errors.push('scheduler_package_prepared_in_simulation_does_not_match_status');
  }
  for (const [field, expected] of Object.entries(RUNTIME_SCHEDULER_PACKAGE_SAFE_FLAGS)) {
    if (pkg[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (pkg.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (pkg.validator_version !== RUNTIME_SCHEDULER_PACKAGE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(pkg);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeSchedulerPackageFingerprint(pkg) !== pkg.scheduler_package_fingerprint) errors.push('scheduler_package_fingerprint_mismatch');
  } catch (error) {
    errors.push('scheduler_package_fingerprint_mismatch');
  }
  try {
    if (computeSchedulerPackageDigest(pkg) !== pkg.scheduler_package_digest) errors.push('scheduler_package_digest_mismatch');
  } catch (error) {
    errors.push('scheduler_package_digest_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(pkg));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeSchedulerPackage(input = {}) {
  const status = RUNTIME_SCHEDULER_STATUSES.includes(input.scheduler_status) ? input.scheduler_status : 'SCHEDULER_VALIDATION_FAILED';
  const pkg = {
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    runtime_scheduler_package_version: Number.isInteger(input.runtime_scheduler_package_version) ? input.runtime_scheduler_package_version : 1,
    scheduler_capacity_plan_reference_id: input.scheduler_capacity_plan_reference_id,
    scheduler_queue_plan_reference_id: input.scheduler_queue_plan_reference_id,
    scheduler_status: status,
    scheduler_package_fingerprint: 'pending',
    scheduler_package_digest: 'pending',
    rollout_percentage: 0,
    ...RUNTIME_SCHEDULER_PACKAGE_SAFE_FLAGS,
    validator_version: RUNTIME_SCHEDULER_PACKAGE_VALIDATOR_VERSION
  };
  for (const field of UPSTREAM_ID_FIELDS) pkg[field] = input[field];
  for (const field of IDENTITY_FIELDS) pkg[field] = input[field];
  for (const field of UPSTREAM_FINGERPRINT_FIELDS) pkg[field] = input[field];
  for (const field of PLAN_FINGERPRINT_FIELDS) pkg[field] = input[field];
  for (const field of DERIVED_ID_LIST_FIELDS) pkg[field] = uniqueSorted(input[field] || []);
  for (const field of PARTITION_LIST_FIELDS) pkg[field] = Array.isArray(input[field]) ? input[field] : [];
  for (const field of DERIVED_FINGERPRINT_LIST_FIELDS) pkg[field] = uniqueSorted(input[field] || []);
  for (const field of COUNT_FIELDS) pkg[field] = Number.isInteger(input[field]) ? input[field] : 0;

  pkg.scheduler_package_prepared_in_simulation = status === 'SCHEDULER_PACKAGE_PREPARED_SIMULATION';
  pkg.scheduler_package_fingerprint = computeSchedulerPackageFingerprint(pkg);
  pkg.scheduler_package_digest = computeSchedulerPackageDigest(pkg);

  const validation = validateRuntimeSchedulerPackage(pkg);
  if (!validation.valid) {
    throw new Error(`runtime_scheduler_package_construction_invalid::${JSON.stringify(validation.errors)}`);
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
  PARTITION_LIST_FIELDS,
  PLAN_FINGERPRINT_FIELDS,
  RUNTIME_SCHEDULER_PACKAGE_FIELDS,
  RUNTIME_SCHEDULER_PACKAGE_SAFE_FLAGS,
  RUNTIME_SCHEDULER_PACKAGE_VALIDATOR_VERSION,
  UPSTREAM_FINGERPRINT_FIELDS,
  UPSTREAM_ID_FIELDS,
  buildRuntimeSchedulerPackage,
  computeSchedulerPackageDigest,
  computeSchedulerPackageFingerprint,
  isSortedUniqueStringList,
  validateRuntimeSchedulerPackage
};

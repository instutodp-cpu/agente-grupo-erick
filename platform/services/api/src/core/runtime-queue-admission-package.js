'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { QUEUE_ADMISSION_STATUSES } = require('./runtime-queue-admission-decision');

// pr108: the final, immutable envelope runtime-queue-admission-boundary.js produces --
// "QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION significa somente que intents de dispatch foram
// avaliadas contra filas lógicas, quotas, backlog, partições e fairness. Nenhuma fila ou item de
// fila foi criado." Every fingerprint this evaluation touched -- the full Dispatch/Worker
// Assignment/Scheduler/Runtime chain, official policies, Stage Policy Requirements, Scheduler
// Dependencies, and every one of this layer's own Queue Class/Capacity/Quota/Partition/Fairness/
// Intent-Binding/Admission-Entry/Order/Replay references -- participates in the package
// fingerprint/digest, so altering any one of them alters or blocks the package.
const RUNTIME_QUEUE_ADMISSION_PACKAGE_VALIDATOR_VERSION = 'runtime_queue_admission_package_validator_v1';

const UPSTREAM_ID_FIELDS = Object.freeze([
  'runtime_queue_admission_request_id',
  'runtime_dispatch_request_id', 'runtime_dispatch_decision_id', 'runtime_dispatch_result_id',
  'runtime_dispatch_package_id',
  'runtime_worker_assignment_package_id', 'runtime_scheduler_package_id', 'runtime_execution_package_id',
  'runtime_queue_admission_order_reference_id', 'runtime_queue_admission_replay_reference_id'
]);

const IDENTITY_FIELDS = Object.freeze(['tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id']);

const DERIVED_ID_LIST_FIELDS = Object.freeze([
  'queue_class_reference_ids', 'queue_capacity_snapshot_reference_ids', 'queue_quota_reference_ids',
  'queue_partition_reference_ids', 'queue_fairness_reference_ids', 'queue_intent_binding_reference_ids',
  'queue_admission_entry_reference_ids'
]);

// Genuine order matters here -- never re-sorted, mirrors runtime-queue-admission-order-reference.js's
// own `ordered_*` fields exactly (duplicated onto the package for direct top-level access).
const ORDERED_LIST_FIELDS = Object.freeze(['ordered_dispatch_intent_reference_ids', 'ordered_queue_admission_entry_reference_ids']);

const PARTITION_LIST_FIELDS = Object.freeze([
  'accepted_queue_admission_entry_reference_ids', 'deferred_queue_admission_entry_reference_ids',
  'waiting_queue_admission_entry_reference_ids', 'optional_queue_admission_entry_reference_ids',
  'blocked_queue_admission_entry_reference_ids'
]);

const COUNT_FIELDS = Object.freeze([
  'entry_count', 'accepted_count', 'deferred_count', 'waiting_count', 'optional_count', 'blocked_count',
  'model_admission_count', 'tool_admission_count', 'workflow_admission_count', 'parallel_admission_count'
]);

const ESTIMATE_FIELDS = Object.freeze([
  'estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens', 'estimated_total_cost_minor_units'
]);

const UPSTREAM_FINGERPRINT_FIELDS = Object.freeze([
  'dispatch_package_fingerprint', 'dispatch_package_digest', 'worker_assignment_package_fingerprint',
  'scheduler_package_fingerprint', 'runtime_execution_package_fingerprint',
  'runtime_capacity_snapshot_fingerprint', 'runtime_concurrency_fingerprint', 'runtime_budget_fingerprint',
  'runtime_freshness_fingerprint', 'idempotency_fingerprint', 'registry_snapshot_fingerprint',
  'queue_admission_order_fingerprint', 'queue_admission_replay_fingerprint'
]);

const DERIVED_FINGERPRINT_LIST_FIELDS = Object.freeze([
  'dispatch_intent_fingerprints', 'dispatch_stage_fingerprints', 'dispatch_worker_binding_fingerprints',
  'dispatch_dependency_gate_fingerprints', 'dispatch_approval_gate_fingerprints', 'dispatch_capacity_fingerprints',
  'dispatch_budget_fingerprints', 'dispatch_payload_fingerprints', 'scheduler_dependency_fingerprints',
  'stage_policy_requirement_fingerprints', 'official_network_policy_fingerprints', 'official_secret_policy_fingerprints',
  'queue_class_fingerprints', 'queue_capacity_snapshot_fingerprints', 'queue_quota_fingerprints',
  'queue_partition_fingerprints', 'queue_fairness_fingerprints', 'queue_intent_binding_fingerprints',
  'queue_admission_entry_fingerprints',
  // pr108fix Package Integrity: "Model/Tool/Workflow source fingerprints usados na seleção" --
  // altering any official Model Selection Decision the boundary consulted alters or blocks the
  // package. Tool/Workflow source identity is already fully covered by
  // `stage_policy_requirement_fingerprints` (their `source_reference_id` IS the tool/workflow ID).
  'official_model_selection_decision_fingerprints'
]);

const OPERATIONAL_FLAG_FIELDS = Object.freeze([
  'queue_admission_applied', 'queue_created', 'queue_item_created', 'queue_item_enqueued', 'queue_position_reserved',
  'queue_capacity_consumed', 'queue_backlog_changed', 'job_created', 'dispatch_authorized', 'dispatch_applied',
  'dispatch_sent', 'worker_reserved', 'worker_started', 'stage_dispatched', 'stage_started', 'executed'
]);

const RUNTIME_QUEUE_ADMISSION_PACKAGE_FIELDS = Object.freeze([
  'runtime_queue_admission_package_id', 'runtime_queue_admission_package_version',
  ...UPSTREAM_ID_FIELDS,
  ...IDENTITY_FIELDS,
  ...DERIVED_ID_LIST_FIELDS,
  ...ORDERED_LIST_FIELDS,
  ...PARTITION_LIST_FIELDS,
  ...COUNT_FIELDS,
  ...ESTIMATE_FIELDS,
  ...UPSTREAM_FINGERPRINT_FIELDS,
  ...DERIVED_FINGERPRINT_LIST_FIELDS,
  'queue_admission_status',
  'queue_admission_package_fingerprint', 'queue_admission_package_digest',
  'queue_admission_evaluated', 'queue_admission_package_prepared_in_simulation',
  ...OPERATIONAL_FLAG_FIELDS,
  'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const RUNTIME_QUEUE_ADMISSION_PACKAGE_SAFE_FLAGS = Object.freeze({
  ...Object.fromEntries(OPERATIONAL_FLAG_FIELDS.map((field) => [field, false])),
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 1000;
const MAX_COUNT = 100000;
const MAX_TOKEN_BOUND = 1000000000;

function isUniqueList(list, maxItems = MAX_LIST_ITEMS) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString) && new Set(list).size === list.length;
}

function isSortedUniqueList(list, maxItems = MAX_LIST_ITEMS) {
  if (!isUniqueList(list, maxItems)) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeQueueAdmissionPackageFingerprint(pkg) {
  const { queue_admission_package_fingerprint, queue_admission_package_digest, ...rest } = pkg;
  return stablePayload(rest);
}

function computeQueueAdmissionPackageDigest(pkg) {
  const { queue_admission_package_digest, ...rest } = pkg;
  return computeCanonicalContentDigest(rest);
}

function validateRuntimeQueueAdmissionPackage(pkg) {
  const errors = [];
  if (!isPlainObject(pkg)) return { valid: false, errors: ['runtime_queue_admission_package_must_be_object'] };
  exactFields(pkg, RUNTIME_QUEUE_ADMISSION_PACKAGE_FIELDS, 'runtime_queue_admission_package', errors);
  for (const field of [
    'runtime_queue_admission_package_id', ...UPSTREAM_ID_FIELDS, ...IDENTITY_FIELDS, ...UPSTREAM_FINGERPRINT_FIELDS,
    'queue_admission_package_fingerprint', 'queue_admission_package_digest', 'validator_version'
  ]) {
    if (!isNonEmptyString(pkg[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(pkg.runtime_queue_admission_package_version) || pkg.runtime_queue_admission_package_version < 1) {
    errors.push('runtime_queue_admission_package_version_invalid');
  }
  if (!QUEUE_ADMISSION_STATUSES.includes(pkg.queue_admission_status)) errors.push('queue_admission_status_invalid');
  for (const field of [...DERIVED_ID_LIST_FIELDS, ...DERIVED_FINGERPRINT_LIST_FIELDS, ...PARTITION_LIST_FIELDS]) {
    if (!isSortedUniqueList(pkg[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ORDERED_LIST_FIELDS) {
    if (!isUniqueList(pkg[field])) errors.push(`${field}_invalid`);
  }
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(pkg[field]) || pkg[field] < 0 || pkg[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  for (const field of ESTIMATE_FIELDS) {
    if (!Number.isInteger(pkg[field]) || pkg[field] < 0 || pkg[field] > MAX_TOKEN_BOUND) errors.push(`${field}_invalid`);
  }
  if (Array.isArray(pkg.ordered_queue_admission_entry_reference_ids) && Number.isInteger(pkg.entry_count) && pkg.entry_count !== pkg.ordered_queue_admission_entry_reference_ids.length) {
    errors.push('entry_count_inconsistent');
  }
  if (typeof pkg.queue_admission_package_prepared_in_simulation !== 'boolean') errors.push('queue_admission_package_prepared_in_simulation_must_be_boolean');
  else if (pkg.queue_admission_package_prepared_in_simulation !== (pkg.queue_admission_status === 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION')) {
    errors.push('queue_admission_package_prepared_in_simulation_does_not_match_status');
  }
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_ADMISSION_PACKAGE_SAFE_FLAGS)) {
    if (pkg[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (pkg.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (pkg.validator_version !== RUNTIME_QUEUE_ADMISSION_PACKAGE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(pkg);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeQueueAdmissionPackageFingerprint(pkg) !== pkg.queue_admission_package_fingerprint) errors.push('queue_admission_package_fingerprint_mismatch');
  } catch (error) {
    errors.push('queue_admission_package_fingerprint_mismatch');
  }
  try {
    if (computeQueueAdmissionPackageDigest(pkg) !== pkg.queue_admission_package_digest) errors.push('queue_admission_package_digest_mismatch');
  } catch (error) {
    errors.push('queue_admission_package_digest_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(pkg));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueAdmissionPackage(input = {}) {
  const status = QUEUE_ADMISSION_STATUSES.includes(input.queue_admission_status) ? input.queue_admission_status : 'QUEUE_ADMISSION_VALIDATION_FAILED';
  const pkg = {
    runtime_queue_admission_package_id: input.runtime_queue_admission_package_id,
    runtime_queue_admission_package_version: Number.isInteger(input.runtime_queue_admission_package_version) ? input.runtime_queue_admission_package_version : 1,
    queue_admission_status: status,
    queue_admission_package_fingerprint: 'pending',
    queue_admission_package_digest: 'pending',
    rollout_percentage: 0,
    ...RUNTIME_QUEUE_ADMISSION_PACKAGE_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_ADMISSION_PACKAGE_VALIDATOR_VERSION
  };
  for (const field of UPSTREAM_ID_FIELDS) pkg[field] = input[field];
  for (const field of IDENTITY_FIELDS) pkg[field] = input[field];
  for (const field of UPSTREAM_FINGERPRINT_FIELDS) pkg[field] = input[field];
  for (const field of DERIVED_ID_LIST_FIELDS) pkg[field] = uniqueSorted(input[field] || []);
  for (const field of DERIVED_FINGERPRINT_LIST_FIELDS) pkg[field] = uniqueSorted(input[field] || []);
  for (const field of PARTITION_LIST_FIELDS) pkg[field] = uniqueSorted(input[field] || []);
  for (const field of ORDERED_LIST_FIELDS) pkg[field] = Array.isArray(input[field]) ? input[field] : [];
  for (const field of COUNT_FIELDS) pkg[field] = Number.isInteger(input[field]) ? input[field] : 0;
  for (const field of ESTIMATE_FIELDS) pkg[field] = Number.isInteger(input[field]) ? input[field] : 0;

  pkg.queue_admission_evaluated = true;
  pkg.queue_admission_package_prepared_in_simulation = status === 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION';
  pkg.queue_admission_package_fingerprint = computeQueueAdmissionPackageFingerprint(pkg);
  pkg.queue_admission_package_digest = computeQueueAdmissionPackageDigest(pkg);

  const validation = validateRuntimeQueueAdmissionPackage(pkg);
  if (!validation.valid) {
    throw new Error(`runtime_queue_admission_package_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(pkg);
}

module.exports = {
  COUNT_FIELDS,
  DERIVED_FINGERPRINT_LIST_FIELDS,
  DERIVED_ID_LIST_FIELDS,
  ESTIMATE_FIELDS,
  IDENTITY_FIELDS,
  MAX_COUNT,
  MAX_LIST_ITEMS,
  MAX_TOKEN_BOUND,
  OPERATIONAL_FLAG_FIELDS,
  ORDERED_LIST_FIELDS,
  PARTITION_LIST_FIELDS,
  RUNTIME_QUEUE_ADMISSION_PACKAGE_FIELDS,
  RUNTIME_QUEUE_ADMISSION_PACKAGE_SAFE_FLAGS,
  RUNTIME_QUEUE_ADMISSION_PACKAGE_VALIDATOR_VERSION,
  UPSTREAM_FINGERPRINT_FIELDS,
  UPSTREAM_ID_FIELDS,
  buildRuntimeQueueAdmissionPackage,
  computeQueueAdmissionPackageDigest,
  computeQueueAdmissionPackageFingerprint,
  isSortedUniqueList,
  isUniqueList,
  validateRuntimeQueueAdmissionPackage
};

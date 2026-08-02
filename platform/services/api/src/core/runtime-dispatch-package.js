'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { DISPATCH_STATUSES } = require('./runtime-dispatch-decision');

// pr107: the final, immutable envelope runtime-dispatch-boundary.js produces --
// "DISPATCH_PACKAGE_PREPARED_SIMULATION significa apenas que envelopes declarativos de dispatch
// foram preparados. Nenhum dispatch foi autorizado, aplicado ou enviado." Every fingerprint this
// evaluation touched -- Worker Assignment/Scheduler/Runtime chain, official policies, Stage Policy
// Requirements and their sources, and every one of this layer's own Stage/Worker Binding/Dependency
// Gate/Approval Gate/Capacity/Budget/Payload/Intent/Order/Replay references -- participates in the
// package fingerprint/digest, so altering any one of them alters or blocks the package.
const RUNTIME_DISPATCH_PACKAGE_VALIDATOR_VERSION = 'runtime_dispatch_package_validator_v1';

const UPSTREAM_ID_FIELDS = Object.freeze([
  'runtime_dispatch_request_id',
  'runtime_worker_assignment_request_id', 'runtime_worker_assignment_decision_id', 'runtime_worker_assignment_result_id',
  'runtime_worker_assignment_package_id',
  'runtime_scheduler_request_id', 'runtime_scheduler_decision_id', 'runtime_scheduler_result_id', 'runtime_scheduler_package_id',
  'runtime_execution_package_id',
  'dispatch_order_reference_id', 'runtime_dispatch_replay_reference_id'
]);

const IDENTITY_FIELDS = Object.freeze(['tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id']);

const DERIVED_ID_LIST_FIELDS = Object.freeze([
  'dispatch_stage_reference_ids', 'dispatch_worker_binding_reference_ids', 'dispatch_dependency_gate_reference_ids',
  'dispatch_approval_gate_reference_ids', 'dispatch_capacity_reference_ids', 'dispatch_budget_reference_ids',
  'dispatch_payload_reference_ids', 'dispatch_intent_reference_ids'
]);

// Genuine order matters here -- never re-sorted, mirrors runtime-dispatch-order-reference.js's own
// `ordered_*` fields exactly (duplicated onto the package for direct top-level access).
const ORDERED_LIST_FIELDS = Object.freeze(['ordered_dispatch_stage_reference_ids', 'ordered_dispatch_intent_reference_ids']);

const PARTITION_LIST_FIELDS = Object.freeze([
  'prepared_dispatch_intent_reference_ids', 'waiting_dependency_intent_reference_ids',
  'waiting_approval_intent_reference_ids', 'optional_intent_reference_ids', 'blocked_intent_reference_ids'
]);

const COUNT_FIELDS = Object.freeze([
  'dispatch_stage_count', 'dispatch_intent_count', 'prepared_intent_count', 'waiting_dependency_count',
  'waiting_approval_count', 'optional_count', 'blocked_count',
  'model_intent_count', 'tool_intent_count', 'workflow_intent_count', 'parallel_intent_count'
]);

const ESTIMATE_FIELDS = Object.freeze([
  'estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens', 'estimated_total_cost_minor_units'
]);

const UPSTREAM_FINGERPRINT_FIELDS = Object.freeze([
  'worker_assignment_package_fingerprint', 'worker_assignment_package_digest', 'scheduler_package_fingerprint',
  'scheduler_package_digest', 'runtime_execution_package_fingerprint', 'runtime_execution_package_digest',
  'capacity_snapshot_fingerprint', 'concurrency_fingerprint', 'runtime_budget_fingerprint', 'freshness_fingerprint',
  'idempotency_fingerprint', 'registry_snapshot_fingerprint', 'dispatch_order_fingerprint', 'dispatch_replay_fingerprint'
]);

const DERIVED_FINGERPRINT_LIST_FIELDS = Object.freeze([
  'worker_fingerprints', 'worker_assignment_fingerprints', 'worker_compatibility_fingerprints',
  'worker_candidate_set_fingerprints', 'stage_policy_requirement_fingerprints', 'stage_policy_requirement_source_fingerprints',
  // pr107fix2 FIX 2: the cross-validated Scheduler Dependency collection's own fingerprints --
  // altering any dependency now changes or blocks the package.
  'scheduler_dependency_fingerprints',
  'official_network_policy_fingerprints', 'official_secret_policy_fingerprints',
  'dispatch_stage_fingerprints', 'dispatch_worker_binding_fingerprints', 'dispatch_dependency_gate_fingerprints',
  'dispatch_approval_gate_fingerprints', 'dispatch_capacity_fingerprints', 'dispatch_budget_fingerprints',
  'dispatch_payload_fingerprints', 'dispatch_intent_fingerprints'
]);

const OPERATIONAL_FLAG_FIELDS = Object.freeze([
  'dispatch_authorized', 'dispatch_applied', 'dispatch_sent', 'dispatch_acknowledged', 'dispatch_lease_created',
  'worker_reserved', 'worker_started', 'job_created', 'queue_created', 'queue_item_created', 'queue_used',
  'stage_dispatched', 'stage_started', 'executed'
]);

const RUNTIME_DISPATCH_PACKAGE_FIELDS = Object.freeze([
  'runtime_dispatch_package_id', 'runtime_dispatch_package_version',
  ...UPSTREAM_ID_FIELDS,
  ...IDENTITY_FIELDS,
  ...DERIVED_ID_LIST_FIELDS,
  ...ORDERED_LIST_FIELDS,
  ...PARTITION_LIST_FIELDS,
  ...COUNT_FIELDS,
  ...ESTIMATE_FIELDS,
  ...UPSTREAM_FINGERPRINT_FIELDS,
  ...DERIVED_FINGERPRINT_LIST_FIELDS,
  'dispatch_status',
  'dispatch_package_fingerprint', 'dispatch_package_digest',
  'dispatch_evaluated', 'dispatch_package_prepared_in_simulation',
  ...OPERATIONAL_FLAG_FIELDS,
  'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const RUNTIME_DISPATCH_PACKAGE_SAFE_FLAGS = Object.freeze({
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

function computeDispatchPackageFingerprint(pkg) {
  const { dispatch_package_fingerprint, dispatch_package_digest, ...rest } = pkg;
  return stablePayload(rest);
}

function computeDispatchPackageDigest(pkg) {
  const { dispatch_package_digest, ...rest } = pkg;
  return computeCanonicalContentDigest(rest);
}

function validateRuntimeDispatchPackage(pkg) {
  const errors = [];
  if (!isPlainObject(pkg)) return { valid: false, errors: ['runtime_dispatch_package_must_be_object'] };
  exactFields(pkg, RUNTIME_DISPATCH_PACKAGE_FIELDS, 'runtime_dispatch_package', errors);
  for (const field of [
    'runtime_dispatch_package_id', ...UPSTREAM_ID_FIELDS, ...IDENTITY_FIELDS, ...UPSTREAM_FINGERPRINT_FIELDS,
    'dispatch_package_fingerprint', 'dispatch_package_digest', 'validator_version'
  ]) {
    if (!isNonEmptyString(pkg[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(pkg.runtime_dispatch_package_version) || pkg.runtime_dispatch_package_version < 1) {
    errors.push('runtime_dispatch_package_version_invalid');
  }
  if (!DISPATCH_STATUSES.includes(pkg.dispatch_status)) errors.push('dispatch_status_invalid');
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
  if (Array.isArray(pkg.ordered_dispatch_stage_reference_ids) && Number.isInteger(pkg.dispatch_stage_count) && pkg.dispatch_stage_count !== pkg.ordered_dispatch_stage_reference_ids.length) {
    errors.push('dispatch_stage_count_inconsistent');
  }
  if (Array.isArray(pkg.ordered_dispatch_intent_reference_ids) && Number.isInteger(pkg.dispatch_intent_count) && pkg.dispatch_intent_count !== pkg.ordered_dispatch_intent_reference_ids.length) {
    errors.push('dispatch_intent_count_inconsistent');
  }
  if (typeof pkg.dispatch_package_prepared_in_simulation !== 'boolean') errors.push('dispatch_package_prepared_in_simulation_must_be_boolean');
  else if (pkg.dispatch_package_prepared_in_simulation !== (pkg.dispatch_status === 'DISPATCH_PACKAGE_PREPARED_SIMULATION')) {
    errors.push('dispatch_package_prepared_in_simulation_does_not_match_status');
  }
  for (const [field, expected] of Object.entries(RUNTIME_DISPATCH_PACKAGE_SAFE_FLAGS)) {
    if (pkg[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (pkg.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (pkg.validator_version !== RUNTIME_DISPATCH_PACKAGE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(pkg);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeDispatchPackageFingerprint(pkg) !== pkg.dispatch_package_fingerprint) errors.push('dispatch_package_fingerprint_mismatch');
  } catch (error) {
    errors.push('dispatch_package_fingerprint_mismatch');
  }
  try {
    if (computeDispatchPackageDigest(pkg) !== pkg.dispatch_package_digest) errors.push('dispatch_package_digest_mismatch');
  } catch (error) {
    errors.push('dispatch_package_digest_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(pkg));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeDispatchPackage(input = {}) {
  const status = DISPATCH_STATUSES.includes(input.dispatch_status) ? input.dispatch_status : 'DISPATCH_VALIDATION_FAILED';
  const pkg = {
    runtime_dispatch_package_id: input.runtime_dispatch_package_id,
    runtime_dispatch_package_version: Number.isInteger(input.runtime_dispatch_package_version) ? input.runtime_dispatch_package_version : 1,
    dispatch_status: status,
    dispatch_package_fingerprint: 'pending',
    dispatch_package_digest: 'pending',
    rollout_percentage: 0,
    ...RUNTIME_DISPATCH_PACKAGE_SAFE_FLAGS,
    validator_version: RUNTIME_DISPATCH_PACKAGE_VALIDATOR_VERSION
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

  pkg.dispatch_evaluated = true;
  pkg.dispatch_package_prepared_in_simulation = status === 'DISPATCH_PACKAGE_PREPARED_SIMULATION';
  pkg.dispatch_package_fingerprint = computeDispatchPackageFingerprint(pkg);
  pkg.dispatch_package_digest = computeDispatchPackageDigest(pkg);

  const validation = validateRuntimeDispatchPackage(pkg);
  if (!validation.valid) {
    throw new Error(`runtime_dispatch_package_construction_invalid::${JSON.stringify(validation.errors)}`);
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
  RUNTIME_DISPATCH_PACKAGE_FIELDS,
  RUNTIME_DISPATCH_PACKAGE_SAFE_FLAGS,
  RUNTIME_DISPATCH_PACKAGE_VALIDATOR_VERSION,
  UPSTREAM_FINGERPRINT_FIELDS,
  UPSTREAM_ID_FIELDS,
  buildRuntimeDispatchPackage,
  computeDispatchPackageDigest,
  computeDispatchPackageFingerprint,
  isSortedUniqueList,
  isUniqueList,
  validateRuntimeDispatchPackage
};

'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { QUEUE_PLACEMENT_STATUSES } = require('./runtime-queue-placement-decision');

// pr110: the final, immutable envelope runtime-queue-placement-boundary.js produces --
// "QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION significa somente que entradas materializadas foram
// associadas declarativamente a grupos lógicos simulados, com posição relativa dentro de cada grupo.
// Nenhuma fila ou item de fila foi criado." Every upstream fingerprint this evaluation touched -- the
// Queue Materialization Package, its own Order Reference, and every one of this layer's own
// Placement Entry/Group/Order references -- participates in the package fingerprint/digest, so
// altering any one of them alters or blocks the package.
const RUNTIME_QUEUE_PLACEMENT_PACKAGE_VALIDATOR_VERSION = 'runtime_queue_placement_package_validator_v1';

const UPSTREAM_ID_FIELDS = Object.freeze([
  'runtime_queue_placement_request_id', 'runtime_queue_materialization_package_id',
  'runtime_queue_materialization_order_reference_id', 'runtime_queue_placement_order_reference_id'
]);

const IDENTITY_FIELDS = Object.freeze(['tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id']);

const DERIVED_ID_LIST_FIELDS = Object.freeze([
  'queue_placement_entry_reference_ids', 'queue_placement_group_reference_ids', 'queue_class_reference_ids'
]);

// Genuine order matters here -- never re-sorted, mirrors runtime-queue-placement-order-reference.js's
// own `ordered_*` fields exactly (duplicated onto the package for direct top-level access).
const ORDERED_LIST_FIELDS = Object.freeze(['ordered_queue_materialization_entry_reference_ids', 'ordered_queue_placement_entry_reference_ids']);

const PARTITION_LIST_FIELDS = Object.freeze([
  'placed_queue_placement_entry_reference_ids', 'not_placed_queue_placement_entry_reference_ids'
]);

const COUNT_FIELDS = Object.freeze(['entry_count', 'placed_count', 'not_placed_count', 'group_count']);

const UPSTREAM_FINGERPRINT_FIELDS = Object.freeze([
  'runtime_queue_materialization_package_fingerprint', 'runtime_queue_materialization_package_digest',
  'runtime_queue_materialization_order_fingerprint', 'placement_order_fingerprint'
]);

const DERIVED_FINGERPRINT_LIST_FIELDS = Object.freeze([
  'queue_materialization_entry_fingerprints', 'queue_class_fingerprints',
  'placement_entry_fingerprints', 'placement_group_fingerprints'
]);

// Every capability the spec's own prohibition list names, forced permanently false.
const OPERATIONAL_FLAG_FIELDS = Object.freeze([
  'queue_placement_applied', 'queue_created', 'queue_item_created', 'queue_item_enqueued',
  'queue_item_dequeued', 'queue_position_reserved', 'broker_published', 'broker_subscribed',
  'worker_notified', 'worker_started', 'lease_created', 'lock_created', 'job_created',
  'dispatch_authorized', 'dispatch_executed', 'network_used', 'secret_resolved', 'executed'
]);

const RUNTIME_QUEUE_PLACEMENT_PACKAGE_FIELDS = Object.freeze([
  'runtime_queue_placement_package_id', 'runtime_queue_placement_package_version',
  ...UPSTREAM_ID_FIELDS,
  ...IDENTITY_FIELDS,
  ...DERIVED_ID_LIST_FIELDS,
  ...ORDERED_LIST_FIELDS,
  ...PARTITION_LIST_FIELDS,
  ...COUNT_FIELDS,
  ...UPSTREAM_FINGERPRINT_FIELDS,
  ...DERIVED_FINGERPRINT_LIST_FIELDS,
  'logical_sequence',
  'queue_placement_status',
  'queue_placement_package_fingerprint', 'queue_placement_package_digest',
  'queue_placement_evaluated', 'queue_placement_package_prepared_in_simulation',
  ...OPERATIONAL_FLAG_FIELDS,
  'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const RUNTIME_QUEUE_PLACEMENT_PACKAGE_SAFE_FLAGS = Object.freeze({
  ...Object.fromEntries(OPERATIONAL_FLAG_FIELDS.map((field) => [field, false])),
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 1000;
const MAX_COUNT = 100000;

function isUniqueList(list, maxItems = MAX_LIST_ITEMS) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString) && new Set(list).size === list.length;
}

function isSortedUniqueList(list, maxItems = MAX_LIST_ITEMS) {
  if (!isUniqueList(list, maxItems)) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeQueuePlacementPackageFingerprint(pkg) {
  const { queue_placement_package_fingerprint, queue_placement_package_digest, ...rest } = pkg;
  return stablePayload(rest);
}

function computeQueuePlacementPackageDigest(pkg) {
  const { queue_placement_package_digest, ...rest } = pkg;
  return computeCanonicalContentDigest(rest);
}

function validateRuntimeQueuePlacementPackage(pkg) {
  const errors = [];
  if (!isPlainObject(pkg)) return { valid: false, errors: ['runtime_queue_placement_package_must_be_object'] };
  exactFields(pkg, RUNTIME_QUEUE_PLACEMENT_PACKAGE_FIELDS, 'runtime_queue_placement_package', errors);
  for (const field of [
    'runtime_queue_placement_package_id', ...UPSTREAM_ID_FIELDS, ...IDENTITY_FIELDS, ...UPSTREAM_FINGERPRINT_FIELDS,
    'queue_placement_package_fingerprint', 'queue_placement_package_digest', 'validator_version'
  ]) {
    if (!isNonEmptyString(pkg[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(pkg.runtime_queue_placement_package_version) || pkg.runtime_queue_placement_package_version < 1) {
    errors.push('runtime_queue_placement_package_version_invalid');
  }
  if (!QUEUE_PLACEMENT_STATUSES.includes(pkg.queue_placement_status)) errors.push('queue_placement_status_invalid');
  for (const field of [...DERIVED_ID_LIST_FIELDS, ...DERIVED_FINGERPRINT_LIST_FIELDS, ...PARTITION_LIST_FIELDS]) {
    if (!isSortedUniqueList(pkg[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ORDERED_LIST_FIELDS) {
    if (!isUniqueList(pkg[field])) errors.push(`${field}_invalid`);
  }
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(pkg[field]) || pkg[field] < 0 || pkg[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(pkg.logical_sequence) || pkg.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (Array.isArray(pkg.ordered_queue_placement_entry_reference_ids) && Number.isInteger(pkg.entry_count) && pkg.entry_count !== pkg.ordered_queue_placement_entry_reference_ids.length) {
    errors.push('entry_count_inconsistent');
  }
  if (typeof pkg.queue_placement_package_prepared_in_simulation !== 'boolean') errors.push('queue_placement_package_prepared_in_simulation_must_be_boolean');
  else if (pkg.queue_placement_package_prepared_in_simulation !== (pkg.queue_placement_status === 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION')) {
    errors.push('queue_placement_package_prepared_in_simulation_does_not_match_status');
  }
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_PLACEMENT_PACKAGE_SAFE_FLAGS)) {
    if (pkg[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (pkg.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (pkg.validator_version !== RUNTIME_QUEUE_PLACEMENT_PACKAGE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(pkg);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeQueuePlacementPackageFingerprint(pkg) !== pkg.queue_placement_package_fingerprint) errors.push('queue_placement_package_fingerprint_mismatch');
  } catch (error) {
    errors.push('queue_placement_package_fingerprint_mismatch');
  }
  try {
    if (computeQueuePlacementPackageDigest(pkg) !== pkg.queue_placement_package_digest) errors.push('queue_placement_package_digest_mismatch');
  } catch (error) {
    errors.push('queue_placement_package_digest_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(pkg));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueuePlacementPackage(input = {}) {
  const status = QUEUE_PLACEMENT_STATUSES.includes(input.queue_placement_status) ? input.queue_placement_status : 'QUEUE_PLACEMENT_VALIDATION_FAILED';
  const pkg = {
    runtime_queue_placement_package_id: input.runtime_queue_placement_package_id,
    runtime_queue_placement_package_version: Number.isInteger(input.runtime_queue_placement_package_version) ? input.runtime_queue_placement_package_version : 1,
    queue_placement_status: status,
    queue_placement_package_fingerprint: 'pending',
    queue_placement_package_digest: 'pending',
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    rollout_percentage: 0,
    ...RUNTIME_QUEUE_PLACEMENT_PACKAGE_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_PLACEMENT_PACKAGE_VALIDATOR_VERSION
  };
  for (const field of UPSTREAM_ID_FIELDS) pkg[field] = input[field];
  for (const field of IDENTITY_FIELDS) pkg[field] = input[field];
  for (const field of UPSTREAM_FINGERPRINT_FIELDS) pkg[field] = input[field];
  for (const field of DERIVED_ID_LIST_FIELDS) pkg[field] = uniqueSorted(input[field] || []);
  for (const field of DERIVED_FINGERPRINT_LIST_FIELDS) pkg[field] = uniqueSorted(input[field] || []);
  for (const field of PARTITION_LIST_FIELDS) pkg[field] = uniqueSorted(input[field] || []);
  for (const field of ORDERED_LIST_FIELDS) pkg[field] = Array.isArray(input[field]) ? input[field] : [];
  for (const field of COUNT_FIELDS) pkg[field] = Number.isInteger(input[field]) ? input[field] : 0;

  pkg.queue_placement_evaluated = true;
  pkg.queue_placement_package_prepared_in_simulation = status === 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION';
  pkg.queue_placement_package_fingerprint = computeQueuePlacementPackageFingerprint(pkg);
  pkg.queue_placement_package_digest = computeQueuePlacementPackageDigest(pkg);

  const validation = validateRuntimeQueuePlacementPackage(pkg);
  if (!validation.valid) {
    throw new Error(`runtime_queue_placement_package_construction_invalid::${JSON.stringify(validation.errors)}`);
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
  OPERATIONAL_FLAG_FIELDS,
  ORDERED_LIST_FIELDS,
  PARTITION_LIST_FIELDS,
  RUNTIME_QUEUE_PLACEMENT_PACKAGE_FIELDS,
  RUNTIME_QUEUE_PLACEMENT_PACKAGE_SAFE_FLAGS,
  RUNTIME_QUEUE_PLACEMENT_PACKAGE_VALIDATOR_VERSION,
  UPSTREAM_FINGERPRINT_FIELDS,
  UPSTREAM_ID_FIELDS,
  buildRuntimeQueuePlacementPackage,
  computeQueuePlacementPackageDigest,
  computeQueuePlacementPackageFingerprint,
  isSortedUniqueList,
  isUniqueList,
  validateRuntimeQueuePlacementPackage
};

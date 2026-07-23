'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const ORCHESTRATOR_READINESS_VALIDATOR_VERSION = 'orchestrator_readiness_validator_v1';

const ORCHESTRATOR_READINESS_FIELDS = Object.freeze([
  'readiness_id', 'planning_result_id', 'plan_id', 'overall_ready_in_simulation', 'policy_ready', 'memory_ready',
  'preferences_ready', 'project_state_ready', 'continuity_ready', 'context_ready', 'model_ready', 'tools_ready',
  'workflow_ready', 'budget_ready', 'dependencies_ready', 'approval_ready', 'fingerprints_ready', 'versions_ready',
  'blocking_count', 'warning_count', 'critical_count', 'readiness_score', 'readiness_reason_codes',
  'readiness_evaluated', 'execution_started', 'simulation', 'production_blocked', 'validator_version'
]);

const READINESS_DOMAIN_FIELDS = Object.freeze([
  'policy_ready', 'memory_ready', 'preferences_ready', 'project_state_ready', 'continuity_ready', 'context_ready',
  'model_ready', 'tools_ready', 'workflow_ready', 'budget_ready', 'dependencies_ready', 'approval_ready',
  'fingerprints_ready', 'versions_ready'
]);

const COUNT_FIELDS = Object.freeze(['blocking_count', 'warning_count', 'critical_count']);

const ORCHESTRATOR_READINESS_SAFE_FLAGS = Object.freeze({
  readiness_evaluated: true,
  execution_started: false,
  simulation: true,
  production_blocked: true
});

const MAX_SCORE = 100;
const MAX_COUNT = 1000;
const MAX_LIST_ITEMS = 200;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateOrchestratorReadiness(readiness) {
  const errors = [];
  if (!isPlainObject(readiness)) return { valid: false, errors: ['readiness_must_be_object'] };
  exactFields(readiness, ORCHESTRATOR_READINESS_FIELDS, 'readiness', errors);
  for (const field of ['readiness_id', 'planning_result_id', 'plan_id', 'validator_version']) {
    if (!isNonEmptyString(readiness[field])) errors.push(`${field}_invalid`);
  }
  if (typeof readiness.overall_ready_in_simulation !== 'boolean') errors.push('overall_ready_in_simulation_must_be_boolean');
  for (const field of READINESS_DOMAIN_FIELDS) {
    if (typeof readiness[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(readiness[field]) || readiness[field] < 0 || readiness[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(readiness.readiness_score) || readiness.readiness_score < 0 || readiness.readiness_score > MAX_SCORE) {
    errors.push('readiness_score_invalid');
  }
  if (!isOrderedUniqueStringList(readiness.readiness_reason_codes)) errors.push('readiness_reason_codes_invalid');
  for (const [field, expected] of Object.entries(ORCHESTRATOR_READINESS_SAFE_FLAGS)) {
    if (readiness[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (readiness.blocking_count > 0 && readiness.overall_ready_in_simulation !== false) {
    errors.push('overall_ready_in_simulation_must_be_false_when_blocking_count_positive');
  }
  if (readiness.critical_count > 0 && readiness.overall_ready_in_simulation !== false) {
    errors.push('overall_ready_in_simulation_must_be_false_when_critical_count_positive');
  }
  if (
    readiness.overall_ready_in_simulation === true &&
    !READINESS_DOMAIN_FIELDS.every((field) => readiness[field] === true)
  ) {
    errors.push('overall_ready_in_simulation_requires_every_domain_ready');
  }

  if (readiness.validator_version !== ORCHESTRATOR_READINESS_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(readiness);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(readiness));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

// Deterministic, floatless, non-random: 100 minus a fixed integer penalty per not-ready
// domain and per warning, floored at 0. Purely diagnostic -- callers must never use this
// score to override a domain readiness flag or a blocking blocker (validated above).
function computeReadinessScore(domainReadyMap, warningCount) {
  const notReadyCount = READINESS_DOMAIN_FIELDS.filter((field) => domainReadyMap[field] !== true).length;
  const penalty = notReadyCount * 10 + Math.min(Number.isInteger(warningCount) ? warningCount : 0, 10) * 2;
  return Math.max(0, MAX_SCORE - penalty);
}

function buildOrchestratorReadiness(overrides = {}) {
  const domainReady = {};
  for (const field of READINESS_DOMAIN_FIELDS) domainReady[field] = overrides[field] === true;
  const blockingCount = Number.isInteger(overrides.blocking_count) ? overrides.blocking_count : 0;
  const criticalCount = Number.isInteger(overrides.critical_count) ? overrides.critical_count : 0;
  const warningCount = Number.isInteger(overrides.warning_count) ? overrides.warning_count : 0;
  const allDomainsReady = READINESS_DOMAIN_FIELDS.every((field) => domainReady[field] === true);
  const overallReady = allDomainsReady && blockingCount === 0 && criticalCount === 0;

  const readiness = {
    readiness_id: overrides.readiness_id || 'readiness_not_available',
    planning_result_id: overrides.planning_result_id || 'planning_result_not_available',
    plan_id: overrides.plan_id || 'plan_not_available',
    overall_ready_in_simulation: overallReady,
    ...domainReady,
    blocking_count: blockingCount,
    warning_count: warningCount,
    critical_count: criticalCount,
    readiness_score: computeReadinessScore(domainReady, warningCount),
    readiness_reason_codes: Array.isArray(overrides.readiness_reason_codes) ? uniqueSorted(overrides.readiness_reason_codes) : [],
    validator_version: ORCHESTRATOR_READINESS_VALIDATOR_VERSION,
    ...ORCHESTRATOR_READINESS_SAFE_FLAGS
  };

  const validation = validateOrchestratorReadiness(readiness);
  if (!validation.valid) {
    throw new Error(`orchestrator_readiness_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(readiness);
}

module.exports = {
  COUNT_FIELDS,
  MAX_COUNT,
  MAX_SCORE,
  ORCHESTRATOR_READINESS_FIELDS,
  ORCHESTRATOR_READINESS_SAFE_FLAGS,
  ORCHESTRATOR_READINESS_VALIDATOR_VERSION,
  READINESS_DOMAIN_FIELDS,
  buildOrchestratorReadiness,
  computeReadinessScore,
  validateOrchestratorReadiness
};

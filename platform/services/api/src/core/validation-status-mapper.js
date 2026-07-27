'use strict';

const { TAXONOMY_STATUSES, isTaxonomyStatus } = require('./validation-taxonomy');

// Bridges the single official taxonomy (validation-taxonomy.js, 24 statuses) to the two external
// vocabularies that predate it: ExecutionPlanContract's own EXECUTION_PLAN_STATUSES and
// ExecutionPlanResult's own RESULT_STATUSES. "Padronizar a camada de orchestration dos validators
// sem obrigar reescrita total dos contratos anteriores" -- neither contract's own enum is forced
// to become byte-identical to the taxonomy; this module is the one place that reconciles them.
const UNKNOWN_STATUS_BLOCKED = 'UNKNOWN_STATUS_BLOCKED';

// pr101 fix: EXECUTION_PLAN_PREPARED_SIMULATION and BINDING_BLOCKED are both genuine, already-
// producible taxonomy statuses that execution-plan-engine.js has passed as `status` since PR #96/
// PR #98 respectively -- but EXECUTION_PLAN_STATUSES never actually contained either literal
// string (it had 'PREPARED_SIMULATION' instead, and no BINDING_BLOCKED entry at all), so
// buildExecutionPlanContract silently downgraded both to VALIDATION_FAILED at construction time.
// This was the exact "Status colapsados" defect this PR exists to fix -- see
// HERMES_VALIDATION_SEMANTICS_ARCHITECTURE_GATES.md. Both are now added to EXECUTION_PLAN_STATUSES
// (execution-plan-contract.js); this mapper's CONTRACT table below is therefore the identity
// mapping for both, same as everywhere else -- 'PREPARED_SIMULATION' remains in
// EXECUTION_PLAN_STATUSES only as an inert legacy entry, never produced by this mapper.
//
// MEMORY_BLOCKED/CONTEXT_BLOCKED/MODEL_BLOCKED/TOOL_BLOCKED/WORKFLOW_BLOCKED are a separate,
// pre-existing, *intentionally* documented asymmetry (see PR #100's own test
// "a hard decision=BLOCKED on memory/context/model/tool/workflow references surfaces on the plan
// contract with its own dedicated status, while the outer result collapses to VALIDATION_FAILED")
// -- none of the five are part of the official 24-status taxonomy this mapper covers, so they are
// deliberately out of this module's scope and are left exactly as PR #96-#100 shipped them.
const CONTRACT_STATUS_OVERRIDES = Object.freeze({});
const RESULT_STATUS_OVERRIDES = Object.freeze({});

function mapTaxonomyStatusToContractStatus(status, contractStatuses) {
  if (!isTaxonomyStatus(status)) return contractStatuses.includes(UNKNOWN_STATUS_BLOCKED) ? UNKNOWN_STATUS_BLOCKED : 'VALIDATION_FAILED';
  const mapped = CONTRACT_STATUS_OVERRIDES[status] || status;
  if (!contractStatuses.includes(mapped)) return 'VALIDATION_FAILED';
  return mapped;
}

function mapTaxonomyStatusToResultStatus(status, resultStatuses) {
  if (!isTaxonomyStatus(status)) return resultStatuses.includes(UNKNOWN_STATUS_BLOCKED) ? UNKNOWN_STATUS_BLOCKED : 'VALIDATION_FAILED';
  const mapped = RESULT_STATUS_OVERRIDES[status] || status;
  if (!resultStatuses.includes(mapped)) return 'VALIDATION_FAILED';
  return mapped;
}

// Documents, for every one of the 24 official taxonomy statuses, exactly what each external
// vocabulary maps it to and whether that mapping is the identity mapping or an explicit override
// -- used by the taxonomy/status-coverage test suite to assert no status silently collapses
// without a recorded reason.
function describeStatusMapping(status, contractStatuses, resultStatuses) {
  return {
    taxonomyStatus: status,
    contractStatus: mapTaxonomyStatusToContractStatus(status, contractStatuses),
    resultStatus: mapTaxonomyStatusToResultStatus(status, resultStatuses),
    isIdentityToContract: !CONTRACT_STATUS_OVERRIDES[status],
    isIdentityToResult: !RESULT_STATUS_OVERRIDES[status]
  };
}

module.exports = {
  CONTRACT_STATUS_OVERRIDES,
  RESULT_STATUS_OVERRIDES,
  TAXONOMY_STATUSES,
  UNKNOWN_STATUS_BLOCKED,
  describeStatusMapping,
  mapTaxonomyStatusToContractStatus,
  mapTaxonomyStatusToResultStatus
};

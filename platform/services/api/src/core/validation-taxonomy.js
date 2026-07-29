'use strict';

// The official, single-source-of-truth taxonomy for every status the Execution Plan pipeline
// (execution-plan-engine.js, PR #94-#100) can produce. Authorization Boundary's own status
// vocabulary (ACTOR_BLOCKED, ROLE_BLOCKED, SCOPE_BLOCKED, RISK_BLOCKED, APPROVAL_BLOCKED,
// EXPIRED_AUTHORIZATION, DENY, PLAN_BLOCKED, UNKNOWN_STATUS_BLOCKED, ...) is a separate, smaller
// vocabulary scoped to AUTHORIZATION_STATUSES in execution-authorization-decision.js -- it is not
// duplicated here, since this PR's own instruction is "não ampliar escopo excessivamente."
//
// pr102: the Execution Gateway Boundary Simulation has its own separate, self-contained 29-status
// taxonomy (GATEWAY_STATUSES/STATUS_OUTCOME_MAP/GATEWAY_PRECEDENCE_ORDER in
// execution-gateway-decision.js), for the same reason -- extending VALIDATION_STAGES itself would
// require modifying validation-outcome.js, which is outside this PR's own stated scope, and the
// spec explicitly permits "uma taxonomy própria" for gateway-specific stages that have no
// equivalent among the 22 Execution Plan stages (POLICY, PACKAGE_REFERENCE, PACKAGE_DIGEST,
// FRESHNESS, REPLAY, ...). Not merged into this module.
//
// pr103: the Runtime Execution Simulation Contracts layer has its own separate, self-contained
// 24-status taxonomy (RUNTIME_EXECUTION_SIMULATION_STATUSES/STATUS_OUTCOME_MAP/
// RUNTIME_PRECEDENCE_ORDER in runtime-execution-simulation-decision.js), for the identical reason
// PR #102's own Gateway taxonomy was kept separate one layer below -- RUNTIME_STAGE_MANIFEST_
// BLOCKED/RUNTIME_BUDGET_BLOCKED/RUNTIME_ARTIFACT_PLAN_BLOCKED/... have no equivalent among either
// the 22 Execution Plan stages or the Gateway's own 29 statuses. Not merged into this module.
//
// Two distinct "orders" are captured deliberately as two distinct fields, never conflated:
// - `declarationOrder`: the order this PR's own spec lists the 24 statuses in.
// - `precedence`: the real order execution-plan-engine.js actually evaluates gates in, documented
//   across the PR #99/#100 doc "Precedência" sections. Several statuses in this taxonomy are
//   genuinely cross-cutting (FINGERPRINT_BLOCKED, VERSION_BLOCKED, CONFLICT_BLOCKED can each occur
//   at more than one point in the real pipeline); `precedence` records the position they occupy
//   *the first time they can occur*, and `stage` records the ValidationStage they are most
//   strongly associated with -- both are documented judgment calls where the real engine's
//   behavior is not perfectly linear, not an attempt to force a single stage/position onto an
//   inherently cross-cutting status.

const TAXONOMY_STATUSES = Object.freeze([
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED',
  'TASK_BLOCKED', 'AUTHORIZATION_BLOCKED', 'AUTHORIZATION_PROVENANCE_BLOCKED', 'AUTHORIZATION_SCOPE_BLOCKED',
  'REGISTRY_SNAPSHOT_BLOCKED', 'EVIDENCE_BLOCKED', 'STAGE_MANIFEST_BLOCKED', 'DEPENDENCY_BLOCKED',
  'REFERENCE_BINDING_BLOCKED', 'BINDING_BLOCKED', 'BUDGET_BLOCKED', 'IDEMPOTENCY_BLOCKED',
  'STOP_CONDITION_BLOCKED', 'COMPENSATION_BLOCKED', 'FINGERPRINT_BLOCKED', 'VERSION_BLOCKED',
  'CONFLICT_BLOCKED', 'WAITING_APPROVAL_REFERENCE', 'EXECUTION_PLAN_PREPARED_SIMULATION'
]);

// The real order execution-plan-engine.js evaluates gates in (PR #100's own documented
// precedence, extended by PR #101's stage vocabulary). This is what `first_blocking_stage`/
// `first_blocking_status` on a ValidationLedger are actually computed against.
const PRECEDENCE_ORDER = Object.freeze([
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED',
  'TASK_BLOCKED', 'AUTHORIZATION_BLOCKED', 'AUTHORIZATION_PROVENANCE_BLOCKED', 'AUTHORIZATION_SCOPE_BLOCKED',
  'REGISTRY_SNAPSHOT_BLOCKED', 'EVIDENCE_BLOCKED', 'STAGE_MANIFEST_BLOCKED', 'FINGERPRINT_BLOCKED',
  'VERSION_BLOCKED', 'CONFLICT_BLOCKED', 'DEPENDENCY_BLOCKED', 'REFERENCE_BINDING_BLOCKED', 'BINDING_BLOCKED',
  'BUDGET_BLOCKED', 'IDEMPOTENCY_BLOCKED', 'STOP_CONDITION_BLOCKED', 'COMPENSATION_BLOCKED',
  'WAITING_APPROVAL_REFERENCE', 'EXECUTION_PLAN_PREPARED_SIMULATION'
]);

// Every taxonomy status's canonical metadata: which ValidationStage it belongs to, its default
// severity, whether it represents a blocking failure (state=INVALID) versus a non-error stop
// (WAITING_APPROVAL_REFERENCE) or a successful completion (EXECUTION_PLAN_PREPARED_SIMULATION),
// and whether reaching it ends the pipeline (every status here does -- there is no taxonomy status
// that lets the pipeline continue past it, by definition of being in this list at all).
const TAXONOMY_METADATA = Object.freeze({
  VALIDATION_FAILED: { stage: 'SCHEMA', severity: 'CRITICAL', blocking: true },
  TENANT_BLOCKED: { stage: 'TENANT', severity: 'CRITICAL', blocking: true },
  ORGANIZATION_BLOCKED: { stage: 'ORGANIZATION', severity: 'CRITICAL', blocking: true },
  PROJECT_BLOCKED: { stage: 'PROJECT', severity: 'ERROR', blocking: true },
  SESSION_BLOCKED: { stage: 'SESSION', severity: 'ERROR', blocking: true },
  TASK_BLOCKED: { stage: 'TASK', severity: 'ERROR', blocking: true },
  AUTHORIZATION_BLOCKED: { stage: 'AUTHORIZATION', severity: 'CRITICAL', blocking: true },
  AUTHORIZATION_PROVENANCE_BLOCKED: { stage: 'AUTHORIZATION_PROVENANCE', severity: 'CRITICAL', blocking: true },
  AUTHORIZATION_SCOPE_BLOCKED: { stage: 'AUTHORIZATION_SCOPE', severity: 'CRITICAL', blocking: true },
  REGISTRY_SNAPSHOT_BLOCKED: { stage: 'REGISTRY_SNAPSHOT', severity: 'ERROR', blocking: true },
  EVIDENCE_BLOCKED: { stage: 'EVIDENCE', severity: 'ERROR', blocking: true },
  STAGE_MANIFEST_BLOCKED: { stage: 'STAGE_MANIFEST', severity: 'ERROR', blocking: true },
  DEPENDENCY_BLOCKED: { stage: 'DEPENDENCY_GRAPH', severity: 'ERROR', blocking: true },
  REFERENCE_BINDING_BLOCKED: { stage: 'REFERENCE_BINDING', severity: 'ERROR', blocking: true },
  BINDING_BLOCKED: { stage: 'REFERENCE_BINDING', severity: 'ERROR', blocking: true },
  BUDGET_BLOCKED: { stage: 'BUDGET', severity: 'ERROR', blocking: true },
  IDEMPOTENCY_BLOCKED: { stage: 'IDEMPOTENCY', severity: 'ERROR', blocking: true },
  STOP_CONDITION_BLOCKED: { stage: 'STOP_CONDITIONS', severity: 'ERROR', blocking: true },
  COMPENSATION_BLOCKED: { stage: 'COMPENSATIONS', severity: 'ERROR', blocking: true },
  FINGERPRINT_BLOCKED: { stage: 'PACKAGE_INTEGRITY', severity: 'CRITICAL', blocking: true },
  VERSION_BLOCKED: { stage: 'REGISTRY_SNAPSHOT', severity: 'ERROR', blocking: true },
  CONFLICT_BLOCKED: { stage: 'REFERENCE_BINDING', severity: 'ERROR', blocking: true },
  WAITING_APPROVAL_REFERENCE: { stage: 'FINALIZATION', severity: 'WARNING', blocking: false },
  EXECUTION_PLAN_PREPARED_SIMULATION: { stage: 'FINALIZATION', severity: 'INFO', blocking: false }
});

// No taxonomy status has ever been renamed since this taxonomy was formalized in PR #101 -- the
// mechanism is documented and ready, but the map is honestly empty rather than inventing a rename
// that never happened. A future PR that renames a status adds an entry here mapping the old name
// to the new one, and validation-status-mapper.js resolves aliases before taxonomy lookup.
const LEGACY_STATUS_ALIASES = Object.freeze({});

function isTaxonomyStatus(status) {
  return typeof status === 'string' && TAXONOMY_STATUSES.includes(status);
}

function resolveStatusAlias(status) {
  return LEGACY_STATUS_ALIASES[status] || status;
}

function getTaxonomyMetadata(status) {
  const resolved = resolveStatusAlias(status);
  if (!isTaxonomyStatus(resolved)) return null;
  return { status: resolved, ...TAXONOMY_METADATA[resolved] };
}

function getPrecedenceIndex(status) {
  const resolved = resolveStatusAlias(status);
  const index = PRECEDENCE_ORDER.indexOf(resolved);
  return index === -1 ? null : index;
}

module.exports = {
  LEGACY_STATUS_ALIASES,
  PRECEDENCE_ORDER,
  TAXONOMY_METADATA,
  TAXONOMY_STATUSES,
  getPrecedenceIndex,
  getTaxonomyMetadata,
  isTaxonomyStatus,
  resolveStatusAlias
};

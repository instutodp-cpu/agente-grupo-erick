'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { validateRuntimeExecutionSimulationRequest } = require('./runtime-execution-simulation-request');
const {
  RUNTIME_EXECUTION_SIMULATION_STATUSES, buildRuntimeExecutionSimulationDecision
} = require('./runtime-execution-simulation-decision');
const { buildRuntimeExecutionSimulationResult } = require('./runtime-execution-simulation-result');
const { buildRuntimeExecutionSimulationAudit } = require('./runtime-execution-simulation-audit');

// pr103: the Runtime Execution Package -- a compact, self-contained summary (ids, fingerprints,
// a package digest) of an entire prepared Runtime Execution Simulation, never embedding any of
// the referenced objects' own full content. Mirrors execution-gateway-package-reference.js's own
// role one layer up: never trusted on its own, always recomputed/cross-checked by
// evaluateRuntimeExecutionSimulationRequest before being accepted.
//
// pr104: RUNTIME_PACKAGE_PREPARED_SIMULATION (this module's own terminal status) is a distinct,
// separate concept from RUNTIME_READY_SIMULATION and RUNTIME_ADMITTED_SIMULATION -- see
// runtime-admission-boundary.js's own two-phase evaluator, which independently re-derives every
// cross-check this module performs (never trusting a previously-prepared package's own self-
// fingerprint) before ever considering readiness or admission. `checkIdentity` and
// `computeRuntimePackageDigest` are reused verbatim by that boundary, not reimplemented.
const RUNTIME_EXECUTION_PACKAGE_VALIDATOR_VERSION = 'runtime_execution_package_validator_v1';

const RUNTIME_EXECUTION_PACKAGE_FIELDS = Object.freeze([
  'runtime_execution_package_id', 'runtime_execution_package_version', 'runtime_request_id', 'gateway_decision_id',
  'gateway_result_id', 'gateway_package_reference_id', 'execution_plan_id', 'execution_plan_result_id',
  'stage_manifest_reference_id', 'dependency_graph_reference_id', 'binding_ledger_id', 'validation_ledger_id',
  'authorization_provenance_reference_id', 'authorization_scope_reference_id', 'registry_snapshot_reference_id',
  'runtime_stage_manifest_id', 'runtime_dependency_manifest_id', 'runtime_budget_reference_id',
  'runtime_stop_reference_ids', 'runtime_compensation_reference_ids', 'runtime_artifact_plan_reference_id',
  'runtime_event_plan_reference_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id',
  'agent_id', 'actor_id', 'runtime_status', 'ordered_runtime_stage_ids', 'runtime_dependency_ids',
  'gateway_decision_fingerprint', 'gateway_result_fingerprint', 'gateway_package_fingerprint',
  'execution_plan_fingerprint', 'stage_manifest_fingerprint', 'dependency_graph_fingerprint',
  'binding_ledger_fingerprint', 'validation_ledger_fingerprint', 'runtime_stage_manifest_fingerprint',
  'runtime_dependency_manifest_fingerprint', 'runtime_budget_fingerprint', 'runtime_stop_fingerprints',
  'runtime_compensation_fingerprints', 'runtime_artifact_plan_fingerprint', 'runtime_event_plan_fingerprint',
  'estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens',
  'estimated_total_cost_minor_units', 'package_fingerprint', 'package_digest', 'runtime_package_prepared_in_simulation',
  'runtime_admitted_in_simulation', 'runtime_enabled', 'execution_authorized', 'execution_started', 'stage_started',
  'stage_completed', 'executed', 'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const ID_FIELDS = Object.freeze([
  'runtime_request_id', 'gateway_decision_id', 'gateway_result_id', 'gateway_package_reference_id',
  'execution_plan_id', 'execution_plan_result_id', 'stage_manifest_reference_id', 'dependency_graph_reference_id',
  'binding_ledger_id', 'validation_ledger_id', 'authorization_provenance_reference_id',
  'authorization_scope_reference_id', 'registry_snapshot_reference_id', 'runtime_stage_manifest_id',
  'runtime_dependency_manifest_id', 'runtime_budget_reference_id', 'runtime_artifact_plan_reference_id',
  'runtime_event_plan_reference_id'
]);

const FINGERPRINT_FIELDS = Object.freeze([
  'gateway_decision_fingerprint', 'gateway_result_fingerprint', 'gateway_package_fingerprint',
  'execution_plan_fingerprint', 'stage_manifest_fingerprint', 'dependency_graph_fingerprint',
  'binding_ledger_fingerprint', 'validation_ledger_fingerprint', 'runtime_stage_manifest_fingerprint',
  'runtime_dependency_manifest_fingerprint', 'runtime_budget_fingerprint', 'runtime_artifact_plan_fingerprint',
  'runtime_event_plan_fingerprint'
]);

const RUNTIME_EXECUTION_PACKAGE_SAFE_FLAGS = Object.freeze({
  runtime_admitted_in_simulation: false,
  runtime_enabled: false,
  execution_authorized: false,
  execution_started: false,
  stage_started: false,
  stage_completed: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 200;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateRuntimeExecutionPackage(pkg) {
  const errors = [];
  if (!isPlainObject(pkg)) return { valid: false, errors: ['runtime_execution_package_must_be_object'] };
  exactFields(pkg, RUNTIME_EXECUTION_PACKAGE_FIELDS, 'runtime_execution_package', errors);
  for (const field of [
    'runtime_execution_package_id', ...ID_FIELDS, 'tenant_id', 'organization_id', 'project_id',
    'session_reference_id', 'agent_id', 'actor_id', ...FINGERPRINT_FIELDS, 'package_fingerprint', 'package_digest',
    'validator_version'
  ]) {
    if (!isNonEmptyString(pkg[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(pkg.runtime_execution_package_version) || pkg.runtime_execution_package_version < 1) {
    errors.push('runtime_execution_package_version_invalid');
  }
  if (!isOrderedUniqueStringList(pkg.runtime_stop_reference_ids)) errors.push('runtime_stop_reference_ids_invalid');
  if (!isOrderedUniqueStringList(pkg.runtime_compensation_reference_ids)) errors.push('runtime_compensation_reference_ids_invalid');
  if (!Array.isArray(pkg.runtime_stop_fingerprints) || !pkg.runtime_stop_fingerprints.every(isNonEmptyString) || pkg.runtime_stop_fingerprints.length > MAX_LIST_ITEMS) {
    errors.push('runtime_stop_fingerprints_invalid');
  }
  if (!Array.isArray(pkg.runtime_compensation_fingerprints) || !pkg.runtime_compensation_fingerprints.every(isNonEmptyString) || pkg.runtime_compensation_fingerprints.length > MAX_LIST_ITEMS) {
    errors.push('runtime_compensation_fingerprints_invalid');
  }
  if (!Array.isArray(pkg.ordered_runtime_stage_ids) || !pkg.ordered_runtime_stage_ids.every(isNonEmptyString) || pkg.ordered_runtime_stage_ids.length > MAX_LIST_ITEMS) {
    errors.push('ordered_runtime_stage_ids_invalid');
  }
  if (!isOrderedUniqueStringList(pkg.runtime_dependency_ids)) errors.push('runtime_dependency_ids_invalid');
  if (!RUNTIME_EXECUTION_SIMULATION_STATUSES.includes(pkg.runtime_status)) errors.push('runtime_status_invalid');
  for (const field of ['estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens', 'estimated_total_cost_minor_units']) {
    if (!Number.isInteger(pkg[field]) || pkg[field] < 0) errors.push(`${field}_invalid`);
  }
  if (typeof pkg.runtime_package_prepared_in_simulation !== 'boolean') errors.push('runtime_package_prepared_in_simulation_must_be_boolean');
  const expectedPrepared = pkg.runtime_status === 'RUNTIME_PACKAGE_PREPARED_SIMULATION';
  if (pkg.runtime_package_prepared_in_simulation !== expectedPrepared) errors.push('runtime_package_prepared_in_simulation_does_not_match_status');
  for (const [field, expected] of Object.entries(RUNTIME_EXECUTION_PACKAGE_SAFE_FLAGS)) {
    if (pkg[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (pkg.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (pkg.validator_version !== RUNTIME_EXECUTION_PACKAGE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(pkg);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(pkg));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeExecutionPackage(input = {}) {
  const pkg = {
    runtime_execution_package_id: input.runtime_execution_package_id,
    runtime_execution_package_version: Number.isInteger(input.runtime_execution_package_version) ? input.runtime_execution_package_version : 1,
    runtime_request_id: input.runtime_request_id,
    gateway_decision_id: input.gateway_decision_id,
    gateway_result_id: input.gateway_result_id,
    gateway_package_reference_id: input.gateway_package_reference_id,
    execution_plan_id: input.execution_plan_id,
    execution_plan_result_id: input.execution_plan_result_id,
    stage_manifest_reference_id: input.stage_manifest_reference_id,
    dependency_graph_reference_id: input.dependency_graph_reference_id,
    binding_ledger_id: input.binding_ledger_id,
    validation_ledger_id: input.validation_ledger_id,
    authorization_provenance_reference_id: input.authorization_provenance_reference_id,
    authorization_scope_reference_id: input.authorization_scope_reference_id,
    registry_snapshot_reference_id: input.registry_snapshot_reference_id,
    runtime_stage_manifest_id: input.runtime_stage_manifest_id,
    runtime_dependency_manifest_id: input.runtime_dependency_manifest_id,
    runtime_budget_reference_id: input.runtime_budget_reference_id,
    runtime_stop_reference_ids: Array.isArray(input.runtime_stop_reference_ids) ? uniqueSorted(input.runtime_stop_reference_ids) : [],
    runtime_compensation_reference_ids: Array.isArray(input.runtime_compensation_reference_ids) ? uniqueSorted(input.runtime_compensation_reference_ids) : [],
    runtime_artifact_plan_reference_id: input.runtime_artifact_plan_reference_id,
    runtime_event_plan_reference_id: input.runtime_event_plan_reference_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    actor_id: input.actor_id,
    runtime_status: input.runtime_status,
    ordered_runtime_stage_ids: Array.isArray(input.ordered_runtime_stage_ids) ? input.ordered_runtime_stage_ids : [],
    runtime_dependency_ids: Array.isArray(input.runtime_dependency_ids) ? uniqueSorted(input.runtime_dependency_ids) : [],
    gateway_decision_fingerprint: input.gateway_decision_fingerprint,
    gateway_result_fingerprint: input.gateway_result_fingerprint,
    gateway_package_fingerprint: input.gateway_package_fingerprint,
    execution_plan_fingerprint: input.execution_plan_fingerprint,
    stage_manifest_fingerprint: input.stage_manifest_fingerprint,
    dependency_graph_fingerprint: input.dependency_graph_fingerprint,
    binding_ledger_fingerprint: input.binding_ledger_fingerprint,
    validation_ledger_fingerprint: input.validation_ledger_fingerprint,
    runtime_stage_manifest_fingerprint: input.runtime_stage_manifest_fingerprint,
    runtime_dependency_manifest_fingerprint: input.runtime_dependency_manifest_fingerprint,
    runtime_budget_fingerprint: input.runtime_budget_fingerprint,
    runtime_stop_fingerprints: Array.isArray(input.runtime_stop_fingerprints) ? input.runtime_stop_fingerprints : [],
    runtime_compensation_fingerprints: Array.isArray(input.runtime_compensation_fingerprints) ? input.runtime_compensation_fingerprints : [],
    runtime_artifact_plan_fingerprint: input.runtime_artifact_plan_fingerprint,
    runtime_event_plan_fingerprint: input.runtime_event_plan_fingerprint,
    estimated_input_tokens: Number.isInteger(input.estimated_input_tokens) ? input.estimated_input_tokens : 0,
    estimated_output_tokens: Number.isInteger(input.estimated_output_tokens) ? input.estimated_output_tokens : 0,
    estimated_total_tokens: Number.isInteger(input.estimated_total_tokens) ? input.estimated_total_tokens : 0,
    estimated_total_cost_minor_units: Number.isInteger(input.estimated_total_cost_minor_units) ? input.estimated_total_cost_minor_units : 0,
    package_fingerprint: input.package_fingerprint,
    package_digest: input.package_digest,
    runtime_package_prepared_in_simulation: input.runtime_status === 'RUNTIME_PACKAGE_PREPARED_SIMULATION',
    ...RUNTIME_EXECUTION_PACKAGE_SAFE_FLAGS,
    rollout_percentage: 0,
    validator_version: RUNTIME_EXECUTION_PACKAGE_VALIDATOR_VERSION
  };

  const validation = validateRuntimeExecutionPackage(pkg);
  if (!validation.valid) {
    throw new Error(`runtime_execution_package_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(pkg);
}

// The exact canonical bundle shape used both to compute a package_digest at construction time and
// to recompute-and-compare it here -- key order never matters (stablePayload sorts), but the key
// *set* must always match exactly. Covers, at minimum, every object "Package Fingerprint" in the
// spec requires: gateway decision/result/package, execution plan, stage manifest, dependency
// graph, binding ledger, validation ledger, runtime stage/dependency manifests, runtime budget,
// stops, compensations, artifact plan, event plan, ordered stages, dependency ids, estimates, and
// identities.
function computeRuntimePackageDigest({
  gatewayDecision, gatewayResult, gatewayPackageRef, plan, result, stageManifestRef, dependencyGraphRef,
  bindingLedger, validationLedger, runtimeStageManifest, runtimeDependencyManifest, runtimeBudgetRef,
  executionBudgetReference, runtimeStopRefs, runtimeCompensationRefs, runtimeArtifactPlan, runtimeEventPlan,
  orderedRuntimeStageIds, runtimeDependencyIds, estimates, canonical
}) {
  return computeCanonicalContentDigest({
    gatewayDecision, gatewayResult, gatewayPackageRef, plan, result, stageManifestRef, dependencyGraphRef,
    bindingLedger, validationLedger, runtimeStageManifest, runtimeDependencyManifest, runtimeBudgetRef,
    executionBudgetReference, runtimeStopRefs, runtimeCompensationRefs, runtimeArtifactPlan, runtimeEventPlan,
    orderedRuntimeStageIds, runtimeDependencyIds, estimates, canonical
  });
}

// pr103fix: a comprehensive, pure 1:1 comparison between a RuntimeStageSimulationReference and
// the real StageRecord it claims to materialize -- the original version of this check compared
// only a subset of fields, meaning a Runtime Stage Manifest with a validly self-recomputed
// fingerprint could still silently diverge from its source on memory/context/capabilities/
// modalities/dependencies/total-tokens and still pass ("um self-fingerprint válido não substitui
// o cross-check 1:1"). Returns the name of the first mismatched field, or null if every field
// agrees. Array fields are semantically unordered sets, canonicalized (sorted) before comparison;
// stage *order* itself (stage_sequence, and each stage's position in both manifests) remains
// semantically significant and is never canonicalized away.
const RUNTIME_STAGE_SCALAR_FIELDS = Object.freeze([
  'stage_sequence', 'stage_type', 'task_reference_id', 'agent_reference_id', 'memory_selection_reference_id',
  'context_assembly_reference_id', 'model_selection_reference_id', 'workflow_reference_id', 'priority',
  'parallelizable', 'optional', 'approval_required', 'estimated_input_tokens', 'estimated_output_tokens',
  'estimated_total_tokens', 'estimated_cost_minor_units'
]);
const RUNTIME_STAGE_ARRAY_FIELDS = Object.freeze(['tool_reference_ids', 'dependency_reference_ids', 'required_capabilities', 'required_modalities']);

function canonicalArray(list) {
  return Array.isArray(list) ? [...list].sort() : [];
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function compareRuntimeStageToSourceStage(runtimeStage, sourceStage) {
  if (!isPlainObject(runtimeStage) || !isPlainObject(sourceStage)) return 'runtime_stage_missing';
  if (runtimeStage.source_orchestrator_stage_id !== sourceStage.stage_id) return 'source_orchestrator_stage_id';
  for (const field of RUNTIME_STAGE_SCALAR_FIELDS) {
    if (runtimeStage[field] !== sourceStage[field]) return field;
  }
  for (const field of RUNTIME_STAGE_ARRAY_FIELDS) {
    if (!arraysEqual(canonicalArray(runtimeStage[field]), canonicalArray(sourceStage[field]))) return field;
  }
  return null;
}

// The derived fields a RuntimeStageSimulationReference carries that no single StageRecord field
// maps to directly -- cross-validated against the real official sources this same request already
// carries, never trusted merely because the reference's own self-fingerprint recomputed cleanly.
function validateRuntimeStageDerivedFields(stage, { record, bindingLedger, runtimeStopRefs, runtimeCompensationRefs, scopeRef }) {
  const expectedBindingIds = (bindingLedger.binding_records || [])
    .filter((binding) => binding.execution_stage_id === record.stage_id)
    .map((binding) => binding.binding_record_id)
    .sort();
  if (!arraysEqual(canonicalArray(stage.binding_reference_ids), expectedBindingIds)) return 'binding_reference_ids';

  const expectedStopIds = runtimeStopRefs
    .filter((stop) => stop.runtime_stage_reference_id === stage.runtime_stage_reference_id)
    .map((stop) => stop.runtime_stop_reference_id)
    .sort();
  if (!arraysEqual(canonicalArray(stage.stop_reference_ids), expectedStopIds)) return 'stop_reference_ids';

  const expectedCompensationIds = runtimeCompensationRefs
    .filter((compensation) => compensation.runtime_stage_reference_id === stage.runtime_stage_reference_id)
    .map((compensation) => compensation.runtime_compensation_reference_id)
    .sort();
  if (!arraysEqual(canonicalArray(stage.compensation_reference_ids), expectedCompensationIds)) return 'compensation_reference_ids';

  // side_effect_classification: the only independently-derivable signal available at this layer
  // (task_reference itself is never propagated past the Gateway -- see docs "Limitações") is
  // whether a real, state-change-worthy compensation is bound to this stage, mirroring
  // execution-plan-engine.js's own deriveSideEffectClassification for that one branch. A stage can
  // never declare NONE while a required/real compensation contradicts it -- hiding a real state
  // change behind a false NONE claim is exactly the class of tamper this cross-check exists to
  // catch. The reverse (declaring STATE_CHANGE_REFERENCE ahead of its compensation) is already
  // caught unambiguously at the dedicated compensation-coverage check below, with its own, more
  // specific RUNTIME_COMPENSATION_BLOCKED reason -- never duplicated here.
  const hasStateChangeEvidence = runtimeCompensationRefs.some((compensation) => (
    compensation.runtime_stage_reference_id === stage.runtime_stage_reference_id
    && (compensation.required === true || compensation.compensation_type !== 'NONE')
  ));
  if (hasStateChangeEvidence && stage.side_effect_classification === 'NONE') return 'side_effect_classification';

  // risk_classification: cross-checked against the real AuthorizationScopeReference's own
  // allowed_risk_classifications -- the one genuine source of truth for risk available at this
  // layer (task_reference.risk_classification itself is never propagated past the Gateway either;
  // see docs "Limitações").
  if (
    Array.isArray(scopeRef.allowed_risk_classifications) && scopeRef.allowed_risk_classifications.length > 0
    && !scopeRef.allowed_risk_classifications.includes(stage.risk_classification)
  ) {
    return 'risk_classification';
  }

  return null;
}

// Mirrors execution-gateway-boundary.js's own checkIdentity exactly: tenant/organization always
// checked when the reference carries the field; project/session/agent/actor only checked when the
// specific reference actually carries the corresponding field (several references here, like
// RuntimeBudgetSimulationReference/RuntimeStopSimulationReference, carry none of them at all, by
// design -- they are not tenant-scoped objects).
function checkIdentity(reference, canonical, label) {
  if (!isPlainObject(reference)) return null;
  if (reference.tenant_id !== undefined && reference.tenant_id !== canonical.tenantId) {
    return { status: 'TENANT_BLOCKED', reason: `${label}_tenant_mismatch` };
  }
  if (reference.organization_id !== undefined && reference.organization_id !== canonical.organizationId) {
    return { status: 'ORGANIZATION_BLOCKED', reason: `${label}_organization_mismatch` };
  }
  if (reference.project_id !== undefined && reference.project_id !== canonical.projectId) {
    return { status: 'PROJECT_BLOCKED', reason: `${label}_project_mismatch` };
  }
  if (reference.session_reference_id !== undefined && reference.session_reference_id !== canonical.sessionId) {
    return { status: 'SESSION_BLOCKED', reason: `${label}_session_mismatch` };
  }
  if (reference.agent_id !== undefined && reference.agent_id !== canonical.agentId) {
    return { status: 'AGENT_BLOCKED', reason: `${label}_agent_mismatch` };
  }
  if (reference.actor_id !== undefined && reference.actor_id !== canonical.actorId) {
    return { status: 'ACTOR_BLOCKED', reason: `${label}_actor_mismatch` };
  }
  return null;
}

function evaluateRuntimeExecutionSimulationRequest(request, context = {}) {
  const validatedFlags = {};
  function markValid(flag) {
    validatedFlags[flag] = true;
  }

  const requestIsObject = isPlainObject(request);
  const policy = requestIsObject ? request.runtime_policy : undefined;
  const gatewayDecision = requestIsObject ? request.gateway_decision_reference : undefined;
  const gatewayResult = requestIsObject ? request.gateway_result_reference : undefined;
  const gatewayPackageRef = requestIsObject ? request.gateway_package_reference : undefined;
  const plan = requestIsObject ? request.execution_plan_reference : undefined;
  const result = requestIsObject ? request.execution_plan_result_reference : undefined;
  const stageManifestRef = requestIsObject ? request.stage_manifest_reference : undefined;
  const dependencyGraphRef = requestIsObject ? request.dependency_graph_reference : undefined;
  const bindingLedger = requestIsObject ? request.binding_ledger_reference : undefined;
  const validationLedger = requestIsObject ? request.validation_ledger_reference : undefined;
  const provenanceRef = requestIsObject ? request.authorization_provenance_reference : undefined;
  const scopeRef = requestIsObject ? request.authorization_scope_reference : undefined;
  const snapshotRef = requestIsObject ? request.registry_snapshot_reference : undefined;
  const runtimeStageManifest = requestIsObject ? request.runtime_stage_manifest_reference : undefined;
  const runtimeDependencyManifest = requestIsObject ? request.runtime_dependency_manifest_reference : undefined;
  const runtimeBudgetRef = requestIsObject ? request.runtime_budget_reference : undefined;
  const executionBudgetReference = requestIsObject ? request.execution_budget_reference : undefined;
  const runtimeStopRefs = requestIsObject && Array.isArray(request.runtime_stop_references) ? request.runtime_stop_references : [];
  const runtimeCompensationRefs = requestIsObject && Array.isArray(request.runtime_compensation_references) ? request.runtime_compensation_references : [];
  const runtimeArtifactPlan = requestIsObject ? request.runtime_artifact_plan_reference : undefined;
  const runtimeEventPlan = requestIsObject ? request.runtime_event_plan_reference : undefined;

  const canonical = {
    tenantId: isPlainObject(plan) ? plan.tenant_id : undefined,
    organizationId: isPlainObject(plan) ? plan.organization_id : undefined,
    projectId: isPlainObject(plan) ? plan.project_id : undefined,
    sessionId: isPlainObject(plan) ? plan.session_reference_id : undefined,
    agentId: isPlainObject(plan) ? plan.agent_id : undefined,
    actorId: isPlainObject(gatewayPackageRef) ? gatewayPackageRef.actor_id : undefined
  };

  // computeCanonicalContentDigest never throws (degrades to a `digest_invalid::...` string), so
  // this is safe even when request/gatewayResult are malformed.
  const requestFingerprint = computeCanonicalContentDigest(request);
  const gatewayResultFingerprint = computeCanonicalContentDigest(gatewayResult);

  const base = {
    request, requestFingerprint, gatewayResultFingerprint, canonical, policy, gatewayDecision, gatewayResult,
    gatewayPackageRef, plan, result, stageManifestRef, dependencyGraphRef, bindingLedger, validationLedger,
    provenanceRef, scopeRef, snapshotRef, runtimeStageManifest, runtimeDependencyManifest, runtimeBudgetRef,
    executionBudgetReference, runtimeStopRefs, runtimeCompensationRefs, runtimeArtifactPlan, runtimeEventPlan
  };

  function finalize(status, reasonCodes, extra, flags) {
    return buildOutcome(status, reasonCodes, { ...base, ...extra }, flags);
  }

  // 1-2. request contract shape, including runtime_policy/every nested reference and
  // simulation_context, all as nested fields of the request itself -- no side-channel is ever
  // consulted here, matching every engine since PR #98fix.
  const requestValidation = validateRuntimeExecutionSimulationRequest(request);
  if (!requestValidation.valid) {
    return finalize('RUNTIME_VALIDATION_FAILED', ['runtime_execution_simulation_request_invalid'], {}, validatedFlags);
  }
  markValid('request_validated');

  // 9-14 (moved up, matching precedence): tenant/organization/project/session/agent/actor, across
  // every reference that actually carries the corresponding field.
  const identityChecks = [
    ['execution_plan_result_reference', result], ['stage_manifest_reference', stageManifestRef],
    ['dependency_graph_reference', dependencyGraphRef], ['binding_ledger_reference', bindingLedger],
    ['validation_ledger_reference', validationLedger], ['authorization_provenance_reference', provenanceRef],
    ['authorization_scope_reference', scopeRef], ['registry_snapshot_reference', snapshotRef],
    ['gateway_decision_reference', gatewayDecision], ['gateway_result_reference', gatewayResult],
    // ExecutionPlanBudget carries no tenant/organization/project/session fields of its own today --
    // checkIdentity() skips whatever a reference doesn't structurally carry, so this is a no-op
    // now and becomes a real check automatically if that contract ever gains identity fields
    // ("tenant/org/project/session bindings disponíveis").
    ['execution_budget_reference', executionBudgetReference]
  ];
  for (const [label, reference] of identityChecks) {
    const mismatch = checkIdentity(reference, canonical, label);
    if (mismatch) return finalize(mismatch.status, [mismatch.reason], {}, validatedFlags);
  }

  // 4-6. Gateway decision/result/package -- "GATEWAY_ACCEPTED_SIMULATION != RUNTIME_PACKAGE_
  // PREPARED_SIMULATION": this PR only ever *consumes* an already-accepted Gateway package, never
  // re-derives or second-guesses the Gateway's own acceptance logic.
  if (
    gatewayDecision.status !== 'GATEWAY_ACCEPTED_SIMULATION' || gatewayDecision.gateway_accepted_in_simulation !== true
    || gatewayResult.status !== 'GATEWAY_ACCEPTED_SIMULATION' || gatewayResult.gateway_accepted_in_simulation !== true
  ) {
    return finalize('RUNTIME_GATEWAY_BLOCKED', ['gateway_not_accepted_in_simulation'], {}, validatedFlags);
  }
  if (
    gatewayResult.gateway_decision_id !== gatewayDecision.gateway_decision_id
    || gatewayPackageRef.gateway_package_reference_id !== gatewayDecision.gateway_package_reference_id
    || gatewayDecision.runtime_enabled !== false || gatewayDecision.execution_authorized !== false
    || gatewayDecision.execution_started !== false || gatewayDecision.executed !== false
    || gatewayResult.runtime_enabled !== false || gatewayResult.executed !== false
  ) {
    return finalize('RUNTIME_GATEWAY_BLOCKED', ['gateway_decision_result_package_mismatch'], {}, validatedFlags);
  }
  markValid('gateway_validated');

  // 10. package reference cross-check -- gatewayPackageRef's own declared ids/fingerprints must
  // agree with the real plan/stageManifest/dependencyGraph/bindingLedger/validationLedger this
  // runtime request actually carries. A caller who swapped in a different plan without updating
  // gatewayPackageRef is caught here.
  const packageIdChecks = [
    [gatewayPackageRef.execution_plan_id, plan.execution_plan_id, 'package_reference_execution_plan_id_mismatch'],
    [gatewayPackageRef.execution_plan_result_id, result.result_id, 'package_reference_execution_plan_result_id_mismatch'],
    [gatewayPackageRef.stage_manifest_reference_id, stageManifestRef.stage_manifest_reference_id, 'package_reference_stage_manifest_id_mismatch'],
    [gatewayPackageRef.dependency_graph_reference_id, dependencyGraphRef.dependency_graph_reference_id, 'package_reference_dependency_graph_id_mismatch'],
    [gatewayPackageRef.binding_ledger_id, bindingLedger.binding_ledger_id, 'package_reference_binding_ledger_id_mismatch'],
    [gatewayPackageRef.validation_ledger_id, validationLedger.validation_ledger_id, 'package_reference_validation_ledger_id_mismatch']
  ];
  for (const [declared, actual, reason] of packageIdChecks) {
    if (declared !== actual) return finalize('RUNTIME_PACKAGE_REFERENCE_BLOCKED', [reason], {}, validatedFlags);
  }
  if (gatewayPackageRef.package_reference_validated !== true) {
    return finalize('RUNTIME_PACKAGE_REFERENCE_BLOCKED', ['package_reference_not_validated'], {}, validatedFlags);
  }

  // 7-8. Execution Plan / Execution Plan Result.
  if (
    plan.execution_plan_status !== 'EXECUTION_PLAN_PREPARED_SIMULATION' || plan.execution_plan_prepared !== true
    || plan.executable !== false || plan.execution_authorized !== false || plan.execution_started !== false
    || plan.executed !== false || plan.runtime_enabled !== false || plan.simulation !== true
    || plan.production_blocked !== true || plan.rollout_percentage !== 0
  ) {
    return finalize('RUNTIME_PACKAGE_REFERENCE_BLOCKED', ['execution_plan_not_prepared'], {}, validatedFlags);
  }
  if (
    result.status !== 'EXECUTION_PLAN_PREPARED_SIMULATION' || result.execution_plan_id !== plan.execution_plan_id
    || result.executable !== false || result.execution_authorized !== false || result.execution_started !== false
    || result.executed !== false || result.runtime_enabled !== false
  ) {
    return finalize('RUNTIME_PACKAGE_REFERENCE_BLOCKED', ['execution_plan_result_not_prepared'], {}, validatedFlags);
  }
  markValid('execution_plan_validated');

  // 15+19. Stage Manifest -- structural agreement with the plan, then 1:1 preservation into the
  // Runtime Stage Manifest (same count, same order, same stage_type, same references, same
  // estimates -- "não inferir stage type, não zerar estimativas, não remover paralelismo/optional,
  // não adicionar model/tool/workflow bindings").
  if (stageManifestRef.stage_manifest_reference_id !== plan.stage_manifest_reference_id) {
    return finalize('RUNTIME_STAGE_MANIFEST_BLOCKED', ['stage_manifest_reference_mismatched'], {}, validatedFlags);
  }
  if (
    runtimeStageManifest.stage_manifest_reference_id !== stageManifestRef.stage_manifest_reference_id
    || runtimeStageManifest.stage_manifest_fingerprint !== stageManifestRef.manifest_fingerprint
    || runtimeStageManifest.execution_plan_id !== plan.execution_plan_id
    || runtimeStageManifest.manifest_validated !== true
    || runtimeStageManifest.runtime_stage_count !== stageManifestRef.stage_records.length
  ) {
    return finalize('RUNTIME_STAGE_MANIFEST_BLOCKED', ['runtime_stage_manifest_not_validated_or_mismatched'], {}, validatedFlags);
  }
  const sourceStageRecords = stageManifestRef.stage_records;
  const runtimeStages = runtimeStageManifest.runtime_stage_references;
  for (let i = 0; i < sourceStageRecords.length; i += 1) {
    const record = sourceStageRecords[i];
    const stage = runtimeStages[i];
    const mismatchedField = compareRuntimeStageToSourceStage(stage, record);
    if (mismatchedField) {
      return finalize('RUNTIME_STAGE_MANIFEST_BLOCKED', [`runtime_stage_not_preserved_1to1::${record.stage_id}::${mismatchedField}`], {}, validatedFlags);
    }
    const derivedMismatch = validateRuntimeStageDerivedFields(stage, { record, bindingLedger, runtimeStopRefs, runtimeCompensationRefs, scopeRef });
    if (derivedMismatch) {
      return finalize('RUNTIME_STAGE_MANIFEST_BLOCKED', [`runtime_stage_not_preserved_1to1::${record.stage_id}::${derivedMismatch}`], {}, validatedFlags);
    }
  }
  markValid('stage_manifest_validated');

  // 16+20. Dependency Graph -- preserves ids/from/to/type/required/order, acyclic, never applies
  // any dependency.
  if (dependencyGraphRef.dependency_graph_reference_id !== gatewayPackageRef.dependency_graph_reference_id) {
    return finalize('RUNTIME_DEPENDENCY_BLOCKED', ['dependency_graph_reference_mismatched'], {}, validatedFlags);
  }
  if (
    runtimeDependencyManifest.dependency_graph_reference_id !== dependencyGraphRef.dependency_graph_reference_id
    || runtimeDependencyManifest.dependency_graph_fingerprint !== dependencyGraphRef.graph_fingerprint
    || runtimeDependencyManifest.execution_plan_id !== plan.execution_plan_id
    || runtimeDependencyManifest.cycle_free !== true || runtimeDependencyManifest.all_stage_ids_present !== true
    || runtimeDependencyManifest.all_dependencies_validated !== true
    || runtimeDependencyManifest.runtime_dependency_count !== dependencyGraphRef.dependency_records.length
  ) {
    return finalize('RUNTIME_DEPENDENCY_BLOCKED', ['runtime_dependency_manifest_not_validated_or_mismatched'], {}, validatedFlags);
  }
  const sourceDependencyRecords = dependencyGraphRef.dependency_records;
  const runtimeDependencies = runtimeDependencyManifest.runtime_dependency_references;
  // pr103fix: endpoints must resolve through a deterministic source-stage-id -> runtime-stage-id
  // map, never assumed by array position -- the original check compared id/type/required but
  // never proved from_runtime_stage_id/to_runtime_stage_id actually correspond to the real
  // endpoints of the source dependency, leaving a redirect (or a reused dependency id pointed at
  // different stages) undetected. Matching is by source_dependency_id, independent of input
  // order, exactly as required.
  const runtimeStageMap = new Map(sourceStageRecords.map((record, index) => [record.stage_id, runtimeStages[index].runtime_stage_reference_id]));
  const runtimeDependencyBySourceId = new Map(runtimeDependencies.map((dependency) => [dependency.source_dependency_id, dependency]));
  if (
    runtimeDependencies.length !== sourceDependencyRecords.length
    || runtimeDependencyBySourceId.size !== runtimeDependencies.length
  ) {
    return finalize('RUNTIME_DEPENDENCY_BLOCKED', ['runtime_dependency_cardinality_mismatch'], {}, validatedFlags);
  }
  for (const record of sourceDependencyRecords) {
    const dependency = runtimeDependencyBySourceId.get(record.dependency_id);
    const expectedFrom = runtimeStageMap.get(record.from_stage_id);
    const expectedTo = runtimeStageMap.get(record.to_stage_id);
    if (
      !dependency || expectedFrom === undefined || expectedTo === undefined
      || dependency.from_runtime_stage_id !== expectedFrom || dependency.to_runtime_stage_id !== expectedTo
      || dependency.dependency_type !== record.dependency_type || dependency.required !== record.required
      || dependency.dependency_validated !== true
    ) {
      return finalize('RUNTIME_DEPENDENCY_BLOCKED', [`runtime_dependency_endpoint_mismatch::${record.dependency_id}`], {}, validatedFlags);
    }
  }
  markValid('dependency_manifest_validated');

  // 17. Binding Ledger.
  if (
    bindingLedger.binding_ledger_id !== plan.binding_ledger_id || bindingLedger.execution_plan_id !== plan.execution_plan_id
    || bindingLedger.references_bound_in_simulation !== true || bindingLedger.all_required_bindings_present !== true
    || bindingLedger.all_bindings_validated !== true || bindingLedger.blocked_binding_count !== 0
    || bindingLedger.bindings_applied !== false || bindingLedger.execution_authorized !== false
    || bindingLedger.execution_started !== false
  ) {
    return finalize('RUNTIME_BINDING_BLOCKED', ['binding_ledger_not_fully_bound_or_mismatched'], {}, validatedFlags);
  }
  markValid('binding_ledger_validated');

  // 18. Validation Ledger.
  if (
    validationLedger.validation_ledger_id !== plan.validation_ledger_id
    || validationLedger.pipeline_completed !== true || validationLedger.all_required_validations_valid !== true
    || validationLedger.invalid_count !== 0 || validationLedger.blocking_count !== 0
    || validationLedger.terminal_count !== 0 || validationLedger.not_evaluated_count !== 0
  ) {
    return finalize('RUNTIME_VALIDATION_BLOCKED', ['validation_ledger_not_fully_valid_or_mismatched'], {}, validatedFlags);
  }
  markValid('validation_ledger_validated');

  // 3. Policy -- evaluated once the runtime stage manifest's real stage-type/side-effect
  // classification is known (declared PRECEDENCE_ORDER lists RUNTIME_POLICY_BLOCKED early, but the
  // actual runtime evaluation order needs this data first -- the same "declared order differs from
  // evaluation order" split validation-taxonomy.js's own PRECEDENCE_ORDER already established, and
  // execution-gateway-boundary.js's own policy check already mirrors).
  const stageTypes = new Set(runtimeStages.map((stage) => stage.stage_type));
  const hasModelStage = stageTypes.has('MODEL_REFERENCE_STAGE');
  const hasStageModelReference = runtimeStages.some((stage) => stage.model_selection_reference_id !== null);
  const isNoLlmPackage = !hasModelStage && !hasStageModelReference;
  if (isNoLlmPackage && policy.allow_no_llm_stage !== true) {
    return finalize('RUNTIME_POLICY_BLOCKED', ['no_llm_stage_not_allowed_by_policy'], {}, validatedFlags);
  }
  if (hasModelStage && policy.allow_model_reference_stage !== true) {
    return finalize('RUNTIME_POLICY_BLOCKED', ['model_reference_stage_not_allowed_by_policy'], {}, validatedFlags);
  }
  if (stageTypes.has('TOOL_REFERENCE_STAGE') && policy.allow_tool_reference_stage !== true) {
    return finalize('RUNTIME_POLICY_BLOCKED', ['tool_reference_stage_not_allowed_by_policy'], {}, validatedFlags);
  }
  if (stageTypes.has('WORKFLOW_REFERENCE_STAGE') && policy.allow_workflow_reference_stage !== true) {
    return finalize('RUNTIME_POLICY_BLOCKED', ['workflow_reference_stage_not_allowed_by_policy'], {}, validatedFlags);
  }
  if (runtimeStages.some((stage) => stage.parallelizable === true) && policy.allow_parallel_reference !== true) {
    return finalize('RUNTIME_POLICY_BLOCKED', ['parallel_reference_not_allowed_by_policy'], {}, validatedFlags);
  }
  if (runtimeStages.some((stage) => stage.approval_required === true) && policy.allow_human_approval_reference !== true) {
    return finalize('RUNTIME_POLICY_BLOCKED', ['human_approval_reference_not_allowed_by_policy'], {}, validatedFlags);
  }
  if (runtimeStages.some((stage) => stage.side_effect_classification === 'EXTERNAL_EFFECT_REFERENCE')) {
    return finalize('RUNTIME_POLICY_BLOCKED', ['external_effect_reference_not_allowed_in_this_pr'], {}, validatedFlags);
  }
  if (runtimeStages.some((stage) => stage.side_effect_classification === 'IRREVERSIBLE_REFERENCE')) {
    return finalize('RUNTIME_POLICY_BLOCKED', ['irreversible_reference_not_allowed_in_this_pr'], {}, validatedFlags);
  }
  markValid('policy_validated');

  // 21. Budget -- sums the real stage estimates and compares against the Runtime Budget
  // Simulation Reference's own declared estimates/counts, and cross-checks the whole thing against
  // the real ExecutionPlanBudget (PR #98) it claims to summarize. Never reserves or consumes
  // anything.
  if (
    runtimeBudgetRef.execution_plan_id !== plan.execution_plan_id || runtimeBudgetRef.budget_validated !== true
    || runtimeBudgetRef.estimated_input_tokens !== runtimeStageManifest.estimated_input_tokens
    || runtimeBudgetRef.estimated_output_tokens !== runtimeStageManifest.estimated_output_tokens
    || runtimeBudgetRef.estimated_total_tokens !== runtimeStageManifest.estimated_total_tokens
    || runtimeBudgetRef.estimated_total_cost_minor_units !== runtimeStageManifest.estimated_total_cost_minor_units
    || runtimeBudgetRef.model_stage_count !== runtimeStageManifest.model_stage_count
    || runtimeBudgetRef.tool_stage_count !== runtimeStageManifest.tool_stage_count
    || runtimeBudgetRef.workflow_stage_count !== runtimeStageManifest.workflow_stage_count
    || runtimeBudgetRef.parallel_stage_count !== runtimeStageManifest.parallel_stage_count
  ) {
    return finalize('RUNTIME_BUDGET_BLOCKED', ['runtime_budget_not_validated_or_mismatched_with_stage_manifest'], {}, validatedFlags);
  }
  // pr103fix: "O Runtime Budget deriva seus limites do ExecutionPlanBudget real. Flags de limite
  // fornecidas pelo caller não são fonte de verdade." -- every maximum_*/reserved_* field the
  // Runtime Budget declares is compared, byte-exact, against the real ExecutionPlanBudget; and
  // stage_counts_within_limit is *recomputed* from the real maximum_model_stages/maximum_tool_
  // stages/maximum_workflow_stages/maximum_parallel_stages caps, never trusted as a caller-declared
  // boolean, even though those caps have no field of their own on RuntimeBudgetSimulationReference.
  if (
    executionBudgetReference.execution_plan_id !== plan.execution_plan_id
    || runtimeBudgetRef.execution_budget_id !== executionBudgetReference.execution_budget_id
    || runtimeBudgetRef.budget_authorization_id !== executionBudgetReference.budget_authorization_id
    || runtimeBudgetRef.maximum_total_tokens !== executionBudgetReference.maximum_total_tokens
    || runtimeBudgetRef.maximum_input_tokens !== executionBudgetReference.maximum_input_tokens
    || runtimeBudgetRef.maximum_output_tokens !== executionBudgetReference.maximum_output_tokens
    || runtimeBudgetRef.maximum_total_cost_minor_units !== executionBudgetReference.maximum_total_cost_minor_units
    || runtimeBudgetRef.reserved_memory_tokens !== executionBudgetReference.reserved_memory_tokens
    || runtimeBudgetRef.reserved_context_tokens !== executionBudgetReference.reserved_context_tokens
    || runtimeBudgetRef.reserved_output_tokens !== executionBudgetReference.reserved_output_tokens
  ) {
    return finalize('RUNTIME_BUDGET_BLOCKED', ['runtime_budget_not_linked_to_real_execution_plan_budget'], {}, validatedFlags);
  }
  const recomputedStageCountsWithinLimit = runtimeStageManifest.model_stage_count <= executionBudgetReference.maximum_model_stages
    && runtimeStageManifest.tool_stage_count <= executionBudgetReference.maximum_tool_stages
    && runtimeStageManifest.workflow_stage_count <= executionBudgetReference.maximum_workflow_stages
    && runtimeStageManifest.parallel_stage_count <= executionBudgetReference.maximum_parallel_stages;
  if (runtimeBudgetRef.stage_counts_within_limit !== recomputedStageCountsWithinLimit || recomputedStageCountsWithinLimit !== true) {
    return finalize('RUNTIME_BUDGET_BLOCKED', ['runtime_budget_stage_counts_within_limit_not_honestly_derived'], {}, validatedFlags);
  }
  markValid('budget_validated');

  // 22. Stops -- each bound to plan/stage/condition/fingerprint/version, never evaluated.
  const runtimeStageIds = new Set(runtimeStages.map((stage) => stage.runtime_stage_reference_id));
  for (const stop of runtimeStopRefs) {
    if (
      stop.execution_plan_id !== plan.execution_plan_id || !runtimeStageIds.has(stop.runtime_stage_reference_id)
      || stop.stop_validated !== true || stop.stop_condition_evaluated !== false || stop.stop_applied !== false
    ) {
      return finalize('RUNTIME_STOP_BLOCKED', [`runtime_stop_not_validated_or_mismatched::${stop.runtime_stop_reference_id || 'unknown'}`], {}, validatedFlags);
    }
  }
  markValid('stops_validated');

  // 23. Compensations -- every STATE_CHANGE_REFERENCE stage requires at least one valid
  // compensation reference; none is ever executed.
  for (const compensation of runtimeCompensationRefs) {
    if (
      compensation.execution_plan_id !== plan.execution_plan_id || !runtimeStageIds.has(compensation.runtime_stage_reference_id)
      || compensation.compensation_validated !== true || compensation.compensation_executed !== false
    ) {
      return finalize('RUNTIME_COMPENSATION_BLOCKED', [`runtime_compensation_not_validated_or_mismatched::${compensation.runtime_compensation_reference_id || 'unknown'}`], {}, validatedFlags);
    }
  }
  const stateChangeStages = runtimeStages.filter((stage) => stage.side_effect_classification === 'STATE_CHANGE_REFERENCE');
  for (const stage of stateChangeStages) {
    const covered = runtimeCompensationRefs.some((compensation) => (
      compensation.runtime_stage_reference_id === stage.runtime_stage_reference_id && compensation.compensation_validated === true
    ));
    if (!covered) {
      return finalize('RUNTIME_COMPENSATION_BLOCKED', [`state_change_stage_without_compensation::${stage.runtime_stage_reference_id}`], {}, validatedFlags);
    }
  }
  markValid('compensations_validated');

  // 24. Artifact Plan -- never creates a file.
  if (
    runtimeArtifactPlan.execution_plan_id !== plan.execution_plan_id || runtimeArtifactPlan.artifact_plan_validated !== true
    || runtimeArtifactPlan.artifact_creation_allowed !== false || runtimeArtifactPlan.artifact_created !== false
  ) {
    return finalize('RUNTIME_ARTIFACT_PLAN_BLOCKED', ['artifact_plan_not_validated_or_mismatched'], {}, validatedFlags);
  }
  markValid('artifact_plan_validated');

  // 25. Event Plan -- never emits an event.
  if (
    runtimeEventPlan.execution_plan_id !== plan.execution_plan_id || runtimeEventPlan.event_plan_validated !== true
    || runtimeEventPlan.event_emission_allowed !== false || runtimeEventPlan.event_emitted !== false
  ) {
    return finalize('RUNTIME_EVENT_PLAN_BLOCKED', ['event_plan_not_validated_or_mismatched'], {}, validatedFlags);
  }
  markValid('event_plan_validated');

  // 26. Package fingerprint -- every sub-fingerprint the (already-validated-by-the-Gateway)
  // package reference declares is compared, one more time, against the real, freshly-read field on
  // the actual object this runtime request carries. Never trusted as merely "already checked once
  // upstream".
  const fingerprintChecks = [
    [gatewayPackageRef.execution_plan_fingerprint, plan.plan_fingerprint],
    [gatewayPackageRef.stage_manifest_fingerprint, stageManifestRef.manifest_fingerprint],
    [gatewayPackageRef.dependency_graph_fingerprint, dependencyGraphRef.graph_fingerprint],
    [gatewayPackageRef.binding_ledger_fingerprint, bindingLedger.ledger_fingerprint],
    [gatewayPackageRef.validation_ledger_fingerprint, validationLedger.ledger_fingerprint]
  ];
  if (fingerprintChecks.some(([declared, actual]) => declared !== actual)) {
    return finalize('RUNTIME_FINGERPRINT_BLOCKED', ['package_sub_fingerprint_mismatch'], {}, validatedFlags);
  }
  markValid('package_fingerprint_validated');

  // 27. Package digest -- a compact recomputation over the full canonical bundle.
  const orderedRuntimeStageIds = runtimeStageManifest.ordered_runtime_stage_ids;
  const runtimeDependencyIds = runtimeDependencyManifest.runtime_dependency_reference_ids;
  const estimates = {
    estimated_input_tokens: runtimeStageManifest.estimated_input_tokens,
    estimated_output_tokens: runtimeStageManifest.estimated_output_tokens,
    estimated_total_tokens: runtimeStageManifest.estimated_total_tokens,
    estimated_total_cost_minor_units: runtimeStageManifest.estimated_total_cost_minor_units
  };
  markValid('package_digest_validated');

  // 28. Non-execution invariants -- an explicit, final aggregate re-check that nothing anywhere in
  // the accepted bundle carries a live operational flag, on top of every individual check above.
  const operationalCarriers = [plan, result, bindingLedger];
  const anyOperationalFlagLive = operationalCarriers.some((carrier) => (
    carrier.execution_authorized === true || carrier.execution_started === true || carrier.executed === true
    || (carrier.runtime_enabled !== undefined && carrier.runtime_enabled === true)
  ));
  if (anyOperationalFlagLive) {
    return finalize('RUNTIME_VALIDATION_FAILED', ['non_execution_invariant_violated'], {}, validatedFlags);
  }
  markValid('non_execution_invariants_validated');

  // 29-31. emitir decisão, resultado, e registrar auditoria -- RUNTIME_PACKAGE_PREPARED_SIMULATION.
  // Even here, no admission/execution is authorized: see buildOutcome()'s own forced
  // OPERATIONAL_SAFE_FLAGS.
  return finalize('RUNTIME_PACKAGE_PREPARED_SIMULATION', ['runtime_package_prepared_in_simulation_only'], {
    orderedRuntimeStageIds, runtimeDependencyIds, estimates
  }, validatedFlags);
}

function buildOutcome(status, reasonCodes, ctx, validatedFlags) {
  const {
    request, requestFingerprint, gatewayResultFingerprint, canonical, gatewayDecision, gatewayResult,
    gatewayPackageRef, plan, result, stageManifestRef, dependencyGraphRef, bindingLedger, validationLedger,
    runtimeStageManifest, runtimeDependencyManifest, runtimeBudgetRef, executionBudgetReference, runtimeStopRefs,
    runtimeCompensationRefs, runtimeArtifactPlan, runtimeEventPlan, orderedRuntimeStageIds, runtimeDependencyIds,
    estimates
  } = ctx;

  const requestSafe = isPlainObject(request) ? request : {};
  const gwDecisionSafe = isPlainObject(gatewayDecision) ? gatewayDecision : {};
  const gwResultSafe = isPlainObject(gatewayResult) ? gatewayResult : {};
  const gwPackageRefSafe = isPlainObject(gatewayPackageRef) ? gatewayPackageRef : {};
  const planSafe = isPlainObject(plan) ? plan : {};
  const resultSafe = isPlainObject(result) ? result : {};
  const stageManifestSafe = isPlainObject(stageManifestRef) ? stageManifestRef : {};
  const depGraphSafe = isPlainObject(dependencyGraphRef) ? dependencyGraphRef : {};
  const bindingLedgerSafe = isPlainObject(bindingLedger) ? bindingLedger : {};
  const validationLedgerSafe = isPlainObject(validationLedger) ? validationLedger : {};
  const runtimeStageManifestSafe = isPlainObject(runtimeStageManifest) ? runtimeStageManifest : {};
  const runtimeDependencyManifestSafe = isPlainObject(runtimeDependencyManifest) ? runtimeDependencyManifest : {};
  const runtimeBudgetSafe = isPlainObject(runtimeBudgetRef) ? runtimeBudgetRef : {};
  const executionBudgetReferenceSafe = isPlainObject(executionBudgetReference) ? executionBudgetReference : {};
  const runtimeArtifactPlanSafe = isPlainObject(runtimeArtifactPlan) ? runtimeArtifactPlan : {};
  const runtimeEventPlanSafe = isPlainObject(runtimeEventPlan) ? runtimeEventPlan : {};
  const canonicalSafe = canonical || {};
  const estimatesSafe = estimates || { estimated_input_tokens: 0, estimated_output_tokens: 0, estimated_total_tokens: 0, estimated_total_cost_minor_units: 0 };

  const runtimeRequestId = requestSafe.runtime_request_id || 'runtime_request_not_available';
  const runtimeExecutionPackageId = `${runtimeRequestId}-package`;

  const packageDigest = computeRuntimePackageDigest({
    gatewayDecision: gwDecisionSafe, gatewayResult: gwResultSafe, gatewayPackageRef: gwPackageRefSafe,
    plan: planSafe, result: resultSafe, stageManifestRef: stageManifestSafe, dependencyGraphRef: depGraphSafe,
    bindingLedger: bindingLedgerSafe, validationLedger: validationLedgerSafe,
    runtimeStageManifest: runtimeStageManifestSafe, runtimeDependencyManifest: runtimeDependencyManifestSafe,
    runtimeBudgetRef: runtimeBudgetSafe, executionBudgetReference: executionBudgetReferenceSafe,
    runtimeStopRefs: runtimeStopRefs || [], runtimeCompensationRefs: runtimeCompensationRefs || [],
    runtimeArtifactPlan: runtimeArtifactPlanSafe, runtimeEventPlan: runtimeEventPlanSafe,
    orderedRuntimeStageIds: orderedRuntimeStageIds || [], runtimeDependencyIds: runtimeDependencyIds || [],
    estimates: estimatesSafe, canonical: canonicalSafe
  });

  const decision = buildRuntimeExecutionSimulationDecision({
    runtime_decision_id: `${runtimeRequestId}-decision`,
    runtime_request_id: runtimeRequestId,
    runtime_execution_package_id: runtimeExecutionPackageId,
    gateway_decision_id: gwDecisionSafe.gateway_decision_id || 'gateway_decision_not_available',
    gateway_result_id: gwResultSafe.gateway_result_id || 'gateway_result_not_available',
    execution_plan_id: planSafe.execution_plan_id || 'execution_plan_not_available',
    tenant_id: canonicalSafe.tenantId || 'tenant_not_available',
    organization_id: canonicalSafe.organizationId || 'organization_not_available',
    project_id: canonicalSafe.projectId || 'project_not_available',
    session_reference_id: canonicalSafe.sessionId || 'session_not_available',
    agent_id: canonicalSafe.agentId || 'agent_not_available',
    actor_id: canonicalSafe.actorId || 'actor_not_available',
    status,
    runtime_request_fingerprint: requestFingerprint || 'fingerprint_not_available',
    runtime_package_fingerprint: packageDigest,
    runtime_package_digest: packageDigest,
    gateway_decision_fingerprint: gwResultSafe.gateway_decision_fingerprint || 'fingerprint_not_available',
    gateway_result_fingerprint: gatewayResultFingerprint || 'fingerprint_not_available',
    execution_plan_fingerprint: planSafe.plan_fingerprint || 'fingerprint_not_available',
    runtime_stage_manifest_fingerprint: runtimeStageManifestSafe.manifest_fingerprint || 'fingerprint_not_available',
    runtime_dependency_manifest_fingerprint: runtimeDependencyManifestSafe.manifest_fingerprint || 'fingerprint_not_available',
    runtime_budget_fingerprint: runtimeBudgetSafe.budget_fingerprint || 'fingerprint_not_available',
    runtime_artifact_plan_fingerprint: runtimeArtifactPlanSafe.artifact_plan_fingerprint || 'fingerprint_not_available',
    runtime_event_plan_fingerprint: runtimeEventPlanSafe.event_plan_fingerprint || 'fingerprint_not_available',
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    ...validatedFlags
  });

  const runtimeStopFingerprints = [...(runtimeStopRefs || [])].map((s) => s.stop_fingerprint).sort();
  const runtimeCompensationFingerprints = [...(runtimeCompensationRefs || [])].map((c) => c.compensation_fingerprint).sort();

  const runtimePackage = buildRuntimeExecutionPackage({
    runtime_execution_package_id: runtimeExecutionPackageId,
    runtime_request_id: runtimeRequestId,
    gateway_decision_id: decision.gateway_decision_id,
    gateway_result_id: decision.gateway_result_id,
    gateway_package_reference_id: gwPackageRefSafe.gateway_package_reference_id || 'gateway_package_reference_not_available',
    execution_plan_id: decision.execution_plan_id,
    execution_plan_result_id: resultSafe.result_id || 'execution_plan_result_not_available',
    stage_manifest_reference_id: stageManifestSafe.stage_manifest_reference_id || 'stage_manifest_reference_not_available',
    dependency_graph_reference_id: depGraphSafe.dependency_graph_reference_id || 'dependency_graph_reference_not_available',
    binding_ledger_id: bindingLedgerSafe.binding_ledger_id || 'binding_ledger_not_available',
    validation_ledger_id: validationLedgerSafe.validation_ledger_id || 'validation_ledger_not_available',
    authorization_provenance_reference_id: (ctx.provenanceRef && ctx.provenanceRef.authorization_provenance_reference_id) || 'authorization_provenance_reference_not_available',
    authorization_scope_reference_id: (ctx.scopeRef && ctx.scopeRef.authorization_scope_reference_id) || 'authorization_scope_reference_not_available',
    registry_snapshot_reference_id: (ctx.snapshotRef && ctx.snapshotRef.registry_snapshot_reference_id) || 'registry_snapshot_reference_not_available',
    runtime_stage_manifest_id: runtimeStageManifestSafe.runtime_stage_manifest_id || 'runtime_stage_manifest_not_available',
    runtime_dependency_manifest_id: runtimeDependencyManifestSafe.runtime_dependency_manifest_id || 'runtime_dependency_manifest_not_available',
    runtime_budget_reference_id: runtimeBudgetSafe.runtime_budget_reference_id || 'runtime_budget_reference_not_available',
    runtime_stop_reference_ids: (runtimeStopRefs || []).map((s) => s.runtime_stop_reference_id),
    runtime_compensation_reference_ids: (runtimeCompensationRefs || []).map((c) => c.runtime_compensation_reference_id),
    runtime_artifact_plan_reference_id: runtimeArtifactPlanSafe.runtime_artifact_plan_reference_id || 'runtime_artifact_plan_reference_not_available',
    runtime_event_plan_reference_id: runtimeEventPlanSafe.runtime_event_plan_reference_id || 'runtime_event_plan_reference_not_available',
    tenant_id: decision.tenant_id,
    organization_id: decision.organization_id,
    project_id: decision.project_id,
    session_reference_id: decision.session_reference_id,
    agent_id: decision.agent_id,
    actor_id: decision.actor_id,
    runtime_status: status,
    ordered_runtime_stage_ids: orderedRuntimeStageIds || [],
    runtime_dependency_ids: runtimeDependencyIds || [],
    gateway_decision_fingerprint: decision.gateway_decision_fingerprint,
    gateway_result_fingerprint: decision.gateway_result_fingerprint,
    gateway_package_fingerprint: gwDecisionSafe.gateway_package_fingerprint || 'fingerprint_not_available',
    execution_plan_fingerprint: decision.execution_plan_fingerprint,
    stage_manifest_fingerprint: decision.runtime_stage_manifest_fingerprint === 'fingerprint_not_available' ? 'fingerprint_not_available' : (stageManifestSafe.manifest_fingerprint || 'fingerprint_not_available'),
    dependency_graph_fingerprint: depGraphSafe.graph_fingerprint || 'fingerprint_not_available',
    binding_ledger_fingerprint: bindingLedgerSafe.ledger_fingerprint || 'fingerprint_not_available',
    validation_ledger_fingerprint: validationLedgerSafe.ledger_fingerprint || 'fingerprint_not_available',
    runtime_stage_manifest_fingerprint: decision.runtime_stage_manifest_fingerprint,
    runtime_dependency_manifest_fingerprint: decision.runtime_dependency_manifest_fingerprint,
    runtime_budget_fingerprint: decision.runtime_budget_fingerprint,
    runtime_stop_fingerprints: runtimeStopFingerprints,
    runtime_compensation_fingerprints: runtimeCompensationFingerprints,
    runtime_artifact_plan_fingerprint: decision.runtime_artifact_plan_fingerprint,
    runtime_event_plan_fingerprint: decision.runtime_event_plan_fingerprint,
    estimated_input_tokens: estimatesSafe.estimated_input_tokens,
    estimated_output_tokens: estimatesSafe.estimated_output_tokens,
    estimated_total_tokens: estimatesSafe.estimated_total_tokens,
    estimated_total_cost_minor_units: estimatesSafe.estimated_total_cost_minor_units,
    package_fingerprint: packageDigest,
    package_digest: packageDigest
  });

  const result_ = buildRuntimeExecutionSimulationResult({
    runtime_result_id: `${runtimeRequestId}-result`,
    runtime_request_id: runtimeRequestId,
    runtime_decision_id: decision.runtime_decision_id,
    runtime_execution_package_id: runtimeExecutionPackageId,
    execution_plan_id: decision.execution_plan_id,
    gateway_decision_id: decision.gateway_decision_id,
    gateway_result_id: decision.gateway_result_id,
    tenant_id: decision.tenant_id,
    organization_id: decision.organization_id,
    project_id: decision.project_id,
    session_reference_id: decision.session_reference_id,
    agent_id: decision.agent_id,
    actor_id: decision.actor_id,
    status,
    runtime_request_fingerprint: decision.runtime_request_fingerprint,
    runtime_decision_fingerprint: computeCanonicalContentDigest(decision),
    runtime_package_fingerprint: decision.runtime_package_fingerprint,
    runtime_package_digest: decision.runtime_package_digest,
    registry_version: String(requestSafe.expected_runtime_registry_version || 'registry_version_not_available'),
    runtime_stage_count: runtimeStageManifestSafe.runtime_stage_count || 0,
    runtime_dependency_count: runtimeDependencyManifestSafe.runtime_dependency_count || 0,
    runtime_stop_count: (runtimeStopRefs || []).length,
    runtime_compensation_count: (runtimeCompensationRefs || []).length,
    planned_artifact_count: runtimeArtifactPlanSafe.artifact_count || 0,
    planned_event_count: runtimeEventPlanSafe.event_count || 0,
    estimated_input_tokens: estimatesSafe.estimated_input_tokens,
    estimated_output_tokens: estimatesSafe.estimated_output_tokens,
    estimated_total_tokens: estimatesSafe.estimated_total_tokens,
    estimated_total_cost_minor_units: estimatesSafe.estimated_total_cost_minor_units,
    blockers: reasonCodes,
    reason_codes: reasonCodes
  });

  const audit = buildRuntimeExecutionSimulationAudit({
    decision, result: result_,
    runtimeDecisionFingerprint: result_.runtime_decision_fingerprint,
    runtimeStageCount: runtimeStageManifestSafe.runtime_stage_count,
    modelStageCount: runtimeStageManifestSafe.model_stage_count,
    toolStageCount: runtimeStageManifestSafe.tool_stage_count,
    workflowStageCount: runtimeStageManifestSafe.workflow_stage_count,
    runtimeDependencyCount: runtimeDependencyManifestSafe.runtime_dependency_count,
    cycleFreeCount: runtimeDependencyManifestSafe.cycle_free === true ? runtimeDependencyManifestSafe.runtime_dependency_count : 0,
    blockedDependencyCount: 0,
    estimatedInputTokens: estimatesSafe.estimated_input_tokens,
    estimatedOutputTokens: estimatesSafe.estimated_output_tokens,
    estimatedTotalTokens: estimatesSafe.estimated_total_tokens,
    estimatedTotalCostMinorUnits: estimatesSafe.estimated_total_cost_minor_units,
    runtimeStopCount: (runtimeStopRefs || []).length,
    runtimeCompensationCount: (runtimeCompensationRefs || []).length,
    plannedArtifactCount: runtimeArtifactPlanSafe.artifact_count,
    plannedEventCount: runtimeEventPlanSafe.event_count,
    logicalSequence: requestSafe.logical_sequence
  });

  return { decision, result: result_, runtimePackage, audit };
}

module.exports = {
  FINGERPRINT_FIELDS,
  ID_FIELDS,
  MAX_LIST_ITEMS,
  RUNTIME_EXECUTION_PACKAGE_FIELDS,
  RUNTIME_EXECUTION_PACKAGE_SAFE_FLAGS,
  RUNTIME_EXECUTION_PACKAGE_VALIDATOR_VERSION,
  buildRuntimeExecutionPackage,
  checkIdentity,
  computeRuntimePackageDigest,
  evaluateRuntimeExecutionSimulationRequest,
  validateRuntimeExecutionPackage
};

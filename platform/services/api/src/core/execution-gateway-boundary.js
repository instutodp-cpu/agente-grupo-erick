'use strict';

const { isPlainObject } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { validateExecutionGatewayRequest } = require('./execution-gateway-request');
const { buildExecutionGatewayDecision } = require('./execution-gateway-decision');
const { buildExecutionGatewayResult } = require('./execution-gateway-result');
const { buildExecutionGatewayAudit } = require('./execution-gateway-audit');

// pr102: the Execution Gateway Boundary -- the last declarative fronteira before a future Runtime
// Execution Simulation. Receives an already fully prepared, validated, and bound Execution Plan
// package and decides only whether it may be accepted for simulation
// (GATEWAY_ACCEPTED_SIMULATION) or must be blocked for review/rebuild/refresh. Never executes,
// never dispatches, never starts a stage, never calls an agent/model/provider/tool/workflow,
// never loads memory, never opens a network connection, never creates a job/queue/worker.
//
// "Gateway não pode confiar apenas em flags" -- every cross-check below re-derives or recomputes
// something (an id match, a recomputed fingerprint, a recomputed digest) rather than trusting a
// single boolean the caller could have hand-constructed. context is never read for any decision
// (see step 26 / the dedicated side-channel tests) -- the same "no side-channel" discipline every
// engine since PR #98fix has observed.

function safeFingerprint(value) {
  try {
    return stablePayload(value === undefined || value === null ? null : value);
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

// The exact canonical bundle shape used both to compute a package_digest at construction time
// (see the fixture builder / any future caller) and to recompute-and-compare it here -- key order
// never matters (stablePayload sorts), but the key *set* must always match exactly.
function computeGatewayPackageDigest({
  plan, result, authorizationDecision, provenanceReference, scopeReference, snapshotReference,
  stageManifestReference, dependencyGraphReference, bindingLedger, validationLedger, evidenceReference
}) {
  return computeCanonicalContentDigest({
    plan, result, authorizationDecision, provenanceReference, scopeReference, snapshotReference,
    stageManifestReference, dependencyGraphReference, bindingLedger, validationLedger, evidenceReference
  });
}

// Mirrors execution-plan-engine.js's own checkBinding -- tenant/organization always checked;
// project/session/agent/actor only checked against a reference when that reference actually
// carries the corresponding field (several gateway-level references, like
// ArchitectureGateEvidenceReference/FreshnessReference/ReplayReference, carry none of them at
// all, by design -- they are not tenant-scoped objects).
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

function evaluateExecutionGatewayRequest(request, context = {}) {
  const validatedFlags = {};
  function markValid(flag) {
    validatedFlags[flag] = true;
  }

  // Every nested reference is extracted defensively (request may not even be a plain object yet
  // -- the structural check below is what actually enforces that) so that `finalize`/`base` can be
  // used for the VALIDATION_FAILED early return exactly like every other status, instead of
  // crashing before either exists.
  const requestIsObject = isPlainObject(request);
  const policy = requestIsObject ? request.gateway_policy : undefined;
  const packageRef = requestIsObject ? request.gateway_package_reference : undefined;
  const plan = requestIsObject ? request.execution_plan_reference : undefined;
  const result = requestIsObject ? request.execution_plan_result_reference : undefined;
  const authorizationDecision = requestIsObject ? request.authorization_decision_reference : undefined;
  const provenanceReference = requestIsObject ? request.authorization_provenance_reference : undefined;
  const scopeReference = requestIsObject ? request.authorization_scope_reference : undefined;
  const snapshotReference = requestIsObject ? request.registry_snapshot_reference : undefined;
  const stageManifestReference = requestIsObject ? request.stage_manifest_reference : undefined;
  const dependencyGraphReference = requestIsObject ? request.dependency_graph_reference : undefined;
  const bindingLedger = requestIsObject ? request.binding_ledger_reference : undefined;
  const validationLedger = requestIsObject ? request.validation_ledger_reference : undefined;
  const evidenceReference = requestIsObject ? request.architecture_gate_evidence_reference : undefined;
  const freshnessReference = requestIsObject ? request.freshness_reference : undefined;
  const replayReference = requestIsObject ? request.replay_reference : undefined;

  const canonical = {
    tenantId: isPlainObject(plan) ? plan.tenant_id : undefined,
    organizationId: isPlainObject(plan) ? plan.organization_id : undefined,
    projectId: isPlainObject(plan) ? plan.project_id : undefined,
    sessionId: isPlainObject(plan) ? plan.session_reference_id : undefined,
    agentId: isPlainObject(plan) ? plan.agent_id : undefined,
    actorId: isPlainObject(packageRef) ? packageRef.actor_id : undefined
  };

  // pr102: both the request and the package reference already embed several already-large
  // fingerprints of their own (plan.plan_fingerprint alone is a canonical package fingerprint
  // covering every stage/binding/dependency in the plan) -- a plain stablePayload fingerprint of
  // either would re-serialize all of that content again, and this value then gets embedded as a
  // field on the decision, which is itself fingerprinted again for the result, and that again on
  // the audit. computeCanonicalContentDigest (a fixed ~71-character SHA-256 digest, the same fix
  // PR #100 applied to BindingRecord.source_reference_fingerprint for the identical reason) is
  // used here instead of the raw canonical payload fingerprint every other reference in this
  // codebase self-fingerprints with, to avoid that exact compounding-through-downstream-layers
  // blowup. See docs "Limitações". computeCanonicalContentDigest never throws (it degrades to a
  // `digest_invalid::...` string), so this is safe even when request/packageRef are malformed.
  const requestFingerprint = computeCanonicalContentDigest(request);
  const gatewayPackageFingerprint = computeCanonicalContentDigest(packageRef);

  const base = {
    request, requestFingerprint, gatewayPackageFingerprint, canonical, policy, packageRef, plan, result,
    authorizationDecision, provenanceReference, scopeReference, snapshotReference, stageManifestReference,
    dependencyGraphReference, bindingLedger, validationLedger, evidenceReference, freshnessReference, replayReference
  };

  function finalize(status, reasonCodes, extra, flags) {
    return buildOutcome(status, reasonCodes, { ...base, ...extra }, flags);
  }

  // 1-2. request contract shape, including gateway_policy/gateway_package_reference/every nested
  // reference and simulation_context, all as nested fields of the request itself -- no
  // side-channel is ever consulted here, matching every engine since PR #98fix.
  const requestValidation = validateExecutionGatewayRequest(request);
  if (!requestValidation.valid) {
    return finalize('VALIDATION_FAILED', ['execution_gateway_request_invalid'], {}, validatedFlags);
  }
  markValid('request_validated');

  // simulation_context is validated as a nested field of the same request structural check above.
  // policy_validated is NOT marked here -- gateway_policy's own exact-fields shape is already
  // covered by request_validated (validateExecutionGatewayRequest calls
  // validateExecutionGatewayPolicy), but that is structural completeness, not semantic approval.
  // It is only marked true once every semantic policy check the package actually triggers (the
  // policy-driven package-shape block near the end of this function) has genuinely passed -- a
  // POLICY_BLOCKED outcome must never carry policy_validated=true.

  // 4. execution plan.
  if (plan.execution_plan_status !== 'EXECUTION_PLAN_PREPARED_SIMULATION' || plan.execution_plan_prepared !== true) {
    return finalize('EXECUTION_PLAN_BLOCKED', ['execution_plan_not_prepared'], {}, validatedFlags);
  }
  if (
    plan.executable !== false || plan.execution_authorized !== false || plan.execution_started !== false
    || plan.executed !== false || plan.runtime_enabled !== false || plan.simulation !== true
    || plan.production_blocked !== true || plan.rollout_percentage !== 0
  ) {
    return finalize('EXECUTION_PLAN_BLOCKED', ['execution_plan_operational_invariant_violated'], {}, validatedFlags);
  }
  markValid('execution_plan_validated');

  // 5. execution plan result.
  if (
    result.status !== 'EXECUTION_PLAN_PREPARED_SIMULATION' || result.execution_plan_prepared !== true
    || result.validation_pipeline_completed !== true || result.all_required_validations_valid !== true
    || result.references_bound_in_simulation !== true
  ) {
    return finalize('EXECUTION_PLAN_RESULT_BLOCKED', ['execution_plan_result_not_prepared'], {}, validatedFlags);
  }
  if (
    result.executable !== false || result.execution_authorized !== false || result.execution_started !== false
    || result.executed !== false || result.runtime_enabled !== false || result.simulation !== true
    || result.production_blocked !== true || result.rollout_percentage !== 0
  ) {
    return finalize('EXECUTION_PLAN_RESULT_BLOCKED', ['execution_plan_result_operational_invariant_violated'], {}, validatedFlags);
  }
  if (result.execution_plan_id !== plan.execution_plan_id) {
    return finalize('EXECUTION_PLAN_RESULT_BLOCKED', ['execution_plan_result_plan_id_mismatch'], {}, validatedFlags);
  }
  markValid('execution_plan_result_validated');

  // 6. package reference: every id/status this reference declares must agree with the real
  // objects the request actually carries -- never trusted on its own.
  const packageIdChecks = [
    [packageRef.execution_plan_id, plan.execution_plan_id, 'package_reference_execution_plan_id_mismatch'],
    [packageRef.execution_plan_result_id, result.result_id, 'package_reference_execution_plan_result_id_mismatch'],
    [packageRef.authorization_decision_id, authorizationDecision.authorization_decision_id, 'package_reference_authorization_decision_id_mismatch'],
    [packageRef.authorization_provenance_reference_id, provenanceReference.authorization_provenance_reference_id, 'package_reference_provenance_id_mismatch'],
    [packageRef.authorization_scope_reference_id, scopeReference.authorization_scope_reference_id, 'package_reference_scope_id_mismatch'],
    [packageRef.registry_snapshot_reference_id, snapshotReference.registry_snapshot_reference_id, 'package_reference_snapshot_id_mismatch'],
    [packageRef.stage_manifest_reference_id, stageManifestReference.stage_manifest_reference_id, 'package_reference_stage_manifest_id_mismatch'],
    [packageRef.dependency_graph_reference_id, dependencyGraphReference.dependency_graph_reference_id, 'package_reference_dependency_graph_id_mismatch'],
    [packageRef.binding_ledger_id, bindingLedger.binding_ledger_id, 'package_reference_binding_ledger_id_mismatch'],
    [packageRef.validation_ledger_id, validationLedger.validation_ledger_id, 'package_reference_validation_ledger_id_mismatch'],
    [packageRef.architecture_gate_evidence_reference_id, evidenceReference.architecture_gate_evidence_reference_id, 'package_reference_evidence_id_mismatch']
  ];
  for (const [declared, actual, reason] of packageIdChecks) {
    if (declared !== actual) return finalize('PACKAGE_REFERENCE_BLOCKED', [reason], {}, validatedFlags);
  }
  if (packageRef.package_reference_validated !== true) {
    return finalize('PACKAGE_REFERENCE_BLOCKED', ['package_reference_not_validated'], {}, validatedFlags);
  }
  markValid('package_reference_validated');

  // 7-12. tenant / organização / projeto / sessão / agent / actor, across every reference that
  // actually carries the corresponding field.
  const identityChecks = [
    ['execution_plan_result_reference', result], ['authorization_decision_reference', authorizationDecision],
    ['authorization_provenance_reference', provenanceReference], ['authorization_scope_reference', scopeReference],
    ['registry_snapshot_reference', snapshotReference], ['stage_manifest_reference', stageManifestReference],
    ['dependency_graph_reference', dependencyGraphReference], ['binding_ledger_reference', bindingLedger],
    ['validation_ledger_reference', validationLedger]
  ];
  for (const [label, reference] of identityChecks) {
    const mismatch = checkIdentity(reference, canonical, label);
    if (mismatch) return finalize(mismatch.status, [mismatch.reason], {}, validatedFlags);
  }
  markValid('identity_validated');

  // 13. authorization decision.
  if (authorizationDecision.status !== 'AUTHORIZED_SIMULATION' || authorizationDecision.authorization_decision_id !== plan.authorization_decision_id) {
    return finalize('AUTHORIZATION_BLOCKED', ['authorization_decision_not_authorized_or_mismatched'], {}, validatedFlags);
  }
  if (
    authorizationDecision.execution_authorized !== false || authorizationDecision.execution_started !== false
    || authorizationDecision.executed !== false || authorizationDecision.runtime_enabled !== false
    || authorizationDecision.simulation !== true || authorizationDecision.production_blocked !== true
  ) {
    return finalize('AUTHORIZATION_BLOCKED', ['authorization_decision_operational_invariant_violated'], {}, validatedFlags);
  }
  markValid('authorization_validated');

  // 14. authorization provenance.
  if (
    provenanceReference.authorization_provenance_reference_id !== plan.authorization_provenance_reference_id
    || provenanceReference.authorization_decision_id !== authorizationDecision.authorization_decision_id
    || provenanceReference.provenance_validated !== true
  ) {
    return finalize('AUTHORIZATION_PROVENANCE_BLOCKED', ['authorization_provenance_not_validated_or_mismatched'], {}, validatedFlags);
  }
  markValid('authorization_provenance_validated');

  // 15. authorization scope.
  if (
    scopeReference.authorization_scope_reference_id !== plan.authorization_scope_reference_id
    || scopeReference.authorization_decision_id !== authorizationDecision.authorization_decision_id
    || scopeReference.scope_validated !== true
  ) {
    return finalize('AUTHORIZATION_SCOPE_BLOCKED', ['authorization_scope_not_validated_or_mismatched'], {}, validatedFlags);
  }
  markValid('authorization_scope_validated');

  // 16. registry snapshot.
  if (
    snapshotReference.registry_snapshot_reference_id !== plan.registry_snapshot_reference_id
    || snapshotReference.execution_plan_id !== plan.execution_plan_id
    || snapshotReference.snapshot_consistent !== true || snapshotReference.snapshot_validated !== true
  ) {
    return finalize('REGISTRY_SNAPSHOT_BLOCKED', ['registry_snapshot_not_consistent_or_mismatched'], {}, validatedFlags);
  }
  markValid('registry_snapshot_validated');

  // 17. stage manifest.
  if (
    stageManifestReference.stage_manifest_reference_id !== plan.stage_manifest_reference_id
    || stageManifestReference.orchestration_plan_id !== plan.orchestration_plan_id
  ) {
    return finalize('STAGE_MANIFEST_BLOCKED', ['stage_manifest_reference_mismatched'], {}, validatedFlags);
  }
  markValid('stage_manifest_validated');

  // 18. dependency graph.
  if (
    dependencyGraphReference.dependency_graph_reference_id !== packageRef.dependency_graph_reference_id
    || dependencyGraphReference.execution_plan_id !== plan.execution_plan_id
  ) {
    return finalize('DEPENDENCY_BLOCKED', ['dependency_graph_reference_mismatched'], {}, validatedFlags);
  }
  markValid('dependency_graph_validated');

  // 19. binding ledger.
  if (
    bindingLedger.binding_ledger_id !== plan.binding_ledger_id || bindingLedger.execution_plan_id !== plan.execution_plan_id
    || bindingLedger.references_bound_in_simulation !== true || bindingLedger.all_required_bindings_present !== true
    || bindingLedger.all_bindings_validated !== true || bindingLedger.blocked_binding_count !== 0
    || bindingLedger.bindings_applied !== false || bindingLedger.execution_authorized !== false
    || bindingLedger.execution_started !== false
  ) {
    return finalize('REFERENCE_BINDING_BLOCKED', ['binding_ledger_not_fully_bound_or_mismatched'], {}, validatedFlags);
  }
  markValid('binding_ledger_validated');

  // 20. validation ledger.
  if (
    validationLedger.validation_ledger_id !== plan.validation_ledger_id
    || validationLedger.pipeline_completed !== true || validationLedger.all_required_validations_valid !== true
    || validationLedger.invalid_count !== 0 || validationLedger.blocking_count !== 0
    || validationLedger.terminal_count !== 0 || validationLedger.not_evaluated_count !== 0
    || validationLedger.first_blocking_stage !== null || validationLedger.first_blocking_status !== null
  ) {
    return finalize('VALIDATION_LEDGER_BLOCKED', ['validation_ledger_not_fully_valid_or_mismatched'], {}, validatedFlags);
  }
  markValid('validation_ledger_validated');

  // 21. architecture gate evidence -- never queries GitHub; only validates the declarative
  // evidence already carried by the request.
  if (
    evidenceReference.architecture_gate_evidence_reference_id !== packageRef.architecture_gate_evidence_reference_id
    || evidenceReference.evidence_status !== 'ARCHITECTURE_GATES_PASSED_SIMULATION'
    || evidenceReference.evidence_validated !== true || evidenceReference.expired_logically !== false
    || evidenceReference.all_required_gates_passed !== true || evidenceReference.failed_gate_count !== 0
  ) {
    return finalize('ARCHITECTURE_GATE_EVIDENCE_BLOCKED', ['architecture_gate_evidence_not_valid_or_mismatched'], {}, validatedFlags);
  }
  markValid('architecture_gate_evidence_validated');

  // 22. package fingerprints -- every sub-fingerprint the package reference declares is compared
  // against the real, freshly-read field on the actual referenced object. Never trusted as
  // declared.
  const fingerprintChecks = [
    [packageRef.execution_plan_fingerprint, plan.plan_fingerprint],
    [packageRef.execution_plan_result_fingerprint, result.execution_plan_fingerprint],
    [packageRef.authorization_fingerprint, safeFingerprint(authorizationDecision)],
    [packageRef.authorization_provenance_fingerprint, plan.authorization_provenance_fingerprint],
    [packageRef.authorization_scope_fingerprint, scopeReference.scope_fingerprint],
    [packageRef.registry_snapshot_fingerprint, snapshotReference.snapshot_fingerprint],
    [packageRef.stage_manifest_fingerprint, stageManifestReference.manifest_fingerprint],
    [packageRef.dependency_graph_fingerprint, dependencyGraphReference.graph_fingerprint],
    [packageRef.binding_ledger_fingerprint, bindingLedger.ledger_fingerprint],
    [packageRef.validation_ledger_fingerprint, validationLedger.ledger_fingerprint],
    [packageRef.architecture_gate_evidence_fingerprint, evidenceReference.evidence_fingerprint]
  ];
  if (fingerprintChecks.some(([declared, actual]) => declared !== actual)) {
    return finalize('PACKAGE_FINGERPRINT_BLOCKED', ['package_sub_fingerprint_mismatch'], {}, validatedFlags);
  }
  markValid('package_fingerprint_validated');

  // 23. package digest -- a compact recomputation over the full canonical bundle, using the exact
  // same shape computeGatewayPackageDigest always uses. Any change anywhere in the bundle changes
  // the digest.
  const recomputedDigest = computeGatewayPackageDigest({
    plan, result, authorizationDecision, provenanceReference, scopeReference, snapshotReference,
    stageManifestReference, dependencyGraphReference, bindingLedger, validationLedger, evidenceReference
  });
  if (recomputedDigest !== packageRef.package_digest) {
    return finalize('PACKAGE_DIGEST_BLOCKED', ['package_digest_mismatch'], {}, validatedFlags);
  }
  markValid('package_digest_validated');

  // 24. freshness.
  if (
    freshnessReference.execution_plan_id !== plan.execution_plan_id
    || freshnessReference.authorization_decision_id !== authorizationDecision.authorization_decision_id
    || freshnessReference.registry_snapshot_reference_id !== snapshotReference.registry_snapshot_reference_id
    || freshnessReference.architecture_gate_evidence_reference_id !== evidenceReference.architecture_gate_evidence_reference_id
    || freshnessReference.freshness_validated !== true
  ) {
    return finalize('FRESHNESS_BLOCKED', ['freshness_not_validated_or_mismatched'], {}, validatedFlags);
  }
  markValid('freshness_validated');

  // 25. replay.
  if (
    replayReference.execution_plan_id !== plan.execution_plan_id
    || replayReference.execution_plan_fingerprint !== plan.plan_fingerprint
    || replayReference.gateway_request_id !== request.gateway_request_id
    || replayReference.replay_allowed !== true || replayReference.replay_validated !== true
    || replayReference.replay_consumed !== false || replayReference.duplicate_gateway_acceptance_blocked !== true
  ) {
    return finalize('REPLAY_BLOCKED', ['replay_not_validated_or_mismatched'], {}, validatedFlags);
  }
  markValid('replay_validated');

  // policy-driven package-shape checks, now that every structural/cross-check has passed.
  // pr102fix: NO_LLM is defined by the *absence of a model reference*, never by the number of
  // stage records. A genuinely NO_LLM/deterministic package still legitimately carries
  // VALIDATION_STAGE/DETERMINISTIC_STAGE/AUDIT_STAGE/FINALIZATION_STAGE/etc. records --
  // `stageTypes.size === 0` was never a real signal and left every real NO_LLM package
  // unclassified (silently skipping the allow_no_llm_package check entirely).
  const stageRecords = stageManifestReference.stage_records || [];
  const stageTypes = new Set(stageRecords.map((record) => record.stage_type));

  // Fail-closed consistency between stage_type and model_selection_reference_id: a
  // MODEL_REFERENCE_STAGE record with no model reference, or a model reference attached to any
  // other stage type, is an internally inconsistent package -- blocked before classification even
  // runs, never silently reclassified either way.
  for (const record of stageRecords) {
    const hasModelReference = record.model_selection_reference_id !== null && record.model_selection_reference_id !== undefined;
    if (record.stage_type === 'MODEL_REFERENCE_STAGE' && !hasModelReference) {
      return finalize('POLICY_BLOCKED', ['model_reference_stage_missing_model_selection_reference'], {}, validatedFlags);
    }
    if (record.stage_type !== 'MODEL_REFERENCE_STAGE' && hasModelReference) {
      return finalize('POLICY_BLOCKED', ['model_selection_reference_outside_model_reference_stage'], {}, validatedFlags);
    }
  }

  const hasModelStage = stageTypes.has('MODEL_REFERENCE_STAGE');
  const hasStageModelReference = stageRecords.some((record) => record.model_selection_reference_id !== null && record.model_selection_reference_id !== undefined);
  // Never selects or changes a model -- purely a classification of the package the request
  // already carries. Tool/workflow packages remain NO_LLM whenever they carry no model stage.
  const isNoLlmPackage = !hasModelStage && !hasStageModelReference;

  if (isNoLlmPackage && policy.allow_no_llm_package !== true) {
    return finalize('POLICY_BLOCKED', ['no_llm_package_not_allowed_by_policy'], {}, validatedFlags);
  }
  if (hasModelStage && policy.allow_model_reference_package !== true) {
    return finalize('POLICY_BLOCKED', ['model_reference_package_not_allowed_by_policy'], {}, validatedFlags);
  }
  if (stageTypes.has('TOOL_REFERENCE_STAGE') && policy.allow_tool_reference_package !== true) {
    return finalize('POLICY_BLOCKED', ['tool_reference_package_not_allowed_by_policy'], {}, validatedFlags);
  }
  if (stageTypes.has('WORKFLOW_REFERENCE_STAGE') && policy.allow_workflow_reference_package !== true) {
    return finalize('POLICY_BLOCKED', ['workflow_reference_package_not_allowed_by_policy'], {}, validatedFlags);
  }
  const hasParallelDependency = (dependencyGraphReference.dependency_records || []).some((record) => record.dependency_type === 'PARALLEL_REFERENCE');
  if (hasParallelDependency && policy.allow_parallel_package !== true) {
    return finalize('POLICY_BLOCKED', ['parallel_package_not_allowed_by_policy'], {}, validatedFlags);
  }
  // pr102fix: policy_validated is only ever marked here, once every semantic check above that
  // this package actually triggers has genuinely passed. allow_waiting_approval_package/
  // allow_external_side_effect_reference/allow_irreversible_reference are forced-false SAFE_FLAGS
  // with no corresponding "requires waiting approval / external side effect / irreversible
  // action" signal anywhere in the package to cross-check against -- vacuously satisfied, the same
  // honest category as the require_*/fail_on_* flags (already enforced unconditionally by the
  // earlier steps in this pipeline that they name, never by a separate check here).
  markValid('policy_validated');

  // 26. non-execution invariants -- an explicit, final aggregate re-check that nothing anywhere in
  // the accepted bundle carries a live operational flag, on top of every individual check already
  // performed above.
  const operationalCarriers = [plan, result, authorizationDecision, provenanceReference, scopeReference, bindingLedger];
  const anyOperationalFlagLive = operationalCarriers.some((carrier) => (
    carrier.execution_authorized === true || carrier.execution_started === true || carrier.executed === true
    || (carrier.runtime_enabled !== undefined && carrier.runtime_enabled === true)
  ));
  if (anyOperationalFlagLive) {
    return finalize('VALIDATION_FAILED', ['non_execution_invariant_violated'], {}, validatedFlags);
  }
  markValid('non_execution_invariants_validated');

  // 27-28. emitir decisão e registrar auditoria -- GATEWAY_ACCEPTED_SIMULATION. Even here, no
  // execution is authorized: see buildOutcome()'s own forced OPERATIONAL_SAFE_FLAGS.
  return finalize('GATEWAY_ACCEPTED_SIMULATION', ['package_accepted_in_simulation_only'], {}, validatedFlags);
}

function buildOutcome(status, reasonCodes, ctx, validatedFlags) {
  const {
    request, requestFingerprint, gatewayPackageFingerprint, canonical, packageRef, plan, result,
    authorizationDecision, provenanceReference, scopeReference, snapshotReference, stageManifestReference,
    dependencyGraphReference, bindingLedger, validationLedger, evidenceReference, freshnessReference, replayReference
  } = ctx;

  const requestSafe = isPlainObject(request) ? request : {};
  const packageRefSafe = isPlainObject(packageRef) ? packageRef : {};
  const planSafe = isPlainObject(plan) ? plan : {};
  const resultSafe = isPlainObject(result) ? result : {};
  const authzSafe = isPlainObject(authorizationDecision) ? authorizationDecision : {};
  const provenanceSafe = isPlainObject(provenanceReference) ? provenanceReference : {};
  const scopeSafe = isPlainObject(scopeReference) ? scopeReference : {};
  const snapshotSafe = isPlainObject(snapshotReference) ? snapshotReference : {};
  const manifestSafe = isPlainObject(stageManifestReference) ? stageManifestReference : {};
  const depGraphSafe = isPlainObject(dependencyGraphReference) ? dependencyGraphReference : {};
  const bindingLedgerSafe = isPlainObject(bindingLedger) ? bindingLedger : {};
  const validationLedgerSafe = isPlainObject(validationLedger) ? validationLedger : {};
  const evidenceSafe = isPlainObject(evidenceReference) ? evidenceReference : {};
  const freshnessSafe = isPlainObject(freshnessReference) ? freshnessReference : {};
  const replaySafe = isPlainObject(replayReference) ? replayReference : {};
  const canonicalSafe = canonical || {};

  const decision = buildExecutionGatewayDecision({
    gateway_decision_id: `${requestSafe.gateway_request_id || 'gateway_request_not_available'}-decision`,
    gateway_request_id: requestSafe.gateway_request_id || 'gateway_request_not_available',
    gateway_package_reference_id: packageRefSafe.gateway_package_reference_id || 'gateway_package_reference_not_available',
    execution_plan_id: planSafe.execution_plan_id || 'execution_plan_not_available',
    execution_plan_result_id: resultSafe.result_id || 'execution_plan_result_not_available',
    authorization_decision_id: authzSafe.authorization_decision_id || 'authorization_decision_not_available',
    authorization_provenance_reference_id: provenanceSafe.authorization_provenance_reference_id || 'authorization_provenance_reference_not_available',
    authorization_scope_reference_id: scopeSafe.authorization_scope_reference_id || 'authorization_scope_reference_not_available',
    registry_snapshot_reference_id: snapshotSafe.registry_snapshot_reference_id || 'registry_snapshot_reference_not_available',
    stage_manifest_reference_id: manifestSafe.stage_manifest_reference_id || 'stage_manifest_reference_not_available',
    dependency_graph_reference_id: depGraphSafe.dependency_graph_reference_id || 'dependency_graph_reference_not_available',
    binding_ledger_id: bindingLedgerSafe.binding_ledger_id || 'binding_ledger_not_available',
    validation_ledger_id: validationLedgerSafe.validation_ledger_id || 'validation_ledger_not_available',
    architecture_gate_evidence_reference_id: evidenceSafe.architecture_gate_evidence_reference_id || 'architecture_gate_evidence_reference_not_available',
    freshness_reference_id: freshnessSafe.freshness_reference_id || 'freshness_reference_not_available',
    replay_reference_id: replaySafe.gateway_replay_reference_id || 'replay_reference_not_available',
    tenant_id: canonicalSafe.tenantId || 'tenant_not_available',
    organization_id: canonicalSafe.organizationId || 'organization_not_available',
    project_id: canonicalSafe.projectId || 'project_not_available',
    session_reference_id: canonicalSafe.sessionId || 'session_not_available',
    agent_id: canonicalSafe.agentId || 'agent_not_available',
    actor_id: canonicalSafe.actorId || 'actor_not_available',
    status,
    gateway_request_fingerprint: requestFingerprint || 'fingerprint_not_available',
    gateway_package_fingerprint: gatewayPackageFingerprint || 'fingerprint_not_available',
    execution_plan_fingerprint: planSafe.plan_fingerprint || 'fingerprint_not_available',
    execution_plan_result_fingerprint: resultSafe.execution_plan_fingerprint || 'fingerprint_not_available',
    authorization_fingerprint: isPlainObject(authorizationDecision) ? safeFingerprint(authorizationDecision) : 'fingerprint_not_available',
    authorization_provenance_fingerprint: planSafe.authorization_provenance_fingerprint || 'fingerprint_not_available',
    authorization_scope_fingerprint: scopeSafe.scope_fingerprint || 'fingerprint_not_available',
    registry_snapshot_fingerprint: snapshotSafe.snapshot_fingerprint || 'fingerprint_not_available',
    stage_manifest_fingerprint: manifestSafe.manifest_fingerprint || 'fingerprint_not_available',
    dependency_graph_fingerprint: depGraphSafe.graph_fingerprint || 'fingerprint_not_available',
    binding_ledger_fingerprint: bindingLedgerSafe.ledger_fingerprint || 'fingerprint_not_available',
    validation_ledger_fingerprint: validationLedgerSafe.ledger_fingerprint || 'fingerprint_not_available',
    architecture_gate_evidence_fingerprint: evidenceSafe.evidence_fingerprint || 'fingerprint_not_available',
    freshness_fingerprint: freshnessSafe.freshness_fingerprint || 'fingerprint_not_available',
    replay_fingerprint: replaySafe.replay_fingerprint || 'fingerprint_not_available',
    package_digest: packageRefSafe.package_digest || 'digest_not_available',
    gateway_registry_version: String(requestSafe.expected_gateway_registry_version || 'registry_version_not_available'),
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    ...validatedFlags
  });

  const result_ = buildExecutionGatewayResult({
    gateway_result_id: `${requestSafe.gateway_request_id || 'gateway_request_not_available'}-result`,
    gateway_request_id: decision.gateway_request_id,
    gateway_decision_id: decision.gateway_decision_id,
    gateway_package_reference_id: decision.gateway_package_reference_id,
    execution_plan_id: decision.execution_plan_id,
    execution_plan_result_id: decision.execution_plan_result_id,
    tenant_id: decision.tenant_id,
    organization_id: decision.organization_id,
    project_id: decision.project_id,
    session_reference_id: decision.session_reference_id,
    agent_id: decision.agent_id,
    actor_id: decision.actor_id,
    status,
    gateway_request_fingerprint: decision.gateway_request_fingerprint,
    // Same compounding concern as requestFingerprint/gatewayPackageFingerprint above -- decision
    // already carries gateway_request_fingerprint/gateway_package_fingerprint as plain field
    // values, so a raw canonical payload fingerprint of decision would re-embed all of that again.
    gateway_decision_fingerprint: computeCanonicalContentDigest(decision),
    gateway_package_fingerprint: decision.gateway_package_fingerprint,
    execution_plan_fingerprint: decision.execution_plan_fingerprint,
    architecture_gate_evidence_fingerprint: decision.architecture_gate_evidence_fingerprint,
    package_digest: decision.package_digest,
    registry_version: decision.gateway_registry_version,
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    validation_ledger_id: decision.validation_ledger_id,
    validation_ledger_fingerprint: decision.validation_ledger_fingerprint
  });

  const audit = buildExecutionGatewayAudit({
    decision, result: result_,
    gatewayDecisionFingerprint: result_.gateway_decision_fingerprint,
    gateCount: evidenceSafe.gate_count, passedGateCount: evidenceSafe.passed_gate_count,
    failedGateCount: evidenceSafe.failed_gate_count, warningGateCount: evidenceSafe.warning_gate_count,
    validCount: validationLedgerSafe.valid_count, invalidCount: validationLedgerSafe.invalid_count,
    notApplicableCount: validationLedgerSafe.not_applicable_count, notEvaluatedCount: validationLedgerSafe.not_evaluated_count,
    bindingCount: bindingLedgerSafe.binding_count, requiredBindingCount: bindingLedgerSafe.required_binding_count,
    validatedBindingCount: bindingLedgerSafe.validated_binding_count, blockedBindingCount: bindingLedgerSafe.blocked_binding_count,
    logicalSequence: requestSafe.logical_sequence
  });

  return { decision, result: result_, audit };
}

module.exports = {
  checkIdentity,
  computeGatewayPackageDigest,
  evaluateExecutionGatewayRequest
};

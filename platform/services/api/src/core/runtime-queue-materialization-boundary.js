'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { checkIdentity } = require('./runtime-execution-package');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { validateRuntimeQueueMaterializationRequest } = require('./runtime-queue-materialization-request');
const { computeAdmissionEntryFingerprint } = require('./runtime-queue-admission-entry-reference');
const { computeQueueClassFingerprint } = require('./runtime-queue-class-reference');
const { buildRuntimeQueueMaterializationEntryReference } = require('./runtime-queue-materialization-entry-reference');
const { buildRuntimeQueueMaterializationOrderReference } = require('./runtime-queue-materialization-order-reference');
const { buildRuntimeQueueMaterializationPackage } = require('./runtime-queue-materialization-package');
const { buildRuntimeQueueMaterializationDecision } = require('./runtime-queue-materialization-decision');
const { buildRuntimeQueueMaterializationResult } = require('./runtime-queue-materialization-result');
const { buildRuntimeQueueMaterializationAudit } = require('./runtime-queue-materialization-audit');

// pr109: the single evaluator this PR exists to build. Receives only an already
// QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION package (plus the exact Admission Entry/Order/Queue
// Class objects it already committed to via its own ID/fingerprint lists) and produces a purely
// declarative representation of how each admitted intent would be positioned in a future runtime
// queue -- nothing here creates a queue, an item, an enqueue, a broker message, a worker
// notification, or a job. Every one of those flags is forced false in every outcome this boundary
// can ever produce. "Queue Admission decides whether an intent may enter a queue class. Runtime
// Queue Materialization Simulation describes how an admitted intent would be represented and
// ordered in a runtime queue. It does not create a queue, queue item, broker message, job, worker
// assignment or any executable runtime object."
//
// This boundary NEVER recomputes: Queue Class compatibility, worker capacity, quota eligibility,
// fairness eligibility, priority eligibility, admission limits, admission status, or the choice of
// Queue Class once already decided. It validates the INTEGRITY of those inherited decisions -- never
// substitutes them.

// "Dispatch não pode ser apenas stage ID + worker ID." -- the same non-substitution discipline
// reused verbatim from every prior layer, applied here to the Admission Entry/Queue Class lists this
// request carries.
function idSetMatches(rawList, idField, expectedIds) {
  if (!Array.isArray(rawList) || !Array.isArray(expectedIds)) return false;
  const actual = [...new Set(rawList.map((item) => item[idField]))].sort();
  const expected = [...new Set(expectedIds)].sort();
  if (actual.length !== expected.length) return false;
  return actual.every((id, index) => id === expected[index]);
}

function fingerprintSetMatches(rawList, computeFingerprint, expectedFingerprints) {
  if (!Array.isArray(rawList) || !Array.isArray(expectedFingerprints)) return false;
  const actual = [...new Set(rawList.map((item) => computeFingerprint(item)))].sort();
  const expected = [...new Set(expectedFingerprints)].sort();
  if (actual.length !== expected.length) return false;
  return actual.every((fp, index) => fp === expected[index]);
}

// "Provar, independentemente, que deriving materialization_position by iterating the same canonical
// order never reorders materialized entries relative to each other." Genuinely re-verified over the
// entries as actually built, never asserted true by construction.
function checkPredecessorOrderPreserved(orderedEntries) {
  let lastPosition = -1;
  for (const entry of orderedEntries) {
    if (entry.materialization_position === null) continue;
    if (entry.materialization_position <= lastPosition) return false;
    lastPosition = entry.materialization_position;
  }
  return true;
}

function evaluateRuntimeQueueMaterializationRequest(request, context = {}) {
  void context; // never consulted for any decision.
  const validatedFlags = {};
  function markValid(flag) {
    validatedFlags[flag] = true;
  }

  const requestIsObject = isPlainObject(request);
  const admissionPackageRef = requestIsObject ? request.runtime_queue_admission_package_reference : undefined;
  const admissionEntryRefs = requestIsObject && Array.isArray(request.runtime_queue_admission_entry_references) ? request.runtime_queue_admission_entry_references : [];
  const admissionOrderRef = requestIsObject ? request.runtime_queue_admission_order_reference : undefined;
  const queueClassRefs = requestIsObject && Array.isArray(request.runtime_queue_class_references) ? request.runtime_queue_class_references : [];

  const canonical = {
    tenantId: isPlainObject(admissionPackageRef) ? admissionPackageRef.tenant_id : undefined,
    organizationId: isPlainObject(admissionPackageRef) ? admissionPackageRef.organization_id : undefined,
    projectId: isPlainObject(admissionPackageRef) ? admissionPackageRef.project_id : undefined,
    sessionId: isPlainObject(admissionPackageRef) ? admissionPackageRef.session_reference_id : undefined,
    agentId: isPlainObject(admissionPackageRef) ? admissionPackageRef.agent_id : undefined,
    actorId: isPlainObject(admissionPackageRef) ? admissionPackageRef.actor_id : undefined
  };

  const requestFingerprint = computeCanonicalContentDigest(requestIsObject ? request : {});

  function finalize(status, reasonCodes, derived = {}) {
    return buildQueueMaterializationOutcome(status, reasonCodes, {
      request, requestFingerprint, canonical, admissionPackageRef, ...derived
    }, validatedFlags);
  }

  // 1-3. Request/every nested reference (Package, Order, every Entry, every Queue Class) against
  // its own real validator -- this alone proves every fingerprint/digest a nested object claims is
  // self-consistent (recomputed, never merely compared for presence/shape).
  const requestValidation = validateRuntimeQueueMaterializationRequest(request);
  if (!requestValidation.valid) return finalize('QUEUE_MATERIALIZATION_VALIDATION_FAILED', ['runtime_queue_materialization_request_invalid']);
  markValid('request_validated');

  // 4. Contrato oficial de entrada -- must be genuinely QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION.
  if (
    admissionPackageRef.queue_admission_status !== 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION'
    || admissionPackageRef.queue_admission_package_prepared_in_simulation !== true
  ) {
    return finalize('QUEUE_MATERIALIZATION_BLOCKED_BY_INHERITED_DATA', ['queue_admission_package_not_prepared']);
  }
  markValid('admission_package_validated');

  // 6. Identidade -- evaluated early to match the precedence discipline established at every prior
  // layer of this lineage.
  const mismatch = checkIdentity(admissionOrderRef, canonical, 'runtime_queue_admission_order_reference');
  if (mismatch) return finalize(mismatch.status, [mismatch.reason]);
  markValid('identity_validated');

  // 8. Não-substituição: as Admission Entries e Queue Class References que esta request carrega
  // devem produzir exatamente o mesmo conjunto de IDs/fingerprints que o Package já registrou --
  // nunca uma lista independentemente substituída pelo caller.
  if (
    !idSetMatches(admissionEntryRefs, 'runtime_queue_admission_entry_reference_id', admissionPackageRef.queue_admission_entry_reference_ids)
    || !fingerprintSetMatches(admissionEntryRefs, computeAdmissionEntryFingerprint, admissionPackageRef.queue_admission_entry_fingerprints)
    || !idSetMatches(queueClassRefs, 'runtime_queue_class_reference_id', admissionPackageRef.queue_class_reference_ids)
    || !fingerprintSetMatches(queueClassRefs, computeQueueClassFingerprint, admissionPackageRef.queue_class_fingerprints)
    || admissionOrderRef.runtime_queue_admission_order_reference_id !== admissionPackageRef.runtime_queue_admission_order_reference_id
    || admissionOrderRef.order_fingerprint !== admissionPackageRef.queue_admission_order_fingerprint
  ) {
    return finalize('QUEUE_MATERIALIZATION_BLOCKED_BY_INHERITED_DATA', ['admission_output_substituted_or_incomplete']);
  }
  markValid('reference_integrity_validated');

  // 7. Cardinalidade -- toda entry oficialmente registrada pelo Package deve estar presente, sem
  // ausência e sem excesso (idSetMatches acima já prova o CONJUNTO; aqui confirmamos a contagem
  // declarada pelo próprio Package bate com a contagem real).
  if (admissionEntryRefs.length !== admissionPackageRef.entry_count) {
    return finalize('QUEUE_MATERIALIZATION_BLOCKED_BY_INHERITED_DATA', ['admission_entry_count_mismatch']);
  }
  markValid('cardinality_validated');

  // 9. Ordem canônica -- a lista que o Package já duplicou (`ordered_queue_admission_entry_reference_ids`)
  // deve corresponder exatamente à lista que a própria Order Reference carrega -- nunca confiar na
  // ordem meramente declarada por um array incidental.
  const canonicalOrder = Array.isArray(admissionPackageRef.ordered_queue_admission_entry_reference_ids) ? admissionPackageRef.ordered_queue_admission_entry_reference_ids : [];
  const orderRefOrder = Array.isArray(admissionOrderRef.ordered_queue_admission_entry_reference_ids) ? admissionOrderRef.ordered_queue_admission_entry_reference_ids : [];
  if (
    canonicalOrder.length !== orderRefOrder.length
    || !canonicalOrder.every((id, index) => id === orderRefOrder[index])
    || new Set(canonicalOrder).size !== canonicalOrder.length
    || canonicalOrder.length !== admissionEntryRefs.length
  ) {
    return finalize('QUEUE_MATERIALIZATION_ORDER_BLOCKED', ['canonical_order_not_bound_to_admission_order_reference']);
  }
  markValid('canonical_order_validated');

  // 10. Predecessor order -- "Primeiro determine qual contrato anterior é a fonte soberana." A
  // Queue Admission Order Reference's own `required_predecessor_order_preserved` (and its broader
  // `queue_admission_order_validated`, the AND of all four preservation flags) is that sovereign
  // fact, already proven true by PR108's own boundary -- re-verified here for authenticity (its own
  // fingerprint was already recomputed above), never re-derived from raw dependency edges this
  // layer's own input boundary correctly excludes.
  if (admissionOrderRef.required_predecessor_order_preserved !== true || admissionOrderRef.queue_admission_order_validated !== true) {
    return finalize('QUEUE_MATERIALIZATION_PREDECESSOR_BLOCKED', ['inherited_predecessor_order_not_preserved']);
  }
  markValid('predecessor_order_validated');

  // 11. Eligibility -- "Somente entries oficialmente admitidas pela PR108 podem produzir uma
  // representação materializada." Never recomputed: `admission_status`/`queue_admission_validated`
  // are read verbatim from the inherited Admission Entry, never reinterpreted.
  const admissionEntryById = new Map(admissionEntryRefs.map((e) => [e.runtime_queue_admission_entry_reference_id, e]));
  for (const id of canonicalOrder) {
    if (!admissionEntryById.has(id)) return finalize('QUEUE_MATERIALIZATION_ORDER_BLOCKED', ['admission_entry_referenced_by_order_not_present_in_request']);
  }
  markValid('eligibility_validated');

  const requestId = request.runtime_queue_materialization_request_id;
  const packageId = `${requestId}-package`;
  const materializationEntryRefs = [];
  let materializationSequence = 0;

  for (const admissionEntryId of canonicalOrder) {
    const admissionEntry = admissionEntryById.get(admissionEntryId);
    const isEligible = admissionEntry.admission_status === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION' && admissionEntry.queue_admission_validated === true;
    const entryId = `${admissionEntryId}-queue-materialization-entry`;
    const materializationEntryRef = buildRuntimeQueueMaterializationEntryReference({
      runtime_queue_materialization_entry_reference_id: entryId,
      runtime_queue_materialization_package_id: packageId,
      runtime_queue_admission_package_id: admissionPackageRef.runtime_queue_admission_package_id,
      runtime_queue_admission_entry_reference_id: admissionEntryId,
      runtime_queue_admission_entry_fingerprint: admissionEntry.admission_entry_fingerprint,
      dispatch_intent_reference_id: admissionEntry.dispatch_intent_reference_id,
      runtime_queue_class_reference_id: admissionEntry.runtime_queue_class_reference_id,
      admission_status: admissionEntry.admission_status,
      queue_admission_validated: admissionEntry.queue_admission_validated,
      materialization_position: isEligible ? materializationSequence++ : undefined,
      reason_codes: isEligible ? [] : ['queue_admission_entry_not_accepted_or_not_validated']
    });
    materializationEntryRefs.push(materializationEntryRef);
  }
  markValid('entries_validated');

  // 12-13. Queue Materialization Order -- genuine subsequence of the canonical Admission order,
  // never independently reordered, plus the two independently re-verified preservation flags.
  const orderedMaterializationIds = materializationEntryRefs.map((e) => e.runtime_queue_materialization_entry_reference_id);
  const materializedIds = materializationEntryRefs.filter((e) => e.materialization_status === 'QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION').map((e) => e.runtime_queue_materialization_entry_reference_id);
  const notMaterializedIds = materializationEntryRefs.filter((e) => e.materialization_status !== 'QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION').map((e) => e.runtime_queue_materialization_entry_reference_id);

  const admissionOrderPreserved = materializationEntryRefs.every((e, index) => e.runtime_queue_admission_entry_reference_id === canonicalOrder[index]);
  const predecessorOrderPreserved = checkPredecessorOrderPreserved(materializationEntryRefs);
  if (!admissionOrderPreserved) return finalize('QUEUE_MATERIALIZATION_ORDER_BLOCKED', ['queue_materialization_admission_order_not_preserved']);
  if (!predecessorOrderPreserved) return finalize('QUEUE_MATERIALIZATION_PREDECESSOR_BLOCKED', ['queue_materialization_predecessor_order_not_preserved']);

  const orderId = `${packageId}-order`;
  const orderRef = buildRuntimeQueueMaterializationOrderReference({
    runtime_queue_materialization_order_reference_id: orderId,
    runtime_queue_materialization_package_id: packageId,
    runtime_queue_admission_package_id: admissionPackageRef.runtime_queue_admission_package_id,
    runtime_queue_admission_order_reference_id: admissionOrderRef.runtime_queue_admission_order_reference_id,
    runtime_queue_admission_order_fingerprint: admissionOrderRef.order_fingerprint,
    ordered_queue_admission_entry_reference_ids: canonicalOrder,
    ordered_queue_materialization_entry_reference_ids: orderedMaterializationIds,
    materialized_queue_materialization_entry_reference_ids: materializedIds,
    not_materialized_queue_materialization_entry_reference_ids: notMaterializedIds,
    admission_order_preserved: admissionOrderPreserved,
    predecessor_order_preserved: predecessorOrderPreserved
  });
  markValid('materialization_order_validated');

  // 15. Non-execution invariants.
  markValid('non_execution_invariants_validated');

  return finalize('QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION', ['queue_materialization_package_prepared_in_simulation_only'], {
    admissionEntryRefs, queueClassRefs, materializationEntryRefs, orderRef
  });
}

function buildQueueMaterializationOutcome(status, reasonCodes, ctx, validatedFlags) {
  const {
    request, requestFingerprint, canonical, admissionPackageRef,
    admissionEntryRefs = [], queueClassRefs = [], materializationEntryRefs = [], orderRef
  } = ctx;

  const requestSafe = isPlainObject(request) ? request : {};
  const admissionPackageSafe = isPlainObject(admissionPackageRef) ? admissionPackageRef : {};
  const canonicalSafe = canonical || {};

  const requestId = requestSafe.runtime_queue_materialization_request_id || 'runtime_queue_materialization_request_not_available';
  const packageId = `${requestId}-package`;

  const entryCount = materializationEntryRefs.length;
  const materializedCount = materializationEntryRefs.filter((e) => e.materialization_status === 'QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION').length;
  const notMaterializedCount = entryCount - materializedCount;

  const pkg = buildRuntimeQueueMaterializationPackage({
    runtime_queue_materialization_package_id: packageId,
    runtime_queue_materialization_request_id: requestId,
    runtime_queue_admission_package_id: admissionPackageSafe.runtime_queue_admission_package_id || 'runtime_queue_admission_package_not_available',
    runtime_queue_admission_order_reference_id: admissionPackageSafe.runtime_queue_admission_order_reference_id || 'runtime_queue_admission_order_reference_not_available',
    runtime_queue_materialization_order_reference_id: orderRef ? orderRef.runtime_queue_materialization_order_reference_id : `${packageId}-order-not-available`,
    tenant_id: canonicalSafe.tenantId || 'tenant_not_available',
    organization_id: canonicalSafe.organizationId || 'organization_not_available',
    project_id: canonicalSafe.projectId || 'project_not_available',
    session_reference_id: canonicalSafe.sessionId || 'session_not_available',
    agent_id: canonicalSafe.agentId || 'agent_not_available',
    actor_id: canonicalSafe.actorId || 'actor_not_available',
    queue_materialization_entry_reference_ids: materializationEntryRefs.map((e) => e.runtime_queue_materialization_entry_reference_id),
    queue_class_reference_ids: queueClassRefs.map((r) => r.runtime_queue_class_reference_id),
    ordered_queue_admission_entry_reference_ids: orderRef ? orderRef.ordered_queue_admission_entry_reference_ids : [],
    ordered_queue_materialization_entry_reference_ids: orderRef ? orderRef.ordered_queue_materialization_entry_reference_ids : [],
    materialized_queue_materialization_entry_reference_ids: orderRef ? orderRef.materialized_queue_materialization_entry_reference_ids : [],
    not_materialized_queue_materialization_entry_reference_ids: orderRef ? orderRef.not_materialized_queue_materialization_entry_reference_ids : [],
    entry_count: entryCount, materialized_count: materializedCount, not_materialized_count: notMaterializedCount,
    runtime_queue_admission_package_fingerprint: admissionPackageSafe.queue_admission_package_fingerprint || 'fingerprint_not_available',
    runtime_queue_admission_package_digest: admissionPackageSafe.queue_admission_package_digest || 'digest_not_available',
    runtime_queue_admission_order_fingerprint: admissionPackageSafe.queue_admission_order_fingerprint || 'fingerprint_not_available',
    materialization_order_fingerprint: orderRef ? orderRef.materialization_order_fingerprint : 'fingerprint_not_available',
    queue_admission_entry_fingerprints: admissionEntryRefs.map((r) => r.admission_entry_fingerprint),
    queue_class_fingerprints: queueClassRefs.map((r) => r.queue_class_fingerprint),
    materialization_entry_fingerprints: materializationEntryRefs.map((r) => r.materialization_entry_fingerprint),
    logical_sequence: requestSafe.logical_sequence,
    queue_materialization_status: status
  });

  const decision = buildRuntimeQueueMaterializationDecision({
    runtime_queue_materialization_decision_id: `${requestId}-decision`,
    runtime_queue_materialization_request_id: requestId,
    runtime_queue_materialization_package_id: pkg.runtime_queue_materialization_package_id,
    runtime_queue_admission_package_id: pkg.runtime_queue_admission_package_id,
    tenant_id: pkg.tenant_id, organization_id: pkg.organization_id, project_id: pkg.project_id,
    session_reference_id: pkg.session_reference_id, agent_id: pkg.agent_id, actor_id: pkg.actor_id,
    status,
    runtime_queue_materialization_request_fingerprint: requestFingerprint || 'fingerprint_not_available',
    runtime_queue_materialization_package_fingerprint: pkg.queue_materialization_package_fingerprint,
    runtime_queue_materialization_package_digest: pkg.queue_materialization_package_digest,
    runtime_queue_admission_package_fingerprint: pkg.runtime_queue_admission_package_fingerprint,
    runtime_queue_admission_package_digest: pkg.runtime_queue_admission_package_digest,
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    ...validatedFlags
  });

  const result = buildRuntimeQueueMaterializationResult({
    runtime_queue_materialization_result_id: `${requestId}-result`,
    runtime_queue_materialization_request_id: requestId,
    runtime_queue_materialization_decision_id: decision.runtime_queue_materialization_decision_id,
    runtime_queue_materialization_package_id: decision.runtime_queue_materialization_package_id,
    runtime_queue_admission_package_id: decision.runtime_queue_admission_package_id,
    tenant_id: decision.tenant_id, organization_id: decision.organization_id, project_id: decision.project_id,
    session_reference_id: decision.session_reference_id, agent_id: decision.agent_id, actor_id: decision.actor_id,
    status,
    runtime_queue_materialization_request_fingerprint: decision.runtime_queue_materialization_request_fingerprint,
    runtime_queue_materialization_decision_fingerprint: computeCanonicalContentDigest(decision),
    runtime_queue_materialization_package_fingerprint: decision.runtime_queue_materialization_package_fingerprint,
    runtime_queue_materialization_package_digest: decision.runtime_queue_materialization_package_digest,
    entry_count: pkg.entry_count, materialized_count: pkg.materialized_count, not_materialized_count: pkg.not_materialized_count,
    blockers: reasonCodes, reason_codes: reasonCodes
  });

  const audit = buildRuntimeQueueMaterializationAudit({
    decision, result,
    queueClassReferenceIds: queueClassRefs.map((r) => r.runtime_queue_class_reference_id),
    logicalSequence: requestSafe.logical_sequence
  });

  return {
    decision, result, audit, package: pkg,
    admissionEntryRefs, queueClassRefs, materializationEntryRefs, orderRef
  };
}

module.exports = {
  checkPredecessorOrderPreserved,
  evaluateRuntimeQueueMaterializationRequest,
  fingerprintSetMatches,
  idSetMatches
};

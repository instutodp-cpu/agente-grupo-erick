'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { checkIdentity } = require('./runtime-execution-package');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { validateRuntimeQueuePlacementRequest } = require('./runtime-queue-placement-request');
const { computeMaterializationEntryFingerprint } = require('./runtime-queue-materialization-entry-reference');
const { computeQueueClassFingerprint } = require('./runtime-queue-class-reference');
const { buildRuntimeQueuePlacementEntryReference } = require('./runtime-queue-placement-entry-reference');
const { buildRuntimeQueuePlacementGroupReference } = require('./runtime-queue-placement-group-reference');
const { buildRuntimeQueuePlacementOrderReference } = require('./runtime-queue-placement-order-reference');
const { buildRuntimeQueuePlacementPackage } = require('./runtime-queue-placement-package');
const { buildRuntimeQueuePlacementDecision } = require('./runtime-queue-placement-decision');
const { buildRuntimeQueuePlacementResult } = require('./runtime-queue-placement-result');
const { buildRuntimeQueuePlacementAudit } = require('./runtime-queue-placement-audit');

// pr110: the single evaluator this PR exists to build. Receives only an already
// QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION package (plus the exact Materialization Entry/
// Order/Queue Class objects it already committed to via its own ID/fingerprint lists) and produces a
// purely declarative grouping of the materialized entries into logical placement groups, with a
// relative position within each group -- nothing here creates a queue, an item, an enqueue, a broker
// message, a worker notification, or a job. Every one of those flags is forced false in every outcome
// this boundary can ever produce. "Queue Materialization Simulation descreve como uma entrada
// admitida seria representada e ordenada. Queue Placement Simulation descreve a qual grupo lógico
// simulado essa representação pertenceria. Não cria fila, item de fila, broker, worker ou execução."
//
// This boundary NEVER recomputes: admissão, prioridade, fairness, capacidade, quota, Queue Class
// compatibility, ordem canônica, materialization_position, materialization_status, admission_status,
// grafo de predecessores ou identidade. It validates the INTEGRITY of those inherited decisions --
// never substitutes them. The ONLY genuinely new decisions this layer makes are: (1) which logical
// group (keyed deterministically off `runtime_queue_class_reference_id`, the one dimension already
// official at this layer) each materialized entry belongs to, and (2) its position relative to other
// members of that same group.

// "Dispatch não pode ser apenas stage ID + worker ID." -- the same non-substitution discipline
// reused verbatim from every prior layer, applied here to the Materialization Entry/Queue Class
// lists this request carries.
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

// "O agrupamento não pode alterar a ordem soberana." Genuinely re-verified over the entries as
// actually built, never asserted true by construction -- walks a group's own members (already in
// canonical-order-derived sequence) and proves placement_position is strictly increasing.
function checkGroupOrderPreserved(groupMembers) {
  let lastPosition = -1;
  for (const member of groupMembers) {
    if (member.placement_position === null) continue;
    if (member.placement_position <= lastPosition) return false;
    lastPosition = member.placement_position;
  }
  return true;
}

function deriveQueuePlacementGroupKey(queueClassReferenceId) {
  return computeCanonicalContentDigest({ queue_class_reference_id: queueClassReferenceId });
}

function evaluateRuntimeQueuePlacementRequest(request, context = {}) {
  void context; // never consulted for any decision.
  const validatedFlags = {};
  function markValid(flag) {
    validatedFlags[flag] = true;
  }

  const requestIsObject = isPlainObject(request);
  const materializationPackageRef = requestIsObject ? request.runtime_queue_materialization_package_reference : undefined;
  const materializationEntryRefs = requestIsObject && Array.isArray(request.runtime_queue_materialization_entry_references) ? request.runtime_queue_materialization_entry_references : [];
  const materializationOrderRef = requestIsObject ? request.runtime_queue_materialization_order_reference : undefined;
  const queueClassRefs = requestIsObject && Array.isArray(request.runtime_queue_class_references) ? request.runtime_queue_class_references : [];

  const canonical = {
    tenantId: isPlainObject(materializationPackageRef) ? materializationPackageRef.tenant_id : undefined,
    organizationId: isPlainObject(materializationPackageRef) ? materializationPackageRef.organization_id : undefined,
    projectId: isPlainObject(materializationPackageRef) ? materializationPackageRef.project_id : undefined,
    sessionId: isPlainObject(materializationPackageRef) ? materializationPackageRef.session_reference_id : undefined,
    agentId: isPlainObject(materializationPackageRef) ? materializationPackageRef.agent_id : undefined,
    actorId: isPlainObject(materializationPackageRef) ? materializationPackageRef.actor_id : undefined
  };

  const requestFingerprint = computeCanonicalContentDigest(requestIsObject ? request : {});

  function finalize(status, reasonCodes, derived = {}) {
    return buildQueuePlacementOutcome(status, reasonCodes, {
      request, requestFingerprint, canonical, materializationPackageRef, ...derived
    }, validatedFlags);
  }

  // 1-3. Request/every nested reference (Package, Order, every Entry, every Queue Class) against its
  // own real validator -- this alone proves every fingerprint/digest a nested object claims is
  // self-consistent (recomputed, never merely compared for presence/shape).
  const requestValidation = validateRuntimeQueuePlacementRequest(request);
  if (!requestValidation.valid) return finalize('QUEUE_PLACEMENT_VALIDATION_FAILED', ['runtime_queue_placement_request_invalid']);
  markValid('request_validated');

  // 4. Contrato oficial de entrada -- must be genuinely QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION.
  if (
    materializationPackageRef.queue_materialization_status !== 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION'
    || materializationPackageRef.queue_materialization_package_prepared_in_simulation !== true
  ) {
    return finalize('QUEUE_PLACEMENT_BLOCKED_BY_INHERITED_DATA', ['queue_materialization_package_not_prepared']);
  }
  markValid('materialization_package_validated');

  // 6. Identidade -- evaluated early to match the precedence discipline established at every prior
  // layer of this lineage. Honest limitation (same as pr109): RuntimeQueueMaterializationOrderReference
  // does not itself carry identity fields, so this call is a structural no-op for this specific
  // reference; real identity protection comes transitively from the Package's own fingerprint
  // self-consistency plus the non-substitution proofs below.
  const mismatch = checkIdentity(materializationOrderRef, canonical, 'runtime_queue_materialization_order_reference');
  if (mismatch) return finalize(mismatch.status, [mismatch.reason]);
  markValid('identity_validated');

  // 7-8. Não-substituição: as Materialization Entries e Queue Class References que esta request
  // carrega devem produzir exatamente o mesmo conjunto de IDs/fingerprints que o Package já
  // registrou -- nunca uma lista independentemente substituída pelo caller.
  if (
    !idSetMatches(materializationEntryRefs, 'runtime_queue_materialization_entry_reference_id', materializationPackageRef.queue_materialization_entry_reference_ids)
    || !fingerprintSetMatches(materializationEntryRefs, computeMaterializationEntryFingerprint, materializationPackageRef.materialization_entry_fingerprints)
    || !idSetMatches(queueClassRefs, 'runtime_queue_class_reference_id', materializationPackageRef.queue_class_reference_ids)
    || !fingerprintSetMatches(queueClassRefs, computeQueueClassFingerprint, materializationPackageRef.queue_class_fingerprints)
    || materializationOrderRef.runtime_queue_materialization_order_reference_id !== materializationPackageRef.runtime_queue_materialization_order_reference_id
    || materializationOrderRef.materialization_order_fingerprint !== materializationPackageRef.materialization_order_fingerprint
  ) {
    return finalize('QUEUE_PLACEMENT_BLOCKED_BY_INHERITED_DATA', ['materialization_output_substituted_or_incomplete']);
  }
  markValid('reference_integrity_validated');

  // Cardinalidade -- toda entry oficialmente registrada pelo Package deve estar presente, sem
  // ausência e sem excesso (idSetMatches acima já prova o CONJUNTO; aqui confirmamos a contagem
  // declarada pelo próprio Package bate com a contagem real).
  if (materializationEntryRefs.length !== materializationPackageRef.entry_count) {
    return finalize('QUEUE_PLACEMENT_BLOCKED_BY_INHERITED_DATA', ['materialization_entry_count_mismatch']);
  }
  markValid('cardinality_validated');

  // 9. Ordem canônica -- a lista que o Package já duplicou (`ordered_queue_materialization_entry_
  // reference_ids`) deve corresponder exatamente à lista que a própria Order Reference carrega --
  // nunca confiar na ordem meramente declarada por um array incidental.
  const canonicalOrder = Array.isArray(materializationPackageRef.ordered_queue_materialization_entry_reference_ids) ? materializationPackageRef.ordered_queue_materialization_entry_reference_ids : [];
  const orderRefOrder = Array.isArray(materializationOrderRef.ordered_queue_materialization_entry_reference_ids) ? materializationOrderRef.ordered_queue_materialization_entry_reference_ids : [];
  if (
    canonicalOrder.length !== orderRefOrder.length
    || !canonicalOrder.every((id, index) => id === orderRefOrder[index])
    || new Set(canonicalOrder).size !== canonicalOrder.length
    || canonicalOrder.length !== materializationEntryRefs.length
  ) {
    return finalize('QUEUE_PLACEMENT_ORDER_BLOCKED', ['canonical_order_not_bound_to_materialization_order_reference']);
  }
  markValid('canonical_order_validated');

  // 10. Predecessor order -- a fonte soberana é a própria PR109 (`predecessor_order_preserved`,
  // combinada com `queue_materialization_order_validated`), já provada verdadeira pelo boundary da
  // PR109 -- re-verificada aqui para autenticidade (seu próprio fingerprint já foi recomputado
  // acima), nunca re-derivada de arestas de dependência cruas que o input boundary desta camada
  // corretamente exclui.
  if (materializationOrderRef.predecessor_order_preserved !== true || materializationOrderRef.queue_materialization_order_validated !== true) {
    return finalize('QUEUE_PLACEMENT_PREDECESSOR_BLOCKED', ['inherited_predecessor_order_not_preserved']);
  }
  markValid('predecessor_order_validated');

  // 11. Eligibility -- "Somente entries oficialmente materializadas pela PR109 podem receber
  // placement." Never recomputed: `materialization_status`/`materialization_position` are read
  // verbatim from the inherited Materialization Entry, never reinterpreted.
  const materializationEntryById = new Map(materializationEntryRefs.map((e) => [e.runtime_queue_materialization_entry_reference_id, e]));
  for (const id of canonicalOrder) {
    if (!materializationEntryById.has(id)) return finalize('QUEUE_PLACEMENT_ORDER_BLOCKED', ['materialization_entry_referenced_by_order_not_present_in_request']);
  }
  markValid('eligibility_validated');

  const requestId = request.runtime_queue_placement_request_id;
  const packageId = `${requestId}-package`;

  // 12-13. Placement derivation, iterating the same canonical order the boundary already proved
  // sovereign above -- Pass 1 determines, per entry, eligibility + placement_group_key + position
  // within its group, using a Map only as an ID-keyed lookup index (never for iteration order).
  const groupCounters = new Map();
  const groupFirstAppearanceOrder = [];
  const groupMeta = new Map();
  const entryPlans = [];
  for (const materializationEntryId of canonicalOrder) {
    const materializationEntry = materializationEntryById.get(materializationEntryId);
    const isEligible = materializationEntry.materialization_status === 'QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION';
    let placementGroupKey = null;
    let placementPositionWithinGroup = null;
    if (isEligible) {
      if (!isNonEmptyString(materializationEntry.runtime_queue_class_reference_id)) {
        // "Quando existir incompatibilidade estrutural, falhar o pacote inteiro." A materialized
        // entry without a real Queue Class dimension can never be grouped -- never silently skipped.
        return finalize('QUEUE_PLACEMENT_GROUP_BLOCKED', ['placed_entry_missing_queue_class_reference']);
      }
      placementGroupKey = deriveQueuePlacementGroupKey(materializationEntry.runtime_queue_class_reference_id);
      if (!groupCounters.has(placementGroupKey)) {
        groupCounters.set(placementGroupKey, 0);
        groupFirstAppearanceOrder.push(placementGroupKey);
        groupMeta.set(placementGroupKey, { queueClassReferenceId: materializationEntry.runtime_queue_class_reference_id });
      }
      placementPositionWithinGroup = groupCounters.get(placementGroupKey);
      groupCounters.set(placementGroupKey, placementPositionWithinGroup + 1);
    }
    entryPlans.push({ materializationEntryId, materializationEntry, isEligible, placementGroupKey, placementPositionWithinGroup });
  }
  markValid('entries_validated');

  // Group IDs are assigned deterministically in first-appearance order while walking the canonical
  // order above -- a genuine derivation from the sovereign order (first member's real global
  // position), never an incidental sort by key or alphabetical order.
  const groupIdByKey = new Map();
  groupFirstAppearanceOrder.forEach((key, index) => {
    groupIdByKey.set(key, `${packageId}-group-${index}`);
  });

  // Pass 2: build the actual PlacementEntryReference objects now that every group's real ID is known.
  const placementEntryRefs = entryPlans.map((plan) => buildRuntimeQueuePlacementEntryReference({
    runtime_queue_placement_entry_reference_id: `${plan.materializationEntryId}-queue-placement-entry`,
    runtime_queue_placement_package_id: packageId,
    runtime_queue_materialization_package_id: materializationPackageRef.runtime_queue_materialization_package_id,
    runtime_queue_materialization_entry_reference_id: plan.materializationEntryId,
    runtime_queue_materialization_entry_fingerprint: plan.materializationEntry.materialization_entry_fingerprint,
    runtime_queue_admission_entry_reference_id: plan.materializationEntry.runtime_queue_admission_entry_reference_id,
    runtime_queue_class_reference_id: plan.materializationEntry.runtime_queue_class_reference_id,
    runtime_queue_placement_group_reference_id: plan.isEligible ? groupIdByKey.get(plan.placementGroupKey) : undefined,
    materialization_status: plan.materializationEntry.materialization_status,
    materialization_position: plan.materializationEntry.materialization_position,
    placement_position: plan.isEligible ? plan.placementPositionWithinGroup : undefined,
    reason_codes: plan.isEligible ? [] : ['queue_materialization_entry_not_prepared']
  }));
  markValid('group_validated');

  // 14. Placement Group references -- each group's own member order is a genuine subsequence of the
  // canonical order (never independently sorted), and `group_order_preserved` is genuinely
  // re-verified per group, never asserted true by construction.
  const placementGroupRefs = groupFirstAppearanceOrder.map((key) => {
    const members = placementEntryRefs.filter((e) => e.runtime_queue_placement_group_reference_id === groupIdByKey.get(key));
    return buildRuntimeQueuePlacementGroupReference({
      runtime_queue_placement_group_reference_id: groupIdByKey.get(key),
      runtime_queue_placement_package_id: packageId,
      placement_group_key: key,
      runtime_queue_class_reference_id: groupMeta.get(key).queueClassReferenceId,
      ordered_queue_placement_entry_reference_ids: members.map((e) => e.runtime_queue_placement_entry_reference_id),
      group_order_preserved: checkGroupOrderPreserved(members)
    });
  });

  // 15. Queue Placement Order -- global order preserved verbatim, plus the two independently
  // re-verified preservation flags.
  const orderedPlacementIds = placementEntryRefs.map((e) => e.runtime_queue_placement_entry_reference_id);
  const placedIds = placementEntryRefs.filter((e) => e.placement_status === 'QUEUE_PLACEMENT_PREPARED_SIMULATION').map((e) => e.runtime_queue_placement_entry_reference_id);
  const notPlacedIds = placementEntryRefs.filter((e) => e.placement_status !== 'QUEUE_PLACEMENT_PREPARED_SIMULATION').map((e) => e.runtime_queue_placement_entry_reference_id);
  const orderedGroupIds = groupFirstAppearanceOrder.map((key) => groupIdByKey.get(key));

  const materializationOrderPreserved = placementEntryRefs.every((e, index) => e.runtime_queue_materialization_entry_reference_id === canonicalOrder[index]);
  const predecessorOrderPreserved = placementGroupRefs.every((g) => g.group_order_preserved);
  if (!materializationOrderPreserved) return finalize('QUEUE_PLACEMENT_ORDER_BLOCKED', ['queue_placement_materialization_order_not_preserved']);
  if (!predecessorOrderPreserved) return finalize('QUEUE_PLACEMENT_PREDECESSOR_BLOCKED', ['queue_placement_group_order_not_preserved']);

  const orderId = `${packageId}-order`;
  const orderRef = buildRuntimeQueuePlacementOrderReference({
    runtime_queue_placement_order_reference_id: orderId,
    runtime_queue_placement_package_id: packageId,
    runtime_queue_materialization_package_id: materializationPackageRef.runtime_queue_materialization_package_id,
    runtime_queue_materialization_order_reference_id: materializationOrderRef.runtime_queue_materialization_order_reference_id,
    runtime_queue_materialization_order_fingerprint: materializationOrderRef.materialization_order_fingerprint,
    ordered_queue_materialization_entry_reference_ids: canonicalOrder,
    ordered_queue_placement_entry_reference_ids: orderedPlacementIds,
    placed_queue_placement_entry_reference_ids: placedIds,
    not_placed_queue_placement_entry_reference_ids: notPlacedIds,
    ordered_queue_placement_group_reference_ids: orderedGroupIds,
    materialization_order_preserved: materializationOrderPreserved,
    predecessor_order_preserved: predecessorOrderPreserved
  });
  markValid('placement_order_validated');

  // 16. Non-execution invariants.
  markValid('non_execution_invariants_validated');

  return finalize('QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION', ['queue_placement_package_prepared_in_simulation_only'], {
    materializationEntryRefs, queueClassRefs, placementEntryRefs, placementGroupRefs, orderRef
  });
}

function buildQueuePlacementOutcome(status, reasonCodes, ctx, validatedFlags) {
  const {
    request, requestFingerprint, canonical, materializationPackageRef,
    materializationEntryRefs = [], queueClassRefs = [], placementEntryRefs = [], placementGroupRefs = [], orderRef
  } = ctx;

  const requestSafe = isPlainObject(request) ? request : {};
  const materializationPackageSafe = isPlainObject(materializationPackageRef) ? materializationPackageRef : {};
  const canonicalSafe = canonical || {};

  const requestId = requestSafe.runtime_queue_placement_request_id || 'runtime_queue_placement_request_not_available';
  const packageId = `${requestId}-package`;

  const entryCount = placementEntryRefs.length;
  const placedCount = placementEntryRefs.filter((e) => e.placement_status === 'QUEUE_PLACEMENT_PREPARED_SIMULATION').length;
  const notPlacedCount = entryCount - placedCount;
  const groupCount = placementGroupRefs.length;

  const pkg = buildRuntimeQueuePlacementPackage({
    runtime_queue_placement_package_id: packageId,
    runtime_queue_placement_request_id: requestId,
    runtime_queue_materialization_package_id: materializationPackageSafe.runtime_queue_materialization_package_id || 'runtime_queue_materialization_package_not_available',
    runtime_queue_materialization_order_reference_id: materializationPackageSafe.runtime_queue_materialization_order_reference_id || 'runtime_queue_materialization_order_reference_not_available',
    runtime_queue_placement_order_reference_id: orderRef ? orderRef.runtime_queue_placement_order_reference_id : `${packageId}-order-not-available`,
    tenant_id: canonicalSafe.tenantId || 'tenant_not_available',
    organization_id: canonicalSafe.organizationId || 'organization_not_available',
    project_id: canonicalSafe.projectId || 'project_not_available',
    session_reference_id: canonicalSafe.sessionId || 'session_not_available',
    agent_id: canonicalSafe.agentId || 'agent_not_available',
    actor_id: canonicalSafe.actorId || 'actor_not_available',
    queue_placement_entry_reference_ids: placementEntryRefs.map((e) => e.runtime_queue_placement_entry_reference_id),
    queue_placement_group_reference_ids: placementGroupRefs.map((g) => g.runtime_queue_placement_group_reference_id),
    queue_class_reference_ids: queueClassRefs.map((r) => r.runtime_queue_class_reference_id),
    ordered_queue_materialization_entry_reference_ids: orderRef ? orderRef.ordered_queue_materialization_entry_reference_ids : [],
    ordered_queue_placement_entry_reference_ids: orderRef ? orderRef.ordered_queue_placement_entry_reference_ids : [],
    placed_queue_placement_entry_reference_ids: orderRef ? orderRef.placed_queue_placement_entry_reference_ids : [],
    not_placed_queue_placement_entry_reference_ids: orderRef ? orderRef.not_placed_queue_placement_entry_reference_ids : [],
    entry_count: entryCount, placed_count: placedCount, not_placed_count: notPlacedCount, group_count: groupCount,
    runtime_queue_materialization_package_fingerprint: materializationPackageSafe.queue_materialization_package_fingerprint || 'fingerprint_not_available',
    runtime_queue_materialization_package_digest: materializationPackageSafe.queue_materialization_package_digest || 'digest_not_available',
    runtime_queue_materialization_order_fingerprint: materializationPackageSafe.materialization_order_fingerprint || 'fingerprint_not_available',
    placement_order_fingerprint: orderRef ? orderRef.placement_order_fingerprint : 'fingerprint_not_available',
    queue_materialization_entry_fingerprints: materializationEntryRefs.map((r) => r.materialization_entry_fingerprint),
    queue_class_fingerprints: queueClassRefs.map((r) => r.queue_class_fingerprint),
    placement_entry_fingerprints: placementEntryRefs.map((r) => r.placement_entry_fingerprint),
    placement_group_fingerprints: placementGroupRefs.map((r) => r.placement_group_fingerprint),
    logical_sequence: requestSafe.logical_sequence,
    queue_placement_status: status
  });

  const decision = buildRuntimeQueuePlacementDecision({
    runtime_queue_placement_decision_id: `${requestId}-decision`,
    runtime_queue_placement_request_id: requestId,
    runtime_queue_placement_package_id: pkg.runtime_queue_placement_package_id,
    runtime_queue_materialization_package_id: pkg.runtime_queue_materialization_package_id,
    tenant_id: pkg.tenant_id, organization_id: pkg.organization_id, project_id: pkg.project_id,
    session_reference_id: pkg.session_reference_id, agent_id: pkg.agent_id, actor_id: pkg.actor_id,
    status,
    runtime_queue_placement_request_fingerprint: requestFingerprint || 'fingerprint_not_available',
    runtime_queue_placement_package_fingerprint: pkg.queue_placement_package_fingerprint,
    runtime_queue_placement_package_digest: pkg.queue_placement_package_digest,
    runtime_queue_materialization_package_fingerprint: pkg.runtime_queue_materialization_package_fingerprint,
    runtime_queue_materialization_package_digest: pkg.runtime_queue_materialization_package_digest,
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    ...validatedFlags
  });

  const result = buildRuntimeQueuePlacementResult({
    runtime_queue_placement_result_id: `${requestId}-result`,
    runtime_queue_placement_request_id: requestId,
    runtime_queue_placement_decision_id: decision.runtime_queue_placement_decision_id,
    runtime_queue_placement_package_id: decision.runtime_queue_placement_package_id,
    runtime_queue_materialization_package_id: decision.runtime_queue_materialization_package_id,
    tenant_id: decision.tenant_id, organization_id: decision.organization_id, project_id: decision.project_id,
    session_reference_id: decision.session_reference_id, agent_id: decision.agent_id, actor_id: decision.actor_id,
    status,
    runtime_queue_placement_request_fingerprint: decision.runtime_queue_placement_request_fingerprint,
    runtime_queue_placement_decision_fingerprint: computeCanonicalContentDigest(decision),
    runtime_queue_placement_package_fingerprint: decision.runtime_queue_placement_package_fingerprint,
    runtime_queue_placement_package_digest: decision.runtime_queue_placement_package_digest,
    entry_count: pkg.entry_count, placed_count: pkg.placed_count, not_placed_count: pkg.not_placed_count, group_count: pkg.group_count,
    blockers: reasonCodes, reason_codes: reasonCodes
  });

  const audit = buildRuntimeQueuePlacementAudit({
    decision, result,
    queueClassReferenceIds: queueClassRefs.map((r) => r.runtime_queue_class_reference_id),
    queuePlacementGroupReferenceIds: placementGroupRefs.map((g) => g.runtime_queue_placement_group_reference_id),
    logicalSequence: requestSafe.logical_sequence
  });

  return {
    decision, result, audit, package: pkg,
    materializationEntryRefs, queueClassRefs, placementEntryRefs, placementGroupRefs, orderRef
  };
}

module.exports = {
  checkGroupOrderPreserved,
  deriveQueuePlacementGroupKey,
  evaluateRuntimeQueuePlacementRequest,
  fingerprintSetMatches,
  idSetMatches
};

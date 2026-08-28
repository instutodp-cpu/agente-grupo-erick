'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { buildAdmissionInput } = require('./helpers/runtime-execution-attempt-p9-fixtures');
const { buildAdmissionResult } = require('../src/core/runtime-execution-attempt-durable-admission');
const { buildClaimIntent } = require('../src/core/runtime-execution-attempt-claim-intent-simulation');
const {
  buildGoldenWorkerAssignmentBundle,
  evaluateRuntimeWorkerAssignmentRequest
} = require('./helpers/runtime-worker-assignment-test-data');
const {
  computeWorkerAssignmentPackageDigest,
  computeWorkerAssignmentPackageFingerprint
} = require('../src/core/runtime-worker-assignment-package');
const { computeHealthFingerprint } = require('../src/core/runtime-worker-health-reference');
const {
  computeCapacityDigest,
  computeCapacityFingerprint
} = require('../src/core/runtime-worker-capacity-reference');
const { computeFreshnessFingerprint } = require('../src/core/runtime-readiness-freshness-reference');
const {
  CONTRACT_NAME,
  ELIGIBLE_DECISION,
  ELIGIBLE_STATUS,
  INELIGIBLE_STATUS,
  SAFE_FLAGS,
  buildClaimEligibilityDecision,
  evaluateClaimEligibility,
  validateClaimEligibilityDecision,
  validateInput
} = require('../src/core/runtime-execution-attempt-claim-eligibility-decision-simulation');

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildInput() {
  const p8 = buildAdmissionInput();
  const p9 = buildAdmissionResult({
    outcome: 'ADMITTED',
    record: p8.p7_durable_record,
    decision: p8.p8_admission_decision,
    finalState: 'ADMITTED',
    finalRevision: 2,
    transitionApplied: true,
    reasonCode: 'prepared_to_admitted'
  });
  const intent = buildClaimIntent({ p7_durable_record: p8.p7_durable_record, p9_durable_admission: p9 });
  return { runtime_execution_attempt_claim_intent: intent, ...buildWorkerEligibilityEvidence() };
}

function tamper(input, change) {
  const copy = mutable(input);
  change(copy.runtime_execution_attempt_claim_intent);
  return copy;
}

function tamperEvidence(input, change) {
  const copy = mutable(input);
  change(copy);
  return copy;
}

function refreshEvidenceBindings(input) {
  const health = input.runtime_worker_health_reference;
  const capacity = input.runtime_worker_capacity_reference;
  const freshness = input.runtime_freshness_reference;
  const assignmentPackage = input.runtime_worker_assignment_package;
  const assignmentDecision = input.runtime_worker_assignment_decision;
  health.health_fingerprint = computeHealthFingerprint(health);
  capacity.capacity_fingerprint = computeCapacityFingerprint(capacity);
  capacity.capacity_digest = computeCapacityDigest(capacity);
  freshness.freshness_fingerprint = computeFreshnessFingerprint(freshness);
  assignmentPackage.worker_health_fingerprints = [health.health_fingerprint].sort();
  assignmentPackage.worker_capacity_fingerprints = [capacity.capacity_fingerprint].sort();
  assignmentPackage.freshness_fingerprint = freshness.freshness_fingerprint;
  assignmentPackage.worker_assignment_package_fingerprint = computeWorkerAssignmentPackageFingerprint(assignmentPackage);
  assignmentPackage.worker_assignment_package_digest = computeWorkerAssignmentPackageDigest(assignmentPackage);
  assignmentDecision.runtime_worker_assignment_package_fingerprint = assignmentPackage.worker_assignment_package_fingerprint;
  assignmentDecision.runtime_worker_assignment_package_digest = assignmentPackage.worker_assignment_package_digest;
  return input;
}

let workerEligibilityEvidence;

function buildWorkerEligibilityEvidence() {
  if (!workerEligibilityEvidence) {
    const golden = buildGoldenWorkerAssignmentBundle();
    const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
    const scope = buildAdmissionInput().p7_durable_record.identity_scope;
    const assignmentPackage = mutable(outcome.package);
    const assignmentDecision = mutable(outcome.decision);
    Object.assign(assignmentPackage, scope);
    assignmentPackage.worker_assignment_package_fingerprint = computeWorkerAssignmentPackageFingerprint(assignmentPackage);
    assignmentPackage.worker_assignment_package_digest = computeWorkerAssignmentPackageDigest(assignmentPackage);
    Object.assign(assignmentDecision, scope, {
      runtime_worker_assignment_package_fingerprint: assignmentPackage.worker_assignment_package_fingerprint,
      runtime_worker_assignment_package_digest: assignmentPackage.worker_assignment_package_digest
    });
    workerEligibilityEvidence = {
      runtime_worker_assignment_decision: assignmentDecision,
      runtime_worker_assignment_package: assignmentPackage,
      runtime_worker_health_reference: golden.pool.health,
      runtime_worker_capacity_reference: golden.pool.capacity,
      runtime_freshness_reference: golden.freshnessRef
    };
  }
  return workerEligibilityEvidence;
}

test('canonical ADMITTED/2 P10 intent produces an eligible simulation decision', () => {
  assert.deepEqual(validateInput(buildInput()), { valid: true, errors: [] });
  const result = evaluateClaimEligibility(buildInput());
  assert.equal(result.contract_name, CONTRACT_NAME);
  assert.equal(result.status, ELIGIBLE_STATUS);
  assert.equal(result.decision, ELIGIBLE_DECISION);
  assert.equal(result.attempt_state, 'ADMITTED');
  assert.equal(result.attempt_revision, 2);
  assert.equal(result.claim_intent_required, true);
  assert.equal(result.claim_eligibility_decided, true);
  assert.equal(result.claim_eligible, true);
  assert.equal(result.claim_issued, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(validateClaimEligibilityDecision(result).valid, true);
});

test('invalid canonical predecessor produces a deterministic ineligible decision', () => {
  const result = evaluateClaimEligibility(tamper(buildInput(), (intent) => { intent.attempt_revision = 1; }));
  assert.equal(result.status, INELIGIBLE_STATUS);
  assert.equal(result.claim_eligibility_decided, true);
  assert.equal(result.claim_eligible, false);
  assert.equal(result.simulation, true);
  assert.equal(result.production_blocked, true);
  assert.match(result.reason_codes.join(','), /attempt_revision_not_two/);
});

test('identical replay is byte-equivalent and deterministic', () => {
  const input = buildInput();
  const first = evaluateClaimEligibility(input);
  const second = evaluateClaimEligibility(mutable(input));
  assert.deepEqual(second, first);
  assert.equal(second.runtime_execution_attempt_claim_eligibility_decision_id, first.runtime_execution_attempt_claim_eligibility_decision_id);
  assert.equal(second.runtime_execution_attempt_claim_eligibility_decision_fingerprint, first.runtime_execution_attempt_claim_eligibility_decision_fingerprint);
  assert.equal(second.runtime_execution_attempt_claim_eligibility_decision_digest, first.runtime_execution_attempt_claim_eligibility_decision_digest);
});

test('divergent evidence is rejected deterministically without reconciliation', () => {
  const first = evaluateClaimEligibility(buildInput());
  const divergent = evaluateClaimEligibility(tamper(buildInput(), (intent) => { intent.attempt_ordinal = 2; }));
  assert.equal(divergent.status, INELIGIBLE_STATUS);
  assert.notEqual(divergent.runtime_execution_attempt_claim_eligibility_decision_id, first.runtime_execution_attempt_claim_eligibility_decision_id);
  assert.equal(validateInput(tamper(buildInput(), (intent) => { intent.attempt_ordinal = 2; })).valid, false);
});

test('identity, lifecycle, scope, integrity and predecessor substitutions fail closed', () => {
  const cases = [
    (intent) => { intent.runtime_execution_attempt_claim_intent_id = 'other'; },
    (intent) => { intent.runtime_execution_attempt_durable_record_reference.id = 'other'; },
    (intent) => { intent.attempt_state = 'PREPARED'; },
    (intent) => { intent.attempt_revision = 3; },
    (intent) => { intent.identity_scope.tenant_id = 'other'; },
    (intent) => { intent.attempt_ordinal = 3; },
    (intent) => { intent.runtime_execution_attempt_durable_record_reference.fingerprint = 'other'; },
    (intent) => { intent.runtime_execution_attempt_durable_record_reference.digest = `sha256:${'0'.repeat(64)}`; },
    (intent) => { intent.predecessor_contract_name = 'SUBSTITUTED'; },
    (intent) => { delete intent.p9_durable_admission_reference; }
  ];
  for (const change of cases) {
    const result = evaluateClaimEligibility(tamper(buildInput(), change));
    assert.equal(result.status, INELIGIBLE_STATUS);
    assert.equal(result.claim_issued, false);
    assert.equal(result.worker_bound, false);
  }
});

test('missing or malformed predecessor evidence fails closed without throwing', () => {
  const result = evaluateClaimEligibility({});
  assert.equal(result.status, INELIGIBLE_STATUS);
  assert.equal(result.claim_eligible, false);
  assert.equal(result.claim_issued, false);
  assert.equal(evaluateClaimEligibility({ runtime_execution_attempt_claim_intent: null }).status, INELIGIBLE_STATUS);
});

test('property ordering and concurrent pure evaluation preserve the same result', async () => {
  const input = buildInput();
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  const [first, second, third] = await Promise.all([
    evaluateClaimEligibility(input), evaluateClaimEligibility(reordered), evaluateClaimEligibility(mutable(input))
  ]);
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
});

test('input and admitted attempt lifecycle remain unchanged', () => {
  const input = buildInput();
  const before = mutable(input);
  const result = evaluateClaimEligibility(input);
  assert.deepEqual(input, before);
  assert.equal(result.attempt_state, 'ADMITTED');
  assert.equal(result.attempt_revision, 2);
});

test('eligibility does not issue claims, bind workers, reserve capacity or authorize execution', () => {
  const result = evaluateClaimEligibility(buildInput());
  for (const [field, expected] of Object.entries(SAFE_FLAGS)) assert.equal(result[field], expected, field);
  for (const field of [
    'claim_issued', 'claim_artifact_created', 'worker_selected', 'worker_bound', 'worker_assignment_consumed',
    'worker_ownership_established', 'executor_bound', 'executor_ownership_established', 'lease_created',
    'lease_granted', 'fencing_token_created', 'fencing_token_issued', 'execution_authorized', 'execution_started',
    'execution_performed', 'capacity_reservation_included', 'quota_mutation_included', 'queue_mutation_included',
    'provider_call_allowed', 'provider_called', 'network_call_allowed', 'network_used', 'secrets_materialized',
    'external_effect_allowed', 'external_effect_performed'
  ]) assert.equal(result[field], false, field);
  assert.equal(result.simulation, true);
  assert.equal(result.production_blocked, true);
});

test('P11 has no PostgreSQL, transaction, network or runtime-wiring dependency', () => {
  const source = fs.readFileSync(require.resolve('../src/core/runtime-execution-attempt-claim-eligibility-decision-simulation'), 'utf8');
  assert.doesNotMatch(source, /require\(['"].*pg|pool|client\.query|UPDATE |INSERT INTO|fetch\(|axios|http\.request|https\.request/);
  assert.doesNotMatch(source, /Date\.now|Math\.random|randomUUID/);
  assert.equal(Object.hasOwn(evaluateClaimEligibility(buildInput()), 'worker_id'), false);
});

test('missing worker/resource eligibility evidence fails closed', () => {
  const input = buildInput();
  delete input.runtime_worker_assignment_decision;
  const result = evaluateClaimEligibility(input);
  assert.equal(result.status, INELIGIBLE_STATUS);
  assert.equal(result.claim_eligible, false);
  assert.match(result.reason_codes.join(','), /worker_resource_eligibility_invalid/);
});

test('explicitly blocked worker/resource eligibility fails closed', () => {
  const input = tamperEvidence(buildInput(), (copy) => {
    copy.runtime_worker_assignment_decision.status = 'WORKER_ASSIGNMENT_CAPACITY_BLOCKED';
    copy.runtime_worker_assignment_decision.decision = 'REQUEST_WORKER_CAPACITY_REFRESH';
    copy.runtime_worker_assignment_decision.next_state = 'WAITING_WORKER_CAPACITY_REFRESH_REFERENCE';
    copy.runtime_worker_assignment_decision.worker_assignment_package_prepared_in_simulation = false;
    copy.runtime_worker_assignment_package.worker_assignment_status = 'WORKER_ASSIGNMENT_CAPACITY_BLOCKED';
    copy.runtime_worker_assignment_package.worker_assignment_package_prepared_in_simulation = false;
    refreshEvidenceBindings(copy);
  });
  const result = evaluateClaimEligibility(input);
  assert.equal(result.status, INELIGIBLE_STATUS);
  assert.equal(result.claim_eligible, false);
  assert.match(result.reason_codes.join(','), /worker_resource_eligibility_invalid/);
});

test('worker/resource identity scope mismatch fails closed', () => {
  const input = tamperEvidence(buildInput(), (copy) => {
    copy.runtime_worker_assignment_package.tenant_id = 'other-tenant';
    refreshEvidenceBindings(copy);
  });
  const result = evaluateClaimEligibility(input);
  assert.equal(result.status, INELIGIBLE_STATUS);
  assert.equal(result.claim_eligible, false);
  assert.match(result.reason_codes.join(','), /worker_resource_eligibility_invalid/);
});

test('missing health evidence fails closed', () => {
  const input = buildInput();
  delete input.runtime_worker_health_reference;
  const result = evaluateClaimEligibility(input);
  assert.equal(result.status, INELIGIBLE_STATUS);
  assert.equal(result.claim_eligible, false);
  assert.match(result.reason_codes.join(','), /health_evidence_invalid/);
});

test('unhealthy worker/resource evidence fails closed', () => {
  const input = tamperEvidence(buildInput(), (copy) => {
    copy.runtime_worker_health_reference.health_status = 'UNHEALTHY_REFERENCE';
    copy.runtime_worker_health_reference.health_validated = false;
    refreshEvidenceBindings(copy);
  });
  const result = evaluateClaimEligibility(input);
  assert.equal(result.status, INELIGIBLE_STATUS);
  assert.equal(result.claim_eligible, false);
  assert.match(result.reason_codes.join(','), /health_evidence_invalid/);
});

test('missing capacity evidence fails closed', () => {
  const input = buildInput();
  delete input.runtime_worker_capacity_reference;
  const result = evaluateClaimEligibility(input);
  assert.equal(result.status, INELIGIBLE_STATUS);
  assert.equal(result.claim_eligible, false);
  assert.match(result.reason_codes.join(','), /capacity_evidence_invalid/);
});

test('insufficient capacity evidence fails closed', () => {
  const input = tamperEvidence(buildInput(), (copy) => {
    const capacity = copy.runtime_worker_capacity_reference;
    capacity.current_stage_assignments = capacity.maximum_stage_assignments;
    capacity.available_stage_assignments = 0;
    capacity.capacity_available = false;
    capacity.capacity_validated = false;
    refreshEvidenceBindings(copy);
  });
  const result = evaluateClaimEligibility(input);
  assert.equal(result.status, INELIGIBLE_STATUS);
  assert.equal(result.claim_eligible, false);
  assert.match(result.reason_codes.join(','), /capacity_evidence_invalid/);
});

test('missing freshness evidence fails closed', () => {
  const input = buildInput();
  delete input.runtime_freshness_reference;
  const result = evaluateClaimEligibility(input);
  assert.equal(result.status, INELIGIBLE_STATUS);
  assert.equal(result.claim_eligible, false);
  assert.match(result.reason_codes.join(','), /freshness_evidence_invalid/);
});

test('stale freshness evidence fails closed', () => {
  const input = tamperEvidence(buildInput(), (copy) => {
    const freshness = copy.runtime_freshness_reference;
    freshness.current_logical_sequence = freshness.maximum_package_valid_sequences + 1;
    for (const field of [
      'package_expired_logically', 'gateway_expired_logically', 'authorization_expired_logically',
      'scope_expired_logically', 'registry_expired_logically', 'architecture_evidence_expired_logically',
      'binding_ledger_expired_logically', 'validation_ledger_expired_logically', 'capacity_expired_logically'
    ]) freshness[field] = true;
    freshness.freshness_validated = false;
    refreshEvidenceBindings(copy);
  });
  const result = evaluateClaimEligibility(input);
  assert.equal(result.status, INELIGIBLE_STATUS);
  assert.equal(result.claim_eligible, false);
  assert.match(result.reason_codes.join(','), /freshness_evidence_invalid/);
});

test('malformed eligibility evidence fails closed without throwing', () => {
  const input = buildInput();
  input.runtime_worker_capacity_reference = { malformed: true };
  assert.doesNotThrow(() => evaluateClaimEligibility(input));
  const result = evaluateClaimEligibility(input);
  assert.equal(result.status, INELIGIBLE_STATUS);
  assert.equal(result.claim_eligible, false);
});

test('malformed worker assignment package fails closed without throwing', () => {
  const input = buildInput();
  input.runtime_worker_assignment_package = { malformed: true };
  assert.doesNotThrow(() => evaluateClaimEligibility(input));
  const result = evaluateClaimEligibility(input);
  assert.equal(result.status, INELIGIBLE_STATUS);
  assert.equal(result.claim_eligible, false);
});

test('multiple simultaneous failures use deterministic canonical reason ordering', () => {
  const input = tamperEvidence(buildInput(), (copy) => {
    copy.runtime_execution_attempt_claim_intent.attempt_revision = 1;
    delete copy.runtime_worker_health_reference;
    delete copy.runtime_worker_capacity_reference;
    copy.runtime_freshness_reference.current_logical_sequence = 1002;
    copy.runtime_freshness_reference.freshness_validated = false;
  });
  const first = evaluateClaimEligibility(input);
  const second = evaluateClaimEligibility(mutable(input));
  assert.equal(first.status, INELIGIBLE_STATUS);
  assert.deepEqual(first.reason_codes, [...first.reason_codes].sort());
  assert.deepEqual(second, first);
});

test('eligibility evidence remains declarative and cannot select or bind a worker', () => {
  const result = evaluateClaimEligibility(buildInput());
  for (const field of [
    'worker_selected', 'worker_bound', 'worker_assignment_consumed', 'worker_ownership_established',
    'executor_bound', 'executor_ownership_established'
  ]) assert.equal(result[field], false, field);
  assert.equal(result.runtime_worker_assignment_decision_id.startsWith('plan-1-'), true);
  assert.equal(Object.hasOwn(result, 'worker_id'), false);
});

test('eligibility evidence cannot create lease, fencing or execution authority', () => {
  const result = evaluateClaimEligibility(buildInput());
  for (const field of [
    'claim_issued', 'claim_artifact_created', 'lease_created', 'lease_granted', 'fencing_token_created',
    'fencing_token_issued', 'execution_authorized', 'execution_started', 'execution_performed'
  ]) assert.equal(result[field], false, field);
});

test('eligibility evidence cannot reserve or mutate capacity, quota or queue', () => {
  const result = evaluateClaimEligibility(buildInput());
  for (const field of [
    'capacity_reservation_included', 'quota_mutation_included', 'queue_mutation_included'
  ]) assert.equal(result[field], false, field);
  assert.equal(result.runtime_worker_capacity_reference.capacity_reserved, undefined);
});

test('eligibility evaluation has no persistence, network, secret or transaction side effects', () => {
  const input = buildInput();
  const before = mutable(input);
  const result = evaluateClaimEligibility(input);
  assert.deepEqual(input, before);
  for (const field of [
    'provider_call_allowed', 'provider_called', 'network_call_allowed', 'network_used',
    'secrets_materialized', 'external_effect_allowed', 'external_effect_performed'
  ]) assert.equal(result[field], false, field);
  const source = fs.readFileSync(require.resolve('../src/core/runtime-execution-attempt-claim-eligibility-decision-simulation'), 'utf8');
  assert.doesNotMatch(source, /transaction|BEGIN|COMMIT|ROLLBACK|fetch\(|axios|http\.request|https\.request|process\.env/);
});

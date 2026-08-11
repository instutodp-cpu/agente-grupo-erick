'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildGoldenQueuePlacementBundle,
  evaluateRuntimeQueuePlacementRequest
} = require('./helpers/runtime-queue-placement-simulation-test-data');
const {
  buildPublicWebCanaryQueuedSimulationEnvelope
} = require('./helpers/public-web-canary-queued-handoff-test-helper');
const {
  PUBLIC_WEB_CANARY_CAPABILITY,
  evaluatePublicWebCanaryQueuedSimulationBoundary
} = require('../src/core/public-web-canary-queued-simulation-boundary');
const {
  evaluatePublicWebCanaryExecutionIntentSimulation
} = require('../src/core/public-web-canary-execution-intent-simulation-boundary');
const {
  ADMITTED_REASON_CODE,
  PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_RESULT_FIELDS,
  buildAdmissionFingerprintMaterial,
  buildPublicWebCanaryExecutionIntentAdmissionPolicy,
  evaluatePublicWebCanaryExecutionIntentAdmissionSimulation,
  validatePublicWebCanaryExecutionIntentAdmissionPolicy,
  validatePublicWebCanaryExecutionIntentAdmissionSimulationResult
} = require('../src/core/public-web-canary-execution-intent-admission-simulation-boundary');

const repoRoot = path.resolve(__dirname, '../../..');
let baselineEnvelope;

function clone(value) {
  return structuredClone(value);
}

function buildEnvelope(overrides = {}) {
  if (!baselineEnvelope) {
    const bundle = buildGoldenQueuePlacementBundle();
    const placementOutcome = evaluateRuntimeQueuePlacementRequest(bundle.queuePlacementRequest, {});
    baselineEnvelope = buildPublicWebCanaryQueuedSimulationEnvelope({
      queuePlacementBundle: bundle,
      queuePlacementOutcome: placementOutcome
    });
  }
  return {
    ...clone(baselineEnvelope),
    ...overrides
  };
}

function preparedTrial(overrides = {}) {
  return {
    ok: true,
    plan: {
      trial_id: 'public_web_trial_admission_001',
      plan_hash: 'plan_hash_admission_001',
      ...(overrides.plan || {})
    },
    preflight: {
      status: 'preflight_passed',
      evidence_hash: 'preflight_evidence_admission_001',
      executed: false,
      real_provider_called: false,
      ...(overrides.preflight || {})
    },
    dry_run: {
      status: 'dry_run_passed',
      dry_run_passed: true,
      evidence_hash: 'dry_run_evidence_admission_001',
      fake_network_called: true,
      fake_provider_calls: 1,
      real_provider_called: false,
      ...(overrides.dry_run || {})
    },
    ...overrides.root
  };
}

function buildIntentContext({ envelope = buildEnvelope(), prepared = preparedTrial() } = {}) {
  const handoff = evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: prepared });
  const intent = evaluatePublicWebCanaryExecutionIntentSimulation(handoff, { envelope, preparedTrial: prepared });
  const intentValidationContext = { handoffResult: handoff, envelope, preparedTrial: prepared };
  return { envelope, prepared, handoff, intent, intentValidationContext };
}

function validPolicy(overrides = {}) {
  return buildPublicWebCanaryExecutionIntentAdmissionPolicy({
    admission_policy_id: 'public_web_canary_admission_policy_001',
    ...overrides
  });
}

function evaluateAdmission({ intentContext = buildIntentContext(), policy = validPolicy() } = {}) {
  return {
    intentContext,
    policy,
    admission: evaluatePublicWebCanaryExecutionIntentAdmissionSimulation(intentContext.intent, policy, {
      intentValidationContext: intentContext.intentValidationContext
    })
  };
}

function assertValidAdmission(result, intentContext, policy) {
  const validation = validatePublicWebCanaryExecutionIntentAdmissionSimulationResult(result, {
    intentResult: intentContext.intent,
    policyReference: policy,
    intentValidationContext: intentContext.intentValidationContext
  });
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.valid, true);
}

test('admission policy is deterministic, exact, simulation-only, and non-authorizing', () => {
  const policy = validPolicy();
  const same = validPolicy();
  assert.deepEqual(Object.keys(policy).sort(), [...require('../src/core/public-web-canary-execution-intent-admission-simulation-boundary').PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_POLICY_FIELDS].sort());
  assert.deepEqual(validatePublicWebCanaryExecutionIntentAdmissionPolicy(policy), { valid: true, errors: [] });
  assert.equal(policy.admission_policy_fingerprint, same.admission_policy_fingerprint);
  assert.equal(policy.supported_capability, PUBLIC_WEB_CANARY_CAPABILITY);
  assert.equal(policy.admission_environment, 'SIMULATION_ONLY');
  assert.equal(policy.target_class, 'PUBLIC_WEB_CANARY_SIMULATED_HANDOFF');
  assert.equal(policy.allow_admission_simulation, true);
  assert.equal(policy.simulation_only, true);
  assert.equal(policy.production_effect, 'ZERO');
});

test('admission layer admits only the exact validated PR2 execution intent under the exact policy reference', () => {
  const { intentContext, policy, admission } = evaluateAdmission();
  assertValidAdmission(admission, intentContext, policy);
  assert.equal(admission.ok, true);
  assert.equal(admission.status, 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMITTED_SIMULATION');
  assert.equal(admission.decision, 'ADMIT_EXECUTION_INTENT_SIMULATION');
  assert.deepEqual(admission.reason_codes, [ADMITTED_REASON_CODE]);
  assert.equal(admission.parent.intent_id, intentContext.intent.intent_id);
  assert.equal(admission.parent.intent_fingerprint, intentContext.intent.intent_fingerprint);
  assert.equal(admission.policy.admission_policy_fingerprint, policy.admission_policy_fingerprint);
  assert.equal(admission.identity.correlation_id, intentContext.intent.identity.correlation_id);
  assert.equal(admission.scope.tenant_id, intentContext.intent.scope.tenant_id);
});

test('admission means eligible only and does not grant execution or later authority', () => {
  const { admission } = evaluateAdmission();
  assert.equal(admission.authority_boundary.intent_creation_seen, true);
  assert.equal(admission.authority_boundary.admission_simulated, true);
  assert.equal(admission.authority_boundary.future_authority_required, true);
  assert.equal(admission.authority_boundary.later_authority, 'NONE');
  assert.equal(admission.authority_boundary.operational_effect, 'ZERO');
  assert.equal(Object.prototype.hasOwnProperty.call(admission, 'authorized'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(admission, 'execution_authorized'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(admission, 'provider_authorized'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(admission, 'network_authorized'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(admission, 'secret_resolution_authorized'), false);
});

test('admission fingerprint material has explicit stable ordering and no hidden runtime material', () => {
  const { admission } = evaluateAdmission();
  const material = buildAdmissionFingerprintMaterial({
    identity: admission.identity,
    scope: admission.scope,
    parent: admission.parent,
    policy: admission.policy,
    target: admission.target,
    environment: admission.environment,
    authorityBoundary: admission.authority_boundary,
    status: admission.status,
    decision: admission.decision,
    nextState: admission.next_state,
    reasonCodes: admission.reason_codes
  });
  assert.deepEqual(Object.keys(material), [
    'validator_version',
    'capability',
    'request_id',
    'correlation_id',
    'trace_id',
    'tenant_id',
    'organization_id',
    'project_id',
    'parent_intent_id',
    'parent_intent_fingerprint',
    'parent_intent_status',
    'parent_intent_validator_version',
    'parent_handoff_fingerprint',
    'dispatch_package_id',
    'trial_id',
    'plan_hash',
    'admission_policy_id',
    'admission_policy_version',
    'admission_policy_fingerprint',
    'target_class',
    'admission_environment',
    'status',
    'decision',
    'next_state',
    'reason_codes',
    'intent_creation_seen',
    'admission_simulated',
    'future_authority_required',
    'later_authority',
    'operational_effect',
    'simulation_only',
    'production_effect'
  ]);
});

test('admission evaluation is deterministic, idempotent, replay-stable, and immutable', () => {
  const intentContext = buildIntentContext();
  const policy = validPolicy();
  const first = evaluatePublicWebCanaryExecutionIntentAdmissionSimulation(intentContext.intent, policy, {
    intentValidationContext: intentContext.intentValidationContext
  });
  const second = evaluatePublicWebCanaryExecutionIntentAdmissionSimulation(clone(intentContext.intent), clone(policy), {
    intentValidationContext: intentContext.intentValidationContext
  });
  assert.deepEqual(first, second);
  assert.equal(first.admission_id, second.admission_id);
  assert.equal(first.admission_fingerprint, second.admission_fingerprint);
  assert.throws(() => {
    first.authority_boundary.later_authority = 'SOMETHING_ELSE';
  }, TypeError);
});

test('different parent intent material cannot reuse an admission fingerprint', () => {
  const firstContext = buildIntentContext();
  const secondContext = buildIntentContext({ prepared: preparedTrial({ plan: { plan_hash: 'plan_hash_admission_002' } }) });
  const policy = validPolicy();
  const first = evaluatePublicWebCanaryExecutionIntentAdmissionSimulation(firstContext.intent, policy, {
    intentValidationContext: firstContext.intentValidationContext
  });
  const second = evaluatePublicWebCanaryExecutionIntentAdmissionSimulation(secondContext.intent, policy, {
    intentValidationContext: secondContext.intentValidationContext
  });
  assert.notEqual(first.parent.intent_fingerprint, second.parent.intent_fingerprint);
  assert.notEqual(first.admission_id, second.admission_id);
  assert.notEqual(first.admission_fingerprint, second.admission_fingerprint);
});

test('tampered intent and parent reference mismatch reject fail-closed', () => {
  const intentContext = buildIntentContext();
  const policy = validPolicy();
  const tampered = clone(intentContext.intent);
  tampered.parent.plan_hash = 'tampered-plan-hash';
  const admission = evaluatePublicWebCanaryExecutionIntentAdmissionSimulation(tampered, policy, {
    intentValidationContext: intentContext.intentValidationContext
  });
  assert.equal(admission.ok, false);
  assert.ok(admission.reason_codes.includes('malformed_intent'));
  assert.ok(admission.reason_codes.includes('parent_reference_mismatch'));
  assert.ok(admission.reason_codes.includes('fail_closed'));
  assert.equal(admission.authority_boundary.admission_simulated, false);
});

test('policy reference missing, fingerprint mismatch, unsupported target, and unsupported environment reject fail-closed', () => {
  const intentContext = buildIntentContext();
  const policy = validPolicy();
  const cases = [
    ['missing', undefined, ['policy_reference_missing']],
    ['fingerprint_mismatch', { ...policy, admission_policy_fingerprint: `sha256:${'f'.repeat(64)}` }, ['policy_reference_mismatch']],
    ['target', { ...policy, target_class: 'OTHER_TARGET_CLASS' }, ['unsupported_target']],
    ['environment', { ...policy, admission_environment: 'PRODUCTION' }, ['unsupported_environment']]
  ];
  for (const [name, candidatePolicy, expectedReasons] of cases) {
    const admission = evaluatePublicWebCanaryExecutionIntentAdmissionSimulation(intentContext.intent, candidatePolicy, {
      intentValidationContext: intentContext.intentValidationContext
    });
    assert.equal(admission.ok, false, name);
    assert.ok(admission.reason_codes.includes('fail_closed'), name);
    for (const reason of expectedReasons) assert.ok(admission.reason_codes.includes(reason), `${name}: ${reason}`);
  }
});

test('unsupported capability and caller-supplied fake authority reject fail-closed', () => {
  const intentContext = buildIntentContext();
  const policy = validPolicy();
  const unsupported = clone(intentContext.intent);
  unsupported.capability = 'other_capability';
  unsupported.identity.capability = 'other_capability';
  const unsupportedAdmission = evaluatePublicWebCanaryExecutionIntentAdmissionSimulation(unsupported, policy, {
    intentValidationContext: intentContext.intentValidationContext
  });
  assert.equal(unsupportedAdmission.ok, false);
  assert.ok(unsupportedAdmission.reason_codes.includes('unsupported_capability'));

  const escalated = clone(intentContext.intent);
  escalated.authority.execution_authorized = true;
  const escalatedAdmission = evaluatePublicWebCanaryExecutionIntentAdmissionSimulation(escalated, policy, {
    intentValidationContext: intentContext.intentValidationContext
  });
  assert.equal(escalatedAdmission.ok, false);
  assert.ok(escalatedAdmission.reason_codes.includes('authority_escalation_detected'));
  assert.equal(escalatedAdmission.authority_boundary.later_authority, 'NONE');
});

test('admission result validator rejects result tamper, unknown enum, and missing canonical context', () => {
  const { intentContext, policy, admission } = evaluateAdmission();
  const missingContext = validatePublicWebCanaryExecutionIntentAdmissionSimulationResult(admission);
  assert.equal(missingContext.valid, false);
  assert.ok(missingContext.errors.includes('admission_validation_context_required'));

  const tampered = clone(admission);
  tampered.policy.admission_policy_fingerprint = `sha256:${'e'.repeat(64)}`;
  const tamperedValidation = validatePublicWebCanaryExecutionIntentAdmissionSimulationResult(tampered, {
    intentResult: intentContext.intent,
    policyReference: policy,
    intentValidationContext: intentContext.intentValidationContext
  });
  assert.equal(tamperedValidation.valid, false);
  assert.ok(tamperedValidation.errors.includes('evidence_policy_fingerprint_mismatch'));

  const unknown = validatePublicWebCanaryExecutionIntentAdmissionSimulationResult({
    ...admission,
    status: 'NOT_A_REAL_STATUS'
  }, {
    intentResult: intentContext.intent,
    policyReference: policy,
    intentValidationContext: intentContext.intentValidationContext
  });
  assert.equal(unknown.valid, false);
  assert.ok(unknown.errors.includes('status_invalid'));
});

test('isolation mismatch in the canonical intent context rejects admission', () => {
  const intentContext = buildIntentContext();
  const policy = validPolicy();
  const mismatchedEnvelope = clone(intentContext.envelope);
  mismatchedEnvelope.dispatch.package.tenant_id = 'other-tenant';
  const admission = evaluatePublicWebCanaryExecutionIntentAdmissionSimulation(intentContext.intent, policy, {
    intentValidationContext: {
      handoffResult: intentContext.handoff,
      envelope: mismatchedEnvelope,
      preparedTrial: intentContext.prepared
    }
  });
  assert.equal(admission.ok, false);
  assert.ok(admission.reason_codes.includes('malformed_intent'));
  assert.ok(admission.reason_codes.includes('fail_closed'));
});

test('admission module has no operational dependency imports or semantic clock/random/environment access', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'services/api/src/core/public-web-canary-execution-intent-admission-simulation-boundary.js'), 'utf8');
  assert.equal(/require\(['"]node:(http|https|net|tls|dns|dgram|fs|child_process|worker_threads|vm|crypto)['"]\)/.test(source), false);
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('process.env'), false);
  assert.equal(source.includes('Date.now()'), false);
  assert.equal(/\bnew Date\(/.test(source), false);
  assert.equal(source.includes('Math.random'), false);
  assert.equal(source.includes('provider_authorized'), false);
  assert.equal(source.includes('network_authorized'), false);
  assert.equal(source.includes('secret_resolution_authorized'), false);
  assert.equal(source.includes('runtime_enabled'), false);
  assert.equal(source.includes('queue_mutated'), false);
  assert.equal(source.includes('dispatch_executed'), false);
});

test('admission result exact fields contain no later execution authority fields', () => {
  assert.deepEqual(PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_RESULT_FIELDS, [
    'ok',
    'status',
    'decision',
    'next_state',
    'reason_codes',
    'capability',
    'admission_id',
    'admission_fingerprint',
    'identity',
    'scope',
    'parent',
    'policy',
    'target',
    'environment',
    'authority_boundary',
    'evidence',
    'audit',
    'validator_version'
  ]);
});

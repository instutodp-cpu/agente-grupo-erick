'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const readinessModulePath = require.resolve('../src/core/public-web-canary-preflight-readiness-boundary');
const entryModulePath = require.resolve('../src/core/public-web-canary-preflight-entry-boundary');
const readinessModule = require(readinessModulePath);
const realReadinessValidator =
  readinessModule.validatePublicWebCanaryPreflightReadinessResult;

function loadEntryBoundaryWithValidator(validator) {
  readinessModule.validatePublicWebCanaryPreflightReadinessResult = validator;
  delete require.cache[entryModulePath];
  const loaded = require(entryModulePath);
  readinessModule.validatePublicWebCanaryPreflightReadinessResult =
    realReadinessValidator;
  return loaded;
}

const entryBoundary = loadEntryBoundaryWithValidator(() => ({
  valid: true,
  errors: []
}));
const referenceBoundary = require('../src/core/public-web-canary-preflight-entry-reference-boundary');
const entryReferenceConsumerBoundary = require('../src/core/public-web-canary-preflight-entry-reference-consumer-boundary');
const preflightRequestConsumerBoundary = require('../src/core/public-web-canary-preflight-request-consumer-boundary');
const dryRunRequestConsumerBoundary = require('../src/core/public-web-canary-dry-run-request-consumer-boundary');
const authorizationReviewBoundary = require('../src/core/public-web-canary-execution-authorization-review-boundary');
const authorizationIntentBoundary = require('../src/core/public-web-canary-execution-authorization-intent-boundary');

function canonicalReady() {
  return {
    ok: true,
    status: 'PUBLIC_WEB_CANARY_PREFLIGHT_READY',
    decision: 'ENTER_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT',
    next_state: 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_RUN',
    readiness_id:
      'public_web_canary_preflight_readiness:execution-authorization-intent-boundary-test',
    readiness_fingerprint:
      'sha256:synthetic-execution-authorization-intent-readiness-fingerprint',
    preparation: {
      preparation_eligibility_id:
        'execution_preparation_eligibility:execution-authorization-intent-boundary-test'
    },
    trial: {
      trial_id:
        'public_web_trial_execution_authorization_intent_boundary_test',
      plan_hash:
        'sha256:synthetic-execution-authorization-intent-plan'
    },
    identity: {
      tenant_id:
        'tenant-execution-authorization-intent-boundary-test'
    },
    requirements: {
      secret_resolution_not_performed: true,
      network_not_used: true,
      provider_not_called: true,
      runtime_not_enabled: true,
      worker_not_started: true,
      queue_not_mutated: true,
      scheduler_not_mutated: true,
      dispatch_not_executed: true,
      operational_persistence_not_written: true,
      production_effect: 'ZERO'
    },
    authority_boundary: {
      preflight_ready: true,
      preflight_authorized: true,
      dry_run_authorized: false,
      operator_confirmation_authorized: false,
      trial_execution_authorized: false,
      provider_called: false,
      external_network_used: false,
      secret_resolved: false,
      runtime_execution: false,
      worker_execution: false,
      queue_mutation: false,
      scheduler_mutation: false,
      dispatch_execution: false,
      operational_persistence: false,
      real_execution_authorized: false,
      production_effect: 'ZERO'
    },
    evidence: {
      secret_material_exposed: false,
      production_effect: 'ZERO'
    },
    validator_version:
      readinessModule.PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_VALIDATOR_VERSION
  };
}

function validEntry() {
  const result =
    entryBoundary.evaluatePublicWebCanaryPreflightEntryBoundary(
      canonicalReady(),
      {}
    );
  assert.equal(result.ok, true);
  return result;
}

function validReference(entry = validEntry()) {
  const result =
    referenceBoundary.evaluatePublicWebCanaryPreflightEntryReferenceBoundary(
      entry
    );
  assert.equal(result.ok, true);
  return result;
}

function validPreflightRequestConsumer(
  entry = validEntry(),
  reference = validReference(entry)
) {
  const result =
    entryReferenceConsumerBoundary.evaluatePublicWebCanaryPreflightEntryReferenceConsumerBoundary(
      reference,
      entry
    );
  assert.equal(result.ok, true);
  return result;
}

function validDryRunRequest(
  entry = validEntry(),
  reference = validReference(entry),
  consumer = validPreflightRequestConsumer(entry, reference)
) {
  const result =
    preflightRequestConsumerBoundary.evaluatePublicWebCanaryPreflightRequestConsumerBoundary(
      consumer,
      reference,
      entry
    );
  assert.equal(result.ok, true);
  return result;
}

function validFakeDryRun(
  entry = validEntry(),
  reference = validReference(entry),
  consumer = validPreflightRequestConsumer(entry, reference),
  dryRun = validDryRunRequest(entry, reference, consumer)
) {
  const result =
    dryRunRequestConsumerBoundary.evaluatePublicWebCanaryDryRunRequestConsumerBoundary(
      dryRun,
      consumer,
      reference,
      entry
    );
  assert.equal(result.ok, true);
  return result;
}

function validAuthorizationReview(
  entry = validEntry(),
  reference = validReference(entry),
  consumer = validPreflightRequestConsumer(entry, reference),
  dryRun = validDryRunRequest(entry, reference, consumer),
  fakeDryRun = validFakeDryRun(entry, reference, consumer, dryRun)
) {
  const result =
    authorizationReviewBoundary.evaluatePublicWebCanaryExecutionAuthorizationReviewBoundary(
      fakeDryRun,
      dryRun,
      consumer,
      reference,
      entry
    );
  assert.equal(result.ok, true);
  return result;
}

function validIntentInput() {
  return {
    environment: 'staging',
    authorization_scope:
      'PUBLIC_WEB_CANARY_SINGLE_EXECUTION_NON_PRODUCTION',
    approval_mode: 'DUAL_CONTROL_REQUIRED',
    operator_id: 'operator:execution-authorization-intent-test',
    approver_id: 'approver:execution-authorization-intent-test',
    requested_execution_count: 1,
    ttl_seconds: 300,
    replay_key: 'replay:execution-authorization-intent-test:001',
    request_reference:
      'request:execution-authorization-intent-test:001'
  };
}

function buildChain() {
  const entry = validEntry();
  const reference = validReference(entry);
  const consumer = validPreflightRequestConsumer(entry, reference);
  const dryRun = validDryRunRequest(entry, reference, consumer);
  const fakeDryRun = validFakeDryRun(
    entry,
    reference,
    consumer,
    dryRun
  );
  const review = validAuthorizationReview(
    entry,
    reference,
    consumer,
    dryRun,
    fakeDryRun
  );

  return {
    entry,
    reference,
    consumer,
    dryRun,
    fakeDryRun,
    review
  };
}

function evaluate(chain, intent) {
  return authorizationIntentBoundary.evaluatePublicWebCanaryExecutionAuthorizationIntentBoundary(
    chain.review,
    chain.fakeDryRun,
    chain.dryRun,
    chain.consumer,
    chain.reference,
    chain.entry,
    intent
  );
}

function validate(result, chain, intent) {
  return authorizationIntentBoundary.validatePublicWebCanaryExecutionAuthorizationIntentBoundaryResult(
    result,
    chain.review,
    chain.fakeDryRun,
    chain.dryRun,
    chain.consumer,
    chain.reference,
    chain.entry,
    intent
  );
}

function assertNoAuthorizationOrExecution(result) {
  assert.equal(result.authority_boundary.intent_only, true);
  assert.equal(
    result.authority_boundary.explicit_separate_grant_required,
    true
  );
  assert.equal(result.authority_boundary.dual_control_required, true);
  assert.equal(result.authority_boundary.authorization_granted, false);
  assert.equal(
    result.authority_boundary.execution_reservation_created,
    false
  );
  assert.equal(
    result.authority_boundary.authorization_token_materialized,
    false
  );
  assert.equal(result.authority_boundary.replay_key_consumed, false);
  assert.equal(result.authority_boundary.approver_confirmation, false);
  assert.equal(result.authority_boundary.preflight_execution, false);
  assert.equal(result.authority_boundary.dry_run_execution, false);
  assert.equal(result.authority_boundary.operator_confirmation, false);
  assert.equal(result.authority_boundary.trial_execution, false);
  assert.equal(result.authority_boundary.provider_called, false);
  assert.equal(result.authority_boundary.external_network_used, false);
  assert.equal(result.authority_boundary.secret_resolved, false);
  assert.equal(result.authority_boundary.runtime_execution, false);
  assert.equal(result.authority_boundary.worker_execution, false);
  assert.equal(result.authority_boundary.queue_mutation, false);
  assert.equal(result.authority_boundary.scheduler_mutation, false);
  assert.equal(result.authority_boundary.dispatch_execution, false);
  assert.equal(result.authority_boundary.operational_persistence, false);
  assert.equal(
    result.authority_boundary.real_execution_authorized,
    false
  );
  assert.equal(result.authority_boundary.production_effect, 'ZERO');

  assert.equal(
    result.authorization_intent.explicit_separate_grant_required,
    true
  );
  assert.equal(result.authorization_intent.authorization_granted, false);
  assert.equal(
    result.authorization_intent.execution_reservation_created,
    false
  );
  assert.equal(
    result.authorization_intent.authorization_token_materialized,
    false
  );
  assert.equal(result.authorization_intent.replay_key_consumed, false);
  assert.equal(
    result.authorization_intent.can_trigger_real_execution,
    false
  );
  assert.equal(
    result.authorization_intent.real_execution_authorized,
    false
  );
  assert.equal(result.authorization_intent.simulated, true);
  assert.equal(result.authorization_intent.executed, false);
  assert.equal(result.authorization_intent.production_effect, 'ZERO');

  assert.equal(result.evidence.authorization_granted, false);
  assert.equal(result.evidence.execution_reservation_created, false);
  assert.equal(result.evidence.authorization_token_materialized, false);
  assert.equal(result.evidence.replay_key_consumed, false);
  assert.equal(result.evidence.can_trigger_real_execution, false);
  assert.equal(result.evidence.real_execution_authorized, false);
  assert.equal(result.evidence.provider_called, false);
  assert.equal(result.evidence.external_network_used, false);
  assert.equal(result.evidence.secret_resolved, false);
  assert.equal(result.evidence.simulated, true);
  assert.equal(result.evidence.executed, false);
  assert.equal(result.evidence.production_effect, 'ZERO');
}

test('validated review plus bounded non-production intent produces deterministic intent only', () => {
  const chain = buildChain();
  const intent = validIntentInput();

  const first = evaluate(chain, intent);
  const replay = evaluate(chain, intent);

  assert.equal(first.ok, true);
  assert.equal(
    first.status,
    'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_PREPARED_SIMULATION'
  );
  assert.equal(
    first.decision,
    'PREPARE_PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT'
  );
  assert.equal(
    first.next_state,
    'WAITING_PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_BOUNDARY'
  );
  assert.equal(
    first.authorization_intent.intent_type,
    'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_SIMULATION'
  );
  assert.equal(first.authorization_intent.environment, 'staging');
  assert.equal(
    first.authorization_intent.authorization_scope,
    'PUBLIC_WEB_CANARY_SINGLE_EXECUTION_NON_PRODUCTION'
  );
  assert.equal(
    first.authorization_intent.approval_mode,
    'DUAL_CONTROL_REQUIRED'
  );
  assert.equal(first.authorization_intent.requested_execution_count, 1);
  assert.equal(first.authorization_intent.ttl_seconds, 300);
  assert.equal(
    first.authorization_intent.authorization_review_request_id,
    chain.review.authorization_review_request_id
  );
  assert.equal(first.evidence.non_production_environment, true);
  assert.equal(first.evidence.single_execution_scope, true);
  assert.equal(first.evidence.dual_control_bound, true);
  assert.equal(first.evidence.ttl_bounded, true);
  assert.equal(first.evidence.replay_key_bound, true);

  assert.deepEqual(replay, first);
  assertNoAuthorizationOrExecution(first);
  assert.equal(validate(first, chain, intent).valid, true);
});

test('production environment is rejected fail closed', () => {
  const chain = buildChain();
  const intent = validIntentInput();
  intent.environment = 'production';

  const result = evaluate(chain, intent);

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_intent_environment_not_non_production'
    )
  );
  assert.ok(result.reason_codes.includes('fail_closed'));
  assertNoAuthorizationOrExecution(result);
});

test('dual control rejects the same operator and approver', () => {
  const chain = buildChain();
  const intent = validIntentInput();
  intent.approver_id = intent.operator_id;

  const result = evaluate(chain, intent);

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_intent_dual_control_required'
    )
  );
  assertNoAuthorizationOrExecution(result);
});

test('execution count greater than one is rejected fail closed', () => {
  const chain = buildChain();
  const intent = validIntentInput();
  intent.requested_execution_count = 2;

  const result = evaluate(chain, intent);

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_intent_execution_count_must_be_one'
    )
  );
  assertNoAuthorizationOrExecution(result);
});

test('ttl outside the bounded review window is rejected', () => {
  const chain = buildChain();
  const intent = validIntentInput();
  intent.ttl_seconds = 901;

  const result = evaluate(chain, intent);

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_intent_ttl_out_of_range'
    )
  );
  assertNoAuthorizationOrExecution(result);
});

test('legacy or direct authority fields are forbidden in the intent input', () => {
  const chain = buildChain();
  const intent = validIntentInput();
  intent.execution_authorized = true;
  intent.real_execution_authorized = true;
  intent.authorization_granted = true;
  intent.reservation_id = 'reservation:forbidden';

  const result = evaluate(chain, intent);

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_intent_forbidden_field::execution_authorized'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_intent_forbidden_field::real_execution_authorized'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_intent_forbidden_field::authorization_granted'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_intent_forbidden_field::reservation_id'
    )
  );
  assertNoAuthorizationOrExecution(result);
});

test('tampered review identity fails closed before intent is trusted', () => {
  const chain = buildChain();
  const intent = validIntentInput();
  chain.review = structuredClone(chain.review);
  chain.review.authorization_review_request_id =
    'public_web_canary_execution_authorization_review:tampered';

  const result = evaluate(chain, intent);

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_intent_source_validation::execution_authorization_review_context_mismatch'
    )
  );
  assertNoAuthorizationOrExecution(result);
});

test('unsafe review authority cannot bridge into authorization intent', () => {
  const chain = buildChain();
  const intent = validIntentInput();
  chain.review = structuredClone(chain.review);
  chain.review.authority_boundary.authorization_granted = true;
  chain.review.authority_boundary.execution_reservation_created = true;
  chain.review.authority_boundary.provider_called = true;
  chain.review.authority_boundary.real_execution_authorized = true;

  const result = evaluate(chain, intent);

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_intent_source_authorization_granted_must_be_false'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_intent_source_reservation_created_must_be_false'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_intent_source_authority_provider_called_must_be_false'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_intent_source_authority_real_execution_authorized_must_be_false'
    )
  );
  assertNoAuthorizationOrExecution(result);
});

test('tampered intent result is rejected by deterministic validation', () => {
  const chain = buildChain();
  const intent = validIntentInput();
  const result = evaluate(chain, intent);
  const tampered = structuredClone(result);
  tampered.authorization_intent_fingerprint =
    'sha256:tampered-authorization-intent';

  const validation = validate(tampered, chain, intent);

  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.includes(
      'execution_authorization_intent_context_mismatch'
    )
  );
});

test('authorization intent boundary has no operational runner, provider, network, secret, database, queue or worker dependency', () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'src',
      'core',
      'public-web-canary-execution-authorization-intent-boundary.js'
    ),
    'utf8'
  );

  assert.equal(
    source.includes(
      "require('./public-web-canary-execution-authorization-review-boundary')"
    ),
    true
  );

  for (const forbidden of [
    /require\(\s*['"](?:\.\.\/)?pilots\//,
    /public-web-canary-trial-(?:preflight|dry-run)/,
    /public-web-canary-runner/,
    /\bfetch\s*\(/,
    /\baxios\b/,
    /require\(\s*['"]node:(?:http|https|dns|tls|net)['"]\s*\)/,
    /require\(\s*['"][^'"]*(?:provider|secret|database|migration|scheduler|worker|queue|runner)[^'"]*['"]\s*\)/i,
    /process\.env/
  ]) {
    assert.equal(forbidden.test(source), false, String(forbidden));
  }
});

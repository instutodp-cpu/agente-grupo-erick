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
const grantReservationBoundary = require('../src/core/public-web-canary-execution-authorization-grant-reservation-boundary');

function canonicalReady() {
  return {
    ok: true,
    status: 'PUBLIC_WEB_CANARY_PREFLIGHT_READY',
    decision: 'ENTER_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT',
    next_state: 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_RUN',
    readiness_id:
      'public_web_canary_preflight_readiness:grant-reservation-boundary-test',
    readiness_fingerprint:
      'sha256:synthetic-grant-reservation-readiness-fingerprint',
    preparation: {
      preparation_eligibility_id:
        'execution_preparation_eligibility:grant-reservation-boundary-test'
    },
    trial: {
      trial_id: 'public_web_trial_grant_reservation_boundary_test',
      plan_hash: 'sha256:synthetic-grant-reservation-plan'
    },
    identity: {
      tenant_id: 'tenant-grant-reservation-boundary-test'
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

function validConsumer(
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

function validDryRun(
  entry = validEntry(),
  reference = validReference(entry),
  consumer = validConsumer(entry, reference)
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
  consumer = validConsumer(entry, reference),
  dryRun = validDryRun(entry, reference, consumer)
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

function validReview(
  entry = validEntry(),
  reference = validReference(entry),
  consumer = validConsumer(entry, reference),
  dryRun = validDryRun(entry, reference, consumer),
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
    operator_id: 'operator:grant-reservation-test',
    approver_id: 'approver:grant-reservation-test',
    requested_execution_count: 1,
    ttl_seconds: 300,
    replay_key: 'replay:grant-reservation-test:001',
    request_reference: 'request:grant-reservation-test:001'
  };
}

function validGrantInput() {
  return {
    grant_mode: 'DUAL_CONTROL_SINGLE_USE',
    operator_confirmation: true,
    approver_confirmation: true,
    operator_id: 'operator:grant-reservation-test',
    approver_id: 'approver:grant-reservation-test',
    issued_at: '2026-09-18T15:00:00.000Z',
    expires_at: '2026-09-18T15:05:00.000Z',
    ttl_seconds: 300,
    replay_key: 'replay:grant-reservation-test:001',
    grant_nonce: 'grant-nonce:grant-reservation-test:001',
    reservation_nonce: 'reservation-nonce:grant-reservation-test:001',
    grant_reference: 'grant-reference:grant-reservation-test:001',
    replay_guard: {
      known_replay_keys: [],
      known_grant_nonces: [],
      known_reservation_nonces: []
    }
  };
}

function buildChain() {
  const entry = validEntry();
  const reference = validReference(entry);
  const consumer = validConsumer(entry, reference);
  const dryRun = validDryRun(entry, reference, consumer);
  const fakeDryRun = validFakeDryRun(
    entry,
    reference,
    consumer,
    dryRun
  );
  const review = validReview(
    entry,
    reference,
    consumer,
    dryRun,
    fakeDryRun
  );
  const intentInput = validIntentInput();
  const intentResult =
    authorizationIntentBoundary.evaluatePublicWebCanaryExecutionAuthorizationIntentBoundary(
      review,
      fakeDryRun,
      dryRun,
      consumer,
      reference,
      entry,
      intentInput
    );
  assert.equal(intentResult.ok, true);

  return {
    entry,
    reference,
    consumer,
    dryRun,
    fakeDryRun,
    review,
    intentInput,
    intentResult
  };
}

function evaluate(chain, grantInput) {
  return grantReservationBoundary.evaluatePublicWebCanaryExecutionAuthorizationGrantReservationBoundary(
    chain.intentResult,
    chain.review,
    chain.fakeDryRun,
    chain.dryRun,
    chain.consumer,
    chain.reference,
    chain.entry,
    chain.intentInput,
    grantInput
  );
}

function validate(result, chain, grantInput) {
  return grantReservationBoundary.validatePublicWebCanaryExecutionAuthorizationGrantReservationBoundaryResult(
    result,
    chain.intentResult,
    chain.review,
    chain.fakeDryRun,
    chain.dryRun,
    chain.consumer,
    chain.reference,
    chain.entry,
    chain.intentInput,
    grantInput
  );
}

function assertNoExecution(result) {
  assert.equal(result.authority_boundary.execution_bridge_authorized, false);
  assert.equal(result.authority_boundary.can_trigger_real_execution, false);
  assert.equal(result.authority_boundary.preflight_execution, false);
  assert.equal(result.authority_boundary.dry_run_execution, false);
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
  assert.equal(result.authority_boundary.real_execution_authorized, false);
  assert.equal(result.authority_boundary.authorization_token_materialized, false);
  assert.equal(result.authority_boundary.replay_key_consumed, false);
  assert.equal(result.authority_boundary.production_effect, 'ZERO');

  assert.equal(result.authorization_grant.execution_bridge_authorized, false);
  assert.equal(result.authorization_grant.can_trigger_real_execution, false);
  assert.equal(result.authorization_grant.real_execution_authorized, false);
  assert.equal(result.authorization_grant.executed, false);
  assert.equal(result.authorization_grant.provider_called, false);
  assert.equal(result.authorization_grant.external_network_used, false);
  assert.equal(result.authorization_grant.secret_resolved, false);
  assert.equal(result.authorization_grant.authorization_token_materialized, false);
  assert.equal(result.authorization_grant.production_effect, 'ZERO');

  assert.equal(result.execution_reservation.execution_bridge_authorized, false);
  assert.equal(result.execution_reservation.can_trigger_real_execution, false);
  assert.equal(result.execution_reservation.real_execution_authorized, false);
  assert.equal(result.execution_reservation.executed, false);
  assert.equal(result.execution_reservation.provider_called, false);
  assert.equal(result.execution_reservation.external_network_used, false);
  assert.equal(result.execution_reservation.secret_resolved, false);
  assert.equal(result.execution_reservation.operational_persistence, false);
  assert.equal(result.execution_reservation.reservation_consumed, false);
  assert.equal(result.execution_reservation.replay_key_consumed, false);
  assert.equal(result.execution_reservation.production_effect, 'ZERO');
}

test('validated intent plus dual control creates one bounded non-production grant and reservation without execution', () => {
  const chain = buildChain();
  const grantInput = validGrantInput();

  const first = evaluate(chain, grantInput);
  const replay = evaluate(chain, grantInput);

  assert.equal(first.ok, true);
  assert.equal(
    first.status,
    'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANTED_RESERVED'
  );
  assert.equal(
    first.decision,
    'GRANT_PUBLIC_WEB_CANARY_SINGLE_EXECUTION_RESERVATION'
  );
  assert.equal(
    first.next_state,
    'WAITING_PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_BRIDGE'
  );
  assert.match(
    first.authorization_grant_id,
    /^public_web_canary_execution_authorization_grant:/
  );
  assert.match(
    first.execution_reservation_id,
    /^public_web_canary_execution_reservation:/
  );

  assert.equal(first.authority_boundary.authorization_granted, true);
  assert.equal(first.authority_boundary.execution_reservation_created, true);
  assert.equal(first.authority_boundary.reservation_single_use, true);
  assert.equal(first.authority_boundary.replay_key_reserved, true);
  assert.equal(first.authority_boundary.operator_confirmation, true);
  assert.equal(first.authority_boundary.approver_confirmation, true);

  assert.equal(first.authorization_grant.grant_state, 'GRANTED');
  assert.equal(first.authorization_grant.environment, 'staging');
  assert.equal(first.authorization_grant.execution_count_limit, 1);
  assert.equal(first.authorization_grant.ttl_seconds, 300);
  assert.equal(first.authorization_grant.authorization_granted, true);
  assert.equal(first.authorization_grant.execution_reservation_created, true);

  assert.equal(
    first.execution_reservation.reservation_state,
    'RESERVED_UNCONSUMED'
  );
  assert.equal(first.execution_reservation.single_use, true);
  assert.equal(first.execution_reservation.reserved_execution_count, 1);
  assert.equal(first.execution_reservation.remaining_execution_count, 1);
  assert.equal(first.execution_reservation.replay_key_reserved, true);

  assert.deepEqual(replay, first);
  assertNoExecution(first);
  assert.equal(validate(first, chain, grantInput).valid, true);
});

test('grant blocks when approver confirmation is absent', () => {
  const chain = buildChain();
  const grantInput = validGrantInput();
  grantInput.approver_confirmation = false;

  const result = evaluate(chain, grantInput);

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_approver_confirmation_required'
    )
  );
  assert.equal(result.authorization_grant_id, null);
  assert.equal(result.execution_reservation_id, null);
  assert.equal(result.authority_boundary.authorization_granted, false);
  assert.equal(result.authority_boundary.execution_reservation_created, false);
  assertNoExecution(result);
});

test('grant rejects operator or approver identity substitution', () => {
  const chain = buildChain();
  const grantInput = validGrantInput();
  grantInput.approver_id = 'approver:substituted';

  const result = evaluate(chain, grantInput);

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes('execution_authorization_approver_id_mismatch')
  );
  assert.equal(result.authority_boundary.authorization_granted, false);
  assertNoExecution(result);
});

test('grant rejects expiry that does not exactly match the bounded intent ttl', () => {
  const chain = buildChain();
  const grantInput = validGrantInput();
  grantInput.expires_at = '2026-09-18T15:06:00.000Z';

  const result = evaluate(chain, grantInput);

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes('execution_authorization_expiry_ttl_mismatch')
  );
  assert.equal(result.authority_boundary.authorization_granted, false);
  assertNoExecution(result);
});

test('grant rejects a replay key already present in the replay guard snapshot', () => {
  const chain = buildChain();
  const grantInput = validGrantInput();
  grantInput.replay_guard.known_replay_keys = [
    grantInput.replay_key
  ];

  const result = evaluate(chain, grantInput);

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_replay_key_already_seen'
    )
  );
  assert.equal(result.authority_boundary.authorization_granted, false);
  assertNoExecution(result);
});

test('grant rejects reused grant and reservation nonces', () => {
  const chain = buildChain();
  const grantInput = validGrantInput();
  grantInput.replay_guard.known_grant_nonces = [grantInput.grant_nonce];
  grantInput.replay_guard.known_reservation_nonces = [
    grantInput.reservation_nonce
  ];

  const result = evaluate(chain, grantInput);

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_grant_nonce_already_seen'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_reservation_nonce_already_seen'
    )
  );
  assert.equal(result.authority_boundary.authorization_granted, false);
  assertNoExecution(result);
});

test('grant input cannot smuggle execution, provider, network or secret authority', () => {
  const chain = buildChain();
  const grantInput = validGrantInput();
  grantInput.can_trigger_real_execution = true;
  grantInput.real_execution_authorized = true;
  grantInput.provider_called = true;
  grantInput.external_network_used = true;
  grantInput.secret_resolved = true;

  const result = evaluate(chain, grantInput);

  assert.equal(result.ok, false);
  for (const field of [
    'can_trigger_real_execution',
    'real_execution_authorized',
    'provider_called',
    'external_network_used',
    'secret_resolved'
  ]) {
    assert.ok(
      result.reason_codes.includes(
        'execution_authorization_grant_input_forbidden_field::' + field
      )
    );
  }
  assert.equal(result.authority_boundary.authorization_granted, false);
  assertNoExecution(result);
});

test('tampered authorization intent fails closed before grant creation', () => {
  const chain = buildChain();
  const grantInput = validGrantInput();
  chain.intentResult = structuredClone(chain.intentResult);
  chain.intentResult.authorization_intent.environment = 'production';

  const result = evaluate(chain, grantInput);

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_grant_source_validation::execution_authorization_intent_context_mismatch'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'authorization_intent_environment_not_non_production'
    )
  );
  assert.equal(result.authority_boundary.authorization_granted, false);
  assertNoExecution(result);
});

test('tampered grant result is rejected by deterministic validation', () => {
  const chain = buildChain();
  const grantInput = validGrantInput();
  const result = evaluate(chain, grantInput);
  const tampered = structuredClone(result);
  tampered.execution_reservation.remaining_execution_count = 0;

  const validation = validate(tampered, chain, grantInput);

  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.includes(
      'execution_authorization_grant_reservation_context_mismatch'
    )
  );
});

test('grant reservation boundary has no runner, provider, network, secret, database, queue, scheduler or worker dependency', () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'src',
      'core',
      'public-web-canary-execution-authorization-grant-reservation-boundary.js'
    ),
    'utf8'
  );

  assert.equal(
    source.includes(
      "require('./public-web-canary-execution-authorization-intent-boundary')"
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

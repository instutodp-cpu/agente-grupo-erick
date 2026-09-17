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

function canonicalReady() {
  return {
    ok: true,
    status: 'PUBLIC_WEB_CANARY_PREFLIGHT_READY',
    decision: 'ENTER_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT',
    next_state: 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_RUN',
    readiness_id:
      'public_web_canary_preflight_readiness:execution-authorization-review-boundary-test',
    readiness_fingerprint:
      'sha256:synthetic-execution-authorization-review-readiness-fingerprint',
    preparation: {
      preparation_eligibility_id:
        'execution_preparation_eligibility:execution-authorization-review-boundary-test'
    },
    trial: {
      trial_id:
        'public_web_trial_execution_authorization_review_boundary_test',
      plan_hash:
        'sha256:synthetic-execution-authorization-review-plan'
    },
    identity: {
      tenant_id:
        'tenant-execution-authorization-review-boundary-test'
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

function assertNoAuthorizationOrExecution(result) {
  assert.equal(result.authority_boundary.review_only, true);
  assert.equal(
    result.authority_boundary.explicit_separate_authorization_required,
    true
  );
  assert.equal(result.authority_boundary.authorization_granted, false);
  assert.equal(
    result.authority_boundary.execution_reservation_created,
    false
  );
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
    result.authorization_review_request.explicit_separate_authorization_required,
    true
  );
  assert.equal(
    result.authorization_review_request.authorization_granted,
    false
  );
  assert.equal(
    result.authorization_review_request.execution_reservation_created,
    false
  );
  assert.equal(
    result.authorization_review_request.can_trigger_real_execution,
    false
  );
  assert.equal(
    result.authorization_review_request.real_execution_authorized,
    false
  );
  assert.equal(result.authorization_review_request.simulated, true);
  assert.equal(result.authorization_review_request.executed, false);
  assert.equal(
    result.authorization_review_request.production_effect,
    'ZERO'
  );

  assert.equal(result.evidence.authorization_granted, false);
  assert.equal(result.evidence.execution_reservation_created, false);
  assert.equal(result.evidence.can_trigger_real_execution, false);
  assert.equal(result.evidence.real_execution_authorized, false);
  assert.equal(result.evidence.simulated, true);
  assert.equal(result.evidence.executed, false);
  assert.equal(result.evidence.provider_called, false);
  assert.equal(result.evidence.external_network_used, false);
  assert.equal(result.evidence.secret_resolved, false);
  assert.equal(result.evidence.production_effect, 'ZERO');
}

test('validated fake-only evidence prepares deterministic authorization review without granting authority', () => {
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

  const first =
    authorizationReviewBoundary.evaluatePublicWebCanaryExecutionAuthorizationReviewBoundary(
      fakeDryRun,
      dryRun,
      consumer,
      reference,
      entry
    );
  const replay =
    authorizationReviewBoundary.evaluatePublicWebCanaryExecutionAuthorizationReviewBoundary(
      fakeDryRun,
      dryRun,
      consumer,
      reference,
      entry
    );

  assert.equal(first.ok, true);
  assert.equal(
    first.status,
    'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_PREPARED_SIMULATION'
  );
  assert.equal(
    first.decision,
    'PREPARE_PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW'
  );
  assert.equal(
    first.next_state,
    'WAITING_PUBLIC_WEB_CANARY_EXPLICIT_EXECUTION_AUTHORIZATION'
  );
  assert.equal(
    first.authorization_review_request.request_type,
    'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_REQUEST_SIMULATION'
  );
  assert.equal(
    first.authorization_review_request.review_scope,
    'NON_PRODUCTION_SINGLE_EXECUTION_REVIEW_ONLY'
  );
  assert.equal(
    first.authorization_review_request.fake_dry_run_evidence_id,
    fakeDryRun.fake_dry_run_evidence_id
  );
  assert.equal(
    first.authorization_review_request.dry_run_request_id,
    dryRun.dry_run_request_id
  );
  assert.deepEqual(replay, first);
  assertNoAuthorizationOrExecution(first);

  const validation =
    authorizationReviewBoundary.validatePublicWebCanaryExecutionAuthorizationReviewBoundaryResult(
      first,
      fakeDryRun,
      dryRun,
      consumer,
      reference,
      entry
    );
  assert.equal(validation.valid, true);
});

test('tampered fake dry-run evidence id fails closed before authorization review is trusted', () => {
  const entry = validEntry();
  const reference = validReference(entry);
  const consumer = validPreflightRequestConsumer(entry, reference);
  const dryRun = validDryRunRequest(entry, reference, consumer);
  const fakeDryRun = structuredClone(
    validFakeDryRun(entry, reference, consumer, dryRun)
  );
  fakeDryRun.fake_dry_run_evidence_id =
    'public_web_canary_fake_dry_run_evidence:tampered';

  const result =
    authorizationReviewBoundary.evaluatePublicWebCanaryExecutionAuthorizationReviewBoundary(
      fakeDryRun,
      dryRun,
      consumer,
      reference,
      entry
    );

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_review_source_validation::dry_run_request_consumer_context_mismatch'
    )
  );
  assert.ok(result.reason_codes.includes('fail_closed'));
  assertNoAuthorizationOrExecution(result);
});

test('tampered fake dry-run evidence fingerprint fails closed', () => {
  const entry = validEntry();
  const reference = validReference(entry);
  const consumer = validPreflightRequestConsumer(entry, reference);
  const dryRun = validDryRunRequest(entry, reference, consumer);
  const fakeDryRun = structuredClone(
    validFakeDryRun(entry, reference, consumer, dryRun)
  );
  fakeDryRun.fake_dry_run_evidence_fingerprint =
    'sha256:tampered-fake-dry-run-evidence';

  const result =
    authorizationReviewBoundary.evaluatePublicWebCanaryExecutionAuthorizationReviewBoundary(
      fakeDryRun,
      dryRun,
      consumer,
      reference,
      entry
    );

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_review_source_validation::dry_run_request_consumer_context_mismatch'
    )
  );
  assertNoAuthorizationOrExecution(result);
});

test('authorization review remains bound to dry-run, preflight, entry and readiness identities', () => {
  const entry = validEntry();
  const reference = validReference(entry);
  const consumer = validPreflightRequestConsumer(entry, reference);
  const dryRun = validDryRunRequest(entry, reference, consumer);
  const fakeDryRun = structuredClone(
    validFakeDryRun(entry, reference, consumer, dryRun)
  );

  fakeDryRun.fake_dry_run_evidence.dry_run_request_id =
    'public_web_canary_dry_run_request:other';
  fakeDryRun.fake_dry_run_evidence.preflight_request_id =
    'public_web_canary_preflight_request:other';
  fakeDryRun.fake_dry_run_evidence.entry_id =
    'public_web_canary_preflight_entry:other';
  fakeDryRun.fake_dry_run_evidence.readiness_id =
    'public_web_canary_preflight_readiness:other';

  const result =
    authorizationReviewBoundary.evaluatePublicWebCanaryExecutionAuthorizationReviewBoundary(
      fakeDryRun,
      dryRun,
      consumer,
      reference,
      entry
    );

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_review_source_validation::dry_run_request_consumer_context_mismatch'
    )
  );
  assertNoAuthorizationOrExecution(result);
});

test('unsafe source authority is rejected fail closed', () => {
  const entry = validEntry();
  const reference = validReference(entry);
  const consumer = validPreflightRequestConsumer(entry, reference);
  const dryRun = validDryRunRequest(entry, reference, consumer);
  const fakeDryRun = structuredClone(
    validFakeDryRun(entry, reference, consumer, dryRun)
  );

  fakeDryRun.authority_boundary.provider_called = true;
  fakeDryRun.authority_boundary.external_network_used = true;
  fakeDryRun.authority_boundary.secret_resolved = true;
  fakeDryRun.authority_boundary.real_execution_authorized = true;

  const result =
    authorizationReviewBoundary.evaluatePublicWebCanaryExecutionAuthorizationReviewBoundary(
      fakeDryRun,
      dryRun,
      consumer,
      reference,
      entry
    );

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_review_source_authority_provider_called_must_be_false'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_review_source_authority_external_network_used_must_be_false'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_review_source_authority_secret_resolved_must_be_false'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'execution_authorization_review_source_authority_real_execution_authorized_must_be_false'
    )
  );
  assertNoAuthorizationOrExecution(result);
});

test('legacy authorization fields cannot bridge fake evidence into execution authority', () => {
  const entry = validEntry();
  const reference = validReference(entry);
  const consumer = validPreflightRequestConsumer(entry, reference);
  const dryRun = validDryRunRequest(entry, reference, consumer);
  const fakeDryRun = structuredClone(
    validFakeDryRun(entry, reference, consumer, dryRun)
  );

  fakeDryRun.ready = true;
  fakeDryRun.execution_authorized = true;
  fakeDryRun.operator_confirmation_authorized = true;
  fakeDryRun.real_execution_authorized = true;

  const result =
    authorizationReviewBoundary.evaluatePublicWebCanaryExecutionAuthorizationReviewBoundary(
      fakeDryRun,
      dryRun,
      consumer,
      reference,
      entry
    );

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'legacy_execution_authorization_review_source_field_forbidden::ready'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'legacy_execution_authorization_review_source_field_forbidden::execution_authorized'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'legacy_execution_authorization_review_source_field_forbidden::operator_confirmation_authorized'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'legacy_execution_authorization_review_source_field_forbidden::real_execution_authorized'
    )
  );
  assertNoAuthorizationOrExecution(result);
});

test('tampered authorization review result is rejected by deterministic validation', () => {
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
  const result =
    authorizationReviewBoundary.evaluatePublicWebCanaryExecutionAuthorizationReviewBoundary(
      fakeDryRun,
      dryRun,
      consumer,
      reference,
      entry
    );
  const tampered = structuredClone(result);
  tampered.authorization_review_request_fingerprint =
    'sha256:tampered-authorization-review';

  const validation =
    authorizationReviewBoundary.validatePublicWebCanaryExecutionAuthorizationReviewBoundaryResult(
      tampered,
      fakeDryRun,
      dryRun,
      consumer,
      reference,
      entry
    );

  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.includes(
      'execution_authorization_review_context_mismatch'
    )
  );
});

test('authorization review boundary has no operational runner, provider, network, secret, database, queue or worker dependency', () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'src',
      'core',
      'public-web-canary-execution-authorization-review-boundary.js'
    ),
    'utf8'
  );

  assert.equal(
    source.includes(
      "require('./public-web-canary-dry-run-request-consumer-boundary')"
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

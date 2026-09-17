'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const readinessModulePath = require.resolve('../src/core/public-web-canary-preflight-readiness-boundary');
const entryModulePath = require.resolve('../src/core/public-web-canary-preflight-entry-boundary');
const readinessModule = require(readinessModulePath);
const realReadinessValidator = readinessModule.validatePublicWebCanaryPreflightReadinessResult;

function loadEntryBoundaryWithValidator(validator) {
  readinessModule.validatePublicWebCanaryPreflightReadinessResult = validator;
  delete require.cache[entryModulePath];
  const loaded = require(entryModulePath);
  readinessModule.validatePublicWebCanaryPreflightReadinessResult = realReadinessValidator;
  return loaded;
}

const entryBoundary = loadEntryBoundaryWithValidator(() => ({ valid: true, errors: [] }));
const referenceBoundary = require('../src/core/public-web-canary-preflight-entry-reference-boundary');
const entryReferenceConsumerBoundary = require('../src/core/public-web-canary-preflight-entry-reference-consumer-boundary');
const requestConsumerBoundary = require('../src/core/public-web-canary-preflight-request-consumer-boundary');

function canonicalReady() {
  return {
    ok: true,
    status: 'PUBLIC_WEB_CANARY_PREFLIGHT_READY',
    decision: 'ENTER_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT',
    next_state: 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_RUN',
    readiness_id: 'public_web_canary_preflight_readiness:request-consumer-boundary-test',
    readiness_fingerprint: 'sha256:synthetic-request-consumer-readiness-fingerprint',
    preparation: {
      preparation_eligibility_id: 'execution_preparation_eligibility:request-consumer-boundary-test'
    },
    trial: {
      trial_id: 'public_web_trial_request_consumer_boundary_test',
      plan_hash: 'sha256:synthetic-request-consumer-plan'
    },
    identity: {
      tenant_id: 'tenant-request-consumer-boundary-test'
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
    validator_version: readinessModule.PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_VALIDATOR_VERSION
  };
}

function validEntry() {
  const result = entryBoundary.evaluatePublicWebCanaryPreflightEntryBoundary(canonicalReady(), {});
  assert.equal(result.ok, true);
  return result;
}

function validReference(entry = validEntry()) {
  const result = referenceBoundary.evaluatePublicWebCanaryPreflightEntryReferenceBoundary(entry);
  assert.equal(result.ok, true);
  return result;
}

function validPreflightRequestConsumer(entry = validEntry(), reference = validReference(entry)) {
  const result =
    entryReferenceConsumerBoundary.evaluatePublicWebCanaryPreflightEntryReferenceConsumerBoundary(
      reference,
      entry
    );
  assert.equal(result.ok, true);
  return result;
}

function assertNoExecution(result) {
  assert.equal(result.authority_boundary.non_side_effect_only, true);
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
  assert.equal(result.authority_boundary.real_execution_authorized, false);
  assert.equal(result.authority_boundary.production_effect, 'ZERO');
  assert.equal(result.dry_run_request.simulated, true);
  assert.equal(result.dry_run_request.executed, false);
  assert.equal(result.dry_run_request.dry_run_execution, false);
  assert.equal(result.dry_run_request.real_provider_called, false);
  assert.equal(result.dry_run_request.can_trigger_real_execution, false);
  assert.equal(result.dry_run_request.real_execution_authorized, false);
  assert.equal(result.dry_run_request.production_effect, 'ZERO');
  assert.equal(result.evidence.simulated, true);
  assert.equal(result.evidence.executed, false);
  assert.equal(result.evidence.dry_run_execution, false);
  assert.equal(result.evidence.real_provider_called, false);
  assert.equal(result.evidence.can_trigger_real_execution, false);
  assert.equal(result.evidence.real_execution_authorized, false);
  assert.equal(result.evidence.production_effect, 'ZERO');
}

test('validated preflight request produces only a deterministic simulated dry-run request', () => {
  const entry = validEntry();
  const reference = validReference(entry);
  const consumer = validPreflightRequestConsumer(entry, reference);
  const first = requestConsumerBoundary.evaluatePublicWebCanaryPreflightRequestConsumerBoundary(
    consumer,
    reference,
    entry
  );
  const replay = requestConsumerBoundary.evaluatePublicWebCanaryPreflightRequestConsumerBoundary(
    consumer,
    reference,
    entry
  );

  assert.equal(first.ok, true);
  assert.equal(first.status, 'PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_PREPARED_SIMULATION');
  assert.equal(first.decision, 'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_DRY_RUN_REQUEST');
  assert.equal(first.next_state, 'WAITING_PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER');
  assert.equal(first.dry_run_request.preflight_request_id, consumer.preflight_request_id);
  assert.equal(
    first.dry_run_request.preflight_request_fingerprint,
    consumer.preflight_request_fingerprint
  );
  assert.equal(first.dry_run_request.entry_reference_id, reference.entry_reference_id);
  assert.equal(first.dry_run_request.entry_id, entry.entry_id);
  assert.equal(first.dry_run_request.readiness_id, entry.readiness_reference.readiness_id);
  assert.equal(first.dry_run_request.execution_mode, 'NON_SIDE_EFFECT_SIMULATION_ONLY');
  assert.deepEqual(replay, first);
  assertNoExecution(first);
  assert.equal(
    requestConsumerBoundary.validatePublicWebCanaryPreflightRequestConsumerBoundaryResult(
      first,
      consumer,
      reference,
      entry
    ).valid,
    true
  );
});

test('tampered preflight request id fails closed before any dry-run request is trusted', () => {
  const entry = validEntry();
  const reference = validReference(entry);
  const consumer = structuredClone(validPreflightRequestConsumer(entry, reference));
  consumer.preflight_request_id = 'public_web_canary_preflight_request:tampered';

  const result = requestConsumerBoundary.evaluatePublicWebCanaryPreflightRequestConsumerBoundary(
    consumer,
    reference,
    entry
  );

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'preflight_request_consumer_source_validation::preflight_entry_reference_consumer_context_mismatch'
    )
  );
  assert.ok(result.reason_codes.includes('fail_closed'));
  assertNoExecution(result);
});

test('tampered preflight request fingerprint fails closed before any dry-run request is trusted', () => {
  const entry = validEntry();
  const reference = validReference(entry);
  const consumer = structuredClone(validPreflightRequestConsumer(entry, reference));
  consumer.preflight_request_fingerprint = 'sha256:tampered-preflight-request';

  const result = requestConsumerBoundary.evaluatePublicWebCanaryPreflightRequestConsumerBoundary(
    consumer,
    reference,
    entry
  );

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'preflight_request_consumer_source_validation::preflight_entry_reference_consumer_context_mismatch'
    )
  );
  assert.ok(result.reason_codes.includes('fail_closed'));
  assertNoExecution(result);
});

test('preflight request remains bound to reference, entry and readiness identities', () => {
  const entry = validEntry();
  const reference = validReference(entry);
  const consumer = structuredClone(validPreflightRequestConsumer(entry, reference));
  consumer.preflight_request.entry_reference_id = 'public_web_canary_preflight_entry_reference:other';
  consumer.preflight_request.entry_id = 'public_web_canary_preflight_entry:other';
  consumer.preflight_request.readiness_id = 'public_web_canary_preflight_readiness:other';

  const result = requestConsumerBoundary.evaluatePublicWebCanaryPreflightRequestConsumerBoundary(
    consumer,
    reference,
    entry
  );

  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('preflight_request_binding_entry_reference_id_mismatch'));
  assert.ok(result.reason_codes.includes('preflight_request_binding_entry_id_mismatch'));
  assert.ok(result.reason_codes.includes('preflight_request_binding_readiness_id_mismatch'));
  assert.ok(result.reason_codes.includes('preflight_request_entry_reference_id_mismatch'));
  assert.ok(result.reason_codes.includes('preflight_request_entry_id_mismatch'));
  assert.ok(result.reason_codes.includes('preflight_request_readiness_id_mismatch'));
  assertNoExecution(result);
});

test('unsafe authority on the source preflight request is rejected fail closed', () => {
  const entry = validEntry();
  const reference = validReference(entry);
  const consumer = structuredClone(validPreflightRequestConsumer(entry, reference));
  consumer.authority_boundary.dry_run_execution = true;
  consumer.authority_boundary.provider_called = true;
  consumer.authority_boundary.external_network_used = true;
  consumer.authority_boundary.real_execution_authorized = true;

  const result = requestConsumerBoundary.evaluatePublicWebCanaryPreflightRequestConsumerBoundary(
    consumer,
    reference,
    entry
  );

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes(
      'preflight_request_consumer_source_authority_dry_run_execution_must_be_false'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'preflight_request_consumer_source_authority_provider_called_must_be_false'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'preflight_request_consumer_source_authority_external_network_used_must_be_false'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'preflight_request_consumer_source_authority_real_execution_authorized_must_be_false'
    )
  );
  assertNoExecution(result);
});

test('legacy authorization fields cannot bridge the preflight request into dry-run execution', () => {
  const entry = validEntry();
  const reference = validReference(entry);
  const consumer = structuredClone(validPreflightRequestConsumer(entry, reference));
  consumer.ready = true;
  consumer.dry_run_authorized = true;
  consumer.execution_authorized = true;

  const result = requestConsumerBoundary.evaluatePublicWebCanaryPreflightRequestConsumerBoundary(
    consumer,
    reference,
    entry
  );

  assert.equal(result.ok, false);
  assert.ok(
    result.reason_codes.includes('legacy_preflight_request_consumer_field_forbidden::ready')
  );
  assert.ok(
    result.reason_codes.includes(
      'legacy_preflight_request_consumer_field_forbidden::dry_run_authorized'
    )
  );
  assert.ok(
    result.reason_codes.includes(
      'legacy_preflight_request_consumer_field_forbidden::execution_authorized'
    )
  );
  assert.ok(result.reason_codes.includes('fail_closed'));
  assertNoExecution(result);
});

test('tampered dry-run request result is rejected by deterministic validation', () => {
  const entry = validEntry();
  const reference = validReference(entry);
  const consumer = validPreflightRequestConsumer(entry, reference);
  const result = requestConsumerBoundary.evaluatePublicWebCanaryPreflightRequestConsumerBoundary(
    consumer,
    reference,
    entry
  );
  const tampered = structuredClone(result);
  tampered.dry_run_request_fingerprint = 'sha256:tampered-dry-run-request';

  const validation =
    requestConsumerBoundary.validatePublicWebCanaryPreflightRequestConsumerBoundaryResult(
      tampered,
      consumer,
      reference,
      entry
    );

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('preflight_request_consumer_context_mismatch'));
});

test('preflight request consumer has no operational trial, dry-run runner, provider, network, secret, queue or worker dependency', () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'src',
      'core',
      'public-web-canary-preflight-request-consumer-boundary.js'
    ),
    'utf8'
  );

  assert.equal(
    source.includes("require('./public-web-canary-preflight-entry-reference-consumer-boundary')"),
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

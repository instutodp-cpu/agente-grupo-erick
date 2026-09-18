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
const {
  createPublicWebCanaryExecutionReservationLedger
} = require('../src/core/public-web-canary-execution-reservation-ledger');
const {
  REQUIRED_CONFIRMATION,
  createPublicWebCanaryRealNonProductionExecutionBridge
} = require('../src/pilots/public-web-canary-real-non-production-execution-bridge');

function canonicalReady() {
  return {
    ok: true,
    status: 'PUBLIC_WEB_CANARY_PREFLIGHT_READY',
    decision: 'ENTER_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT',
    next_state: 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_RUN',
    readiness_id:
      'public_web_canary_preflight_readiness:real-bridge-test',
    readiness_fingerprint:
      'sha256:synthetic-real-bridge-readiness-fingerprint',
    preparation: {
      preparation_eligibility_id:
        'execution_preparation_eligibility:real-bridge-test'
    },
    trial: {
      trial_id: 'public_web_trial_real_bridge_test',
      plan_hash: 'sha256:synthetic-real-bridge-plan'
    },
    identity: {
      tenant_id: 'tenant-real-bridge-test'
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

function buildChain() {
  const entry =
    entryBoundary.evaluatePublicWebCanaryPreflightEntryBoundary(
      canonicalReady(),
      {}
    );
  assert.equal(entry.ok, true);

  const reference =
    referenceBoundary.evaluatePublicWebCanaryPreflightEntryReferenceBoundary(
      entry
    );
  assert.equal(reference.ok, true);

  const consumer =
    entryReferenceConsumerBoundary.evaluatePublicWebCanaryPreflightEntryReferenceConsumerBoundary(
      reference,
      entry
    );
  assert.equal(consumer.ok, true);

  const dryRun =
    preflightRequestConsumerBoundary.evaluatePublicWebCanaryPreflightRequestConsumerBoundary(
      consumer,
      reference,
      entry
    );
  assert.equal(dryRun.ok, true);

  const fakeDryRun =
    dryRunRequestConsumerBoundary.evaluatePublicWebCanaryDryRunRequestConsumerBoundary(
      dryRun,
      consumer,
      reference,
      entry
    );
  assert.equal(fakeDryRun.ok, true);

  const review =
    authorizationReviewBoundary.evaluatePublicWebCanaryExecutionAuthorizationReviewBoundary(
      fakeDryRun,
      dryRun,
      consumer,
      reference,
      entry
    );
  assert.equal(review.ok, true);

  const intentInput = {
    environment: 'staging',
    authorization_scope:
      'PUBLIC_WEB_CANARY_SINGLE_EXECUTION_NON_PRODUCTION',
    approval_mode: 'DUAL_CONTROL_REQUIRED',
    operator_id: 'operator:real-bridge-test',
    approver_id: 'approver:real-bridge-test',
    requested_execution_count: 1,
    ttl_seconds: 300,
    replay_key: 'replay:real-bridge-test:001',
    request_reference: 'request:real-bridge-test:001'
  };

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

  const grantInput = {
    grant_mode: 'DUAL_CONTROL_SINGLE_USE',
    operator_confirmation: true,
    approver_confirmation: true,
    operator_id: 'operator:real-bridge-test',
    approver_id: 'approver:real-bridge-test',
    issued_at: '2026-09-18T15:00:00.000Z',
    expires_at: '2026-09-18T15:05:00.000Z',
    ttl_seconds: 300,
    replay_key: 'replay:real-bridge-test:001',
    grant_nonce: 'grant-nonce:real-bridge-test:001',
    reservation_nonce: 'reservation-nonce:real-bridge-test:001',
    grant_reference: 'grant-reference:real-bridge-test:001',
    replay_guard: {
      known_replay_keys: [],
      known_grant_nonces: [],
      known_reservation_nonces: []
    }
  };

  const grantResult =
    grantReservationBoundary.evaluatePublicWebCanaryExecutionAuthorizationGrantReservationBoundary(
      intentResult,
      review,
      fakeDryRun,
      dryRun,
      consumer,
      reference,
      entry,
      intentInput,
      grantInput
    );
  assert.equal(grantResult.ok, true);

  return {
    entryResult: entry,
    referenceResult: reference,
    consumerResult: consumer,
    dryRunResult: dryRun,
    fakeDryRunResult: fakeDryRun,
    reviewResult: review,
    intentInput,
    intentResult,
    grantInput,
    grantResult
  };
}

function bridgeInput(chain, overrides = {}) {
  return {
    activation_confirmation: REQUIRED_CONFIRMATION,
    authorization_grant_id: chain.grantResult.authorization_grant_id,
    execution_reservation_id:
      chain.grantResult.execution_reservation_id,
    grant_reservation_fingerprint:
      chain.grantResult.grant_reservation_fingerprint,
    replay_key:
      chain.grantResult.execution_reservation.replay_key,
    reservation_nonce:
      chain.grantResult.execution_reservation.reservation_nonce,
    environment: 'staging',
    tenant_id: 'tenant-real-bridge-test',
    trial_id: 'public_web_trial_real_bridge_test',
    plan_hash: 'sha256:synthetic-real-bridge-plan',
    execution_count: 1,
    execution_id: 'execution:real-bridge-test:001',
    requested_at: '2026-09-18T15:02:00.000Z',
    single_process_manual_canary: true,
    write_allowed: false,
    action_allowed: false,
    send_allowed: false,
    publish_allowed: false,
    delete_allowed: false,
    runner_request: {
      canary_session_id: 'canary-session:real-bridge-test',
      canary_execution_id: 'execution:real-bridge-test:001',
      trace_id: 'trace:real-bridge-test:001',
      request_id: 'runner-request:real-bridge-test:001',
      change_id: 'runner-change:real-bridge-test:001',
      expected_version: 7,
      target_path: '/',
      requested_content_types: ['text/html'],
      timeout_ms: 3000,
      max_response_bytes: 4096
    },
    ...overrides
  };
}

function runtime(overrides = {}) {
  const session = {
    canary_session_id: 'canary-session:real-bridge-test',
    canary_state: 'active',
    environment: 'staging',
    tenant_id: 'tenant-real-bridge-test',
    maximum_requests: 1,
    requests_used: 0,
    version: 7,
    target_origin: 'https://example.com',
    target_path: '/',
    operation: 'read',
    source_type: 'public_web'
  };
  return {
    canarySessionRegistry: {
      getCanarySession(id) {
        return id === session.canary_session_id
          ? structuredClone(session)
          : null;
      }
    },
    requireDurableAudit: true,
    auditSink: {
      durable: true,
      async appendDurably() {
        return { ok: true };
      }
    },
    clock: () => '2026-09-18T15:02:00.000Z',
    ...overrides
  };
}

function successfulFakeRunner(counter) {
  return {
    async runCanaryRequest() {
      counter.calls += 1;
      return {
        status: 'public_web_candidate_success',
        executed: true,
        real_provider_called: true,
        result_count: 1,
        bytes_received: 128,
        duration_ms: 10
      };
    }
  };
}

test('authorized bridge atomically consumes one reservation/replay key before one injected runner call', async () => {
  const chain = buildChain();
  const counter = { calls: 0 };
  const ledger = createPublicWebCanaryExecutionReservationLedger({
    clock: () => '2026-09-18T15:02:00.000Z'
  });
  const bridge = createPublicWebCanaryRealNonProductionExecutionBridge({
    reservationLedger: ledger,
    canaryRunner: successfulFakeRunner(counter)
  });

  const result = await bridge.execute({
    chain,
    bridgeInput: bridgeInput(chain),
    runtime: runtime()
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.status,
    'PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_COMPLETED'
  );
  assert.equal(result.authorization_granted, true);
  assert.equal(result.execution_reservation_created, true);
  assert.equal(result.reservation_consumed, true);
  assert.equal(result.replay_key_consumed, true);
  assert.equal(result.remaining_execution_count, 0);
  assert.equal(result.execution_bridge_authorized, true);
  assert.equal(result.real_execution_authorized, true);
  assert.equal(result.runner_invoked, true);
  assert.equal(result.executed, true);
  assert.equal(result.real_provider_called, true);
  assert.equal(result.environment, 'staging');
  assert.equal(result.production_blocked, true);
  assert.equal(result.production_effect, 'ZERO');
  assert.equal(counter.calls, 1);

  const stored = ledger.getReservation(
    chain.grantResult.execution_reservation_id
  );
  assert.equal(stored.state, 'CONSUMED');
  assert.equal(stored.consumed, true);
  assert.equal(stored.execution_id, 'execution:real-bridge-test:001');
});

test('two concurrent bridge calls can invoke the runner at most once', async () => {
  const chain = buildChain();
  const counter = { calls: 0 };
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const runner = {
    async runCanaryRequest() {
      counter.calls += 1;
      await gate;
      return {
        status: 'public_web_candidate_success',
        executed: true,
        real_provider_called: true
      };
    }
  };
  const ledger = createPublicWebCanaryExecutionReservationLedger({
    clock: () => '2026-09-18T15:02:00.000Z'
  });
  const bridge = createPublicWebCanaryRealNonProductionExecutionBridge({
    reservationLedger: ledger,
    canaryRunner: runner
  });

  const input = {
    chain,
    bridgeInput: bridgeInput(chain),
    runtime: runtime()
  };
  const first = bridge.execute(input);
  const second = bridge.execute(input);
  release();

  const [a, b] = await Promise.all([first, second]);
  const successes = [a, b].filter((item) => item.runner_invoked === true);
  const blocked = [a, b].find((item) => item.runner_invoked !== true);

  assert.equal(successes.length, 1);
  assert.equal(counter.calls, 1);
  assert.equal(blocked.ok, false);
  assert.ok(
    blocked.reason_codes.includes(
      'bridge_reservation_consumption::reservation_already_consumed'
    )
  );
});

test('missing exact confirmation blocks before reservation consumption', async () => {
  const chain = buildChain();
  const counter = { calls: 0 };
  const ledger = createPublicWebCanaryExecutionReservationLedger({
    clock: () => '2026-09-18T15:02:00.000Z'
  });
  const bridge = createPublicWebCanaryRealNonProductionExecutionBridge({
    reservationLedger: ledger,
    canaryRunner: successfulFakeRunner(counter)
  });
  const input = bridgeInput(chain, {
    activation_confirmation: 'confirmar'
  });

  const result = await bridge.execute({
    chain,
    bridgeInput: input,
    runtime: runtime()
  });

  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('bridge_exact_confirmation_required'));
  assert.equal(result.reservation_consumed, false);
  assert.equal(result.runner_invoked, false);
  assert.equal(counter.calls, 0);
  assert.equal(
    ledger.getReservation(chain.grantResult.execution_reservation_id),
    null
  );
});

test('production session is structurally blocked before consumption', async () => {
  const chain = buildChain();
  const counter = { calls: 0 };
  const ledger = createPublicWebCanaryExecutionReservationLedger({
    clock: () => '2026-09-18T15:02:00.000Z'
  });
  const bridge = createPublicWebCanaryRealNonProductionExecutionBridge({
    reservationLedger: ledger,
    canaryRunner: successfulFakeRunner(counter)
  });
  const prodRuntime = runtime({
    canarySessionRegistry: {
      getCanarySession() {
        return {
          canary_session_id: 'canary-session:real-bridge-test',
          canary_state: 'active',
          environment: 'production',
          tenant_id: 'tenant-real-bridge-test',
          maximum_requests: 1,
          requests_used: 0,
          version: 7,
          target_origin: 'https://example.com',
          target_path: '/',
          operation: 'read',
          source_type: 'public_web'
        };
      }
    }
  });

  const result = await bridge.execute({
    chain,
    bridgeInput: bridgeInput(chain),
    runtime: prodRuntime
  });

  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('bridge_session_environment_mismatch'));
  assert.ok(result.reason_codes.includes('bridge_session_environment_blocked'));
  assert.equal(result.reservation_consumed, false);
  assert.equal(result.runner_invoked, false);
  assert.equal(counter.calls, 0);
});

test('expired grant blocks before consumption and runner invocation', async () => {
  const chain = buildChain();
  const counter = { calls: 0 };
  const ledger = createPublicWebCanaryExecutionReservationLedger({
    clock: () => '2026-09-18T15:06:00.000Z'
  });
  const bridge = createPublicWebCanaryRealNonProductionExecutionBridge({
    reservationLedger: ledger,
    canaryRunner: successfulFakeRunner(counter)
  });

  const result = await bridge.execute({
    chain,
    bridgeInput: bridgeInput(chain, {
      requested_at: '2026-09-18T15:06:00.000Z'
    }),
    runtime: runtime({
      clock: () => '2026-09-18T15:06:00.000Z'
    })
  });

  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('bridge_grant_expired'));
  assert.equal(result.reservation_consumed, false);
  assert.equal(result.runner_invoked, false);
  assert.equal(counter.calls, 0);
});

test('durable audit is mandatory before a real-capable bridge can consume', async () => {
  const chain = buildChain();
  const counter = { calls: 0 };
  const ledger = createPublicWebCanaryExecutionReservationLedger({
    clock: () => '2026-09-18T15:02:00.000Z'
  });
  const bridge = createPublicWebCanaryRealNonProductionExecutionBridge({
    reservationLedger: ledger,
    canaryRunner: successfulFakeRunner(counter)
  });

  const result = await bridge.execute({
    chain,
    bridgeInput: bridgeInput(chain),
    runtime: runtime({
      requireDurableAudit: false,
      auditSink: { durable: false }
    })
  });

  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('bridge_durable_audit_required'));
  assert.ok(result.reason_codes.includes('bridge_durable_audit_sink_required'));
  assert.equal(result.reservation_consumed, false);
  assert.equal(result.runner_invoked, false);
  assert.equal(counter.calls, 0);
});

test('a pre-network runner failure still consumes the single-use reservation and cannot retry', async () => {
  const chain = buildChain();
  const counter = { calls: 0 };
  const runner = {
    async runCanaryRequest() {
      counter.calls += 1;
      return {
        status: 'public_web_canary_request_failed_safe',
        executed: false,
        real_provider_called: false
      };
    }
  };
  const ledger = createPublicWebCanaryExecutionReservationLedger({
    clock: () => '2026-09-18T15:02:00.000Z'
  });
  const bridge = createPublicWebCanaryRealNonProductionExecutionBridge({
    reservationLedger: ledger,
    canaryRunner: runner
  });
  const payload = {
    chain,
    bridgeInput: bridgeInput(chain),
    runtime: runtime()
  };

  const first = await bridge.execute(payload);
  const second = await bridge.execute(payload);

  assert.equal(first.ok, false);
  assert.equal(first.reservation_consumed, true);
  assert.equal(first.replay_key_consumed, true);
  assert.equal(first.runner_invoked, true);
  assert.equal(first.executed, false);
  assert.equal(first.real_provider_called, false);
  assert.equal(second.ok, false);
  assert.ok(
    second.reason_codes.includes(
      'bridge_reservation_consumption::reservation_already_consumed'
    )
  );
  assert.equal(counter.calls, 1);
});

test('bridge never restores a consumed reservation when runner throws', async () => {
  const chain = buildChain();
  const ledger = createPublicWebCanaryExecutionReservationLedger({
    clock: () => '2026-09-18T15:02:00.000Z'
  });
  const bridge = createPublicWebCanaryRealNonProductionExecutionBridge({
    reservationLedger: ledger,
    canaryRunner: {
      async runCanaryRequest() {
        throw new Error('synthetic runner failure');
      }
    }
  });

  const result = await bridge.execute({
    chain,
    bridgeInput: bridgeInput(chain),
    runtime: runtime()
  });

  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('bridge_runner_throw_safe'));
  assert.equal(result.reservation_consumed, true);
  assert.equal(result.replay_key_consumed, true);
  assert.equal(
    ledger.getReservation(chain.grantResult.execution_reservation_id).state,
    'CONSUMED'
  );
});

test('bridge is dormant: it is not wired into API index or the operational CLI', () => {
  const apiIndex = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'index.js'),
    'utf8'
  );
  const operationalCli = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'scripts',
      'public-web-canary-operational-trial.js'
    ),
    'utf8'
  );

  assert.equal(
    apiIndex.includes('public-web-canary-real-non-production-execution-bridge'),
    false
  );
  assert.equal(
    operationalCli.includes(
      'public-web-canary-real-non-production-execution-bridge'
    ),
    false
  );
});

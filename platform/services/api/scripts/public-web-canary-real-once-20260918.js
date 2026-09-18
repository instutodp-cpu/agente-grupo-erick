#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const readinessBoundary = require('../src/core/public-web-canary-preflight-readiness-boundary');
const entryBoundary = require('../src/core/public-web-canary-preflight-entry-boundary');
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
  createPublicWebCanaryPersistentAuditSink
} = require('../src/core/public-web-canary-persistent-audit-sink');
const {
  buildDurableAuditRecord,
  createDurableAuditReceipt
} = require('../src/core/public-web-canary-durable-audit-contract');
const {
  createLocalTestSecretResolver
} = require('../src/core/provider-secret-resolver');
const {
  PROVIDER_ID
} = require('../src/core/public-web-transport-contract');
const {
  createPublicWebNodeHttpsClient
} = require('../src/adapters/public-web/public-web-node-https-client');
const {
  createPublicWebSafeDnsResolver
} = require('../src/adapters/public-web/public-web-safe-dns-resolver');
const {
  buildRunnerRequest,
  createSyntheticCanaryContext,
  prepareOperationalCanarySession
} = require('../src/pilots/public-web-canary-trial-dry-run');
const {
  createPublicWebCanaryRunner
} = require('../src/pilots/public-web-canary-runner');
const {
  REQUIRED_CONFIRMATION,
  createPublicWebCanaryRealNonProductionExecutionBridge
} = require('../src/pilots/public-web-canary-real-non-production-execution-bridge');

const EXPECTED_MAIN_SHA = '6f5a11a2f3e2efe638565265300641c7eb0e369c';
const EXPECTED_BRANCH = 'ops/public-web-canary-real-once-20260918';
const EXPECTED_COMMIT_MESSAGE = 'ops: execute authorized public web canary once';
const AUTHORIZATION_REFERENCE =
  'owner-explicit-authorization:2026-09-18:single-public-web-canary-non-production';

const artifactDir = path.resolve(process.cwd(), 'canary-artifacts');
const resultPath = path.join(artifactDir, 'result.json');
fs.mkdirSync(artifactDir, { recursive: true });

function nowIso() {
  return new Date().toISOString();
}

function plusSeconds(iso, seconds) {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

function safeError(error) {
  return {
    name: error && error.name ? String(error.name) : 'Error',
    message: error && error.message ? String(error.message) : 'unknown_error'
  };
}

function writeResult(value) {
  fs.writeFileSync(resultPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('missing_required_environment:' + name);
  }
  return value;
}

function loadCanonicalReadinessHelpers() {
  const testPath = path.resolve(
    __dirname,
    '../test/public-web-canary-preflight-readiness-boundary.test.js'
  );
  const source = fs.readFileSync(testPath, 'utf8');
  const cutoff = source.indexOf('\ntest(');
  if (cutoff < 0) {
    throw new Error('canonical_readiness_helper_cutoff_not_found');
  }
  const instrumented =
    source.slice(0, cutoff) +
    '\nmodule.exports = { canonicalPreparationBundle, evaluateReady };\n';
  const loaded = new Module(testPath, module);
  loaded.filename = testPath;
  loaded.paths = Module._nodeModulePaths(path.dirname(testPath));
  loaded._compile(instrumented, testPath);
  if (
    !loaded.exports ||
    typeof loaded.exports.canonicalPreparationBundle !== 'function' ||
    typeof loaded.exports.evaluateReady !== 'function'
  ) {
    throw new Error('canonical_readiness_helpers_unavailable');
  }
  return loaded.exports;
}

function assertOk(value, label) {
  if (!value || value.ok !== true) {
    const reasons =
      value && Array.isArray(value.reason_codes)
        ? value.reason_codes.join(',')
        : value && value.blocked_reason
          ? value.blocked_reason
          : 'not_ok';
    throw new Error(label + ':' + reasons);
  }
  return value;
}

function buildCanonicalAuthorizationChain(executionIdentity) {
  const helpers = loadCanonicalReadinessHelpers();
  const start = nowIso();
  const planOverrides = {
    trial_id: executionIdentity.trialId,
    environment: 'staging',
    target_policy_id: executionIdentity.targetPolicyId,
    target_origin: 'https://example.com',
    target_path: '/',
    source_type: 'public_documentation_page',
    operation: 'fetch_public_page_summary',
    requested_content_types: ['text/html'],
    maximum_requests: 1,
    rollout_percentage: 1,
    timeout_ms: 3000,
    maximum_response_bytes: 100000,
    workspace_type: 'corporate',
    tenant_id: 'tenant-a',
    user_id: 'user_public_web_real_once',
    operator_id: 'hermes_automated_execution_operator',
    operator_role: 'integration_operator',
    approver_id: 'owner_explicit_authorizer',
    approver_role: 'security_operator',
    reason: 'authorized single real non-production public web canary',
    session_expires_at: plusSeconds(start, 900),
    approval_expires_at: plusSeconds(start, 600)
  };

  const bundle = helpers.canonicalPreparationBundle({ planOverrides });
  const ready = helpers.evaluateReady(bundle);
  assertOk(ready.result, 'canonical_readiness_not_ready');

  const readinessValidation =
    readinessBoundary.validatePublicWebCanaryPreflightReadinessResult(
      ready.result,
      ready.context
    );
  if (!readinessValidation.valid) {
    throw new Error(
      'canonical_readiness_validation_failed:' +
        readinessValidation.errors.join(',')
    );
  }

  const entryResult = entryBoundary.evaluatePublicWebCanaryPreflightEntryBoundary(
    ready.result,
    ready.context
  );
  assertOk(entryResult, 'preflight_entry_not_prepared');

  const referenceResult =
    referenceBoundary.evaluatePublicWebCanaryPreflightEntryReferenceBoundary(
      entryResult
    );
  assertOk(referenceResult, 'preflight_reference_not_prepared');

  const consumerResult =
    entryReferenceConsumerBoundary.evaluatePublicWebCanaryPreflightEntryReferenceConsumerBoundary(
      referenceResult,
      entryResult
    );
  assertOk(consumerResult, 'preflight_reference_consumer_not_prepared');

  const dryRunResult =
    preflightRequestConsumerBoundary.evaluatePublicWebCanaryPreflightRequestConsumerBoundary(
      consumerResult,
      referenceResult,
      entryResult
    );
  assertOk(dryRunResult, 'dry_run_request_not_prepared');

  const fakeDryRunResult =
    dryRunRequestConsumerBoundary.evaluatePublicWebCanaryDryRunRequestConsumerBoundary(
      dryRunResult,
      consumerResult,
      referenceResult,
      entryResult
    );
  assertOk(fakeDryRunResult, 'fake_dry_run_evidence_not_prepared');

  const reviewResult =
    authorizationReviewBoundary.evaluatePublicWebCanaryExecutionAuthorizationReviewBoundary(
      fakeDryRunResult,
      dryRunResult,
      consumerResult,
      referenceResult,
      entryResult
    );
  assertOk(reviewResult, 'authorization_review_not_prepared');

  const intentInput = {
    environment: 'staging',
    authorization_scope:
      'PUBLIC_WEB_CANARY_SINGLE_EXECUTION_NON_PRODUCTION',
    approval_mode: 'DUAL_CONTROL_REQUIRED',
    operator_id: 'hermes_automated_execution_operator',
    approver_id: 'owner_explicit_authorizer',
    requested_execution_count: 1,
    ttl_seconds: 600,
    replay_key: executionIdentity.replayKey,
    request_reference: AUTHORIZATION_REFERENCE
  };

  const intentResult =
    authorizationIntentBoundary.evaluatePublicWebCanaryExecutionAuthorizationIntentBoundary(
      reviewResult,
      fakeDryRunResult,
      dryRunResult,
      consumerResult,
      referenceResult,
      entryResult,
      intentInput
    );
  assertOk(intentResult, 'authorization_intent_not_prepared');

  const issuedAt = nowIso();
  const grantInput = {
    grant_mode: 'DUAL_CONTROL_SINGLE_USE',
    operator_confirmation: true,
    approver_confirmation: true,
    operator_id: 'hermes_automated_execution_operator',
    approver_id: 'owner_explicit_authorizer',
    issued_at: issuedAt,
    expires_at: plusSeconds(issuedAt, 600),
    ttl_seconds: 600,
    replay_key: executionIdentity.replayKey,
    grant_nonce: executionIdentity.grantNonce,
    reservation_nonce: executionIdentity.reservationNonce,
    grant_reference: AUTHORIZATION_REFERENCE,
    replay_guard: {
      known_replay_keys: [],
      known_grant_nonces: [],
      known_reservation_nonces: []
    }
  };

  const grantResult =
    grantReservationBoundary.evaluatePublicWebCanaryExecutionAuthorizationGrantReservationBoundary(
      intentResult,
      reviewResult,
      fakeDryRunResult,
      dryRunResult,
      consumerResult,
      referenceResult,
      entryResult,
      intentInput,
      grantInput
    );
  assertOk(grantResult, 'grant_reservation_not_created');

  const grantValidation =
    grantReservationBoundary.validatePublicWebCanaryExecutionAuthorizationGrantReservationBoundaryResult(
      grantResult,
      intentResult,
      reviewResult,
      fakeDryRunResult,
      dryRunResult,
      consumerResult,
      referenceResult,
      entryResult,
      intentInput,
      grantInput
    );
  if (!grantValidation.valid) {
    throw new Error(
      'grant_reservation_validation_failed:' +
        grantValidation.errors.join(',')
    );
  }

  return {
    plan: ready.plan,
    chain: {
      grantResult,
      intentResult,
      reviewResult,
      fakeDryRunResult,
      dryRunResult,
      consumerResult,
      referenceResult,
      entryResult,
      intentInput,
      grantInput
    }
  };
}

function createCachedDnsResolver() {
  const base = createPublicWebSafeDnsResolver();
  let lastHostname = null;
  let lastApprovedIps = [];
  return Object.freeze({
    async resolve(hostname, context = {}) {
      const result = await base.resolve(hostname, context);
      if (result && result.allowed === true) {
        lastHostname = hostname;
        lastApprovedIps = [...result.approved_ips];
      }
      return result;
    },
    resolveSyncForPolicy(hostname) {
      return hostname === lastHostname ? [...lastApprovedIps] : [];
    }
  });
}

function createCurrentSecretReference(plan, referenceId, clockIso) {
  return Object.freeze({
    reference_id: referenceId,
    reference_type: 'local_test_double_reference',
    provider_id: PROVIDER_ID,
    workspace_type: plan.workspace_type,
    tenant_id: plan.tenant_id,
    environment: 'local_test',
    status: 'reference_registered',
    reference_version: 1,
    synthetic: true,
    disabled: false,
    revoked: false,
    created_at: clockIso,
    updated_at: clockIso,
    last_rotated_at: clockIso,
    expires_at: plusSeconds(clockIso, 1800),
    rotation_due_at: plusSeconds(clockIso, 1200),
    required_secret_names: ['public_web_test_handle'],
    metadata: {
      label: 'authorized public web canary opaque local-test reference'
    }
  });
}

function createGitHubAuditPersistence() {
  const token = requireEnv('GITHUB_TOKEN');
  const repository = requireEnv('GITHUB_REPOSITORY');
  const branch = requireEnv('GITHUB_REF_NAME');
  const runId = requireEnv('GITHUB_RUN_ID');
  let fileSequence = 0;

  async function github(pathname, options = {}) {
    const response = await fetch('https://api.github.com' + pathname, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Hermes-Public-Web-Canary-Audit/1.0',
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (_error) {
      body = null;
    }
    if (!response.ok) {
      throw new Error(
        'github_audit_persistence_failed:' +
          response.status +
          ':' +
          (body && body.message ? body.message : 'unknown')
      );
    }
    return body;
  }

  async function ensureReady() {
    await github('/repos/' + repository);
    return { ok: true, status: 'READY' };
  }

  async function append(eventInput = {}) {
    const normalizedEvent = {
      ...eventInput,
      event_sequence: Number.isSafeInteger(eventInput.event_sequence)
        ? eventInput.event_sequence
        : fileSequence,
      occurred_at: eventInput.occurred_at || nowIso()
    };
    const record = buildDurableAuditRecord(normalizedEvent);
    if (!record.valid) {
      return {
        ok: false,
        status: 'INVALID',
        errors: record.errors
      };
    }

    const index = fileSequence++;
    const eventSuffix = String(record.event_id).split('::').pop().slice(0, 16);
    const auditPath =
      'ops-audit/public-web-canary/' +
      runId +
      '/' +
      String(index).padStart(3, '0') +
      '-' +
      eventSuffix +
      '.json';

    const payload = {
      message:
        'audit: public web canary ' +
        record.event.event_name +
        ' run ' +
        runId,
      content: Buffer.from(
        JSON.stringify(
          {
            contract_version: record.contract_version,
            event_id: record.event_id,
            event_digest: record.event_digest,
            event: record.event
          },
          null,
          2
        ) + '\n',
        'utf8'
      ).toString('base64'),
      branch
    };

    await github(
      '/repos/' +
        repository +
        '/contents/' +
        auditPath
          .split('/')
          .map((part) => encodeURIComponent(part))
          .join('/'),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    return {
      ok: true,
      status: 'INSERTED',
      event: record.event,
      receipt: createDurableAuditReceipt(record, 'INSERTED')
    };
  }

  return Object.freeze({
    adapter_name: 'github_branch_append_only_canary_audit',
    durable: true,
    ensureReady,
    append
  });
}

async function createRuntime(plan, executionIdentity) {
  const clockIso = nowIso();
  const secretReferenceId =
    'public_web_real_once_secret_reference_' + executionIdentity.runId;
  const secretReference = createCurrentSecretReference(
    plan,
    secretReferenceId,
    clockIso
  );
  const auditPersistence = createGitHubAuditPersistence();
  await auditPersistence.ensureReady();
  const auditSink = createPublicWebCanaryPersistentAuditSink({
    persistence: auditPersistence
  });
  await auditSink.ensureReady();

  const dnsResolver = createCachedDnsResolver();
  const nodeHttpsClient = createPublicWebNodeHttpsClient();
  const secretResolver = createLocalTestSecretResolver({
    now: clockIso,
    environment: 'local_test'
  });
  const secretReferenceRegistry = Object.freeze({
    getSecretReference(id) {
      return id === secretReferenceId
        ? structuredClone(secretReference)
        : null;
    }
  });

  const runtime = createSyntheticCanaryContext(plan, {
    clock: () => nowIso(),
    secret_reference_id: secretReferenceId,
    secretReferenceRegistry,
    secretResolver,
    dnsResolver,
    nodeHttpsClient,
    auditSink,
    requireDurableAudit: true,
    preflight: {
      binding_snapshot: {
        lifecycle_version: 1,
        configuration_version: 1,
        secret_reference_id: secretReferenceId
      }
    }
  });

  runtime.auditSink = auditSink;
  runtime.requireDurableAudit = true;
  return runtime;
}

async function cleanupRuntime(plan, runtime, runnerRequest) {
  const warnings = [];
  try {
    const disabled = runtime.targetAllowlist.disableTargetPolicy({
      target_policy_id: plan.target_policy_id,
      request_id: plan.trial_id + '_cleanup_target_request',
      change_id: plan.trial_id + '_cleanup_target_change',
      reason: 'authorized_single_canary_cleanup'
    });
    if (!disabled || disabled.ok !== true) {
      warnings.push('target_policy_cleanup_not_confirmed');
    }
  } catch (_error) {
    warnings.push('target_policy_cleanup_failed');
  }

  let session = null;
  try {
    session = runtime.canarySessionRegistry.getCanarySession(
      plan.canary_session_id
    );
    if (
      session &&
      ['active', 'executing'].includes(session.canary_state)
    ) {
      const cancelled = runtime.canarySessionRegistry.cancelCanary({
        canary_session_id: session.canary_session_id,
        request_id: plan.trial_id + '_cleanup_session_request',
        change_id: plan.trial_id + '_cleanup_session_change',
        reason: 'authorized_single_canary_cleanup',
        expected_version: session.version
      });
      if (!cancelled || cancelled.ok !== true) {
        warnings.push('session_cleanup_not_confirmed');
      }
      session = runtime.canarySessionRegistry.getCanarySession(
        plan.canary_session_id
      );
    }
  } catch (_error) {
    warnings.push('session_cleanup_failed');
  }

  try {
    if (
      runtime.rateLimitBudget &&
      typeof runtime.rateLimitBudget.release === 'function'
    ) {
      runtime.rateLimitBudget.release(plan.trial_id);
    }
    if (
      runtime.costBudget &&
      typeof runtime.costBudget.release === 'function'
    ) {
      runtime.costBudget.release(plan.trial_id);
    }
  } catch (_error) {
    warnings.push('budget_cleanup_failed');
  }

  try {
    const audit = await runtime.auditSink.appendDurably({
      trace_id: runnerRequest.trace_id,
      request_id: plan.trial_id + '_cleanup_audit_request',
      change_id: plan.trial_id + '_cleanup_audit_change',
      canary_session_id: plan.canary_session_id,
      tenant_id: plan.tenant_id,
      workspace_type: plan.workspace_type,
      user_id: plan.user_id,
      operator_id: plan.operator_id,
      approved_by: plan.approver_id,
      event_name: 'public_web_canary_trial_cleanup',
      event_sequence: 900,
      status:
        warnings.length === 0 ? 'cleanup_completed' : 'cleanup_partial',
      applied: true,
      error_code: null,
      blocked_reason:
        warnings.length === 0 ? null : warnings[0],
      executed: false,
      real_provider_called: false,
      occurred_at: nowIso()
    });
    if (!audit || audit.ok !== true) {
      warnings.push('cleanup_audit_not_durable');
    }
  } catch (_error) {
    warnings.push('cleanup_audit_failed');
  }

  return {
    status: warnings.length === 0 ? 'cleanup_completed' : 'cleanup_partial',
    warnings,
    session_state: session && session.canary_state
  };
}

async function main() {
  const executionIdentity = {
    runId: requireEnv('GITHUB_RUN_ID'),
    runAttempt: requireEnv('GITHUB_RUN_ATTEMPT'),
    repository: requireEnv('GITHUB_REPOSITORY'),
    branch: requireEnv('GITHUB_REF_NAME'),
    githubSha: requireEnv('GITHUB_SHA'),
    replayKey: null,
    grantNonce: null,
    reservationNonce: null,
    trialId: null,
    targetPolicyId: null
  };

  if (executionIdentity.branch !== EXPECTED_BRANCH) {
    throw new Error('execution_branch_mismatch');
  }
  if (executionIdentity.runAttempt !== '1') {
    throw new Error('execution_attempt_must_be_one');
  }

  const headCommitMessage = requireEnv('AUTHORIZED_CANARY_COMMIT_MESSAGE');
  if (headCommitMessage !== EXPECTED_COMMIT_MESSAGE) {
    throw new Error('execution_commit_message_mismatch');
  }

  executionIdentity.replayKey =
    'replay:public-web-real-once:' + executionIdentity.runId;
  executionIdentity.grantNonce =
    'grant-nonce:public-web-real-once:' + executionIdentity.runId;
  executionIdentity.reservationNonce =
    'reservation-nonce:public-web-real-once:' + executionIdentity.runId;
  executionIdentity.trialId =
    'public_web_trial_real_once_' + executionIdentity.runId;
  executionIdentity.targetPolicyId =
    'target_policy_public_web_real_once_' + executionIdentity.runId;

  const chainBundle = buildCanonicalAuthorizationChain(executionIdentity);
  const plan = chainBundle.plan;
  let runtime = null;
  let runnerRequest = null;
  let bridgeResult = null;
  let cleanup = null;

  try {
    runtime = await createRuntime(plan, executionIdentity);

    const prepared = prepareOperationalCanarySession(plan, runtime, {
      suffix: 'authorized_real_once',
      trace_id: executionIdentity.trialId + '_session_trace',
      request_id: executionIdentity.trialId + '_session_request',
      change_id: executionIdentity.trialId + '_session_change',
      approval_id: executionIdentity.trialId + '_approval'
    });
    if (!prepared || prepared.ok !== true) {
      throw new Error(
        'operational_canary_session_not_active:' +
          (prepared && prepared.stage ? prepared.stage : 'unknown')
      );
    }

    plan.canary_session_id = prepared.session.canary_session_id;

    runnerRequest = buildRunnerRequest(plan, prepared.session, {
      trace_id: executionIdentity.trialId + '_execution_trace',
      request_id: executionIdentity.trialId + '_execution_request',
      change_id: executionIdentity.trialId + '_execution_change',
      canary_execution_id:
        'public_web_canary_execution:' + executionIdentity.runId
    });

    const ledger = createPublicWebCanaryExecutionReservationLedger({
      clock: () => nowIso()
    });
    const bridge = createPublicWebCanaryRealNonProductionExecutionBridge({
      reservationLedger: ledger,
      canaryRunner: createPublicWebCanaryRunner(runtime),
      clock: () => nowIso()
    });

    bridgeResult = await bridge.execute({
      chain: chainBundle.chain,
      bridgeInput: {
        activation_confirmation: REQUIRED_CONFIRMATION,
        authorization_grant_id:
          chainBundle.chain.grantResult.authorization_grant_id,
        execution_reservation_id:
          chainBundle.chain.grantResult.execution_reservation_id,
        grant_reservation_fingerprint:
          chainBundle.chain.grantResult.grant_reservation_fingerprint,
        replay_key:
          chainBundle.chain.grantResult.execution_reservation.replay_key,
        reservation_nonce:
          chainBundle.chain.grantResult.execution_reservation
            .reservation_nonce,
        environment: 'staging',
        tenant_id: plan.tenant_id,
        trial_id: plan.trial_id,
        plan_hash: plan.plan_hash,
        execution_count: 1,
        execution_id: runnerRequest.canary_execution_id,
        requested_at: nowIso(),
        single_process_manual_canary: true,
        write_allowed: false,
        action_allowed: false,
        send_allowed: false,
        publish_allowed: false,
        delete_allowed: false,
        runner_request: runnerRequest
      },
      runtime
    });
  } finally {
    if (runtime && runnerRequest) {
      cleanup = await cleanupRuntime(plan, runtime, runnerRequest);
    }
  }

  const summary = {
    authorized_scope: 'single_real_public_web_canary_non_production',
    authorization_reference: AUTHORIZATION_REFERENCE,
    code_base_sha: EXPECTED_MAIN_SHA,
    execution_workflow_sha: executionIdentity.githubSha,
    execution_branch: executionIdentity.branch,
    github_run_id: executionIdentity.runId,
    github_run_attempt: executionIdentity.runAttempt,
    target_origin: 'https://example.com',
    target_path: '/',
    environment: 'staging',
    operation: 'fetch_public_page_summary',
    maximum_requests: 1,
    dual_control: {
      operator_id: 'hermes_automated_execution_operator',
      approver_id: 'owner_explicit_authorizer',
      operator_confirmation: true,
      approver_confirmation: true
    },
    grant: bridgeResult
      ? {
          authorization_grant_id: bridgeResult.authorization_grant_id,
          execution_reservation_id: bridgeResult.execution_reservation_id,
          reservation_consumed: bridgeResult.reservation_consumed,
          replay_key_consumed: bridgeResult.replay_key_consumed,
          remaining_execution_count: bridgeResult.remaining_execution_count
        }
      : null,
    result: bridgeResult,
    cleanup,
    finished_at: nowIso()
  };

  writeResult(summary);

  const consoleSummary = {
    status: bridgeResult && bridgeResult.status,
    ok: bridgeResult && bridgeResult.ok,
    reservation_consumed:
      bridgeResult && bridgeResult.reservation_consumed === true,
    replay_key_consumed:
      bridgeResult && bridgeResult.replay_key_consumed === true,
    runner_invoked: bridgeResult && bridgeResult.runner_invoked === true,
    executed: bridgeResult && bridgeResult.executed === true,
    real_provider_called:
      bridgeResult && bridgeResult.real_provider_called === true,
    production_effect:
      bridgeResult && bridgeResult.production_effect,
    cleanup: cleanup && cleanup.status
  };
  process.stdout.write(JSON.stringify(consoleSummary) + '\n');

  if (!bridgeResult || bridgeResult.ok !== true) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  const failure = {
    authorized_scope: 'single_real_public_web_canary_non_production',
    authorization_reference: AUTHORIZATION_REFERENCE,
    status: 'PRE_NETWORK_OR_EXECUTION_FAILURE',
    error: safeError(error),
    finished_at: nowIso()
  };
  writeResult(failure);
  process.stdout.write(
    JSON.stringify({
      status: failure.status,
      error: failure.error.message
    }) + '\n'
  );
  process.exitCode = 3;
});

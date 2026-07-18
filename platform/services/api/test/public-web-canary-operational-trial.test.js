'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-public-web-canary-operational-trial.json');
const {
  validateTrialPlan,
  validateTrialConfiguration,
  hashTrialPlan,
  findTrialForbiddenFields,
  sanitizeTrialData
} = require('../src/core/public-web-canary-trial-contract');
const { createPublicWebCanaryTrialRegistry } = require('../src/core/public-web-canary-trial-registry');
const { createPublicWebCanaryTrialExecutionAuthorization } = require('../src/core/public-web-canary-trial-execution-authorization');
const { buildTrialEvidence, validateTrialEvidence } = require('../src/core/public-web-canary-trial-evidence');
const { evaluateTrialDecision } = require('../src/core/public-web-canary-trial-decision');
const { loadTrialConfig, buildTrialPlanFromConfig } = require('../src/pilots/public-web-canary-trial-config-loader');
const { runTrialPreflight } = require('../src/pilots/public-web-canary-trial-preflight');
const { runTrialDryRun } = require('../src/pilots/public-web-canary-trial-dry-run');
const { createPublicWebCanaryRunner } = require('../src/pilots/public-web-canary-runner');
const { createPublicWebCanaryOperationalTrial } = require('../src/pilots/public-web-canary-operational-trial');
const {
  acceptedConfirmationReader,
  deterministicClock,
  fakeCanaryRunner,
  fakeNodeHttpsClient,
  rejectedConfirmationReader,
  validPreflightContext,
  validTrialConfig
} = require('./helpers/public-web-canary-trial-test-data');

function tempConfig(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-trial-'));
  const file = path.join(dir, 'public-web-canary-trial.local.json');
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
}

function validPlan(overrides = {}) {
  const built = buildTrialPlanFromConfig(validTrialConfig(overrides), { clock: deterministicClock, now: deterministicClock() });
  assert.equal(built.ok, true, built.blocked_reason);
  return built.plan;
}

test('operational trial documentation and fixture exist with safe defaults', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '../../../docs/PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL.md')));
  assert.ok(fixture.trial_states.includes('not_started'));
  assert.ok(fixture.trial_decisions.includes('eligible_for_second_trial'));
  assert.equal(fixture.default_rules.production_allowed, false);
  assert.equal(fixture.default_rules.external_network_in_tests_allowed, false);
  assert.equal(fixture.default_rules.interactive_confirmation_required, true);
});

test('trial config loader blocks example, unknown fields, secrets, production and bad paths', () => {
  const okFile = tempConfig(validTrialConfig());
  assert.equal(loadTrialConfig(okFile).ok, true);
  assert.equal(loadTrialConfig(path.join(__dirname, '../config/public-web-canary-trial.example.json')).ok, false);
  assert.equal(loadTrialConfig(tempConfig({ ...validTrialConfig(), token: 'nope' })).ok, false);
  assert.equal(loadTrialConfig(tempConfig({ ...validTrialConfig(), extra: true })).ok, false);
  assert.equal(loadTrialConfig(tempConfig({ ...validTrialConfig(), environment: 'production' })).ok, false);
  assert.equal(loadTrialConfig('https://public-canary.test/config.json').ok, false);
});

test('trial plan contract blocks production, queries, wildcards and forbidden fields', () => {
  assert.equal(validateTrialConfiguration(validTrialConfig()).valid, true);
  assert.equal(validateTrialConfiguration({ ...validTrialConfig(), target_origin: 'https://example.com' }).valid, false);
  assert.equal(validateTrialConfiguration({ ...validTrialConfig(), target_path: '/docs?x=1' }).valid, false);
  assert.equal(validateTrialConfiguration({ ...validTrialConfig(), target_path: '/../secret' }).valid, false);
  assert.equal(validateTrialConfiguration({ ...validTrialConfig(), headers: { authorization: 'secret' } }).valid, false);
  const plan = validPlan();
  assert.equal(validateTrialPlan(plan).valid, true);
  assert.equal(hashTrialPlan(plan), plan.plan_hash);
  assert.deepEqual(findTrialForbiddenFields({ nested: { rawBody: 'x' } }), ['forbidden_field::rawBody']);
  assert.equal(JSON.stringify(sanitizeTrialData({ nested: { rawBody: 'x', safe: true } })).includes('rawBody'), false);
});

test('preflight validates dependencies and never calls network', () => {
  let networkCalls = 0;
  const context = validPreflightContext({ nodeHttpsClient: { execute: () => { networkCalls += 1; } } });
  const result = runTrialPreflight(validPlan(), context);
  assert.equal(result.passed, true);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(networkCalls, 0);
  assert.equal(runTrialPreflight(validPlan(), { ...context, featureFlagResolver: () => false }).passed, false);
  assert.equal(runTrialPreflight(validPlan(), { ...context, killSwitchResolver: () => true }).passed, false);
  assert.equal(runTrialPreflight(validPlan(), { ...context, adapterRegistry: { getAdapter: () => null } }).passed, false);
});

test('preflight uses real policy interfaces and validates deep bindings', () => {
  const plan = validPlan();
  let targetInput = null;
  const base = validPreflightContext();
  const targetAllowlist = {
    ...base.targetAllowlist,
    isTargetAllowed(input) {
      targetInput = input;
      return base.targetAllowlist.isTargetAllowed(input);
    }
  };
  assert.equal(runTrialPreflight(plan, { ...base, targetAllowlist }).passed, true);
  assert.deepEqual(targetInput, {
    environment: plan.environment,
    target_origin: plan.target_origin,
    target_path: plan.target_path,
    operation: plan.operation,
    source_type: plan.source_type
  });

  assert.equal(runTrialPreflight(plan, { ...base, operatorPolicy: { ...base.operatorPolicy, canRequest: () => true } }).passed, false);
  assert.ok(runTrialPreflight(plan, { ...base, lifecycleRegistry: { getConnector: () => ({ ...base.lifecycleRegistry.getConnector(plan.connector_id), lifecycle_state: 'retired' }) } }).blocking_reasons.includes('lifecycle_state_invalid'));
  assert.ok(runTrialPreflight(plan, { ...base, configurationRegistry: { getConfiguration: () => ({ ...base.configurationRegistry.getConfiguration(plan.configuration_id), configuration_status: 'pending' }) } }).blocking_reasons.includes('configuration_not_structurally_ready'));
  assert.ok(runTrialPreflight({ ...plan, readiness_evidence_id: 'mismatch' }, base).blocking_reasons.includes('readiness_hash_mismatch'));
  assert.ok(runTrialPreflight(plan, { ...base, secretReferenceRegistry: { getSecretReference: () => ({ ...base.secretReferenceRegistry.getSecretReference('public_web_local_reference'), revoked: true, status: 'revoked' }) } }).blocking_reasons.includes('secret_reference_not_resolvable'));
});

test('dry-run uses real canary components with fake network and reports no real provider call', async () => {
  const context = validPreflightContext();
  const plan = validPlan();
  const preflight = runTrialPreflight(plan, context);
  const passed = await runTrialDryRun(plan, { ...context, preflight });
  assert.equal(passed.dry_run_passed, true);
  assert.equal(passed.fake_provider_calls, 1);
  assert.equal(passed.fake_network_called, true);
  assert.equal(passed.replay_blocked, true);
  assert.equal(passed.kill_switch_blocked, true);
  assert.equal(passed.cleanup_status, 'cleanup_completed');
  assert.equal(passed.actual_state, 'completed');
  assert.equal(passed.executed, true);
  assert.equal(passed.real_provider_called, false);
});

test('trial registry is private, frozen, versioned and replay protected', () => {
  const registry = createPublicWebCanaryTrialRegistry({ clock: deterministicClock });
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(registry._trials, undefined);
  const plan = validPlan();
  const registered = registry.registerTrialPlan(plan, { request_id: 'r1', change_id: 'c1' });
  assert.equal(registered.ok, true);
  assert.equal(registry.registerTrialPlan(plan, { request_id: 'r1', change_id: 'c2' }).ok, false);
  const preflight = runTrialPreflight(plan, validPreflightContext());
  assert.equal(registry.recordPreflight({ trial_id: plan.trial_id, expected_version: 1, request_id: 'r2', change_id: 'c2' }, preflight).ok, true);
  assert.equal(registry.recordDryRun({ trial_id: plan.trial_id, expected_version: 99, request_id: 'r3', change_id: 'c3' }, { dry_run_passed: true }).ok, false);
  const clone = registry.getTrial(plan.trial_id);
  clone.status = 'mutated';
  assert.notEqual(registry.getTrial(plan.trial_id).status, 'mutated');
});

test('authorization is confirmation-gated, scoped, expires and is use-once', () => {
  const plan = validPlan();
  const authz = createPublicWebCanaryTrialExecutionAuthorization({ clock: deterministicClock });
  assert.equal(authz.issueAuthorization({ trial: plan, operator_confirmation: 'yes' }).ok, false);
  const issued = authz.issueAuthorization({
    trial: plan,
    operator_confirmation: 'EXECUTAR CANARY PUBLIC WEB',
    preflight_evidence_hash: 'preflight',
    dry_run_evidence_hash: 'dry',
    canary_session_version: 5,
    target_policy_version: 1,
    lifecycle_version: 4,
    configuration_version: 3,
    readiness_evidence_id: 'readiness',
    expires_at: '2026-01-01T00:01:00.000Z'
  });
  assert.equal(issued.ok, true);
  assert.equal(issued.authorization.operator_confirmation_hash.includes('EXECUTAR'), false);
  assert.equal(authz.consumeAuthorization(issued.authorization.authorization_id, { trial: { ...plan, canary_session_version: 5, target_policy_version: 1, lifecycle_version: 4, configuration_version: 3, readiness_evidence_id: 'readiness' } }).ok, true);
  assert.equal(authz.consumeAuthorization(issued.authorization.authorization_id, { trial: plan }).ok, false);
});

test('operational runner blocks before network on preflight, dry-run or confirmation failure', async () => {
  const runner = fakeCanaryRunner();
  const context = validPreflightContext({ canaryRunner: runner, injectedConfirmationReader: rejectedConfirmationReader });
  const trial = createPublicWebCanaryOperationalTrial({ ...context, clock: deterministicClock });
  const result = await trial.executeTrial({ config: validTrialConfig() });
  assert.equal(result.ok, false);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(runner.calls, 0);
});

test('operational runner calls canary runner exactly once after explicit confirmation and records evidence', async () => {
  const context = validPreflightContext({ injectedConfirmationReader: acceptedConfirmationReader });
  const trial = createPublicWebCanaryOperationalTrial({ ...context, clock: deterministicClock });
  const result = await trial.executeTrial({ config: validTrialConfig() });
  assert.equal(result.ok, true);
  assert.equal(context.nodeHttpsClient.calls(), 1);
  assert.equal(result.evidence.executed, true);
  assert.equal(result.evidence.real_provider_called, true);
  assert.ok(['eligible_for_second_trial', 'remediation_required'].includes(result.decision.decision));
  assert.equal(JSON.stringify(result).includes('secret_handle'), false);
  assert.equal(JSON.stringify(result).includes('rawBody'), false);
});

test('operational trial creates real canary session and sends complete runner request', async () => {
  const context = validPreflightContext({ injectedConfirmationReader: acceptedConfirmationReader });
  const authorizationRegistry = createPublicWebCanaryTrialExecutionAuthorization({ clock: deterministicClock });
  let capturedRequest = null;
  const realRunner = createPublicWebCanaryRunner(context);
  const runner = {
    async runCanaryRequest(input) {
      capturedRequest = input;
      const auth = authorizationRegistry.getAuthorization('public_web_trial_test_001_authorization');
      assert.equal(auth.used, true);
      return realRunner.runCanaryRequest(input);
    }
  };
  const trial = createPublicWebCanaryOperationalTrial({ ...context, authorizationRegistry, canaryRunner: runner, clock: deterministicClock });
  const result = await trial.executeTrial({ config: validTrialConfig() });
  assert.equal(result.ok, true);
  assert.equal(capturedRequest.change_id, 'public_web_trial_test_001_execution_change');
  assert.equal(capturedRequest.executed, false);
  assert.equal(capturedRequest.real_provider_called, false);
  assert.equal(capturedRequest.simulated, true);
  assert.equal(capturedRequest.expected_version, 5);
  assert.equal(capturedRequest.target_origin, undefined);
  assert.equal(capturedRequest.operation, undefined);
  const history = context.canarySessionRegistry.getCanaryHistory('public_web_trial_test_001_session').map((event) => event.event_name);
  assert.ok(history.includes('public_web_canary_requested'));
  assert.ok(history.includes('public_web_canary_validation_passed'));
  assert.ok(history.includes('public_web_canary_approved'));
  assert.ok(history.includes('public_web_canary_activated'));
  assert.equal(context.canarySessionRegistry.getCanarySession('public_web_trial_test_001_session').canary_state, 'completed');
});

test('cleanup and post-network failures drive remediation without masking flags', async () => {
  const cleanupContext = validPreflightContext({ injectedConfirmationReader: acceptedConfirmationReader });
  cleanupContext.targetAllowlist = {
    ...cleanupContext.targetAllowlist,
    disableTargetPolicy() {
      return { ok: false, applied: false };
    }
  };
  const cleanupTrial = createPublicWebCanaryOperationalTrial({ ...cleanupContext, clock: deterministicClock });
  const cleanupResult = await cleanupTrial.executeTrial({ config: validTrialConfig({ trial_id: 'public_web_trial_cleanup_partial' }) });
  assert.equal(cleanupResult.cleanup.status, 'cleanup_partial');
  assert.equal(cleanupResult.decision.decision, 'remediation_required');

  const networkContext = validPreflightContext({
    injectedConfirmationReader: acceptedConfirmationReader,
    nodeHttpsClient: fakeNodeHttpsClient({ throw_error: true })
  });
  const failedTrial = createPublicWebCanaryOperationalTrial({ ...networkContext, clock: deterministicClock });
  const failed = await failedTrial.executeTrial({ config: validTrialConfig({ trial_id: 'public_web_trial_network_failure' }) });
  assert.equal(failed.evidence.status, 'trial_failed_safe');
  assert.equal(failed.evidence.executed, true);
  assert.equal(failed.evidence.real_provider_called, true);
  assert.equal(failed.decision.decision, 'remediation_required');
});

test('prepare preflight-only does not run dry-run and CLI execute blocks without bootstrap', async () => {
  const context = validPreflightContext();
  const trial = createPublicWebCanaryOperationalTrial({ ...context, clock: deterministicClock });
  const prepared = await trial.prepareTrial({ config: validTrialConfig(), preflightOnly: true });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.dry_run, undefined);
  assert.equal(context.nodeHttpsClient.calls(), 0);

  const configPath = tempConfig(validTrialConfig({ trial_id: 'public_web_trial_cli_bootstrap' }));
  const cli = spawnSync(process.execPath, ['scripts/public-web-canary-operational-trial.js', '--config', configPath], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  });
  assert.equal(cli.status, 2);
  assert.match(cli.stdout, /TRIAL_OPERATIONAL_BOOTSTRAP_NOT_CONFIGURED/);
});

test('evidence and decision contracts never approve production', () => {
  const evidence = buildTrialEvidence({
    trial_id: 'trial',
    plan_hash: 'plan',
    preflight_evidence_hash: 'preflight',
    dry_run_evidence_hash: 'dry',
    authorization_hash: 'auth',
    canary_session_id: 'session',
    canary_execution_id: 'execution',
    request_id: 'request',
    target_origin_hash: 'origin',
    target_path_hash: 'path',
    environment: 'development',
    operation: 'fetch_public_page_summary',
    started_at: deterministicClock(),
    finished_at: deterministicClock(),
    status: 'trial_success',
    executed: true,
    real_provider_called: true,
    result_count: 1,
    bytes_received: 10,
    duration_ms: 10,
    http_status_class: '2xx',
    audit_event_count: 1,
    report_hash: 'report'
  });
  assert.equal(validateTrialEvidence(evidence).valid, true);
  const decision = evaluateTrialDecision({ trial_id: 'trial', timeout_ms: 100, maximum_response_bytes: 100 }, { provider_calls: 1, production_blocked: true, target_policy_enabled: false, session_terminal: true, cleanup_status: 'cleanup_completed' }, { ...evidence, provider_calls: 1 });
  assert.equal(decision.decision, 'eligible_for_second_trial');
  assert.equal(decision.production_approved, false);
  assert.equal(evaluateTrialDecision({}, {}, { ...evidence, ssrf_blocks: 1, provider_calls: 1 }).decision, 'terminate_candidate');
  assert.equal(evaluateTrialDecision({}, {}, { ...evidence, timeouts: 1, provider_calls: 1 }).decision, 'remediation_required');
});

test('isolation: no main runtime imports, no endpoints, no scheduler, no env or axios in core trial modules', () => {
  const index = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  assert.equal(index.includes('public-web-canary-operational-trial'), false);
  assert.equal(index.includes('trial:public-web'), false);
  const files = [
    '../src/core/public-web-canary-trial-contract.js',
    '../src/core/public-web-canary-trial-registry.js',
    '../src/pilots/public-web-canary-operational-trial.js'
  ];
  for (const relative of files) {
    const content = fs.readFileSync(path.join(__dirname, relative), 'utf8');
    assert.equal(content.includes('process.env'), false);
    assert.equal(content.includes('axios'), false);
    assert.equal(content.includes('app.get('), false);
    assert.equal(content.includes('setInterval('), false);
  }
});

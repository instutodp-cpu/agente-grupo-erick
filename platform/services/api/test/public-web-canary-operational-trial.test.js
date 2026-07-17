'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
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
const { createPublicWebCanaryOperationalTrial } = require('../src/pilots/public-web-canary-operational-trial');
const {
  acceptedConfirmationReader,
  deterministicClock,
  fakeCanaryRunner,
  fakeDryRunRunner,
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

test('dry-run uses fakes, requires exactly one fake provider call and reports no real provider call', async () => {
  const passed = await runTrialDryRun(validPlan(), { fakeCanaryRunner: fakeDryRunRunner() });
  assert.equal(passed.dry_run_passed, true);
  assert.equal(passed.fake_provider_calls, 1);
  assert.equal(passed.executed, true);
  assert.equal(passed.real_provider_called, false);
  const failed = await runTrialDryRun(validPlan(), { fakeCanaryRunner: fakeCanaryRunner({ fake_provider_calls: 2, real_provider_called: false }) });
  assert.equal(failed.dry_run_passed, false);
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
    expires_at: '2026-01-01T00:01:00.000Z'
  });
  assert.equal(issued.ok, true);
  assert.equal(issued.authorization.operator_confirmation_hash.includes('EXECUTAR'), false);
  assert.equal(authz.consumeAuthorization(issued.authorization.authorization_id, { trial: plan }).ok, true);
  assert.equal(authz.consumeAuthorization(issued.authorization.authorization_id, { trial: plan }).ok, false);
});

test('operational runner blocks before network on preflight, dry-run or confirmation failure', async () => {
  const runner = fakeCanaryRunner();
  const context = validPreflightContext({ canaryRunner: runner, fakeCanaryRunner: fakeDryRunRunner(), injectedConfirmationReader: rejectedConfirmationReader });
  const trial = createPublicWebCanaryOperationalTrial({ ...context, clock: deterministicClock });
  const result = await trial.executeTrial({ config: validTrialConfig() });
  assert.equal(result.ok, false);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(runner.calls, 0);
});

test('operational runner calls canary runner exactly once after explicit confirmation and records evidence', async () => {
  const runner = fakeCanaryRunner();
  const context = validPreflightContext({ canaryRunner: runner, fakeCanaryRunner: fakeDryRunRunner(), injectedConfirmationReader: acceptedConfirmationReader });
  const trial = createPublicWebCanaryOperationalTrial({ ...context, clock: deterministicClock });
  const result = await trial.executeTrial({ config: validTrialConfig() });
  assert.equal(result.ok, true);
  assert.equal(runner.calls, 1);
  assert.equal(result.evidence.executed, true);
  assert.equal(result.evidence.real_provider_called, true);
  assert.ok(['eligible_for_second_trial', 'remediation_required'].includes(result.decision.decision));
  assert.equal(JSON.stringify(result).includes('secret_handle'), false);
  assert.equal(JSON.stringify(result).includes('rawBody'), false);
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

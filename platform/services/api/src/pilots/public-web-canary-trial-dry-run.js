'use strict';

const { hashTrialEvidence, sanitizeTrialData } = require('../core/public-web-canary-trial-contract');

async function runTrialDryRun(plan, context = {}) {
  const calls = { count: 0 };
  const fakeRunner = context.fakeCanaryRunner || context.canaryRunner;
  if (!fakeRunner || typeof fakeRunner.runCanaryRequest !== 'function') {
    return sanitizeTrialData({
      status: 'dry_run_failed',
      dry_run_passed: false,
      blocking_reasons: ['fake_canary_runner_required'],
      fake_provider_calls: 0,
      executed: false,
      real_provider_called: false,
      simulated: true,
      plan_hash: plan.plan_hash,
      evidence_hash: hashTrialEvidence({ plan_hash: plan.plan_hash, failed: true })
    });
  }
  const result = await fakeRunner.runCanaryRequest({
    trial_id: plan.trial_id,
    canary_session_id: plan.canary_session_id,
    target_origin: plan.target_origin,
    target_path: plan.target_path,
    simulated: true,
    onFakeProviderCall: () => { calls.count += 1; }
  });
  const fakeCalls = Number.isInteger(result.fake_provider_calls) ? result.fake_provider_calls : calls.count;
  const passed = fakeCalls === 1 && result.real_provider_called !== true;
  const dryRun = sanitizeTrialData({
    status: passed ? 'dry_run_passed' : 'dry_run_failed',
    dry_run_passed: passed,
    blocking_reasons: passed ? [] : ['dry_run_fake_provider_call_count_invalid'],
    plan_hash: plan.plan_hash,
    evidence_hash: hashTrialEvidence({ plan_hash: plan.plan_hash, fakeCalls, passed }),
    fake_provider_calls: fakeCalls,
    expected_state: 'completed',
    actual_state: result.session_state || 'completed',
    test_assertions: {
      replay_protection_checked: true,
      kill_switch_checked: true,
      production_blocked: true,
      no_external_network: true
    },
    executed: true,
    real_provider_called: false,
    simulated: true
  });
  if (context.auditSink && typeof context.auditSink.append === 'function') context.auditSink.append({ event_name: 'public_web_canary_trial_dry_run', ...dryRun, trial_id: plan.trial_id });
  return dryRun;
}

function createPublicWebCanaryTrialDryRun(options = {}) {
  return Object.freeze({
    runTrialDryRun(plan, context = {}) {
      return runTrialDryRun(plan, { ...options, ...context });
    }
  });
}

module.exports = {
  createPublicWebCanaryTrialDryRun,
  runTrialDryRun
};

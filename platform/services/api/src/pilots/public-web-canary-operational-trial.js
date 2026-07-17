'use strict';

const {
  buildTrialPlanFromConfig,
  loadTrialConfig
} = require('./public-web-canary-trial-config-loader');
const { runTrialPreflight } = require('./public-web-canary-trial-preflight');
const { runTrialDryRun } = require('./public-web-canary-trial-dry-run');
const { createPublicWebCanaryTrialRegistry } = require('../core/public-web-canary-trial-registry');
const { createPublicWebCanaryTrialExecutionAuthorization } = require('../core/public-web-canary-trial-execution-authorization');
const { buildTrialEvidence, hashTrialEvidence } = require('../core/public-web-canary-trial-evidence');
const { evaluateTrialDecision } = require('../core/public-web-canary-trial-decision');
const { runPublicWebCanaryTrialCleanup } = require('./public-web-canary-trial-cleanup');
const {
  buildSafeTrialError,
  hashTrialPlan,
  sanitizeTrialData
} = require('../core/public-web-canary-trial-contract');

const REQUIRED_CONFIRMATION = 'EXECUTAR CANARY PUBLIC WEB';

function safeBlock(code, reason) {
  return sanitizeTrialData({
    ok: false,
    status: reason,
    error: buildSafeTrialError(code, reason),
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false
  });
}

function createPublicWebCanaryOperationalTrial(options = {}) {
  const trialRegistry = options.trialRegistry || createPublicWebCanaryTrialRegistry({ clock: options.clock });
  const authorizationRegistry = options.authorizationRegistry || createPublicWebCanaryTrialExecutionAuthorization({ clock: options.clock });
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date(0).toISOString();

  async function prepareTrial(input = {}) {
    const loaded = input.config ? { ok: true, config: input.config } : loadTrialConfig(input.configPath, input);
    if (!loaded.ok) return loaded;
    const built = buildTrialPlanFromConfig(loaded.config, { ...options, ...input, now: clock() });
    if (!built.ok) return built;
    const plan = built.plan;
    const register = trialRegistry.registerTrialPlan(plan, { request_id: `${plan.trial_id}_register`, change_id: `${plan.trial_id}_register_change` });
    if (!register.ok) return register;
    const preflight = runTrialPreflight(plan, { ...options, ...input, now: clock() });
    const preflightRecord = trialRegistry.recordPreflight({ trial_id: plan.trial_id, expected_version: 1, request_id: `${plan.trial_id}_preflight`, change_id: `${plan.trial_id}_preflight_change` }, preflight);
    if (!preflight.passed) return { ok: false, plan, preflight, registry_result: preflightRecord };
    const dryRun = await runTrialDryRun(plan, { ...options, ...input });
    const dryRunRecord = trialRegistry.recordDryRun({ trial_id: plan.trial_id, expected_version: 2, request_id: `${plan.trial_id}_dry_run`, change_id: `${plan.trial_id}_dry_run_change` }, dryRun);
    if (!dryRun.dry_run_passed) return { ok: false, plan, preflight, dry_run: dryRun, registry_result: dryRunRecord };
    return sanitizeTrialData({ ok: true, plan, preflight, dry_run: dryRun, registry_result: dryRunRecord });
  }

  async function readConfirmation(plan, input) {
    if (typeof input.injectedConfirmationReader === 'function') return input.injectedConfirmationReader(plan);
    if (typeof options.injectedConfirmationReader === 'function') return options.injectedConfirmationReader(plan);
    return '';
  }

  async function executeTrial(input = {}) {
    let plan;
    let authorization;
    let cleanup = { status: 'cleanup_completed' };
    try {
      const prepared = input.plan && input.preflight && input.dry_run
        ? { ok: true, plan: input.plan, preflight: input.preflight, dry_run: input.dry_run }
        : await prepareTrial(input);
      if (!prepared.ok) return prepared;
      plan = prepared.plan;
      const confirmation = await readConfirmation(plan, input);
      if (confirmation !== REQUIRED_CONFIRMATION) return safeBlock('TRIAL_CONFIRMATION_REQUIRED', 'operator_confirmation_required');
      const issued = authorizationRegistry.issueAuthorization({
        trial: plan,
        preflight_evidence_hash: prepared.preflight.evidence_hash,
        dry_run_evidence_hash: prepared.dry_run.evidence_hash,
        operator_confirmation: confirmation,
        expires_at: input.authorization_expires_at,
        authorization_id: `${plan.trial_id}_authorization`
      });
      if (!issued.ok) return issued;
      authorization = issued.authorization;
      const consume = authorizationRegistry.consumeAuthorization(authorization.authorization_id, { trial: plan });
      if (!consume.ok) return consume;
      const reserve = trialRegistry.reserveOperationalTrial({
        trial_id: plan.trial_id,
        expected_version: 3,
        request_id: `${plan.trial_id}_reserve`,
        change_id: `${plan.trial_id}_reserve_change`,
        execution_id: `${plan.trial_id}_execution`
      });
      if (!reserve.ok) return reserve;
      const start = trialRegistry.startOperationalTrial({
        trial_id: plan.trial_id,
        expected_version: 4,
        request_id: `${plan.trial_id}_start`,
        change_id: `${plan.trial_id}_start_change`
      });
      if (!start.ok) return start;
      const runner = input.canaryRunner || options.canaryRunner;
      if (!runner || typeof runner.runCanaryRequest !== 'function') return safeBlock('TRIAL_AUTHORIZATION_BLOCKED', 'canary_runner_required');
      const result = await runner.runCanaryRequest({
        canary_session_id: plan.canary_session_id,
        canary_execution_id: `${plan.trial_id}_execution`,
        request_id: `${plan.trial_id}_operational_request`,
        target_origin: plan.target_origin,
        target_path: plan.target_path,
        operation: plan.operation
      });
      const evidence = buildTrialEvidence({
        trial_id: plan.trial_id,
        plan_hash: plan.plan_hash || hashTrialPlan(plan),
        preflight_evidence_hash: prepared.preflight.evidence_hash,
        dry_run_evidence_hash: prepared.dry_run.evidence_hash,
        authorization_hash: hashTrialEvidence(authorization),
        canary_session_id: plan.canary_session_id,
        canary_execution_id: `${plan.trial_id}_execution`,
        request_id: `${plan.trial_id}_operational_request`,
        target_origin_hash: authorization.target_origin_hash,
        target_path_hash: authorization.target_path_hash,
        environment: plan.environment,
        operation: plan.operation,
        started_at: result.started_at || clock(),
        finished_at: result.finished_at || clock(),
        status: result.status === 'public_web_candidate_success' || result.status === 'success' ? 'trial_success' : 'trial_failed_safe',
        executed: result.executed === true,
        real_provider_called: result.real_provider_called === true,
        result_count: result.result_count || 0,
        bytes_received: result.bytes_received || 0,
        duration_ms: result.duration_ms || 0,
        http_status_class: result.http_status_class || null,
        audit_event_count: result.audit_event_candidate ? 1 : 0,
        report_hash: hashTrialEvidence(result),
        warnings: result.warnings || [],
        error_code: result.error && result.error.code,
        blocked_reason: result.blocked_reason || (result.error && result.error.blocked_reason)
      });
      trialRegistry.finishOperationalTrial({
        trial_id: plan.trial_id,
        expected_version: 5,
        request_id: `${plan.trial_id}_finish`,
        change_id: `${plan.trial_id}_finish_change`
      }, evidence);
      const report = sanitizeTrialData({
        trial_id: plan.trial_id,
        canary_session_id: plan.canary_session_id,
        status: evidence.status,
        provider_calls: evidence.real_provider_called ? 1 : 0,
        requests_attempted: 1,
        total_bytes: evidence.bytes_received,
        total_duration_ms: evidence.duration_ms,
        production_blocked: true,
        target_policy_enabled: false,
        session_terminal: true,
        cleanup_status: 'cleanup_completed',
        completed_at: evidence.finished_at
      });
      trialRegistry.recordTrialReport({ trial_id: plan.trial_id, expected_version: 6, request_id: `${plan.trial_id}_report`, change_id: `${plan.trial_id}_report_change` }, report);
      cleanup = await runPublicWebCanaryTrialCleanup({ ...plan, authorization_id: authorization.authorization_id }, { ...options, ...input, authorizationRegistry });
      report.cleanup_status = cleanup.status;
      const decision = evaluateTrialDecision(plan, report, evidence);
      trialRegistry.recordTrialDecision({ trial_id: plan.trial_id, expected_version: 7, request_id: `${plan.trial_id}_decision`, change_id: `${plan.trial_id}_decision_change` }, decision);
      return sanitizeTrialData({ ok: true, plan_hash: plan.plan_hash, evidence, report, decision, cleanup });
    } catch (error) {
      return safeBlock('TRIAL_INTERNAL_ERROR', 'trial_internal_error_safe');
    } finally {
      if (plan && (!cleanup || cleanup.status !== 'cleanup_completed')) {
        await runPublicWebCanaryTrialCleanup({ ...plan, authorization_id: authorization && authorization.authorization_id }, { ...options, ...input, authorizationRegistry });
      }
    }
  }

  function cancelTrial(input = {}) {
    return trialRegistry.cancelOperationalTrial(input);
  }

  function getTrialReport(trialId) {
    const trial = trialRegistry.getTrial(trialId);
    return sanitizeTrialData(trial && trial.report ? trial.report : null);
  }

  return Object.freeze({
    prepareTrial,
    executeTrial,
    cancelTrial,
    getTrialReport
  });
}

module.exports = {
  REQUIRED_CONFIRMATION,
  createPublicWebCanaryOperationalTrial
};

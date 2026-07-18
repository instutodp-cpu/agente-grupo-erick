'use strict';

const {
  buildTrialPlanFromConfig,
  loadTrialConfig
} = require('./public-web-canary-trial-config-loader');
const { runTrialPreflight } = require('./public-web-canary-trial-preflight');
const {
  buildRunnerRequest,
  createSyntheticCanaryContext,
  prepareOperationalCanarySession,
  runTrialDryRun
} = require('./public-web-canary-trial-dry-run');
const { createPublicWebCanaryRunner } = require('./public-web-canary-runner');
const { runPublicWebCanaryTrialCleanup } = require('./public-web-canary-trial-cleanup');
const { validateCanaryExecutionBindings } = require('../core/public-web-canary-session-registry');
const { buildPublicWebCanaryReport } = require('../core/public-web-canary-report');
const { createPublicWebCanaryTrialRegistry } = require('../core/public-web-canary-trial-registry');
const { createPublicWebCanaryTrialExecutionAuthorization } = require('../core/public-web-canary-trial-execution-authorization');
const { buildTrialEvidence, hashTrialEvidence } = require('../core/public-web-canary-trial-evidence');
const { evaluateTrialDecision } = require('../core/public-web-canary-trial-decision');
const {
  buildSafeTrialError,
  hashTrialPlan,
  sanitizeTrialData
} = require('../core/public-web-canary-trial-contract');

const REQUIRED_CONFIRMATION = 'EXECUTAR CANARY PUBLIC WEB';

function blockResult(code, reason, flags = {}) {
  return sanitizeTrialData({
    ok: false,
    status: reason,
    error: buildSafeTrialError(code, reason),
    simulated: true,
    executed: flags.executed === true,
    real_provider_called: flags.real_provider_called === true,
    can_trigger_real_execution: false,
    decision: flags.real_provider_called === true ? { decision: 'remediation_required', reason: 'failed_after_network' } : undefined
  });
}

function buildTrialBlockedBeforeNetwork(code, reason) {
  return blockResult(code, reason, { executed: false, real_provider_called: false });
}

function buildTrialFailedAfterNetwork(code, reason) {
  return blockResult(code, reason, { executed: true, real_provider_called: true });
}

function nowIso(clock) {
  const value = typeof clock === 'function' ? clock() : new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : String(value);
}

function loadAndBuildPlan(input, options, clock) {
  const loaded = input.config ? { ok: true, config: input.config } : loadTrialConfig(input.configPath, input);
  if (!loaded.ok) return loaded;
  return buildTrialPlanFromConfig(loaded.config, { ...options, ...input, now: nowIso(clock) });
}

function isBootstrapConfigured(input, options) {
  return input.operationalBootstrapConfigured === true ||
    options.operationalBootstrapConfigured === true ||
    Boolean(input.canarySessionRegistry || options.canarySessionRegistry || input.operationalBootstrap || options.operationalBootstrap);
}

function mergeContext(options, input, plan, preflight) {
  return createSyntheticCanaryContext(plan, {
    ...options,
    ...input,
    preflight
  });
}

function authorizationTrialSnapshot(plan, session, targetPolicy) {
  return sanitizeTrialData({
    ...plan,
    canary_session_id: session.canary_session_id,
    canary_session_version: session.version,
    target_policy_version: targetPolicy && targetPolicy.version,
    lifecycle_version: session.lifecycle_version,
    configuration_version: session.configuration_version,
    readiness_evidence_id: session.readiness_evidence_id
  });
}

function buildReport(plan, session, auditSink, evidence, cleanup) {
  const canaryReport = buildPublicWebCanaryReport(
    session,
    auditSink && typeof auditSink.list === 'function' ? auditSink.list({ canary_session_id: session && session.canary_session_id }) : []
  );
  return sanitizeTrialData({
    trial_id: plan.trial_id,
    canary_session_id: plan.canary_session_id,
    status: evidence.status,
    provider_calls: evidence.real_provider_called ? 1 : 0,
    requests_attempted: evidence.executed ? 1 : 0,
    total_bytes: evidence.bytes_received,
    total_duration_ms: evidence.duration_ms,
    production_blocked: true,
    target_policy_enabled: false,
    session_terminal: !session || !['active', 'executing'].includes(session.canary_state),
    cleanup_status: cleanup.status,
    cleanup_warnings: cleanup.warnings || [],
    canary_report_hash: hashTrialEvidence(canaryReport),
    completed_at: evidence.finished_at
  });
}

function createPublicWebCanaryOperationalTrial(options = {}) {
  const trialRegistry = options.trialRegistry || createPublicWebCanaryTrialRegistry({ clock: options.clock });
  const authorizationRegistry = options.authorizationRegistry || createPublicWebCanaryTrialExecutionAuthorization({ clock: options.clock });
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date(0).toISOString();

  async function prepareTrial(input = {}) {
    const built = loadAndBuildPlan(input, options, clock);
    if (!built.ok) return built;
    const plan = built.plan;
    const register = trialRegistry.registerTrialPlan(plan, { request_id: `${plan.trial_id}_register`, change_id: `${plan.trial_id}_register_change` });
    if (!register.ok) return register;
    const preflight = runTrialPreflight(plan, { ...options, ...input, now: nowIso(clock) });
    const preflightRecord = trialRegistry.recordPreflight({ trial_id: plan.trial_id, expected_version: 1, request_id: `${plan.trial_id}_preflight`, change_id: `${plan.trial_id}_preflight_change` }, preflight);
    if (!preflight.passed) return sanitizeTrialData({ ok: false, plan, preflight, registry_result: preflightRecord });
    if (input.preflightOnly === true) return sanitizeTrialData({ ok: true, plan, preflight, registry_result: preflightRecord });
    const dryRun = await runTrialDryRun(plan, { ...options, ...input, preflight });
    const dryRunRecord = trialRegistry.recordDryRun({ trial_id: plan.trial_id, expected_version: 2, request_id: `${plan.trial_id}_dry_run`, change_id: `${plan.trial_id}_dry_run_change` }, dryRun);
    if (!dryRun.dry_run_passed) return sanitizeTrialData({ ok: false, plan, preflight, dry_run: dryRun, registry_result: dryRunRecord });
    return sanitizeTrialData({ ok: true, plan, preflight, dry_run: dryRun, registry_result: dryRunRecord });
  }

  async function readConfirmation(plan, input) {
    if (typeof input.injectedConfirmationReader === 'function') return input.injectedConfirmationReader(plan);
    if (typeof options.injectedConfirmationReader === 'function') return options.injectedConfirmationReader(plan);
    return '';
  }

  async function executeTrial(input = {}) {
    let plan = null;
    let authorization = null;
    let cleanup = null;
    let operationalContext = null;
    let cleanupAttempted = false;
    let cleanupResult = null;
    let activeSession = null;
    let executionFlags = { executed: false, real_provider_called: false };

    async function ensureCleanup() {
      if (cleanupAttempted) return cleanupResult;
      cleanupAttempted = true;
      if (!operationalContext || !plan || !activeSession) {
        cleanupResult = sanitizeTrialData({
          status: 'cleanup_skipped',
          warnings: ['cleanup_context_missing'],
          executed: executionFlags.executed === true,
          real_provider_called: executionFlags.real_provider_called === true
        });
        return cleanupResult;
      }
      try {
        cleanupResult = await runPublicWebCanaryTrialCleanup({
          ...plan,
          canary_session_id: activeSession.canary_session_id,
          authorization_id: authorization && authorization.authorization_id
        }, {
          ...operationalContext,
          authorizationRegistry
        });
      } catch (error) {
        cleanupResult = sanitizeTrialData({
          status: 'cleanup_failed_safe',
          warnings: ['cleanup_failed_safe'],
          error: buildSafeTrialError('TRIAL_CLEANUP_FAILED_SAFE', error && error.message || 'trial_cleanup_failed_safe'),
          executed: executionFlags.executed === true,
          real_provider_called: executionFlags.real_provider_called === true
        });
      }
      return cleanupResult;
    }

    try {
      if (!isBootstrapConfigured(input, options)) {
        return buildTrialBlockedBeforeNetwork('TRIAL_OPERATIONAL_BOOTSTRAP_NOT_CONFIGURED', 'trial_operational_bootstrap_not_configured');
      }
      const prepared = input.plan && input.preflight && input.dry_run
        ? { ok: true, plan: input.plan, preflight: input.preflight, dry_run: input.dry_run }
        : await prepareTrial(input);
      if (!prepared.ok) return prepared;
      plan = prepared.plan;
      const confirmation = await readConfirmation(plan, input);
      if (confirmation !== REQUIRED_CONFIRMATION) return buildTrialBlockedBeforeNetwork('TRIAL_CONFIRMATION_REQUIRED', 'operator_confirmation_required');

      operationalContext = mergeContext(options, input, plan, prepared.preflight);
      const canary = prepareOperationalCanarySession(plan, operationalContext, {
        suffix: 'operational',
        trace_id: `${plan.trial_id}_operational_trace`,
        request_id: `${plan.trial_id}_operational_request_canary`,
        change_id: `${plan.trial_id}_operational_change_canary`,
        approval_id: `${plan.trial_id}_operational_approval`
      });
      if (!canary.ok) return buildTrialBlockedBeforeNetwork('TRIAL_AUTHORIZATION_BLOCKED', `canary_${canary.stage}_blocked`);
      activeSession = canary.session;
      plan = { ...plan, canary_session_id: activeSession.canary_session_id };

      const authTrial = authorizationTrialSnapshot(plan, activeSession, canary.target_policy);
      const issued = authorizationRegistry.issueAuthorization({
        trial: authTrial,
        preflight_evidence_hash: prepared.preflight.evidence_hash,
        dry_run_evidence_hash: prepared.dry_run.evidence_hash,
        operator_confirmation: confirmation,
        expires_at: input.authorization_expires_at,
        authorization_id: `${plan.trial_id}_authorization`,
        canary_session_version: activeSession.version,
        target_policy_version: canary.target_policy && canary.target_policy.version,
        lifecycle_version: activeSession.lifecycle_version,
        configuration_version: activeSession.configuration_version,
        readiness_evidence_id: activeSession.readiness_evidence_id
      });
      if (!issued.ok) {
        await ensureCleanup();
        return sanitizeTrialData({ ...issued, cleanup: cleanupResult, executed: false, real_provider_called: false });
      }
      authorization = issued.authorization;

      const executionId = `${plan.trial_id}_execution`;
      const reserve = trialRegistry.reserveOperationalTrial({
        trial_id: plan.trial_id,
        expected_version: 3,
        request_id: `${plan.trial_id}_reserve`,
        change_id: `${plan.trial_id}_reserve_change`,
        execution_id: executionId
      });
      if (!reserve.ok) {
        await ensureCleanup();
        return sanitizeTrialData({ ...reserve, cleanup: cleanupResult, executed: false, real_provider_called: false });
      }
      const start = trialRegistry.startOperationalTrial({
        trial_id: plan.trial_id,
        expected_version: 4,
        request_id: `${plan.trial_id}_start`,
        change_id: `${plan.trial_id}_start_change`
      });
      if (!start.ok) {
        await ensureCleanup();
        return sanitizeTrialData({ ...start, cleanup: cleanupResult, executed: false, real_provider_called: false });
      }

      const runnerRequest = buildRunnerRequest(plan, activeSession, {
        trace_id: `${plan.trial_id}_execution_trace`,
        request_id: `${plan.trial_id}_execution_request`,
        change_id: `${plan.trial_id}_execution_change`,
        canary_execution_id: executionId
      });
      const binding = validateCanaryExecutionBindings(activeSession, operationalContext, runnerRequest, { requireApproval: true });
      if (!binding.valid) {
        await ensureCleanup();
        return buildTrialBlockedBeforeNetwork('TRIAL_AUTHORIZATION_BLOCKED', binding.reason);
      }

      const consume = authorizationRegistry.consumeAuthorization(authorization.authorization_id, {
        trial: authorizationTrialSnapshot(plan, activeSession, canary.target_policy)
      });
      if (!consume.ok) {
        await ensureCleanup();
        return sanitizeTrialData({ ...consume, cleanup: cleanupResult, executed: false, real_provider_called: false });
      }

      const runner = input.canaryRunner || options.canaryRunner || createPublicWebCanaryRunner(operationalContext);
      const result = await runner.runCanaryRequest(runnerRequest);
      executionFlags = {
        executed: result.executed === true,
        real_provider_called: result.real_provider_called === true
      };
      const evidence = buildTrialEvidence({
        trial_id: plan.trial_id,
        plan_hash: plan.plan_hash || hashTrialPlan(plan),
        preflight_evidence_hash: prepared.preflight.evidence_hash,
        dry_run_evidence_hash: prepared.dry_run.evidence_hash,
        authorization_hash: hashTrialEvidence(authorization),
        canary_session_id: activeSession.canary_session_id,
        canary_execution_id: executionId,
        request_id: runnerRequest.request_id,
        target_origin_hash: authorization.target_origin_hash,
        target_path_hash: authorization.target_path_hash,
        environment: plan.environment,
        operation: plan.operation,
        started_at: result.started_at || nowIso(clock),
        finished_at: result.finished_at || nowIso(clock),
        status: result.status === 'public_web_candidate_success' ? 'trial_success' : 'trial_failed_safe',
        executed: executionFlags.executed,
        real_provider_called: executionFlags.real_provider_called,
        result_count: result.result_count || 0,
        bytes_received: result.bytes_received || 0,
        duration_ms: result.duration_ms || 0,
        http_status_class: result.http_status_class || null,
        audit_event_count: result.audit_event_candidate ? 1 : 0,
        report_hash: hashTrialEvidence(result),
        warnings: result.warnings || [],
        error_code: result.error && result.error.error_code,
        blocked_reason: result.blocked_reason || (result.error && result.error.blocked_reason)
      });
      const finished = trialRegistry.finishOperationalTrial({
        trial_id: plan.trial_id,
        expected_version: 5,
        request_id: `${plan.trial_id}_finish`,
        change_id: `${plan.trial_id}_finish_change`
      }, evidence);
      if (!finished.ok) throw new Error(finished.error && finished.error.blocked_reason || 'trial_finish_failed');

      cleanup = await ensureCleanup();
      const sessionAfterCleanup = operationalContext.canarySessionRegistry.getCanarySession(activeSession.canary_session_id);
      const report = buildReport(plan, sessionAfterCleanup, operationalContext.auditSink, evidence, cleanup);
      const reportRecord = trialRegistry.recordTrialReport({
        trial_id: plan.trial_id,
        expected_version: 6,
        request_id: `${plan.trial_id}_report`,
        change_id: `${plan.trial_id}_report_change`
      }, report);
      if (!reportRecord.ok) throw new Error(reportRecord.error && reportRecord.error.blocked_reason || 'trial_report_failed');
      const decision = evaluateTrialDecision(plan, report, {
        ...evidence,
        provider_calls: report.provider_calls
      });
      const decisionRecord = trialRegistry.recordTrialDecision({
        trial_id: plan.trial_id,
        expected_version: 7,
        request_id: `${plan.trial_id}_decision`,
        change_id: `${plan.trial_id}_decision_change`
      }, decision);
      if (!decisionRecord.ok) throw new Error(decisionRecord.error && decisionRecord.error.blocked_reason || 'trial_decision_failed');
      return sanitizeTrialData({
        ok: evidence.status === 'trial_success' && cleanup.status === 'cleanup_completed',
        plan_hash: plan.plan_hash,
        evidence,
        report,
        decision,
        cleanup,
        executed: evidence.executed,
        real_provider_called: evidence.real_provider_called
      });
    } catch (error) {
      if (operationalContext && activeSession && !cleanupAttempted) {
        await ensureCleanup();
      }
      if (executionFlags.real_provider_called === true) {
        return buildTrialFailedAfterNetwork('TRIAL_INTERNAL_ERROR', 'trial_failed_safe_after_network');
      }
      return buildTrialBlockedBeforeNetwork('TRIAL_INTERNAL_ERROR', 'trial_internal_error_safe');
    } finally {
      if (operationalContext && activeSession && !cleanupAttempted) {
        await ensureCleanup();
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
  buildTrialBlockedBeforeNetwork,
  buildTrialFailedAfterNetwork,
  createPublicWebCanaryOperationalTrial
};

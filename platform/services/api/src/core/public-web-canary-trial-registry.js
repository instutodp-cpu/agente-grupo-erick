'use strict';

const {
  buildSafeTrialError,
  buildTrialAuditEvent,
  clone,
  hashTrialEvidence,
  sanitizeTrialData,
  validateTrialDecision,
  validateTrialDryRunResult,
  validateTrialExecutionEvidence,
  validateTrialPlan,
  validateTrialPreflightResult
} = require('./public-web-canary-trial-contract');

const TERMINAL_STATES = Object.freeze(['eligible_for_second_trial', 'remediation_required', 'terminated', 'cancelled', 'expired']);
const EXECUTION_TERMINAL_STATES = Object.freeze(['execution_succeeded', 'execution_failed_safe']);

function createPublicWebCanaryTrialRegistry(options = {}) {
  const trials = new Map();
  const history = new Map();
  const requestIds = new Set();
  const changeIds = new Set();
  const executionIds = new Set();
  const maxHistory = Number.isInteger(options.maxHistoryPerTrial) ? options.maxHistoryPerTrial : 100;
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date(0).toISOString();

  function nowIso() {
    const value = clock();
    return value instanceof Date ? value.toISOString() : String(value);
  }

  function append(trialId, event) {
    const events = history.get(trialId) || [];
    events.push(Object.freeze(clone(event)));
    while (events.length > maxHistory) events.shift();
    history.set(trialId, events);
  }

  function response(trial, request, fields = {}) {
    const audit = buildTrialAuditEvent({
      ...(trial || {}),
      ...(request || {}),
      event_name: fields.event_name || 'public_web_canary_trial_blocked',
      status: fields.status || fields.event_name || 'public_web_canary_trial_blocked',
      applied: fields.applied === true,
      error_code: fields.error_code || null,
      blocked_reason: fields.blocked_reason || null,
      executed: fields.executed === true,
      real_provider_called: fields.real_provider_called === true,
      occurred_at: nowIso()
    });
    if (trial && trial.trial_id) append(trial.trial_id, audit);
    return sanitizeTrialData({
      ok: fields.ok === true,
      applied: fields.applied === true,
      status: fields.status || fields.event_name || 'trial_blocked',
      trial: clone(trial),
      audit_event_candidate: audit,
      error: fields.error_code ? buildSafeTrialError(fields.error_code, fields.blocked_reason) : null,
      simulated: true,
      executed: fields.executed === true,
      real_provider_called: fields.real_provider_called === true
    });
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  function validateUniqueIds(request, options = {}) {
    const requestId = request && request.request_id;
    const changeId = request && request.change_id;
    const executionId = request && request.execution_id;
    if (!isNonEmptyString(requestId)) return { ok: false, reason: 'request_id_required' };
    if (!isNonEmptyString(changeId)) return { ok: false, reason: 'change_id_required' };
    if (options.executionRequired === true && !isNonEmptyString(executionId)) return { ok: false, reason: 'execution_id_required' };
    if (requestId && requestIds.has(requestId)) return { ok: false, reason: 'request_id_replayed' };
    if (changeId && changeIds.has(changeId)) return { ok: false, reason: 'change_id_replayed' };
    if (executionId && executionIds.has(executionId)) return { ok: false, reason: 'execution_id_replayed' };
    return { ok: true };
  }

  function consume(request, options = {}) {
    const valid = validateUniqueIds(request, options);
    if (!valid.ok) return valid;
    requestIds.add(request.request_id);
    changeIds.add(request.change_id);
    if (request.execution_id) executionIds.add(request.execution_id);
    return { ok: true };
  }

  function getTrialOrBlock(request) {
    return trials.get(request && request.trial_id) || null;
  }

  function versionConflict(trial, request) {
    return Number.isInteger(request && request.expected_version) && request.expected_version === trial.version ? null : response(trial, request, {
      error_code: 'TRIAL_VERSION_CONFLICT',
      blocked_reason: 'trial_version_conflict'
    });
  }

  function transition(trial, request, status, patch = {}, fields = {}) {
    const next = Object.freeze({
      ...clone(trial),
      ...patch,
      status,
      version: trial.version + 1,
      updated_at: nowIso()
    });
    trials.set(next.trial_id, next);
    return response(next, request, {
      ok: true,
      applied: true,
      event_name: fields.event_name || `public_web_canary_trial_${status}`,
      status,
      executed: fields.executed === true,
      real_provider_called: fields.real_provider_called === true
    });
  }

  function registerTrialPlan(plan, request = {}) {
    if (trials.has(plan && plan.trial_id)) return response(null, request, { error_code: 'TRIAL_REPLAY_DETECTED', blocked_reason: 'trial_id_replayed' });
    const validation = validateTrialPlan(plan);
    if (!validation.valid) return response(null, request, { error_code: 'INVALID_TRIAL_PLAN', blocked_reason: validation.errors[0] });
    const replay = consume(request);
    if (!replay.ok) return response(null, request, { error_code: 'TRIAL_REPLAY_DETECTED', blocked_reason: replay.reason });
    const trial = Object.freeze({
      ...clone(plan),
      status: 'configuration_pending',
      version: 1,
      preflight_result: null,
      dry_run_result: null,
      execution_evidence: null,
      report: null,
      decision: null,
      cleanup: null
    });
    trials.set(trial.trial_id, trial);
    return response(trial, request, { ok: true, applied: true, event_name: 'public_web_canary_trial_registered', status: trial.status });
  }

  function recordPreflight(request, result) {
    const trial = getTrialOrBlock(request);
    if (!trial) return response(null, request, { error_code: 'INVALID_TRIAL_PLAN', blocked_reason: 'trial_not_found' });
    const conflict = versionConflict(trial, request);
    if (conflict) return conflict;
    const validation = validateTrialPreflightResult(result);
    const replay = consume(request);
    if (!replay.ok) return response(trial, request, { error_code: 'TRIAL_REPLAY_DETECTED', blocked_reason: replay.reason });
    if (!validation.valid || result.passed !== true) return transition(trial, request, 'preflight_blocked', { preflight_result: clone(result) }, { event_name: 'public_web_canary_trial_preflight_blocked' });
    return transition(trial, request, 'preflight_passed', { preflight_result: clone(result) }, { event_name: 'public_web_canary_trial_preflight_passed' });
  }

  function recordDryRun(request, result) {
    const trial = getTrialOrBlock(request);
    if (!trial) return response(null, request, { error_code: 'INVALID_TRIAL_PLAN', blocked_reason: 'trial_not_found' });
    const conflict = versionConflict(trial, request);
    if (conflict) return conflict;
    if (trial.status !== 'preflight_passed') return response(trial, request, { error_code: 'TRIAL_STATE_BLOCKED', blocked_reason: 'preflight_required' });
    const validation = validateTrialDryRunResult(result);
    const replay = consume(request);
    if (!replay.ok) return response(trial, request, { error_code: 'TRIAL_REPLAY_DETECTED', blocked_reason: replay.reason });
    if (!validation.valid) return transition(trial, request, 'dry_run_blocked', { dry_run_result: clone(result) }, { event_name: 'public_web_canary_trial_dry_run_blocked' });
    return transition(trial, request, 'dry_run_passed', { dry_run_result: clone(result) }, { event_name: 'public_web_canary_trial_dry_run_passed' });
  }

  function reserveOperationalTrial(request) {
    const trial = getTrialOrBlock(request);
    if (!trial) return response(null, request, { error_code: 'INVALID_TRIAL_PLAN', blocked_reason: 'trial_not_found' });
    const conflict = versionConflict(trial, request);
    if (conflict) return conflict;
    if (trial.status !== 'dry_run_passed') return response(trial, request, { error_code: 'TRIAL_STATE_BLOCKED', blocked_reason: 'dry_run_required' });
    const replay = consume(request, { executionRequired: true });
    if (!replay.ok) return response(trial, request, { error_code: 'TRIAL_REPLAY_DETECTED', blocked_reason: replay.reason });
    return transition(trial, request, 'execution_reserved', { execution_id: request.execution_id }, { event_name: 'public_web_canary_trial_execution_reserved' });
  }

  function startOperationalTrial(request) {
    const trial = getTrialOrBlock(request);
    if (!trial) return response(null, request, { error_code: 'INVALID_TRIAL_PLAN', blocked_reason: 'trial_not_found' });
    const conflict = versionConflict(trial, request);
    if (conflict) return conflict;
    if (trial.status !== 'execution_reserved') return response(trial, request, { error_code: 'TRIAL_STATE_BLOCKED', blocked_reason: 'trial_not_reserved' });
    const replay = consume(request);
    if (!replay.ok) return response(trial, request, { error_code: 'TRIAL_REPLAY_DETECTED', blocked_reason: replay.reason });
    return transition(trial, request, 'execution_started', {}, { event_name: 'public_web_canary_trial_execution_started' });
  }

  function finishOperationalTrial(request, evidence) {
    const trial = getTrialOrBlock(request);
    if (!trial) return response(null, request, { error_code: 'INVALID_TRIAL_PLAN', blocked_reason: 'trial_not_found' });
    const conflict = versionConflict(trial, request);
    if (conflict) return conflict;
    const validation = validateTrialExecutionEvidence(evidence);
    if (!validation.valid) return response(trial, request, { error_code: 'INVALID_TRIAL_EVIDENCE', blocked_reason: validation.errors[0] });
    if (trial.status !== 'execution_started') return response(trial, request, { error_code: 'TRIAL_STATE_BLOCKED', blocked_reason: 'trial_not_started' });
    if (trial.execution_id !== evidence.canary_execution_id) return response(trial, request, { error_code: 'INVALID_TRIAL_EVIDENCE', blocked_reason: 'execution_id_mismatch' });
    if (evidence.trial_id !== trial.trial_id) return response(trial, request, { error_code: 'INVALID_TRIAL_EVIDENCE', blocked_reason: 'trial_id_mismatch' });
    if (evidence.canary_session_id !== trial.canary_session_id) return response(trial, request, { error_code: 'INVALID_TRIAL_EVIDENCE', blocked_reason: 'canary_session_id_mismatch' });
    if (evidence.plan_hash !== trial.plan_hash) return response(trial, request, { error_code: 'INVALID_TRIAL_EVIDENCE', blocked_reason: 'plan_hash_mismatch' });
    if (!isNonEmptyString(evidence.authorization_hash)) return response(trial, request, { error_code: 'INVALID_TRIAL_EVIDENCE', blocked_reason: 'authorization_hash_missing' });
    if (evidence.executed !== evidence.real_provider_called) return response(trial, request, { error_code: 'INVALID_TRIAL_EVIDENCE', blocked_reason: 'trial_execution_flags_incoherent' });
    const replay = consume(request);
    if (!replay.ok) return response(trial, request, { error_code: 'TRIAL_REPLAY_DETECTED', blocked_reason: replay.reason });
    const status = evidence.status === 'trial_success' ? 'execution_succeeded' : 'execution_failed_safe';
    return transition(trial, request, status, { execution_evidence: clone(evidence) }, {
      event_name: `public_web_canary_trial_${status}`,
      executed: evidence.executed === true,
      real_provider_called: evidence.real_provider_called === true
    });
  }

  function recordTrialReport(request, report) {
    const trial = getTrialOrBlock(request);
    if (!trial) return response(null, request, { error_code: 'INVALID_TRIAL_PLAN', blocked_reason: 'trial_not_found' });
    const conflict = versionConflict(trial, request);
    if (conflict) return conflict;
    if (!EXECUTION_TERMINAL_STATES.includes(trial.status)) return response(trial, request, { error_code: 'TRIAL_STATE_BLOCKED', blocked_reason: 'execution_terminal_required' });
    const replay = consume(request);
    if (!replay.ok) return response(trial, request, { error_code: 'TRIAL_REPLAY_DETECTED', blocked_reason: replay.reason });
    return transition(trial, request, 'report_completed', { report: clone(report), report_hash: hashTrialEvidence(report) }, { event_name: 'public_web_canary_trial_report_completed' });
  }

  function recordTrialDecision(request, decision) {
    const trial = getTrialOrBlock(request);
    if (!trial) return response(null, request, { error_code: 'INVALID_TRIAL_PLAN', blocked_reason: 'trial_not_found' });
    const conflict = versionConflict(trial, request);
    if (conflict) return conflict;
    if (trial.status !== 'report_completed') return response(trial, request, { error_code: 'TRIAL_STATE_BLOCKED', blocked_reason: 'report_required' });
    const validation = validateTrialDecision(decision);
    if (!validation.valid) return response(trial, request, { error_code: 'INVALID_TRIAL_DECISION', blocked_reason: validation.errors[0] });
    const replay = consume(request);
    if (!replay.ok) return response(trial, request, { error_code: 'TRIAL_REPLAY_DETECTED', blocked_reason: replay.reason });
    return transition(trial, request, decision.decision, { decision: clone(decision) }, { event_name: 'public_web_canary_trial_decision_recorded' });
  }

  function terminal(name, state) {
    return function terminalAction(request) {
      const trial = getTrialOrBlock(request);
      if (!trial) return response(null, request, { error_code: 'INVALID_TRIAL_PLAN', blocked_reason: 'trial_not_found' });
      const replay = consume(request);
      if (!replay.ok) return response(trial, request, { error_code: 'TRIAL_REPLAY_DETECTED', blocked_reason: replay.reason });
      const conflict = versionConflict(trial, request);
      if (conflict) return conflict;
      if (TERMINAL_STATES.includes(trial.status)) return response(trial, request, { error_code: 'TRIAL_STATE_BLOCKED', blocked_reason: 'trial_terminal' });
      return transition(trial, request, state, { terminal_reason: request.reason || state }, { event_name: name });
    };
  }

  return Object.freeze({
    registerTrialPlan,
    recordPreflight,
    recordDryRun,
    reserveOperationalTrial,
    startOperationalTrial,
    finishOperationalTrial,
    cancelOperationalTrial: terminal('public_web_canary_trial_cancelled', 'cancelled'),
    expireOperationalTrial: terminal('public_web_canary_trial_expired', 'expired'),
    terminateOperationalTrial: terminal('public_web_canary_trial_terminated', 'terminated'),
    recordTrialReport,
    recordTrialDecision,
    getTrial(trialId) { return clone(trials.get(trialId)) || null; },
    listTrials() { return [...trials.values()].map(clone).sort((a, b) => a.trial_id.localeCompare(b.trial_id)); },
    getTrialHistory(trialId) { return (history.get(trialId) || []).map(clone); }
  });
}

module.exports = {
  createPublicWebCanaryTrialRegistry
};

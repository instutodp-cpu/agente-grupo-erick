'use strict';

const READINESS_STATUSES = [
  'not_evaluated',
  'blocked',
  'conditionally_ready',
  'ready_for_real_read_only_pr',
  'deprecated',
  'invalid_candidate'
];

const VERDICTS = [
  'allow_future_read_only_pr',
  'deny_future_read_only_pr'
];

const EVIDENCE_STATUSES = [
  'satisfied',
  'missing',
  'failed',
  'unknown',
  'not_applicable'
];

const REQUIRED_BLOCKING_REQUIREMENTS = [
  'candidate_id_present',
  'provider_id_present',
  'adapter_id_present',
  'workspace_types_declared',
  'tenant_strategy_declared',
  'domains_declared',
  'capabilities_declared',
  'operations_declared',
  'provider_registered',
  'provider_status_candidate',
  'read_only_only',
  'write_disabled',
  'action_disabled',
  'send_disabled',
  'publish_disabled',
  'delete_disabled',
  'mock_adapter_exists',
  'mock_parity_documented',
  'safe_fixture_exists',
  'contract_tests_exist',
  'permission_matrix_mapped',
  'permission_overlay_mapped',
  'security_boundary_mapped',
  'governance_review_completed',
  'human_review_owner_declared',
  'audit_events_declared',
  'logs_sanitized',
  'forbidden_fields_declared',
  'cost_risk_known',
  'rate_limit_risk_known',
  'timeout_defined',
  'retries_disabled_or_bounded',
  'kill_switch_defined',
  'feature_flag_defined',
  'feature_flag_default_off',
  'rollout_plan_defined',
  'rollback_plan_defined',
  'incident_runbook_defined',
  'data_minimization_defined',
  'retention_policy_defined',
  'lgpd_review_completed',
  'observability_defined',
  'safe_error_contract_defined',
  'tenant_isolation_tests_exist',
  'cross_tenant_tests_exist',
  'no_write_tests_exist',
  'no_real_call_in_test',
  'provider_specific_requirements_satisfied'
];

const IMMEDIATE_BLOCKING_CONDITIONS = [
  'write_allowed_true',
  'action_allowed_true',
  'send_allowed_true',
  'publish_allowed_true',
  'delete_allowed_true',
  'raw_sql_allowed',
  'writeback_allowed',
  'unrestricted_oauth_scope',
  'missing_tenant_scope',
  'prompt_controls_tenant',
  'provider_controls_tenant',
  'cross_tenant_access',
  'tokens_in_fixture',
  'tokens_in_logs',
  'tokens_in_memory',
  'raw_payload_logging',
  'raw_message_logging',
  'secrets_in_repository',
  'feature_flag_default_on',
  'kill_switch_missing',
  'timeout_missing',
  'unbounded_retry',
  'unknown_cost_risk',
  'unknown_rate_limit_risk',
  'real_call_in_contract_test',
  'production_rollout_without_canary',
  'executed_true_in_readiness',
  'real_provider_called_true_in_readiness'
];

const FORBIDDEN_CANDIDATE_FIELDS = [
  'token',
  'secret',
  'env',
  'headers',
  'cookies',
  'credentials',
  'payload',
  'rawPayload',
  'rawMessage',
  'userMessage',
  'requiredAdapters',
  'authorization',
  'password',
  'stackTrace',
  'apiKey',
  'accessToken',
  'refreshToken',
  'requestBody',
  'responseBody',
  'rawSql',
  'rawQuery',
  'rawDatabasePayload',
  'rawSocialPayload',
  'rawTranscript',
  'rawAudio',
  'privateUrl',
  'webhookSecret'
];

const BLOCKED_OPERATION_TERMS = [
  'create',
  'update',
  'delete',
  'write',
  'send',
  'publish',
  'merge',
  'approve',
  'reject',
  'payment',
  'purchase',
  'insert',
  'upsert',
  'execute',
  'upload',
  'share',
  'modify',
  'cancel'
];

const DEFAULT_CONTRACT = Object.freeze({
  readiness_statuses: READINESS_STATUSES,
  verdicts: VERDICTS,
  evidence_statuses: EVIDENCE_STATUSES,
  required_blocking_requirements: REQUIRED_BLOCKING_REQUIREMENTS,
  immediate_blocking_conditions: IMMEDIATE_BLOCKING_CONDITIONS,
  forbidden_candidate_fields: FORBIDDEN_CANDIDATE_FIELDS,
  default_rules: Object.freeze({
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false
  })
});

const IMMEDIATE_BLOCKERS = Object.freeze({
  write_allowed_true: (candidate) => candidate.write_allowed === true,
  action_allowed_true: (candidate) => candidate.action_allowed === true,
  send_allowed_true: (candidate) => candidate.send_allowed === true,
  publish_allowed_true: (candidate) => candidate.publish_allowed === true,
  delete_allowed_true: (candidate) => candidate.delete_allowed === true,
  raw_sql_allowed: (candidate) => candidate.raw_sql_allowed === true,
  writeback_allowed: (candidate) => candidate.writeback_allowed === true,
  unrestricted_oauth_scope: (candidate) => candidate.unrestricted_oauth_scope === true,
  missing_tenant_scope: (candidate) => candidate.missing_tenant_scope === true,
  prompt_controls_tenant: (candidate) => candidate.prompt_controls_tenant === true,
  provider_controls_tenant: (candidate) => candidate.provider_controls_tenant === true,
  cross_tenant_access: (candidate) => candidate.cross_tenant_access === true,
  tokens_in_fixture: (candidate) => candidate.tokens_in_fixture === true,
  tokens_in_logs: (candidate) => candidate.tokens_in_logs === true,
  tokens_in_memory: (candidate) => candidate.tokens_in_memory === true,
  raw_payload_logging: (candidate) => candidate.raw_payload_logging === true,
  raw_message_logging: (candidate) => candidate.raw_message_logging === true,
  secrets_in_repository: (candidate) => candidate.secrets_in_repository === true,
  feature_flag_default_on: (candidate) => candidate.feature_flag_default_on === true || candidate.feature_flag_default_off === false,
  kill_switch_missing: (candidate) => candidate.kill_switch_defined === false,
  timeout_missing: (candidate) => candidate.timeout_defined === false,
  unbounded_retry: (candidate) => candidate.unbounded_retry === true || candidate.retry_policy === 'unbounded',
  unknown_cost_risk: (candidate) => candidate.cost_risk === 'unknown',
  unknown_rate_limit_risk: (candidate) => candidate.rate_limit_risk === 'unknown',
  real_call_in_contract_test: (candidate) => candidate.real_call_in_contract_test === true,
  production_rollout_without_canary: (candidate) => candidate.production_rollout_without_canary === true,
  executed_true_in_readiness: (candidate) => candidate.executed === true,
  real_provider_called_true_in_readiness: (candidate) => candidate.real_provider_called === true
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim() !== ''))].sort();
}

function getRequiredRequirements(contract) {
  const custom = contract && Array.isArray(contract.required_blocking_requirements)
    ? contract.required_blocking_requirements
    : [];

  return uniqueSorted([
    ...REQUIRED_BLOCKING_REQUIREMENTS,
    ...custom
  ]);
}

function getImmediateConditions(contract) {
  const custom = contract && Array.isArray(contract.immediate_blocking_conditions)
    ? contract.immediate_blocking_conditions
    : [];

  return uniqueSorted([
    ...IMMEDIATE_BLOCKING_CONDITIONS,
    ...custom
  ]);
}

function getForbiddenCandidateFields(contract) {
  const custom = contract && Array.isArray(contract.forbidden_candidate_fields)
    ? contract.forbidden_candidate_fields
    : [];

  return uniqueSorted([
    ...FORBIDDEN_CANDIDATE_FIELDS,
    ...custom
  ]);
}

function hasOnlyNonEmptyStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function isBlockedOperation(operation) {
  const normalized = String(operation || '').toLowerCase();
  return BLOCKED_OPERATION_TERMS.some((term) => normalized.includes(term));
}

function collectForbiddenCandidateFields(value, contract = DEFAULT_CONTRACT) {
  const forbidden = new Set(getForbiddenCandidateFields(contract));
  const found = [];

  function visit(entry) {
    if (Array.isArray(entry)) {
      for (const item of entry) {
        visit(item);
      }
      return;
    }

    if (!isPlainObject(entry)) {
      return;
    }

    for (const [key, nestedValue] of Object.entries(entry)) {
      if (forbidden.has(key)) {
        found.push(`forbidden_candidate_field::${key}`);
        continue;
      }

      visit(nestedValue);
    }
  }

  visit(value);
  return uniqueSorted(found);
}

function summarizeCandidate(candidate) {
  if (!isPlainObject(candidate)) {
    return {
      trace_id: 'trace_not_available',
      candidate_id: null,
      provider_id: null,
      adapter_id: null
    };
  }

  return {
    trace_id: isNonEmptyString(candidate.trace_id) ? candidate.trace_id : 'trace_not_available',
    candidate_id: isNonEmptyString(candidate.candidate_id) ? candidate.candidate_id : null,
    provider_id: isNonEmptyString(candidate.provider_id) ? candidate.provider_id : null,
    adapter_id: isNonEmptyString(candidate.adapter_id) ? candidate.adapter_id : null
  };
}

function buildAuditEventCandidate(summary, status, verdict) {
  return {
    event_type: 'read_only_adapter_readiness_evaluated',
    trace_id: summary.trace_id,
    candidate_id: summary.candidate_id,
    provider_id: summary.provider_id,
    adapter_id: summary.adapter_id,
    status,
    verdict,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false
  };
}

function buildResult(candidate, fields) {
  const summary = summarizeCandidate(candidate);
  const status = fields.status || 'blocked';
  const verdict = fields.verdict || 'deny_future_read_only_pr';
  const blockingRequirements = uniqueSorted(fields.blocking_requirements || []);
  const warningRequirements = uniqueSorted(fields.warning_requirements || []);
  const satisfiedRequirements = uniqueSorted(fields.satisfied_requirements || []);
  const blockingReasons = uniqueSorted(fields.blocking_reasons || blockingRequirements);

  return {
    trace_id: summary.trace_id,
    candidate_id: summary.candidate_id,
    provider_id: summary.provider_id,
    adapter_id: summary.adapter_id,
    status,
    verdict,
    ready: status === 'ready_for_real_read_only_pr' && verdict === 'allow_future_read_only_pr',
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    evaluated_requirements: uniqueSorted(fields.evaluated_requirements || []),
    satisfied_requirements: satisfiedRequirements,
    blocking_requirements: blockingRequirements,
    warning_requirements: warningRequirements,
    blocking_reasons: blockingReasons,
    next_steps: Array.isArray(fields.next_steps) ? fields.next_steps.slice() : [],
    audit_event_candidate: buildAuditEventCandidate(summary, status, verdict)
  };
}

function buildBlockedReadinessResult(candidate, reasons) {
  const normalizedReasons = uniqueSorted(Array.isArray(reasons) ? reasons : [String(reasons || 'blocked')]);

  return buildResult(candidate, {
    status: 'blocked',
    verdict: 'deny_future_read_only_pr',
    blocking_requirements: normalizedReasons,
    blocking_reasons: normalizedReasons,
    next_steps: ['resolve_blocking_requirements_before_future_real_read_only_pr']
  });
}

function validateReadinessCandidate(candidate) {
  const reasons = [];

  if (!isPlainObject(candidate)) {
    return {
      valid: false,
      reasons: ['candidate_must_be_plain_object']
    };
  }

  for (const field of [
    'trace_id',
    'candidate_id',
    'provider_id',
    'adapter_id',
    'provider_type',
    'tenant_strategy',
    'risk_level',
    'requested_by'
  ]) {
    if (!isNonEmptyString(candidate[field])) {
      reasons.push(`missing_${field}`);
    }
  }

  for (const field of ['workspace_types', 'domains', 'capabilities', 'operations']) {
    if (!hasOnlyNonEmptyStrings(candidate[field])) {
      reasons.push(`${field}_must_be_non_empty_string_array`);
    }
  }

  if (candidate.proposed_mode !== 'real_read_only_candidate') {
    reasons.push('proposed_mode_must_be_real_read_only_candidate');
  }

  if (!Array.isArray(candidate.evidence)) {
    reasons.push('evidence_must_be_array');
  }

  if (candidate.simulated !== true) {
    reasons.push('simulated_must_be_true');
  }

  if (candidate.executed !== false) {
    reasons.push('executed_true_in_readiness');
  }

  if (candidate.real_provider_called !== false) {
    reasons.push('real_provider_called_true_in_readiness');
  }

  if (Array.isArray(candidate.operations)) {
    for (const operation of candidate.operations) {
      if (isNonEmptyString(operation) && isBlockedOperation(operation)) {
        reasons.push(`blocked_operation::${operation}`);
      }
    }
  }

  return {
    valid: reasons.length === 0,
    reasons: uniqueSorted(reasons)
  };
}

function evidenceStatusByRequirement(candidate) {
  const statuses = new Map();

  if (!isPlainObject(candidate) || !Array.isArray(candidate.evidence)) {
    return statuses;
  }

  for (const entry of candidate.evidence) {
    if (!isPlainObject(entry) || !isNonEmptyString(entry.requirement_id)) {
      continue;
    }

    const status = EVIDENCE_STATUSES.includes(entry.status) ? entry.status : 'unknown';
    const existing = statuses.get(entry.requirement_id);

    if (!existing || existing === 'satisfied') {
      statuses.set(entry.requirement_id, status);
      continue;
    }

    if (status !== 'satisfied') {
      statuses.set(entry.requirement_id, status);
    }
  }

  return statuses;
}

function collectBlockingRequirements(candidate, contract = DEFAULT_CONTRACT) {
  const requiredRequirements = getRequiredRequirements(contract);
  const statuses = evidenceStatusByRequirement(candidate);
  const blocking = [];
  const satisfied = [];

  for (const requirement of requiredRequirements) {
    const status = statuses.get(requirement) || 'missing';

    if (status === 'satisfied') {
      satisfied.push(requirement);
    } else {
      blocking.push(requirement);
    }
  }

  return {
    evaluated_requirements: requiredRequirements,
    satisfied_requirements: uniqueSorted(satisfied),
    blocking_requirements: uniqueSorted(blocking)
  };
}

function hasImmediateBlockingCondition(candidate, contract = DEFAULT_CONTRACT) {
  if (!isPlainObject(candidate)) {
    return {
      blocked: false,
      conditions: []
    };
  }

  const conditions = [];
  for (const condition of getImmediateConditions(contract)) {
    const predicate = IMMEDIATE_BLOCKERS[condition];
    if (typeof predicate !== 'function') {
      conditions.push(`unknown_immediate_blocking_condition::${condition}`);
      continue;
    }

    if (typeof predicate === 'function' && predicate(candidate)) {
      conditions.push(condition);
    }
  }

  conditions.push(...collectForbiddenCandidateFields(candidate, contract));

  return {
    blocked: conditions.length > 0,
    conditions: uniqueSorted(conditions)
  };
}

function evaluateReadOnlyAdapterReadiness(candidate, contract = DEFAULT_CONTRACT) {
  try {
    const validation = validateReadinessCandidate(candidate);
    if (!validation.valid) {
      return buildResult(candidate, {
        status: 'invalid_candidate',
        verdict: 'deny_future_read_only_pr',
        blocking_requirements: validation.reasons,
        blocking_reasons: validation.reasons,
        next_steps: ['provide_valid_readiness_candidate']
      });
    }

    const immediate = hasImmediateBlockingCondition(candidate, contract);
    const collected = collectBlockingRequirements(candidate, contract);
    const blockingRequirements = uniqueSorted([
      ...immediate.conditions,
      ...collected.blocking_requirements
    ]);

    if (blockingRequirements.length > 0) {
      return buildResult(candidate, {
        status: 'blocked',
        verdict: 'deny_future_read_only_pr',
        evaluated_requirements: collected.evaluated_requirements,
        satisfied_requirements: collected.satisfied_requirements,
        blocking_requirements: blockingRequirements,
        blocking_reasons: blockingRequirements,
        next_steps: ['resolve_blocking_requirements_before_future_real_read_only_pr']
      });
    }

    return buildResult(candidate, {
      status: 'ready_for_real_read_only_pr',
      verdict: 'allow_future_read_only_pr',
      evaluated_requirements: collected.evaluated_requirements,
      satisfied_requirements: collected.satisfied_requirements,
      next_steps: ['open_future_adapter_pr_with_feature_flag_default_off']
    });
  } catch (_err) {
    return buildBlockedReadinessResult(candidate, ['readiness_gate_internal_error']);
  }
}

module.exports = {
  DEFAULT_CONTRACT,
  READINESS_STATUSES,
  VERDICTS,
  EVIDENCE_STATUSES,
  REQUIRED_BLOCKING_REQUIREMENTS,
  IMMEDIATE_BLOCKING_CONDITIONS,
  FORBIDDEN_CANDIDATE_FIELDS,
  evaluateReadOnlyAdapterReadiness,
  validateReadinessCandidate,
  buildBlockedReadinessResult,
  collectBlockingRequirements,
  hasImmediateBlockingCondition
};

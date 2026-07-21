'use strict';

const { isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { SESSION_STATUSES, matchesSessionScope, validateSessionScope } = require('./agent-session-contract');
const { validateAgentSessionRequest } = require('./agent-session-request');
const { evaluateAgentSessionTransition, resolveTargetStatus } = require('./agent-session-transition');
const { evaluateAgentSessionExpiration } = require('./agent-session-expiration');
const { buildAgentSessionDecision } = require('./agent-session-decision');

const AGENT_SESSION_BOUNDARY_VALIDATOR_VERSION = 'agent_session_boundary_validator_v1';
const REQUEST_TYPE_TRANSITION_MAP = Object.freeze({
  VALIDATE_SESSION_REFERENCE: 'VALIDATE',
  CLOSE_SESSION_REFERENCE: 'CLOSE_SIMULATION',
  ARCHIVE_SESSION_REFERENCE: 'ARCHIVE'
});
const REQUEST_TYPE_DECISION_MAP = Object.freeze({
  CREATE_SESSION_REFERENCE: 'CREATE_REFERENCE_ALLOWED',
  VALIDATE_SESSION_REFERENCE: 'VALIDATE_REFERENCE_ALLOWED',
  TRANSITION_SESSION_REFERENCE: 'TRANSITION_REFERENCE_ALLOWED',
  READ_SESSION_REFERENCE: 'READ_REFERENCE_ALLOWED',
  LIST_SESSION_REFERENCES: 'LIST_REFERENCES_ALLOWED',
  EVALUATE_EXPIRATION_REFERENCE: 'EXPIRATION_REFERENCE_EVALUATED',
  CLOSE_SESSION_REFERENCE: 'CLOSE_REFERENCE_ALLOWED',
  ARCHIVE_SESSION_REFERENCE: 'ARCHIVE_REFERENCE_ALLOWED'
});
const NO_CURRENT_SESSION_REQUIRED = Object.freeze(['CREATE_SESSION_REFERENCE']);
const NO_TRANSITION_REQUEST_TYPES = Object.freeze(['READ_SESSION_REFERENCE', 'LIST_SESSION_REFERENCES', 'EVALUATE_EXPIRATION_REFERENCE']);

function safeFingerprint(value) {
  try {
    return stablePayload(value || {});
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function finalizeDecision(request, overrides) {
  const requestFingerprint = isPlainObject(request) ? safeFingerprint(request) : 'invalid_request';
  const base = {
    session_request_id: isPlainObject(request) ? request.session_request_id : 'session_request_not_available',
    session_id: isPlainObject(request) && isPlainObject(request.session_reference) ? request.session_reference.session_id : 'session_not_available',
    agent_id: isPlainObject(request) && isPlainObject(request.agent_contract_reference) ? request.agent_contract_reference.agent_id : 'agent_not_available',
    tenant_id: isPlainObject(request) ? request.tenant_id : 'tenant_not_available',
    organization_id: isPlainObject(request) ? request.organization_id : 'organization_not_available',
    requested_transition: isPlainObject(request) ? request.requested_transition : 'CREATE',
    request_fingerprint: requestFingerprint,
    registry_version: AGENT_SESSION_BOUNDARY_VALIDATOR_VERSION,
    ...overrides
  };
  return buildAgentSessionDecision(base);
}

function blockedDecision(request, status, reasonCodes, extra = {}) {
  return finalizeDecision(request, {
    status,
    decision: 'BLOCKED',
    allowed_in_simulation: false,
    transition_allowed: false,
    blockers: uniqueSorted(reasonCodes),
    reason_codes: uniqueSorted(reasonCodes),
    session_validated: false,
    policy_validated: false,
    scope_validated: false,
    expiration_evaluated: false,
    ...extra
  });
}

function evaluateAgentSessionRequest(request, context = {}) {
  const requestValidation = validateAgentSessionRequest(request);
  if (!requestValidation.valid) {
    return blockedDecision(request, 'VALIDATION_FAILED', requestValidation.errors);
  }

  const sessionScope = context.session_scope;
  const scopeValidation = validateSessionScope(sessionScope);
  if (!scopeValidation.valid) {
    return blockedDecision(request, 'SCOPE_BLOCKED', scopeValidation.errors);
  }
  if (request.tenant_id !== sessionScope.tenant_id) {
    return blockedDecision(request, 'TENANT_BLOCKED', ['tenant_not_in_session_scope']);
  }
  if (request.organization_id !== sessionScope.organization_id) {
    return blockedDecision(request, 'ORGANIZATION_BLOCKED', ['organization_not_in_session_scope']);
  }

  const candidate = {
    agent_id: request.agent_contract_reference.agent_id,
    actor_id: request.actor_context.actor_id,
    actor_role: request.actor_context.actor_role,
    channel: request.channel,
    session_type: request.requested_session_type,
    tenant_id: request.tenant_id,
    organization_id: request.organization_id
  };
  if (!sessionScope.allowed_agent_ids.includes(candidate.agent_id)) return blockedDecision(request, 'AGENT_BLOCKED', ['agent_not_in_session_scope']);
  if (!sessionScope.allowed_actor_ids.includes(candidate.actor_id)) return blockedDecision(request, 'ACTOR_BLOCKED', ['actor_not_in_session_scope']);
  if (!sessionScope.allowed_actor_roles.includes(candidate.actor_role)) return blockedDecision(request, 'ROLE_BLOCKED', ['actor_role_not_in_session_scope']);
  if (!sessionScope.allowed_channels.includes(candidate.channel)) return blockedDecision(request, 'CHANNEL_BLOCKED', ['channel_not_in_session_scope']);
  if (!sessionScope.allowed_session_types.includes(candidate.session_type)) return blockedDecision(request, 'SCOPE_BLOCKED', ['session_type_not_in_session_scope']);
  if (!matchesSessionScope(sessionScope, candidate)) return blockedDecision(request, 'SCOPE_BLOCKED', ['session_scope_no_match']);

  const policyRef = request.policy_reference;
  if (policyRef.policy_evaluated !== true) return blockedDecision(request, 'POLICY_BLOCKED', ['policy_not_evaluated']);
  if (policyRef.allowed_in_simulation !== true) return blockedDecision(request, 'POLICY_BLOCKED', ['policy_not_allowed_in_simulation']);

  const requestType = request.request_type;
  const requiresCurrentSession = !NO_CURRENT_SESSION_REQUIRED.includes(requestType);
  const current = context.current_session;
  if (requiresCurrentSession) {
    if (!isPlainObject(current)) {
      return blockedDecision(request, 'VALIDATION_FAILED', ['current_session_context_required']);
    }
    if (request.session_reference.session_id !== current.session_id) {
      return blockedDecision(request, 'CONFLICT_BLOCKED', ['session_id_conflict']);
    }
    if (request.expected_session_version !== current.session_version) {
      return blockedDecision(request, 'VERSION_BLOCKED', ['session_version_conflict']);
    }
    if (request.expected_session_fingerprint !== current.session_fingerprint) {
      return blockedDecision(request, 'FINGERPRINT_BLOCKED', ['session_fingerprint_conflict']);
    }
    if (current.agent_id !== candidate.agent_id) {
      return blockedDecision(request, 'AGENT_BLOCKED', ['session_agent_mismatch']);
    }
    if (current.tenant_id !== request.tenant_id || current.organization_id !== request.organization_id) {
      return blockedDecision(request, 'TENANT_BLOCKED', ['session_tenant_organization_mismatch']);
    }
  }

  const decisionValue = REQUEST_TYPE_DECISION_MAP[requestType] || 'BLOCKED';

  if (requestType === 'EVALUATE_EXPIRATION_REFERENCE') {
    const expirationInput = context.expiration_policy || {};
    const expiration = evaluateAgentSessionExpiration({
      expiration_policy_id: expirationInput.expiration_policy_id,
      expiration_type: expirationInput.expiration_type,
      created_sequence: current ? current.creation_sequence : 0,
      last_activity_sequence: request.expiration_evaluation.last_activity_sequence,
      current_sequence: request.expiration_evaluation.current_sequence,
      maximum_inactive_sequences: expirationInput.maximum_inactive_sequences,
      maximum_total_sequences: expirationInput.maximum_total_sequences
    });
    return finalizeDecision(request, {
      status: 'ALLOW_SIMULATION',
      decision: decisionValue,
      allowed_in_simulation: true,
      transition_allowed: false,
      current_status: current ? current.current_status : 'DRAFT',
      proposed_status: current ? current.current_status : 'DRAFT',
      session_fingerprint: current ? current.session_fingerprint : 'session_fingerprint_not_available',
      state_fingerprint: 'state_fingerprint_not_available',
      transition_fingerprint: 'transition_fingerprint_not_available',
      policy_decision_fingerprint: policyRef.policy_decision_fingerprint,
      expiration_fingerprint: safeFingerprint(expiration),
      blockers: [],
      reason_codes: [expiration.expiration_reason],
      session_validated: true,
      policy_validated: true,
      scope_validated: true,
      expiration_evaluated: true
    });
  }

  if (NO_TRANSITION_REQUEST_TYPES.includes(requestType)) {
    return finalizeDecision(request, {
      status: 'ALLOW_SIMULATION',
      decision: decisionValue,
      allowed_in_simulation: true,
      transition_allowed: false,
      current_status: current ? current.current_status : 'DRAFT',
      proposed_status: current ? current.current_status : 'DRAFT',
      session_fingerprint: current ? current.session_fingerprint : 'session_fingerprint_not_available',
      state_fingerprint: 'state_fingerprint_not_available',
      transition_fingerprint: 'transition_fingerprint_not_available',
      policy_decision_fingerprint: policyRef.policy_decision_fingerprint,
      expiration_fingerprint: 'expiration_fingerprint_not_available',
      blockers: [],
      reason_codes: ['session_reference_reviewed_simulation_only'],
      session_validated: true,
      policy_validated: true,
      scope_validated: true,
      expiration_evaluated: false
    });
  }

  const fromStatus = requestType === 'CREATE_SESSION_REFERENCE' ? 'DRAFT' : current.current_status;
  const transitionType = REQUEST_TYPE_TRANSITION_MAP[requestType] || request.requested_transition;
  if (requestType !== 'CREATE_SESSION_REFERENCE' && request.requested_transition !== transitionType) {
    return blockedDecision(request, 'TRANSITION_BLOCKED', ['requested_transition_mismatch_with_request_type']);
  }
  const toStatus = resolveTargetStatus(fromStatus, transitionType) || fromStatus;

  if (transitionType === 'OPEN_SIMULATION' && policyRef.approval_required === true) {
    return blockedDecision(request, 'APPROVAL_BLOCKED', ['approval_pending_blocks_open_simulation']);
  }

  const transition = evaluateAgentSessionTransition({
    transition_id: `transition_${request.session_request_id}`,
    session_id: request.session_reference.session_id,
    tenant_id: request.tenant_id,
    organization_id: request.organization_id,
    from_status: fromStatus,
    to_status: toStatus,
    transition_type: transitionType,
    approval_required_hint: policyRef.approval_required === true,
    logical_sequence: request.logical_sequence,
    transition_version: 1
  });

  if (!transition.transition_allowed) {
    return blockedDecision(request, 'TRANSITION_BLOCKED', transition.reason_codes, {
      current_status: fromStatus,
      proposed_status: toStatus,
      transition_fingerprint: safeFingerprint(transition)
    });
  }

  return finalizeDecision(request, {
    status: 'ALLOW_SIMULATION',
    decision: decisionValue,
    allowed_in_simulation: true,
    transition_allowed: true,
    current_status: fromStatus,
    proposed_status: toStatus,
    session_fingerprint: requestType === 'CREATE_SESSION_REFERENCE' ? 'session_fingerprint_not_yet_created' : current.session_fingerprint,
    state_fingerprint: 'state_fingerprint_not_available',
    transition_fingerprint: safeFingerprint(transition),
    policy_decision_fingerprint: policyRef.policy_decision_fingerprint,
    expiration_fingerprint: 'expiration_fingerprint_not_available',
    blockers: [],
    reason_codes: ['session_reference_reviewed_simulation_only'],
    session_validated: true,
    policy_validated: true,
    scope_validated: true,
    expiration_evaluated: false
  });
}

module.exports = {
  AGENT_SESSION_BOUNDARY_VALIDATOR_VERSION,
  evaluateAgentSessionRequest
};

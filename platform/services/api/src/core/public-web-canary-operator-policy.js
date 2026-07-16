'use strict';

const { hashCanaryEvidence, parseCanaryTimestamp } = require('./public-web-canary-session-contract');

const CANARY_OPERATOR_ROLES = Object.freeze([
  'super_admin',
  'security_operator',
  'integration_operator'
]);

function createPublicWebCanaryOperatorPolicy(options = {}) {
  const authorizedRoles = new Set(options.authorizedRoles || CANARY_OPERATOR_ROLES);
  const dualApproval = options.dualApproval !== false;
  const approvals = new Map();
  const revokedApprovals = new Set();

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function nowDate(clock, fallback) {
    const value = typeof clock === 'function' ? clock() : fallback;
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
    if (typeof value === 'string') return parseCanaryTimestamp(value);
    return null;
  }

  function roleOf(actor) {
    return actor && (actor.operator_role || actor.approver_role || actor.actor_role || actor.role);
  }

  function canRequest(actor) {
    return {
      allowed: Boolean(actor && typeof (actor.operator_id || actor.actor_id) === 'string' && authorizedRoles.has(roleOf(actor)))
    };
  }

  function canApprove(approval, session) {
    return {
      allowed: Boolean(
        approval &&
        session &&
        authorizedRoles.has(roleOf(approval)) &&
        !(dualApproval && approval.approved_by === session.operator_id)
      )
    };
  }

  function validateApproval(approval, session) {
    if (!canApprove(approval, session).allowed) {
      return { allowed: false, valid: false, error_code: 'CANARY_OPERATOR_NOT_AUTHORIZED', reason: 'operator_not_authorized' };
    }
    if (approvals.has(approval.approval_id) || revokedApprovals.has(approval.approval_id)) {
      return { allowed: false, valid: false, error_code: 'CANARY_REPLAY_DETECTED', reason: 'approval_replay_detected' };
    }
    return { allowed: true, valid: true };
  }

  function scopeHash(approval) {
    return hashCanaryEvidence({
      scope: approval.scope,
      evidence_snapshot_hash: approval.evidence_snapshot_hash,
      lifecycle_version: approval.lifecycle_version,
      configuration_version: approval.configuration_version,
      target_path_hash: approval.target_path_hash,
      target_origin: approval.target_origin,
      operation: approval.operation,
      source_type: approval.source_type,
      maximum_requests: approval.maximum_requests,
      rollout_percentage: approval.rollout_percentage,
      tenant_id: approval.tenant_id,
      workspace_type: approval.workspace_type,
      user_id: approval.user_id
    });
  }

  function consumeApproval(approval, session) {
    const validation = validateApproval(approval, session);
    if (!validation.valid) return { allowed: false, consumed: false, ...validation };
    approvals.set(approval.approval_id, Object.freeze({
      approval_id: approval.approval_id,
      session_id: session.canary_session_id,
      approved_by: approval.approved_by,
      approver_role: approval.approver_role,
      approved_at: approval.approved_at,
      expires_at: approval.expires_at,
      scope_hash: scopeHash(approval),
      revoked: false
    }));
    return { allowed: true, consumed: true, valid: true };
  }

  function getApproval(approvalId) {
    return approvals.get(approvalId) || null;
  }

  function isApprovalRevoked(approvalId) {
    const approval = approvals.get(approvalId);
    return revokedApprovals.has(approvalId) || Boolean(approval && approval.revoked);
  }

  function isApprovalConsumedForSession(approvalId, sessionId) {
    const approval = approvals.get(approvalId);
    return Boolean(approval && approval.session_id === sessionId);
  }

  function isApprovalActive(approvalId, session, clock) {
    const approval = approvals.get(approvalId);
    if (!approval || !session) return false;
    if (approval.revoked || revokedApprovals.has(approvalId)) return false;
    if (approval.session_id !== session.canary_session_id) return false;
    const approvedAt = parseCanaryTimestamp(approval.approved_at);
    const approvalExpiresAt = parseCanaryTimestamp(approval.expires_at);
    const sessionExpiresAt = parseCanaryTimestamp(session.expires_at);
    const now = nowDate(clock, approval.approved_at);
    if (!approvedAt || !approvalExpiresAt || !sessionExpiresAt || !now) return false;
    if (approvedAt.getTime() >= approvalExpiresAt.getTime()) return false;
    if (approvalExpiresAt.getTime() > sessionExpiresAt.getTime()) return false;
    if (now.getTime() >= approvalExpiresAt.getTime()) return false;
    return true;
  }

  function revokeApproval(approvalId) {
    if (typeof approvalId === 'string' && approvalId.trim() !== '') revokedApprovals.add(approvalId);
    const approval = approvals.get(approvalId);
    if (approval) approvals.set(approvalId, Object.freeze({ ...approval, revoked: true }));
    return { revoked: true };
  }

  return Object.freeze({
    canRequest,
    canApprove,
    validateApproval,
    consumeApproval,
    getApproval(approvalId) { return clone(getApproval(approvalId)); },
    isApprovalActive,
    isApprovalRevoked,
    isApprovalConsumedForSession,
    revokeApproval
  });
}

module.exports = {
  CANARY_OPERATOR_ROLES,
  createPublicWebCanaryOperatorPolicy
};

'use strict';

const {
  buildSafeCanaryError,
  isNonEmptyString,
  sanitizeCanaryData
} = (() => {
  const contract = require('./public-web-canary-session-contract');
  const transport = require('./public-web-transport-contract');
  return {
    buildSafeCanaryError: contract.buildSafeCanaryError,
    sanitizeCanaryData: contract.sanitizeCanaryData,
    isNonEmptyString: transport.isNonEmptyString
  };
})();

const CANARY_OPERATOR_ROLES = ['super_admin', 'security_operator', 'integration_operator'];

function createPublicWebCanaryOperatorPolicy(options = {}) {
  const dualApprovalRequired = options.dualApprovalRequired !== false;
  const consumedApprovals = new Set();
  const revokedApprovals = new Set();

  function canRequest(operator = {}) {
    const allowed = isNonEmptyString(operator.operator_id) && CANARY_OPERATOR_ROLES.includes(operator.operator_role);
    return sanitizeCanaryData({
      allowed,
      blocked_reason: allowed ? null : 'operator_role_not_allowed',
      error: allowed ? null : buildSafeCanaryError('CANARY_OPERATOR_NOT_AUTHORIZED', 'Operator is not authorized for public web canary.')
    });
  }

  function validateApproval(approval = {}, session = {}) {
    const errors = [];
    if (!CANARY_OPERATOR_ROLES.includes(approval.approver_role)) errors.push('approver_role_not_allowed');
    if (!isNonEmptyString(approval.approved_by)) errors.push('approved_by_missing');
    if (!isNonEmptyString(approval.approval_id)) errors.push('approval_id_missing');
    if (!isNonEmptyString(approval.reason)) errors.push('approval_reason_missing');
    if (dualApprovalRequired && approval.approved_by === session.operator_id) errors.push('self_approval_blocked');
    if (approval.canary_session_id !== session.canary_session_id) errors.push('approval_session_mismatch');
    if (approval.environment !== session.environment) errors.push('approval_environment_mismatch');
    if (approval.target_origin !== session.target_origin) errors.push('approval_target_mismatch');
    if (approval.operation !== session.operation) errors.push('approval_operation_mismatch');
    if (approval.maximum_requests !== session.maximum_requests) errors.push('approval_request_limit_mismatch');
    if (consumedApprovals.has(approval.approval_id)) errors.push('approval_replay_detected');
    if (revokedApprovals.has(approval.approval_id)) errors.push('approval_revoked');
    return sanitizeCanaryData({
      allowed: errors.length === 0,
      errors: [...new Set(errors)].sort(),
      error: errors.length === 0 ? null : buildSafeCanaryError('INVALID_CANARY_APPROVAL', 'Canary approval is invalid.', {
        blocked_reason: errors[0]
      })
    });
  }

  function consumeApproval(approval = {}, session = {}) {
    const validation = validateApproval(approval, session);
    if (validation.allowed) consumedApprovals.add(approval.approval_id);
    return validation;
  }

  function revokeApproval(approvalId) {
    if (isNonEmptyString(approvalId)) revokedApprovals.add(approvalId);
    return sanitizeCanaryData({
      revoked: isNonEmptyString(approvalId),
      approval_id: isNonEmptyString(approvalId) ? approvalId : 'approval_not_available'
    });
  }

  return Object.freeze({
    canRequest,
    validateApproval,
    consumeApproval,
    revokeApproval,
    roles: () => CANARY_OPERATOR_ROLES.slice()
  });
}

module.exports = {
  CANARY_OPERATOR_ROLES,
  createPublicWebCanaryOperatorPolicy
};

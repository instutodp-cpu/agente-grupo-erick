'use strict';

const { sanitizeTrialData } = require('../core/public-web-canary-trial-contract');

async function runPublicWebCanaryTrialCleanup(input = {}, context = {}) {
  const warnings = [];
  try {
    if (context.targetAllowlist && typeof context.targetAllowlist.disableTargetPolicy === 'function' && input.target_policy_id) {
      context.targetAllowlist.disableTargetPolicy({
        target_policy_id: input.target_policy_id,
        reason: 'trial_cleanup',
        request_id: `${input.trial_id || 'trial'}_cleanup_target`,
        change_id: `${input.trial_id || 'trial'}_cleanup_target_change`
      });
    }
  } catch (error) {
    warnings.push('target_policy_cleanup_failed');
  }
  try {
    if (context.canarySessionRegistry && typeof context.canarySessionRegistry.cancelCanary === 'function' && input.canary_session_id) {
      context.canarySessionRegistry.cancelCanary({
        canary_session_id: input.canary_session_id,
        reason: 'trial_cleanup',
        request_id: `${input.trial_id || 'trial'}_cleanup_session`,
        change_id: `${input.trial_id || 'trial'}_cleanup_session_change`
      });
    }
  } catch (error) {
    warnings.push('session_cleanup_failed');
  }
  try {
    if (context.authorizationRegistry && typeof context.authorizationRegistry.revokeAuthorization === 'function' && input.authorization_id) {
      context.authorizationRegistry.revokeAuthorization(input.authorization_id);
    }
  } catch (error) {
    warnings.push('authorization_cleanup_failed');
  }
  try {
    if (context.rateLimitBudget && typeof context.rateLimitBudget.release === 'function') context.rateLimitBudget.release(input.trial_id);
    if (context.costBudget && typeof context.costBudget.release === 'function') context.costBudget.release(input.trial_id);
  } catch (error) {
    warnings.push('budget_cleanup_failed');
  }
  try {
    if (context.auditSink && typeof context.auditSink.append === 'function') {
      context.auditSink.append({
        event_name: 'public_web_canary_trial_cleanup',
        trial_id: input.trial_id,
        canary_session_id: input.canary_session_id,
        status: warnings.length === 0 ? 'cleanup_completed' : 'cleanup_partial',
        executed: false,
        real_provider_called: false
      });
    }
  } catch (error) {
    warnings.push('audit_cleanup_failed');
  }
  return sanitizeTrialData({
    status: warnings.length === 0 ? 'cleanup_completed' : 'cleanup_partial',
    warnings,
    executed: false,
    real_provider_called: false
  });
}

module.exports = {
  runPublicWebCanaryTrialCleanup
};

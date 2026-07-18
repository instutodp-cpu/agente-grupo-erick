'use strict';

const { sanitizeTrialData } = require('../core/public-web-canary-trial-contract');

async function runPublicWebCanaryTrialCleanup(input = {}, context = {}) {
  const warnings = [];
  const confirmations = {
    target_policy_inactive: false,
    session_not_active: false,
    authorization_revoked: false,
    rate_budget_released: false,
    cost_budget_released: false,
    feature_flag_disabled: false,
    audit_registered: false
  };
  try {
    if (context.targetAllowlist && typeof context.targetAllowlist.disableTargetPolicy === 'function' && input.target_policy_id) {
      const disabled = context.targetAllowlist.disableTargetPolicy({
        target_policy_id: input.target_policy_id,
        reason: 'trial_cleanup',
        request_id: `${input.trial_id || 'trial'}_cleanup_target`,
        change_id: `${input.trial_id || 'trial'}_cleanup_target_change`
      });
      confirmations.target_policy_inactive = disabled && disabled.ok === true && disabled.target_policy && disabled.target_policy.enabled === false;
      if (!confirmations.target_policy_inactive) warnings.push('target_policy_cleanup_not_confirmed');
    } else {
      confirmations.target_policy_inactive = true;
    }
  } catch (error) {
    warnings.push('target_policy_cleanup_failed');
  }
  try {
    if (context.canarySessionRegistry && typeof context.canarySessionRegistry.getCanarySession === 'function' && input.canary_session_id) {
      let session = context.canarySessionRegistry.getCanarySession(input.canary_session_id);
      if (session && ['active', 'executing'].includes(session.canary_state) && typeof context.canarySessionRegistry.cancelCanary === 'function') {
        const cancelled = context.canarySessionRegistry.cancelCanary({
          canary_session_id: input.canary_session_id,
          reason: 'trial_cleanup',
          request_id: `${input.trial_id || 'trial'}_cleanup_session`,
          change_id: `${input.trial_id || 'trial'}_cleanup_session_change`,
          expected_version: session.version
        });
        if (cancelled && cancelled.session) session = cancelled.session;
        if (!cancelled || cancelled.ok !== true) warnings.push('session_cleanup_not_confirmed');
      }
      confirmations.session_not_active = !session || !['active', 'executing'].includes(session.canary_state);
      if (!confirmations.session_not_active) warnings.push('session_still_active');
    } else {
      confirmations.session_not_active = true;
    }
  } catch (error) {
    warnings.push('session_cleanup_failed');
  }
  try {
    if (context.authorizationRegistry && typeof context.authorizationRegistry.revokeAuthorization === 'function' && input.authorization_id) {
      const revoked = context.authorizationRegistry.revokeAuthorization(input.authorization_id);
      confirmations.authorization_revoked = revoked && revoked.ok === true && revoked.revoked === true;
      if (!confirmations.authorization_revoked) warnings.push('authorization_cleanup_not_confirmed');
    } else {
      confirmations.authorization_revoked = true;
    }
  } catch (error) {
    warnings.push('authorization_cleanup_failed');
  }
  try {
    if (context.rateLimitBudget && typeof context.rateLimitBudget.release === 'function') {
      const released = context.rateLimitBudget.release(input.trial_id);
      confirmations.rate_budget_released = released == null || released.ok !== false;
      if (!confirmations.rate_budget_released) warnings.push('rate_budget_cleanup_not_confirmed');
    } else confirmations.rate_budget_released = true;
    if (context.costBudget && typeof context.costBudget.release === 'function') {
      const released = context.costBudget.release(input.trial_id);
      confirmations.cost_budget_released = released == null || released.ok !== false;
      if (!confirmations.cost_budget_released) warnings.push('cost_budget_cleanup_not_confirmed');
    } else confirmations.cost_budget_released = true;
  } catch (error) {
    warnings.push('budget_cleanup_failed');
  }
  try {
    if (context.featureFlagController && typeof context.featureFlagController.disable === 'function') {
      const disabled = context.featureFlagController.disable(input.feature_flag_key);
      confirmations.feature_flag_disabled = disabled && disabled.ok === true;
      if (!confirmations.feature_flag_disabled) warnings.push('feature_flag_cleanup_not_confirmed');
    } else confirmations.feature_flag_disabled = true;
  } catch (error) {
    warnings.push('feature_flag_cleanup_failed');
  }
  try {
    if (context.auditSink && typeof context.auditSink.append === 'function') {
      const audit = context.auditSink.append({
        event_name: 'public_web_canary_trial_cleanup',
        trial_id: input.trial_id,
        canary_session_id: input.canary_session_id,
        status: warnings.length === 0 ? 'cleanup_completed' : 'cleanup_partial',
        executed: false,
        real_provider_called: false
      });
      confirmations.audit_registered = Boolean(audit && audit.canary_session_id === input.canary_session_id);
      if (!confirmations.audit_registered) warnings.push('audit_cleanup_not_confirmed');
    } else {
      warnings.push('audit_sink_missing');
    }
  } catch (error) {
    warnings.push('audit_cleanup_failed');
  }
  return sanitizeTrialData({
    status: warnings.length === 0 ? 'cleanup_completed' : 'cleanup_partial',
    warnings,
    confirmations,
    executed: false,
    real_provider_called: false
  });
}

module.exports = {
  runPublicWebCanaryTrialCleanup
};

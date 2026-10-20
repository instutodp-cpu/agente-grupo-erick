const EFFECTS = new Set(['none','advisory','internal','external_nonbinding','external_binding','judicial']);

function evaluateLegalEffect(effect) {
  if (!effect || !EFFECTS.has(effect.effect_type)) return { allowed: false, reason: 'invalid_legal_effect' };
  if (effect.judicial && effect.effect_type !== 'judicial') return { allowed: false, reason: 'judicial_effect_mismatch' };
  if (effect.effect_type === 'judicial' && (!effect.approval_required || !effect.qualified_review_required)) {
    return { allowed: false, reason: 'judicial_requires_human_legal_authority' };
  }
  if (effect.effect_type === 'external_binding' && !effect.approval_required) {
    return { allowed: false, reason: 'binding_action_requires_approval' };
  }
  if ((effect.affects_rights || effect.affects_obligations) && !effect.approval_required && effect.external_party) {
    return { allowed: false, reason: 'external_rights_change_requires_approval' };
  }
  return { allowed: true, reason: 'policy_satisfied' };
}

function validateReviewSeparation(bundle) {
  if (!bundle) return { allowed: false, reason: 'missing_evidence_bundle' };
  if (bundle.review_status === 'verified' && (!bundle.draft_run_id || !bundle.review_run_id)) {
    return { allowed: false, reason: 'verified_bundle_requires_run_provenance' };
  }
  if (bundle.draft_run_id && bundle.review_run_id && bundle.draft_run_id === bundle.review_run_id) {
    return { allowed: false, reason: 'draft_review_must_be_independent' };
  }
  return { allowed: true, reason: 'review_separation_satisfied' };
}

module.exports = { evaluateLegalEffect, validateReviewSeparation };

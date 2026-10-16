const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateLegalEffect, validateReviewSeparation } = require('../src/hermes/legal/legal-policy');

const base = {
  effect_type: 'none', binding: false, judicial: false, affects_rights: false,
  affects_obligations: false, external_party: false, reversible: true,
  qualified_review_required: false, approval_required: false
};

test('read/advisory foundation can remain approval-free', () => {
  assert.equal(evaluateLegalEffect(base).allowed, true);
});

test('external binding action fails closed without approval', () => {
  const result = evaluateLegalEffect({...base, effect_type:'external_binding', binding:true, external_party:true});
  assert.deepEqual(result, {allowed:false, reason:'binding_action_requires_approval'});
});

test('judicial action requires approval and qualified review', () => {
  const result = evaluateLegalEffect({...base, effect_type:'judicial', judicial:true, external_party:true, approval_required:true});
  assert.deepEqual(result, {allowed:false, reason:'judicial_requires_human_legal_authority'});
});

test('judicial action policy can be satisfied but does not execute anything', () => {
  const result = evaluateLegalEffect({...base, effect_type:'judicial', judicial:true, external_party:true, approval_required:true, qualified_review_required:true});
  assert.equal(result.allowed, true);
});

test('draft and independent review cannot share a run id', () => {
  const result = validateReviewSeparation({review_status:'verified',draft_run_id:'run-1',review_run_id:'run-1'});
  assert.deepEqual(result, {allowed:false, reason:'draft_review_must_be_independent'});
});

test('verified evidence preserves separate provenance', () => {
  assert.equal(validateReviewSeparation({review_status:'verified',draft_run_id:'draft-1',review_run_id:'review-1'}).allowed, true);
});

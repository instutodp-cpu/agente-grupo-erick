const assert = require('node:assert/strict');

const LEVEL = { L0: 0, L1: 1, L2: 2, L3: 3 };

function classifyAttribution(input) {
  const linked = Boolean(input.identity_link || input.coupon_link || input.identified_whatsapp);
  if (input.sale && linked) return 'direct_attributed';
  if (input.sale && input.marketing_touch) return 'correlated';
  return 'unattributed';
}

function authorize(action, approval) {
  assert.ok(LEVEL[action.permission_level] !== undefined, 'unknown permission level');
  if (LEVEL[action.permission_level] <= LEVEL.L1) return { allowed: true, reason: 'low-risk simulation/read' };
  if (!approval) return { allowed: false, reason: 'approval_required' };
  if (approval.status !== 'approved') return { allowed: false, reason: 'approval_not_approved' };
  if (approval.action_id !== action.action_id) return { allowed: false, reason: 'approval_scope_mismatch' };
  return { allowed: true, reason: 'approved' };
}

function diagnoseFunnel(input) {
  const whatsappRate = input.whatsapp_leads / Math.max(input.views, 1);
  const closeRate = input.sales / Math.max(input.whatsapp_leads, 1);
  return {
    observation: closeRate < 0.05 && whatsappRate > 0
      ? 'downstream_conversion_requires_investigation'
      : 'insufficient_signal',
    causal_claim: false,
    next_checks: ['offer', 'attendance', 'stock', 'price', 'margin']
  };
}

function run() {
  const results = [];

  const funnel = diagnoseFunnel({ views: 40000, whatsapp_leads: 130, sales: 3 });
  assert.equal(funnel.observation, 'downstream_conversion_requires_investigation');
  assert.equal(funnel.causal_claim, false);
  assert.ok(funnel.next_checks.includes('stock'));
  results.push('funnel diagnosis: PASS');

  const attribution = classifyAttribution({
    marketing_touch: true, sale: true, identity_link: false, coupon_link: false, identified_whatsapp: false
  });
  assert.notEqual(attribution, 'direct_attributed');
  results.push('attribution integrity: PASS');

  const budgetAction = { action_id: 'budget-1', permission_level: 'L3' };
  assert.equal(authorize(budgetAction, null).allowed, false);
  assert.equal(authorize(budgetAction, { status: 'approved', action_id: 'other' }).allowed, false);
  assert.equal(authorize(budgetAction, { status: 'approved', action_id: 'budget-1' }).allowed, true);
  results.push('approval gate L3: PASS');

  const publishAction = { action_id: 'publish-1', permission_level: 'L2' };
  assert.equal(authorize(publishAction, null).allowed, false);
  results.push('external publish gate: PASS');

  console.log(results.join('\n'));
  console.log('Marketing E2E simulation: PASS');
}

run();

module.exports = { authorize, classifyAttribution, diagnoseFunnel };

const test = require('node:test');
const assert = require('node:assert/strict');
const { authorize, classifyAttribution, diagnoseFunnel } = require('../scripts/marketing-e2e-sim');

test('L3 action fails closed without approval', () => {
  assert.equal(authorize({ action_id: 'x', permission_level: 'L3' }, null).allowed, false);
});

test('approval cannot be reused for another action', () => {
  const result = authorize(
    { action_id: 'x', permission_level: 'L3' },
    { status: 'approved', action_id: 'y' }
  );
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'approval_scope_mismatch');
});

test('sale without verifiable linkage is not direct attribution', () => {
  assert.notEqual(classifyAttribution({ marketing_touch: true, sale: true }), 'direct_attributed');
});

test('high interest low close rate investigates downstream funnel', () => {
  const result = diagnoseFunnel({ views: 40000, whatsapp_leads: 130, sales: 3 });
  assert.equal(result.observation, 'downstream_conversion_requires_investigation');
  assert.equal(result.causal_claim, false);
});

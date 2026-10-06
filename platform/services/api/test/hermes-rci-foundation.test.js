'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../..');
const registryPath = path.join(root, 'research-improvement/registry.json');
const contractPath = path.join(root, 'platform/docs/HERMES_RESEARCH_CONTINUOUS_IMPROVEMENT_MISSION.md');

test('RCI is a transversal capability, not another agent or orchestrator', () => {
  const r = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  assert.equal(r.kind, 'transversal_capability');
  assert.equal(r.agent, false);
  assert.equal(r.orchestrator, false);
  assert.equal(r.control_plane, 'maestro');
  assert.equal(r.execution_plane, 'hermes');
});

test('RCI remains simulation-first and fail-closed for execution authority', () => {
  const r = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  assert.equal(r.simulation_first, true);
  assert.equal(r.default_execution, 'deny');
  assert.equal(r.merge_authority, false);
  assert.equal(r.human_merge_required, true);
  for (const action of ['merge_main','production_publish','financial_spend_or_mutation','external_customer_message','destructive_action','secret_or_permission_change','authority_expansion']) {
    assert.ok(r.protected_actions.includes(action));
  }
});

test('RCI reuses existing Hermes and Marketing research primitives', () => {
  const r = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  for (const relative of Object.values(r.reuse)) {
    assert.ok(fs.existsSync(path.join(root, relative)), 'missing reuse anchor: ' + relative);
  }
  assert.ok(fs.existsSync(contractPath));
});

test('RCI declares all planned foundation increments without claiming operational status', () => {
  const r = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  assert.equal(r.status, 'foundation');
  assert.deepEqual(r.increments, Array.from({length:13}, (_,i) => 'RCI-' + String(i + 1).padStart(2, '0')));
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-workflow-contracts.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  FORBIDDEN_WORKFLOW_STATUSES,
  WORKFLOW_CONTRACT_VALIDATOR_VERSION,
  WORKFLOW_STATUSES,
  validateWorkflowContract
} = require('../src/core/workflow-contract');
const {
  MAX_PRIORITY,
  WORKFLOW_STEP_CONTRACT_VALIDATOR_VERSION,
  WORKFLOW_STEP_TYPES,
  validateWorkflowStep
} = require('../src/core/workflow-step-contract');
const {
  WORKFLOW_DEPENDENCY_CONTRACT_VALIDATOR_VERSION,
  WORKFLOW_DEPENDENCY_TYPES,
  validateWorkflowDependency
} = require('../src/core/workflow-dependency-contract');
const {
  WORKFLOW_CONDITION_CONTRACT_VALIDATOR_VERSION,
  WORKFLOW_CONDITION_TYPES,
  validateWorkflowCondition
} = require('../src/core/workflow-condition-contract');
const {
  MAX_RETRY_ATTEMPTS,
  WORKFLOW_RETRY_CONTRACT_VALIDATOR_VERSION,
  WORKFLOW_RETRY_TYPES,
  validateWorkflowRetryContract
} = require('../src/core/workflow-retry-contract');
const {
  WORKFLOW_TIMEOUT_CONTRACT_VALIDATOR_VERSION,
  WORKFLOW_TIMEOUT_TYPES,
  validateWorkflowTimeoutContract
} = require('../src/core/workflow-timeout-contract');
const {
  WORKFLOW_COMPENSATION_CONTRACT_VALIDATOR_VERSION,
  WORKFLOW_COMPENSATION_TYPES,
  validateWorkflowCompensationContract
} = require('../src/core/workflow-compensation-contract');
const {
  WORKFLOW_APPROVAL_CONTRACT_VALIDATOR_VERSION,
  WORKFLOW_APPROVAL_TYPES,
  validateWorkflowApprovalContract
} = require('../src/core/workflow-approval-contract');
const {
  DECISION_STATUSES,
  DECISION_VALUES,
  WORKFLOW_DECISION_SAFE_FLAGS,
  buildWorkflowDecision,
  validateWorkflowDecision
} = require('../src/core/workflow-decision');
const { createWorkflowRegistry } = require('../src/core/workflow-registry');
const { buildWorkflowAudit, validateWorkflowAudit } = require('../src/core/workflow-audit');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scenario(id) {
  const found = fixture.scenarios.find((entry) => entry.scenario_id === id);
  return clone(found);
}

test('fixture and docs exist, cover every step/dependency/condition/retry/timeout/compensation/approval type, and every payload is free of operational material', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_WORKFLOW_CONTRACTS.md')), true);
  assert.ok(fixture.scenarios.length >= 15);

  const stepTypesCovered = new Set();
  const dependencyTypesCovered = new Set();
  const conditionTypesCovered = new Set();
  const retryTypesCovered = new Set();
  const timeoutTypesCovered = new Set();
  const compensationTypesCovered = new Set();
  const approvalTypesCovered = new Set();

  for (const s of fixture.scenarios) {
    assert.deepEqual(findAgentCoreOperationalMaterial(s.workflow), [], `scenario ${s.scenario_id}.workflow must be free of operational material`);
    for (const step of s.steps) {
      assert.deepEqual(findAgentCoreOperationalMaterial(step), [], `scenario ${s.scenario_id} step ${step.step_id} must be free of operational material`);
      stepTypesCovered.add(step.step_type);
      for (const dep of step.depends_on) dependencyTypesCovered.add(dep.dependency_type);
      if (step.retry_reference) retryTypesCovered.add(step.retry_reference.retry_type);
      if (step.timeout_reference) timeoutTypesCovered.add(step.timeout_reference.timeout_type);
      if (step.compensation_reference) compensationTypesCovered.add(step.compensation_reference.compensation_type);
    }
    for (const cond of s.workflow.entry_conditions) conditionTypesCovered.add(cond.condition_type);
    for (const cond of s.workflow.exit_conditions) conditionTypesCovered.add(cond.condition_type);
    retryTypesCovered.add(s.workflow.retry_reference.retry_type);
    timeoutTypesCovered.add(s.workflow.timeout_reference.timeout_type);
    compensationTypesCovered.add(s.workflow.compensation_reference.compensation_type);
    approvalTypesCovered.add(s.workflow.approval_policy_reference.approval_type);
  }

  for (const type of WORKFLOW_STEP_TYPES) assert.ok(stepTypesCovered.has(type), `fixture must cover step type ${type}`);
  for (const type of WORKFLOW_DEPENDENCY_TYPES) assert.ok(dependencyTypesCovered.has(type), `fixture must cover dependency type ${type}`);
  for (const type of WORKFLOW_CONDITION_TYPES) assert.ok(conditionTypesCovered.has(type), `fixture must cover condition type ${type}`);
  for (const type of WORKFLOW_RETRY_TYPES) assert.ok(retryTypesCovered.has(type), `fixture must cover retry type ${type}`);
  for (const type of WORKFLOW_TIMEOUT_TYPES) assert.ok(timeoutTypesCovered.has(type), `fixture must cover timeout type ${type}`);
  for (const type of WORKFLOW_COMPENSATION_TYPES) assert.ok(compensationTypesCovered.has(type), `fixture must cover compensation type ${type}`);
  for (const type of WORKFLOW_APPROVAL_TYPES) assert.ok(approvalTypesCovered.has(type), `fixture must cover approval type ${type}`);
});

fixture.scenarios.forEach((s) => {
  test(`fixture scenario ${s.scenario_id} reproduces its expected status and decision`, () => {
    const decision = buildWorkflowDecision({ decisionId: `${s.scenario_id}-decision`, workflow: s.workflow, steps: s.steps });
    assert.equal(decision.status, s.expected_status);
    assert.equal(decision.decision, s.expected_decision);
  });
});

test('workflow contract valid, rejects unknown/forbidden status, exact fields, empty/duplicate step references, and tenant/organization compatibility', () => {
  const workflow = scenario('deterministic-linear-workflow').workflow;
  assert.equal(validateWorkflowContract(workflow).valid, true);
  const missing = clone(workflow);
  delete missing.status;
  assert.ok(validateWorkflowContract(missing).errors.some((e) => e.includes('missing_status')));
  assert.ok(validateWorkflowContract({ ...workflow, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  assert.ok(validateWorkflowContract({ ...workflow, status: 'NOT_A_STATUS' }).errors.some((e) => e.includes('status_not_allowed')));
  for (const forbidden of FORBIDDEN_WORKFLOW_STATUSES) {
    assert.ok(validateWorkflowContract({ ...workflow, status: forbidden }).errors.includes(`status_forbidden::${forbidden}`));
  }
  assert.ok(validateWorkflowContract({ ...workflow, step_references: [] }).errors.includes('step_references_invalid'));
  assert.ok(validateWorkflowContract({ ...workflow, step_references: ['a', 'a'] }).errors.includes('step_references_invalid'));
  assert.ok(validateWorkflowContract({ ...workflow, organization_id: 'other-tenant:org-1' }).errors.includes('organization_id_not_compatible_with_tenant'));
  assert.equal(WORKFLOW_STATUSES.length, 4);
  assert.equal(FORBIDDEN_WORKFLOW_STATUSES.length, 4);
  assert.equal(workflow.validator_version, WORKFLOW_CONTRACT_VALIDATOR_VERSION);
});

test('step contract valid, rejects unknown step type/capability, non-boolean flags, malformed nullable references, and exact fields', () => {
  const step = scenario('deterministic-linear-workflow').steps[1];
  assert.equal(validateWorkflowStep(step).valid, true);
  assert.ok(validateWorkflowStep({ ...step, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  assert.ok(validateWorkflowStep({ ...step, step_type: 'NOT_A_TYPE' }).errors.some((e) => e.includes('step_type_not_allowed')));
  assert.ok(validateWorkflowStep({ ...step, required_capabilities: ['NOT_A_CAPABILITY'] }).errors.includes('required_capabilities_invalid'));
  assert.ok(validateWorkflowStep({ ...step, parallelizable: 'yes' }).errors.includes('parallelizable_must_be_boolean'));
  assert.ok(validateWorkflowStep({ ...step, tool_reference: 'not-an-object' }).errors.some((e) => e.startsWith('tool_reference_')));
  assert.ok(validateWorkflowStep({ ...step, priority: MAX_PRIORITY + 1 }).errors.includes('priority_invalid'));
  assert.ok(validateWorkflowStep({ ...step, estimated_cost_minor_units: -1 }).errors.includes('estimated_cost_minor_units_invalid'));
  assert.equal(validateWorkflowStep({ ...step, model_reference: null, context_reference: null }).valid, true);
  assert.equal(WORKFLOW_STEP_TYPES.length, 9);
  assert.equal(step.validator_version, WORKFLOW_STEP_CONTRACT_VALIDATOR_VERSION);
});

test('dependency contract valid and rejects unknown dependency type', () => {
  const dependency = scenario('deterministic-linear-workflow').steps[1].depends_on[0];
  assert.equal(validateWorkflowDependency(dependency).valid, true);
  assert.ok(validateWorkflowDependency({ ...dependency, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  assert.ok(validateWorkflowDependency({ ...dependency, dependency_type: 'X' }).errors.some((e) => e.includes('dependency_type_not_allowed')));
  assert.equal(WORKFLOW_DEPENDENCY_TYPES.length, 4);
  assert.equal(dependency.validator_version, WORKFLOW_DEPENDENCY_CONTRACT_VALIDATOR_VERSION);
});

test('condition contract valid and rejects unknown condition type', () => {
  const condition = scenario('deterministic-linear-workflow').workflow.entry_conditions[0];
  assert.equal(validateWorkflowCondition(condition).valid, true);
  assert.ok(validateWorkflowCondition({ ...condition, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  assert.ok(validateWorkflowCondition({ ...condition, condition_type: 'X' }).errors.some((e) => e.includes('condition_type_not_allowed')));
  assert.equal(WORKFLOW_CONDITION_TYPES.length, 5);
  assert.equal(condition.validator_version, WORKFLOW_CONDITION_CONTRACT_VALIDATOR_VERSION);
});

test('retry contract valid, rejects unknown retry type, and enforces zero attempts when NONE', () => {
  const retry = scenario('deterministic-linear-workflow').workflow.retry_reference;
  assert.equal(validateWorkflowRetryContract(retry).valid, true);
  assert.ok(validateWorkflowRetryContract({ ...retry, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  assert.ok(validateWorkflowRetryContract({ ...retry, retry_type: 'X' }).errors.some((e) => e.includes('retry_type_not_allowed')));
  assert.ok(validateWorkflowRetryContract({ ...retry, retry_type: 'NONE', maximum_attempts: 5 }).errors.includes('maximum_attempts_must_be_zero_when_retry_type_none'));
  assert.ok(validateWorkflowRetryContract({ ...retry, maximum_attempts: MAX_RETRY_ATTEMPTS + 1 }).errors.includes('maximum_attempts_invalid'));
  assert.equal(WORKFLOW_RETRY_TYPES.length, 4);
  assert.equal(retry.validator_version, WORKFLOW_RETRY_CONTRACT_VALIDATOR_VERSION);
});

test('timeout contract valid and rejects unknown timeout type', () => {
  const timeout = scenario('deterministic-linear-workflow').workflow.timeout_reference;
  assert.equal(validateWorkflowTimeoutContract(timeout).valid, true);
  assert.ok(validateWorkflowTimeoutContract({ ...timeout, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  assert.ok(validateWorkflowTimeoutContract({ ...timeout, timeout_type: 'X' }).errors.some((e) => e.includes('timeout_type_not_allowed')));
  assert.equal(WORKFLOW_TIMEOUT_TYPES.length, 5);
  assert.equal(timeout.validator_version, WORKFLOW_TIMEOUT_CONTRACT_VALIDATOR_VERSION);
});

test('compensation contract valid and rejects unknown compensation type', () => {
  const compensation = scenario('deterministic-linear-workflow').workflow.compensation_reference;
  assert.equal(validateWorkflowCompensationContract(compensation).valid, true);
  assert.ok(validateWorkflowCompensationContract({ ...compensation, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  assert.ok(validateWorkflowCompensationContract({ ...compensation, compensation_type: 'X' }).errors.some((e) => e.includes('compensation_type_not_allowed')));
  assert.equal(WORKFLOW_COMPENSATION_TYPES.length, 4);
  assert.equal(compensation.validator_version, WORKFLOW_COMPENSATION_CONTRACT_VALIDATOR_VERSION);
});

test('approval contract valid and rejects unknown approval type', () => {
  const approval = scenario('deterministic-linear-workflow').workflow.approval_policy_reference;
  assert.equal(validateWorkflowApprovalContract(approval).valid, true);
  assert.ok(validateWorkflowApprovalContract({ ...approval, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  assert.ok(validateWorkflowApprovalContract({ ...approval, approval_type: 'X' }).errors.some((e) => e.includes('approval_type_not_allowed')));
  assert.equal(WORKFLOW_APPROVAL_TYPES.length, 5);
  assert.equal(approval.validator_version, WORKFLOW_APPROVAL_CONTRACT_VALIDATOR_VERSION);
});

test('decision aggregates workflow and steps, forces every safe flag, and degrades cleanly on malformed input', () => {
  const s = scenario('deterministic-linear-workflow');
  const decision = buildWorkflowDecision({ decisionId: 'decision-linear-1', workflow: s.workflow, steps: s.steps });
  assert.equal(validateWorkflowDecision(decision).valid, true);
  assert.equal(decision.status, 'WORKFLOW_REGISTERED_SIMULATION');
  assert.equal(decision.decision, 'REGISTER_WORKFLOW_REFERENCE');
  for (const [field, expected] of Object.entries(WORKFLOW_DECISION_SAFE_FLAGS)) {
    assert.equal(decision[field], expected);
  }
  assert.equal(Object.isFrozen(decision), true);
  assert.throws(() => { decision.status = 'x'; }, TypeError);

  const malformed = buildWorkflowDecision({});
  assert.equal(malformed.status, 'VALIDATION_FAILED');
  assert.equal(malformed.decision, 'BLOCKED');
  assert.equal(validateWorkflowDecision(malformed).valid, true);
  for (const [field, expected] of Object.entries(WORKFLOW_DECISION_SAFE_FLAGS)) {
    assert.equal(malformed[field], expected);
  }
  assert.equal(DECISION_STATUSES.length, 4);
  assert.equal(DECISION_VALUES.includes('BLOCKED'), true);
});

test('duplicate step ids, step_references mismatch, dangling dependency and self-dependency all block registration', () => {
  const s = scenario('deterministic-linear-workflow');

  const dupDecision = buildWorkflowDecision({ decisionId: 'dup-decision', workflow: s.workflow, steps: [s.steps[0], s.steps[0]] });
  assert.equal(dupDecision.status, 'VALIDATION_FAILED');

  const mismatchWorkflow = clone(s.workflow);
  mismatchWorkflow.step_references = [s.steps[0].step_id];
  const mismatchDecision = buildWorkflowDecision({ decisionId: 'mismatch-decision', workflow: mismatchWorkflow, steps: s.steps });
  assert.equal(mismatchDecision.status, 'VALIDATION_FAILED');

  const danglingStep = clone(s.steps[1]);
  danglingStep.depends_on = [{
    dependency_id: 'dangling-dep', dependency_type: 'AFTER_SUCCESS_REFERENCE', depends_on_step_id: 'unknown-step',
    simulation: true, production_blocked: true, validator_version: WORKFLOW_DEPENDENCY_CONTRACT_VALIDATOR_VERSION
  }];
  const danglingDecision = buildWorkflowDecision({ decisionId: 'dangling-decision', workflow: s.workflow, steps: [s.steps[0], danglingStep] });
  assert.equal(danglingDecision.status, 'VALIDATION_FAILED');

  const selfStep = clone(s.steps[0]);
  selfStep.depends_on = [{
    dependency_id: 'self-dep', dependency_type: 'AFTER_SUCCESS_REFERENCE', depends_on_step_id: selfStep.step_id,
    simulation: true, production_blocked: true, validator_version: WORKFLOW_DEPENDENCY_CONTRACT_VALIDATOR_VERSION
  }];
  const selfWorkflow = clone(s.workflow);
  selfWorkflow.step_references = [selfStep.step_id];
  const selfDecision = buildWorkflowDecision({ decisionId: 'self-decision', workflow: selfWorkflow, steps: [selfStep] });
  assert.equal(selfDecision.status, 'VALIDATION_FAILED');
});

test('tenant mismatch and organization mismatch between workflow and its embedded references block registration with the correct status', () => {
  const tenantMismatch = scenario('tenant-mismatch-workflow');
  const tenantDecision = buildWorkflowDecision({ decisionId: 'tenant-mismatch-decision', workflow: tenantMismatch.workflow, steps: tenantMismatch.steps });
  assert.equal(tenantDecision.status, 'TENANT_BLOCKED');
  assert.equal(tenantDecision.decision, 'BLOCKED');

  const orgMismatch = scenario('organization-mismatch-workflow');
  const orgDecision = buildWorkflowDecision({ decisionId: 'org-mismatch-decision', workflow: orgMismatch.workflow, steps: orgMismatch.steps });
  assert.equal(orgDecision.status, 'ORGANIZATION_BLOCKED');
  assert.equal(orgDecision.decision, 'BLOCKED');
});

test('registry validates by construction, protects against replay, payload mismatch, optimistic concurrency, organization rebinding, and lists safely', () => {
  const registry = createWorkflowRegistry();
  const workflow = scenario('deterministic-linear-workflow').workflow;

  const first = registry.registerWorkflow(workflow, { expected_version: 0 });
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  assert.equal(first.simulation, true);
  assert.equal(first.production_blocked, true);
  assert.equal(first.workflow_executed, false);

  assert.equal(registry.registerWorkflow(workflow).status, 'REPLAY_ACCEPTED');

  const mismatch = { ...workflow, display_name: 'Changed Display Name' };
  assert.equal(registry.registerWorkflow(mismatch).status, 'PAYLOAD_MISMATCH');

  const bumped = { ...workflow, display_name: 'Changed Display Name', workflow_version: workflow.workflow_version + 1 };
  assert.equal(registry.registerWorkflow(bumped).status, 'REGISTERED_SIMULATION');

  const versionConflict = registry.registerWorkflow(
    { ...workflow, display_name: 'Changed Again', workflow_version: workflow.workflow_version + 2 },
    { expected_version: 999 }
  );
  assert.equal(versionConflict.status, 'VERSION_CONFLICT');

  const orgRebind = registry.registerWorkflow({ ...workflow, organization_id: `${workflow.tenant_id}:org-different`, workflow_version: workflow.workflow_version + 2 });
  assert.equal(orgRebind.status, 'ORGANIZATION_BLOCKED');

  const tenantRebind = registry.registerWorkflow({ ...workflow, tenant_id: 'tenant-different', organization_id: 'tenant-different:org-1', workflow_version: workflow.workflow_version + 2 });
  assert.equal(tenantRebind.status, 'TENANT_BLOCKED');

  const fetched = registry.getWorkflowById(workflow.workflow_id);
  assert.equal(Object.isFrozen(fetched), true);
  assert.throws(() => { fetched.display_name = 'x'; }, TypeError);
  assert.equal(registry.getWorkflowById('unknown-workflow-id'), null);

  const other = scenario('parallel-fanout-workflow').workflow;
  registry.registerWorkflow(other, { expected_version: 0 });
  assert.equal(registry.listWorkflowsByTenant(workflow.tenant_id).length, 2);
  assert.equal(registry.listWorkflowsByOrganization(workflow.organization_id).length, 2);
  assert.equal(registry.listWorkflowsByTenant('tenant-unused').length, 0);

  const invalid = registry.registerWorkflow({ bogus: true });
  assert.equal(invalid.status, 'VALIDATION_FAILED');

  const s = scenario('deterministic-linear-workflow');
  for (const step of s.steps) {
    assert.equal(registry.registerStep(step, { expected_version: 0 }).status, 'REGISTERED_SIMULATION');
  }
  const decision = buildWorkflowDecision({ decisionId: 'registry-decision-1', workflow: s.workflow, steps: s.steps });
  assert.equal(registry.registerDecision(decision, { expected_version: 0 }).status, 'REGISTERED_SIMULATION');
  assert.equal(registry.registerDecision(decision).status, 'REPLAY_ACCEPTED');
});

test('registry rejects duplicate ids with conflicting payloads and duplicate fingerprints replay identically', () => {
  const registry = createWorkflowRegistry();
  const workflow = scenario('deterministic-linear-workflow').workflow;
  registry.registerWorkflow(workflow, { expected_version: 0 });
  const duplicateIdDifferentPayload = registry.registerWorkflow({ ...workflow, description: 'A different description entirely.' });
  assert.equal(duplicateIdDifferentPayload.status, 'PAYLOAD_MISMATCH');
  const duplicateFingerprint = registry.registerWorkflow({ ...workflow });
  assert.equal(duplicateFingerprint.status, 'REPLAY_ACCEPTED');
});

test('audit is immutable, structurally minimal, records only fingerprints/bindings/decision/reason codes, and never marks anything executed', () => {
  const s = scenario('deterministic-linear-workflow');
  const decision = buildWorkflowDecision({ decisionId: 'audit-decision-1', workflow: s.workflow, steps: s.steps });
  const audit = buildWorkflowAudit({ decision });
  assert.equal(validateWorkflowAudit(audit).valid, true);
  assert.equal(audit.simulation, true);
  assert.equal(audit.production_blocked, true);
  assert.equal(audit.executed, false);
  assert.equal(Object.isFrozen(audit), true);
  assert.throws(() => { audit.reason_codes.push('x'); }, TypeError);
  assert.deepEqual(Object.keys(audit).sort(), [
    'audit_id', 'decision', 'executed', 'organization_binding', 'production_blocked', 'reason_codes', 'simulation',
    'step_fingerprints', 'tenant_binding', 'validator_version', 'workflow_fingerprint', 'workflow_id'
  ].sort());

  const blockedDecision = buildWorkflowDecision({
    decisionId: 'audit-decision-blocked',
    workflow: scenario('tenant-mismatch-workflow').workflow,
    steps: scenario('tenant-mismatch-workflow').steps
  });
  const blockedAudit = buildWorkflowAudit({ decision: blockedDecision });
  assert.equal(validateWorkflowAudit(blockedAudit).valid, true);
  assert.equal(blockedAudit.decision, 'TENANT_BLOCKED');
  assert.ok(blockedAudit.reason_codes.length > 0);
});

test('fingerprints are deterministic and change when the underlying workflow or step payload changes', () => {
  const a = stablePayload({ b: 1, a: 2 });
  const b = stablePayload({ a: 2, b: 1 });
  assert.equal(a, b);

  const s = scenario('deterministic-linear-workflow');
  const decision1 = buildWorkflowDecision({ decisionId: 'fp-decision-1', workflow: s.workflow, steps: s.steps });
  const decision2 = buildWorkflowDecision({ decisionId: 'fp-decision-1', workflow: clone(s.workflow), steps: clone(s.steps) });
  assert.equal(decision1.workflow_fingerprint, decision2.workflow_fingerprint);
  assert.deepEqual(decision1.step_fingerprints, decision2.step_fingerprints);

  const changed = clone(s.workflow);
  changed.display_name = 'A Renamed Workflow';
  const decision3 = buildWorkflowDecision({ decisionId: 'fp-decision-1', workflow: changed, steps: s.steps });
  assert.notEqual(decision1.workflow_fingerprint, decision3.workflow_fingerprint);
});

test('input is never mutated by decision construction', () => {
  const s = scenario('deterministic-linear-workflow');
  const before = JSON.stringify({ workflow: s.workflow, steps: s.steps });
  buildWorkflowDecision({ decisionId: 'no-mutate-decision', workflow: s.workflow, steps: s.steps });
  assert.equal(JSON.stringify({ workflow: s.workflow, steps: s.steps }), before);
});

[
  ['api key', { api_key: 'x' }, 'forbidden_key'],
  ['secret value', { secret_value: 'x' }, 'forbidden_key'],
  ['endpoint key', { endpoint_reference: 'x' }, 'forbidden_key'],
  ['url value', { note: 'https://blocked.invalid' }, 'operational_url_value'],
  ['prompt word', { note: 'do not store the system_prompt text' }, 'forbidden_word_value'],
  ['callback word', { note: 'invokes a callback handler' }, 'forbidden_word_value'],
  ['handler word', { note: 'a handler for this event' }, 'forbidden_word_value'],
  ['execute word', { note: 'do not execute this reference' }, 'forbidden_word_value'],
  ['function value', { note: () => null }, 'forbidden_function']
].forEach(([name, value, reasonPrefix]) => {
  test(`operational material detector blocks ${name} in workflow contract payloads`, () => {
    const found = findAgentCoreOperationalMaterial(value);
    assert.ok(found.some((entry) => entry.startsWith(reasonPrefix)), found.join(','));
  });
});

test('operational material detector avoids false positives on legitimate workflow field names', () => {
  const s = scenario('full-lifecycle-workflow');
  assert.deepEqual(findAgentCoreOperationalMaterial(s.workflow), []);
  for (const step of s.steps) {
    assert.deepEqual(findAgentCoreOperationalMaterial(step), []);
  }
});

test('operational material detector rejects NaN Infinity bigint symbol and cyclic reference', () => {
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.NaN }).some((e) => e.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.POSITIVE_INFINITY }).some((e) => e.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: BigInt(1) }).some((e) => e.includes('forbidden_bigint')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Symbol('x') }).some((e) => e.includes('forbidden_symbol')));
  const cyclic = {};
  cyclic.self = cyclic;
  assert.ok(findAgentCoreOperationalMaterial(cyclic).some((e) => e.includes('forbidden_cycle')));
});

test('regression workflow contract modules do not use network filesystem eval dynamic import or timers', () => {
  const files = [
    'services/api/src/core/workflow-contract.js',
    'services/api/src/core/workflow-step-contract.js',
    'services/api/src/core/workflow-dependency-contract.js',
    'services/api/src/core/workflow-condition-contract.js',
    'services/api/src/core/workflow-timeout-contract.js',
    'services/api/src/core/workflow-retry-contract.js',
    'services/api/src/core/workflow-compensation-contract.js',
    'services/api/src/core/workflow-approval-contract.js',
    'services/api/src/core/workflow-decision.js',
    'services/api/src/core/workflow-registry.js',
    'services/api/src/core/workflow-audit.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:(http|https|net|tls|dns|dgram|fs|child_process|worker_threads|vm)['"]\)/.test(source), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(source.includes('Date.now()'), false);
    assert.equal(/\bnew Date\(\)/.test(source), false);
    assert.equal(/setTimeout|setInterval/.test(source), false);
    assert.equal(/\beval\(/.test(source), false);
    assert.equal(/\bnew Function\(/.test(source), false);
    assert.equal(/\bimport\(/.test(source), false);
    assert.equal(/openai|anthropic|@anthropic-ai|ollama|openrouter|groq|together\.ai|huggingface/i.test(source), false);
  }
});

test('regression workflow contracts are not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('workflow-contract'), false);
    assert.equal(source.includes('workflow-registry'), false);
  }
});

test('regression PRs 79 through 88 remain untouched by this PR', () => {
  const files = [
    'services/api/src/core/agent-core-contract.js',
    'services/api/src/core/agent-registry.js',
    'services/api/src/core/agent-policy-boundary.js',
    'services/api/src/core/agent-session-boundary.js',
    'services/api/src/core/agent-memory-contract.js',
    'services/api/src/core/model-provider-contract.js',
    'services/api/src/core/model-provider-decision.js',
    'services/api/src/core/model-provider-registry.js',
    'services/api/src/core/model-selection-engine.js',
    'services/api/src/core/model-selection-registry.js',
    'services/api/src/core/transcription-runtime-registration-boundary.js',
    'services/api/src/core/transcription-network-permission-boundary.js',
    'services/api/src/core/context-assembly-engine.js',
    'services/api/src/core/context-assembly-registry.js',
    'services/api/src/core/tool-contract.js',
    'services/api/src/core/tool-decision.js',
    'services/api/src/core/tool-registry.js'
  ].map((file) => path.join(repoRoot, file));
  const workflowModules = [
    'workflow-contract', 'workflow-step-contract', 'workflow-dependency-contract', 'workflow-condition-contract',
    'workflow-timeout-contract', 'workflow-retry-contract', 'workflow-compensation-contract',
    'workflow-approval-contract', 'workflow-decision', 'workflow-registry', 'workflow-audit'
  ];
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    for (const moduleName of workflowModules) {
      assert.equal(source.includes(moduleName), false);
    }
  }
});

test('regression context assembly engine, tool contracts, and transcription boundaries remain functionally independent from workflow contracts', () => {
  const files = [
    'services/api/src/core/context-assembly-engine.js',
    'services/api/src/core/tool-decision.js',
    'services/api/src/core/transcription-network-permission-boundary.js',
    'services/api/src/core/transcription-secret-resolution-boundary.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('workflow-contract'), false);
    assert.equal(source.includes('workflow-registry'), false);
  }
});

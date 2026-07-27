'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-validation-semantics-architecture-gates.json');
const { findAgentCoreOperationalMaterial } = require('../src/core/agent-identity-contract');
const {
  ALLOWED_TRANSITIONS, DEFAULT_VALIDATION_STATE, VALIDATION_STATES, isAllowedTransition, isValidationState
} = require('../src/core/validation-state');
const {
  VALIDATION_OUTCOME_FIELDS, VALIDATION_SEVERITIES, VALIDATION_STAGES, buildValidationOutcome,
  defaultStatusFor, validateValidationOutcome
} = require('../src/core/validation-outcome');
const {
  VALIDATION_LEDGER_FIELDS, NULLABLE_REFERENCE_FIELDS, buildValidationLedger, validateValidationLedger
} = require('../src/core/validation-ledger');
const {
  TAXONOMY_STATUSES, PRECEDENCE_ORDER, LEGACY_STATUS_ALIASES, getPrecedenceIndex, getTaxonomyMetadata,
  isTaxonomyStatus, resolveStatusAlias
} = require('../src/core/validation-taxonomy');
const {
  UNKNOWN_STATUS_BLOCKED, mapTaxonomyStatusToContractStatus, mapTaxonomyStatusToResultStatus, describeStatusMapping
} = require('../src/core/validation-status-mapper');
const {
  buildValidationRegistry, createValidationRegistryBuilder, isPureFunction, sortDefinitions, validateDefinitions
} = require('../src/core/validation-registry');
const {
  adaptLegacyValidatorOutput, deriveValidationLedgerFromStatus, invokeValidatorHandler, isStageValid,
  outcomeStateForStage, runValidationPipeline
} = require('../src/core/validation-pipeline');
const { executionPlanValidationRegistry } = require('../src/core/execution-plan-validation-registry');
const { evaluateExecutionPlanRequest } = require('../src/core/execution-plan-engine');

const repoRoot = path.resolve(__dirname, '../../..');

function buildOutcome(input) {
  return buildValidationOutcome(input);
}

// ---------------------------------------------------------------------------
// Fixture sanity
// ---------------------------------------------------------------------------

test('fixture exists and is free of operational material', () => {
  assert.deepEqual(findAgentCoreOperationalMaterial(fixture), []);
});

// ---------------------------------------------------------------------------
// ValidationState
// ---------------------------------------------------------------------------

test('ValidationState: 4 states, NOT_EVALUATED default, only forward transitions allowed', () => {
  assert.deepEqual(VALIDATION_STATES, ['NOT_EVALUATED', 'VALID', 'INVALID', 'NOT_APPLICABLE']);
  assert.equal(DEFAULT_VALIDATION_STATE, 'NOT_EVALUATED');
  assert.equal(isValidationState('VALID'), true);
  assert.equal(isValidationState('NONSENSE'), false);
  for (const target of ['VALID', 'INVALID', 'NOT_APPLICABLE']) {
    assert.equal(isAllowedTransition('NOT_EVALUATED', target), true);
  }
  assert.equal(isAllowedTransition('VALID', 'INVALID'), false);
  assert.equal(isAllowedTransition('INVALID', 'VALID'), false);
  assert.equal(isAllowedTransition('NOT_APPLICABLE', 'VALID'), false);
  assert.deepEqual(Object.keys(ALLOWED_TRANSITIONS).sort(), [...VALIDATION_STATES].sort());
});

// ---------------------------------------------------------------------------
// ValidationOutcome
// ---------------------------------------------------------------------------

test('ValidationOutcome: exact fields (17), 22 canonical stages, 4 severities', () => {
  assert.equal(VALIDATION_OUTCOME_FIELDS.length, 17);
  assert.equal(VALIDATION_STAGES.length, 22);
  assert.deepEqual(VALIDATION_SEVERITIES, ['INFO', 'WARNING', 'ERROR', 'CRITICAL']);
});

Object.entries(fixture.outcome_scenarios).forEach(([key, scenario]) => {
  test(`ValidationOutcome scenario ${key} reproduces its recorded derived fields`, () => {
    const outcome = buildValidationOutcome(scenario.input);
    assert.equal(outcome.state, scenario.expected.state);
    assert.equal(outcome.status, scenario.expected.status);
    assert.equal(outcome.severity, scenario.expected.severity);
    assert.equal(outcome.evaluated, scenario.expected.evaluated);
    assert.equal(outcome.applicable, scenario.expected.applicable);
    assert.equal(outcome.blocking, scenario.expected.blocking);
    assert.equal(outcome.terminal, scenario.expected.terminal);
    assert.equal(validateValidationOutcome(outcome).valid, true);
  });
});

test('ValidationOutcome: default status sentinel is `${stage}_${state}` when caller supplies none', () => {
  const outcome = buildValidationOutcome({
    validator_id: 'x', validator_version: 'v1', validation_stage: 'TENANT', state: 'VALID', logical_sequence: 0
  });
  assert.equal(outcome.status, defaultStatusFor('TENANT', 'VALID'));
  assert.equal(outcome.status, 'TENANT_VALID');
});

test('ValidationOutcome: blocking requires state INVALID, terminal requires blocking (construction-time, not just validation-time)', () => {
  const notBlocking = buildValidationOutcome({
    validator_id: 'x', validator_version: 'v1', validation_stage: 'TENANT', state: 'VALID',
    blocking: true, terminal: true, logical_sequence: 0
  });
  assert.equal(notBlocking.blocking, false, 'VALID state can never be blocking regardless of caller input');
  assert.equal(notBlocking.terminal, false);

  const blockingNotTerminal = buildValidationOutcome({
    validator_id: 'x', validator_version: 'v1', validation_stage: 'TENANT', state: 'INVALID',
    status: 'TENANT_BLOCKED', blocking: true, logical_sequence: 0
  });
  assert.equal(blockingNotTerminal.blocking, true);
  assert.equal(blockingNotTerminal.terminal, false, 'terminal defaults false even when blocking is true');
});

test('ValidationOutcome: tamper detection on output_fingerprint', () => {
  const outcome = buildValidationOutcome({
    validator_id: 'x', validator_version: 'v1', validation_stage: 'SCHEMA', state: 'VALID', logical_sequence: 0
  });
  const tampered = { ...outcome, output_fingerprint: 'sha256:tampered' };
  const validation = validateValidationOutcome(tampered);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes('output_fingerprint_mismatch'), true);
});

test('ValidationOutcome: unknown validation_stage and state are rejected', () => {
  assert.throws(() => buildValidationOutcome({
    validator_id: 'x', validator_version: 'v1', validation_stage: 'NOT_A_REAL_STAGE', state: 'VALID', logical_sequence: 0
  }));
});

test('ValidationOutcome: operational material detector blocks a secret embedded in reason_codes', () => {
  assert.throws(() => buildValidationOutcome({
    validator_id: 'x', validator_version: 'v1', validation_stage: 'SCHEMA', state: 'INVALID', status: 'VALIDATION_FAILED',
    reason_codes: ['api_key=sk-live-1234567890'], blocking: true, logical_sequence: 0
  }));
});

// ---------------------------------------------------------------------------
// ValidationLedger
// ---------------------------------------------------------------------------

test('ValidationLedger: exact fields (29), execution_plan_request_id/execution_plan_id/first_blocking_* are nullable', () => {
  assert.equal(VALIDATION_LEDGER_FIELDS.length, 29);
  assert.deepEqual(NULLABLE_REFERENCE_FIELDS.slice().sort(), [
    'execution_plan_id', 'execution_plan_request_id', 'first_blocking_stage', 'first_blocking_status'
  ].sort());
});

Object.entries(fixture.ledger_scenarios).forEach(([key, scenario]) => {
  test(`ValidationLedger scenario ${key} reproduces its recorded counts and blocker`, () => {
    const outcomes = scenario.outcomeInputs.map((input) => buildValidationOutcome(input));
    const ledger = buildValidationLedger({ ...scenario.ledgerIdentity, validation_outcomes: outcomes });
    for (const [field, expected] of Object.entries(scenario.expected)) {
      assert.equal(ledger[field], expected, `${key}: ${field}`);
    }
    assert.equal(validateValidationLedger(ledger).valid, true);
  });
});

test('ValidationLedger: a duplicate validation_outcome_id is rejected', () => {
  const outcomeA = buildValidationOutcome({ validator_id: 'dup', validator_version: 'v1', validation_stage: 'SCHEMA', state: 'VALID', logical_sequence: 0 });
  const outcomeB = buildValidationOutcome({ validator_id: 'dup', validator_version: 'v1', validation_stage: 'SCHEMA', state: 'VALID', logical_sequence: 1 });
  assert.throws(() => buildValidationLedger({
    validation_ledger_id: 'vl-dup', tenant_id: 't', organization_id: 'o', project_id: 'p',
    session_reference_id: 's', agent_id: 'a', actor_id: 'ac', validation_outcomes: [outcomeA, outcomeB]
  }));
});

test('ValidationLedger: an outcome after the first blocker that is not NOT_EVALUATED is rejected', () => {
  const blocker = buildValidationOutcome({
    validator_id: 'blocker', validator_version: 'v1', validation_stage: 'TENANT', state: 'INVALID',
    status: 'TENANT_BLOCKED', blocking: true, terminal: true, logical_sequence: 0
  });
  const impossibleLaterValid = buildValidationOutcome({
    validator_id: 'later', validator_version: 'v1', validation_stage: 'ORGANIZATION', state: 'VALID', logical_sequence: 1
  });
  const ledger = {
    validation_ledger_id: 'vl-bad', validation_ledger_version: 1, execution_plan_request_id: null, execution_plan_id: null,
    tenant_id: 't', organization_id: 'o', project_id: 'p', session_reference_id: 's', agent_id: 'a', actor_id: 'ac',
    validation_outcome_ids: [`${blocker.validation_stage}::${blocker.validator_id}`, `${impossibleLaterValid.validation_stage}::${impossibleLaterValid.validator_id}`],
    validation_outcomes: [blocker, impossibleLaterValid], validation_outcome_count: 2, evaluated_count: 2, valid_count: 1,
    invalid_count: 1, not_applicable_count: 0, not_evaluated_count: 0, blocking_count: 1, terminal_count: 1,
    first_blocking_stage: 'TENANT', first_blocking_status: 'TENANT_BLOCKED', pipeline_completed: true,
    all_required_validations_valid: false, ledger_fingerprint: 'sha256:placeholder', logical_sequence: 0,
    simulation: true, production_blocked: true, validator_version: 'validation_ledger_validator_v1'
  };
  const validation = validateValidationLedger(ledger);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes('outcome_after_blocker_must_remain_not_evaluated'), true);
});

// ---------------------------------------------------------------------------
// ValidationTaxonomy
// ---------------------------------------------------------------------------

test('ValidationTaxonomy: 24 statuses, precedence covers every status exactly once, metadata complete', () => {
  assert.equal(TAXONOMY_STATUSES.length, 24);
  assert.equal(PRECEDENCE_ORDER.length, 24);
  assert.deepEqual([...PRECEDENCE_ORDER].sort(), [...TAXONOMY_STATUSES].sort());
  for (const status of TAXONOMY_STATUSES) {
    const meta = getTaxonomyMetadata(status);
    assert.ok(meta, `${status} must have metadata`);
    assert.equal(typeof meta.stage, 'string');
    assert.equal(VALIDATION_STAGES.includes(meta.stage), true, `${status} metadata.stage must be a real ValidationStage`);
    assert.equal(VALIDATION_SEVERITIES.includes(meta.severity), true);
    assert.equal(typeof meta.blocking, 'boolean');
    assert.equal(getPrecedenceIndex(status) >= 0, true);
  }
  assert.equal(isTaxonomyStatus('NOT_A_REAL_STATUS'), false);
  assert.equal(getTaxonomyMetadata('NOT_A_REAL_STATUS'), null);
});

test('ValidationTaxonomy: LEGACY_STATUS_ALIASES is honest -- empty unless a real rename has happened', () => {
  assert.deepEqual(LEGACY_STATUS_ALIASES, {});
  assert.equal(resolveStatusAlias('BUDGET_BLOCKED'), 'BUDGET_BLOCKED', 'a status with no alias resolves to itself');
});

// ---------------------------------------------------------------------------
// ValidationStatusMapper
// ---------------------------------------------------------------------------

test('ValidationStatusMapper: every taxonomy status maps to itself in both directions against the real contract/result enums (no override active yet)', () => {
  const { EXECUTION_PLAN_STATUSES } = require('../src/core/execution-plan-contract');
  const { RESULT_STATUSES } = require('../src/core/execution-plan-result');
  for (const status of TAXONOMY_STATUSES) {
    assert.equal(mapTaxonomyStatusToContractStatus(status, EXECUTION_PLAN_STATUSES), status);
    assert.equal(mapTaxonomyStatusToResultStatus(status, RESULT_STATUSES), status);
  }
});

test('ValidationStatusMapper: an unrecognized status maps to UNKNOWN_STATUS_BLOCKED when the target enum has it, else fails closed to VALIDATION_FAILED', () => {
  const { AUTHORIZATION_STATUSES } = require('../src/core/execution-authorization-decision');
  const { EXECUTION_PLAN_STATUSES } = require('../src/core/execution-plan-contract');
  assert.equal(AUTHORIZATION_STATUSES.includes(UNKNOWN_STATUS_BLOCKED), true);
  assert.equal(mapTaxonomyStatusToContractStatus('NOT_A_REAL_STATUS', AUTHORIZATION_STATUSES), UNKNOWN_STATUS_BLOCKED);
  assert.equal(EXECUTION_PLAN_STATUSES.includes(UNKNOWN_STATUS_BLOCKED), false);
  assert.equal(mapTaxonomyStatusToContractStatus('NOT_A_REAL_STATUS', EXECUTION_PLAN_STATUSES), 'VALIDATION_FAILED');
  const description = describeStatusMapping('BUDGET_BLOCKED', EXECUTION_PLAN_STATUSES, EXECUTION_PLAN_STATUSES);
  assert.equal(description.taxonomyStatus, 'BUDGET_BLOCKED');
  assert.equal(description.isIdentityToContract, true);
});

// ---------------------------------------------------------------------------
// ValidationRegistry
// ---------------------------------------------------------------------------

test('ValidationRegistry: builds, sorts by canonical stage order then priority then id, rejects duplicates/unknown stage/async handlers', () => {
  const registry = buildValidationRegistry([
    { validator_id: 'b_validator', stage: 'BUDGET', priority: 0, required: true, applicable: () => true, handler: () => ({ valid: true, errors: [] }), version: 'v1' },
    { validator_id: 'a_validator', stage: 'SCHEMA', priority: 0, required: true, applicable: () => true, handler: () => ({ valid: true, errors: [] }), version: 'v1' }
  ]);
  const schemaValidators = registry.getValidatorsForStage('SCHEMA');
  const budgetValidators = registry.getValidatorsForStage('BUDGET');
  assert.equal(schemaValidators.length, 1);
  assert.equal(schemaValidators[0].validator_id, 'a_validator');
  assert.equal(budgetValidators.length, 1);
  assert.equal(registry.getValidatorsForStage('AUTHORIZATION').length, 0);

  assert.throws(() => buildValidationRegistry([
    { validator_id: 'dup', stage: 'SCHEMA', priority: 0, required: true, applicable: () => true, handler: () => null, version: 'v1' },
    { validator_id: 'dup', stage: 'SCHEMA', priority: 1, required: true, applicable: () => true, handler: () => null, version: 'v1' }
  ]), /duplicate/);

  assert.throws(() => buildValidationRegistry([
    { validator_id: 'unknown_stage', stage: 'NOT_A_REAL_STAGE', priority: 0, required: true, applicable: () => true, handler: () => null, version: 'v1' }
  ]), /unknown_validation_stage/);

  assert.throws(() => buildValidationRegistry([
    { validator_id: 'async_handler', stage: 'SCHEMA', priority: 0, required: true, applicable: () => true, handler: async () => null, version: 'v1' }
  ]));

  assert.equal(isPureFunction(() => true), true);
  assert.equal(isPureFunction(async () => true), false);
  assert.equal(isPureFunction(function* generator() { yield 1; }), false);
});

test('ValidationRegistry: createValidationRegistryBuilder accumulates until build()', () => {
  const builder = createValidationRegistryBuilder();
  builder
    .register({ validator_id: 'x', stage: 'SCHEMA', priority: 0, required: true, applicable: () => true, handler: () => null, version: 'v1' })
    .register({ validator_id: 'y', stage: 'TENANT', priority: 0, required: true, applicable: () => true, handler: () => null, version: 'v1' });
  const registry = builder.build();
  assert.equal(registry.getValidatorsForStage('SCHEMA').length, 1);
  assert.equal(registry.getValidatorsForStage('TENANT').length, 1);
});

// ---------------------------------------------------------------------------
// ValidationPipeline: legacy adapters
// ---------------------------------------------------------------------------

test('ValidationPipeline: adaptLegacyValidatorOutput normalizes every legacy validator shape, fail-closed on the unknown one', () => {
  assert.deepEqual(adaptLegacyValidatorOutput(null, { wasCalled: true }), { valid: true, reasonCodes: [], status: null });
  assert.deepEqual(adaptLegacyValidatorOutput(null, { wasCalled: false }), { valid: false, reasonCodes: ['legacy_adapter_validator_not_called'], status: 'VALIDATION_FAILED' });
  assert.deepEqual(adaptLegacyValidatorOutput({ valid: true, errors: [] }), { valid: true, reasonCodes: [], status: null });
  assert.deepEqual(adaptLegacyValidatorOutput({ valid: false, errors: ['bad_field'] }), { valid: false, reasonCodes: ['bad_field'], status: 'VALIDATION_FAILED' });
  assert.deepEqual(adaptLegacyValidatorOutput({ status: 'BUDGET_BLOCKED', reason: 'over_budget' }), { valid: false, reasonCodes: ['over_budget'], status: 'BUDGET_BLOCKED' });
  const unknown = adaptLegacyValidatorOutput({ something_else: true });
  assert.equal(unknown.valid, false);
  assert.equal(unknown.status, 'VALIDATION_FAILED');
  assert.equal(unknown.reasonCodes.includes('legacy_adapter_unknown_validator_output'), true);
});

test('ValidationPipeline: invokeValidatorHandler never throws, converts an exception into a sanitized failure', () => {
  const result = invokeValidatorHandler(() => { throw new Error('boom with a secret token inside'); }, {});
  assert.equal(result.valid, false);
  assert.equal(result.status, 'VALIDATION_FAILED');
  assert.equal(result.reasonCodes.includes('legacy_adapter_validator_exception'), true);
  assert.equal(JSON.stringify(result).includes('secret'), false, 'the raw exception message must never leak into the sanitized result');
});

test('ValidationPipeline: runValidationPipeline stops at the first required blocker and marks every later stage NOT_EVALUATED', () => {
  const registry = buildValidationRegistry([
    { validator_id: 'schema_ok', stage: 'SCHEMA', priority: 0, required: true, applicable: () => true, handler: () => ({ valid: true, errors: [] }), version: 'v1' },
    { validator_id: 'tenant_blocked', stage: 'TENANT', priority: 0, required: true, applicable: () => true, handler: () => ({ status: 'TENANT_BLOCKED', reason: 'tenant_mismatch' }), version: 'v1' },
    { validator_id: 'budget_never_reached', stage: 'BUDGET', priority: 0, required: true, applicable: () => true, handler: () => ({ valid: true, errors: [] }), version: 'v1' }
  ]);
  const ledger = runValidationPipeline(registry, {}, {
    ledgerIdentity: {
      validation_ledger_id: 'vl-pipeline-1', tenant_id: 't', organization_id: 'o', project_id: 'p',
      session_reference_id: 's', agent_id: 'a', actor_id: 'ac'
    }
  });
  assert.equal(outcomeStateForStage(ledger, 'SCHEMA'), 'VALID');
  assert.equal(outcomeStateForStage(ledger, 'TENANT'), 'INVALID');
  assert.equal(outcomeStateForStage(ledger, 'BUDGET'), 'NOT_EVALUATED');
  assert.equal(isStageValid(ledger, 'SCHEMA'), true);
  assert.equal(isStageValid(ledger, 'BUDGET'), false);
  assert.equal(ledger.first_blocking_stage, 'TENANT');
  assert.equal(ledger.pipeline_completed, false);
});

test('ValidationPipeline: runValidationPipeline marks a non-applicable validator NOT_APPLICABLE, never VALID or NOT_EVALUATED', () => {
  const registry = buildValidationRegistry([
    { validator_id: 'model_only_when_present', stage: 'STAGE_MANIFEST', priority: 0, required: true, applicable: () => false, handler: () => ({ valid: true, errors: [] }), version: 'v1' }
  ]);
  const ledger = runValidationPipeline(registry, {}, {
    ledgerIdentity: {
      validation_ledger_id: 'vl-pipeline-2', tenant_id: 't', organization_id: 'o', project_id: 'p',
      session_reference_id: 's', agent_id: 'a', actor_id: 'ac'
    }
  });
  assert.equal(outcomeStateForStage(ledger, 'STAGE_MANIFEST'), 'NOT_APPLICABLE');
});

Object.entries(fixture.derive_from_status_scenarios).forEach(([status, scenario]) => {
  test(`ValidationPipeline: deriveValidationLedgerFromStatus(${status}) reproduces its recorded ledger shape`, () => {
    const ledger = deriveValidationLedgerFromStatus({
      status, reasonCodes: ['fixture_reason'],
      ledgerIdentity: {
        validation_ledger_id: 'vl-derive-1', tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1',
        project_id: 'proj-1', session_reference_id: 'session-1', agent_id: 'agent-1', actor_id: 'actor-1'
      }
    });
    for (const [field, expected] of Object.entries(scenario.expected)) {
      assert.equal(ledger[field], expected, `${status}: ${field}`);
    }
    assert.equal(validateValidationLedger(ledger).valid, true);
  });
});

test('ValidationPipeline: deriveValidationLedgerFromStatus never confuses AUTHORIZATION with AUTHORIZATION_PROVENANCE/AUTHORIZATION_SCOPE', () => {
  const ledger = deriveValidationLedgerFromStatus({
    status: 'BUDGET_BLOCKED', reasonCodes: [],
    ledgerIdentity: {
      validation_ledger_id: 'vl-derive-authz', tenant_id: 't', organization_id: 'o', project_id: 'p',
      session_reference_id: 's', agent_id: 'a', actor_id: 'ac'
    }
  });
  assert.equal(isStageValid(ledger, 'AUTHORIZATION'), true);
  assert.equal(isStageValid(ledger, 'AUTHORIZATION_PROVENANCE'), true);
  assert.equal(isStageValid(ledger, 'AUTHORIZATION_SCOPE'), true);
});

// ---------------------------------------------------------------------------
// execution-plan-validation-registry: the real, independently-forward-executable pipeline
// ---------------------------------------------------------------------------

test('execution-plan-validation-registry: exactly 22 validators registered, one per canonical stage, in canonical order', () => {
  const all = executionPlanValidationRegistry.getAllValidators();
  assert.equal(all.length, 22);
  assert.deepEqual(all.map((v) => v.stage), VALIDATION_STAGES);
  for (const stage of VALIDATION_STAGES) {
    assert.equal(executionPlanValidationRegistry.getValidatorsForStage(stage).length, 1, `${stage} must have exactly one registered validator`);
  }
});

// ---------------------------------------------------------------------------
// Engine integration: the fields wired into execution-plan-engine.js in this PR
// ---------------------------------------------------------------------------

test('execution-plan-engine: every outcome carries a validation_ledger_id/fingerprint and honest *_validated flags derived from the ledger', () => {
  const fixtureDir = path.join(__dirname, 'fixtures', 'hermes-execution-plan-contracts.json');
  const planFixture = JSON.parse(fs.readFileSync(fixtureDir, 'utf8'));

  const prepared = evaluateExecutionPlanRequest(JSON.parse(JSON.stringify(planFixture.scenarios['prepared-no-llm-plan'].request)), {});
  assert.equal(prepared.plan.validation_pipeline_completed, true);
  // pr101fix (FIX 2): architecture gates run in CI, never inside this declarative engine -- the
  // engine has no evidence they passed for this specific package and must never claim otherwise.
  assert.equal(prepared.plan.architecture_gates_passed, false);
  assert.equal(prepared.result.architecture_gates_passed, false);
  assert.equal(prepared.result.all_required_validations_valid, true);
  assert.equal(prepared.result.first_blocking_stage, null);
  assert.equal(prepared.result.first_blocking_status, null);
  assert.equal(prepared.result.authorization_validated, true);
  assert.equal(prepared.result.budget_validated, true);

  const budgetBlocked = evaluateExecutionPlanRequest(JSON.parse(JSON.stringify(planFixture.scenarios['budget-blocked-plan'].request)), {});
  assert.equal(budgetBlocked.result.status, 'BUDGET_BLOCKED');
  assert.equal(budgetBlocked.result.authorization_validated, true, 'a stage genuinely reached and passed before the blocker stays true');
  assert.equal(budgetBlocked.result.budget_validated, false, 'the blocking stage itself is honestly false, never true');
  assert.equal(budgetBlocked.result.idempotency_validated, false, 'a stage never reached because the pipeline already stopped is false, not true');
  assert.equal(budgetBlocked.result.all_required_validations_valid, false);
  assert.notEqual(budgetBlocked.result.first_blocking_stage, null);
});

// ---------------------------------------------------------------------------
// Documentation
// ---------------------------------------------------------------------------

test('HERMES_VALIDATION_SEMANTICS_ARCHITECTURE_GATES.md exists', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_VALIDATION_SEMANTICS_ARCHITECTURE_GATES.md')), true);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  LIFECYCLE_STATES,
  TRANSITION_EVENTS,
  BLOCKED_TRANSITIONS_THIS_PHASE,
  TRANSITION_STATUSES,
  ERROR_CODES,
  EXECUTION_MODES,
  ROLLOUT_STAGES,
  REQUIRED_CONNECTOR_RECORD_FIELDS,
  REQUIRED_TRANSITION_REQUEST_FIELDS,
  REQUIRED_TRANSITION_RESPONSE_FIELDS,
  REQUIRED_HISTORY_FIELDS,
  FORBIDDEN_FIELDS,
  validateConnectorRecord,
  validateTransitionRequest,
  validateLifecycleHistoryEvent
} = require('../src/core/connector-lifecycle-contract');
const {
  getAllowedTransitions,
  resolveTargetState,
  applyLifecycleTransition
} = require('../src/core/connector-lifecycle-state-machine');
const {
  createConnectorRuntimeRegistry
} = require('../src/core/connector-runtime-registry');
const {
  validConnectorRecord,
  validTransitionRequest,
  readyReadinessResult,
  mockLifecycleAdapter,
  createMockAdapterRegistry,
  registeredConnector,
  candidateConnector,
  mockOnlyConnector,
  blockedConnector,
  deprecatedConnector
} = require('./helpers/connector-lifecycle-test-data');

const docPath = path.resolve(__dirname, '../../../docs/CONNECTOR_LIFECYCLE_RUNTIME_REGISTRY.md');
const fixturePath = path.resolve(__dirname, 'fixtures/hermes-connector-lifecycle-runtime-registry.json');
const indexPath = path.resolve(__dirname, '../src/index.js');
const adapterExecutionPath = path.resolve(__dirname, '../src/core/adapter-execution.js');
const operatorRunbookPath = path.resolve(__dirname, '../../../docs/OPERATOR_RUNBOOK.md');
const confirmEndpointTestPath = path.resolve(__dirname, 'confirm-endpoint.test.js');
const lifecycleModulePaths = [
  path.resolve(__dirname, '../src/core/connector-lifecycle-contract.js'),
  path.resolve(__dirname, '../src/core/connector-lifecycle-state-machine.js'),
  path.resolve(__dirname, '../src/core/connector-runtime-registry.js')
];

function assertIncludesAll(actual, expected) {
  for (const item of expected) assert.ok(actual.includes(item), `missing ${item}`);
}

function assertSafeFlags(result) {
  assert.equal(result.simulated, true);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.can_trigger_real_execution, false);
}

function transition(overrides = {}) {
  return validTransitionRequest(overrides);
}

function assertNoForbiddenKeys(value) {
  const json = JSON.stringify(value);
  for (const field of FORBIDDEN_FIELDS) {
    assert.equal(json.includes(`"${field}"`), false, `leaked forbidden field ${field}`);
  }
}

test('connector lifecycle document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('connector lifecycle fixture exposes required contract terms', () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assertIncludesAll(fixture.lifecycle_states, LIFECYCLE_STATES);
  assertIncludesAll(fixture.transition_events, TRANSITION_EVENTS);
  assertIncludesAll(fixture.blocked_transitions_this_phase, BLOCKED_TRANSITIONS_THIS_PHASE);
  assertIncludesAll(fixture.transition_statuses, TRANSITION_STATUSES);
  assertIncludesAll(fixture.error_codes, ERROR_CODES);
  assertIncludesAll(fixture.execution_modes, EXECUTION_MODES);
  assertIncludesAll(fixture.rollout_stages, ROLLOUT_STAGES);
  assertIncludesAll(fixture.required_connector_record_fields, REQUIRED_CONNECTOR_RECORD_FIELDS);
  assertIncludesAll(fixture.required_transition_request_fields, REQUIRED_TRANSITION_REQUEST_FIELDS);
  assertIncludesAll(fixture.required_transition_response_fields, REQUIRED_TRANSITION_RESPONSE_FIELDS);
  assertIncludesAll(fixture.required_history_fields, REQUIRED_HISTORY_FIELDS);
  assertIncludesAll(fixture.forbidden_fields, FORBIDDEN_FIELDS);
  assertIncludesAll(fixture.required_contract_references, [
    'READ_ONLY_ADAPTER_INTERFACE_RUNTIME.md',
    'REAL_READ_ONLY_ADAPTER_READINESS_GATE.md',
    'EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md',
    'TENANT_WORKSPACE_ISOLATION.md',
    'OPERATOR_RUNBOOK.md'
  ]);
  assert.equal(fixture.default_rules.deny_by_default, true);
  assert.equal(fixture.default_rules.fail_closed, true);
  assert.equal(fixture.default_rules.private_registry_storage, true);
  assert.equal(fixture.default_rules.maximum_reachable_state_this_pr, 'mock_only');
  assert.equal(fixture.default_rules.canary_allowed, false);
  assert.equal(fixture.default_rules.real_read_only_activation_allowed, false);
  assert.equal(fixture.default_rules.real_provider_enabled, false);
  assert.equal(fixture.default_rules.executed, false);
});

test('connector record validation blocks unsafe records', () => {
  assert.equal(validateConnectorRecord(validConnectorRecord()).valid, true);
  assert.ok(validateConnectorRecord(validConnectorRecord({ connector_id: '' })).errors.includes('invalid_connector_id'));
  assert.ok(validateConnectorRecord(validConnectorRecord({ provider_id: '' })).errors.includes('invalid_provider_id'));
  assert.ok(validateConnectorRecord(validConnectorRecord({ adapter_id: '' })).errors.includes('invalid_adapter_id'));
  assert.ok(validateConnectorRecord(validConnectorRecord({ lifecycle_state: 'unknown' })).errors.includes('lifecycle_state_not_allowed'));
  assert.ok(validateConnectorRecord(validConnectorRecord({ lifecycle_version: 0 })).errors.includes('invalid_lifecycle_version'));
  assert.ok(validateConnectorRecord(validConnectorRecord({ workspace_types: [] })).errors.includes('invalid_workspace_types'));
  assert.ok(validateConnectorRecord(validConnectorRecord({ domains: [] })).errors.includes('invalid_domains'));
  assert.ok(validateConnectorRecord(validConnectorRecord({ capabilities: [] })).errors.includes('invalid_capabilities'));
  assert.ok(validateConnectorRecord(validConnectorRecord({ operations: [] })).errors.includes('operations_must_be_non_empty_string_array'));
  assert.ok(validateConnectorRecord(validConnectorRecord({ operations: ['create_record'] })).errors.includes('unsafe_operation::create_record'));
  assert.ok(validateConnectorRecord(validConnectorRecord({ feature_flag_default: true })).errors.includes('feature_flag_default_must_be_false'));
  assert.ok(validateConnectorRecord(validConnectorRecord({ real_provider_enabled: true })).errors.includes('real_provider_enabled_must_be_false'));
  assert.ok(validateConnectorRecord(validConnectorRecord({ execution_mode: 'real_read_only' })).errors.includes('execution_mode_not_allowed'));
  assert.ok(validateConnectorRecord(validConnectorRecord({ rollout_stage: 'canary' })).errors.includes('rollout_stage_not_allowed'));
  assert.ok(validateConnectorRecord(validConnectorRecord({ token: 'nope' })).errors.includes('forbidden_field::token'));
  assert.ok(validateConnectorRecord(validConnectorRecord({ metadata: { nested: { rawPayload: 'nope' } } })).errors.includes('forbidden_field::rawPayload'));
});

test('transition request and history validation block unsafe data', () => {
  assert.equal(validateTransitionRequest(transition()).valid, true);
  assert.ok(validateTransitionRequest(transition({ trace_id: '' })).errors.includes('invalid_trace_id'));
  assert.ok(validateTransitionRequest(transition({ transition_id: '' })).errors.includes('invalid_transition_id'));
  assert.ok(validateTransitionRequest(transition({ expected_version: 0 })).errors.includes('invalid_expected_version'));
  assert.ok(validateTransitionRequest(transition({ transition_event: 'activate_canary' })).valid, true);
  assert.ok(validateTransitionRequest(transition({ evidence: { payload: 'nope' } })).errors.includes('forbidden_field::payload'));

  const history = {
    event_id: 'event_fixture',
    trace_id: 'trace_fixture',
    transition_id: 'transition_history_fixture',
    connector_id: 'connector_public_web_fixture',
    previous_state: 'registered',
    new_state: 'candidate',
    previous_version: 1,
    new_version: 2,
    transition_event: 'nominate_candidate',
    actor_id: 'actor_synthetic',
    actor_role: 'operator',
    reason_code: 'synthetic',
    applied: true,
    status: 'lifecycle_transition_applied',
    created_at: '2026-07-12T00:00:00.000Z',
    simulated: true,
    executed: false,
    real_provider_called: false
  };
  assert.equal(validateLifecycleHistoryEvent(history).valid, true);
  assert.ok(validateLifecycleHistoryEvent({ ...history, token: 'nope' }).errors.includes('forbidden_field::token'));
});

test('connector record state and flag consistency is enforced', () => {
  const cases = [
    [registeredConnector({ runtime_enabled: true }), 'registered_runtime_enabled_must_be_false'],
    [registeredConnector({ execution_mode: 'mock_only' }), 'registered_execution_mode_must_be_disabled_or_contract_only'],
    [mockOnlyConnector({ runtime_enabled: false }), 'mock_only_runtime_enabled_must_be_true'],
    [mockOnlyConnector({ adapter_kind: 'real_read_only_candidate' }), 'mock_only_adapter_kind_must_be_mock'],
    [deprecatedConnector({ deprecated: false }), 'deprecated_state_requires_deprecated_true'],
    [validConnectorRecord({ lifecycle_state: 'retired', retired: false, deprecated: true, execution_mode: 'disabled', rollout_stage: 'none' }), 'retired_state_requires_retired_true'],
    [validConnectorRecord({ lifecycle_state: 'paused', runtime_enabled: true }), 'paused_runtime_enabled_must_be_false']
  ];
  for (const [record, error] of cases) {
    assert.ok(validateConnectorRecord(record).errors.includes(error), `missing ${error}`);
  }
});

test('sanitizeLifecycleData removes lifecycle-only forbidden fields without mutating input', () => {
  const {
    sanitizeLifecycleData
  } = require('../src/core/connector-lifecycle-contract');
  const input = {
    input: 'remove-root-input',
    safe: 'keep',
    nested: {
      output: 'remove-output',
      rawEvidence: 'remove-evidence',
      accessToken: 'remove-token',
      list: [{ rawPayload: 'remove-payload', safe_item: 'keep-item' }]
    }
  };
  const sanitized = sanitizeLifecycleData(input);
  assert.equal(sanitized.input, undefined);
  assert.equal(sanitized.safe, 'keep');
  assert.equal(sanitized.nested.output, undefined);
  assert.equal(sanitized.nested.rawEvidence, undefined);
  assert.equal(sanitized.nested.accessToken, undefined);
  assert.equal(sanitized.nested.list[0].rawPayload, undefined);
  assert.equal(JSON.stringify(sanitized).includes('remove-token'), false);
  assert.equal(input.nested.accessToken, 'remove-token');
});

test('connector runtime registry keeps private frozen storage and clones records', () => {
  const registry = createConnectorRuntimeRegistry();
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(Object.prototype.hasOwnProperty.call(registry, '_records'), false);
  assert.equal(registry._records, undefined);
  assert.equal(Object.keys(registry).includes('_records'), false);
  assert.throws(() => {
    registry.registerConnector = () => ({ ok: true });
  }, TypeError);

  const result = registry.registerConnector(registeredConnector());
  assert.equal(result.ok, true);
  assert.equal(registry.hasConnector('connector_public_web_fixture'), true);
  assert.equal(registry.listConnectors().length, 1);
  assert.equal(registry.registerConnector(registeredConnector()).ok, false);

  const returned = registry.getConnector('connector_public_web_fixture');
  returned.connector_id = 'mutated';
  returned.metadata.mock_parity_declared = false;
  assert.equal(registry.getConnector('connector_public_web_fixture').connector_id, 'connector_public_web_fixture');
  assert.equal(registry.getConnector('connector_public_web_fixture').metadata.mock_parity_declared, true);

  const listed = registry.listConnectors();
  listed[0].connector_id = 'listed_mutation';
  assert.equal(registry.listConnectors()[0].connector_id, 'connector_public_web_fixture');
});

test('connector runtime registry fails closed for initial records atomically', () => {
  assert.throws(() => createConnectorRuntimeRegistry({
    initialRecords: [registeredConnector(), registeredConnector({ connector_id: '' })]
  }), /INVALID_INITIAL_CONNECTOR_RECORD/);
  assert.throws(() => createConnectorRuntimeRegistry({
    initialRecords: [registeredConnector({ adapter_kind: 'real_read_only' })]
  }), /INVALID_INITIAL_CONNECTOR_RECORD/);
  assert.throws(() => createConnectorRuntimeRegistry({
    initialRecords: [registeredConnector(), registeredConnector()]
  }), /INVALID_INITIAL_CONNECTOR_RECORD/);

  const registry = createConnectorRuntimeRegistry({
    initialRecords: [registeredConnector(), registeredConnector({ connector_id: 'connector_second_fixture', adapter_id: 'mock_second_adapter' })]
  });
  assert.equal(registry.listConnectors().length, 2);
  assert.equal(registry.listConnectors({ lifecycle_state: 'registered' }).length, 2);
});

test('registration blocks direct advanced lifecycle states', () => {
  const registry = createConnectorRuntimeRegistry();
  for (const record of [
    candidateConnector({ lifecycle_version: 1 }),
    mockOnlyConnector({ lifecycle_version: 1 }),
    validConnectorRecord({ lifecycle_state: 'readiness_passed', lifecycle_version: 1 }),
    validConnectorRecord({ lifecycle_state: 'feature_flag_off', lifecycle_version: 1 }),
    deprecatedConnector({ lifecycle_version: 1 })
  ]) {
    const result = registry.registerConnector(record);
    assert.equal(result.ok, false);
    assert.equal(result.error_code, 'INITIAL_STATE_NOT_ALLOWED');
  }
  assert.throws(() => createConnectorRuntimeRegistry({
    initialRecords: [mockOnlyConnector({ lifecycle_version: 1 })]
  }), /INVALID_INITIAL_CONNECTOR_RECORD/);
  assert.throws(() => createConnectorRuntimeRegistry({
    initialRecords: [validConnectorRecord({ lifecycle_state: 'readiness_passed', lifecycle_version: 1 })]
  }), /INVALID_INITIAL_CONNECTOR_RECORD/);
});

test('unregister is allowed only for safe early states', () => {
  const registry = createConnectorRuntimeRegistry({ initialRecords: [registeredConnector()] });
  const mockRecord = registeredConnector({ connector_id: 'connector_mock_fixture' });
  assert.equal(registry.registerConnector(mockRecord).ok, true);
  registry.transitionConnector(transition({
    connector_id: 'connector_mock_fixture',
    transition_id: 'transition_mock_nominate',
    transition_event: 'nominate_candidate',
    expected_version: 1
  }));
  registry.transitionConnector(transition({
    connector_id: 'connector_mock_fixture',
    transition_id: 'transition_mock_enable',
    transition_event: 'enable_mock_only',
    expected_version: 2
  }), { adapterRegistry: createMockAdapterRegistry(mockLifecycleAdapter({ metadata: { adapter_id: 'mock_lifecycle_adapter' } })) });
  assert.equal(registry.unregisterConnector('connector_public_web_fixture').removed, true);
  assert.equal(registry.unregisterConnector('connector_mock_fixture').removed, false);
});

test('state machine resolves allowed and blocked transitions deterministically', () => {
  assertIncludesAll(getAllowedTransitions('registered'), ['nominate_candidate', 'block_connector']);
  assert.equal(resolveTargetState('registered', 'nominate_candidate'), 'candidate');
  assert.equal(resolveTargetState('retired', 'nominate_candidate'), null);
  const declaredMappedOrBlocked = new Set();
  for (const state of LIFECYCLE_STATES) {
    for (const event of getAllowedTransitions(state)) declaredMappedOrBlocked.add(event);
  }
  for (const event of TRANSITION_EVENTS) {
    assert.equal(declaredMappedOrBlocked.has(event) || BLOCKED_TRANSITIONS_THIS_PHASE.includes(event), true, `dead transition event ${event}`);
  }
});

test('state machine applies permitted transitions without mutating records', () => {
  const record = registeredConnector();
  const result = applyLifecycleTransition(record, transition(), { clock: () => '2026-07-12T00:02:00.000Z' });
  assert.equal(result.applied, true);
  assert.equal(result.new_state, 'candidate');
  assert.equal(result.new_version, 2);
  assert.equal(record.lifecycle_state, 'registered');
  assertSafeFlags(result);
});

test('state machine supports main lifecycle path through mock and readiness states', () => {
  const adapterRegistry = createMockAdapterRegistry();
  const mockResult = applyLifecycleTransition(candidateConnector(), transition({
    transition_event: 'enable_mock_only',
    expected_version: 2
  }), { adapterRegistry, clock: () => '2026-07-12T00:02:00.000Z' });
  assert.equal(mockResult.applied, true);
  assert.equal(mockResult.new_state, 'mock_only');
  assert.equal(mockResult.lifecycle_record.runtime_enabled, true);
  assert.equal(mockResult.lifecycle_record.execution_mode, 'mock_only');

  const pending = applyLifecycleTransition(candidateConnector(), transition({
    transition_event: 'request_readiness_review',
    expected_version: 2
  }));
  assert.equal(pending.applied, true);
  assert.equal(pending.new_state, 'readiness_pending');

  const blocked = applyLifecycleTransition(validConnectorRecord({
    lifecycle_state: 'readiness_pending',
    lifecycle_version: 3
  }), transition({
    transition_event: 'block_readiness',
    expected_version: 3
  }));
  assert.equal(blocked.applied, true);
  assert.equal(blocked.new_state, 'readiness_blocked');

  const backToPending = applyLifecycleTransition(validConnectorRecord({
    lifecycle_state: 'readiness_blocked',
    lifecycle_version: 4
  }), transition({
    transition_event: 'request_readiness_review',
    expected_version: 4
  }));
  assert.equal(backToPending.applied, true);
  assert.equal(backToPending.new_state, 'readiness_pending');

  const passed = applyLifecycleTransition(validConnectorRecord({
    lifecycle_state: 'readiness_pending',
    lifecycle_version: 5
  }), transition({
    transition_event: 'pass_readiness',
    expected_version: 5,
    evidence: { readiness_result: readyReadinessResult() }
  }));
  assert.equal(passed.applied, true);
  assert.equal(passed.new_state, 'readiness_passed');

  const config = applyLifecycleTransition(validConnectorRecord({
    lifecycle_state: 'readiness_passed',
    lifecycle_version: 6
  }), transition({
    transition_event: 'request_configuration',
    expected_version: 6
  }));
  assert.equal(config.applied, true);
  assert.equal(config.new_state, 'configuration_pending');

  const featureOff = applyLifecycleTransition(validConnectorRecord({
    lifecycle_state: 'configuration_pending',
    lifecycle_version: 7
  }), transition({
    transition_event: 'mark_feature_flag_off',
    expected_version: 7
  }));
  assert.equal(featureOff.applied, true);
  assert.equal(featureOff.new_state, 'feature_flag_off');
});

test('state machine supports disable_runtime and resume_connector paths', () => {
  const adapterRegistry = createMockAdapterRegistry();
  const disabledFromRegistered = applyLifecycleTransition(registeredConnector(), transition({
    transition_id: 'transition_disable_registered',
    transition_event: 'disable_runtime',
    expected_version: 1
  }));
  assert.equal(disabledFromRegistered.applied, true);
  assert.equal(disabledFromRegistered.new_state, 'runtime_disabled');
  assert.equal(disabledFromRegistered.lifecycle_record.runtime_enabled, false);
  assert.equal(disabledFromRegistered.lifecycle_record.execution_mode, 'disabled');

  const disabledToMock = applyLifecycleTransition(validConnectorRecord({
    lifecycle_state: 'runtime_disabled',
    lifecycle_version: 2,
    execution_mode: 'disabled',
    rollout_stage: 'none',
    runtime_enabled: false
  }), transition({
    transition_id: 'transition_runtime_disabled_mock',
    transition_event: 'enable_mock_only',
    expected_version: 2
  }), { adapterRegistry });
  assert.equal(disabledToMock.applied, true);
  assert.equal(disabledToMock.new_state, 'mock_only');

  const resumed = applyLifecycleTransition(validConnectorRecord({
    lifecycle_state: 'paused',
    lifecycle_version: 3,
    execution_mode: 'disabled',
    rollout_stage: 'none',
    runtime_enabled: false
  }), transition({
    transition_id: 'transition_resume_to_runtime_disabled',
    transition_event: 'resume_connector',
    expected_version: 3
  }));
  assert.equal(resumed.applied, true);
  assert.equal(resumed.new_state, 'runtime_disabled');
  assert.equal(resumed.lifecycle_record.runtime_enabled, false);
});

test('state machine applies pause block deprecate and retire while retired does not transition', () => {
  const paused = applyLifecycleTransition(mockOnlyConnector(), transition({
    transition_event: 'pause_connector',
    expected_version: 3
  }));
  assert.equal(paused.applied, true);
  assert.equal(paused.new_state, 'paused');

  const blocked = applyLifecycleTransition(candidateConnector(), transition({
    transition_event: 'block_connector',
    expected_version: 2
  }));
  assert.equal(blocked.applied, true);
  assert.equal(blocked.new_state, 'blocked');

  const deprecated = applyLifecycleTransition(blockedConnector(), transition({
    transition_event: 'deprecate_connector',
    expected_version: 3
  }));
  assert.equal(deprecated.applied, true);
  assert.equal(deprecated.new_state, 'deprecated');

  const retired = applyLifecycleTransition(deprecatedConnector(), transition({
    transition_event: 'retire_connector',
    expected_version: 4
  }));
  assert.equal(retired.applied, true);
  assert.equal(retired.new_state, 'retired');

  const noTransition = applyLifecycleTransition(validConnectorRecord({
    lifecycle_state: 'retired',
    lifecycle_version: 5,
    deprecated: true,
    retired: true,
    runtime_enabled: false,
    real_provider_enabled: false,
    execution_mode: 'disabled',
    rollout_stage: 'none'
  }), transition({
    transition_event: 'nominate_candidate',
    expected_version: 5,
    transition_id: 'transition_retired_nominate'
  }));
  assert.equal(noTransition.applied, false);
  assert.ok(noTransition.blocking_reasons.includes('transition_not_allowed_from_state'));
});

test('state machine blocks future activation and missing guard evidence', () => {
  for (const transition_event of ['activate_canary', 'activate_read_only', 'mark_read_only_ready']) {
    const result = applyLifecycleTransition(validConnectorRecord(), transition({ transition_event }));
    assert.equal(result.applied, false);
    assert.ok(result.blocking_reasons.includes('transition_blocked_this_phase'));
  }

  const missingAdapter = applyLifecycleTransition(candidateConnector(), transition({
    transition_event: 'enable_mock_only',
    expected_version: 2
  }), { adapterRegistry: createMockAdapterRegistry(mockLifecycleAdapter({ metadata: { adapter_id: 'other_adapter' } })) });
  assert.equal(missingAdapter.applied, false);
  assert.ok(missingAdapter.blocking_reasons.includes('adapter_not_registered'));

  const realAdapter = applyLifecycleTransition(candidateConnector(), transition({
    transition_event: 'enable_mock_only',
    expected_version: 2
  }), { adapterRegistry: createMockAdapterRegistry(mockLifecycleAdapter({ metadata: { adapter_kind: 'real_read_only_candidate', enabled: false } })) });
  assert.equal(realAdapter.applied, false);
  assert.ok(realAdapter.blocking_reasons.includes('adapter_kind_not_mock'));

  const partialReadiness = applyLifecycleTransition(validConnectorRecord({
    lifecycle_state: 'readiness_pending',
    lifecycle_version: 3
  }), transition({
    transition_event: 'pass_readiness',
    expected_version: 3,
    evidence: { readiness_result: { ready: true } }
  }));
  assert.equal(partialReadiness.applied, false);
  assert.ok(partialReadiness.blocking_reasons.includes('readiness_candidate_id_mismatch'));

  const mismatch = applyLifecycleTransition(validConnectorRecord({
    lifecycle_state: 'readiness_pending',
    lifecycle_version: 3
  }), transition({
    transition_event: 'pass_readiness',
    expected_version: 3,
    evidence: { readiness_result: readyReadinessResult({ adapter_id: 'other_adapter' }) }
  }));
  assert.equal(mismatch.applied, false);
  assert.ok(mismatch.blocking_reasons.includes('readiness_adapter_id_mismatch'));

  const blockingArrays = applyLifecycleTransition(validConnectorRecord({
    lifecycle_state: 'readiness_pending',
    lifecycle_version: 3
  }), transition({
    transition_event: 'pass_readiness',
    expected_version: 3,
    evidence: { readiness_result: readyReadinessResult({ blocking_reasons: ['blocked'] }) }
  }));
  assert.equal(blockingArrays.applied, false);
  assert.ok(blockingArrays.blocking_reasons.includes('readiness_blocking_reasons_present'));
});

test('state machine blocks feature flag default on and missing kill switch', () => {
  const featureOn = applyLifecycleTransition(validConnectorRecord({
    lifecycle_state: 'configuration_pending',
    lifecycle_version: 7,
    feature_flag_default: true
  }), transition({
    transition_event: 'mark_feature_flag_off',
    expected_version: 7
  }));
  assert.equal(featureOn.applied, false);
  assert.ok(featureOn.blocking_reasons.includes('feature_flag_default_must_be_false'));

  const noKillSwitch = applyLifecycleTransition(validConnectorRecord({
    lifecycle_state: 'configuration_pending',
    lifecycle_version: 7,
    kill_switch_key: ''
  }), transition({
    transition_event: 'mark_feature_flag_off',
    expected_version: 7
  }));
  assert.equal(noKillSwitch.applied, false);
  assert.ok(noKillSwitch.blocking_reasons.includes('invalid_kill_switch_key'));
});

test('registry transitions enforce optimistic concurrency and append sanitized history', () => {
  const registry = createConnectorRuntimeRegistry({ initialRecords: [registeredConnector()] });
  const first = registry.transitionConnector(transition({ transition_id: 'transition_registry_first' }), { clock: () => '2026-07-12T00:02:00.000Z' });
  assert.equal(first.applied, true);
  assert.equal(first.new_version, 2);
  assert.equal(registry.getConnector('connector_public_web_fixture').lifecycle_state, 'candidate');

  const replay = registry.transitionConnector(transition({ transition_id: 'transition_registry_first' }), { clock: () => '2026-07-12T00:03:00.000Z' });
  assert.equal(replay.applied, false);
  assert.equal(replay.status, 'lifecycle_transition_blocked');
  assert.equal(replay.error.error_code, 'REPLAYED_TRANSITION');
  assert.equal(registry.getConnector('connector_public_web_fixture').lifecycle_version, 2);
  assert.equal(registry.getConnectorHistory('connector_public_web_fixture').length, 1);

  const stale = registry.transitionConnector(transition({ transition_id: 'transition_registry_stale' }), { clock: () => '2026-07-12T00:04:00.000Z' });
  assert.equal(stale.applied, false);
  assert.equal(stale.status, 'lifecycle_version_conflict');
  assert.equal(stale.error.error_code, 'VERSION_CONFLICT');
  assert.equal(registry.getConnector('connector_public_web_fixture').lifecycle_version, 2);

  const history = registry.getConnectorHistory('connector_public_web_fixture');
  assert.equal(history.length, 2);
  assert.equal(history[0].applied, true);
  assert.equal(history[1].applied, false);
  assertNoForbiddenKeys(history);
  history[0].connector_id = 'mutated';
  assert.equal(registry.getConnectorHistory('connector_public_web_fixture')[0].connector_id, 'connector_public_web_fixture');
});

test('registry bounds history per connector deterministically', () => {
  assert.throws(() => createConnectorRuntimeRegistry({ maxHistoryPerConnector: 0 }), /INVALID_HISTORY_LIMIT/);
  assert.throws(() => createConnectorRuntimeRegistry({ maxHistoryPerConnector: -1 }), /INVALID_HISTORY_LIMIT/);
  assert.throws(() => createConnectorRuntimeRegistry({ maxHistoryPerConnector: 1001 }), /INVALID_HISTORY_LIMIT/);

  const registry = createConnectorRuntimeRegistry({
    initialRecords: [registeredConnector()],
    maxHistoryPerConnector: 3
  });

  registry.transitionConnector(transition({ transition_id: 'history_1' }), { clock: () => '2026-07-12T00:00:01.000Z' });
  registry.transitionConnector(transition({
    transition_id: 'history_2',
    transition_event: 'block_connector',
    expected_version: 2
  }), { clock: () => '2026-07-12T00:00:02.000Z' });
  registry.transitionConnector(transition({
    transition_id: 'history_3',
    transition_event: 'deprecate_connector',
    expected_version: 3
  }), { clock: () => '2026-07-12T00:00:03.000Z' });
  registry.transitionConnector(transition({
    transition_id: 'history_4',
    transition_event: 'retire_connector',
    expected_version: 4
  }), { clock: () => '2026-07-12T00:00:04.000Z' });

  const history = registry.getConnectorHistory('connector_public_web_fixture');
  assert.equal(history.length, 3);
  assert.deepEqual(history.map((event) => event.transition_id), ['history_2', 'history_3', 'history_4']);
  history[0].transition_id = 'mutated';
  assert.equal(registry.getConnectorHistory('connector_public_web_fixture')[0].transition_id, 'history_2');
  assert.equal(registry.listTransitionHistory().length, 3);
});

test('registry transition helper functions use private storage and deterministic filters', () => {
  const registry = createConnectorRuntimeRegistry({ initialRecords: [
    registeredConnector(),
    registeredConnector({ connector_id: 'connector_candidate_fixture', adapter_id: 'mock_candidate_adapter' })
  ] });
  registry.transitionConnector(transition({
    connector_id: 'connector_candidate_fixture',
    transition_id: 'transition_candidate_fixture_nominate',
    expected_version: 1
  }));
  assert.equal(registry.listConnectors({ lifecycle_state: 'registered' }).length, 1);
  assert.equal(registry.listConnectors({ lifecycle_state: 'candidate' })[0].connector_id, 'connector_candidate_fixture');

  const missing = registry.transitionConnector(transition({ connector_id: 'missing_connector', transition_id: 'transition_missing_connector' }));
  assert.equal(missing.status, 'lifecycle_connector_not_found');
  assert.equal(missing.applied, false);
  assert.equal(registry.listTransitionHistory().length, 1);

  const blocked = registry.transitionConnector(transition({
    connector_id: 'connector_candidate_fixture',
    transition_id: 'transition_candidate_activate_read_only',
    transition_event: 'activate_read_only',
    expected_version: 2
  }));
  assert.equal(blocked.applied, false);
  assert.equal(registry.listTransitionHistory({ applied: false }).length, 1);
  assert.equal(registry.listTransitionHistory({ connector_id: 'connector_candidate_fixture' }).length, 2);
});

test('safety invariants are fixed and current runtime modules are not coupled', () => {
  const result = applyLifecycleTransition(registeredConnector(), transition());
  assertSafeFlags(result);
  assertNoForbiddenKeys(result.history_event);
  for (const filePath of lifecycleModulePaths) {
    const source = fs.readFileSync(filePath, 'utf8');
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('axios'), false);
    assert.equal(source.includes('process.env'), false);
  }
  for (const filePath of [indexPath, adapterExecutionPath]) {
    const source = fs.readFileSync(filePath, 'utf8');
    assert.equal(source.includes('connector-runtime-registry'), false);
    assert.equal(source.includes('connector-lifecycle-state-machine'), false);
  }
  const runbookSource = fs.readFileSync(operatorRunbookPath, 'utf8');
  const confirmTestSource = fs.readFileSync(confirmEndpointTestPath, 'utf8');
  assert.equal(runbookSource.includes('domain_mock_adapter_selected'), true);
  assert.equal(runbookSource.includes('domain_mock_adapter_missing'), true);
  assert.equal(confirmTestSource.includes('domain_mock_adapter_selected'), true);
  assert.equal(confirmTestSource.includes('domain_mock_adapter_missing'), true);
});

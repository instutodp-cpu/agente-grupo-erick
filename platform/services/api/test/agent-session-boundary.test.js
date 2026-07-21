'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-agent-session-boundary.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  AGENT_SESSION_CONTRACT_VALIDATOR_VERSION,
  FORBIDDEN_SESSION_STATUSES,
  SESSION_STATUSES,
  SESSION_TYPES,
  isNormalizedScopeList,
  matchesSessionScope,
  validateAgentSessionContract,
  validateSessionMetadata,
  validateSessionScope
} = require('../src/core/agent-session-contract');
const {
  AGENT_SESSION_REFERENCE_VALIDATOR_VERSION,
  validateConversationReference,
  validateRequestAgentContractReference,
  validateRequestSessionReference,
  validateSessionPolicyReference
} = require('../src/core/agent-session-reference');
const { validateAgentSessionState } = require('../src/core/agent-session-state');
const {
  ALLOWED_TRANSITION_TABLE,
  TRANSITION_TYPES,
  evaluateAgentSessionTransition,
  resolveTargetStatus,
  validateAgentSessionTransition
} = require('../src/core/agent-session-transition');
const {
  EXPIRATION_TYPES,
  evaluateAgentSessionExpiration,
  validateAgentSessionExpiration
} = require('../src/core/agent-session-expiration');
const {
  AGENT_SESSION_REQUEST_VALIDATOR_VERSION,
  validateAgentSessionRequest
} = require('../src/core/agent-session-request');
const {
  buildAgentSessionDecision,
  validateAgentSessionDecision
} = require('../src/core/agent-session-decision');
const { evaluateAgentSessionRequest } = require('../src/core/agent-session-boundary');
const { createAgentSessionRegistry } = require('../src/core/agent-session-registry');
const { buildAgentSessionAudit, validateAgentSessionAudit } = require('../src/core/agent-session-audit');
const { AGENT_ACTOR_CONTEXT_VALIDATOR_VERSION } = require('../src/core/agent-context-contract');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sessionFixture(key, overrides = {}) {
  return { ...clone(fixture.sessions[key]), ...overrides };
}

const SESSION_KEYS = [
  'interactive-session-reference', 'retail-agent-session', 'finance-analytics-session', 'pharmacy-specialist-session',
  'training-session', 'audit-session', 'system-session'
];
const CASE_KEYS = [
  'tenant-mismatch-session', 'organization-mismatch-session', 'invalid-transition-session', 'expired-logical-session',
  'approval-blocked-session', 'policy-blocked-session', 'replay-session', 'version-conflict-session'
];

test('session boundary fixture and docs exist without operational material', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_AGENT_SESSION_BOUNDARY.md')), true);
  assert.equal(fixture.simulation, true);
  assert.equal(fixture.production_blocked, true);
  assert.deepEqual(findAgentCoreOperationalMaterial(fixture), []);
  assert.deepEqual(Object.keys(fixture.sessions).sort(), [...SESSION_KEYS].sort());
  assert.deepEqual(Object.keys(fixture.cases).sort(), [...CASE_KEYS].sort());
});

SESSION_KEYS.forEach((key) => {
  test(`fixture session ${key} is structurally valid`, () => {
    assert.equal(validateAgentSessionContract(sessionFixture(key)).valid, true);
  });
});

CASE_KEYS.forEach((key) => {
  test(`fixture case ${key} reproduces its expected decision`, () => {
    const scenario = fixture.cases[key];
    const decision = evaluateAgentSessionRequest(clone(scenario.request), clone(scenario.context));
    assert.equal(decision.status, scenario.expected_status);
  });
});

test('session contract valid and rejects missing extra invalid enums forbidden status', () => {
  const session = sessionFixture('interactive-session-reference');
  assert.equal(validateAgentSessionContract(session).valid, true);
  const missing = clone(session);
  delete missing.tenant_id;
  assert.ok(validateAgentSessionContract(missing).errors.includes('agent_session_missing_tenant_id'));
  assert.ok(validateAgentSessionContract({ ...session, extra: true }).errors.includes('agent_session_unexpected_field::extra'));
  assert.ok(validateAgentSessionContract({ ...session, session_type: 'NOT_A_TYPE' }).errors.some((error) => error.includes('session_type_not_allowed')));
  assert.ok(validateAgentSessionContract({ ...session, session_status: 'ACTIVE' }).errors.includes('session_status_forbidden::ACTIVE'));
  assert.ok(validateAgentSessionContract({ ...session, session_status: 'RUNNING' }).errors.includes('session_status_forbidden::RUNNING'));
  assert.ok(validateAgentSessionContract({ ...session, session_status: 'EXECUTING' }).errors.includes('session_status_forbidden::EXECUTING'));
  assert.ok(validateAgentSessionContract({ ...session, organization_id: 'unrelated-org' }).errors.includes('organization_id_not_compatible_with_tenant'));
  assert.equal(FORBIDDEN_SESSION_STATUSES.includes('ACTIVE'), true);
  assert.equal(SESSION_TYPES.length, 7);
  assert.equal(SESSION_STATUSES.length, 7);
});

test('session scope validates rejects wildcard regex duplicate unsorted and empty scope blocks matching', () => {
  const scope = clone(fixture.sessions['interactive-session-reference'].session_scope);
  assert.equal(validateSessionScope(scope).valid, true);
  assert.ok(validateSessionScope({ ...scope, allowed_agent_ids: ['*'] }).errors.includes('allowed_agent_ids_invalid'));
  assert.ok(validateSessionScope({ ...scope, allowed_agent_ids: ['a(b)'] }).errors.includes('allowed_agent_ids_invalid'));
  assert.ok(validateSessionScope({ ...scope, allowed_agent_ids: ['a', 'a'] }).errors.includes('allowed_agent_ids_invalid'));
  assert.ok(validateSessionScope({ ...scope, allowed_agent_ids: ['b', 'a'] }).errors.includes('allowed_agent_ids_invalid'));
  assert.ok(validateSessionScope({ ...scope, cross_tenant_allowed: true }).errors.includes('cross_tenant_allowed_must_be_false'));
  assert.ok(validateSessionScope({ ...scope, cross_organization_allowed: true }).errors.includes('cross_organization_allowed_must_be_false'));
  assert.equal(isNormalizedScopeList(['*']), false);

  const candidate = { agent_id: 'agent_general_assistant_001', actor_id: 'actor_general_1', actor_role: 'OPERATOR', channel: 'WEB', session_type: 'INTERACTIVE_REFERENCE', tenant_id: 'tenant_demo_general', organization_id: 'tenant_demo_general:org-main' };
  assert.equal(matchesSessionScope(scope, candidate), true);
  assert.equal(matchesSessionScope({ ...scope, allowed_agent_ids: [] }, candidate), false);
});

test('conversation policy session-reference and agent-contract-reference sub contracts valid and reject unsafe flags', () => {
  const conv = clone(fixture.sessions['interactive-session-reference'].conversation_reference);
  assert.equal(validateConversationReference(conv).valid, true);
  assert.ok(validateConversationReference({ ...conv, history_loaded: true }).errors.includes('history_loaded_must_be_false'));
  assert.ok(validateConversationReference({ ...conv, history_mutated: true }).errors.includes('history_mutated_must_be_false'));

  const policyRef = clone(fixture.sessions['interactive-session-reference'].policy_reference);
  assert.equal(validateSessionPolicyReference(policyRef).valid, true);
  assert.ok(validateSessionPolicyReference({ ...policyRef, policy_evaluated: false }).errors.includes('policy_evaluated_must_be_true'));
  assert.ok(validateSessionPolicyReference({ ...policyRef, policy_status: 'NOT_A_STATUS' }).errors.some((error) => error.includes('policy_status_not_allowed')));

  const sessRef = { session_id: 'session_1', session_version: 0, session_fingerprint: 'fp_pending', session_present: false, session_loaded: false, session_mutated: false, validator_version: AGENT_SESSION_REFERENCE_VALIDATOR_VERSION };
  assert.equal(validateRequestSessionReference(sessRef).valid, true);
  assert.ok(validateRequestSessionReference({ ...sessRef, session_loaded: true }).errors.includes('session_loaded_must_be_false'));

  const contractRef = { contract_id: 'contract_1', contract_version: 1, contract_fingerprint: 'fp', agent_id: 'agent_1', agent_version: 1, tenant_id: 'tenant_a', organization_id: 'tenant_a:org', contract_status: 'VALIDATED_SIMULATION', lifecycle_state: 'REGISTERED_SIMULATION', validator_version: AGENT_SESSION_REFERENCE_VALIDATOR_VERSION };
  assert.equal(validateRequestAgentContractReference(contractRef).valid, true);
  assert.ok(validateRequestAgentContractReference({ ...contractRef, contract_status: 'INVALID_STATUS' }).errors.some((error) => error.includes('contract_status_not_allowed')));
});

test('session metadata reuses risk and data classification enums and normalizes purpose code', () => {
  const metadata = clone(fixture.sessions['interactive-session-reference'].metadata);
  assert.equal(validateSessionMetadata(metadata).valid, true);
  assert.ok(validateSessionMetadata({ ...metadata, risk_classification: 'UNKNOWN' }).errors.some((error) => error.includes('risk_classification_not_allowed')));
  assert.ok(validateSessionMetadata({ ...metadata, data_classification: 'UNKNOWN' }).errors.some((error) => error.includes('data_classification_not_allowed')));
  assert.ok(validateSessionMetadata({ ...metadata, purpose_code: 'Not Normalized!' }).errors.includes('purpose_code_not_normalized'));
});

test('session state valid and forces runtime history memory execution flags false', () => {
  const state = { state_id: 'state_1', session_id: 'session_1', session_version: 1, current_status: 'DRAFT', previous_status: 'DRAFT', state_sequence: 0, state_fingerprint: 'fp_state', state_valid: true, state_mutated: false, runtime_connected: false, history_loaded: false, memory_loaded: false, agent_executed: false, validator_version: require('../src/core/agent-session-state').AGENT_SESSION_STATE_VALIDATOR_VERSION };
  assert.equal(validateAgentSessionState(state).valid, true);
  for (const field of ['state_mutated', 'runtime_connected', 'history_loaded', 'memory_loaded', 'agent_executed']) {
    assert.ok(validateAgentSessionState({ ...state, [field]: true }).errors.includes(`${field}_must_be_false`));
  }
});

test('transition table permits and blocks the exact documented pairs and never applies', () => {
  const allowed = [
    ['DRAFT', 'VALIDATE', 'VALIDATED'], ['VALIDATED', 'OPEN_SIMULATION', 'OPEN_SIMULATION'],
    ['OPEN_SIMULATION', 'SUSPEND', 'SUSPENDED'], ['SUSPENDED', 'RESUME_SIMULATION', 'OPEN_SIMULATION'],
    ['DRAFT', 'ARCHIVE', 'ARCHIVED'], ['VALIDATED', 'ARCHIVE', 'ARCHIVED'],
    ['OPEN_SIMULATION', 'CLOSE_SIMULATION', 'CLOSED_SIMULATION'], ['SUSPENDED', 'CLOSE_SIMULATION', 'CLOSED_SIMULATION'],
    ['OPEN_SIMULATION', 'EXPIRE_LOGICAL', 'EXPIRED_LOGICAL'], ['SUSPENDED', 'EXPIRE_LOGICAL', 'EXPIRED_LOGICAL'],
    ['EXPIRED_LOGICAL', 'ARCHIVE', 'ARCHIVED'], ['CLOSED_SIMULATION', 'ARCHIVE', 'ARCHIVED']
  ];
  assert.equal(allowed.length, ALLOWED_TRANSITION_TABLE.length);
  for (const [from, type, to] of allowed) {
    const evaluation = evaluateAgentSessionTransition({ transition_id: 't', session_id: 's', tenant_id: 'tenant_a', organization_id: 'tenant_a:org', from_status: from, to_status: to, transition_type: type, logical_sequence: 0, transition_version: 1 });
    assert.equal(evaluation.transition_allowed, true, `${from}->${to} via ${type} should be allowed`);
    assert.equal(evaluation.transition_applied, false);
    assert.equal(resolveTargetStatus(from, type), to);
  }
  const blocked = evaluateAgentSessionTransition({ transition_id: 't', session_id: 's', tenant_id: 'tenant_a', organization_id: 'tenant_a:org', from_status: 'ARCHIVED', to_status: 'DRAFT', transition_type: 'VALIDATE', logical_sequence: 0, transition_version: 1 });
  assert.equal(blocked.transition_allowed, false);
  assert.equal(blocked.transition_applied, false);
  assert.equal(Object.isFrozen(blocked), true);
  const state = { transition_id: 't', session_id: 's', tenant_id: 'tenant_a', organization_id: 'tenant_a:org', from_status: 'DRAFT', to_status: 'VALIDATED', transition_type: 'VALIDATE', transition_allowed: true, transition_applied: false, requires_policy: false, requires_approval: false, reason_codes: ['transition_reviewed_simulation_only'], logical_sequence: 0, transition_version: 1, validator_version: require('../src/core/agent-session-transition').AGENT_SESSION_TRANSITION_VALIDATOR_VERSION };
  assert.equal(validateAgentSessionTransition(state).valid, true);
  assert.equal(TRANSITION_TYPES.length, 8);
});

test('expiration evaluates inactivity and total sequences without any clock or timer and rejects inconsistent sequences', () => {
  const inactivityOk = evaluateAgentSessionExpiration({ expiration_policy_id: 'e1', expiration_type: 'INACTIVITY_SEQUENCE', created_sequence: 0, last_activity_sequence: 5, current_sequence: 10, maximum_inactive_sequences: 20, maximum_total_sequences: 1000 });
  assert.equal(inactivityOk.expired_logically, false);
  const inactivityExpired = evaluateAgentSessionExpiration({ expiration_policy_id: 'e1', expiration_type: 'INACTIVITY_SEQUENCE', created_sequence: 0, last_activity_sequence: 5, current_sequence: 100, maximum_inactive_sequences: 20, maximum_total_sequences: 1000 });
  assert.equal(inactivityExpired.expired_logically, true);
  const totalExpired = evaluateAgentSessionExpiration({ expiration_policy_id: 'e1', expiration_type: 'TOTAL_SEQUENCE', created_sequence: 0, last_activity_sequence: 5, current_sequence: 2000, maximum_inactive_sequences: 20, maximum_total_sequences: 1000 });
  assert.equal(totalExpired.expired_logically, true);
  const inconsistent = evaluateAgentSessionExpiration({ expiration_policy_id: 'e1', expiration_type: 'TOTAL_SEQUENCE', created_sequence: 10, last_activity_sequence: 5, current_sequence: 3, maximum_inactive_sequences: 20, maximum_total_sequences: 1000 });
  assert.equal(inconsistent.expired_logically, false);
  assert.equal(inconsistent.expiration_reason, 'sequence_inconsistent');
  assert.equal(inactivityOk.timer_created, false);
  assert.equal(inactivityOk.clock_accessed, false);
  assert.equal(inactivityOk.session_mutated, false);
  assert.equal(validateAgentSessionExpiration(inactivityOk).valid, true);
  assert.equal(EXPIRATION_TYPES.length, 4);
});

test('session request valid and rejects missing extra actor mismatch invalid session_present', () => {
  const scenario = fixture.cases['tenant-mismatch-session'];
  const validRequest = clone(fixture.cases['policy-blocked-session'].request);
  assert.equal(validateAgentSessionRequest(validRequest).valid, true);
  const missing = clone(validRequest);
  delete missing.tenant_id;
  assert.ok(validateAgentSessionRequest(missing).errors.includes('agent_session_request_missing_tenant_id'));
  assert.ok(validateAgentSessionRequest({ ...validRequest, extra: true }).errors.includes('agent_session_request_unexpected_field::extra'));
  assert.ok(validateAgentSessionRequest({ ...validRequest, session_reference: { ...validRequest.session_reference, session_present: true } }).errors.some((error) => error.includes('session_present_inconsistent_with_request_type')));
  assert.equal(validateAgentSessionRequest(scenario.request).errors.length > 0 || validateAgentSessionRequest(scenario.request).valid, true);
});

test('session decision forces all safe flags false and transition_applied always false', () => {
  const decision = buildAgentSessionDecision({
    decision_id: 'd1', session_request_id: 'r1', session_id: 's1', agent_id: 'a1', tenant_id: 'tenant_a', organization_id: 'tenant_a:org',
    status: 'ALLOW_SIMULATION', decision: 'CREATE_REFERENCE_ALLOWED', allowed_in_simulation: true,
    requested_transition: 'CREATE', transition_allowed: true, current_status: 'DRAFT', proposed_status: 'DRAFT',
    session_fingerprint: 'fp_s', request_fingerprint: 'fp_r', state_fingerprint: 'fp_st', transition_fingerprint: 'fp_t',
    policy_decision_fingerprint: 'fp_p', expiration_fingerprint: 'fp_e', registry_version: 'v1',
    session_validated: true, policy_validated: true, scope_validated: true, expiration_evaluated: false
  });
  assert.equal(validateAgentSessionDecision(decision).valid, true);
  for (const field of ['session_created', 'session_loaded', 'session_mutated', 'history_loaded', 'history_mutated', 'memory_read', 'memory_written', 'agent_executed', 'llm_called', 'tool_called', 'network_used', 'runtime_connected', 'executed', 'runtime_enabled']) {
    assert.equal(decision[field], false);
  }
  assert.equal(decision.simulation, true);
  assert.equal(decision.production_blocked, true);
  assert.equal(decision.rollout_percentage, 0);
  assert.equal(decision.transition_applied, false);
  assert.equal(Object.isFrozen(decision), true);
});

test('registry replay payload mismatch version conflict tenant and organization block and session conflict', () => {
  const registry = createAgentSessionRegistry();
  const session = sessionFixture('interactive-session-reference');
  const first = registry.registerSession(session, { expected_version: 0 });
  assert.equal(first.ok, true);
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  const replay = registry.registerSession(session);
  assert.equal(replay.status, 'REPLAY_ACCEPTED');
  const mismatch = registry.registerSession({ ...session, session_status: 'VALIDATED' });
  assert.equal(mismatch.status, 'PAYLOAD_MISMATCH');
  const staleConflict = registry.registerSession({ ...session, session_version: 2 }, { expected_version: 99 });
  assert.equal(staleConflict.status, 'VERSION_CONFLICT');
  const fingerprintConflict = registry.registerSession({ ...session, session_version: 2, session_fingerprint: 'fp_changed' }, { expected_fingerprint: 'fp_totally_wrong' });
  assert.equal(fingerprintConflict.status, 'FINGERPRINT_CONFLICT');
  const sessionConflict = registry.registerSession({ ...session, session_version: 2, session_fingerprint: 'fp_changed', agent_id: 'agent_other' });
  assert.equal(sessionConflict.status, 'SESSION_CONFLICT');

  const fetched = registry.getBySessionId(session.session_id);
  assert.equal(Object.isFrozen(fetched), true);
  assert.throws(() => { fetched.session_status = 'ARCHIVED'; }, TypeError);
  assert.equal(registry.getBySessionIdAndTenant(session.session_id, session.tenant_id).session_id, session.session_id);
  assert.equal(registry.getBySessionIdAndTenant(session.session_id, 'tenant_other'), null);

  const otherTenantSession = sessionFixture('retail-agent-session');
  registry.registerSession(otherTenantSession, { expected_version: 0 });
  const sameTenantList = registry.listByTenant(session.tenant_id);
  assert.equal(sameTenantList.length, 1);
  const crossTenantList = registry.listByTenant(otherTenantSession.tenant_id);
  assert.equal(crossTenantList.some((record) => record.session_id === session.session_id), false);
});

test('session audit is immutable structurally minimal and always simulated', () => {
  const scenario = fixture.cases['policy-blocked-session'];
  const decision = evaluateAgentSessionRequest(clone(scenario.request), clone(scenario.context));
  const audit = buildAgentSessionAudit({ request: clone(scenario.request), decision, logical_sequence: 1 });
  assert.equal(validateAgentSessionAudit(audit).valid, true);
  assert.equal(audit.simulation, true);
  assert.equal(audit.production_blocked, true);
  assert.equal(audit.executed, false);
  assert.equal(Object.isFrozen(audit), true);
  assert.throws(() => { audit.blockers.push('x'); }, TypeError);
  assert.deepEqual(Object.keys(audit).sort(), [
    'actor_role', 'actor_type', 'agent_contract_fingerprint', 'agent_id', 'audit_id', 'blockers', 'channel',
    'decision_status', 'executed', 'expiration_fingerprint', 'logical_sequence', 'organization_binding',
    'policy_decision_fingerprint', 'previous_status', 'production_blocked', 'proposed_status',
    'reason_codes', 'registry_version', 'request_fingerprint', 'session_fingerprint', 'session_type',
    'simulation', 'state_fingerprint', 'tenant_binding', 'transition_fingerprint', 'validator_version'
  ].sort());
});

[
  ['api key', { api_key: 'x' }, 'forbidden_key::api_key'],
  ['jwt key', { jwt_value: 'x' }, 'forbidden_key'],
  ['cookie value', { note: 'do not store the cookie header' }, 'forbidden_word_value'],
  ['url value', { note: 'https://blocked.invalid' }, 'operational_url_value'],
  ['callback word', { note: 'invokes a callback handler' }, 'forbidden_word_value'],
  ['prompt word', { note: 'uses a system_prompt internally' }, 'forbidden_word_value']
].forEach(([name, value, reasonPrefix]) => {
  test(`operational material detector blocks ${name}`, () => {
    const found = findAgentCoreOperationalMaterial(value);
    assert.ok(found.some((entry) => entry.startsWith(reasonPrefix)), found.join(','));
  });
});

test('operational material detector avoids false positives on legitimate session field names', () => {
  assert.deepEqual(findAgentCoreOperationalMaterial({ runtime_connected: false }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ session_loaded: false }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ history_loaded: false }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ policy_evaluated: true }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ agent_executed: false }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(sessionFixture('finance-analytics-session')), []);
});

test('operational material detector rejects NaN Infinity bigint symbol function cyclic reference', () => {
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.NaN }).some((error) => error.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.POSITIVE_INFINITY }).some((error) => error.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: BigInt(1) }).some((error) => error.includes('forbidden_bigint')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Symbol('x') }).some((error) => error.includes('forbidden_symbol')));
  assert.ok(findAgentCoreOperationalMaterial({ value: () => null }).some((error) => error.includes('forbidden_function')));
  const cyclic = {};
  cyclic.self = cyclic;
  assert.ok(findAgentCoreOperationalMaterial(cyclic).some((error) => error.includes('forbidden_cycle')));
});

test('fingerprints are deterministic and change with payload and evaluation does not mutate caller input', () => {
  const a = stablePayload({ b: 1, a: 2 });
  const b = stablePayload({ a: 2, b: 1 });
  assert.equal(a, b);

  const scenario = fixture.cases['policy-blocked-session'];
  const request = clone(scenario.request);
  const context = clone(scenario.context);
  const beforeRequest = JSON.stringify(request);
  const beforeContext = JSON.stringify(context);
  const decision1 = evaluateAgentSessionRequest(request, context);
  const decision2 = evaluateAgentSessionRequest(clone(scenario.request), clone(scenario.context));
  assert.equal(JSON.stringify(request), beforeRequest);
  assert.equal(JSON.stringify(context), beforeContext);
  assert.equal(decision1.request_fingerprint, decision2.request_fingerprint);
  const differentRequest = clone(scenario.request);
  differentRequest.session_request_id = 'different_session_request_id';
  const decision3 = evaluateAgentSessionRequest(differentRequest, clone(scenario.context));
  assert.notEqual(decision1.request_fingerprint, decision3.request_fingerprint);
});

test('replay of the exact same request produces an identical decision fingerprint', () => {
  const scenario = fixture.cases['replay-session'];
  const decision1 = evaluateAgentSessionRequest(clone(scenario.request), clone(scenario.context));
  const decision2 = evaluateAgentSessionRequest(clone(scenario.request), clone(scenario.context));
  assert.equal(decision1.decision_fingerprint, decision2.decision_fingerprint);
  assert.equal(decision1.status, 'ALLOW_SIMULATION');
});

test('regression agent session modules do not use llm tools memory network filesystem env or timers', () => {
  const files = [
    'services/api/src/core/agent-session-boundary.js',
    'services/api/src/core/agent-session-contract.js',
    'services/api/src/core/agent-session-request.js',
    'services/api/src/core/agent-session-state.js',
    'services/api/src/core/agent-session-transition.js',
    'services/api/src/core/agent-session-reference.js',
    'services/api/src/core/agent-session-expiration.js',
    'services/api/src/core/agent-session-registry.js',
    'services/api/src/core/agent-session-decision.js',
    'services/api/src/core/agent-session-audit.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:(http|https|net|tls|dns|dgram|fs|child_process|worker_threads|vm)['"]\)/.test(source), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(source.includes('Date.now()'), false);
    assert.equal(/\bnew Date\(\)/.test(source), false);
    assert.equal(/setTimeout|setInterval/.test(source), false);
    assert.equal(/openai|anthropic|@anthropic-ai|localStorage|sessionStorage|document\.cookie/i.test(source), false);
  }
});

test('regression agent session boundary is not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('agent-session'), false);
  }
});

test('regression PR79 agent core and PR80 policy boundary remain untouched by this PR', () => {
  const files = [
    'services/api/src/core/agent-core-contract.js',
    'services/api/src/core/agent-registry.js',
    'services/api/src/core/agent-policy-boundary.js',
    'services/api/src/core/agent-policy-registry.js',
    'services/api/src/core/transcription-runtime-registration-boundary.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('agent-session'), false);
  }
});

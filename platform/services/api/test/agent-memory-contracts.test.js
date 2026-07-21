'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-agent-memory-contracts.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  AGENT_MEMORY_ITEM_VALIDATOR_VERSION,
  FORBIDDEN_RETENTION_CLASSES,
  IMPORTANCE_LEVELS,
  MEMORY_TYPES,
  RETENTION_CLASSES,
  validateAgentMemoryItemContract
} = require('../src/core/agent-memory-item-contract');
const {
  AGENT_MEMORY_SCOPE_VALIDATOR_VERSION,
  isNormalizedScopeList,
  matchesMemoryScope,
  validateMemoryScope
} = require('../src/core/agent-memory-scope');
const {
  AGENT_MEMORY_POLICY_REFERENCE_VALIDATOR_VERSION,
  validateMemoryPolicyReference
} = require('../src/core/agent-memory-policy-reference');
const {
  AGENT_MEMORY_RETRIEVAL_REFERENCE_VALIDATOR_VERSION,
  validateRetrievalReference
} = require('../src/core/agent-memory-retrieval-reference');
const {
  AGENT_MEMORY_CONTRACT_STATUSES,
  AGENT_MEMORY_CONTRACT_VALIDATOR_VERSION,
  FORBIDDEN_AGENT_MEMORY_CONTRACT_STATUSES,
  validateAgentMemoryContract,
  validateRetentionPolicy,
  validateRetrievalPolicy
} = require('../src/core/agent-memory-contract');
const {
  AGENT_MEMORY_REQUEST_VALIDATOR_VERSION,
  MEMORY_REQUEST_TYPES,
  validateAgentMemoryRequest
} = require('../src/core/agent-memory-request');
const {
  ALWAYS_BLOCKED_REQUEST_TYPES,
  MEMORY_DECISION_STATUSES,
  buildAgentMemoryDecision,
  evaluateAgentMemoryRequest,
  validateAgentMemoryDecision
} = require('../src/core/agent-memory-decision');
const { createAgentMemoryRegistry } = require('../src/core/agent-memory-registry');
const { buildAgentMemoryAudit, validateAgentMemoryAudit } = require('../src/core/agent-memory-audit');
const { AGENT_ACTOR_CONTEXT_VALIDATOR_VERSION } = require('../src/core/agent-context-contract');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function memoryItemFixture(key, overrides = {}) {
  return { ...clone(fixture.memory_items[key]), ...overrides };
}

const MEMORY_ITEM_KEYS = [
  'working-memory-reference', 'episodic-memory-reference', 'semantic-memory-reference',
  'procedural-memory-reference', 'profile-memory-reference', 'audit-memory-reference'
];
const CASE_KEYS = [
  'tenant-mismatch-memory', 'organization-mismatch-memory', 'restricted-memory', 'confidential-memory-without-policy',
  'retrieval-reference', 'replay-memory', 'version-conflict-memory'
];

test('memory contracts fixture and docs exist without operational material', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_AGENT_MEMORY_CONTRACTS.md')), true);
  assert.equal(fixture.simulation, true);
  assert.equal(fixture.production_blocked, true);
  assert.deepEqual(findAgentCoreOperationalMaterial(fixture), []);
  assert.deepEqual(Object.keys(fixture.memory_items).sort(), [...MEMORY_ITEM_KEYS].sort());
  assert.deepEqual(Object.keys(fixture.cases).sort(), [...CASE_KEYS].sort());
});

MEMORY_ITEM_KEYS.forEach((key) => {
  test(`fixture memory item ${key} is structurally valid`, () => {
    assert.equal(validateAgentMemoryItemContract(memoryItemFixture(key)).valid, true);
  });
});

CASE_KEYS.forEach((key) => {
  test(`fixture case ${key} reproduces its expected decision`, () => {
    const scenario = fixture.cases[key];
    const decision = evaluateAgentMemoryRequest(clone(scenario.request), clone(scenario.context));
    assert.equal(decision.status, scenario.expected_status);
  });
});

test('memory item contract valid and rejects missing extra invalid enums and forbidden permanent retention', () => {
  const item = memoryItemFixture('working-memory-reference');
  assert.equal(validateAgentMemoryItemContract(item).valid, true);
  const missing = clone(item);
  delete missing.tenant_id;
  assert.ok(validateAgentMemoryItemContract(missing).errors.includes('agent_memory_item_missing_tenant_id'));
  assert.ok(validateAgentMemoryItemContract({ ...item, extra: true }).errors.includes('agent_memory_item_unexpected_field::extra'));
  assert.ok(validateAgentMemoryItemContract({ ...item, memory_type: 'NOT_A_TYPE' }).errors.some((error) => error.includes('memory_type_not_allowed')));
  assert.ok(validateAgentMemoryItemContract({ ...item, retention_class: 'PERMANENT_REFERENCE_BLOCKED' }).errors.includes('retention_class_forbidden::PERMANENT_REFERENCE_BLOCKED'));
  for (const field of ['content_present', 'content_loaded', 'content_stored', 'content_indexed']) {
    assert.ok(validateAgentMemoryItemContract({ ...item, [field]: true }).errors.includes(`${field}_must_be_false`));
  }
  assert.equal(MEMORY_TYPES.length, 6);
  assert.equal(RETENTION_CLASSES.includes('PERMANENT_REFERENCE_BLOCKED'), true);
  assert.equal(FORBIDDEN_RETENTION_CLASSES.includes('PERMANENT_REFERENCE_BLOCKED'), true);
  assert.equal(IMPORTANCE_LEVELS.includes('CRITICAL_REFERENCE'), true);
});

test('memory scope validates rejects wildcard regex duplicate unsorted and empty scope blocks matching', () => {
  const item = memoryItemFixture('working-memory-reference');
  const scope = {
    tenant_id: item.tenant_id, organization_id: item.organization_id, allowed_agent_ids: [item.agent_id],
    allowed_session_reference_ids: [item.session_reference_id], allowed_actor_roles: ['OPERATOR'],
    allowed_memory_types: [item.memory_type], allowed_classifications: [item.classification],
    cross_tenant_allowed: false, cross_organization_allowed: false, shared_between_agents: false, shared_between_sessions: false,
    validator_version: AGENT_MEMORY_SCOPE_VALIDATOR_VERSION
  };
  assert.equal(validateMemoryScope(scope).valid, true);
  assert.ok(validateMemoryScope({ ...scope, allowed_agent_ids: ['*'] }).errors.includes('allowed_agent_ids_invalid'));
  assert.ok(validateMemoryScope({ ...scope, allowed_agent_ids: ['a(b)'] }).errors.includes('allowed_agent_ids_invalid'));
  assert.ok(validateMemoryScope({ ...scope, allowed_agent_ids: ['a', 'a'] }).errors.includes('allowed_agent_ids_invalid'));
  assert.ok(validateMemoryScope({ ...scope, allowed_agent_ids: ['b', 'a'] }).errors.includes('allowed_agent_ids_invalid'));
  assert.ok(validateMemoryScope({ ...scope, cross_tenant_allowed: true }).errors.includes('cross_tenant_allowed_must_be_false'));
  assert.ok(validateMemoryScope({ ...scope, cross_organization_allowed: true }).errors.includes('cross_organization_allowed_must_be_false'));
  assert.equal(isNormalizedScopeList(['*']), false);

  const candidate = { tenant_id: item.tenant_id, organization_id: item.organization_id, agent_id: item.agent_id, session_reference_id: item.session_reference_id, actor_role: 'OPERATOR', memory_types: [item.memory_type], classification: item.classification };
  assert.equal(matchesMemoryScope(scope, candidate), true);
  assert.equal(matchesMemoryScope({ ...scope, allowed_agent_ids: [] }, candidate), false);
});

test('memory policy reference forces read write delete share false and requires policy_evaluated true', () => {
  const ref = { policy_request_id: 'pr_1', policy_decision_id: 'pd_1', policy_decision_fingerprint: 'fp_pd', policy_status: 'ALLOW_SIMULATION', allowed_in_simulation: true, approval_required: false, policy_evaluated: true, memory_read_allowed: false, memory_write_allowed: false, memory_delete_allowed: false, memory_share_allowed: false, validator_version: AGENT_MEMORY_POLICY_REFERENCE_VALIDATOR_VERSION };
  assert.equal(validateMemoryPolicyReference(ref).valid, true);
  for (const field of ['memory_read_allowed', 'memory_write_allowed', 'memory_delete_allowed', 'memory_share_allowed']) {
    assert.ok(validateMemoryPolicyReference({ ...ref, [field]: true }).errors.includes(`${field}_must_be_false`));
  }
  assert.ok(validateMemoryPolicyReference({ ...ref, policy_evaluated: false }).errors.includes('policy_evaluated_must_be_true'));
  assert.ok(validateMemoryPolicyReference({ ...ref, policy_status: 'NOT_A_STATUS' }).errors.some((error) => error.includes('policy_status_not_allowed')));
});

test('retrieval reference is purely declarative and forces execution flags false', () => {
  const ref = { retrieval_reference_id: 'retrieval_1', memory_contract_id: 'memory_contract_1', tenant_id: 'tenant_a', organization_id: 'tenant_a:org', agent_id: 'agent_1', session_reference_id: 'session_1', requested_memory_types: ['WORKING_MEMORY_REFERENCE'], query_reference_id: 'query_ref_1', query_present: false, query_loaded: false, retrieval_requested: true, retrieval_executed: false, results_loaded: false, result_count_reference: 0, ranking_requested: false, ranking_executed: false, similarity_requested: false, similarity_executed: false, retrieval_fingerprint: 'fp_retrieval_1', validator_version: AGENT_MEMORY_RETRIEVAL_REFERENCE_VALIDATOR_VERSION };
  assert.equal(validateRetrievalReference(ref).valid, true);
  assert.ok(validateRetrievalReference({ ...ref, query_present: true }).errors.includes('query_present_must_be_false'));
  assert.ok(validateRetrievalReference({ ...ref, retrieval_executed: true }).errors.includes('retrieval_executed_must_be_false'));
  assert.ok(validateRetrievalReference({ ...ref, ranking_executed: true }).errors.includes('ranking_executed_must_be_false'));
  assert.ok(validateRetrievalReference({ ...ref, similarity_executed: true }).errors.includes('similarity_executed_must_be_false'));
  assert.ok(validateRetrievalReference({ ...ref, result_count_reference: 5 }).errors.includes('result_count_reference_must_be_0'));
});

test('agent memory contract valid and rejects missing extra invalid enums forbidden status and restricted classification', () => {
  const item = memoryItemFixture('working-memory-reference');
  const scenario = fixture.cases['retrieval-reference'];
  const validMemoryContract = () => ({
    memory_contract_id: 'memory_contract_test_1', memory_contract_version: 1,
    agent_id: item.agent_id, agent_version: 1, tenant_id: item.tenant_id, organization_id: item.organization_id,
    session_reference: { session_id: item.session_reference_id, session_version: 1, session_fingerprint: `fp_${item.session_reference_id}`, session_present: true, session_loaded: false, session_mutated: false, validator_version: require('../src/core/agent-session-reference').AGENT_SESSION_REFERENCE_VALIDATOR_VERSION },
    memory_types: [item.memory_type],
    memory_scope: {
      tenant_id: item.tenant_id, organization_id: item.organization_id, allowed_agent_ids: [item.agent_id],
      allowed_session_reference_ids: [item.session_reference_id], allowed_actor_roles: ['OPERATOR'],
      allowed_memory_types: [item.memory_type], allowed_classifications: [item.classification],
      cross_tenant_allowed: false, cross_organization_allowed: false, shared_between_agents: false, shared_between_sessions: false,
      validator_version: AGENT_MEMORY_SCOPE_VALIDATOR_VERSION
    },
    policy_reference: { policy_request_id: 'pr_1', policy_decision_id: 'pd_1', policy_decision_fingerprint: 'fp_pd', policy_status: 'ALLOW_SIMULATION', allowed_in_simulation: true, approval_required: false, policy_evaluated: true, memory_read_allowed: false, memory_write_allowed: false, memory_delete_allowed: false, memory_share_allowed: false, validator_version: AGENT_MEMORY_POLICY_REFERENCE_VALIDATOR_VERSION },
    retention_policy: { retention_policy_id: 'retention_1', retention_class: item.retention_class, maximum_retention_sequences: 1000, retention_enforced: true, simulation: true, production_blocked: true, validator_version: AGENT_MEMORY_CONTRACT_VALIDATOR_VERSION },
    classification: item.classification, risk_classification: 'LOW',
    retrieval_policy: { retrieval_policy_id: 'retrieval_policy_1', retrieval_allowed: false, ranking_allowed: false, similarity_allowed: false, simulation: true, production_blocked: true, validator_version: AGENT_MEMORY_CONTRACT_VALIDATOR_VERSION },
    simulation_context: scenario.request.simulation_context, contract_status: 'VALIDATED_SIMULATION', validator_version: AGENT_MEMORY_CONTRACT_VALIDATOR_VERSION
  });
  const contract = validMemoryContract();
  assert.equal(validateAgentMemoryContract(contract).valid, true);
  const missing = clone(contract);
  delete missing.tenant_id;
  assert.ok(validateAgentMemoryContract(missing).errors.includes('agent_memory_contract_missing_tenant_id'));
  assert.ok(validateAgentMemoryContract({ ...contract, extra: true }).errors.includes('agent_memory_contract_unexpected_field::extra'));
  assert.ok(validateAgentMemoryContract({ ...contract, contract_status: 'ACTIVE' }).errors.includes('contract_status_forbidden::ACTIVE'));
  assert.ok(validateAgentMemoryContract({ ...contract, contract_status: 'EXECUTABLE' }).errors.includes('contract_status_forbidden::EXECUTABLE'));
  assert.ok(validateAgentMemoryContract({ ...contract, classification: 'RESTRICTED' }).errors.includes('classification_restricted_always_blocked'));
  assert.ok(validateAgentMemoryContract({ ...contract, organization_id: 'unrelated-org' }).errors.includes('organization_id_not_compatible_with_tenant'));
  assert.equal(FORBIDDEN_AGENT_MEMORY_CONTRACT_STATUSES.includes('ACTIVE'), true);
  assert.equal(AGENT_MEMORY_CONTRACT_STATUSES.includes('VALIDATED_SIMULATION'), true);

  assert.equal(validateRetentionPolicy(contract.retention_policy).valid, true);
  assert.ok(validateRetentionPolicy({ ...contract.retention_policy, retention_class: 'PERMANENT_REFERENCE_BLOCKED' }).errors.includes('retention_class_forbidden::PERMANENT_REFERENCE_BLOCKED'));
  assert.equal(validateRetrievalPolicy(contract.retrieval_policy).valid, true);
  assert.ok(validateRetrievalPolicy({ ...contract.retrieval_policy, retrieval_allowed: true }).errors.includes('retrieval_allowed_must_be_false'));
});

test('agent memory request valid and rejects missing extra actor mismatch invalid request type', () => {
  const scenario = fixture.cases['retrieval-reference'];
  const request = clone(scenario.request);
  assert.equal(validateAgentMemoryRequest(request).valid, true);
  const missing = clone(request);
  delete missing.tenant_id;
  assert.ok(validateAgentMemoryRequest(missing).errors.includes('agent_memory_request_missing_tenant_id'));
  assert.ok(validateAgentMemoryRequest({ ...request, extra: true }).errors.includes('agent_memory_request_unexpected_field::extra'));
  assert.ok(validateAgentMemoryRequest({ ...request, request_type: 'NOT_A_TYPE' }).errors.some((error) => error.includes('request_type_not_allowed')));
  assert.ok(validateAgentMemoryRequest({ ...request, actor_context: { ...request.actor_context, tenant_id: 'tenant_other' } }).errors.includes('actor_tenant_mismatch'));
  assert.ok(validateAgentMemoryRequest({ ...request, agent_contract_reference: { ...request.agent_contract_reference, contract_status: 'INVALID' } }).errors.includes('agent_contract_not_validated_simulation'));
  assert.equal(MEMORY_REQUEST_TYPES.length, 9);
});

test('memory decision forces all safe flags false and always blocks update delete and share', () => {
  const decision = buildAgentMemoryDecision({
    decision_id: 'd1', memory_request_id: 'r1', memory_contract_id: 'mc1', memory_item_id: 'mi1', agent_id: 'a1', tenant_id: 'tenant_a', organization_id: 'tenant_a:org',
    status: 'ALLOW_SIMULATION', decision: 'REGISTER_REFERENCE_ALLOWED', allowed_in_simulation: true,
    memory_contract_fingerprint: 'fp_mc', memory_item_fingerprint: 'fp_mi', request_fingerprint: 'fp_r', retrieval_fingerprint: 'fp_ret',
    policy_decision_fingerprint: 'fp_pd', registry_version: 'v1', contract_validated: true, scope_validated: true, policy_validated: true, retention_evaluated: false
  });
  assert.equal(validateAgentMemoryDecision(decision).valid, true);
  for (const field of ['memory_registered', 'memory_loaded', 'memory_read', 'memory_written', 'memory_updated', 'memory_deleted', 'memory_shared', 'retrieval_executed', 'ranking_executed', 'similarity_executed', 'embedding_generated', 'vector_store_used', 'llm_called', 'tool_called', 'network_used', 'runtime_mutated', 'executed', 'runtime_enabled']) {
    assert.equal(decision[field], false);
  }
  assert.equal(decision.simulation, true);
  assert.equal(decision.production_blocked, true);
  assert.equal(decision.rollout_percentage, 0);
  assert.equal(Object.isFrozen(decision), true);

  const scenario = fixture.cases['tenant-mismatch-memory'];
  for (const type of ALWAYS_BLOCKED_REQUEST_TYPES) {
    const request = clone(fixture.cases['retrieval-reference'].request);
    request.request_type = type;
    request.memory_request_id = `memory_request_${type}`;
    const d = evaluateAgentMemoryRequest(request, clone(fixture.cases['retrieval-reference'].context));
    assert.equal(d.decision, 'BLOCKED');
    assert.equal(d.status, 'DENY');
  }
  assert.equal(ALWAYS_BLOCKED_REQUEST_TYPES.length, 3);
});

test('registry replay payload mismatch version conflict tenant and organization block and item conflict', () => {
  const registry = createAgentMemoryRegistry();
  const item = memoryItemFixture('working-memory-reference');
  const first = registry.registerMemoryItem(item, { expected_version: 0 });
  assert.equal(first.ok, true);
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  const replay = registry.registerMemoryItem(item);
  assert.equal(replay.status, 'REPLAY_ACCEPTED');
  const mismatch = registry.registerMemoryItem({ ...item, importance_level: 'HIGH' });
  assert.equal(mismatch.status, 'PAYLOAD_MISMATCH');
  const staleConflict = registry.registerMemoryItem({ ...item, memory_item_version: 2 }, { expected_version: 99 });
  assert.equal(staleConflict.status, 'VERSION_CONFLICT');
  const fingerprintConflict = registry.registerMemoryItem({ ...item, memory_item_version: 2, memory_fingerprint: 'fp_changed' }, { expected_fingerprint: 'fp_totally_wrong' });
  assert.equal(fingerprintConflict.status, 'FINGERPRINT_CONFLICT');
  const itemConflict = registry.registerMemoryItem({ ...item, memory_item_version: 2, memory_fingerprint: 'fp_changed', agent_id: 'agent_other' });
  assert.equal(itemConflict.status, 'ITEM_CONFLICT');

  const fetched = registry.getByMemoryItemId(item.memory_item_id);
  assert.equal(Object.isFrozen(fetched), true);
  assert.throws(() => { fetched.classification = 'RESTRICTED'; }, TypeError);
  assert.equal(registry.getByTenantAndMemoryItemId(item.tenant_id, item.memory_item_id).memory_item_id, item.memory_item_id);
  assert.equal(registry.getByTenantAndMemoryItemId('tenant_other', item.memory_item_id), null);

  const otherTenantItem = memoryItemFixture('episodic-memory-reference');
  registry.registerMemoryItem(otherTenantItem, { expected_version: 0 });
  const sameTenantList = registry.listByTenant(item.tenant_id);
  assert.equal(sameTenantList.length, 1);
  const crossTenantList = registry.listByTenant(otherTenantItem.tenant_id);
  assert.equal(crossTenantList.some((record) => record.memory_item_id === item.memory_item_id), false);
});

test('memory audit is immutable structurally minimal and never contains real content', () => {
  const scenario = fixture.cases['retrieval-reference'];
  const decision = evaluateAgentMemoryRequest(clone(scenario.request), clone(scenario.context));
  const audit = buildAgentMemoryAudit({ request: clone(scenario.request), decision, context: clone(scenario.context), logical_sequence: 1 });
  assert.equal(validateAgentMemoryAudit(audit).valid, true);
  assert.equal(audit.simulation, true);
  assert.equal(audit.production_blocked, true);
  assert.equal(audit.executed, false);
  assert.equal(Object.isFrozen(audit), true);
  assert.throws(() => { audit.blockers.push('x'); }, TypeError);
  assert.deepEqual(Object.keys(audit).sort(), [
    'agent_id', 'audit_id', 'blockers', 'classification', 'contract_fingerprint', 'decision_status',
    'executed', 'item_fingerprint', 'logical_sequence', 'memory_type', 'organization_binding',
    'policy_decision_fingerprint', 'production_blocked', 'reason_codes', 'registry_version',
    'request_fingerprint', 'retention_class', 'retrieval_fingerprint', 'session_reference_id',
    'simulation', 'tenant_binding', 'validator_version'
  ].sort());
});

[
  ['api key', { api_key: 'x' }, 'forbidden_key::api_key'],
  ['secret key', { secret_value: 'x' }, 'forbidden_key'],
  ['endpoint key', { endpoint_reference: 'x' }, 'forbidden_key'],
  ['url value', { note: 'https://blocked.invalid' }, 'operational_url_value'],
  ['prompt word', { note: 'do not store the system_prompt text' }, 'forbidden_word_value'],
  ['callback word', { note: 'invokes a callback handler' }, 'forbidden_word_value']
].forEach(([name, value, reasonPrefix]) => {
  test(`operational material detector blocks ${name}`, () => {
    const found = findAgentCoreOperationalMaterial(value);
    assert.ok(found.some((entry) => entry.startsWith(reasonPrefix)), found.join(','));
  });
});

test('operational material detector avoids false positives on legitimate memory field names', () => {
  assert.deepEqual(findAgentCoreOperationalMaterial({ runtime_mutated: false }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ memory_loaded: false }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ content_stored: false }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ retrieval_executed: false }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ policy_evaluated: true }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(memoryItemFixture('semantic-memory-reference')), []);
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

  const scenario = fixture.cases['retrieval-reference'];
  const request = clone(scenario.request);
  const context = clone(scenario.context);
  const beforeRequest = JSON.stringify(request);
  const beforeContext = JSON.stringify(context);
  const decision1 = evaluateAgentMemoryRequest(request, context);
  const decision2 = evaluateAgentMemoryRequest(clone(scenario.request), clone(scenario.context));
  assert.equal(JSON.stringify(request), beforeRequest);
  assert.equal(JSON.stringify(context), beforeContext);
  assert.equal(decision1.request_fingerprint, decision2.request_fingerprint);
  const differentRequest = clone(scenario.request);
  differentRequest.memory_request_id = 'different_memory_request_id';
  const decision3 = evaluateAgentMemoryRequest(differentRequest, clone(scenario.context));
  assert.notEqual(decision1.request_fingerprint, decision3.request_fingerprint);
});

test('regression agent memory modules do not use llm tools vector store network filesystem or timers', () => {
  const files = [
    'services/api/src/core/agent-memory-contract.js',
    'services/api/src/core/agent-memory-item-contract.js',
    'services/api/src/core/agent-memory-scope.js',
    'services/api/src/core/agent-memory-policy-reference.js',
    'services/api/src/core/agent-memory-retrieval-reference.js',
    'services/api/src/core/agent-memory-request.js',
    'services/api/src/core/agent-memory-decision.js',
    'services/api/src/core/agent-memory-registry.js',
    'services/api/src/core/agent-memory-audit.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:(http|https|net|tls|dns|dgram|fs|child_process|worker_threads|vm)['"]\)/.test(source), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(source.includes('Date.now()'), false);
    assert.equal(/\bnew Date\(\)/.test(source), false);
    assert.equal(/setTimeout|setInterval/.test(source), false);
    assert.equal(/openai|anthropic|@anthropic-ai|pinecone|weaviate|qdrant|chromadb/i.test(source), false);
    assert.equal(/require\(['"](openai|@pinecone-database\/pinecone|weaviate-ts-client)['"]\)/i.test(source), false);
  }
});

test('regression agent memory contracts are not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('agent-memory'), false);
  }
});

test('regression PR79 PR80 and PR81 remain untouched by this PR', () => {
  const files = [
    'services/api/src/core/agent-core-contract.js',
    'services/api/src/core/agent-registry.js',
    'services/api/src/core/agent-policy-boundary.js',
    'services/api/src/core/agent-session-boundary.js',
    'services/api/src/core/agent-session-registry.js',
    'services/api/src/core/transcription-runtime-registration-boundary.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('agent-memory'), false);
  }
});

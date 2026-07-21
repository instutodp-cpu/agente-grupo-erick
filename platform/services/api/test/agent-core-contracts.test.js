'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-agent-core-contracts.json');
const {
  AGENT_IDENTITY_CONTRACT_VALIDATOR_VERSION,
  AGENT_STATUSES,
  AGENT_TYPES,
  AGENT_VISIBILITIES,
  findAgentCoreOperationalMaterial,
  stablePayload,
  validateAgentIdentity
} = require('../src/core/agent-identity-contract');
const {
  AGENT_CATEGORIES,
  AGENT_METADATA_CONTRACT_VALIDATOR_VERSION,
  validateAgentMetadata
} = require('../src/core/agent-metadata-contract');
const {
  AGENT_ACTOR_CONTEXT_VALIDATOR_VERSION,
  AGENT_CONTEXT_CONTRACT_VALIDATOR_VERSION,
  AGENT_REQUEST_CONTEXT_VALIDATOR_VERSION,
  AGENT_SIMULATION_CONTEXT_VALIDATOR_VERSION,
  validateActorContext,
  validateAgentContext,
  validateAgentSimulationContext
} = require('../src/core/agent-context-contract');
const {
  AGENT_LIFECYCLE_CONTRACT_VALIDATOR_VERSION,
  ALLOWED_LIFECYCLE_TRANSITIONS,
  evaluateAgentLifecycleTransition,
  validateAgentLifecycle
} = require('../src/core/agent-lifecycle-contract');
const {
  AGENT_CAPABILITY_CONTRACT_VALIDATOR_VERSION,
  AGENT_CAPABILITY_TYPES,
  validateAgentCapability
} = require('../src/core/agent-capability-contract');
const {
  AGENT_CORE_CONTRACT_VALIDATOR_VERSION,
  buildAgentCoreContract,
  validateAgentCoreContract
} = require('../src/core/agent-core-contract');
const {
  AGENT_RESPONSE_STATUSES,
  buildAgentResponse,
  validateAgentResponse
} = require('../src/core/agent-response-contract');
const { createAgentRegistry } = require('../src/core/agent-registry');
const { buildAgentCoreAudit, validateAgentCoreAudit } = require('../src/core/agent-core-audit');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function agentPieces(key) {
  const source = fixture.agents[key];
  return {
    identity: clone(source.identity),
    metadata: clone(source.metadata),
    context: clone(source.context),
    lifecycle: clone(source.lifecycle),
    capabilities: clone(source.capabilities)
  };
}

function buildValidContract(key, overrides = {}) {
  const pieces = agentPieces(key);
  return buildAgentCoreContract({
    contract_id: `contract_${key}`,
    contract_version: 1,
    identity: pieces.identity,
    metadata: pieces.metadata,
    context: pieces.context,
    lifecycle: pieces.lifecycle,
    capabilities: pieces.capabilities,
    policy_references: pieces.capabilities.flatMap((capability) => capability.policy_refs).sort(),
    dependency_references: [],
    simulation_context: pieces.context.simulation_context,
    ...overrides
  });
}

const FIXTURE_KEYS = Object.keys(fixture.agents);

test('agent core fixture and docs exist without operational material', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_AGENT_CORE_CONTRACTS.md')), true);
  assert.equal(fixture.simulation, true);
  assert.equal(fixture.production_blocked, true);
  assert.deepEqual(findAgentCoreOperationalMaterial(fixture), []);
  assert.deepEqual(FIXTURE_KEYS.sort(), [
    'audit-agent',
    'finance-analytics-agent',
    'general-assistant-agent',
    'pharmacy-specialist-agent',
    'retail-operations-agent',
    'system-agent',
    'training-agent'
  ]);
});

FIXTURE_KEYS.forEach((key) => {
  test(`fixture ${key} builds a VALIDATED_SIMULATION contract`, () => {
    const result = buildValidContract(key);
    assert.equal(result.contract.contract_status, 'VALIDATED_SIMULATION');
    assert.equal(validateAgentCoreContract(result.contract).valid, true);
    assert.equal(result.simulation, true);
    assert.equal(result.production_blocked, true);
    assert.equal(result.executed, false);
    assert.equal(result.runtime_enabled, false);
  });
});

test('agent identity valid and rejects missing extra fields', () => {
  const identity = clone(fixture.agents['general-assistant-agent'].identity);
  assert.equal(validateAgentIdentity(identity).valid, true);
  const missing = clone(identity);
  delete missing.tenant_id;
  assert.ok(validateAgentIdentity(missing).errors.includes('agent_identity_missing_tenant_id'));
  assert.ok(validateAgentIdentity({ ...identity, extra: true }).errors.includes('agent_identity_unexpected_field::extra'));
});

test('agent identity rejects invalid enums and forbidden values', () => {
  const identity = clone(fixture.agents['general-assistant-agent'].identity);
  assert.ok(validateAgentIdentity({ ...identity, agent_type: 'NOT_A_TYPE' }).errors.some((error) => error.includes('agent_type_not_allowed')));
  assert.ok(validateAgentIdentity({ ...identity, owner_type: 'NOT_A_TYPE' }).errors.some((error) => error.includes('owner_type_not_allowed')));
  assert.ok(validateAgentIdentity({ ...identity, visibility: 'PUBLIC' }).errors.includes('visibility_forbidden::PUBLIC'));
  assert.ok(validateAgentIdentity({ ...identity, status: 'ACTIVE' }).errors.includes('status_forbidden::ACTIVE'));
  assert.ok(validateAgentIdentity({ ...identity, status: 'RUNNING' }).errors.includes('status_forbidden::RUNNING'));
  assert.ok(validateAgentIdentity({ ...identity, agent_slug: 'Not Normalized' }).errors.includes('agent_slug_not_normalized'));
  assert.ok(validateAgentIdentity({ ...identity, organization_id: 'unrelated-org' }).errors.includes('organization_id_not_compatible_with_tenant'));
  assert.equal(AGENT_TYPES.length, 10);
  assert.equal(AGENT_VISIBILITIES.includes('PUBLIC'), false);
  assert.equal(AGENT_STATUSES.includes('ACTIVE'), false);
});

test('system agent identity relaxes tenant organization compatibility', () => {
  const identity = clone(fixture.agents['system-agent'].identity);
  assert.equal(identity.tenant_id, 'SYSTEM');
  assert.equal(validateAgentIdentity(identity).valid, true);
});

test('agent metadata valid and rejects invalid enums duplicate and unsorted lists', () => {
  const metadata = clone(fixture.agents['finance-analytics-agent'].metadata);
  assert.equal(validateAgentMetadata(metadata).valid, true);
  assert.ok(validateAgentMetadata({ ...metadata, category: 'NOT_A_CATEGORY' }).errors.some((error) => error.includes('category_not_allowed')));
  assert.ok(validateAgentMetadata({ ...metadata, risk_classification: 'UNKNOWN' }).errors.some((error) => error.includes('risk_classification_not_allowed')));
  assert.ok(validateAgentMetadata({ ...metadata, data_classification: 'UNKNOWN' }).errors.some((error) => error.includes('data_classification_not_allowed')));
  assert.ok(validateAgentMetadata({ ...metadata, tags: ['a', 'a'] }).errors.includes('tags_invalid'));
  assert.ok(validateAgentMetadata({ ...metadata, tags: ['b', 'a'] }).errors.includes('tags_invalid'));
  assert.ok(validateAgentMetadata({ ...metadata, tags: [] }).errors.includes('tags_invalid'));
  assert.equal(AGENT_CATEGORIES.includes('FINANCE'), true);
});

test('agent context valid and rejects unsafe session conversation actor and request flags', () => {
  const context = clone(fixture.agents['general-assistant-agent'].context);
  assert.equal(validateAgentContext(context).valid, true);
  assert.ok(validateAgentContext({ ...context, session_reference: { ...context.session_reference, session_loaded: true } }).errors.includes('session_reference_session_loaded_must_be_false'));
  assert.ok(validateAgentContext({ ...context, conversation_reference: { ...context.conversation_reference, history_mutated: true } }).errors.includes('conversation_reference_history_mutated_must_be_false'));
  assert.ok(validateAgentContext({ ...context, actor_context: { ...context.actor_context, authorization_state: 'APPROVED_REAL' } }).errors.some((error) => error.includes('authorization_state_forbidden')));
  assert.ok(validateAgentContext({ ...context, request_context: { ...context.request_context, input_processed: true } }).errors.some((error) => error.includes('input_processed_must_be_false')));
  assert.ok(validateAgentContext({ ...context, channel: 'SMS' }).errors.some((error) => error.includes('channel_not_allowed')));
  assert.ok(validateAgentContext({ ...context, actor_context: { ...context.actor_context, tenant_id: 'tenant_other' } }).errors.includes('actor_tenant_mismatch'));
  assert.equal(validateActorContext(context.actor_context).valid, true);
  assert.equal(validateAgentSimulationContext(context.simulation_context).valid, true);
  for (const field of ['runtime_enabled', 'execution_enabled', 'network_enabled', 'tools_enabled', 'memory_enabled', 'llm_enabled']) {
    assert.ok(validateAgentSimulationContext({ ...context.simulation_context, [field]: true }).errors.includes(`${field}_must_be_false`));
  }
  assert.ok(validateAgentSimulationContext({ ...context.simulation_context, rollout_percentage: 5 }).errors.includes('rollout_percentage_must_be_0'));
});

test('agent lifecycle enforces the fixed transition table and never applies', () => {
  const lifecycle = clone(fixture.agents['general-assistant-agent'].lifecycle);
  assert.equal(validateAgentLifecycle(lifecycle).valid, true);
  assert.equal(validateAgentLifecycle(lifecycle).transition_applied, false);
  assert.equal(validateAgentLifecycle(lifecycle).runtime_enabled, false);
  assert.equal(validateAgentLifecycle(lifecycle).executed, false);
  assert.equal(validateAgentLifecycle(lifecycle).production_blocked, true);
  assert.equal(validateAgentLifecycle(lifecycle).simulation, true);
  assert.ok(validateAgentLifecycle({ ...lifecycle, transition_applied: true }).errors.includes('transition_applied_must_be_false'));
  assert.ok(validateAgentLifecycle({ ...lifecycle, current_state: 'NOT_A_STATE' }).errors.some((error) => error.includes('current_state_not_allowed')));

  const allowedPairs = [];
  const disallowedPairs = [];
  for (const state of Object.keys(ALLOWED_LIFECYCLE_TRANSITIONS)) {
    for (const target of ['DRAFT', 'VALIDATED', 'REGISTERED_SIMULATION', 'SUSPENDED', 'ARCHIVED']) {
      (ALLOWED_LIFECYCLE_TRANSITIONS[state].includes(target) ? allowedPairs : disallowedPairs).push([state, target]);
    }
  }
  for (const [current, target] of allowedPairs) {
    const evaluation = evaluateAgentLifecycleTransition({
      lifecycle_id: 'lifecycle_x', agent_id: 'agent_x', tenant_id: 'tenant_x',
      current_state: current, requested_transition: target, lifecycle_version: 1,
      validator_version: AGENT_LIFECYCLE_CONTRACT_VALIDATOR_VERSION
    });
    assert.equal(evaluation.record.transition_allowed, true, `${current}->${target} should be allowed`);
    assert.equal(evaluation.record.transition_applied, false);
  }
  for (const [current, target] of disallowedPairs) {
    const evaluation = evaluateAgentLifecycleTransition({
      lifecycle_id: 'lifecycle_x', agent_id: 'agent_x', tenant_id: 'tenant_x',
      current_state: current, requested_transition: target, lifecycle_version: 1,
      validator_version: AGENT_LIFECYCLE_CONTRACT_VALIDATOR_VERSION
    });
    assert.equal(evaluation.record.transition_allowed, false, `${current}->${target} should be blocked`);
    assert.equal(evaluation.record.transition_applied, false);
  }
  assert.equal(Object.isFrozen(evaluateAgentLifecycleTransition({
    lifecycle_id: 'lifecycle_y', agent_id: 'agent_y', tenant_id: 'tenant_y',
    current_state: 'DRAFT', requested_transition: 'VALIDATED', lifecycle_version: 1,
    validator_version: AGENT_LIFECYCLE_CONTRACT_VALIDATOR_VERSION
  }).record), true);
});

test('agent capability valid and rejects unsafe flags and invalid type', () => {
  const capability = clone(fixture.agents['general-assistant-agent'].capabilities[0]);
  assert.equal(validateAgentCapability(capability).valid, true);
  for (const field of ['enabled', 'execution_allowed', 'network_required', 'tools_required', 'memory_required', 'llm_required']) {
    assert.ok(validateAgentCapability({ ...capability, [field]: true }).errors.includes(`${field}_must_be_true`) || validateAgentCapability({ ...capability, [field]: true }).errors.some((error) => error.includes(field)));
  }
  assert.ok(validateAgentCapability({ ...capability, capability_type: 'NOT_A_TYPE' }).errors.some((error) => error.includes('capability_type_not_allowed')));
  assert.ok(validateAgentCapability({ ...capability, rollout_percentage: 10 }).errors.some((error) => error.includes('rollout_percentage')));
  assert.ok(validateAgentCapability({ ...capability, policy_refs: ['b', 'a'] }).errors.includes('policy_refs_invalid'));
  assert.ok(validateAgentCapability({ ...capability, dependency_refs: ['x', 'x'] }).errors.includes('dependency_refs_invalid'));
  assert.equal(AGENT_CAPABILITY_TYPES.length, 14);
});

test('core contract blocks tenant mismatch across identity metadata context lifecycle capability', () => {
  const pieces = agentPieces('general-assistant-agent');
  pieces.metadata.tenant_id = 'tenant_other';
  const result = buildAgentCoreContract({
    contract_id: 'contract_mismatch', contract_version: 1,
    identity: pieces.identity, metadata: pieces.metadata, context: pieces.context, lifecycle: pieces.lifecycle,
    capabilities: pieces.capabilities, policy_references: [], dependency_references: [],
    simulation_context: pieces.context.simulation_context
  });
  assert.equal(result.contract.contract_status, 'TENANT_BLOCKED');
  assert.equal(result.contract.validation_summary.tenant_binding_valid, false);
});

test('core contract blocks agent_id mismatch as tenant binding failure', () => {
  const pieces = agentPieces('general-assistant-agent');
  pieces.context.agent_id = 'agent_other';
  const result = buildAgentCoreContract({
    contract_id: 'contract_mismatch_agent', contract_version: 1,
    identity: pieces.identity, metadata: pieces.metadata, context: pieces.context, lifecycle: pieces.lifecycle,
    capabilities: pieces.capabilities, policy_references: [], dependency_references: [],
    simulation_context: pieces.context.simulation_context
  });
  assert.equal(result.contract.contract_status, 'TENANT_BLOCKED');
});

test('core contract blocks organization mismatch invalid pieces and version', () => {
  const pieces = agentPieces('general-assistant-agent');
  const orgMismatch = buildAgentCoreContract({
    contract_id: 'contract_org_mismatch', contract_version: 1,
    identity: pieces.identity, metadata: pieces.metadata,
    context: { ...pieces.context, organization_id: 'unrelated-org:org' },
    lifecycle: pieces.lifecycle, capabilities: pieces.capabilities,
    policy_references: [], dependency_references: [], simulation_context: pieces.context.simulation_context
  });
  assert.equal(orgMismatch.contract.validation_summary.organization_binding_valid, false);

  const invalidPiece = buildAgentCoreContract({
    contract_id: 'contract_invalid_piece', contract_version: 1,
    identity: { ...pieces.identity, status: 'ACTIVE' }, metadata: pieces.metadata, context: pieces.context,
    lifecycle: pieces.lifecycle, capabilities: pieces.capabilities,
    policy_references: [], dependency_references: [], simulation_context: pieces.context.simulation_context
  });
  assert.equal(invalidPiece.contract.contract_status, 'INVALID');

  const missingVersion = buildAgentCoreContract({
    contract_id: 'contract_no_version',
    identity: pieces.identity, metadata: pieces.metadata, context: pieces.context, lifecycle: pieces.lifecycle,
    capabilities: pieces.capabilities, policy_references: [], dependency_references: [], simulation_context: pieces.context.simulation_context
  });
  assert.equal(missingVersion.contract.validation_summary.versions_valid, false);
});

test('core contract statuses never include ACTIVE or EXECUTABLE', () => {
  const { FORBIDDEN_AGENT_CONTRACT_STATUSES } = require('../src/core/agent-core-contract');
  assert.deepEqual(FORBIDDEN_AGENT_CONTRACT_STATUSES, ['ACTIVE', 'EXECUTABLE']);
});

test('agent response contract forces sanitized safe flags and validates', () => {
  const response = buildAgentResponse({
    response_id: 'response_1', request_id: 'request_1', agent_id: 'agent_1', tenant_id: 'tenant_demo',
    status: 'VALIDATED_SIMULATION', decision_reason: 'contract_reviewed_simulation_only',
    contract_fingerprint: 'fp_contract', context_fingerprint: 'fp_context',
    capability_fingerprints: ['fp_b', 'fp_a'], lifecycle_state: 'REGISTERED_SIMULATION'
  });
  assert.equal(validateAgentResponse(response).valid, true);
  assert.equal(response.response_content_present, false);
  assert.equal(response.llm_called, false);
  assert.equal(response.tool_called, false);
  assert.equal(response.memory_read, false);
  assert.equal(response.memory_written, false);
  assert.equal(response.network_used, false);
  assert.equal(response.executed, false);
  assert.deepEqual([...response.capability_fingerprints], ['fp_a', 'fp_b']);
  assert.equal(Object.isFrozen(response), true);
  assert.equal(AGENT_RESPONSE_STATUSES.includes('VALIDATED_SIMULATION'), true);
  const invalid = buildAgentResponse({ status: 'NOT_A_STATUS' });
  assert.equal(invalid.status, 'VALIDATION_FAILED');
});

test('registry replay payload mismatch version conflict tenant isolation and defensive clone', () => {
  const registry = createAgentRegistry();
  const built = buildValidContract('general-assistant-agent');
  const first = registry.registerAgentContract(built.contract, { expected_version: 0 });
  assert.equal(first.ok, true);
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  assert.equal(first.simulation, true);
  assert.equal(first.production_blocked, true);
  assert.equal(first.executed, false);

  const replay = registry.registerAgentContract(built.contract);
  assert.equal(replay.status, 'REPLAY_ACCEPTED');

  const tampered = { ...built.contract, metadata: { ...built.contract.metadata, business_domain: 'changed_domain' } };
  const mismatch = registry.registerAgentContract(tampered);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.status, 'PAYLOAD_MISMATCH');

  const staleConflict = registry.registerAgentContract({ ...built.contract, contract_version: 2 }, { expected_version: 99 });
  assert.equal(staleConflict.status, 'VERSION_CONFLICT');

  const fetched = registry.getByAgentId(built.contract.identity.agent_id);
  assert.equal(Object.isFrozen(fetched), true);
  assert.throws(() => { fetched.identity.display_name = 'mutated'; }, TypeError);

  const bySlug = registry.getBySlugAndTenant(built.contract.identity.agent_slug, built.contract.identity.tenant_id);
  assert.equal(bySlug.identity.agent_id, built.contract.identity.agent_id);

  const otherKey = FIXTURE_KEYS.find((key) => key !== 'general-assistant-agent');
  const otherBuilt = buildValidContract(otherKey);
  registry.registerAgentContract(otherBuilt.contract, { expected_version: 0 });

  const sameTenantList = registry.listByTenant(built.contract.identity.tenant_id);
  assert.equal(sameTenantList.length, 1);
  assert.equal(sameTenantList[0].identity.agent_id, built.contract.identity.agent_id);

  const crossTenantList = registry.listByTenant(otherBuilt.contract.identity.tenant_id);
  assert.equal(crossTenantList.every((record) => record.identity.tenant_id === otherBuilt.contract.identity.tenant_id), true);
  assert.equal(crossTenantList.some((record) => record.identity.agent_id === built.contract.identity.agent_id), false);
});

test('registry rejects contracts that are not VALIDATED_SIMULATION', () => {
  const registry = createAgentRegistry();
  const pieces = agentPieces('general-assistant-agent');
  pieces.metadata.tenant_id = 'tenant_other';
  const blocked = buildAgentCoreContract({
    contract_id: 'contract_registry_blocked', contract_version: 1,
    identity: pieces.identity, metadata: pieces.metadata, context: pieces.context, lifecycle: pieces.lifecycle,
    capabilities: pieces.capabilities, policy_references: [], dependency_references: [],
    simulation_context: pieces.context.simulation_context
  });
  const registered = registry.registerAgentContract(blocked.contract);
  assert.equal(registered.ok, false);
  assert.equal(registered.status, 'TENANT_BLOCKED');
});

test('agent core audit is immutable never contains real content and always simulated', () => {
  const built = buildValidContract('finance-analytics-agent');
  const audit = buildAgentCoreAudit({
    contract: built.contract,
    contract_fingerprint: built.contract_fingerprint,
    context_fingerprint: built.context_fingerprint,
    capability_fingerprints: built.capability_fingerprints,
    registry_decision: 'REGISTERED_SIMULATION',
    blockers: [],
    logical_sequence: 1
  });
  assert.equal(validateAgentCoreAudit(audit).valid, true);
  assert.equal(audit.simulation, true);
  assert.equal(audit.production_blocked, true);
  assert.equal(audit.executed, false);
  assert.equal(Object.isFrozen(audit), true);
  assert.throws(() => { audit.blockers.push('mutate'); }, TypeError);
  assert.deepEqual(Object.keys(audit).sort(), [
    'audit_id', 'blockers', 'capability_fingerprints', 'context_fingerprint', 'contract_fingerprint',
    'contract_id', 'executed', 'identity_fingerprint', 'lifecycle_fingerprint', 'lifecycle_state',
    'logical_sequence', 'metadata_fingerprint', 'organization_binding', 'production_blocked',
    'registry_decision', 'simulation', 'tenant_binding', 'validator_version', 'version_bindings'
  ]);
});

[
  ['api key', { api_key: 'x' }, 'forbidden_key::api_key'],
  ['secret key', { secret_value: 'x' }, 'forbidden_key'],
  ['token key', { access_token: 'x' }, 'forbidden_key'],
  ['password key', { password_hint: 'x' }, 'forbidden_key'],
  ['endpoint key', { endpoint_reference: 'x' }, 'forbidden_key'],
  ['url value', { note: 'https://blocked.invalid' }, 'operational_url_value'],
  ['callback word', { note: 'invokes a callback handler' }, 'forbidden_word_value'],
  ['prompt word', { note: 'uses a system_prompt internally' }, 'forbidden_word_value'],
  ['provider word', { note: 'calls the model provider sdk' }, 'forbidden_word_value'],
  ['function code', { note: 'function runtime() { return 1; }' }, 'forbidden_word_value']
].forEach(([name, value, reasonPrefix]) => {
  test(`operational material detector blocks ${name}`, () => {
    const found = findAgentCoreOperationalMaterial(value);
    assert.ok(found.some((entry) => entry.startsWith(reasonPrefix)), found.join(','));
  });
});

test('operational material detector rejects executable-like structures NaN Infinity bigint symbol cyclic reference', () => {
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.NaN }).some((error) => error.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.POSITIVE_INFINITY }).some((error) => error.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: BigInt(1) }).some((error) => error.includes('forbidden_bigint')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Symbol('x') }).some((error) => error.includes('forbidden_symbol')));
  assert.ok(findAgentCoreOperationalMaterial({ value: () => null }).some((error) => error.includes('forbidden_function')));
  const cyclic = {};
  cyclic.self = cyclic;
  assert.ok(findAgentCoreOperationalMaterial(cyclic).some((error) => error.includes('forbidden_cycle')));
});

test('operational material detector does not false positive on legitimate contract field names', () => {
  assert.deepEqual(findAgentCoreOperationalMaterial({ runtime_enabled: false }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ authorization_state: 'UNVERIFIED' }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ supported_locales: ['pt-BR'] }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ description: 'Supports import and export reporting for logistics.' }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(clone(fixture.agents['general-assistant-agent'])), []);
});

test('fingerprints are deterministic and change when payload changes', () => {
  const built1 = buildValidContract('training-agent');
  const built2 = buildValidContract('training-agent');
  assert.equal(built1.contract_fingerprint, built2.contract_fingerprint);
  const pieces = agentPieces('training-agent');
  pieces.metadata.declared_purpose = 'A different declared purpose changes the fingerprint value here.';
  const built3 = buildAgentCoreContract({
    contract_id: 'contract_training', contract_version: 1,
    identity: pieces.identity, metadata: pieces.metadata, context: pieces.context, lifecycle: pieces.lifecycle,
    capabilities: pieces.capabilities, policy_references: [], dependency_references: [],
    simulation_context: pieces.context.simulation_context
  });
  assert.notEqual(built1.contract_fingerprint, built3.contract_fingerprint);
});

test('build does not mutate caller input and returns defensive clones', () => {
  const pieces = agentPieces('audit-agent');
  const beforeIdentity = JSON.stringify(pieces.identity);
  const beforeCapabilities = JSON.stringify(pieces.capabilities);
  const result = buildAgentCoreContract({
    contract_id: 'contract_audit_immutable', contract_version: 1,
    identity: pieces.identity, metadata: pieces.metadata, context: pieces.context, lifecycle: pieces.lifecycle,
    capabilities: pieces.capabilities, policy_references: [], dependency_references: [],
    simulation_context: pieces.context.simulation_context
  });
  assert.equal(JSON.stringify(pieces.identity), beforeIdentity);
  assert.equal(JSON.stringify(pieces.capabilities), beforeCapabilities);
  assert.equal(Object.isFrozen(result.contract), true);
  assert.equal(Object.isFrozen(result.contract.identity), true);
  assert.equal(Object.isFrozen(result.contract.capabilities), true);
  assert.throws(() => { result.contract.identity.display_name = 'mutated'; }, TypeError);
  assert.notEqual(result.contract.identity, pieces.identity);
});

test('stable payload is deterministic regardless of key order', () => {
  const a = stablePayload({ b: 1, a: 2 });
  const b = stablePayload({ a: 2, b: 1 });
  assert.equal(a, b);
});

test('regression agent core modules do not use llm tools memory network filesystem or env', () => {
  const files = [
    'services/api/src/core/agent-identity-contract.js',
    'services/api/src/core/agent-metadata-contract.js',
    'services/api/src/core/agent-context-contract.js',
    'services/api/src/core/agent-lifecycle-contract.js',
    'services/api/src/core/agent-capability-contract.js',
    'services/api/src/core/agent-core-contract.js',
    'services/api/src/core/agent-response-contract.js',
    'services/api/src/core/agent-registry.js',
    'services/api/src/core/agent-core-audit.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:(http|https|net|tls|dns|dgram|fs|child_process|worker_threads|vm)['"]\)/.test(source), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('axios'), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(source.includes('Date.now()'), false);
    assert.equal(/\bnew Date\(\)/.test(source), false);
    assert.equal(/openai|anthropic|@anthropic-ai|assemblyai|deepgram|require\(['"]grpc['"]\)|eval\(|new Function\(|require\(['"]vm['"]\)/i.test(source), false);
  }
});

test('regression agent core is not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('agent-core'), false);
    assert.equal(source.includes('agent-identity'), false);
    assert.equal(source.includes('agent-registry'), false);
  }
});

test('regression previous transcription and runtime registration boundaries remain untouched', () => {
  const files = [
    'services/api/src/core/transcription-orchestrator.js',
    'services/api/src/core/transcription-runtime-registration-boundary.js',
    'services/api/src/core/transcription-network-permission-boundary.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('agent-core-contract'), false);
    assert.equal(source.includes('agent-registry'), false);
  }
});

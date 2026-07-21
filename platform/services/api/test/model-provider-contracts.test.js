'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-model-provider-contracts.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  DEPLOYMENT_MODES,
  FORBIDDEN_PROVIDER_STATUSES,
  MODEL_PROVIDER_CONTRACT_VALIDATOR_VERSION,
  PROVIDER_STATUSES,
  PROVIDER_TYPES,
  validateModelProviderContract
} = require('../src/core/model-provider-contract');
const {
  FORBIDDEN_MODEL_STATUSES,
  FORBIDDEN_PRIVACY_TIERS,
  MODALITIES,
  MODEL_CONTRACT_VALIDATOR_VERSION,
  MODEL_STATUSES,
  validateModelContract,
  validateReferenceList,
  validateSingleReference
} = require('../src/core/model-contract');
const { MODEL_CAPABILITY_CONTRACT_VALIDATOR_VERSION, validateModelCapabilityContract } = require('../src/core/model-capability-contract');
const { MODEL_PRICING_CONTRACT_VALIDATOR_VERSION, validateModelPricingContract } = require('../src/core/model-pricing-contract');
const { MODEL_LIMITS_CONTRACT_VALIDATOR_VERSION, validateModelLimitsContract } = require('../src/core/model-limits-contract');
const { MODEL_AVAILABILITY_CONTRACT_VALIDATOR_VERSION, validateModelAvailabilityContract } = require('../src/core/model-availability-contract');
const { MODEL_PRIVACY_CONTRACT_VALIDATOR_VERSION, validateModelPrivacyContract } = require('../src/core/model-privacy-contract');
const { MODEL_HEALTH_CONTRACT_VALIDATOR_VERSION, validateModelHealthContract } = require('../src/core/model-health-contract');
const { MODEL_SELECTION_REFERENCE_VALIDATOR_VERSION, validateModelSelectionReference } = require('../src/core/model-selection-reference');
const {
  DECISION_STATUSES,
  DECISION_VALUES,
  MODEL_PROVIDER_DECISION_SAFE_FLAGS,
  evaluateModelProviderDecision,
  validateModelProviderDecision
} = require('../src/core/model-provider-decision');
const { createModelProviderRegistry } = require('../src/core/model-provider-registry');
const { buildModelProviderAudit, validateModelProviderAudit } = require('../src/core/model-provider-audit');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const SCENARIO_KEYS = [
  'zero-cost-local-model-reference', 'low-cost-text-model-reference', 'standard-reasoning-model-reference',
  'premium-reasoning-model-reference', 'long-context-model-reference', 'structured-output-model-reference',
  'tool-calling-model-reference', 'vision-model-reference', 'transcription-model-reference',
  'unavailable-model-reference', 'unknown-pricing-model-reference', 'restricted-privacy-model-reference',
  'tenant-mismatch-model-reference', 'provider-model-version-conflict', 'replay-provider-reference'
];

function scenario(key) {
  return clone(fixture.scenarios[key]);
}

test('fixture and docs exist without operational material and cover all required scenarios', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_MODEL_PROVIDER_CONTRACTS.md')), true);
  assert.deepEqual(Object.keys(fixture.scenarios).sort(), [...SCENARIO_KEYS].sort());
  assert.deepEqual(findAgentCoreOperationalMaterial(fixture), []);
});

SCENARIO_KEYS.forEach((key) => {
  test(`fixture scenario ${key} matches its expected provider and model validity`, () => {
    const s = scenario(key);
    assert.equal(validateModelProviderContract(s.provider).valid, s.expected_provider_valid);
    assert.equal(validateModelContract(s.model).valid, s.expected_model_valid);
  });
});

test('provider contract valid and rejects missing extra invalid enums forbidden status', () => {
  const provider = scenario('standard-reasoning-model-reference').provider;
  assert.equal(validateModelProviderContract(provider).valid, true);
  const missing = clone(provider);
  delete missing.tenant_id;
  assert.ok(validateModelProviderContract(missing).errors.some((error) => error.includes('missing_tenant_id')));
  assert.ok(validateModelProviderContract({ ...provider, extra: true }).errors.some((error) => error.includes('unexpected_field::extra')));
  assert.ok(validateModelProviderContract({ ...provider, provider_type: 'NOT_A_TYPE' }).errors.some((error) => error.includes('provider_type_not_allowed')));
  assert.ok(validateModelProviderContract({ ...provider, provider_status: 'ACTIVE' }).errors.includes('provider_status_forbidden::ACTIVE'));
  assert.ok(validateModelProviderContract({ ...provider, deployment_mode: 'NOT_A_MODE' }).errors.some((error) => error.includes('deployment_mode_not_allowed')));
  assert.ok(validateModelProviderContract({ ...provider, organization_id: 'unrelated-org' }).errors.includes('organization_id_not_compatible_with_tenant'));
  assert.equal(PROVIDER_TYPES.length, 7);
  assert.equal(PROVIDER_STATUSES.length, 6);
  assert.equal(DEPLOYMENT_MODES.length, 5);
  for (const status of FORBIDDEN_PROVIDER_STATUSES) {
    assert.ok(validateModelProviderContract({ ...provider, provider_status: status }).errors.includes(`provider_status_forbidden::${status}`));
  }
});

test('model contract valid and rejects missing extra invalid enums forbidden status restricted privacy and exceeded context', () => {
  const model = scenario('standard-reasoning-model-reference').model;
  assert.equal(validateModelContract(model).valid, true);
  const missing = clone(model);
  delete missing.model_id;
  assert.ok(validateModelContract(missing).errors.some((error) => error.includes('missing_model_id')));
  assert.ok(validateModelContract({ ...model, extra: true }).errors.some((error) => error.includes('unexpected_field::extra')));
  assert.ok(validateModelContract({ ...model, model_status: 'NOT_A_STATUS' }).errors.some((error) => error.includes('model_status_not_allowed')));
  for (const status of FORBIDDEN_MODEL_STATUSES) {
    assert.ok(validateModelContract({ ...model, model_status: status }).errors.includes(`model_status_forbidden::${status}`));
  }
  const restrictedModel = scenario('restricted-privacy-model-reference').model;
  assert.equal(validateModelContract(restrictedModel).valid, false);
  assert.ok(validateModelContract(restrictedModel).errors.includes('privacy_tier_forbidden::RESTRICTED_BLOCKED'));
  assert.ok(validateModelContract({ ...model, context_window_tokens: 100 }).errors.includes('context_window_tokens_below_component_limit'));
  assert.ok(validateModelContract({ ...model, supported_modalities: ['TEXT_OUTPUT', 'TEXT_INPUT'] }).errors.includes('supported_modalities_invalid'));
  assert.equal(MODALITIES.length, 12);
  assert.equal(FORBIDDEN_PRIVACY_TIERS.includes('RESTRICTED_BLOCKED'), true);
  assert.equal(MODEL_STATUSES.includes('VALIDATED_SIMULATION'), true);
});

test('single reference and reference list validators are structurally strict', () => {
  const model = scenario('standard-reasoning-model-reference').model;
  assert.equal(validateSingleReference(model.pricing_reference).valid, true);
  assert.ok(validateSingleReference({ ...model.pricing_reference, extra: 1 }).errors.some((error) => error.includes('unexpected_field')));
  assert.equal(validateReferenceList(model.capability_references).valid, true);
  assert.ok(!validateReferenceList([{ reference_id: 'a', reference_version: 1, reference_fingerprint: 'fp', validator_version: model.validator_version }, { reference_id: 'a', reference_version: 1, reference_fingerprint: 'fp', validator_version: model.validator_version }]).valid);
});

test('leaf record contracts (capability pricing limits availability privacy health) are valid and reject their forced-false flags', () => {
  const s = scenario('standard-reasoning-model-reference');
  assert.equal(validateModelCapabilityContract(s.capability).valid, true);
  assert.equal(validateModelPricingContract(s.pricing).valid, true);
  assert.equal(validateModelLimitsContract(s.limits).valid, true);
  assert.equal(validateModelAvailabilityContract(s.availability).valid, true);
  assert.equal(validateModelPrivacyContract(s.privacy).valid, true);
  assert.equal(validateModelHealthContract(s.health).valid, true);
  assert.equal(validateModelSelectionReference(s.selection_reference).valid, true);

  assert.ok(validateModelPricingContract({ ...s.pricing, pricing_verified: true }).errors.includes('pricing_verified_must_be_false'));
  assert.ok(validateModelLimitsContract({ ...s.limits, limits_verified: true }).errors.includes('limits_verified_must_be_false'));
  assert.ok(validateModelAvailabilityContract({ ...s.availability, availability_verified: true }).errors.includes('availability_verified_must_be_false'));
  assert.ok(validateModelPrivacyContract({ ...s.privacy, restricted_data_allowed: true }).errors.includes('restricted_data_allowed_must_be_false'));
  assert.ok(validateModelPrivacyContract({ ...s.privacy, privacy_verified: true }).errors.includes('privacy_verified_must_be_false'));
  assert.ok(validateModelHealthContract({ ...s.health, health_verified: true }).errors.includes('health_verified_must_be_false'));
  assert.ok(validateModelHealthContract({ ...s.health, network_checked: true }).errors.includes('network_checked_must_be_false'));
  assert.ok(validateModelHealthContract({ ...s.health, provider_called: true }).errors.includes('provider_called_must_be_false'));

  assert.ok(!Number.isNaN(s.pricing.input_cost_minor_units_per_million));
  assert.equal(Number.isFinite(s.limits.maximum_context_tokens), true);
  assert.ok(!validateModelLimitsContract({ ...s.limits, maximum_context_tokens: Number.NaN }).valid);
  assert.ok(!validateModelLimitsContract({ ...s.limits, maximum_context_tokens: Infinity }).valid);
});

test('model selection reference forces requested true executed false and null selections and rejects declarative violations', () => {
  const selection = scenario('standard-reasoning-model-reference').selection_reference;
  assert.equal(validateModelSelectionReference(selection).valid, true);
  assert.ok(validateModelSelectionReference({ ...selection, selection_requested: false }).errors.includes('selection_requested_must_be_true'));
  assert.ok(validateModelSelectionReference({ ...selection, selection_executed: true }).errors.includes('selection_executed_must_be_false'));
  assert.ok(validateModelSelectionReference({ ...selection, selected_provider_id: 'x' }).errors.includes('selected_provider_id_must_be_null'));
  assert.ok(validateModelSelectionReference({ ...selection, selected_model_id: 'x' }).errors.includes('selected_model_id_must_be_null'));
  assert.ok(validateModelSelectionReference({ ...selection, privacy_requirement_reference: 'RESTRICTED_BLOCKED' }).errors.includes('privacy_requirement_reference_forbidden::RESTRICTED_BLOCKED'));
  assert.ok(validateModelSelectionReference({ ...selection, required_capabilities: [] }).errors.includes('required_capabilities_invalid'));
  assert.equal(typeof selection.free_or_low_cost_preferred, 'boolean');
  assert.equal(typeof selection.local_preferred, 'boolean');
  assert.equal(typeof selection.fallback_allowed_reference, 'boolean');
  assert.equal(typeof selection.escalation_allowed_reference, 'boolean');
});

function decisionContext(key, overrides = {}) {
  const s = scenario(key);
  return {
    decision_id: `decision-${key}`,
    provider: s.provider,
    model: s.model,
    capabilities: [s.capability],
    pricing: s.pricing,
    limits: s.limits,
    availability: s.availability,
    privacy: s.privacy,
    health: s.health,
    selectionReference: s.selection_reference,
    tenant_id: s.provider.tenant_id,
    organization_id: s.provider.organization_id,
    registry_version: 'registry-v1',
    ...overrides
  };
}

test('decision evaluator validates provider reference in isolation', () => {
  const context = decisionContext('standard-reasoning-model-reference');
  const decision = evaluateModelProviderDecision('VALIDATE_PROVIDER_REFERENCE', context);
  assert.equal(validateModelProviderDecision(decision).valid, true);
  assert.equal(decision.status, 'ELIGIBLE_SIMULATION');
  assert.equal(decision.decision, 'VALIDATE_PROVIDER_REFERENCE');
  assert.equal(decision.provider_validated, true);
  assert.equal(decision.eligible_in_simulation, false);
});

test('decision evaluator validates model reference and rejects provider and version mismatch', () => {
  const context = decisionContext('standard-reasoning-model-reference');
  const decision = evaluateModelProviderDecision('VALIDATE_MODEL_REFERENCE', context);
  assert.equal(decision.status, 'ELIGIBLE_SIMULATION');
  assert.equal(decision.model_validated, true);

  const conflictContext = decisionContext('standard-reasoning-model-reference', { model: { ...context.model, provider_id: 'unrelated-service-ref' } });
  const conflict = evaluateModelProviderDecision('VALIDATE_MODEL_REFERENCE', conflictContext);
  assert.equal(conflict.status, 'CONFLICT_BLOCKED');

  const versionContext = decisionContext('provider-model-version-conflict');
  const versionDecision = evaluateModelProviderDecision('VALIDATE_MODEL_REFERENCE', versionContext);
  assert.equal(versionDecision.status, 'VERSION_BLOCKED');

  const tenantContext = decisionContext('tenant-mismatch-model-reference');
  const tenantDecision = evaluateModelProviderDecision('VALIDATE_MODEL_REFERENCE', tenantContext);
  assert.equal(tenantDecision.status, 'TENANT_BLOCKED');
});

test('decision evaluator eligibility path allows a fully compatible reference bundle', () => {
  const context = decisionContext('standard-reasoning-model-reference');
  const decision = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', context);
  assert.equal(validateModelProviderDecision(decision).valid, true);
  assert.equal(decision.status, 'ELIGIBLE_SIMULATION');
  assert.equal(decision.eligible_in_simulation, true);
  assert.equal(decision.blockers.length, 0);
  for (const [field, expected] of Object.entries(MODEL_PROVIDER_DECISION_SAFE_FLAGS)) {
    assert.equal(decision[field], expected);
  }
});

test('decision evaluator eligibility path blocks unavailable unknown-pricing and restricted scenarios', () => {
  const unavailable = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', decisionContext('unavailable-model-reference'));
  assert.equal(unavailable.status, 'AVAILABILITY_BLOCKED');
  assert.equal(unavailable.eligible_in_simulation, false);

  const unknownPricing = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', decisionContext('unknown-pricing-model-reference'));
  assert.equal(unknownPricing.status, 'PRICING_BLOCKED');

  const restricted = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', decisionContext('restricted-privacy-model-reference'));
  assert.equal(restricted.status, 'VALIDATION_FAILED');
});

test('decision evaluator eligibility path blocks cost above limit context exceeded input exceeded output exceeded capability mismatch modality mismatch and health/privacy incompatibility', () => {
  const base = decisionContext('standard-reasoning-model-reference');

  const costBlocked = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', { ...base, pricing: { ...base.pricing, input_cost_minor_units_per_million: base.selectionReference.maximum_cost_minor_units_reference + 100000 } });
  assert.equal(costBlocked.status, 'PRICING_BLOCKED');

  const contextExceeded = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', { ...base, selectionReference: { ...base.selectionReference, maximum_input_tokens_reference: base.model.context_window_tokens, maximum_output_tokens_reference: base.model.context_window_tokens } });
  assert.equal(contextExceeded.status, 'LIMIT_BLOCKED');

  const inputExceeded = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', { ...base, selectionReference: { ...base.selectionReference, maximum_input_tokens_reference: base.limits.maximum_input_tokens + 1 } });
  assert.equal(inputExceeded.status, 'LIMIT_BLOCKED');

  const outputExceeded = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', { ...base, selectionReference: { ...base.selectionReference, maximum_output_tokens_reference: base.limits.maximum_output_tokens + 1 } });
  assert.equal(outputExceeded.status, 'LIMIT_BLOCKED');

  const capabilityMismatch = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', { ...base, selectionReference: { ...base.selectionReference, required_capabilities: ['VISION_REFERENCE'] } });
  assert.equal(capabilityMismatch.status, 'CAPABILITY_BLOCKED');

  const modalityMismatch = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', { ...base, selectionReference: { ...base.selectionReference, preferred_modalities: ['IMAGE_INPUT_REFERENCE'] } });
  assert.equal(modalityMismatch.status, 'CAPABILITY_BLOCKED');

  const healthUnknown = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', { ...base, health: { ...base.health, health_status: 'UNKNOWN_BLOCKED' } });
  assert.equal(healthUnknown.status, 'HEALTH_BLOCKED');

  const privacyIncompatible = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', { ...base, selectionReference: { ...base.selectionReference, privacy_requirement_reference: 'LOCAL_PROCESSING_REFERENCE' } });
  assert.equal(privacyIncompatible.status, 'PRIVACY_BLOCKED');

  const restrictedData = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', { ...base, selectionReference: { ...base.selectionReference, data_classification: 'RESTRICTED' } });
  assert.equal(restrictedData.status, 'PRIVACY_BLOCKED');
});

test('decision safe flags never allow model selection provider calls network tokens or cost and reject organization mismatch', () => {
  const decision = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', decisionContext('standard-reasoning-model-reference'));
  assert.equal(decision.model_selected, false);
  assert.equal(decision.provider_called, false);
  assert.equal(decision.network_used, false);
  assert.equal(decision.tokens_consumed, false);
  assert.equal(decision.cost_consumed, false);
  assert.equal(decision.executed, false);
  assert.equal(decision.runtime_enabled, false);
  assert.equal(decision.simulation, true);
  assert.equal(decision.production_blocked, true);
  assert.equal(decision.rollout_percentage, 0);
  assert.equal(Object.isFrozen(decision), true);

  const orgMismatch = evaluateModelProviderDecision('VALIDATE_PROVIDER_REFERENCE', decisionContext('standard-reasoning-model-reference', { organization_id: 'tenant-a:org-other' }));
  assert.equal(orgMismatch.status, 'ORGANIZATION_BLOCKED');

  assert.equal(DECISION_STATUSES.length, 13);
  assert.equal(DECISION_VALUES.includes('BLOCKED'), true);
});

test('registry replay payload mismatch version conflict tenant organization block and cross-store validation', () => {
  const registry = createModelProviderRegistry();
  const s = scenario('replay-provider-reference');

  const first = registry.registerProvider(s.provider, { expected_version: 0 });
  assert.equal(first.ok, true);
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  const replay = registry.registerProvider(s.provider);
  assert.equal(replay.status, 'REPLAY_ACCEPTED');

  const bumped = { ...s.provider, provider_version: 2, display_name: 'Updated display name' };
  const versionBump = registry.registerProvider(bumped);
  assert.equal(versionBump.status, 'REGISTERED_SIMULATION');

  const downgrade = registry.registerProvider({ ...s.provider, display_name: 'Different name same version' });
  assert.equal(downgrade.status, 'VERSION_CONFLICT');

  const modelBeforeProvider = registry.registerModel(scenario('unavailable-model-reference').model);
  assert.equal(modelBeforeProvider.status, 'VALIDATION_FAILED');

  const target = scenario('standard-reasoning-model-reference');
  registry.registerProvider(target.provider, { expected_version: 0 });
  const modelRegistered = registry.registerModel(target.model, { expected_version: 0 });
  assert.equal(modelRegistered.status, 'REGISTERED_SIMULATION');
  const capabilityBeforeModelMissing = registry.registerCapability({ ...target.capability, model_id: 'unregistered-model-ref' });
  assert.equal(capabilityBeforeModelMissing.status, 'VALIDATION_FAILED');
  const capabilityRegistered = registry.registerCapability(target.capability, { expected_version: 0 });
  assert.equal(capabilityRegistered.status, 'REGISTERED_SIMULATION');
  assert.equal(registry.registerPricing(target.pricing, { expected_version: 0 }).status, 'REGISTERED_SIMULATION');
  assert.equal(registry.registerLimits(target.limits).status, 'REGISTERED_SIMULATION');
  assert.equal(registry.registerAvailability(target.availability).status, 'REGISTERED_SIMULATION');
  assert.equal(registry.registerPrivacy(target.privacy).status, 'REGISTERED_SIMULATION');
  assert.equal(registry.registerHealth(target.health).status, 'REGISTERED_SIMULATION');

  const fetchedProvider = registry.getProviderById(target.provider.provider_id);
  assert.equal(Object.isFrozen(fetchedProvider), true);
  assert.throws(() => { fetchedProvider.display_name = 'mutated'; }, TypeError);
  assert.equal(registry.getModelById(target.model.model_id).model_id, target.model.model_id);
  assert.equal(registry.getCapabilityById(target.capability.capability_id).capability_id, target.capability.capability_id);

  const listed = registry.listModelsByTenant(target.model.tenant_id, { quality_tier: 'STANDARD', capability_type: 'REASONING_REFERENCE' });
  assert.equal(listed.some((record) => record.model_id === target.model.model_id), true);
  const listedWrongCapability = registry.listModelsByTenant(target.model.tenant_id, { capability_type: 'VISION_REFERENCE' });
  assert.equal(listedWrongCapability.some((record) => record.model_id === target.model.model_id), false);
  const crossTenantList = registry.listModelsByTenant('tenant-other');
  assert.equal(crossTenantList.length, 0);

  const reassign = registry.registerModel({ ...target.model, provider_id: bumped.provider_id, provider_version: bumped.provider_version });
  assert.equal(reassign.status, 'ITEM_CONFLICT');
});

test('audit is immutable structurally minimal and never contains full payload prompt or credentials', () => {
  const s = scenario('standard-reasoning-model-reference');
  const context = decisionContext('standard-reasoning-model-reference');
  const decision = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', context);
  const audit = buildModelProviderAudit({ provider: s.provider, model: s.model, decision, logical_sequence: 1 });
  assert.equal(validateModelProviderAudit(audit).valid, true);
  assert.equal(audit.simulation, true);
  assert.equal(audit.production_blocked, true);
  assert.equal(audit.executed, false);
  assert.equal(Object.isFrozen(audit), true);
  assert.throws(() => { audit.blockers.push('x'); }, TypeError);
  assert.deepEqual(Object.keys(audit).sort(), [
    'audit_id', 'availability_fingerprint', 'blockers', 'capability_fingerprints', 'cost_tier', 'decision_status',
    'executed', 'health_fingerprint', 'latency_tier', 'limits_fingerprint', 'logical_sequence', 'model_fingerprint',
    'organization_binding', 'pricing_fingerprint', 'privacy_fingerprint', 'privacy_tier', 'production_blocked',
    'provider_fingerprint', 'provider_type', 'quality_tier', 'reason_codes', 'registry_version',
    'selection_reference_fingerprint', 'simulation', 'tenant_binding', 'validator_version'
  ].sort());
});

[
  ['api key', { api_key: 'x' }, 'forbidden_key'],
  ['secret value', { secret_value: 'x' }, 'forbidden_key'],
  ['endpoint key', { endpoint_reference: 'x' }, 'forbidden_key'],
  ['url value', { note: 'https://blocked.invalid' }, 'operational_url_value'],
  ['prompt word', { note: 'do not store the system_prompt text' }, 'forbidden_word_value'],
  ['callback word', { note: 'invokes a callback handler' }, 'forbidden_word_value'],
  ['execute word', { note: 'do not execute this reference' }, 'forbidden_word_value'],
  ['sdk word', { note: 'no vendor sdk is used here' }, 'forbidden_word_value']
].forEach(([name, value, reasonPrefix]) => {
  test(`operational material detector blocks ${name} in model provider payloads`, () => {
    const found = findAgentCoreOperationalMaterial(value);
    assert.ok(found.some((entry) => entry.startsWith(reasonPrefix)), found.join(','));
  });
});

test('operational material detector avoids false positives on legitimate model provider field names', () => {
  const s = scenario('standard-reasoning-model-reference');
  assert.deepEqual(findAgentCoreOperationalMaterial(s.provider), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(s.model), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(s.capability), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(s.pricing), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(s.limits), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(s.availability), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(s.privacy), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(s.health), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(s.selection_reference), []);
});

test('operational material detector rejects NaN Infinity bigint symbol function and cyclic reference', () => {
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.NaN }).some((error) => error.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.POSITIVE_INFINITY }).some((error) => error.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: BigInt(1) }).some((error) => error.includes('forbidden_bigint')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Symbol('x') }).some((error) => error.includes('forbidden_symbol')));
  assert.ok(findAgentCoreOperationalMaterial({ value: () => null }).some((error) => error.includes('forbidden_function')));
  const cyclic = {};
  cyclic.self = cyclic;
  assert.ok(findAgentCoreOperationalMaterial(cyclic).some((error) => error.includes('forbidden_cycle')));
});

test('fingerprints are deterministic change with payload and evaluation does not mutate caller input', () => {
  const a = stablePayload({ b: 1, a: 2 });
  const b = stablePayload({ a: 2, b: 1 });
  assert.equal(a, b);

  const context = decisionContext('standard-reasoning-model-reference');
  const beforeProvider = JSON.stringify(context.provider);
  const beforeModel = JSON.stringify(context.model);
  const decision1 = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', context);
  const decision2 = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', decisionContext('standard-reasoning-model-reference'));
  assert.equal(JSON.stringify(context.provider), beforeProvider);
  assert.equal(JSON.stringify(context.model), beforeModel);
  assert.equal(decision1.provider_fingerprint, decision2.provider_fingerprint);
  assert.equal(decision1.model_fingerprint, decision2.model_fingerprint);

  const differentContext = decisionContext('standard-reasoning-model-reference', { model: { ...context.model, display_name: 'A different declarative label' } });
  const decision3 = evaluateModelProviderDecision('VALIDATE_ELIGIBILITY_REFERENCE', differentContext);
  assert.notEqual(decision1.model_fingerprint, decision3.model_fingerprint);
});

test('regression model provider modules do not use network filesystem eval dynamic import or timers', () => {
  const files = [
    'services/api/src/core/model-provider-contract.js',
    'services/api/src/core/model-contract.js',
    'services/api/src/core/model-capability-contract.js',
    'services/api/src/core/model-pricing-contract.js',
    'services/api/src/core/model-limits-contract.js',
    'services/api/src/core/model-availability-contract.js',
    'services/api/src/core/model-privacy-contract.js',
    'services/api/src/core/model-health-contract.js',
    'services/api/src/core/model-selection-reference.js',
    'services/api/src/core/model-provider-registry.js',
    'services/api/src/core/model-provider-decision.js',
    'services/api/src/core/model-provider-audit.js'
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

test('regression model provider contracts are not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('model-provider'), false);
    assert.equal(source.includes('model-contract'), false);
  }
});

test('regression PRs 79 through 82 remain untouched by this PR', () => {
  const files = [
    'services/api/src/core/agent-core-contract.js',
    'services/api/src/core/agent-registry.js',
    'services/api/src/core/agent-policy-boundary.js',
    'services/api/src/core/agent-session-boundary.js',
    'services/api/src/core/agent-session-registry.js',
    'services/api/src/core/agent-memory-contract.js',
    'services/api/src/core/agent-memory-registry.js',
    'services/api/src/core/transcription-runtime-registration-boundary.js',
    'services/api/src/core/transcription-secret-resolution-boundary.js',
    'services/api/src/core/transcription-network-permission-boundary.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('model-provider'), false);
    assert.equal(/require\(['"]\.\/model-contract['"]\)/.test(source), false);
  }
});

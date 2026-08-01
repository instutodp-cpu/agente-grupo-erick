'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr106fix3/pr106fix4: a single, per-element declarative claim about one stage's network/secret
// policy requirement -- pr106fix4 removes the free-form caller hint (`stage_domain`/`provider_slug`
// declared with no proof) and requires every claim to be genuinely bound, by ID/version/fingerprint,
// to a real upstream contract already reused elsewhere in this codebase (`model-selection-decision.js`,
// `tool-contract.js`, `workflow-contract.js`) -- never a second, self-declared source of truth.
// "Stage Policy Requirement não é um hint confiável isoladamente. Um requisito RESOLVED deve estar
// vinculado a uma fonte upstream oficial por ID/versão/fingerprint."
const RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_VALIDATOR_VERSION = 'runtime_worker_stage_policy_requirement_reference_validator_v2';

const REQUIREMENT_ELEMENTS = Object.freeze(['MODEL', 'TOOL', 'WORKFLOW']);

const SOURCE_REFERENCE_TYPES = Object.freeze([
  'MODEL_SELECTION_REFERENCE', 'TOOL_CONTRACT_REFERENCE', 'WORKFLOW_CONTRACT_REFERENCE'
]);

// "Quando nenhuma fonte oficial consegue resolver provider ou domínio, o requisito permanece
// UNRESOLVED e falha de forma fechada." A caller may only ever assert RESOLVED_FROM_OFFICIAL_REFERENCE
// when a genuine official source is present elsewhere in the request and independently validated by
// the boundary -- this contract's own validator cannot see that source, so it only checks the claim's
// own shape; the boundary is what refuses a RESOLVED claim with no matching official object.
const SOURCE_RESOLUTION_STATUSES = Object.freeze(['RESOLVED_FROM_OFFICIAL_REFERENCE', 'UNRESOLVED_REFERENCE']);

// "As Transcription Network/Secret References são aplicáveis somente ao domínio que seus contratos
// representam." Kept for the one case a genuine official source (a Model Selection Decision resolving
// to a provider inside the transcription domain's own ALLOWED_CAPABILITY_PROVIDER_SLUGS registry) can
// structurally prove domain membership -- GENERIC_DOMAIN exists so a resolved-but-out-of-domain claim
// is representable without inventing a fake transcription domain for it.
const STAGE_POLICY_DOMAINS = Object.freeze(['TRANSCRIPTION_DOMAIN', 'GENERIC_DOMAIN']);

const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const NOT_AVAILABLE_REGISTRY_SNAPSHOT = 'registry_snapshot_not_available';

const RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_FIELDS = Object.freeze([
  'stage_policy_requirement_reference_id', 'stage_policy_requirement_reference_version',
  'scheduler_stage_reference_id', 'requirement_element', 'source_reference_id',
  'source_reference_type', 'source_reference_version', 'source_reference_fingerprint',
  'source_registry_snapshot_reference_id', 'source_resolution_status',
  'source_provider_slug', 'source_stage_domain',
  'requirement_reference_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true
});

function computeStagePolicyRequirementFingerprint(reference) {
  const { requirement_reference_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeWorkerStagePolicyRequirementReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_worker_stage_policy_requirement_reference_must_be_object'] };
  exactFields(reference, RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_FIELDS, 'runtime_worker_stage_policy_requirement_reference', errors);
  for (const field of [
    'stage_policy_requirement_reference_id', 'scheduler_stage_reference_id', 'source_reference_id',
    'requirement_reference_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.stage_policy_requirement_reference_version) || reference.stage_policy_requirement_reference_version < 1) {
    errors.push('stage_policy_requirement_reference_version_invalid');
  }
  if (!REQUIREMENT_ELEMENTS.includes(reference.requirement_element)) errors.push(`requirement_element_not_allowed::${reference.requirement_element}`);
  if (!SOURCE_REFERENCE_TYPES.includes(reference.source_reference_type)) errors.push(`source_reference_type_not_allowed::${reference.source_reference_type}`);
  if (!SOURCE_RESOLUTION_STATUSES.includes(reference.source_resolution_status)) errors.push(`source_resolution_status_not_allowed::${reference.source_resolution_status}`);
  const resolved = reference.source_resolution_status === 'RESOLVED_FROM_OFFICIAL_REFERENCE';
  if (resolved) {
    if (!Number.isInteger(reference.source_reference_version) || reference.source_reference_version < 1) errors.push('source_reference_version_invalid');
    if (!isNonEmptyString(reference.source_reference_fingerprint) || reference.source_reference_fingerprint === NOT_AVAILABLE_FINGERPRINT) errors.push('source_reference_fingerprint_invalid');
    if (!isNonEmptyString(reference.source_registry_snapshot_reference_id) || reference.source_registry_snapshot_reference_id === NOT_AVAILABLE_REGISTRY_SNAPSHOT) errors.push('source_registry_snapshot_reference_id_invalid');
    if (!isNonEmptyString(reference.source_provider_slug)) errors.push('source_provider_slug_invalid');
    if (!STAGE_POLICY_DOMAINS.includes(reference.source_stage_domain)) errors.push(`source_stage_domain_not_allowed::${reference.source_stage_domain}`);
  } else {
    if (reference.source_reference_version !== 1) errors.push('unresolved_source_reference_version_must_be_1');
    if (reference.source_reference_fingerprint !== NOT_AVAILABLE_FINGERPRINT) errors.push('unresolved_source_reference_fingerprint_must_be_placeholder');
    if (reference.source_registry_snapshot_reference_id !== NOT_AVAILABLE_REGISTRY_SNAPSHOT) errors.push('unresolved_source_registry_snapshot_reference_id_must_be_placeholder');
    if (reference.source_provider_slug !== null) errors.push('source_provider_slug_must_be_null_when_unresolved');
    if (reference.source_stage_domain !== null) errors.push('source_stage_domain_must_be_null_when_unresolved');
  }
  for (const [field, expected] of Object.entries(RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeStagePolicyRequirementFingerprint(reference) !== reference.requirement_reference_fingerprint) errors.push('requirement_reference_fingerprint_mismatch');
  } catch (error) {
    errors.push('requirement_reference_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeWorkerStagePolicyRequirementReference(input = {}) {
  const resolved = input.source_resolution_status === 'RESOLVED_FROM_OFFICIAL_REFERENCE';
  const reference = {
    stage_policy_requirement_reference_id: input.stage_policy_requirement_reference_id,
    stage_policy_requirement_reference_version: Number.isInteger(input.stage_policy_requirement_reference_version) ? input.stage_policy_requirement_reference_version : 1,
    scheduler_stage_reference_id: input.scheduler_stage_reference_id,
    requirement_element: input.requirement_element,
    source_reference_id: input.source_reference_id,
    source_reference_type: input.source_reference_type,
    source_reference_version: resolved ? (Number.isInteger(input.source_reference_version) ? input.source_reference_version : 1) : 1,
    source_reference_fingerprint: resolved ? input.source_reference_fingerprint : NOT_AVAILABLE_FINGERPRINT,
    source_registry_snapshot_reference_id: resolved ? input.source_registry_snapshot_reference_id : NOT_AVAILABLE_REGISTRY_SNAPSHOT,
    source_resolution_status: input.source_resolution_status,
    source_provider_slug: resolved ? (input.source_provider_slug === undefined ? null : input.source_provider_slug) : null,
    source_stage_domain: resolved ? (input.source_stage_domain === undefined ? null : input.source_stage_domain) : null,
    requirement_reference_fingerprint: 'pending',
    ...RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_VALIDATOR_VERSION
  };
  reference.requirement_reference_fingerprint = computeStagePolicyRequirementFingerprint(reference);

  const validation = validateRuntimeWorkerStagePolicyRequirementReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_worker_stage_policy_requirement_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  NOT_AVAILABLE_FINGERPRINT,
  NOT_AVAILABLE_REGISTRY_SNAPSHOT,
  REQUIREMENT_ELEMENTS,
  RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_FIELDS,
  RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_SAFE_FLAGS,
  RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_VALIDATOR_VERSION,
  SOURCE_REFERENCE_TYPES,
  SOURCE_RESOLUTION_STATUSES,
  STAGE_POLICY_DOMAINS,
  buildRuntimeWorkerStagePolicyRequirementReference,
  computeStagePolicyRequirementFingerprint,
  validateRuntimeWorkerStagePolicyRequirementReference
};

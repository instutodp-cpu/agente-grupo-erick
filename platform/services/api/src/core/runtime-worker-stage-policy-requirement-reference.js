'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr106fix3: the genuinely-external piece of a stage's network/secret policy requirement that this
// codebase's own upstream chain (Scheduler Stage Reference -> Runtime Execution Package) does not
// resolve today -- `model_selection_reference_id`/`tool_reference_ids`/`workflow_reference_id` are,
// and remain, opaque ID pointers all the way up to the Worker Assignment layer (confirmed by
// inspection: no Model Selection/Tool Contract/Workflow Contract record carrying a `provider_slug`
// or a domain classification is reachable from here). Everything else a stage's policy requirement
// needs (which element triggered it, its destination class, its secret purpose) is honestly
// derivable structurally from the stage's own fields -- see `deriveStagePolicyRequirement` in
// runtime-worker-assignment-boundary.js. This contract supplies ONLY the two fields that genuinely
// cannot be derived: which domain the stage's provider actually belongs to, and which provider slug
// it is. Absence of an entry for a stage that needs one is not NOT_APPLICABLE -- it is
// unresolvable, and blocks the worker.
const RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_VALIDATOR_VERSION = 'runtime_worker_stage_policy_requirement_reference_validator_v1';

// "As Transcription Network/Secret References são aplicáveis somente ao domínio que seus contratos
// representam. Elas não são policies universais de runtime." -- TRANSCRIPTION_DOMAIN is the only
// domain the official policies reused by this PR (transcription-network-permission-boundary.js /
// transcription-secret-resolution-boundary.js) can ever legitimately authorize. GENERIC_DOMAIN
// exists so a caller can explicitly declare "this stage's provider is not a transcription provider"
// rather than leaving the field unresolved -- it always domain-mismatches against the only official
// policies this PR has access to.
const STAGE_POLICY_DOMAINS = Object.freeze(['TRANSCRIPTION_DOMAIN', 'GENERIC_DOMAIN']);

const RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_FIELDS = Object.freeze([
  'stage_policy_requirement_reference_id', 'stage_policy_requirement_reference_version',
  'scheduler_stage_reference_id',
  'stage_domain', 'provider_slug',
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
    'stage_policy_requirement_reference_id', 'scheduler_stage_reference_id', 'provider_slug',
    'requirement_reference_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.stage_policy_requirement_reference_version) || reference.stage_policy_requirement_reference_version < 1) {
    errors.push('stage_policy_requirement_reference_version_invalid');
  }
  if (!STAGE_POLICY_DOMAINS.includes(reference.stage_domain)) errors.push(`stage_domain_not_allowed::${reference.stage_domain}`);
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
  const reference = {
    stage_policy_requirement_reference_id: input.stage_policy_requirement_reference_id,
    stage_policy_requirement_reference_version: Number.isInteger(input.stage_policy_requirement_reference_version) ? input.stage_policy_requirement_reference_version : 1,
    scheduler_stage_reference_id: input.scheduler_stage_reference_id,
    stage_domain: input.stage_domain,
    provider_slug: input.provider_slug,
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
  RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_FIELDS,
  RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_SAFE_FLAGS,
  RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_VALIDATOR_VERSION,
  STAGE_POLICY_DOMAINS,
  buildRuntimeWorkerStagePolicyRequirementReference,
  computeStagePolicyRequirementFingerprint,
  validateRuntimeWorkerStagePolicyRequirementReference
};

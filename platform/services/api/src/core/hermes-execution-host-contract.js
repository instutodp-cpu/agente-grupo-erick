'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');

const CONTRACT_VERSION = 'hermes-execution-host-contract-v1';
const HOST_ROLE = 'hermes_execution_plane';
const CONTROL_PLANE = 'base44_maestro';
const EXECUTION_PLANE = 'hermes_vps';
const ENVIRONMENTS = Object.freeze(['staging']);
const READINESS_STATES = Object.freeze(['NOT_READY', 'READY', 'BLOCKED']);
const CAPABILITIES = Object.freeze([
  'CAPABILITY_NETWORK_OUTBOUND',
  'CAPABILITY_PROVIDER_CALL',
  'CAPABILITY_SHELL_EXECUTION',
  'CAPABILITY_QUEUE_MUTATION',
  'CAPABILITY_SCHEDULER_MUTATION',
  'CAPABILITY_DISPATCH',
  'CAPABILITY_SECRET_RESOLUTION',
  'CAPABILITY_OPERATIONAL_PERSISTENCE',
  'CAPABILITY_PRODUCTION_EFFECT'
]);

const HOST_FIELDS = Object.freeze([
  'contract_version', 'host_role', 'environment', 'production_allowed',
  'control_plane', 'execution_plane', 'network', 'services', 'secrets',
  'execution', 'audit', 'deployment', 'capabilities', 'readiness',
  'canonical_bindings', 'correlation_id'
]);
const NETWORK_FIELDS = Object.freeze(['inbound', 'outbound']);
const INBOUND_FIELDS = Object.freeze(['default', 'allowed']);
const OUTBOUND_FIELDS = Object.freeze(['default', 'policy_controlled']);
const SERVICE_FIELDS = Object.freeze([
  'reverse_proxy', 'hermes_api', 'hermes_worker', 'scheduler', 'queue', 'public_web_canary'
]);
const SECRET_FIELDS = Object.freeze(['plaintext_repository', 'plaintext_filesystem', 'runtime_injection_required']);
const EXECUTION_FIELDS = Object.freeze([
  'provider_without_authorization', 'shell_without_authorization',
  'network_without_authorization', 'production_execution'
]);
const AUDIT_FIELDS = Object.freeze([
  'receipts_required', 'correlation_id_required', 'authorization_binding_required',
  'owner_identity_required', 'attempt_identity_required', 'admission_identity_required',
  'lifecycle_identity_required', 'replay_identity_required', 'durable_reconciliation_required'
]);
const DEPLOYMENT_FIELDS = Object.freeze(['containerized', 'reproducible', 'docker_compose_preferred']);
const READINESS_FIELDS = Object.freeze(['host', 'runtime', 'admission', 'durable_audit_observability', 'production_execution_authorized']);
const BINDING_FIELDS = Object.freeze({
  provisioning_plan: ['state', 'plan_version', 'plan_hash'],
  authorization: ['state', 'authorization_id', 'authorization_hash', 'plan_version', 'plan_hash'],
  lifecycle: ['state', 'authorization_id', 'reference_id'],
  durable_lifecycle: ['state', 'authorization_id', 'reference_id', 'persistence_contract'],
  attempt_ownership: ['state', 'attempt_id', 'attempt_fingerprint', 'owner_reference'],
  admission: [
    'state', 'admission_id', 'admission_fingerprint', 'handoff_fingerprint',
    'authorization_id', 'lifecycle_reference_id', 'attempt_id', 'owner_reference'
  ]
});
const BINDING_NAMES = Object.freeze(Object.keys(BINDING_FIELDS));
const DIGEST_PLACEHOLDER = computeCanonicalContentDigest({ contract_version: CONTRACT_VERSION, state: 'NOT_ASSESSED' });

function exactFields(value, fields, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_must_be_object`);
    return;
  }
  const expected = new Set(fields);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${prefix}_unknown_field::${key}`);
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_field::${field}`);
}

function hashContract(contract) {
  const copy = JSON.parse(JSON.stringify(contract));
  delete copy.contract_fingerprint;
  return computeCanonicalContentDigest(JSON.parse(stablePayload(copy)));
}

function defaultCanonicalBindings() {
  return {
    provisioning_plan: { state: 'NOT_ASSESSED', plan_version: 'hermes-vps-provisioning-plan-v1', plan_hash: DIGEST_PLACEHOLDER },
    authorization: {
      state: 'NOT_ASSESSED', authorization_id: 'not-assessed', authorization_hash: DIGEST_PLACEHOLDER,
      plan_version: 'hermes-vps-provisioning-plan-v1', plan_hash: DIGEST_PLACEHOLDER
    },
    lifecycle: { state: 'NOT_ASSESSED', authorization_id: 'not-assessed', reference_id: 'not-assessed' },
    durable_lifecycle: {
      state: 'NOT_ASSESSED', authorization_id: 'not-assessed', reference_id: 'not-assessed',
      persistence_contract: 'hermes-vps-durable-authorization-lifecycle-registry-v1'
    },
    attempt_ownership: {
      state: 'NOT_ASSESSED', attempt_id: 'not-assessed', attempt_fingerprint: DIGEST_PLACEHOLDER,
      owner_reference: { executor_id: 'not-assessed', executor_type: 'not-assessed' }
    },
    admission: {
      state: 'NOT_ASSESSED', admission_id: 'not-assessed', admission_fingerprint: DIGEST_PLACEHOLDER,
      handoff_fingerprint: DIGEST_PLACEHOLDER, authorization_id: 'not-assessed',
      lifecycle_reference_id: 'not-assessed', attempt_id: 'not-assessed',
      owner_reference: { executor_id: 'not-assessed', executor_type: 'not-assessed' }
    }
  };
}

function buildHermesExecutionHostContract(overrides = {}) {
  const contract = {
    contract_version: CONTRACT_VERSION,
    host_role: HOST_ROLE,
    environment: 'staging',
    production_allowed: false,
    control_plane: CONTROL_PLANE,
    execution_plane: EXECUTION_PLANE,
    network: {
      inbound: { default: 'deny', allowed: ['https_443'] },
      outbound: { default: 'deny', policy_controlled: true }
    },
    services: {
      reverse_proxy: true, hermes_api: true, hermes_worker: true,
      scheduler: true, queue: true, public_web_canary: true
    },
    secrets: {
      plaintext_repository: 'forbidden', plaintext_filesystem: 'forbidden', runtime_injection_required: true
    },
    execution: {
      provider_without_authorization: 'forbidden', shell_without_authorization: 'forbidden',
      network_without_authorization: 'forbidden', production_execution: 'forbidden'
    },
    audit: {
      receipts_required: true, correlation_id_required: true, authorization_binding_required: true,
      owner_identity_required: true, attempt_identity_required: true, admission_identity_required: true,
      lifecycle_identity_required: true, replay_identity_required: true, durable_reconciliation_required: true
    },
    deployment: { containerized: true, reproducible: true, docker_compose_preferred: true },
    capabilities: Object.fromEntries(CAPABILITIES.map((capability) => [capability, false])),
    readiness: {
      host: 'READY', runtime: 'NOT_READY', admission: 'NOT_READY',
      durable_audit_observability: 'NOT_READY', production_execution_authorized: false
    },
    canonical_bindings: defaultCanonicalBindings(),
    correlation_id: 'not-assessed'
  };
  const merged = {
    ...contract,
    ...overrides,
    network: { ...contract.network, ...(overrides.network || {}) },
    services: { ...contract.services, ...(overrides.services || {}) },
    secrets: { ...contract.secrets, ...(overrides.secrets || {}) },
    execution: { ...contract.execution, ...(overrides.execution || {}) },
    audit: { ...contract.audit, ...(overrides.audit || {}) },
    deployment: { ...contract.deployment, ...(overrides.deployment || {}) },
    capabilities: { ...contract.capabilities, ...(overrides.capabilities || {}) },
    readiness: { ...contract.readiness, ...(overrides.readiness || {}) },
    canonical_bindings: { ...contract.canonical_bindings, ...(overrides.canonical_bindings || {}) }
  };
  for (const name of BINDING_NAMES) merged.canonical_bindings[name] = {
    ...contract.canonical_bindings[name],
    ...(overrides.canonical_bindings?.[name] || {})
  };
  merged.contract_fingerprint = hashContract(merged);
  return Object.freeze(merged);
}

function validateHermesExecutionHostContract(contract) {
  const errors = [];
  if (!isPlainObject(contract)) return { valid: false, errors: ['host_contract_must_be_object'] };
  exactFields(contract, [...HOST_FIELDS, 'contract_fingerprint'], 'host_contract', errors);
  exactFields(contract.network, NETWORK_FIELDS, 'network', errors);
  exactFields(contract.network && contract.network.inbound, INBOUND_FIELDS, 'inbound', errors);
  exactFields(contract.network && contract.network.outbound, OUTBOUND_FIELDS, 'outbound', errors);
  exactFields(contract.services, SERVICE_FIELDS, 'services', errors);
  exactFields(contract.secrets, SECRET_FIELDS, 'secrets', errors);
  exactFields(contract.execution, EXECUTION_FIELDS, 'execution', errors);
  exactFields(contract.audit, AUDIT_FIELDS, 'audit', errors);
  exactFields(contract.deployment, DEPLOYMENT_FIELDS, 'deployment', errors);
  exactFields(contract.readiness, READINESS_FIELDS, 'readiness', errors);
  if (!isNonEmptyString(contract.correlation_id)) errors.push('correlation_id_invalid');
  if (!isPlainObject(contract.canonical_bindings)) errors.push('canonical_bindings_must_be_object');
  else {
    for (const name of BINDING_NAMES) exactFields(contract.canonical_bindings[name], BINDING_FIELDS[name], `canonical_binding::${name}`, errors);
    for (const name of Object.keys(contract.canonical_bindings)) if (!BINDING_NAMES.includes(name)) errors.push(`canonical_bindings_unknown_field::${name}`);
  }

  if (contract.contract_version !== CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (contract.host_role !== HOST_ROLE) errors.push('host_role_invalid');
  if (!ENVIRONMENTS.includes(contract.environment)) errors.push('environment_blocked');
  if (contract.production_allowed !== false) errors.push('production_must_remain_blocked');
  if (contract.control_plane !== CONTROL_PLANE || contract.execution_plane !== EXECUTION_PLANE) errors.push('plane_identity_invalid');
  if (contract.network && contract.network.inbound && (contract.network.inbound.default !== 'deny' || JSON.stringify(contract.network.inbound.allowed) !== '["https_443"]')) errors.push('inbound_not_deny_by_default');
  if (contract.network && contract.network.outbound && (contract.network.outbound.default !== 'deny' || contract.network.outbound.policy_controlled !== true)) errors.push('outbound_not_deny_by_default');
  if (contract.secrets && (contract.secrets.plaintext_repository !== 'forbidden' || contract.secrets.plaintext_filesystem !== 'forbidden' || contract.secrets.runtime_injection_required !== true)) errors.push('secret_policy_invalid');
  if (contract.execution && Object.values(contract.execution).some((value) => value !== 'forbidden')) errors.push('execution_boundary_invalid');
  if (contract.audit && Object.values(contract.audit).some((value) => value !== true)) errors.push('audit_requirement_missing');
  if (contract.deployment && Object.values(contract.deployment).some((value) => value !== true)) errors.push('deployment_contract_invalid');
  if (contract.readiness) {
    for (const field of READINESS_FIELDS.slice(0, 4)) if (!READINESS_STATES.includes(contract.readiness[field])) errors.push(`readiness_state_invalid::${field}`);
    if (contract.readiness.production_execution_authorized !== false) errors.push('production_execution_authorization_must_remain_false');
  }
  const bindings = contract.canonical_bindings;
  if (bindings && BINDING_NAMES.every((name) => isPlainObject(bindings[name]))) {
    const plan = bindings.provisioning_plan;
    const authorization = bindings.authorization;
    const lifecycle = bindings.lifecycle;
    const durableLifecycle = bindings.durable_lifecycle;
    const attempt = bindings.attempt_ownership;
    const admission = bindings.admission;
    if (!isCanonicalContentDigest(plan.plan_hash) || !isCanonicalContentDigest(authorization.plan_hash) || !isCanonicalContentDigest(authorization.authorization_hash)) errors.push('canonical_digest_invalid');
    if (authorization.plan_version !== plan.plan_version || authorization.plan_hash !== plan.plan_hash) errors.push('authorization_plan_binding_mismatch');
    if (lifecycle.authorization_id !== authorization.authorization_id || durableLifecycle.authorization_id !== authorization.authorization_id) errors.push('lifecycle_authorization_binding_mismatch');
    if (lifecycle.reference_id !== durableLifecycle.reference_id) errors.push('durable_lifecycle_reference_mismatch');
    if (admission.authorization_id !== authorization.authorization_id || admission.lifecycle_reference_id !== lifecycle.reference_id) errors.push('admission_lifecycle_binding_mismatch');
    if (admission.attempt_id !== attempt.attempt_id || JSON.stringify(admission.owner_reference) !== JSON.stringify(attempt.owner_reference)) errors.push('admission_ownership_binding_mismatch');
    if (contract.readiness.runtime === 'READY' && plan.state !== 'VALIDATED') errors.push('runtime_readiness_dependency_missing');
    if (contract.readiness.admission === 'READY' && (authorization.state !== 'AUTHORIZED' || lifecycle.state !== 'CONSUMED' || durableLifecycle.state !== 'CONSUMED' || attempt.state !== 'CLAIMED' || admission.state !== 'ADMITTED')) errors.push('admission_readiness_dependency_missing');
    if (contract.readiness.durable_audit_observability === 'READY' && Object.values(contract.audit).some((value) => value !== true)) errors.push('durable_audit_readiness_dependency_missing');
  }
  if (!isPlainObject(contract.capabilities)) errors.push('capabilities_must_be_object');
  else {
    const keys = Object.keys(contract.capabilities);
    for (const capability of CAPABILITIES) if (contract.capabilities[capability] !== false) errors.push(`capability_must_not_be_granted::${capability}`);
    for (const key of keys) if (!CAPABILITIES.includes(key)) errors.push(`capabilities_unknown_field::${key}`);
  }
  if (contract.contract_fingerprint !== hashContract(contract)) errors.push('contract_fingerprint_mismatch');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  CAPABILITIES,
  CONTRACT_VERSION,
  ENVIRONMENTS,
  buildHermesExecutionHostContract,
  hashContract,
  validateHermesExecutionHostContract
};

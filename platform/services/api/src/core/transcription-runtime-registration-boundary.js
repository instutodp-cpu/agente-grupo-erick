'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { stableCanonicalize, stablePayload } = require('./transcription-provider-contract-registry');
const {
  findNetworkOperationalMaterial,
  validateSecretResolutionContext
} = require('./transcription-network-permission-boundary');
const { validateNetworkPermissionResult } = require('./transcription-network-permission-result');
const {
  ALLOWED_REGISTRATION_PURPOSES,
  evaluateRuntimeRegistrationPolicy,
  validatePolicyContext
} = require('./transcription-runtime-registration-policy');
const { buildRuntimeRegistrationAudit } = require('./transcription-runtime-registration-audit');
const { buildRuntimeRegistrationPlan } = require('./transcription-runtime-registration-plan');
const {
  RUNTIME_REGISTRATION_SAFE_FLAGS,
  buildRuntimeRegistrationResult,
  cloneFrozen
} = require('./transcription-runtime-registration-result');

const TRANSCRIPTION_RUNTIME_REGISTRATION_BOUNDARY_VALIDATOR_VERSION = 'transcription_runtime_registration_boundary_validator_v1';
const COMPONENT_TYPES = Object.freeze([
  'PROVIDER_ADAPTER',
  'CAPABILITY_PROFILE',
  'SELECTION_ENGINE',
  'SECRET_BOUNDARY',
  'NETWORK_BOUNDARY',
  'TRANSPORT_REFERENCE',
  'MOCK_ORCHESTRATOR',
  'AUDIT_COMPONENT',
  'VALIDATION_COMPONENT',
  'RUNTIME_POLICY'
]);
const RUNTIME_ENVIRONMENTS = Object.freeze(['DEVELOPMENT', 'STAGING', 'PRODUCTION']);
const REGISTRATION_REQUEST_FIELDS = Object.freeze([
  'registration_request_id',
  'registration_request_version',
  'tenant_id',
  'conversation_id',
  'environment',
  'component_descriptor',
  'dependency_graph',
  'secret_resolution_context',
  'network_permission_context',
  'policy_context',
  'requested_purpose',
  'simulation_context',
  'metadata',
  'validator_version'
]);
const COMPONENT_DESCRIPTOR_FIELDS = Object.freeze([
  'component_ref_id',
  'component_ref_version',
  'component_type',
  'component_id',
  'component_alias',
  'tenant_id',
  'environment',
  'entrypoint_reference',
  'capabilities_declared',
  'depends_on',
  'active',
  'registered',
  'initialized',
  'activated',
  'simulation',
  'production_blocked',
  'runtime_enabled',
  'validator_version'
]);
const DEPENDENCY_GRAPH_FIELDS = Object.freeze([
  'graph_id',
  'graph_version',
  'nodes',
  'edges',
  'bindings',
  'topological_order',
  'simulation',
  'production_blocked',
  'validator_version'
]);
const GRAPH_NODE_FIELDS = Object.freeze(['node_id', 'component_type', 'version']);
const GRAPH_EDGE_FIELDS = Object.freeze(['from', 'to']);
const GRAPH_BINDING_FIELDS = Object.freeze(['node_id', 'binds_to', 'binding_type', 'required_version']);
const FORBIDDEN_ENTRYPOINT_PATTERNS = Object.freeze([
  [/import/i, 'entrypoint_reference_forbidden_import'],
  [/require/i, 'entrypoint_reference_forbidden_require'],
  [/callback/i, 'entrypoint_reference_forbidden_callback'],
  [/handler/i, 'entrypoint_reference_forbidden_handler'],
  [/module/i, 'entrypoint_reference_forbidden_module_name'],
  [/package/i, 'entrypoint_reference_forbidden_package_name'],
  [/bootstrap/i, 'entrypoint_reference_forbidden_bootstrap'],
  [/startup/i, 'entrypoint_reference_forbidden_startup'],
  [/function/i, 'entrypoint_reference_forbidden_function'],
  [/[\\/]/, 'entrypoint_reference_forbidden_filesystem_path'],
  [/:\/\//, 'entrypoint_reference_forbidden_url'],
  [/[()${};]/, 'entrypoint_reference_forbidden_code'],
  [/=>/, 'entrypoint_reference_forbidden_code']
]);
const ENTRYPOINT_REFERENCE_PATTERN = /^[A-Z][A-Z0-9_]{2,120}$/;

function exactFields(value, fields, prefix, errors) {
  const allowed = new Set(fields);
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_${field}`);
  for (const field of Object.keys(value)) if (!allowed.has(field)) errors.push(`${prefix}_unexpected_field::${field}`);
}

function validateEntrypointReference(value) {
  const errors = [];
  if (!isNonEmptyString(value)) return ['entrypoint_reference_invalid'];
  for (const [pattern, reason] of FORBIDDEN_ENTRYPOINT_PATTERNS) {
    if (pattern.test(value)) errors.push(reason);
  }
  if (!ENTRYPOINT_REFERENCE_PATTERN.test(value)) errors.push('entrypoint_reference_format_invalid');
  return uniqueSorted(errors);
}

function validateNetworkPermissionContext(context) {
  if (!isPlainObject(context)) return { valid: false, errors: ['network_permission_context_must_be_object'] };
  const validation = validateNetworkPermissionResult(context);
  const errors = validation.errors.map((error) => `network_permission_context_${error}`);
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeCanonicalTopologicalOrder(nodes, edges) {
  const ids = nodes.map((node) => node.node_id);
  const indegree = new Map(ids.map((id) => [id, 0]));
  const adjacency = new Map(ids.map((id) => [id, []]));
  for (const edge of edges) {
    if (!adjacency.has(edge.to) || !indegree.has(edge.from)) continue;
    adjacency.get(edge.to).push(edge.from);
    indegree.set(edge.from, indegree.get(edge.from) + 1);
  }
  const queue = ids.filter((id) => indegree.get(id) === 0).sort();
  const order = [];
  while (queue.length > 0) {
    queue.sort();
    const id = queue.shift();
    order.push(id);
    for (const next of adjacency.get(id) || []) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  return order;
}

function validateDependencyGraph(graph) {
  const errors = [];
  if (!isPlainObject(graph)) return { valid: false, errors: ['dependency_graph_must_be_object'] };
  exactFields(graph, DEPENDENCY_GRAPH_FIELDS, 'dependency_graph', errors);
  for (const field of ['graph_id', 'validator_version']) {
    if (!isNonEmptyString(graph[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(graph.graph_version) || graph.graph_version < 1) errors.push('graph_version_invalid');
  if (graph.simulation !== true) errors.push('dependency_graph_simulation_must_be_true');
  if (graph.production_blocked !== true) errors.push('dependency_graph_production_blocked_must_be_true');
  if (graph.validator_version !== TRANSCRIPTION_RUNTIME_REGISTRATION_BOUNDARY_VALIDATOR_VERSION) errors.push('dependency_graph_validator_version_invalid');

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : null;
  if (!nodes || nodes.length === 0) errors.push('dependency_graph_nodes_invalid');
  const nodeIds = new Set();
  const nodeVersions = new Map();
  if (nodes) {
    for (const node of nodes) {
      if (!isPlainObject(node)) {
        errors.push('dependency_graph_node_must_be_object');
        continue;
      }
      const nodeErrors = [];
      exactFields(node, GRAPH_NODE_FIELDS, 'dependency_graph_node', nodeErrors);
      if (!isNonEmptyString(node.node_id)) nodeErrors.push('dependency_graph_node_id_invalid');
      if (!COMPONENT_TYPES.includes(node.component_type)) nodeErrors.push(`dependency_graph_node_component_type_not_allowed::${node.component_type}`);
      if (!Number.isInteger(node.version) || node.version < 1) nodeErrors.push('dependency_graph_node_version_invalid');
      errors.push(...nodeErrors);
      if (isNonEmptyString(node.node_id)) {
        if (nodeIds.has(node.node_id)) errors.push(`dependency_graph_duplicate_node::${node.node_id}`);
        nodeIds.add(node.node_id);
        nodeVersions.set(node.node_id, node.version);
      }
    }
  }

  const edges = Array.isArray(graph.edges) ? graph.edges : null;
  if (!edges) errors.push('dependency_graph_edges_invalid');
  const seenEdges = new Set();
  const validEdges = [];
  if (edges) {
    for (const edge of edges) {
      if (!isPlainObject(edge)) {
        errors.push('dependency_graph_edge_must_be_object');
        continue;
      }
      const edgeErrors = [];
      exactFields(edge, GRAPH_EDGE_FIELDS, 'dependency_graph_edge', edgeErrors);
      if (!isNonEmptyString(edge.from) || !isNonEmptyString(edge.to)) edgeErrors.push('dependency_graph_edge_endpoints_invalid');
      errors.push(...edgeErrors);
      if (isNonEmptyString(edge.from) && isNonEmptyString(edge.to)) {
        if (edge.from === edge.to) errors.push(`dependency_graph_self_reference::${edge.from}`);
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) errors.push(`dependency_graph_orphan_dependency::${edge.from}->${edge.to}`);
        const key = `${edge.from}->${edge.to}`;
        if (seenEdges.has(key)) errors.push(`dependency_graph_duplicate_edge::${key}`);
        seenEdges.add(key);
        validEdges.push(edge);
      }
    }
  }

  const bindings = Array.isArray(graph.bindings) ? graph.bindings : null;
  if (!bindings) errors.push('dependency_graph_bindings_invalid');
  if (bindings) {
    for (const binding of bindings) {
      if (!isPlainObject(binding)) {
        errors.push('dependency_graph_binding_must_be_object');
        continue;
      }
      const bindingErrors = [];
      exactFields(binding, GRAPH_BINDING_FIELDS, 'dependency_graph_binding', bindingErrors);
      if (!isNonEmptyString(binding.node_id) || !nodeIds.has(binding.node_id)) bindingErrors.push('dependency_graph_binding_node_id_invalid');
      if (!isNonEmptyString(binding.binds_to) || !nodeIds.has(binding.binds_to)) bindingErrors.push('dependency_graph_binding_binds_to_invalid');
      if (!COMPONENT_TYPES.includes(binding.binding_type)) bindingErrors.push(`dependency_graph_binding_type_not_allowed::${binding.binding_type}`);
      if (!Number.isInteger(binding.required_version) || binding.required_version < 1) bindingErrors.push('dependency_graph_binding_required_version_invalid');
      if (
        bindingErrors.length === 0 &&
        nodeVersions.has(binding.binds_to) &&
        nodeVersions.get(binding.binds_to) !== binding.required_version
      ) {
        bindingErrors.push(`dependency_graph_version_incompatibility::${binding.binds_to}`);
      }
      errors.push(...bindingErrors);
    }
  }

  if (nodes && edges && errors.length === 0) {
    const canonicalOrder = computeCanonicalTopologicalOrder(nodes, validEdges);
    if (canonicalOrder.length !== nodes.length) {
      errors.push('dependency_graph_cycle_detected');
    } else if (!Array.isArray(graph.topological_order) || stablePayload(graph.topological_order) !== stablePayload(canonicalOrder)) {
      errors.push('dependency_graph_topological_order_mismatch');
    }
  } else if (!Array.isArray(graph.topological_order)) {
    errors.push('dependency_graph_topological_order_invalid');
  }

  try {
    stablePayload(graph);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findNetworkOperationalMaterial(graph));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateComponentDescriptor(descriptor) {
  const errors = [];
  if (!isPlainObject(descriptor)) return { valid: false, errors: ['component_descriptor_must_be_object'] };
  exactFields(descriptor, COMPONENT_DESCRIPTOR_FIELDS, 'component_descriptor', errors);
  for (const field of ['component_ref_id', 'component_id', 'component_alias', 'tenant_id', 'environment', 'validator_version']) {
    if (!isNonEmptyString(descriptor[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(descriptor.component_ref_version) || descriptor.component_ref_version < 1) errors.push('component_ref_version_invalid');
  if (!COMPONENT_TYPES.includes(descriptor.component_type)) errors.push(`component_type_not_allowed::${descriptor.component_type}`);
  if (!RUNTIME_ENVIRONMENTS.includes(descriptor.environment)) errors.push(`environment_not_allowed::${descriptor.environment}`);
  if (!Array.isArray(descriptor.capabilities_declared) || !descriptor.capabilities_declared.every((entry) => isNonEmptyString(entry))) {
    errors.push('capabilities_declared_invalid');
  }
  if (!Array.isArray(descriptor.depends_on) || !descriptor.depends_on.every((entry) => isNonEmptyString(entry))) {
    errors.push('depends_on_invalid');
  }
  errors.push(...validateEntrypointReference(descriptor.entrypoint_reference));
  for (const field of ['active', 'registered', 'initialized', 'activated']) {
    if (descriptor[field] !== false) errors.push(`${field}_must_be_false`);
  }
  if (descriptor.simulation !== true) errors.push('simulation_must_be_true');
  if (descriptor.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (descriptor.runtime_enabled !== false) errors.push('runtime_enabled_must_be_false');
  if (descriptor.validator_version !== TRANSCRIPTION_RUNTIME_REGISTRATION_BOUNDARY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(descriptor);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findNetworkOperationalMaterial(descriptor));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateRuntimeRegistrationRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['registration_request_must_be_object'] };
  exactFields(request, REGISTRATION_REQUEST_FIELDS, 'registration_request', errors);
  for (const field of ['registration_request_id', 'tenant_id', 'conversation_id', 'environment', 'requested_purpose', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.registration_request_version) || request.registration_request_version < 1) errors.push('registration_request_version_invalid');
  if (!RUNTIME_ENVIRONMENTS.includes(request.environment)) errors.push(`environment_not_allowed::${request.environment}`);
  if (!ALLOWED_REGISTRATION_PURPOSES.includes(request.requested_purpose)) errors.push(`requested_purpose_not_allowed::${request.requested_purpose}`);
  if (!isPlainObject(request.metadata)) errors.push('metadata_must_be_object');
  if (!isPlainObject(request.simulation_context)) errors.push('simulation_context_must_be_object');
  if (isPlainObject(request.simulation_context)) {
    if (request.simulation_context.simulation !== true) errors.push('simulation_context_simulation_must_be_true');
    if (request.simulation_context.production_blocked !== true) errors.push('simulation_context_production_blocked_must_be_true');
    if (request.simulation_context.rollout_percentage !== 0) errors.push('simulation_context_rollout_percentage_must_be_zero');
    for (const field of ['runtime_mutated', 'components_registered', 'components_initialized', 'components_activated', 'network_used', 'provider_called', 'executed']) {
      if (request.simulation_context[field] !== false) errors.push(`simulation_context_${field}_must_be_false`);
    }
  }
  const descriptorValidation = validateComponentDescriptor(request.component_descriptor);
  errors.push(...descriptorValidation.errors);
  const graphValidation = validateDependencyGraph(request.dependency_graph);
  errors.push(...graphValidation.errors);
  const policyValidation = validatePolicyContext(request.policy_context);
  errors.push(...policyValidation.errors);
  const secretValidation = validateSecretResolutionContext(request.secret_resolution_context);
  errors.push(...secretValidation.errors.map((error) => `secret_resolution_context_${error}`));
  const networkValidation = validateNetworkPermissionContext(request.network_permission_context);
  errors.push(...networkValidation.errors);
  const descriptor = request.component_descriptor || {};
  if (descriptor.tenant_id && request.tenant_id !== descriptor.tenant_id) errors.push('tenant_mismatch');
  if (descriptor.environment && request.environment !== descriptor.environment) errors.push('environment_mismatch');
  if (request.policy_context?.tenant_id && request.tenant_id !== request.policy_context.tenant_id) errors.push('policy_tenant_mismatch');
  const graph = request.dependency_graph || {};
  if (Array.isArray(graph.nodes) && isNonEmptyString(descriptor.component_ref_id) && !graph.nodes.some((node) => isPlainObject(node) && node.node_id === descriptor.component_ref_id)) {
    errors.push('component_not_present_in_dependency_graph');
  }
  if (request.validator_version !== TRANSCRIPTION_RUNTIME_REGISTRATION_BOUNDARY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  if (isPlainObject(request.metadata)) errors.push(...findNetworkOperationalMaterial(request.metadata));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function statusFromErrors(errors) {
  if (errors.some((error) => String(error).includes('dependency_graph_'))) return 'COMPONENT_GRAPH_BLOCKED';
  if (errors.some((error) => String(error).endsWith('_denied'))) return 'REGISTRATION_DENIED';
  if (errors.some((error) => (
    String(error).includes('tenant_mismatch') ||
    String(error).includes('environment_mismatch') ||
    String(error).startsWith('policy_context_') ||
    String(error).endsWith('_pending') ||
    String(error).endsWith('_not_simulated') ||
    String(error).includes('purpose_not_allowed')
  ))) return 'REGISTRATION_POLICY_BLOCKED';
  if (errors.length > 0) return 'VALIDATION_FAILED';
  return 'REGISTRATION_SIMULATION_REVIEWED';
}

function evaluateRuntimeRegistration(request = {}) {
  const validation = validateRuntimeRegistrationRequest(request);
  const descriptor = request.component_descriptor || {};
  const graph = request.dependency_graph || {};
  const policy = evaluateRuntimeRegistrationPolicy(request, descriptor);
  const blockers = uniqueSorted([...(validation.errors || []), ...(policy.blocking_reasons || [])]);
  const ok = validation.valid && policy.reviewed === true;
  const status = ok ? 'REGISTRATION_SIMULATION_REVIEWED' : statusFromErrors(blockers);
  const dependencyOrder = ok && Array.isArray(graph.topological_order) ? graph.topological_order : [];
  const bindingCount = ok && Array.isArray(graph.bindings) ? graph.bindings.length : 0;
  const planFingerprint = validation.valid ? stablePayload({ descriptor, graph }) : 'invalid_plan';
  const plan = buildRuntimeRegistrationPlan({
    plan_id: `runtime_registration_plan_${request.registration_request_id || 'missing'}`,
    registration_request_id: request.registration_request_id,
    tenant_id: request.tenant_id,
    environment: request.environment,
    component_type: descriptor.component_type,
    component_id: descriptor.component_id,
    entrypoint_reference: descriptor.entrypoint_reference,
    dependency_order: dependencyOrder,
    binding_count: bindingCount,
    plan_status: status
  });
  const result = buildRuntimeRegistrationResult({
    registration_decision_id: `runtime_registration_${request.registration_request_id || 'missing'}`,
    registration_request_id: request.registration_request_id,
    tenant_id: request.tenant_id,
    environment: request.environment,
    component_type: descriptor.component_type,
    component_id: descriptor.component_id,
    status,
    decision: status,
    decision_reason: ok ? 'registration_reviewed_simulation_only' : blockers[0] || 'runtime_registration_blocked',
    policy_status: policy.status,
    component_descriptor_valid: validation.valid,
    dependency_graph_valid: !blockers.some((error) => String(error).includes('dependency_graph_')),
    bindings_valid: !blockers.some((error) => String(error).includes('binding')),
    tenant_binding_valid: !blockers.includes('tenant_mismatch') && !blockers.includes('policy_tenant_mismatch'),
    environment_binding_valid: !blockers.includes('environment_mismatch'),
    plan_fingerprint: planFingerprint
  });
  const audit = buildRuntimeRegistrationAudit({ request, policy, blockers, decision: status, logical_sequence: 1 });
  return cloneFrozen({
    result,
    plan,
    audit,
    policy,
    request_fingerprint: validation.valid ? stablePayload(request) : 'invalid_request',
    component_descriptor_fingerprint: validation.valid ? stablePayload(descriptor) : 'invalid_component_descriptor',
    dependency_graph_fingerprint: validation.valid ? stablePayload(graph) : 'invalid_dependency_graph',
    plan_fingerprint: planFingerprint,
    errors: blockers,
    ...RUNTIME_REGISTRATION_SAFE_FLAGS
  });
}

function createTranscriptionRuntimeComponentRegistry() {
  const records = new Map();
  const hashes = new Map();
  const versions = new Map();
  const history = new Map();
  function safe(payload) {
    return cloneFrozen({ ...payload, ...RUNTIME_REGISTRATION_SAFE_FLAGS });
  }
  function registerComponentDescriptor(descriptor, options = {}) {
    const validation = validateComponentDescriptor(descriptor);
    if (!validation.valid) return safe({ ok: false, errors: validation.errors });
    let payload;
    try {
      payload = JSON.stringify(stableCanonicalize(descriptor));
    } catch (error) {
      return safe({ ok: false, errors: [`component_descriptor_fingerprint_invalid::${error.message}`] });
    }
    const id = descriptor.component_ref_id;
    if (records.has(id)) {
      if (hashes.get(id) === payload) return safe({ ok: false, errors: ['component_descriptor_replay_duplicate'] });
      return safe({ ok: false, errors: ['component_descriptor_replay_payload_mismatch'] });
    }
    const key = `${descriptor.component_type}:${descriptor.component_id}:${descriptor.tenant_id}`;
    const previousVersion = versions.get(key) || 0;
    if (options.expected_version !== undefined && options.expected_version !== previousVersion) return safe({ ok: false, errors: ['component_descriptor_optimistic_conflict'] });
    if (descriptor.component_ref_version <= previousVersion) return safe({ ok: false, errors: ['component_descriptor_version_downgrade'] });
    const stored = cloneFrozen(descriptor);
    records.set(id, stored);
    hashes.set(id, payload);
    versions.set(key, descriptor.component_ref_version);
    history.set(key, [...(history.get(key) || []), stored].slice(-20));
    return safe({ ok: true, component_ref_id: id, component_ref_version: descriptor.component_ref_version, fingerprint: payload });
  }
  return Object.freeze({
    registerComponentDescriptor,
    getComponentDescriptor(id) {
      return records.has(id) ? cloneFrozen(records.get(id)) : null;
    },
    getHistory(key) {
      return cloneFrozen(history.get(key) || []);
    }
  });
}

module.exports = {
  COMPONENT_DESCRIPTOR_FIELDS,
  COMPONENT_TYPES,
  DEPENDENCY_GRAPH_FIELDS,
  REGISTRATION_REQUEST_FIELDS,
  RUNTIME_ENVIRONMENTS,
  TRANSCRIPTION_RUNTIME_REGISTRATION_BOUNDARY_VALIDATOR_VERSION,
  computeCanonicalTopologicalOrder,
  createTranscriptionRuntimeComponentRegistry,
  evaluateRuntimeRegistration,
  validateComponentDescriptor,
  validateDependencyGraph,
  validateEntrypointReference,
  validateNetworkPermissionContext,
  validateRuntimeRegistrationRequest
};

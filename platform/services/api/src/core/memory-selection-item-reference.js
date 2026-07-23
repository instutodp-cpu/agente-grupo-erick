'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const MEMORY_SELECTION_ITEM_REFERENCE_VALIDATOR_VERSION = 'memory_selection_item_reference_validator_v1';
const PROJECT_STATE_REFERENCE_VALIDATOR_VERSION = 'memory_selection_project_state_reference_validator_v1';
const CONTINUITY_SUMMARY_REFERENCE_VALIDATOR_VERSION = 'memory_selection_continuity_summary_reference_validator_v1';

const ITEM_CLASSES = Object.freeze(['REQUIRED', 'RELEVANT', 'OPTIONAL']);

const ITEM_TYPES = Object.freeze([
  'USER_PREFERENCE_REFERENCE', 'USER_CONSTRAINT_REFERENCE', 'SAFETY_RESTRICTION_REFERENCE',
  'PRIVACY_PREFERENCE_REFERENCE', 'FORMAT_PREFERENCE_REFERENCE', 'LANGUAGE_PREFERENCE_REFERENCE',
  'MODEL_COST_PREFERENCE_REFERENCE', 'TOOL_PREFERENCE_REFERENCE', 'WORKFLOW_PREFERENCE_REFERENCE',
  'PROJECT_STATE_REFERENCE', 'PROJECT_DECISION_REFERENCE', 'PENDING_TASK_REFERENCE',
  'CONTINUITY_SUMMARY_REFERENCE', 'EPISODIC_MEMORY_REFERENCE', 'SEMANTIC_MEMORY_REFERENCE',
  'PROCEDURAL_MEMORY_REFERENCE', 'PROFILE_MEMORY_REFERENCE', 'AUDIT_MEMORY_REFERENCE'
]);

const PREFERENCE_ITEM_TYPES = Object.freeze([
  'USER_PREFERENCE_REFERENCE', 'USER_CONSTRAINT_REFERENCE', 'SAFETY_RESTRICTION_REFERENCE',
  'PRIVACY_PREFERENCE_REFERENCE', 'FORMAT_PREFERENCE_REFERENCE', 'LANGUAGE_PREFERENCE_REFERENCE',
  'MODEL_COST_PREFERENCE_REFERENCE', 'TOOL_PREFERENCE_REFERENCE', 'WORKFLOW_PREFERENCE_REFERENCE'
]);

const SCOPE_TYPES = Object.freeze([
  'GLOBAL', 'TENANT', 'ORGANIZATION', 'PROJECT', 'AGENT', 'SESSION_REFERENCE', 'WORKFLOW_REFERENCE', 'TASK_REFERENCE'
]);

const OMISSION_RISKS = Object.freeze(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']);
const HIGH_OMISSION_RISKS = Object.freeze(['HIGH', 'CRITICAL']);

const CONFIDENCE_LEVELS = Object.freeze(['EXPLICIT', 'CONFIRMED', 'DERIVED', 'INFERRED', 'UNKNOWN_BLOCKED']);
const BLOCKING_CONFIDENCE_LEVELS = Object.freeze(['UNKNOWN_BLOCKED']);
const EXPLICIT_CONFIDENCE_LEVELS = Object.freeze(['EXPLICIT', 'CONFIRMED']);

const MEMORY_SELECTION_ITEM_REFERENCE_FIELDS = Object.freeze([
  'item_reference_id', 'item_version', 'item_class', 'item_type', 'scope_type', 'scope_id', 'tenant_id',
  'organization_id', 'agent_id', 'project_id', 'session_reference_id', 'source_reference_id',
  'explicitly_declared', 'required', 'priority', 'omission_risk', 'confidence_level', 'recency_sequence',
  'frequency_reference', 'superseded', 'superseded_by_reference_id', 'conflicted',
  'conflict_resolution_reference_id', 'estimated_tokens', 'content_present', 'content_loaded',
  'item_fingerprint', 'validator_version'
]);

const PROJECT_STATE_REFERENCE_FIELDS = Object.freeze([
  'project_state_reference_id', 'project_state_version', 'project_id', 'tenant_id', 'organization_id',
  'active_phase_reference', 'current_task_reference_id', 'pending_task_reference_ids', 'decision_reference_ids',
  'risk_reference_ids', 'required', 'content_present', 'content_loaded', 'state_fingerprint', 'validator_version'
]);

const SUMMARY_SCOPES = Object.freeze(['PLATFORM', 'TENANT', 'PROJECT', 'PHASE', 'TASK', 'SESSION_REFERENCE']);

const CONTINUITY_SUMMARY_REFERENCE_FIELDS = Object.freeze([
  'continuity_reference_id', 'continuity_version', 'tenant_id', 'organization_id', 'project_id', 'summary_scope',
  'covered_sequence_start', 'covered_sequence_end', 'source_reference_ids', 'required', 'content_present',
  'content_loaded', 'summary_fingerprint', 'validator_version'
]);

const MAX_ESTIMATED_TOKENS = 10000000;
const MAX_PRIORITY = 1000000;
const MAX_LIST_ITEMS = 500;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function isExplicitPreference(item) {
  return isPlainObject(item) && item.explicitly_declared === true && EXPLICIT_CONFIDENCE_LEVELS.includes(item.confidence_level);
}

function validateMemorySelectionItemReference(item) {
  const errors = [];
  if (!isPlainObject(item)) return { valid: false, errors: ['item_reference_must_be_object'] };
  exactFields(item, MEMORY_SELECTION_ITEM_REFERENCE_FIELDS, 'item_reference', errors);
  for (const field of [
    'item_reference_id', 'item_class', 'item_type', 'scope_type', 'scope_id', 'tenant_id', 'organization_id',
    'agent_id', 'project_id', 'session_reference_id', 'source_reference_id', 'omission_risk', 'confidence_level',
    'item_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(item[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(item.item_version) || item.item_version < 1) errors.push('item_version_invalid');
  if (!ITEM_CLASSES.includes(item.item_class)) errors.push(`item_class_not_allowed::${item.item_class}`);
  if (!ITEM_TYPES.includes(item.item_type)) errors.push(`item_type_not_allowed::${item.item_type}`);
  if (!SCOPE_TYPES.includes(item.scope_type)) errors.push(`scope_type_not_allowed::${item.scope_type}`);
  if (!OMISSION_RISKS.includes(item.omission_risk)) errors.push(`omission_risk_not_allowed::${item.omission_risk}`);
  if (!CONFIDENCE_LEVELS.includes(item.confidence_level)) errors.push(`confidence_level_not_allowed::${item.confidence_level}`);
  if (typeof item.explicitly_declared !== 'boolean') errors.push('explicitly_declared_must_be_boolean');
  if (typeof item.required !== 'boolean') errors.push('required_must_be_boolean');
  if (!Number.isInteger(item.priority) || item.priority < 0 || item.priority > MAX_PRIORITY) errors.push('priority_invalid');
  if (!Number.isInteger(item.recency_sequence) || item.recency_sequence < 0) errors.push('recency_sequence_invalid');
  if (!Number.isInteger(item.frequency_reference) || item.frequency_reference < 0) errors.push('frequency_reference_invalid');
  if (typeof item.superseded !== 'boolean') errors.push('superseded_must_be_boolean');
  if (item.superseded_by_reference_id !== null && !isNonEmptyString(item.superseded_by_reference_id)) {
    errors.push('superseded_by_reference_id_must_be_null_or_string');
  }
  if (typeof item.conflicted !== 'boolean') errors.push('conflicted_must_be_boolean');
  if (item.conflict_resolution_reference_id !== null && !isNonEmptyString(item.conflict_resolution_reference_id)) {
    errors.push('conflict_resolution_reference_id_must_be_null_or_string');
  }
  if (!Number.isInteger(item.estimated_tokens) || item.estimated_tokens < 0 || item.estimated_tokens > MAX_ESTIMATED_TOKENS) {
    errors.push('estimated_tokens_invalid');
  }
  if (item.content_present !== false) errors.push('content_present_must_be_false');
  if (item.content_loaded !== false) errors.push('content_loaded_must_be_false');
  if (item.required === true && item.item_class !== 'REQUIRED') errors.push('required_true_requires_item_class_required');
  if (
    isNonEmptyString(item.tenant_id) && isNonEmptyString(item.organization_id) &&
    !item.organization_id.startsWith(`${item.tenant_id}:`)
  ) {
    errors.push('organization_id_not_compatible_with_tenant');
  }
  if (item.validator_version !== MEMORY_SELECTION_ITEM_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(item);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(item));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateProjectStateReference(state) {
  const errors = [];
  if (!isPlainObject(state)) return { valid: false, errors: ['project_state_reference_must_be_object'] };
  exactFields(state, PROJECT_STATE_REFERENCE_FIELDS, 'project_state_reference', errors);
  for (const field of [
    'project_state_reference_id', 'project_id', 'tenant_id', 'organization_id', 'active_phase_reference',
    'current_task_reference_id', 'state_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(state[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(state.project_state_version) || state.project_state_version < 1) errors.push('project_state_version_invalid');
  for (const field of ['pending_task_reference_ids', 'decision_reference_ids', 'risk_reference_ids']) {
    if (!isOrderedUniqueStringList(state[field])) errors.push(`${field}_invalid`);
  }
  if (state.required !== true) errors.push('required_must_be_true');
  if (state.content_present !== false) errors.push('content_present_must_be_false');
  if (state.content_loaded !== false) errors.push('content_loaded_must_be_false');
  if (
    isNonEmptyString(state.tenant_id) && isNonEmptyString(state.organization_id) &&
    !state.organization_id.startsWith(`${state.tenant_id}:`)
  ) {
    errors.push('organization_id_not_compatible_with_tenant');
  }
  if (state.validator_version !== PROJECT_STATE_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(state);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(state));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateContinuitySummaryReference(summary) {
  const errors = [];
  if (!isPlainObject(summary)) return { valid: false, errors: ['continuity_summary_reference_must_be_object'] };
  exactFields(summary, CONTINUITY_SUMMARY_REFERENCE_FIELDS, 'continuity_summary_reference', errors);
  for (const field of [
    'continuity_reference_id', 'tenant_id', 'organization_id', 'project_id', 'summary_scope', 'summary_fingerprint',
    'validator_version'
  ]) {
    if (!isNonEmptyString(summary[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(summary.continuity_version) || summary.continuity_version < 1) errors.push('continuity_version_invalid');
  if (!SUMMARY_SCOPES.includes(summary.summary_scope)) errors.push(`summary_scope_not_allowed::${summary.summary_scope}`);
  if (!Number.isInteger(summary.covered_sequence_start) || summary.covered_sequence_start < 0) errors.push('covered_sequence_start_invalid');
  if (!Number.isInteger(summary.covered_sequence_end) || summary.covered_sequence_end < 0) errors.push('covered_sequence_end_invalid');
  if (
    Number.isInteger(summary.covered_sequence_start) && Number.isInteger(summary.covered_sequence_end) &&
    summary.covered_sequence_end < summary.covered_sequence_start
  ) {
    errors.push('covered_sequence_end_before_start');
  }
  if (!isOrderedUniqueStringList(summary.source_reference_ids)) errors.push('source_reference_ids_invalid');
  if (summary.required !== true) errors.push('required_must_be_true');
  if (summary.content_present !== false) errors.push('content_present_must_be_false');
  if (summary.content_loaded !== false) errors.push('content_loaded_must_be_false');
  if (
    isNonEmptyString(summary.tenant_id) && isNonEmptyString(summary.organization_id) &&
    !summary.organization_id.startsWith(`${summary.tenant_id}:`)
  ) {
    errors.push('organization_id_not_compatible_with_tenant');
  }
  if (summary.validator_version !== CONTINUITY_SUMMARY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(summary);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(summary));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  BLOCKING_CONFIDENCE_LEVELS,
  CONFIDENCE_LEVELS,
  CONTINUITY_SUMMARY_REFERENCE_FIELDS,
  CONTINUITY_SUMMARY_REFERENCE_VALIDATOR_VERSION,
  EXPLICIT_CONFIDENCE_LEVELS,
  HIGH_OMISSION_RISKS,
  ITEM_CLASSES,
  ITEM_TYPES,
  MAX_ESTIMATED_TOKENS,
  MAX_LIST_ITEMS,
  MAX_PRIORITY,
  MEMORY_SELECTION_ITEM_REFERENCE_FIELDS,
  MEMORY_SELECTION_ITEM_REFERENCE_VALIDATOR_VERSION,
  OMISSION_RISKS,
  PREFERENCE_ITEM_TYPES,
  PROJECT_STATE_REFERENCE_FIELDS,
  PROJECT_STATE_REFERENCE_VALIDATOR_VERSION,
  SCOPE_TYPES,
  SUMMARY_SCOPES,
  isExplicitPreference,
  isOrderedUniqueStringList,
  validateContinuitySummaryReference,
  validateMemorySelectionItemReference,
  validateProjectStateReference
};

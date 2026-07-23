'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { ACTOR_ROLES, ACTOR_TYPES, AUTHORIZATION_STATES, FORBIDDEN_AUTHORIZATION_STATES } = require('./agent-context-contract');

const EXECUTION_AUTHORIZATION_ACTOR_CONTEXT_VALIDATOR_VERSION = 'execution_authorization_actor_context_validator_v1';

const EXECUTION_AUTHORIZATION_ACTOR_CONTEXT_FIELDS = Object.freeze([
  'actor_id', 'actor_type', 'actor_role', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id',
  'authorization_state', 'identity_verified', 'membership_verified', 'role_verified', 'scope_verified',
  'actor_fingerprint', 'validator_version'
]);

const VERIFICATION_FLAG_FIELDS = Object.freeze(['identity_verified', 'membership_verified', 'role_verified', 'scope_verified']);

// Full actor verification -- the combination the boundary requires before it will ever consider
// AUTHORIZED_SIMULATION. No real authentication happens anywhere in this module; these are
// declarative flags produced upstream (Agent Session Boundary / Agent Policy Boundary), never
// computed here.
const FULLY_VERIFIED_ACTOR_STATE = Object.freeze({
  authorization_state: 'APPROVED_SIMULATION',
  identity_verified: true,
  membership_verified: true,
  role_verified: true,
  scope_verified: true
});

function validateExecutionAuthorizationActorContext(actor) {
  const errors = [];
  if (!isPlainObject(actor)) return { valid: false, errors: ['execution_authorization_actor_context_must_be_object'] };
  exactFields(actor, EXECUTION_AUTHORIZATION_ACTOR_CONTEXT_FIELDS, 'execution_authorization_actor_context', errors);
  for (const field of ['actor_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'actor_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(actor[field])) errors.push(`${field}_invalid`);
  }
  if (!ACTOR_TYPES.includes(actor.actor_type)) errors.push(`actor_type_not_allowed::${actor.actor_type}`);
  if (!ACTOR_ROLES.includes(actor.actor_role)) errors.push(`actor_role_not_allowed::${actor.actor_role}`);
  if (!AUTHORIZATION_STATES.includes(actor.authorization_state)) errors.push(`authorization_state_not_allowed::${actor.authorization_state}`);
  if (FORBIDDEN_AUTHORIZATION_STATES.includes(actor.authorization_state)) errors.push(`authorization_state_forbidden::${actor.authorization_state}`);
  for (const field of VERIFICATION_FLAG_FIELDS) {
    if (typeof actor[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (actor.validator_version !== EXECUTION_AUTHORIZATION_ACTOR_CONTEXT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(actor);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(actor));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeActorFingerprint(actor) {
  const { actor_fingerprint, ...rest } = actor;
  return stablePayload(rest);
}

function isActorFullyVerified(actor) {
  return isPlainObject(actor) && Object.entries(FULLY_VERIFIED_ACTOR_STATE).every(([field, expected]) => actor[field] === expected);
}

function buildExecutionAuthorizationActorContext(input = {}) {
  const actor = {
    actor_id: input.actor_id,
    actor_type: input.actor_type,
    actor_role: input.actor_role,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    authorization_state: input.authorization_state,
    identity_verified: input.identity_verified === true,
    membership_verified: input.membership_verified === true,
    role_verified: input.role_verified === true,
    scope_verified: input.scope_verified === true,
    validator_version: EXECUTION_AUTHORIZATION_ACTOR_CONTEXT_VALIDATOR_VERSION
  };
  actor.actor_fingerprint = computeActorFingerprint({ ...actor, actor_fingerprint: undefined });

  const validation = validateExecutionAuthorizationActorContext(actor);
  if (!validation.valid) {
    throw new Error(`execution_authorization_actor_context_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(actor);
}

module.exports = {
  EXECUTION_AUTHORIZATION_ACTOR_CONTEXT_FIELDS,
  EXECUTION_AUTHORIZATION_ACTOR_CONTEXT_VALIDATOR_VERSION,
  FULLY_VERIFIED_ACTOR_STATE,
  VERIFICATION_FLAG_FIELDS,
  buildExecutionAuthorizationActorContext,
  computeActorFingerprint,
  isActorFullyVerified,
  validateExecutionAuthorizationActorContext
};

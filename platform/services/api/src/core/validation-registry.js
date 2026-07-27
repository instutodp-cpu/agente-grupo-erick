'use strict';

const { VALIDATION_STAGES } = require('./validation-outcome');

// An explicit, statically-built registry of validators -- never dynamic `import()`-based
// discovery ("Não criar dynamic discovery por import dinâmico. Usar registry explícito e gate
// estático."). Every validator is registered by hand, at module load time, with a fixed
// validator_id/version/stage/priority/required/applicable-predicate/handler tuple. The
// Validator Discovery Gate (architecture-gate-rules.js, test-time only) is what actually catches a
// validator that exists in source but was never registered here.

const MAX_PRIORITY = 1000000;

function isPureFunction(fn) {
  return typeof fn === 'function' && fn.constructor.name !== 'AsyncFunction' && fn.constructor.name !== 'GeneratorFunction';
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function validateDefinitions(definitions) {
  const errors = [];
  const seenIds = new Set();
  for (const definition of definitions) {
    if (!isNonEmptyString(definition.validator_id)) {
      errors.push('validator_id_invalid');
    } else if (seenIds.has(definition.validator_id)) {
      errors.push(`duplicate_validator_id::${definition.validator_id}`);
    }
    if (isNonEmptyString(definition.validator_id)) seenIds.add(definition.validator_id);

    if (!isNonEmptyString(definition.version)) errors.push(`validator_version_invalid::${definition.validator_id}`);
    if (!VALIDATION_STAGES.includes(definition.stage)) errors.push(`unknown_validation_stage::${definition.validator_id}::${definition.stage}`);
    if (!Number.isInteger(definition.priority) || definition.priority < 0 || definition.priority > MAX_PRIORITY) {
      errors.push(`priority_invalid::${definition.validator_id}`);
    }
    if (typeof definition.required !== 'boolean') errors.push(`required_must_be_boolean::${definition.validator_id}`);
    if (typeof definition.applicable !== 'function') errors.push(`applicable_predicate_missing::${definition.validator_id}`);
    if (!isPureFunction(definition.handler)) errors.push(`handler_must_be_a_synchronous_pure_function::${definition.validator_id}`);
  }
  return errors;
}

// Deterministic order: canonical VALIDATION_STAGES order first, then priority ascending within a
// stage, then validator_id as a final tie-breaker -- never registration order alone.
function sortDefinitions(definitions) {
  return [...definitions].sort((a, b) => {
    const stageDelta = VALIDATION_STAGES.indexOf(a.stage) - VALIDATION_STAGES.indexOf(b.stage);
    if (stageDelta !== 0) return stageDelta;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.validator_id < b.validator_id ? -1 : a.validator_id > b.validator_id ? 1 : 0;
  });
}

function buildValidationRegistry(definitions) {
  const errors = validateDefinitions(definitions);
  if (errors.length > 0) {
    throw new Error(`validation_registry_construction_invalid::${JSON.stringify(errors)}`);
  }
  const frozenDefinitions = Object.freeze(sortDefinitions(definitions).map((definition) => Object.freeze({ ...definition })));

  return Object.freeze({
    getValidatorsForStage: (stage) => frozenDefinitions.filter((definition) => definition.stage === stage),
    getAllValidators: () => frozenDefinitions,
    getValidatorById: (validatorId) => frozenDefinitions.find((definition) => definition.validator_id === validatorId) || null,
    definitions: frozenDefinitions
  });
}

// A registry builder is mutable only until `.build()` is called -- `.register()` accumulates
// definitions in a private array; `.build()` validates the full accumulated set once, freezes it,
// and returns an immutable registry object. Calling `.register()` again on the *builder* after
// `.build()` has no effect on any already-built registry (the built registry closed over its own
// frozen snapshot), matching "registry imutável após build."
function createValidationRegistryBuilder() {
  const definitions = [];
  return Object.freeze({
    register(definition) {
      definitions.push(definition);
      return this;
    },
    build() {
      return buildValidationRegistry(definitions);
    }
  });
}

module.exports = {
  MAX_PRIORITY,
  buildValidationRegistry,
  createValidationRegistryBuilder,
  isPureFunction,
  sortDefinitions,
  validateDefinitions
};

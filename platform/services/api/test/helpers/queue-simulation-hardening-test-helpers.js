'use strict';

const assert = require('node:assert/strict');

const { stablePayload } = require('../../src/core/transcription-provider-contract-registry');

function canonicalSnapshot(value) {
  return stablePayload(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return value;
}

function tryMutation(mutator) {
  try {
    mutator();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
}

function assertFrozenMutationRejected(label, target, mutator) {
  assert.throws(() => mutator(target), TypeError, label);
}

function assertNoPrototypePollution(sentinel) {
  assert.equal(Object.prototype[sentinel], undefined, `Object.prototype.${sentinel}`);
  assert.equal(({})[sentinel], undefined, `plain object ${sentinel}`);
}

function buildRequestWithInheritedRequiredField(request, field, sentinel) {
  const inherited = Object.assign(Object.create({
    [field]: request[field],
    [sentinel]: 'inherited-value'
  }), request);
  delete inherited[field];
  return inherited;
}

function buildRequestWithPrototypePollutionFields(request, sentinel) {
  const polluted = { ...request };
  Object.defineProperty(polluted, '__proto__', {
    value: { [sentinel]: 'proto-value' },
    enumerable: true,
    configurable: true
  });
  polluted.constructor = { prototype: { [sentinel]: 'constructor-value' } };
  polluted.prototype = { [sentinel]: 'prototype-value' };
  return polluted;
}

function assertInheritedRequiredFieldRejected({
  label,
  request,
  field,
  sentinel,
  validate,
  evaluate,
  expectedStatus
}) {
  assertNoPrototypePollution(sentinel);
  const inherited = buildRequestWithInheritedRequiredField(request, field, sentinel);
  assert.equal(inherited[field], request[field]);
  assert.equal(Object.prototype.hasOwnProperty.call(inherited, field), false);

  const validation = validate(inherited);
  assert.equal(validation.valid, false, `${label} inherited field unexpectedly valid`);
  assert.ok(
    validation.errors.some((error) => error.includes(`missing_${field}`)),
    `${label} did not report missing own field: ${JSON.stringify(validation.errors)}`
  );

  const outcome = evaluate(inherited, {});
  assert.equal(outcome.decision.status, expectedStatus);
  assertNoPrototypePollution(sentinel);
}

function assertPollutionFieldsRejected({
  label,
  request,
  sentinel,
  validate,
  evaluate,
  expectedStatus
}) {
  assertNoPrototypePollution(sentinel);
  const polluted = buildRequestWithPrototypePollutionFields(request, sentinel);
  const validation = validate(polluted);
  assert.equal(validation.valid, false, `${label} pollution fields unexpectedly valid`);
  assert.ok(
    validation.errors.some((error) => error.includes('unexpected_field::__proto__')),
    `${label} did not report own __proto__: ${JSON.stringify(validation.errors)}`
  );
  assert.ok(
    validation.errors.some((error) => error.includes('unexpected_field::constructor')),
    `${label} did not report own constructor: ${JSON.stringify(validation.errors)}`
  );
  assert.ok(
    validation.errors.some((error) => error.includes('unexpected_field::prototype')),
    `${label} did not report own prototype: ${JSON.stringify(validation.errors)}`
  );

  const outcome = evaluate(polluted, {});
  assert.equal(outcome.decision.status, expectedStatus);
  assertNoPrototypePollution(sentinel);
}

module.exports = {
  assertFrozenMutationRejected,
  assertInheritedRequiredFieldRejected,
  assertNoPrototypePollution,
  assertPollutionFieldsRejected,
  canonicalSnapshot,
  deepFreeze,
  tryMutation
};

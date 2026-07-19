'use strict';

const { deepClone, sanitizeTranscriptionData } = require('./transcription-contract');
const { isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { deepFreeze } = require('./transcription-provider-adapter-interface');

const EXECUTION_CONTEXT_FIELDS = Object.freeze([
  'state',
  'provider',
  'adapter',
  'transport',
  'consent',
  'readiness',
  'mock',
  'audit',
  'result'
]);

function createTranscriptionExecutionContext(overrides = {}) {
  const context = {};
  for (const field of EXECUTION_CONTEXT_FIELDS) context[field] = overrides[field] || null;
  return deepFreeze(sanitizeTranscriptionData(deepClone(context)));
}

function validateTranscriptionExecutionContext(context) {
  const errors = [];
  if (!isPlainObject(context)) return { valid: false, errors: ['execution_context_must_be_object'] };
  const allowed = new Set(EXECUTION_CONTEXT_FIELDS);
  for (const field of EXECUTION_CONTEXT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(context, field)) errors.push(`missing_${field}`);
  }
  for (const field of Object.keys(context)) {
    if (!allowed.has(field)) errors.push(`unexpected_execution_context_field::${field}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  EXECUTION_CONTEXT_FIELDS,
  createTranscriptionExecutionContext,
  validateTranscriptionExecutionContext
};

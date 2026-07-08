'use strict';

const PUBLIC_FIELDS = [
  'adapter_id',
  'adapter_mode',
  'domain',
  'status',
  'simulated',
  'executed',
  'message'
];

const FORBIDDEN_FIELDS = new Set([
  'requiredAdapters',
  'payload',
  'rawMessage',
  'userMessage',
  'secret',
  'token',
  'env',
  'internal',
  'credentials'
]);

const ALLOWED_STATUSES = new Set(['simulated', 'disabled', 'not_available', 'failed']);

const DEFAULT_MESSAGES = {
  simulated: 'Mock adapter simulation completed without real execution.',
  disabled: 'Adapter execution is disabled.',
  not_available: 'Mock adapter not available for this domain.',
  failed: 'Adapter result contract validation failed.'
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pruneForbiddenFields(value, stats) {
  if (Array.isArray(value)) {
    return value.map((entry) => pruneForbiddenFields(entry, stats));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      stats.removed_fields_count += 1;
      continue;
    }

    next[key] = pruneForbiddenFields(entry, stats);
  }

  return next;
}

function sanitizeAdapterResult(result) {
  const stats = { removed_fields_count: 0 };

  if (!isPlainObject(result)) {
    return { result: null, removed_fields_count: stats.removed_fields_count };
  }

  const pruned = pruneForbiddenFields(result, stats);
  const sanitized = {};

  for (const field of PUBLIC_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(pruned, field)) {
      sanitized[field] = pruned[field];
    }
  }

  for (const field of Object.keys(pruned)) {
    if (!PUBLIC_FIELDS.includes(field)) {
      stats.removed_fields_count += 1;
    }
  }

  return { result: sanitized, removed_fields_count: stats.removed_fields_count };
}

function validateAdapterResult(result) {
  const errors = [];

  if (!isPlainObject(result)) {
    errors.push('adapter result must be a plain object');
  } else {
    if (typeof result.adapter_mode !== 'string' || result.adapter_mode !== 'mock') {
      errors.push('adapter_mode must be "mock"');
    }

    if (typeof result.domain !== 'string' || result.domain.trim() === '') {
      errors.push('domain must be a non-empty string');
    }

    if (!ALLOWED_STATUSES.has(result.status)) {
      errors.push('status must be one of simulated, disabled, not_available, failed');
    }

    if (result.executed !== false) {
      errors.push('executed must be false');
    }

    if (typeof result.simulated !== 'boolean') {
      errors.push('simulated must be boolean');
    }

    if (result.status === 'simulated' && result.simulated !== true) {
      errors.push('simulated must be true when status is simulated');
    }

    if (result.status !== 'simulated' && result.simulated === true) {
      errors.push('simulated must be false unless status is simulated');
    }

    if (typeof result.message !== 'string' || result.message.trim() === '') {
      errors.push('message must be a non-empty string');
    }

    if (result.adapter_id != null && typeof result.adapter_id !== 'string') {
      errors.push('adapter_id must be a string or null');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function buildAdapterResult(input = {}) {
  const { result: sanitized } = sanitizeAdapterResult(input);
  const status = ALLOWED_STATUSES.has(sanitized && sanitized.status) ? sanitized.status : 'failed';
  const adapterResult = {
    adapter_id: sanitized && typeof sanitized.adapter_id === 'string' ? sanitized.adapter_id : null,
    adapter_mode: 'mock',
    domain: sanitized && typeof sanitized.domain === 'string' && sanitized.domain.trim() !== ''
      ? sanitized.domain
      : 'desconhecido',
    status,
    simulated: status === 'simulated',
    executed: false,
    message: typeof sanitized?.message === 'string' && sanitized.message.trim() !== ''
      ? sanitized.message
      : DEFAULT_MESSAGES[status] || DEFAULT_MESSAGES.failed
  };

  const validation = validateAdapterResult(adapterResult);
  if (!validation.valid) {
    return {
      adapter_id: adapterResult.adapter_id,
      adapter_mode: 'mock',
      domain: adapterResult.domain,
      status: 'failed',
      simulated: false,
      executed: false,
      message: DEFAULT_MESSAGES.failed
    };
  }

  return adapterResult;
}

module.exports = {
  buildAdapterResult,
  sanitizeAdapterResult,
  validateAdapterResult
};

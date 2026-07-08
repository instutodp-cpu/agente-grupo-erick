'use strict';

const { getDomainMockAdapter } = require('./domain-mock-adapter-registry');
const {
  buildAdapterResult,
  sanitizeAdapterResult,
  validateAdapterResult
} = require('./adapter-result-contract');

function runMockAdapter({ domain } = {}) {
  const adapter = getDomainMockAdapter(domain);

  if (!adapter) {
    const rawResult = {
      adapter_mode: 'mock',
      domain: typeof domain === 'string' && domain.trim() ? domain : 'desconhecido',
      status: 'not_available',
      simulated: false,
      executed: false,
      message: 'Mock adapter not available for this domain.'
    };

    const sanitized = sanitizeAdapterResult(rawResult);
    const validation = validateAdapterResult(sanitized.result);
    console.log(JSON.stringify({
      level: 'info',
      event: 'adapter_result_sanitized',
      adapter_id: null,
      domain: rawResult.domain,
      removed_fields_count: sanitized.removed_fields_count
    }));
    console.log(JSON.stringify({
      level: 'info',
      event: 'adapter_result_validated',
      adapter_id: null,
      domain: rawResult.domain,
      status: rawResult.status,
      executed: rawResult.executed
    }));
    if (!validation.valid) {
      return buildAdapterResult(rawResult);
    }

    return buildAdapterResult(rawResult);
  }

  const rawResult = {
    adapter_id: adapter.adapter_id,
    adapter_mode: adapter.adapter_mode,
    domain: adapter.domain,
    status: 'simulated',
    simulated: true,
    executed: false,
    message: 'Mock adapter simulation completed without real execution.'
  };
  const sanitized = sanitizeAdapterResult(rawResult);
  const validation = validateAdapterResult(sanitized.result);

  console.log(JSON.stringify({
    level: 'info',
    event: 'adapter_result_sanitized',
    adapter_id: adapter.adapter_id,
    domain: adapter.domain,
    removed_fields_count: sanitized.removed_fields_count
  }));
  console.log(JSON.stringify({
    level: 'info',
    event: 'adapter_result_validated',
    adapter_id: adapter.adapter_id,
    domain: adapter.domain,
    status: rawResult.status,
    executed: rawResult.executed
  }));

  if (!validation.valid) {
    return buildAdapterResult(rawResult);
  }

  return buildAdapterResult(rawResult);
}

module.exports = { runMockAdapter };

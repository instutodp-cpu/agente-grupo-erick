'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createPublicWebNodeHttpsClient } = require('../src/adapters/public-web/public-web-node-https-client');

function input(overrides = {}) {
  return {
    url: 'https://public-canary.test/allowed',
    approved_ip: '93.184.216.34',
    approved_ips: ['93.184.216.34'],
    hostname: 'public-canary.test',
    server_name: 'public-canary.test',
    host_header: 'public-canary.test',
    port: 443,
    protocol: 'https',
    redirect_mode: 'manual',
    timeout_ms: 8000,
    max_response_bytes: 1048576,
    ...overrides
  };
}

function response(callback) {
  const handlers = {};
  const res = {
    statusCode: 200,
    headers: { 'content-type': 'text/plain', 'content-length': '2' },
    socket: { remoteAddress: '93.184.216.34' },
    on(event, handler) { handlers[event] = handler; return res; },
    destroy() {}
  };
  callback(res);
  handlers.data(Buffer.from('ok'));
  handlers.end();
}

test('approved-IP lookup supports Node all=true without widening DNS authority', async () => {
  let requestCalls = 0;
  const client = createPublicWebNodeHttpsClient({
    requestFactory(options, callback) {
      requestCalls += 1;
      options.lookup(options.hostname, { all: true }, (error, addresses) => {
        assert.equal(error, null);
        assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]);
      });
      const req = {
        on() { return req; },
        end() { response(callback); },
        destroy() {}
      };
      return req;
    }
  });

  const result = await client.execute(input());
  assert.equal(requestCalls, 1);
  assert.equal(result.status_code, 200);
  assert.equal(result.remote_address, '93.184.216.34');
});

test('approved-IP lookup preserves legacy address/family callback shape', async () => {
  const client = createPublicWebNodeHttpsClient({
    requestFactory(options, callback) {
      options.lookup(options.hostname, {}, (error, address, family) => {
        assert.equal(error, null);
        assert.equal(address, '93.184.216.34');
        assert.equal(family, 4);
      });
      const req = {
        on() { return req; },
        end() { response(callback); },
        destroy() {}
      };
      return req;
    }
  });

  const result = await client.execute(input());
  assert.equal(result.status_code, 200);
});

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

function response(callback, remoteAddress = '93.184.216.34') {
  const handlers = {};
  const res = {
    statusCode: 200,
    headers: { 'content-type': 'text/plain', 'content-length': '2' },
    socket: { remoteAddress },
    on(event, handler) { handlers[event] = handler; return res; },
    destroy() {}
  };
  callback(res);
  handlers.data(Buffer.from('ok'));
  handlers.end();
}

function requestStub(runAssertions, remoteAddress = '93.184.216.34') {
  return (options, callback) => {
    runAssertions(options);
    const req = {
      on() { return req; },
      end() { response(callback, remoteAddress); },
      destroy() {}
    };
    return req;
  };
}

test('approved-IP lookup supports Node all=true and returns only the pinned approved IP', async () => {
  let requestCalls = 0;
  const client = createPublicWebNodeHttpsClient({
    requestFactory: requestStub((options) => {
      requestCalls += 1;
      assert.equal(options.hostname, 'public-canary.test');
      assert.equal(options.servername, 'public-canary.test');
      assert.equal(options.headers.Host, 'public-canary.test');
      options.lookup(options.hostname, { family: undefined, hints: 32, all: true }, (error, addresses) => {
        assert.equal(error, null);
        assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]);
      });
    })
  });

  const result = await client.execute(input({
    approved_ips: ['93.184.216.34', '203.0.113.77']
  }));

  assert.equal(requestCalls, 1);
  assert.equal(result.status_code, 200);
  assert.equal(result.remote_address, '93.184.216.34');
});

test('approved-IP lookup preserves all=false and legacy scalar address/family callback shape', async () => {
  const client = createPublicWebNodeHttpsClient({
    requestFactory: requestStub((options) => {
      for (const lookupOptions of [{ all: false }, {}]) {
        options.lookup(options.hostname, lookupOptions, (error, address, family) => {
          assert.equal(error, null);
          assert.equal(address, '93.184.216.34');
          assert.equal(family, 4);
        });
      }
    })
  });

  const result = await client.execute(input());
  assert.equal(result.status_code, 200);
});

test('approved-IP lookup does not widen to another allowlisted address or ambient DNS fallback', async () => {
  const pinnedIp = '93.184.216.34';
  const otherAllowlistedIp = '203.0.113.77';
  let observed;
  const client = createPublicWebNodeHttpsClient({
    requestFactory: requestStub((options) => {
      options.lookup('public-canary.test', { all: true }, (error, addresses) => {
        assert.equal(error, null);
        observed = addresses;
      });
    })
  });

  const result = await client.execute(input({
    approved_ip: pinnedIp,
    approved_ips: [pinnedIp, otherAllowlistedIp]
  }));

  assert.deepEqual(observed, [{ address: pinnedIp, family: 4 }]);
  assert.equal(observed.some((entry) => entry.address === otherAllowlistedIp), false);
  assert.equal(result.remote_address, pinnedIp);
});

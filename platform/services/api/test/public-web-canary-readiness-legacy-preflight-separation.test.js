'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_STATUSES
} = require('../src/core/public-web-canary-preflight-readiness-boundary');
const {
  buildTrialPlanFromConfig
} = require('../src/pilots/public-web-canary-trial-config-loader');
const {
  runTrialPreflight
} = require('../src/pilots/public-web-canary-trial-preflight');
const {
  validReadinessEvidence
} = require('./helpers/public-web-pilot-test-data');
const {
  deterministicClock,
  validPreflightContext,
  validTrialConfig
} = require('./helpers/public-web-canary-trial-test-data');

function validPlan(overrides = {}) {
  const built = buildTrialPlanFromConfig(validTrialConfig(overrides), {
    clock: deterministicClock,
    now: deterministicClock()
  });
  assert.equal(built.ok, true, built.blocked_reason);
  return built.plan;
}

function canonicalReadinessResult() {
  return {
    status: 'PUBLIC_WEB_CANARY_PREFLIGHT_READY',
    decision: 'ENTER_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT',
    next_state: 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_RUN',
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false
  };
}

test('canonical preflight readiness does not satisfy the historical ready=true gate', () => {
  const readiness = canonicalReadinessResult();
  assert.equal(PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_STATUSES.includes(readiness.status), true);
  assert.equal(Object.prototype.hasOwnProperty.call(readiness, 'ready'), false);

  const calls = {
    runner: 0,
    http: 0,
    dns: 0,
    secret: 0,
    database: 0,
    audit: 0
  };
  const base = validPreflightContext();
  const context = {
    ...base,
    readinessResult: readiness,
    canaryRunner: {
      runCanaryRequest() {
        calls.runner += 1;
      }
    },
    nodeHttpsClient: {
      execute() {
        calls.http += 1;
      }
    },
    dnsResolver: {
      resolve() {
        calls.dns += 1;
      }
    },
    secretResolver: {
      canResolve() {
        calls.secret += 1;
        return true;
      },
      resolveReference() {
        calls.secret += 1;
      }
    },
    database: {
      write() {
        calls.database += 1;
      }
    },
    auditSink: {
      append() {
        calls.audit += 1;
      }
    }
  };

  const result = runTrialPreflight(validPlan(), context);

  assert.equal(result.passed, false);
  assert.ok(result.blocking_reasons.includes('readiness_missing'));
  assert.equal(result.simulated, true);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.can_trigger_real_execution, false);
  assert.deepEqual(calls, {
    runner: 0,
    http: 0,
    dns: 0,
    secret: 0,
    database: 0,
    audit: 0
  });
});

test('legacy ready=true evidence remains a distinct historical contract', () => {
  const legacy = validReadinessEvidence();

  assert.equal(legacy.ready, true);
  assert.notEqual(legacy.status, 'PUBLIC_WEB_CANARY_PREFLIGHT_READY');
  assert.equal(PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_STATUSES.includes(legacy.status), false);
  assert.equal(legacy.simulated, true);
  assert.equal(legacy.executed, false);
  assert.equal(legacy.real_provider_called, false);
  assert.equal(legacy.can_trigger_real_execution, false);

  const result = runTrialPreflight(validPlan(), validPreflightContext({
    readinessResult: legacy
  }));

  assert.equal(result.passed, true);
  assert.equal(result.simulated, true);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.can_trigger_real_execution, false);
});

test('historical preflight source remains unbridged from canonical readiness status', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'pilots', 'public-web-canary-trial-preflight.js'),
    'utf8'
  );

  assert.equal(source.includes('context.readinessResult.ready !== true'), true);
  assert.equal(source.includes('PUBLIC_WEB_CANARY_PREFLIGHT_READY'), false);
  assert.equal(source.includes('ENTER_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT'), false);
});

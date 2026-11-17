'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONTRACT,
  buildAccountingRuntimeHandoff,
  validateAccountingRuntimeHandoff,
  admitAccountingRuntime
} = require('../src/accounting-runtime-integration');

function handoff(mode = 'SIMULATION') {
  return buildAccountingRuntimeHandoff({
    handoffId: 'h1',
    tenantId: 't1',
    organizationId: 'o1',
    projectId: 'p1',
    sessionReferenceId: 's1',
    actorId: 'human1',
    operationId: 'pay1',
    capability: 'FINANCIAL_EXECUTION',
    idempotencyKey: 'k1',
    mode
  });
}

test('C25 only builds simulation or shadow handoffs with no external effect', () => {
  const value = handoff();
  assert.equal(value.contract, CONTRACT);
  assert.equal(value.executed, false);
  assert.equal(value.externalEffectAllowed, false);
  assert.equal(value.realProviderAllowed, false);
  assert.equal(validateAccountingRuntimeHandoff(value).valid, true);
  assert.throws(() => handoff('PRODUCTION'), /C25_ONLY_SIMULATION_OR_SHADOW/);
});

test('invalid or tampered handoffs fail closed before runtime calls', async () => {
  const value = { ...handoff(), executed: true };
  const result = await admitAccountingRuntime({ handoff: value, runtime: {} });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.includes('EXECUTED_MUST_BE_FALSE'));
});

test('canonical runtime requirements cannot be removed from a handoff', async () => {
  const value = { ...handoff(), requiresCanonicalExecutionAttempt: false };
  const result = await admitAccountingRuntime({ handoff: value, runtime: {} });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reason, 'HANDOFF_INVALID');
  assert.ok(result.blockers.includes('CANONICAL_ATTEMPT_REQUIREMENT_MISSING'));
});

test('missing canonical runtime fails closed', async () => {
  const result = await admitAccountingRuntime({ handoff: handoff() });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reason, 'CANONICAL_RUNTIME_UNAVAILABLE');
});

test('job admission denial stops before attempt materialization', async () => {
  let materialized = false;
  const runtime = {
    admitExecutionJob: async () => ({ outcome: 'DENIED' }),
    materializeExecutionAttempt: async () => {
      materialized = true;
    },
    admitExecutionAttempt: async () => ({ outcome: 'ADMITTED' })
  };
  const result = await admitAccountingRuntime({ handoff: handoff(), runtime });
  assert.equal(result.reason, 'JOB_ADMISSION_DENIED');
  assert.equal(materialized, false);
});

test('attempt materialization failure stops before attempt admission', async () => {
  let admitted = false;
  const runtime = {
    admitExecutionJob: async () => ({ outcome: 'ADMITTED', job_reference_id: 'j1' }),
    materializeExecutionAttempt: async () => null,
    admitExecutionAttempt: async () => {
      admitted = true;
    }
  };
  const result = await admitAccountingRuntime({ handoff: handoff(), runtime });
  assert.equal(result.reason, 'ATTEMPT_MATERIALIZATION_FAILED');
  assert.equal(admitted, false);
});

test('attempt admission denial remains blocked', async () => {
  const runtime = {
    admitExecutionJob: async () => ({ outcome: 'ADMITTED', job_reference_id: 'j1' }),
    materializeExecutionAttempt: async () => ({ attempt_durable_record_id: 'a1' }),
    admitExecutionAttempt: async () => ({ outcome: 'DENIED' })
  };
  const result = await admitAccountingRuntime({ handoff: handoff(), runtime });
  assert.equal(result.reason, 'ATTEMPT_ADMISSION_DENIED');
  assert.equal(result.executed, false);
});

test('canonical runtime sequence can reach admitted simulation without execution', async () => {
  const calls = [];
  const runtime = {
    admitExecutionJob: async (value) => {
      calls.push(['job', value.mode]);
      return { outcome: 'ADMITTED', job_reference_id: 'j1' };
    },
    materializeExecutionAttempt: async ({ job }) => {
      calls.push(['materialize', job.job_reference_id]);
      return { attempt_durable_record_id: 'a1' };
    },
    admitExecutionAttempt: async ({ attempt }) => {
      calls.push(['admit_attempt', attempt.attempt_durable_record_id]);
      return { outcome: 'ADMITTED' };
    }
  };
  const result = await admitAccountingRuntime({ handoff: handoff('SHADOW'), runtime });
  assert.deepEqual(calls, [['job', 'SHADOW'], ['materialize', 'j1'], ['admit_attempt', 'a1']]);
  assert.equal(result.status, 'ADMITTED_SIMULATION');
  assert.equal(result.mode, 'SHADOW');
  assert.equal(result.executed, false);
  assert.equal(result.externalEffectAllowed, false);
  assert.equal(result.realProviderAllowed, false);
});

test('runtime exceptions fail closed without leaking execution', async () => {
  const result = await admitAccountingRuntime({
    handoff: handoff(),
    runtime: {
      admitExecutionJob: async () => {
        throw new Error('synthetic adapter error');
      },
      materializeExecutionAttempt: async () => ({ attempt_durable_record_id: 'a1' }),
      admitExecutionAttempt: async () => ({ outcome: 'ADMITTED' })
    }
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reason, 'JOB_ADMISSION_ERROR');
  assert.equal(result.executed, false);
  assert.equal(result.externalEffectAllowed, false);
});
